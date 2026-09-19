import {Ym2612VGM} from '../js/ym2612vgm.js';
export function createNesMonitor(){return {enabled:0,registers:new Uint8Array(32),channels:Array.from({length:3},()=>({freq:0,trigger:0,keyOn:false}))};}
export function applyNesWrite(state,register,value){
  if(register>31)return false;
  state.registers[register]=value;
  if(register===0x15)state.enabled=value;
  state.channels.forEach((ch,i)=>{
    const base=i*4;
    ch.freq=state.registers[base+2]|((state.registers[base+3]&7)<<8);
    if(register===base+3 && (state.enabled&(1<<i))){ch.keyOn=true;ch.trigger++;}
    if(!(state.enabled&(1<<i)))ch.keyOn=false;
  });
  return true;
}
export function describeNesNotes(state,clock=1789773){
  return state.channels.map((ch,i)=>{
    const control=state.registers[i*4];
    const audible=ch.keyOn && (i===2 ? (control&127)>0 && ch.freq>1 : ch.freq>=8 && (!(control&16)||(control&15)>0));
    return {name:`NES CH${i+1}`,type:i===2?'Triangle':'Pulse',freq:ch.freq,trigger:ch.trigger,keyOn:audible,midi:audible?69+12*Math.log2(clock/((i===2?32:16)*(ch.freq+1))/440):null};
  });
}
export function extractNesNotes(source){
  const warnings=new Map(),warn=text=>warnings.set(text,{count:(warnings.get(text)?.count??0)+1});
  const parser=new Ym2612VGM(source,{logger:{warn}}),state=createNesMonitor();
  if(parser.header.nesApuClock & 0xc0000000)throw new Error('NES dual/FDS variants are not supported');
  const channels=Array.from({length:3},(_,i)=>({name:`NES CH${i+1}`,notes:[],active:null}));let time=0;
  const close=ch=>{if(ch.active)ch.notes.push({...ch.active,end:time});ch.active=null;};
  const targets={nesApu:{writeRegister:(r,v)=>{
    if(r>31)throw new Error('FDS registers are not supported');
    applyNesWrite(state,r,v);
    describeNesNotes(state,parser.header.nesApuClock & 0x3fffffff).forEach((n,i)=>{
      const ch=channels[i];if(ch.active&&n.keyOn&&ch.active.midi===n.midi&&ch.active.key===n.trigger)return;
      close(ch);if(n.keyOn)ch.active={start:time,midi:n.midi,key:n.trigger};
    });
  }}};
  warn('NES noise/DMC omitted from pitched notes; length, envelope, sweep and triangle linear-counter timing are not reconstructed.');
  while(true){const event=parser.playStep(targets);if(event.type==='wait')parser.consumeWait(targets,event.samples,n=>time+=n);else if(event.type==='end')break;}
  channels.forEach(close);return {channels,warnings,time,parserHeader:parser.header};
}
