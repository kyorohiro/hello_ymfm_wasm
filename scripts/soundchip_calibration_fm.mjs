/** Public Playground programs for measuring steady single-carrier amplitude.
 * These references do not change Mixer/master gains, infer musical loudness,
 * or compensate polyphony. Capture after attack settling and remove DC. */
export const FM_CALIBRATION_KINDS = Object.freeze([
  'ym2612','ym2203','ym2608','ym2610','ym2610b','ym2151','ym2413','ym3526','ym3812','y8950','ymf262','dx7',
]);

const sourcePrefix = kind => `const source = await createSoundChip(${JSON.stringify(kind)}, {id: 'calibration-source'});
context.calibrationSource = source;
`;

function opn(kind,frequencyHz,prefix=sourcePrefix(kind)){
  const physical=kind==='ym2610'?1:0,channels=kind==='ym2203'?[0,1,2]:[0,1,2,4,5,6];
  const hasSsg=kind!=='ym2612',stereo=kind!=='ym2203';
  return {
    setup:prefix+`await source.reset();
// Normal channel mode; no timers/CSM/LFO, DAC or secondary generators.
await source.write(0, 0x27, 0);
${kind==='ym2203'?'':'await source.write(0, 0x22, 0);\n'}${kind==='ym2612'?'await source.write(0, 0x2b, 0);\n':''}${kind==='ym2608'?'await source.write(0, 0x29, 0x80);\n':''}${hasSsg?'await source.write(0, 7, 0x3f);\nfor (const register of [8, 9, 10]) await source.write(0, register, 0);\n':''}for (const channel of ${JSON.stringify(channels)}) await source.write(0, 0x28, channel);
// Algorithm 7 has independent carriers; only OP4 is keyed on at TL=0.
await source.write(0, 0xb0 + ${physical}, 7);
${stereo?`await source.write(0, 0xb4 + ${physical}, 0xc0);\n`:''}for (const slot of [0, 8, 4, 12]) {
  const offset = ${physical} + slot;
  await source.write(0, 0x30 + offset, 1); // DT=0, MUL=1.
  await source.write(0, 0x40 + offset, slot === 12 ? 0 : 127);
  await source.write(0, 0x50 + offset, 31); // Maximum attack; no key scaling.
  await source.write(0, 0x60 + offset, 0); // AM/decay disabled.
  await source.write(0, 0x70 + offset, 0); // Sustain holds peak amplitude.
  await source.write(0, 0x80 + offset, 15); // SL=0, fast release.
  await source.write(0, 0x90 + offset, 0); // SSG-EG disabled.
}
await source.setFrequency(0, ${frequencyHz});
await source.write(0, 0x28, ${0x80|physical});
`,
    stop:`await context.calibrationSource.write(0, 0x28, ${physical});`,
    noteInfo:`Public FM channel 0${kind==='ym2610'?' maps to physical FM channel 1 on YM2610':kind==='ym2610b'?' is physical FM channel 0 on the six-channel YM2610B':''}; multiplier 1; nearest OPN BLOCK/F-NUM at the chip's current clock.`,
    limitations:kind==='ym2203'?'YM2203 FM is mono and is sent equally to both outputs.':'Both hardware stereo output bits are enabled; per-output amplitude must be measured separately.',
  };
}

function opm(frequencyHz){
  return {
    setup:sourcePrefix('ym2151')+`await source.reset();
await source.writeRegister(0x0f, 0); // Noise off.
await source.writeRegister(0x18, 0);
await source.writeRegister(0x19, 0); await source.writeRegister(0x19, 0x80); // AMD/PMD=0.
await source.writeRegister(0x1b, 0);
for (let channel = 0; channel < 8; channel++) await source.writeRegister(8, channel);
await source.writeRegister(0x20, 0xc7); // Both outputs, feedback=0, algorithm 7.
await source.writeRegister(0x38, 0); // AMS/PMS=0.
for (const slot of [0, 16, 8, 24]) {
  await source.writeRegister(0x40 + slot, 1);
  await source.writeRegister(0x60 + slot, slot === 24 ? 0 : 127);
  await source.writeRegister(0x80 + slot, 31);
  await source.writeRegister(0xa0 + slot, 0);
  await source.writeRegister(0xc0 + slot, 0);
  await source.writeRegister(0xe0 + slot, 15);
}
await source.setFrequency(0, ${frequencyHz});
await source.writeRegister(8, 0x40); // C2 only, no modulating operator.
`,
    stop:'await context.calibrationSource.writeRegister(8, 0);',
    noteInfo:'YM2151 channel 0, C2 single carrier at MUL=1, DT1/DT2=0; nearest KC/KF (1/64 semitone).',
    limitations:'Both stereo output bits enabled; the integer chip pitch and DAC are quantized.',
  };
}

function opl(kind,frequencyHz){
  const opl3=kind==='ymf262';
  return {
    setup:sourcePrefix(kind)+`await source.reset();
${opl3?'await source.writeRegister(5, 1, 1);\nawait source.writeRegister(4, 0, 1); // Two-operator mode for every pair.\n':kind==='ym3812'?'await source.writeRegister(1, 0x20);\n':''}await source.writeRegister(0xbd, 0); // Rhythm and deep AM/vibrato off.
for (let channel = 0; channel < ${opl3?18:9}; channel++) await source.writeRegister(0xb0 + channel % 9, 0, Math.floor(channel / 9));
// Serial two-op algorithm. Modulator AR=0 and TL=max keep it silent.
for (const slot of [0, 3]) {
  await source.writeRegister(0x20 + slot, 0x21); // EG sustain, MUL=1; no AM/vibrato/KSR.
  await source.writeRegister(0x40 + slot, slot === 3 ? 0 : 63);
  await source.writeRegister(0x60 + slot, slot === 3 ? 0xf0 : 0);
  await source.writeRegister(0x80 + slot, 15); // SL=0, fast key-off release.
  ${kind==='ym3526'||kind==='y8950'?'// OPL1 has only sine; no waveform-select register is needed.':'await source.writeRegister(0xe0 + slot, 0);'}
}
await source.writeRegister(0xc0, ${opl3?'0x30':'0'}); // Feedback=0, serial connection${opl3?', both stereo outputs':''}.
await source.setFrequency(0, ${frequencyHz});
await source.keyOn(0);
`,
    stop:'await context.calibrationSource.keyOff(0);',
    noteInfo:'Physical channel 0, two-operator serial algorithm, only carrier attacks; TL/KSL=0, sine waveform, MUL=1; nearest OPL BLOCK/F-NUM.',
    limitations:opl3?'OPL3 runs in NEW mode with all four-op pairs disabled and both stereo output bits enabled.':'Mono chip output is sent equally to both channels. Silent modulator uses AR=0 rather than a low-amplitude preset.',
  };
}

function opll(frequencyHz){
  return {
    setup:sourcePrefix('ym2413')+`await source.reset();
await source.writeRegister(0x0e, 0); // Rhythm off.
for (let channel = 0; channel < 9; channel++) await source.writeRegister(0x20 + channel, 0);
// Instrument 0: sine carrier, maximum envelope, silent non-attacking modulator.
const patch = [0x21, 0x21, 0x3f, 0, 0, 0xf0, 0x0f, 0x0f];
for (let register = 0; register < patch.length; register++) await source.writeRegister(register, patch[register]);
await source.writeRegister(0x30, 0); // User patch, output attenuation=0.
await source.setFrequency(0, ${frequencyHz});
await source.keyOn(0);
`,
    stop:'await context.calibrationSource.keyOff(0);',
    noteInfo:'OPLL channel 0, user patch 0, carrier attenuation=0; modulator TL=63/AR=0, carrier AR=15/DR=0/EGT=1; nearest 9-bit BLOCK/F-NUM.',
    limitations:'YM2413 cannot independently key only its carrier; the modulator is kept at its silent envelope state. Mono is duplicated to both outputs.',
  };
}

function dx7(frequencyHz){
  const midi=Math.round(69+12*Math.log2(frequencyHz/440));
  if(midi<0||midi>127)throw new RangeError('DX7 calibration frequency is outside MIDI 0..127');
  const effectiveFrequencyHz=440*2**((midi-69)/12);
  const envelope={rates:[99,99,99,99],levels:[99,99,99,0]};
  const operator={mode:'ratio',coarse:1,fine:0,detune:7,outputLevel:0,rateScaling:0,ampModSensitivity:0,velocitySensitivity:0,keyboardScaling:{breakpoint:0,leftDepth:0,rightDepth:0,leftCurve:0,rightCurve:0},envelope};
  const preset={name:'CAL SINE',algorithm:31,feedback:0,oscillatorSync:true,transpose:24,pitchEnvelope:{rates:[99,99,99,99],levels:[50,50,50,50]},lfo:{speed:0,delay:0,pitchModDepth:0,ampModDepth:0,pitchModSensitivity:0,waveform:0,sync:false},operators:Object.fromEntries([1,2,3,4,5,6].map(number=>[number,{...operator,outputLevel:number===1?99:0}]))};
  return {
    setup:sourcePrefix('dx7')+`await source.panic();
await source.setPreset(${JSON.stringify(preset)});
await source.noteOn(${midi}, 127);
`,
    stop:`await context.calibrationSource.noteOff(${midi});`,
    effectiveFrequencyHz,
    noteInfo:`DX7 algorithm 32 (API31), OP1 only at outputLevel99, ratio1.00; MIDI${midi}, velocity127, EG levels99/99/99/0, no level/rate/velocity/keyboard scaling or modulation.`,
    limitations:'Public DX7 notes are integer MIDI: arbitrary requested Hz is rounded to the nearest semitone. 220/440/880 Hz are exact A notes; internal phase/DAC quantization remains.',
  };
}

export function buildFmCalibrationReference(kind,frequencyHz=440){
  if(!FM_CALIBRATION_KINDS.includes(kind))throw new RangeError(`Unsupported FM calibration kind: ${kind}`);
  if(!Number.isFinite(frequencyHz)||frequencyHz<=0)throw new RangeError('Calibration frequency must be positive finite Hz');
  const reference=kind==='dx7'?dx7(frequencyHz):kind==='ym2151'?opm(frequencyHz):kind==='ym2413'?opll(frequencyHz):['ym3526','ym3812','y8950','ymf262'].includes(kind)?opl(kind,frequencyHz):opn(kind,frequencyHz);
  return {kind,waveform:'sine',frequencyHz,...reference};
}

export const createFmCalibrationPrograms = (frequencyHz=440) => FM_CALIBRATION_KINDS.map(kind=>buildFmCalibrationReference(kind,frequencyHz));

/** Measure Neo Geo B's existing six-channel primary rather than allocating an
 * additional instance. It must not use Neo Geo's four-channel map. */
export function buildYm2610bPrimaryCalibrationReference(frequencyHz=440){
  if(!Number.isFinite(frequencyHz)||frequencyHz<=0)throw new RangeError('Calibration frequency must be positive finite Hz');
  return {
    kind:'ym2610b',waveform:'sine',frequencyHz,
    ...opn('ym2610b',frequencyHz,`const source = fm;
context.calibrationSource = source;
`),
  };
}
