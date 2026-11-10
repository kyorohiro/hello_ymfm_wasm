// Host keyboard adapter for the existing Sega PSG API. All sound remains in
// that chip: three square-wave tones or its single noise generator.
import {SYNTH_PSG_ENVELOPE_DEFAULTS,normalizeSynthPsgEnvelope} from './synth_psg_envelope.js?v=psg-envelope-1';

export const SYNTH_PSG_DEFAULTS=Object.freeze({
  source:'tone',attenuation:6,noiseType:'white',noiseRate:'medium',
  envelope:SYNTH_PSG_ENVELOPE_DEFAULTS,
});
const fields=Object.keys(SYNTH_PSG_DEFAULTS);
const integer=(value,max,name)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${name} must be an integer in range 0..${max}`);
  return value;
};
function settingsObject(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Reflect.ownKeys(value).some(key=>!fields.includes(key)))throw new TypeError('Invalid PSG settings');
  return value;
}

/** Detached JSON settings; noise names follow the existing PSG API. Rate codes
 * low/medium/high are respectively clock/512, /1024 and /2048, not note names.
 */
export function normalizeSynthPsgSettings(value={}) {
  const next={...SYNTH_PSG_DEFAULTS,...settingsObject(value)};
  if(!['tone','noise'].includes(next.source))throw new RangeError('PSG source must be tone or noise');
  integer(next.attenuation,15,'PSG attenuation');
  if(!['white','periodic'].includes(next.noiseType))throw new RangeError('PSG noise type must be white or periodic');
  if(!['low','medium','high','tone3'].includes(next.noiseRate))throw new RangeError('Invalid PSG noise clock');
  next.envelope=normalizeSynthPsgEnvelope(next.envelope);
  return next;
}

/**
 * A pure keyboard target. Tone uses caller-allocated physical channels 0..2;
 * noise always uses physical channel 3. The host clears its held-key ownership
 * when changing source. A source change also silences all PSG voices here.
 * No register is written until an explicit note, setting edit on a held voice,
 * or stop; preparing the editor alone cannot start a loud default tone.
 */
export function createSynthPsgVoice({getPsg,getPitchClock=()=>7670454,onState=()=>{},onCommand=()=>{},settings={}}={}) {
  if([getPsg,getPitchClock,onState,onCommand].some(callback=>typeof callback!=='function'))throw new TypeError('PSG callbacks must be functions');
  let current=normalizeSynthPsgSettings(settings);
  const held=new Map();
  const getSettings=()=>({...current,envelope:{...current.envelope}});
  const getState=()=>({settings:getSettings(),heldChannels:[...held.keys()].sort((a,b)=>a-b),
    voices:[...held.values()].sort((a,b)=>a.channel-b.channel).map(voice=>({...voice}))});
  const emit=()=>onState(getState());
  const channel=value=>{
    integer(value,3,'PSG channel');
    if(current.source==='tone'&&value===3||current.source==='noise'&&value!==3)throw new RangeError('PSG tone uses channels 0..2; noise uses channel 3');
    return value;
  };
  function pitch(block,fnum) {
    integer(block,7,'Keyboard block');integer(fnum,2047,'Keyboard fnum');
    const clock=getPitchClock();
    if(!fnum||typeof clock!=='number'||!Number.isFinite(clock)||clock<=0)throw new RangeError('PSG keyboard pitch requires a positive fnum and finite clock');
    return {block,fnum,frequencyHz:fnum*clock*2**(block-1)/(144*2**20)};
  }
  function setPitch(psg,ch,note) {
    if(current.source==='tone')return psg.setFrequency(ch,note.frequencyHz);
    if(current.noiseRate==='tone3')return psg.setFrequency(2,note.frequencyHz);
    return null;
  }
  function silence() {
    const psg=getPsg();
    psg?.stopEnvelopes?.();
    if(psg)for(let ch=0;ch<4;ch++)psg.setAttenuation(ch,15);
    held.clear();
  }
  return {
    getSettings,getState,
    getChannels:()=>current.source==='tone'?[0,1,2]:[3],
    noteOn(ch,block,fnum) {
      channel(ch);const note=pitch(block,fnum),psg=getPsg();if(!psg)return null;
      if(current.envelope.enabled&&typeof psg.envelopeNoteOn!=='function')throw new Error('PSG Software Envelope requires its audio endpoint');
      // Tone3 is only the clock when noise tracks keyboard pitch. Its square
      // wave stays muted, including during a live switch to this clock.
      if(current.source==='noise'&&current.noiseRate==='tone3')psg.setAttenuation(2,15);
      const period=setPitch(psg,ch,note);
      if(current.source==='noise')psg.setNoise({type:current.noiseType,rate:current.noiseRate});
      if(current.envelope.enabled)psg.envelopeNoteOn(ch,current.envelope,current.attenuation);
      else psg.setAttenuation(ch,current.attenuation);
      const voice={channel:ch,...note,period};held.set(ch,voice);
      onCommand({type:'noteOn',channel:ch,block,fnum});emit();return {...voice};
    },
    noteOff(ch) {
      integer(ch,3,'PSG channel');
      // A stale physical Note Off is harmless after a source switch. The host
      // remains responsible for distinguishing stolen notes on one channel.
      if(!held.has(ch))return false;
      const psg=getPsg();
      if(current.envelope.enabled)psg?.envelopeNoteOff(ch);
      else psg?.setAttenuation(ch,15);
      held.delete(ch);onCommand({type:'noteOff',channel:ch});emit();return true;
    },
    setFrequency(ch,block,fnum) {
      channel(ch);const note=pitch(block,fnum),psg=getPsg();if(!psg)return null;
      const period=setPitch(psg,ch,note),voice={channel:ch,...note,period};
      onCommand({type:'setFrequency',channel:ch,block,fnum});
      if(held.has(ch)){held.set(ch,voice);emit();}
      return {...voice};
    },
    stop() {silence();onCommand({type:'stop'});emit();},
    setSettings(patch) {
      settingsObject(patch);
      if(Object.hasOwn(patch,'envelope'))normalizeSynthPsgEnvelope(patch.envelope);
      const next=normalizeSynthPsgSettings({...current,...patch,envelope:Object.hasOwn(patch,'envelope')
        ?{...current.envelope,...patch.envelope}:current.envelope});
      if(fields.every(key=>key==='envelope'
        ?Object.keys(next.envelope).every(field=>next.envelope[field]===current.envelope[field])
        :next[key]===current[key]))return getSettings();
      const previous=current;
      if(next.source!==previous.source||next.envelope.enabled!==previous.envelope.enabled)silence();
      current=next;
      const psg=getPsg();
      if(psg&&held.size) {
        if(current.source==='noise'&&(current.noiseRate!==previous.noiseRate||current.noiseType!==previous.noiseType)) {
          if(current.noiseRate==='tone3') {
            psg.setAttenuation(2,15);
            const voice=held.get(3);voice.period=psg.setFrequency(2,voice.frequencyHz);
          } else held.get(3).period=null;
          // The real noise control resets its LFSR; attenuation alone does not.
          psg.setNoise({type:current.noiseType,rate:current.noiseRate});
        }
        if(!current.envelope.enabled&&current.attenuation!==previous.attenuation)for(const ch of held.keys())psg.setAttenuation(ch,current.attenuation);
      }
      // Released envelopes are no longer held keys, but their hardware level
      // must follow the same base attenuation until their release ends.
      if(psg&&current.envelope.enabled&&current.attenuation!==previous.attenuation)psg.setEnvelopeAttenuation(current.attenuation);
      onCommand({type:'setSettings',settings:getSettings()});emit();return getSettings();
    },
  };
}
