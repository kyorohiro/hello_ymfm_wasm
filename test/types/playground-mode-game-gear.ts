/// <reference path="../../docs/playground/tetorica-playground-game-gear.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkGameGearModeTypes() {
  psg.tone(PSG1, {note: 'C4', attenuation: 8});
  psg.setNote(PSG2, 'E4'); psg.keyOn(PSG2); psg.off(PSG3);
  psg.noise({type: 'white', rate: 'tone3', attenuation: 10});
  psg.setStereo(0xf1); pg.psg.setStereo(0xff); pg.psg.noiseOff();
  await psg.setClock(psg.clock);
  await livePrepare('psg', ({psg, sample}) => {
    psg.tone(PSG1, {frequency: 440}); psg.setStereo(0xff); sample.isLoaded('drum');
  });
  const primary = await useSoundChip('segapsg'); primary.setStereo(0xf0);
  // @ts-expect-error borrowed PSG lifetime belongs to the mode
  primary.dispose();
  // @ts-expect-error primary lifetime belongs to the mode
  psg.dispose();
  // @ts-expect-error PSG has three tone channels; noise has a separate API
  psg.tone(3, {note: 'C4'});
  // @ts-expect-error native modes have no FM shorthand
  play('C4');
  // @ts-expect-error native modes have no global FM
  fm;
  // @ts-expect-error native modes have no OPN channel constants
  CH1;
  // @ts-expect-error native modes have no operator constants
  OP1;
  // @ts-expect-error pg follows the selected mode
  pg.fm;
  // @ts-expect-error another primary APU is unavailable
  gameboy;
  // @ts-expect-error livePrepare follows the selected mode
  livePrepare('fm', context => context.play('C4'));
  const extra = await createSoundChip('segapsg'); extra.setStereo(0x0f); extra.dispose();
  const independentFm = await useSoundChip('ym2612'); independentFm.noteOn(0, 'C4'); independentFm.dispose();
}
