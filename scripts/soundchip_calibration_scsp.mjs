/** Original full-range signed PCM16 sine. No game data or software gain. */
import {scspPitch} from '../web/scspsynth.js';
const frames=256;
const pcm=Object.freeze(Array.from({length:frames},(_,i)=>Math.round(32767*Math.sin(2*Math.PI*i/frames))));
const decoded=pcm.map(v=>v/32768);
const decodedReference=Object.freeze({inputPeak:1,codecHeadroom:1,decodedPeak:32767/32768,decodedMean:decoded.reduce((a,b)=>a+b,0)/frames,
  decodedRms:Math.sqrt(decoded.reduce((a,b)=>a+b*b,0)/frames),samples:frames,pcm,bitsPerSample:16,codec:'SCSP signed PCM16 big-endian',
  sourceSampleRate:44100,rootFrequencyHz:44100/frames,totalLevel:0,directLevel:7,pan:0,
  envelope:{attackRate:31,decay1Rate:0,decay2Rate:0,decayLevel:0,releaseRate:31,keyRateScaling:15}});
export function buildScspCalibrationReference(frequencyHz=440,{role='extra'}={}) {
  if(![220,440,880].includes(frequencyHz))throw new RangeError('SCSP reference frequency must be 220, 440 or 880 Hz');
  if(!['primary','extra'].includes(role))throw new RangeError('SCSP reference role must be primary or extra');
  const sourceId=role==='primary'?'scsp':'calibration-source';
  const prefix=role==='primary'?"const source=await useSoundChip('scsp');":`const source=await createSoundChip('scsp',{id:'${sourceId}'});`;
  return {kind:'scsp',waveform:'sine',frequencyHz,sourceId,role,defaultCalibration:true,decodedReference,
    effectiveFrequencyHz:scspPitch(frequencyHz/decodedReference.rootFrequencyHz).ratio*decodedReference.rootFrequencyHz,
    setup:`${prefix}
context.calibrationSource=source;
await source.reset({clearRam:true});
const wave=await source.loadPCM(new Int16Array(${JSON.stringify(pcm)}),{baseFrequencyHz:${decodedReference.rootFrequencyHz},loopStartSamples:0});
await source.setPreset(0,{sample:wave,frequencyHz:${frequencyHz},totalLevel:0,directLevel:7,pan:0,envelope:${JSON.stringify(decodedReference.envelope)}});
await source.keyOn(0);`,
    stop:'await context.calibrationSource.keyOff(0);',
    noteInfo:'Original 256-sample full-range signed PCM16 sine; slot0 only, forward loop, TL0 / DISDL7 / center, settled AR31 with no decay. Fixed 44100Hz core, existing host resampler; no DSP / FM / LFO.',
    limitations:['Single steady held PCM voice: this measures digital source units, not perceived loudness, polyphonic clipping or analogue Saturn output.',
      'No software output compensation or codec headroom correction. PCM16 quantization, OCT/FNS quantization, native interpolation and host resampling remain in the measured output.',
      'MAME envelope/panning approximations remain. This is not a hardware fidelity claim.']};
}
