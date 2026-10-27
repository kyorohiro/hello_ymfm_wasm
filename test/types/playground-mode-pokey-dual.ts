/// <reference path="../../docs/playground/tetorica-playground-pokey-dual.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkDualPokeyModeTypes() {
  for (const chip of [pokey, pokey2]) {
    chip.setVolume(0, 6); chip.setNote(0, 'C4'); chip.keyOn(0);
    chip.setPoly9(true); chip.setBaseClock('64khz'); chip.allNotesOff();
  }
  pg.pokey2.setFrequency(3, 440);
  await livePrepare('dual', ({pokey, pokey2}) => {pokey.allNotesOff(); pokey2.allNotesOff();});
  // @ts-expect-error Two chips are independently addressed, not one eight-channel chip.
  pokey2.keyOn(7);
  // @ts-expect-error The second primary's lifetime belongs to the mode.
  pokey2.dispose();
  // @ts-expect-error No implicit OPN FM in dual-POKEY mode.
  pg.fm;
}
