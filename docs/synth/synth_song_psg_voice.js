import {SEGAPSG_CLOCK} from '../js/segapsg.js?v=audio-numeric-bindings-1';
import {createPsgPreset} from './synth_psg_preset.js?v=psg-live-1';
import {SYNTH_PSG_ENVELOPE_DEFAULTS} from './synth_psg_envelope.js?v=psg-envelope-1';

const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;

/** A captured hardware setting, never a running software envelope or song chip. */
function capturedSettings(snapshot,channel) {
  if(snapshot?.kind!=='segapsg'||!Number.isFinite(snapshot.clockHz)||snapshot.clockHz<=0||
    !integer(channel,3)||!snapshot.channels?.[channel])throw Error('No Sega PSG channel snapshot.');
  const voice=snapshot.channels[channel],preset=voice.preset;
  if(voice.channel!==channel||voice.source!==(channel===3?'noise':'tone')||
    !preset||preset.source!==voice.source||!integer(voice.attenuation,15)||!integer(voice.lastAttenuation,15)||
    !['white','periodic'].includes(preset.noiseType)||!['low','medium','high','tone3'].includes(preset.noiseRate)) {
    throw Error('Invalid Sega PSG channel settings.');
  }
  if(channel<3&&(!integer(voice.period,1023)||voice.period<=1||voice.constantOutput))throw Error('This PSG tone has constant output, not a transposable pitch.');
  if(channel===3&&preset.noiseRate==='tone3'&&(!integer(voice.period,1023)||voice.period<=1))throw Error('Noise has no running Tone 3 clock for keyboard audition.');
  if(channel===3&&preset.noiseRate!=='tone3'&&snapshot.clockHz!==SEGAPSG_CLOCK) {
    throw Error('This fixed-noise clock differs from the Synth PSG clock; keyboard audition and Copy are unavailable.');
  }
  const attenuation=voice.attenuation<15?voice.attenuation:voice.lastAttenuation;
  if(attenuation===15)throw Error('This PSG channel has not had an audible volume setting.');
  // The VGM may implement its own envelope by writing attenuation repeatedly.
  // A single snapshot cannot reconstruct that program as a Synth ADSR.
  return createPsgPreset({source:preset.source,attenuation,noiseType:preset.noiseType,noiseRate:preset.noiseRate,
    envelope:{...SYNTH_PSG_ENVELOPE_DEFAULTS,enabled:false}}).settings;
}

export function describeSynthPsgSongVoice(snapshot,channel) {
  try {
    const settings=capturedSettings(snapshot,channel);
    return {playable:true,reason:'',channel,source:settings.source,attenuation:settings.attenuation};
  } catch(error) {return {playable:false,reason:error.message,channel};}
}

/** Copy one detached hardware sound; source bytes and the editor stay untouched. */
export function createSynthPsgSongCopyPreset(snapshot,channel) {
  return createPsgPreset(capturedSettings(snapshot,channel));
}

/**
 * Monophonic audition on a separate keyboard PSG endpoint. Configure it once
 * per paused channel/snapshot; no reference engine is passed to this helper.
 */
export function createSynthPsgSongVoice(psg,snapshot,channel,{getPitchClock=()=>7670454}={}) {
  const settings=capturedSettings(snapshot,channel);
  if(typeof getPitchClock!=='function'||['setFrequency','setAttenuation','setNoise','allNotesOff'].some(name=>typeof psg?.[name]!=='function')) {
    throw TypeError('PSG audition needs a keyboard endpoint and pitch clock.');
  }
  const pitch=(block,fnum)=>{
    const clock=getPitchClock();
    if(!integer(block,7)||!integer(fnum,2047)||fnum===0||!Number.isFinite(clock)||clock<=0)throw RangeError('Invalid PSG keyboard pitch.');
    return fnum*clock*2**(block-1)/(144*2**20);
  };
  const setPitch=(block,fnum)=>{
    const hz=pitch(block,fnum);
    if(settings.source==='tone')return psg.setFrequency(channel,hz);
    if(settings.noiseRate==='tone3') {psg.setAttenuation(2,15);return psg.setFrequency(2,hz);}
    return null;
  };
  let held=false;
  psg.stopEnvelopes?.();psg.allNotesOff();
  return {
    ...describeSynthPsgSongVoice(snapshot,channel),
    getChannels:()=>[channel],
    setFrequency(_channel,block,fnum) {return setPitch(block,fnum);},
    noteOn(_channel,block,fnum) {
      pitch(block,fnum); // Reject invalid input before muting or writing pitch.
      psg.setAttenuation(channel,15);
      const period=setPitch(block,fnum);
      if(settings.source==='noise')psg.setNoise({type:settings.noiseType,rate:settings.noiseRate});
      psg.setAttenuation(channel,settings.attenuation);held=true;
      return {channel,period};
    },
    noteOff() {
      if(!held)return false;
      psg.setAttenuation(channel,15);held=false;return true;
    },
  };
}
