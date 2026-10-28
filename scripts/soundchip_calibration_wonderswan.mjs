/** Original WonderSwan wavetable reference. No game data, playback gain,
 * hidden normalization, or physical audio device is used by this module.
 */
const CLOCK = 3072000;
const FRAMES = 32;
const wave = Array.from({length:FRAMES}, (_, index) => index < FRAMES / 2
  ? Math.round(7.5 + 7.5 * Math.sin(2 * Math.PI * index / FRAMES)) : 0);
// Enforce exact half-wave symmetry instead of letting floating-point rounding
// give both zero crossings code8. The unsigned DAC midpoint is exactly7.5.
for (let index=0;index<FRAMES/2;index++) wave[index+FRAMES/2]=15-wave[index];
Object.freeze(wave);
const decodedSamples=Object.freeze(wave.map(value=>(value-7.5)/7.5));
const packedBytes=Object.freeze(Array.from({length:16},(_,index)=>wave[index*2]|wave[index*2+1]<<4));
const decodedReference=Object.freeze({
  inputPeak:1,codecHeadroom:1,decodedPeak:1,
  decodedMean:decodedSamples.reduce((sum,value)=>sum+value,0)/FRAMES,
  decodedRms:Math.sqrt(decodedSamples.reduce((sum,value)=>sum+value*value,0)/FRAMES),
  samples:FRAMES,decodedSamples,waveSamples:wave,packedBytes,
  codec:'WonderSwan unsigned four-bit wavetable',bitsPerSample:4,
  minimumCode:0,maximumCode:15,dacMidpoint:7.5,waveMean:7.5,
  channelVolumeLeft:15,channelVolumeRight:15,rawDacDivisor:1024,
  expectedRawDc:7.5*15/1024,expectedSpeakerAmplitude:7.5*15/1024,
  sourceClock:CLOCK,nativeTickRate:Math.floor(CLOCK/128),
});

/** One held wavetable channel, hardware volume15/15. Browser calibration
 * observes the existing speaker DC-centering boundary at unity Mixer gain.
 * A full0..15 waveform spans the entire DAC range: codecHeadroom is1, not
 * an additional correction for the unsigned midpoint or per-chip DAC scale.
 */
export function buildWonderSwanCalibrationReference(frequencyHz=440,{role='extra'}={}) {
  if(![220,440,880].includes(frequencyHz))throw new RangeError('WonderSwan reference frequency must be 220, 440 or 880 Hz');
  if(!['primary','extra'].includes(role))throw new RangeError('WonderSwan reference role must be primary or extra');
  const sourceId=role==='primary'?'wonderswan':'calibration-source';
  const period=Math.round(CLOCK/(FRAMES*frequencyHz));
  const prefix=role==='primary'?"const source=await useSoundChip('wonderswan');":`const source=await createSoundChip('wonderswan',{id:'${sourceId}'});`;
  return {
    kind:'wonderswan',waveform:'sine',frequencyHz,sourceId,role,defaultCalibration:true,
    warmupSeconds:0.2,captureSeconds:1,decodedReference,
    effectiveFrequencyHz:CLOCK/(FRAMES*period),
    setup:`${prefix}
context.calibrationSource=source;
await source.initialize();
await source.allNotesOff();
await source.setWaveform(0,${JSON.stringify(wave)});
await source.setVolume(0,15,15);
await source.setFrequency(0,${frequencyHz});
await source.keyOn(0);`,
    stop:'await context.calibrationSource.keyOff(0);',
    noteInfo:`Original32-sample sine, unsigned four-bit codes0..15 with exact mean7.5; CH0 only, hardware left/right volume15/15, headphones path, no sweep/noise/voice PCM. Period=${period} (~${CLOCK/(FRAMES*period)}Hz).`,
    limitations:[
      'Measures one held wavetable voice, not perceived loudness, four-voice polyphony, streamed PCM, sweep or noise.',
      'The raw core DAC is unipolar; the existing tick-aligned speaker boundary removes only the waveform mean. The measured half peak-to-peak amplitude already includes the four-bit DAC scale and needs no extra midpoint correction.',
      'The full0..15 input has reference peak1. The native24000Hz tick cadence and zero-order output hold remain in the measured output; this is not a hardware-accuracy or lossless-sine claim.',
    ],
  };
}
