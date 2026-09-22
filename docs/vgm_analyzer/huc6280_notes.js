import {Ym2612VGM} from '../js/ym2612vgm.js';

// Register-derived base pitch only. Mode priority and attenuation follow the
// pinned MAME c6280 core in third_party/mame-huc6280/upstream/c6280.cpp.
const SCALE = [0,3,5,7,9,11,13,15,16,19,21,23,25,27,29,31];
export function createHuc6280Monitor() {
  return {selected:0, balance:0, lfoControl:0, channels:Array.from({length:8},()=>({
    freq:0, control:0, balance:0, noise:0, trigger:0,
  }))};
}

export function applyHuc6280Write(state, register, value) {
  register &= 15; value &= 255;
  const ch = state.channels[state.selected];
  switch (register) {
    case 0: state.selected = value & 7; return false;
    case 1: state.balance = value; return true;
    case 2: ch.freq = (ch.freq & 0xf00) | value; return true;
    case 3: ch.freq = (ch.freq & 255) | ((value & 15) << 8); return true;
    case 4:
      if (!(ch.control & 128) && (value & 128)) ch.trigger++;
      ch.control = value;
      return true;
    case 5: ch.balance = value; return true;
    case 7: ch.noise = value; return true;
    case 9: state.lfoControl = value; return true;
    // Waveform/DDA data and LFO speed do not determine a normal base note.
    default: return false;
  }
}

export function describeHuc6280Notes(state, clock) {
  return state.channels.slice(0,6).map((ch,index)=>{
    const mode = index >= 4 && (ch.noise & 128) ? 'Noise'
      : ch.control & 64 ? 'PCM/DDA'
      : index < 2 && (state.lfoControl & 3) ? 'LFO' : 'Wave';
    const enabled = Boolean(ch.control & 128);
    const attenuation = shift => 31-SCALE[(state.balance >>> shift)&15]
      + 31-SCALE[(ch.balance >>> shift)&15] + 31-(ch.control & 31);
    const audible = enabled && (attenuation(4)<31 || attenuation(0)<31);
    const keyOn = audible && mode === 'Wave' && clock > 0;
    const hz = clock / (32 * (ch.freq || 4096));
    const reason = !enabled ? 'Off' : !audible ? 'Silent' : mode !== 'Wave' ? mode : null;
    return {name:`HuC6280 CH${index+1}`,type:mode,reason,enabled,audible,keyOn,
      midi:keyOn ? 69+12*Math.log2(hz/440) : null, freq:ch.freq,trigger:ch.trigger};
  });
}

// Song view uses the same mode/pitch rules as the live monitor. PCM stream
// writes select and restore the channel exactly as the playback adapter does.
export function extractHuc6280Notes(source) {
  const warnings = new Map();
  const warn = text => warnings.set(text,{count:(warnings.get(text)?.count ?? 0)+1});
  const parser = new Ym2612VGM(source,{logger:{warn}});
  if (!parser.header.huc6280Clock || (parser.header.huc6280Clock & 0xc0000000)) {
    throw new Error('HuC6280 Note-ish requires a single HuC6280');
  }
  const state = createHuc6280Monitor();
  const channels = Array.from({length:6},(_,i)=>({name:`HuC6280 CH${i+1}`,notes:[],active:null}));
  let time = 0;
  const close = ch => {
    if (ch.active && time > ch.active.start) ch.notes.push({...ch.active,end:time});
    ch.active = null;
  };
  const writeRegister = (r,v) => {
    if (!applyHuc6280Write(state,r,v)) return;
    describeHuc6280Notes(state,parser.header.huc6280Clock).forEach((note,i)=>{
      const ch=channels[i];
      if (ch.active && note.keyOn && ch.active.midi===note.midi && ch.active.key===note.trigger) return;
      close(ch);
      if (note.keyOn) ch.active={start:time,midi:note.midi,key:note.trigger};
    });
  };
  const targets={huc6280:{writeRegister,writeStream(port,register,value){
    const selected=state.selected;
    if(port!==255)writeRegister(register>>>4,port);
    writeRegister(register&15,value);
    if(port!==255)writeRegister(register>>>4,selected);
  }}};
  warn('HuC6280 base pitch only; PCM/DDA, noise and LFO CH1/CH2 intervals are omitted. Waveform timbre and PCM pitch are not inferred.');
  while (true) {
    const event=parser.playStep(targets);
    if(event.type==='wait')parser.consumeWait(targets,event.samples,n=>{time+=n;});
    else if(event.type==='end')break;
  }
  channels.forEach(close);
  return {channels,warnings,time,parserHeader:parser.header};
}
