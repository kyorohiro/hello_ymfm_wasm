// SPDX-License-Identifier: BSD-3-Clause
// Original mono-delay microprogram for the pinned SCSP DSP, not Web Audio DSP.
export const DSP_RAM_BYTES=65536; // RBL=2: 32K words at address 0.
export const EFFECT_DEFAULTS=Object.freeze({enabled:false,timeMs:240,feedback:.35,send:5,returnLevel:5});
export function effectSettings(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(EFFECT_DEFAULTS,k)))throw new TypeError('Invalid DSP Delay settings');
  const result={...EFFECT_DEFAULTS,...value};
  if(typeof result.enabled!=='boolean')throw new TypeError('DSP Enable must be boolean');
  if(!Number.isInteger(result.timeMs)||result.timeMs<20||result.timeMs>700)throw new RangeError('DSP Delay time must be 20..700 ms');
  if(!Number.isFinite(result.feedback)||result.feedback<0||result.feedback>.85)throw new RangeError('DSP Delay feedback must be 0..0.85');
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
  constructor(core,settings=EFFECT_DEFAULTS){this.core=core;this.settings=effectSettings(settings);this.install();}
  install(){
    const core=this.core;
    core.write(22,0,0xff); // Mute EFREG0 while replacing its program.
    for(let offset=0;offset<1024;offset+=2)core.write(0x800+offset,0);
    core.write(0x402,2<<7);
    core.write(0x700,0x7ff8); // 4095/4096, largest positive Q12 coefficient.
    core.write(0x704,0x2000); // MIXS -> ring scale: 1/4.
    core.write(0x782,0); // write address: DEC
    const program=delayProgram();
    for(let index=0;index<program.length;index++)if(program[index])core.write(0x800+index*2,program[index]);
    core.write(0xbf0,0); // Explicit Start after every instruction is uploaded.
    this.clear();this.parameters();
  }
  clear(){const silence=new Uint8Array(DSP_RAM_BYTES);for(let i=0;i<silence.length;i+=2)silence[i]=0x60;this.core.loadRam(silence,0);}
  parameters(){
    this.core.write(0x702,Math.floor(this.settings.feedback*4096)*8);
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
