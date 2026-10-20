/// <reference path="../../docs/playground/tetorica-playground-dx7.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkDx7ModeTypes() {
  await dx7.setPreset({
    name: 'TYPE KEYS', algorithm: 31,
    operators: {1: {coarse: 1, outputLevel: 85, envelope: {rates: [99, 80, 70, 75], levels: [99, 90, 80, 0]}}},
  });
  await dx7.setOperator(6, {mode: 'fixed', coarse: 1, fine: 20});
  await pg.dx7.setOperators([[1, {outputLevel: 85}], [2, {coarse: 2}]]);
  await dx7.setFeedback(3);
  const preset = await dx7.getPreset();
  const level: number = preset.operators[1].outputLevel;
  const rate: number = dx7.internalSampleRate;
  dx7.selectVoice(0); dx7.noteOn(60, 100); dx7.noteOff(60); dx7.allNotesOff(); dx7.panic();
  const bank = await dx7.loadSysex(new Uint8Array(163));
  const voiceName: string | undefined = bank[0]?.name;
  await livePrepare('dx7', async ({dx7, sample}) => { await dx7.getState(); sample.isLoaded('kick'); });
  const primary = await useSoundChip('dx7');
  const primaryID: string = primary.id;
  primary.noteOn(64);
  keyboard.bind('DX7', {
    noteOn: ({midi, velocity}) => dx7.noteOn(midi, velocity),
    noteOff: ({midi}) => dx7.noteOff(midi),
    allNotesOff: () => dx7.allNotesOff(),
  });
  // @ts-expect-error the mode owns the primary instance lifetime
  primary.dispose();
  // @ts-expect-error the global primary cannot be disposed by a script
  dx7.dispose();
  // @ts-expect-error DX7 has no chip master-clock API
  primary.setClock(7670454);
  // @ts-expect-error DX7 operators are numbered 1..6
  dx7.setOperator(0, {});
  // @ts-expect-error DX7 uses integer MIDI notes, not note-name parsing
  dx7.noteOn('C4');
  // @ts-expect-error OPN play convenience is absent
  play('C4');
  // @ts-expect-error OPN namespace is absent
  fm;
  // @ts-expect-error pg matches the independent primary mode
  pg.fm;
  // @ts-expect-error no OPN MIDI wrapper in DX7 mode
  pg.midi;
  // @ts-expect-error no OPN channel constants
  CH1;
  // @ts-expect-error no OPN operator constants
  OP1;
  // @ts-expect-error no Genesis PSG primary
  psg;
  // @ts-expect-error no primary wavetable PSG
  pce;
  const independent = await createSoundChip('dx7'); independent.dispose();
  const extraFm = await useSoundChip('ym2612'); extraFm.noteOn(0, 'C4'); extraFm.dispose();
}
