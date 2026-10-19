/// <reference path="../../docs/playground/tetorica-playground-nes.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkNesModeTypes() {
  nes.pulse.setVoice(0, {duty:.25,volume:12}); nes.pulse.noteOn(0, 'C4');
  nes.triangle.noteOn('C3'); nes.noise.setVoice({volume:8,period:3});
  nes.fds.setWave(new Uint8Array(64)); pg.nes.fds.noteOn('G4');
  const enabled:true = nes.fdsEnabled;
  await nes.setClock(nes.clock);
  await livePrepare('apu', ({nes, sample, noise}) => { nes.pulse.noteOn(1,'E4'); sample.isLoaded('kick'); noise.stopAll(); });
  const primary = await useSoundChip('nes'); primary.fds.keyOff();
  // @ts-expect-error primary lifetime belongs to the mode
  primary.dispose();
  // @ts-expect-error pulse has only two channels
  nes.pulse.noteOn(2, 'C4');
  // @ts-expect-error NES has six physical voices including FDS
  nes.keyOff(6);
  // @ts-expect-error native modes have no FM shorthand
  play('C4');
  // @ts-expect-error native modes have no global FM
  fm;
  // @ts-expect-error native modes have no OPN constants
  CH1;
  // @ts-expect-error native modes have no operator constants
  OP1;
  // @ts-expect-error pg follows the selected mode
  pg.play;
  // @ts-expect-error another primary APU is unavailable
  gameboy;
  // @ts-expect-error livePrepare follows the selected mode
  livePrepare('fm', context => context.fm);
  const extra = await createSoundChip('nes', {fds:true}); extra.dispose();
  const pceExtra = await createSoundChip('huc6280'); pceExtra.noteOn(5,'C4'); pceExtra.dispose();
  const okiExtra = await createSoundChip('okim6258'); await okiExtra.loadMemory(Uint8Array.of(0)); okiExtra.dispose();
}
