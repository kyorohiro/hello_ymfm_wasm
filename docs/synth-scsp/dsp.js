// SPDX-License-Identifier: BSD-3-Clause
// Original mono-delay microprogram for the pinned SCSP DSP, not Web Audio DSP.
import {validateScspDspDelayProgram} from './dsp_program.js?v=scsp-dsp-coef-1';
export const DSP_RAM_BYTES=65536; // RBL=2: 32K words at address 0.
export const DSP_COEFFICIENT_MIN = -4096;
export const DSP_COEFFICIENT_MAX = 4095;
export const DSP_FEEDBACK_MAX = DSP_COEFFICIENT_MAX / 4096;
export const EFFECT_DEFAULTS=Object.freeze({enabled:false,timeMs:240,feedback:.35,send:7,returnLevel:6});
export function effectSettings(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(EFFECT_DEFAULTS,k)))throw new TypeError('Invalid DSP Delay settings');
  const result={...EFFECT_DEFAULTS,...value};
  if(typeof result.enabled!=='boolean')throw new TypeError('DSP Enable must be boolean');
  if(!Number.isInteger(result.timeMs)||result.timeMs<20||result.timeMs>700)throw new RangeError('DSP Delay time must be 20..700 ms');
  if(!Number.isFinite(result.feedback)||result.feedback< -1||result.feedback>DSP_FEEDBACK_MAX)throw new RangeError(`DSP Delay feedback must be -1..${DSP_FEEDBACK_MAX}`);
  for(const key of ['send','returnLevel'])if(!Number.isInteger(result[key])||result[key]<0||result[key]>7)throw new RangeError('DSP Send / Return must be 0..7');
  return result;
}
// Append-only, unplayable zero allocation protects the ring from PCM/editor
// reuse using the existing bank allocator. No raw PCM write may overlap it.
export function reserveDspRam(synth){return synth.loadPCM(new Int16Array(DSP_RAM_BYTES/2-1),{rootNote:69});}
const word=({ira=0,iwt=false,x=true,coef=0,acc=false,read=false,write=false,emit=false,masa=0}={})=>[
  0,(x?0x8000:0)|0x2000|(ira<<6)|(iwt?0x20:0),
  (read?0x2000:0)|(write?0x4000:0)|(emit?0x1000:0)|(acc?1:2),
  (coef<<9)|(masa<<2),
];
export function delayProgram(){
  // The shifter sees the previous ACC. Memory IO occurs on odd steps only;
  // IWT latches the preceding read. PACK/UNPACK stores SCSP floating-point PCM.
  const program=new Uint16Array(512);
  const steps=[word(),word({read:true}),word({iwt:true}),word({emit:true,coef:1}),word({ira:0x20,coef:2,acc:true}),word({write:true,masa:1})];
  steps.forEach((instruction,index)=>program.set(instruction,index*4));return program;
}
// The DSP consumes the signed high 13 bits as Q12 and ignores the low three.
const coefficientWord = value => (value & 0x1fff) << 3;
export class DspDelay{
  #program = delayProgram();
  #revision = 0;
  #coef0 = DSP_COEFFICIENT_MAX;
  #coef2 = DSP_COEFFICIENT_MAX;
  constructor(core,settings=EFFECT_DEFAULTS){this.core=core;this.settings=effectSettings(settings);this.install();}
  readCoefficients() {
    return {codes: [this.#coef0, Math.floor(this.settings.feedback * 4096), this.#coef2], feedback: this.settings.feedback};
  }
  setCoefficients(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || ArrayBuffer.isView(patch)) {
      throw new TypeError('DSP coefficients require an object with keys 0, 1 or 2');
    }
    const keys = Reflect.ownKeys(patch);
    const previous = this.readCoefficients().codes;
    const next = [...previous];
    for (const key of keys) {
      if (!['0', '1', '2'].includes(key)) throw new TypeError('DSP coefficient keys must be 0, 1 or 2');
      const value = patch[key];
      if (!Number.isInteger(value) || value < DSP_COEFFICIENT_MIN || value > DSP_COEFFICIENT_MAX) {
        throw new RangeError(`COEF${key} must be an integer from ${DSP_COEFFICIENT_MIN} to ${DSP_COEFFICIENT_MAX}`);
      }
      next[Number(key)] = value;
    }
    const changed = next.flatMap((value, index) => value === previous[index] ? [] : [index]);
    const oldWords = changed.map(index => typeof this.core.read === 'function'
      ? this.core.read(0x700 + index * 2) : coefficientWord(previous[index]));
    try {
      for (const index of changed) this.core.write(0x700 + index * 2, coefficientWord(next[index]));
    } catch (error) {
      const failures = [];
      for (let position = 0; position < changed.length; position++) {
        try { this.core.write(0x700 + changed[position] * 2, oldWords[position]); }
        catch (failure) { failures.push(failure); }
      }
      if (failures.length) {
        const fatal = new Error(
          'DSP coefficient update failed and rollback could not restore the audio owner. Restart audio before continuing.',
          {cause: new AggregateError([error, ...failures])},
        );
        fatal.name = 'ScspDspRollbackError';
        fatal.fatal = true;
        throw fatal;
      }
      throw error;
    }
    this.#coef0 = next[0];
    this.#coef2 = next[2];
    if (keys.includes('1')) this.settings = {...this.settings, feedback: next[1] / 4096};
    return this.readCoefficients();
  }
  readProgram() {
    const legacy = delayProgram();
    return {
      words: Array.from(this.#program),
      custom: this.#program.some((word, index) => word !== legacy[index]),
      revision: this.#revision,
    };
  }
  #upload(program) {
    for (let index = 0; index < program.length; index++) {
      this.core.write(0x800 + index * 2, program[index]);
    }
    // 0xBF0 is both word 504 and Start. Preserve the complete instruction.
    this.core.write(0xbf0, program[504]);
  }
  applyProgram(words) {
    const program = validateScspDspDelayProgram(words);
    if (program.every((word, index) => word === this.#program[index])) return this.readProgram();
    const core = this.core;
    if ((core.read(0x402) & 0x1bf) !== (2 << 7)) {
      throw new Error('DSP Apply requires the existing RBP=0 / RBL=2 Delay ring');
    }
    const previous = this.#program;
    const ring = core.readRam(0, DSP_RAM_BYTES);
    const outputReturn = core.read(22);
    try {
      core.write(22, 0, 0xff);
      this.#upload(program);
      this.clear();
      core.write(22, outputReturn, 0xff);
    } catch (error) {
      const failures = [];
      // Make every restoration attempt before allowing the owner to resume.
      try { this.#upload(previous); } catch (failure) { failures.push(failure); }
      try { core.loadRam(ring, 0); } catch (failure) { failures.push(failure); }
      try { core.write(22, outputReturn, 0xff); } catch (failure) { failures.push(failure); }
      if (failures.length) {
        const fatal = new Error(
          'DSP Apply failed and rollback could not restore the audio owner. Restart audio before continuing.',
          { cause: new AggregateError([error, ...failures]) },
        );
        fatal.name = 'ScspDspRollbackError';
        fatal.fatal = true;
        throw fatal;
      }
      throw error;
    }
    this.#program = program;
    this.#revision++;
    return this.readProgram();
  }
  install(){
    const core=this.core;
    core.write(22,0,0xff); // Mute EFREG0 while replacing its program.
    for(let offset=0;offset<1024;offset+=2)core.write(0x800+offset,0);
    core.write(0x402,2<<7);
    core.write(0x700,coefficientWord(this.#coef0));
    core.write(0x704,coefficientWord(this.#coef2));
    core.write(0x782,0); // write address: DEC
    const program=this.#program;
    for(let index=0;index<program.length;index++)if(program[index])core.write(0x800+index*2,program[index]);
    core.write(0xbf0,program[504]); // Explicit Start preserving physical step 126.
    this.clear();this.parameters();
  }
  clear(){const silence=new Uint8Array(DSP_RAM_BYTES);for(let i=0;i<silence.length;i+=2)silence[i]=0x60;this.core.loadRam(silence,0);}
  parameters(){
    this.core.write(0x702,coefficientWord(Math.floor(this.settings.feedback*4096)));
    this.core.write(0x780,Math.round(this.settings.timeMs*44.1));
    this.core.write(22,this.settings.enabled?this.settings.returnLevel<<5:0,0xff);
  }
  configure(patch){if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('Invalid DSP Delay settings');const next=effectSettings({...this.settings,...patch}),clear=next.enabled!==this.settings.enabled||next.timeMs!==this.settings.timeMs;this.settings=next;if(clear)this.clear();this.parameters();return {...next};}
  route(outputSlots){
    const sends=new Set(outputSlots);
    for(let slot=0;slot<32;slot++)this.core.write(slot*32+20,this.settings.enabled&&sends.has(slot)?this.settings.send:0);
    this.parameters();
  }
}
