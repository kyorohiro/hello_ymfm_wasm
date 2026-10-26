import {Ym2612VGM} from '../js/ym2612vgm.js?v=wonderswan-vgm-1';

// Write-driven base pitches, matching the pinned wswansound-derived core's
// 11-bit frequency, 32-nibble wavetable, mode priority and headphone gate.
// RAM harmonics, voice PCM and time-based sweep/noise are not transcribed.
export function createWonderSwanMonitor() {
  return {control:0, output:0, channels:Array.from({length:4},()=>({freq:0,volume:0,trigger:0}))};
}

export function applyWonderSwanWrite(state, register, value) {
  if (register >= 0 && register <= 0x1f) register += 0x80;
  value &= 255;
  if (register >= 0x80 && register <= 0x87) {
    const ch=state.channels[(register-0x80)>>1];
    ch.freq=register&1 ? (ch.freq&255)|((value&7)<<8) : (ch.freq&0x700)|value;
    return true;
  }
  if (register >= 0x88 && register <= 0x8b) {
    state.channels[register-0x88].volume=value;
    return true;
  }
  if (register === 0x90) {
    state.channels.forEach((ch,i)=>{if (!(state.control&(1<<i)) && (value&(1<<i))) ch.trigger++;});
    state.control=value;
    return true;
  }
  if (register === 0x91) {state.output=value&15;return true;}
  return false;
}

export function describeWonderSwanNotes(state, clock) {
  return state.channels.map((ch,index)=>{
    const type=index===1&&(state.control&0x20)?'Voice PCM'
      :index===2&&(state.control&0x40)?'Sweep'
      :index===3&&(state.control&0x80)?'Noise':'Wave';
    const enabled=Boolean(state.control&(1<<index));
    const audible=enabled && Boolean(state.output&8) && ch.volume!==0;
    const keyOn=audible && type==='Wave' && clock>0;
    const hz=clock/(32*(2048-ch.freq));
    const reason=!enabled?'Off':!(state.output&8)?'Output off':!ch.volume?'Silent':type!=='Wave'?type:null;
    return {name:`WonderSwan CH${index+1}`,type,reason,enabled,audible,keyOn,
      midi:keyOn?69+12*Math.log2(hz/440):null,freq:ch.freq,trigger:ch.trigger};
  });
}

export function extractWonderSwanNotes(source) {
  const warnings=new Map();
  const warn=text=>warnings.set(text,{count:(warnings.get(text)?.count??0)+1});
  const parser=new Ym2612VGM(source,{logger:{warn}});
  if (!parser.header.wonderswanClock || (parser.header.wonderswanClock&0xc0000000)) {
    throw new Error('WonderSwan Note-ish requires a single WonderSwan');
  }
  const state=createWonderSwanMonitor();
  const channels=Array.from({length:4},(_,i)=>({name:`WonderSwan CH${i+1}`,notes:[],active:null}));
  let time=0;
  const close=ch=>{if(ch.active&&time>ch.active.start)ch.notes.push({...ch.active,end:time});ch.active=null;};
  const writeRegister=(r,v)=>{
    if(!applyWonderSwanWrite(state,r,v))return;
    describeWonderSwanNotes(state,parser.header.wonderswanClock).forEach((note,i)=>{
      const ch=channels[i];
      if(ch.active&&note.keyOn&&ch.active.midi===note.midi&&ch.active.key===note.trigger)return;
      close(ch);
      if(note.keyOn)ch.active={start:time,midi:note.midi,key:note.trigger};
    });
  };
  const targets={wonderswan:{writeRegister,writeMemory(){}}};
  warn('WonderSwan wavetable base pitches only; CH2 voice PCM, CH3 sweep and CH4 noise intervals are omitted. Waveform harmonics and RAM rewriting are not inferred.');
  while(true){
    const event=parser.playStep(targets);
    if(event.type==='wait')parser.consumeWait(targets,event.samples,n=>{time+=n;});
    else if(event.type==='end')break;
  }
  channels.forEach(close);
  return {channels,warnings,time,parserHeader:parser.header};
}
