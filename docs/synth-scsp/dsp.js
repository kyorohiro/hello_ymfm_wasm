// SPDX-License-Identifier: BSD-3-Clause
// Synth-owned hardware DSP program, protected Delay ring and effect routing.
import {validateScspSynthDspProgram} from './dsp_program.js?v=scsp-dsp-ui-routing-1';
export const DSP_RAM_BYTES=65536; // RBL=2: 32K words at address 0.
import {DSP_COEFFICIENT_MAX, DSP_FEEDBACK_MAX, coefficientWord, resolveCoefficientPatch,
  validateScspDspProgramOptions} from '../js/scsp_dsp_coefficients.js';
export {DSP_COEFFICIENT_MIN, DSP_COEFFICIENT_MAX, DSP_FEEDBACK_MAX,
  validateScspDspProgramOptions} from '../js/scsp_dsp_coefficients.js';
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
export class DspDelay{
  #program = delayProgram();
  #revision = 0;
  #coef0 = DSP_COEFFICIENT_MAX;
  #coef2 = DSP_COEFFICIENT_MAX;
  #returnPan = 0;
  #secondReturn = {level:0,pan:0};
  #indexedReturns = false;
  constructor(core,settings=EFFECT_DEFAULTS){this.core=core;this.settings=effectSettings(settings);this.install();}
  readReturns(){return [{level:this.settings.returnLevel,pan:this.#returnPan},{...this.#secondReturn}];}
  #returnWord(value){return this.settings.enabled?(value.level<<5)|value.pan:0;}
  #returnAddresses(){return this.#indexedReturns?[22,54]:[22];}
  /** Independent hardware EFREG output controls. Direct slot mix is untouched. */
  setReturn(output,patch){
    if(!Number.isInteger(output)||output<0||output>1)throw new RangeError('DSP output must be 0 or 1');
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Reflect.ownKeys(patch).some(key=>!['level','pan'].includes(key)))throw new TypeError('Invalid DSP return settings');
    const values={...patch},next={...this.readReturns()[output],...values};
    if(!Number.isInteger(next.level)||next.level<0||next.level>7)throw new RangeError('DSP Return level must be 0..7');
    if(!Number.isInteger(next.pan)||next.pan<0||next.pan>31)throw new RangeError('DSP Return Pan must be 0..31');
    const addresses=[22,54],previous=addresses.map(address=>typeof this.core.read==='function'?this.core.read(address):0);
    const returns=this.readReturns();returns[output]=next;
    try{for(let index=0;index<2;index++)this.core.write(addresses[index],this.#returnWord(returns[index]),0xff);}
    catch(error){
      const failures=[];
      for(let index=0;index<2;index++)try{this.core.write(addresses[index],previous[index],0xff);}catch(failure){failures.push(failure);}
      if(failures.length){const fatal=new Error('DSP return update failed and rollback could not restore the audio owner. Restart audio before continuing.',{cause:new AggregateError([error,...failures])});fatal.name='ScspDspRollbackError';fatal.fatal=true;throw fatal;}
      throw error;
    }
    if(output===0){this.settings={...this.settings,returnLevel:next.level};this.#returnPan=next.pan;}else this.#secondReturn={...next};
    this.#indexedReturns=true;return {...next};
  }
  /** Rebuild legacy preset routing; custom instructions remain session state. */
  resetReturns(){if(this.#indexedReturns)this.core.write(54,0,0xff);this.#returnPan=0;this.#secondReturn={level:0,pan:0};this.#indexedReturns=false;}
  readCoefficients() {
    return {codes: [this.#coef0, Math.floor(this.settings.feedback * 4096), this.#coef2], feedback: this.settings.feedback};
  }
  setCoefficients(patch) {
    const previous = this.readCoefficients().codes;
    const {keys, next, changed} = resolveCoefficientPatch(patch, previous);
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
  applyProgram(words, options) {
    const program = validateScspSynthDspProgram(words);
    const checkedOptions = validateScspDspProgramOptions(options);
    const coefficients = checkedOptions && resolveCoefficientPatch(checkedOptions.coefficients, this.readCoefficients().codes);
    const programChanged = !program.every((word, index) => word === this.#program[index]);
    const coefficientChanges = coefficients?.changed ?? [];
    const result = () => coefficients
      ? {...this.readProgram(), coefficients: this.readCoefficients()} : this.readProgram();
    if (!programChanged && !coefficientChanges.length) {
      // Explicit codes normalize Feedback even when its quantized word is equal.
      if (coefficients) this.settings = {...this.settings, feedback: coefficients.next[1] / 4096};
      return result();
    }
    const core = this.core;
    if ((core.read(0x402) & 0x1bf) !== (2 << 7)) {
      throw new Error('DSP Apply requires the existing RBP=0 / RBL=2 Delay ring');
    }
    const previous = this.#program;
    const ring = core.readRam(0, DSP_RAM_BYTES);
    const returnAddresses = this.#returnAddresses();
    const outputReturns = returnAddresses.map(address=>core.read(address));
    const coefficientWords = coefficientChanges.map(index => core.read(0x700 + index * 2));
    try {
      for(const address of returnAddresses)core.write(address,0,0xff);
      for (const index of coefficientChanges) core.write(0x700 + index * 2, coefficientWord(coefficients.next[index]));
      if (programChanged) this.#upload(program);
      this.clear();
      for(let index=0;index<returnAddresses.length;index++)core.write(returnAddresses[index],outputReturns[index],0xff);
    } catch (error) {
      const failures = [];
      // Make every restoration attempt before allowing the owner to resume.
      if (programChanged) {
        try { this.#upload(previous); } catch (failure) { failures.push(failure); }
      }
      for (let position = 0; position < coefficientChanges.length; position++) {
        try { core.write(0x700 + coefficientChanges[position] * 2, coefficientWords[position]); }
        catch (failure) { failures.push(failure); }
      }
      try { core.loadRam(ring, 0); } catch (failure) { failures.push(failure); }
      for(let index=0;index<returnAddresses.length;index++)try{core.write(returnAddresses[index],outputReturns[index],0xff);}catch(failure){failures.push(failure);}
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
    if (programChanged) this.#revision++;
    if (coefficients) {
      this.#coef0 = coefficients.next[0];
      this.#coef2 = coefficients.next[2];
      this.settings = {...this.settings, feedback: coefficients.next[1] / 4096};
    }
    return result();
  }
  install(){
    const core=this.core;
    for(const address of this.#returnAddresses())core.write(address,0,0xff);
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
    const returns=this.readReturns();
    for(const [index,address]of this.#returnAddresses().entries())this.core.write(address,this.#returnWord(returns[index]),0xff);
  }
  configure(patch){if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('Invalid DSP Delay settings');const next=effectSettings({...this.settings,...patch}),clear=next.enabled!==this.settings.enabled||next.timeMs!==this.settings.timeMs;this.settings=next;if(clear)this.clear();this.parameters();return {...next};}
  route(outputSlots,overrides){
    const sends=new Set(outputSlots);
    for(let slot=0;slot<32;slot++){
      const override=overrides?.[slot],value=this.settings.enabled?(override?(override.input<<3)|override.level:sends.has(slot)?this.settings.send:0):0;
      // Legacy source routes used a full word write; opt-in routes preserve
      // unrelated slot register bits with the hardware ISEL / IMXL mask.
      if(overrides)this.core.write(slot*32+20,value,0x7f);else this.core.write(slot*32+20,value);
    }
    this.parameters();
  }
}
