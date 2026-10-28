/** Original, deterministic PS1 SPU output-unit reference. This is deliberately
 * separate from the quiet starter instrument and does not set Mixer gains.
 * No console BIOS, game data, PCM encoder, or physical audio device is used.
 */
const SOURCE_FRAMES = 112;
const NATIVE_RATE = 44100;
const adpcm = new Uint8Array(64);
const signedCodes = Array.from({length:SOURCE_FRAMES}, (_,i) => Math.round(7*Math.sin(2*Math.PI*i/SOURCE_FRAMES))||0);
for (let block=0;block<4;block++) {
  adpcm[block*16]=0; // Predictor/filter 0, shift 0: signed nibble * 4096.
  adpcm[block*16+1]=block===0?6:block===3?3:0; // LOOP START; final END+LOOP.
  for(let pair=0;pair<14;pair++) {
    const index=block*28+pair*2;
    adpcm[block*16+2+pair]=(signedCodes[index]&15)|((signedCodes[index+1]&15)<<4);
  }
}
const decodedSamples=Object.freeze(signedCodes.map(value=>value/8));
const decodedReference=Object.freeze({
  inputPeak:1,codecHeadroom:7/8,decodedPeak:7/8,
  decodedMean:decodedSamples.reduce((sum,value)=>sum+value,0)/SOURCE_FRAMES,
  decodedRms:Math.sqrt(decodedSamples.reduce((sum,value)=>sum+value*value,0)/SOURCE_FRAMES),
  samples:SOURCE_FRAMES,decodedSamples,adpcmBytes:Object.freeze([...adpcm]),
  codec:'PS1 SPU ADPCM',predictor:0,shift:0,packetBytes:16,packetFrames:28,
  loopStartSamples:0,sourceSampleRate:NATIVE_RATE,
  baseFrequencyHz:NATIVE_RATE/SOURCE_FRAMES,
});

/** Public Playground source strings. The runner applies unity Mixer gain,
 * warms up >=0.2 s, captures 1 s, and stops the held voice afterward.
 * role=primary measures the existing PS1-mode source; extra allocates one
 * independent SPU with the same reference, without changing core output units.
 */
export function buildPs1CalibrationReference(frequencyHz=440,{role='extra'}={}) {
  if(![220,440,880].includes(frequencyHz))throw new RangeError('PS1 reference frequency must be 220, 440 or 880 Hz');
  if(!['primary','extra'].includes(role))throw new RangeError('PS1 reference role must be primary or extra');
  const sourceId=role==='primary'?'ps1':'calibration-source';
  const pitch=Math.round(4096*frequencyHz/(NATIVE_RATE/SOURCE_FRAMES));
  const prefix=role==='primary'?"const source=await useSoundChip('ps1');":`const source=await createSoundChip('ps1',{id:'${sourceId}'});`;
  return {
    kind:'ps1',waveform:'sine',frequencyHz,sourceId,role,defaultCalibration:true,
    warmupSeconds:0.2,captureSeconds:1,decodedReference,
    effectiveFrequencyHz:pitch*NATIVE_RATE/(4096*SOURCE_FRAMES),
    setup:`${prefix}
context.calibrationSource=source;
await source.reset({clearRam:true});
await source.setReverb({preset:'off',volumeLeft:0,volumeRight:0});
const sample=await source.loadADPCM(new Uint8Array(${JSON.stringify([...adpcm])}),{baseFrequencyHz:${NATIVE_RATE/SOURCE_FRAMES},loopStartSamples:0});
await source.setPreset(0,{sample,volumeLeft:1,volumeRight:1,adsr1:0x000f,adsr2:0,reverb:false});
await source.setFrequency(0,${frequencyHz});
await source.keyOn(0);`,
    stop:'await context.calibrationSource.keyOff(0);',
    noteInfo:`Original looping112-frame sine, filter0/shift0 signed codes -7..7 (decoded peak0.875); voice0 volumeL/R1, masterL/R0x3fff, fastest linear attack/full sustain, no reverb; PITCH=${pitch} (~${pitch*NATIVE_RATE/(4096*SOURCE_FRAMES)}Hz).`,
    limitations:[
      'Measures a single held reference voice, not perceived loudness, authored sample amplitude or polyphony. The starter uses shift4 and is deliberately sixteen times quieter at the codec input.',
      'ADPCM quantization, the pinned experimental SPU interpolation/envelope/master scaling and Float32 conversion remain in the measured output. This is not lossless unity PCM or a hardware accuracy claim.',
      'The native SPU rate is44100Hz. Browser output at48000Hz uses the existing streaming linear resampler and is measured separately.',
    ],
  };
}
