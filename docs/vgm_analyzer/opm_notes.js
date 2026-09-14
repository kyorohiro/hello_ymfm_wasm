import {createOpmState} from './opm_monitor.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
// Nominal equal-tempered base pitch, not the modulated operator output.
// KC gaps follow src/ymfm_fm.ipp opm_key_code_to_phase_step (code - code/4).
export function opmPitch(kc, kf, clock) {
  if (!(clock > 0)) return null;
  const code = kc & 15;
  return 13 + ((kc >> 4) & 7) * 12 + code - (code >> 2) + (kf & 63) / 64 + 12 * Math.log2(clock / 3579545);
}
export function createOpmNoteTracker(clock, changed = () => {}) {
  const regs = new Uint8Array(256), masks = new Uint8Array(8);
  let serial = 0;
  const channels = Array.from({length:8}, () => ({midi:null,keyOn:false,key:0,reason:null,kc:0,kf:0}));
  function update(ch, sample, retrigger = false) {
    const mask = masks[ch], kc = regs[0x28+ch] & 127, kf = regs[0x30+ch] >> 2;
    const reason = regs[0x14] & 128 ? 'CSM' : ch === 7 && (regs[15] & 128) ? 'Noise' : mask && mask !== 15 ? 'Partial key mask' : null;
    const old = channels[ch];
    const next = {kc,kf,keyOn:mask !== 0,midi:mask && !reason ? opmPitch(kc,kf,clock) : null,reason,key:retrigger ? ++serial : old.key};
    channels[ch] = next;
    if (retrigger || next.midi !== old.midi || next.keyOn !== old.keyOn || next.reason !== old.reason) changed(ch,next,sample);
  }
  return {
    channels,
    reset() { regs.fill(0);masks.fill(0);serial=0;for(let i=0;i<8;i++)channels[i]={midi:null,keyOn:false,key:0,reason:null,kc:0,kf:0}; },
    write(r,v,sample) {
      regs[r & 255] = v & 255;
      if (r === 8) {const ch=v&7, before=masks[ch]; masks[ch]=(v>>3)&15;update(ch,sample,before===0 && masks[ch]!==0);}
      else if (r >= 0x28 && r <= 0x37) update(r&7,sample);
      else if (r === 15) update(7,sample);
      else if (r === 0x14) for(let ch=0;ch<8;ch++)update(ch,sample);
    },
  };
}
export function extractOpmNotes(source, {includeVoices = false} = {}) {
  const parser = new Ym2612VGM(source);
  const clock = parser.header.ym2151Clock & 0x3fffffff;
  if (!clock) throw new Error('YM2151 clock required');
  if (parser.header.ym2151Clock & 0xc0000000) throw new Error('Dual/variant YM2151 Note-ish is not supported');
  let time=0;
  const voiceState = includeVoices ? createOpmState(() => 0) : null;
  const voices = [], voiceIds = new Map();
  const channels=Array.from({length:8},()=>({notes:[],active:null}));
  const finish=(ch,end,reason)=>{if(ch.active){ch.notes.push({...ch.active,end,endReason:reason});ch.active=null;}};
  const tracker=createOpmNoteTracker(clock,(index,state,sample)=>{
    const ch=channels[index];finish(ch,sample,'pitch');
    if(state.midi !== null) {
      let preset;
      if (voiceState) {
        const voice = voiceState.snapshot().channels[index];
        const patch = {algorithm:voice.algorithm,feedback:voice.feedback,operators:voice.operators.map(({key,slot,...op})=>op)};
        const signature = JSON.stringify(patch);
        if (!voiceIds.has(signature)) {voiceIds.set(signature, voices.length);voices.push(patch);}
        preset = voiceIds.get(signature);
      }
      ch.active={start:sample,midi:state.midi,key:state.key,...(includeVoices ? {preset} : {})};
    }
  });
  const targets={ym2151:{writeRegister:(r,v)=>{voiceState?.write(r,v);tracker.write(r,v,time);}}};
  while(true){const event=parser.playStep(targets);if(event.type==='wait')parser.consumeWait(targets,event.samples,n=>{time+=n;});else if(event.type==='end')break;}
  for(const ch of channels)finish(ch,time,'vgmEnd');
  return {channels,time,...(includeVoices ? {voices} : {})};
}
