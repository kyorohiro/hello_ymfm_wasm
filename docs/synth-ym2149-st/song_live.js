// SPDX-License-Identifier: BSD-3-Clause
import {createDefaultPreset,readPreset} from './preset.js';
export function ymSongLiveView(snapshot,channel) {
  if(!Number.isInteger(channel)||channel<0||channel>2)throw new RangeError('Choose CH1–CH3');
  const r=snapshot?.registers;
  if(!Array.isArray(r)||r.length!==16||!r.every(value=>Number.isInteger(value)&&value>=0&&value<=255))
    throw new TypeError('Reference snapshot needs sixteen register bytes');
  const clock=snapshot.effectiveClock??snapshot.clock/((snapshot.flags??0)&16?2:1);
  if(!Number.isFinite(clock)||clock<=0)throw new RangeError('Invalid reference clock');
  const known=snapshot.registerKnown??Array(16).fill(0),preset=createDefaultPreset();
  preset.name=`Reference CH${channel+1}`;
  preset.voices=Array.from({length:3},(_,ch)=>({
    period:r[ch*2]|(r[ch*2+1]&15)<<8,tone:!(r[7]&(1<<ch)),noise:!(r[7]&(8<<ch)),volume:r[8+ch]&15,envelope:Boolean(r[8+ch]&16),
  }));
  preset.noisePeriod=r[6]&31;preset.envelope={period:r[11]|r[12]<<8,shape:r[13]&15};
  const voice=preset.voices[channel],required=[channel*2,channel*2+1,7,8+channel];
  if(voice.noise)required.push(6);
  if(voice.envelope)required.push(11,12,13);
  const reason=required.some(index=>!known[index])?'This channel has incomplete observed settings.':
    !(r[8+channel]&31)?'This channel is silent at this position. Pause while it is sounding to audition or capture.':
    !voice.tone&&!voice.noise&&!voice.envelope?'This is a direct volume / DAC level; its changing sample sequence is not a static instrument.':'';
  const frequency=known[channel*2]&&known[channel*2+1]?clock/(16*Math.max(1,voice.period)):null;
  return {preset:readPreset(preset),channel,clock,frequency,canCapture:!reason,canAudition:!reason,reason,
    activeChannels:[0,1,2].filter(ch=>Boolean(r[8+ch]&31)),
    description:`CH${channel+1} · ${voice.tone?'Tone':'Tone off'}${voice.noise?' + Noise':''} · ${voice.envelope?'shared envelope':`level ${voice.volume}`} · ${frequency===null?'pitch unknown':frequency.toFixed(2)+' Hz'} · register settings, not oscillator or envelope phase`};
}
/** Copy one static voice into the editable 2 MHz Synth, retaining shared FX.
 * It cannot reproduce a song's subsequent timer-based modulation or samples. */
export function captureYmSongVoice(snapshot,channel,{name=`Reference CH${channel+1}`}={}) {
  const view=ymSongLiveView(snapshot,channel);
  if(!view.canCapture)throw new Error(view.reason);
  const result=readPreset(view.preset),ratio=2000000/view.clock,voice={...result.voices[channel]};
  const period=(value,max)=>value===0&&ratio===1?0:Math.max(0,Math.min(max,Math.round(Math.max(1,value)*ratio)));
  voice.period=period(voice.period,4095);
  result.voices=Array.from({length:3},()=>({...voice}));
  result.noisePeriod=period(result.noisePeriod,31);
  result.envelope.period=period(result.envelope.period,65535);
  result.name=name.slice(0,120);
  return readPreset(result);
}
