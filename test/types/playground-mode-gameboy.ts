/// <reference path="../../docs/playground/tetorica-playground-gameboy.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkGameboyModeTypes() {
  gameboy.pulse.setVoice(0, {duty: 0.25, volume: 12, envelope: {direction: 'down', period: 3}});
  gameboy.pulse.noteOn(0, 'C4');
  gameboy.wave.stopAndSetWaveform(new Uint8Array(32));
  gameboy.wave.setLevel(0.5);
  pg.gameboy.wave.noteOn('C3');
  gameboy.noise.setVoice({volume: 8, divisor: 3, shift: 4, width: 7});
  gameboy.noise.keyOn();
  gameboy.setPan(3, true, false);
  const id: string = gameboy.id;
  await pg.gameboy.setClock(gameboy.clock);
  await livePrepare('apu', ({gameboy, noise, sample, stream}) => {
    gameboy.pulse.setEnvelope(1, {volume: 8});
    noise.stopAll();
    sample.isLoaded('drum');
    stream.stop();
  });
  await beat(0.25);
  await sleep(0.1);
  await tween({beats: 1}, progress => pg.gameboy.wave.setLevel(progress > 0.5 ? 1 : 0.5));
  scale('C4', 'minor');
  chord('C4', 'minor');
  // @ts-expect-error pulse has two channels
  gameboy.pulse.keyOn(2);
  // @ts-expect-error noise cannot receive a tonal frequency
  gameboy.setFrequency(3, 440);
  // @ts-expect-error primary APU lifetime belongs to the mode
  gameboy.dispose();
  // @ts-expect-error FM only exists after explicitly requesting an FM chip
  fm.setNote(0, 'C4');
  // @ts-expect-error the FM shorthand is absent in a Game Boy mode
  play('C4');
  // @ts-expect-error use the APU's own writeRegister
  write(0, 0x28, 0xf0);
  // @ts-expect-error sample register schedules belong to the primary FM chip
  scheduleWritesSamples(0, []);
  // @ts-expect-error FM operator constants do not describe APU channels
  OP1;
  // @ts-expect-error FM channel shortcuts are absent
  CH1;
  // @ts-expect-error FM presets are absent
  FM_PRESETS;
  // @ts-expect-error block/fnum is an OPN pitch representation
  noteToBlockFnum('C4');
  // @ts-expect-error block/fnum is an OPN pitch representation
  hzToBlockFnum(440);
  // @ts-expect-error interpolation of OPN pitch is absent
  noteLerp('C4', 'C5', 0.5);
  // @ts-expect-error primary Sega PSG is absent
  psg;
  // @ts-expect-error primary OPN SSG is absent
  ssg;
  // @ts-expect-error pg follows the selected mode
  pg.fm;
  // @ts-expect-error pg has no FM shorthand
  pg.play;
  // @ts-expect-error pg has no OPN channel constants
  pg.CH1;
  // @ts-expect-error pg has no OPN sections
  pg.adpcm;
  // @ts-expect-error pg has no FM presets
  pg.presets;
  livePrepare('without-fm', context => {
    // @ts-expect-error preparation receives the native APU, not a primary FM chip
    context.fm;
    // @ts-expect-error preparation has no OPN sections
    context.ssg;
  });

  // Explicit independent chips keep their full APIs.
  const extraFm = await useSoundChip('ym2612');
  extraFm.setPreset(5, {algorithm: 7, operators: [{multi: 1, tl: 20}]});
  extraFm.noteOn(5, 'A4');
  extraFm.setDacEnabled(true);
  extraFm.writeDac(128);
  const extraOpna = await useSoundChip('ym2608');
  extraOpna.ssg.noteOn(0, 'C4');
  const extraApu = await createSoundChip('gameboy');
  extraApu.initialize();
  extraApu.dispose();
  const primaryApu = await useSoundChip('gameboy');
  primaryApu.pulse.noteOn(0, 'C4');
  // @ts-expect-error the reused primary APU lifetime belongs to the mode
  primaryApu.dispose();
}
