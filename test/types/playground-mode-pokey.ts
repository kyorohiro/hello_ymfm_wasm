/// <reference path="../../docs/playground/tetorica-playground-pokey.d.ts" />
/// <reference path="../../docs/playground/tetorica-playground-globals.d.ts" />

async function checkPokeyModeTypes() {
  const actualHz:number = pokey.setNote(0, 'A4');
  pokey.setVolume(3, 6); pokey.setDistortion(3, 5);
  pokey.setHighClock(0, true); pokey.setJoined(0, true);
  pokey.setNote(1, 'C3'); pokey.keyOn(1); pokey.keyOff(1);
  pg.pokey.allNotesOff();
  const primary = await useSoundChip('pokey');
  primary.getRegisterSnapshot().byteLength.toFixed();
  (await primary.readRegister(10)).toFixed();
  const extra = await createSoundChip('pokey', {id:'pokey:other'});
  extra.initialize(); extra.noteOn(2, 'D4'); extra.dispose();
  void actualHz;
  // @ts-expect-error One POKEY has only four physical channels.
  pokey.keyOn(4);
  // @ts-expect-error High-clock timers exist only on the lower physical voices.
  pokey.setHighClock(1, true);
  // @ts-expect-error A mode-owned primary cannot be disposed.
  primary.dispose();
  await primary.setClock(1000000);
  // @ts-expect-error Single-POKEY mode has no second primary.
  pokey2;
  // @ts-expect-error Single-POKEY pg has no second primary.
  pg.pokey2;
  // @ts-expect-error No implicit OPN FM in POKEY mode.
  fm;
  // @ts-expect-error POKEY modes use their native API.
  play('C4');
  // @ts-expect-error OPN channel constants are unavailable.
  CH1;
}
