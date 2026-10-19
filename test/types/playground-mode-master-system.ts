/// <reference path="../../docs/playground/tetorica-playground-master-system.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkMasterSystemModeTypes() {
  psg.tone(PSG1, {note: 'C4', attenuation: 8});
  pg.psg.setPeriod(PSG2, 254); psg.off(PSG3);
  psg.noise({type: 'periodic', rate: 'high'}); psg.noiseOff();
  await psg.setClock(psg.clock);
  await livePrepare('psg', ({psg, sample}) => {
    psg.tone(PSG1, {frequency: 440}); sample.isLoaded('drum');
  });
  const primary = await useSoundChip('segapsg'); primary.noiseOff();
  // @ts-expect-error borrowed PSG lifetime belongs to the mode
  primary.dispose();
  // @ts-expect-error Master System has no Game Gear stereo register
  psg.setStereo(0xff);
  // @ts-expect-error pg follows the selected mono PSG
  pg.psg.setStereo(0xff);
  // @ts-expect-error cached primary is also mono
  primary.setStereo(0xff);
  // @ts-expect-error native modes have no FM shorthand
  play('C4');
  // @ts-expect-error native modes have no global FM
  fm;
  // @ts-expect-error native modes have no OPN channel constants
  CH1;
  // @ts-expect-error native modes have no operator constants
  OP1;
  // @ts-expect-error pg follows the selected mode
  pg.play;
  // @ts-expect-error no global FM write alias
  write(0x28, 0xf0);
  // @ts-expect-error another primary APU is unavailable
  pce;
  const extra = await createSoundChip('segapsg'); extra.setStereo(0xff); extra.dispose();
}
