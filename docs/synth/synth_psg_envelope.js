// Software ADSR for this Synth, not a feature of the Sega PSG hardware.
// Its output is the PSG's real 4-bit attenuation register, never a gain effect.
export const SYNTH_PSG_ENVELOPE_DEFAULTS=Object.freeze({
  enabled:false,attackMs:10,decayMs:180,sustain:70,releaseMs:180,
});
const fields=Object.keys(SYNTH_PSG_ENVELOPE_DEFAULTS);
const integer=(value,max,name)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${name} must be an integer in range 0..${max}`);
  return value;
};
export function normalizeSynthPsgEnvelope(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Reflect.ownKeys(value).some(key=>!fields.includes(key)))throw new TypeError('Invalid PSG software envelope');
  const next={...SYNTH_PSG_ENVELOPE_DEFAULTS,...value};
  if(typeof next.enabled!=='boolean')throw new TypeError('PSG software envelope enabled must be a boolean');
  for(const key of ['attackMs','decayMs','releaseMs'])integer(next[key],5000,`PSG ${key}`);
  integer(next.sustain,100,'PSG sustain');
  return next;
}

/**
 * Sample-clock software control of the four hardware attenuators. ADSR is
 * linear in amplitude, then quantized to the chip's 2 dB steps. The authoring
 * attenuation is added to that envelope reduction; 15 always means silence.
 * Each Note On captures its own ADSR. Rendering checks levels about every 1 ms,
 * independent of main-thread timers, UI redraws and render block boundaries.
 */
export function createSynthPsgEnvelope({sampleRate,setAttenuation}={}) {
  if(typeof sampleRate!=='number'||!Number.isFinite(sampleRate)||sampleRate<=0||sampleRate>768000)throw new RangeError('Invalid PSG envelope sample rate');
  if(typeof setAttenuation!=='function')throw new TypeError('PSG envelope needs setAttenuation');
  const voices=new Map(),quantum=Math.max(1,Math.round(sampleRate/1000));
  let frame=0;
  const channel=value=>integer(value,3,'PSG envelope channel');
  const duration=ms=>Math.round(ms*sampleRate/1000);
  function levelAt(voice,time=frame) {
    if(voice.releaseFrame!==null) {
      const age=time-voice.releaseFrame;
      return voice.releaseFrames===0||age>=voice.releaseFrames?0:voice.releaseLevel*(1-age/voice.releaseFrames);
    }
    const age=time-voice.startFrame;
    if(age<voice.attackFrames)return age/voice.attackFrames;
    if(age<voice.attackFrames+voice.decayFrames)return 1-(1-voice.sustain)*(age-voice.attackFrames)/voice.decayFrames;
    return voice.sustain;
  }
  function writeLevel(voice) {
    const level=levelAt(voice),attenuation=level<=0?15:Math.min(15,voice.baseAttenuation+Math.round(-10*Math.log10(level)));
    if(attenuation!==voice.attenuation){voice.attenuation=attenuation;setAttenuation(voice.channel,attenuation);}
    if(voice.releaseFrame!==null&&(voice.releaseFrames===0||frame-voice.releaseFrame>=voice.releaseFrames))voices.delete(voice.channel);
  }
  function stop() {
    for(const voice of voices.values())setAttenuation(voice.channel,15);
    voices.clear();
  }
  return {
    noteOn(ch,value,baseAttenuation) {
      channel(ch);integer(baseAttenuation,15,'PSG attenuation');
      const envelope=normalizeSynthPsgEnvelope(value);
      if(!envelope.enabled){voices.delete(ch);setAttenuation(ch,baseAttenuation);return;}
      const voice={channel:ch,envelope,startFrame:frame,attackFrames:duration(envelope.attackMs),decayFrames:duration(envelope.decayMs),
        sustain:envelope.sustain/100,releaseFrames:duration(envelope.releaseMs),releaseFrame:null,releaseLevel:0,baseAttenuation,attenuation:null};
      voices.set(ch,voice);writeLevel(voice);
    },
    noteOff(ch) {
      channel(ch);const voice=voices.get(ch);if(!voice||voice.releaseFrame!==null)return false;
      voice.releaseLevel=levelAt(voice);voice.releaseFrame=frame;writeLevel(voice);return true;
    },
    setAttenuation(value) {
      integer(value,15,'PSG attenuation');
      for(const voice of voices.values()){voice.baseAttenuation=value;writeLevel(voice);}
    },
    stop,
    render(left,right,renderSegment) {
      if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length||typeof renderSegment!=='function')throw new TypeError('PSG envelope render needs equal stereo Float32Arrays and a renderer');
      if(!voices.size){renderSegment(left,right);frame+=left.length;return;}
      let offset=0;
      while(offset<left.length) {
        if(frame%quantum===0)for(const voice of voices.values())writeLevel(voice);
        const count=voices.size?Math.min(left.length-offset,quantum-frame%quantum):left.length-offset;
        renderSegment(left.subarray(offset,offset+count),right.subarray(offset,offset+count));
        frame+=count;offset+=count;
      }
    },
    snapshot:()=>({frame,quantum,voices:[...voices.values()].map(voice=>({channel:voice.channel,envelope:{...voice.envelope},
      level:levelAt(voice),baseAttenuation:voice.baseAttenuation,attenuation:voice.attenuation,released:voice.releaseFrame!==null}))}),
  };
}
