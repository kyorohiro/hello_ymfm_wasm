/** Original held POKEY pure-tone reference. No game data, Mixer gain,
 * normalization or audio device is used by this module. POKEY has no sine
 * wavetable: distortion5 is a square, so its shape is declared explicitly.
 */
const CLOCK = 1789790;
const DUAL_CLOCK = 1789773;
const ROLES = ['primary','dual-first','dual-second','extra'];
const decodedReference = Object.freeze({
  inputPeak:1,codecHeadroom:1,decodedPeak:1,decodedMean:0,decodedRms:1,
  samples:2,decodedSamples:Object.freeze([-1,1]),
  codec:'POKEY distortion5 pure square tone',bitsPerVolume:4,
  hardwareVolume:15,distortion:5,volumeOnly:false,audctl:0x50,skctl:3,
  channel:1,helperChannel:0,joinedPair:0,highClock:true,
  rawDacStep:744/32768,expectedRawMinimum:0,expectedRawMaximum:15*744/32768,
  expectedRawDc:15*744/65536,nominalCenteredAmplitude:15*744/65536,
  speakerDcBlockerHz:10,
});

export function buildPokeyCalibrationReference(frequencyHz=440,{role='extra'}={}) {
  if(![220,440,880].includes(frequencyHz))throw new RangeError('POKEY reference frequency must be 220, 440 or 880 Hz');
  if(!ROLES.includes(role))throw new RangeError('POKEY reference role must be primary, dual-first, dual-second or extra');
  const dual=role.startsWith('dual-'),clock=dual?DUAL_CLOCK:CLOCK;
  const sourceId=role==='extra'?'calibration-source':role==='dual-second'?'pokey:2':'pokey';
  const prefix=role==='extra'?"const source=await createSoundChip('pokey',{id:'calibration-source'});":`const source=${role==='dual-second'?'pokey2':'pokey'};`;
  const period=Math.round(clock/(2*frequencyHz)-7);
  return {
    kind:'pokey',waveform:'square',frequencyHz,sourceId,role,mode:dual?'pokey-dual':role==='primary'?'pokey':'genesis',
    defaultCalibration:true,warmupSeconds:0.2,captureSeconds:1,clock,period,decodedReference,
    effectiveFrequencyHz:clock/(2*(period+7)),
    setup:`${prefix}
context.calibrationSource=source;
await source.initialize();
await source.allNotesOff();
await source.setHighClock(0,true);
await source.setJoined(0,true);
await source.setDistortion(1,5);
await source.setVolumeOnly(1,false);
await source.setVolume(1,15);
await source.setFrequency(1,${frequencyHz});
await source.writeRegister(9,0);
await source.keyOn(1);`,
    stop:'await context.calibrationSource.keyOff(1);',
    noteInfo:`Original distortion5 square, one held joined high-clock voice on physical CH1 (zero-based), silent CH0 timer helper; hardware volume15, SKCTL3, AUDCTL0x50, STIMER. Clock=${clock}, period=${period} (~${clock/(2*(period+7))}Hz).`,
    limitations:[
      'POKEY cannot generate a programmable sine. This explicit square reference is not a sine or perceived-loudness comparison; it measures one held voice, not noise, four-voice polyphony or clipped multi-channel mixes.',
      'The raw core retains the unipolar legacy DAC scale744/32768 per hardware volume step. Its existing speaker-only10Hz DC blocker remains in the measured output; no midpoint, square-RMS or filter correction is applied by this reference.',
      'Two joined physical timers form one tone. Dual mode uses two independent chips at1789773Hz, whereas standalone and additional chips use1789790Hz. A two-chip sum requires host headroom and is not normalized here.',
    ],
  };
}

/** Live square-family anchor. Its current System Mixer setting is recorded
 * separately before the runner captures source-unity PCM. The reference
 * itself neither installs nor changes any listening gain.
 */
export function buildPokeyPsgBalanceReference(){
  const clock=3579545,frequencyHz=440,period=Math.round(clock/(32*frequencyHz));
  return {
    kind:'segapsg',role:'primary',mode:'genesis',sourceId:'segapsg',waveform:'square',frequencyHz,clock,period,
    effectiveFrequencyHz:clock/(32*period),
    setup:"const source=psg;\ncontext.calibrationSource=source;\nawait source.allNotesOff();\nawait source.tone(0,{frequency:440,attenuation:0});",
    stop:'await context.calibrationSource.allNotesOff();',
    noteInfo:`Existing Genesis Sega PSG, CH0 pure square at attenuation0, period${period}; all other voices off. Its current System listening setting is recorded, then captured at source unity.`,
    limitations:['A live square-family listening anchor, not a new PSG calibration or a change to its existing gain.'],
  };
}
