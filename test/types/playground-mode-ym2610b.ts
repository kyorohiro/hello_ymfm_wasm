/// <reference path="../../docs/playground/tetorica-playground-ym2610b.d.ts" />
/// <reference path="./playground-mode-common.ts" />
/// <reference path="./playground-mode-opn.ts" />
/// <reference path="./playground-mode-without-opna.ts" />

async function checkLegacyYm2610bTypes() {
  fm.setNote(CH6, 'C4');
  fm.setPan(CH6, true, false);
  fm.setLfo(true, 2);
  await play('C4', {channel: CH6});
  const lastFmChannel: 5 = pg.CH6;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH7;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH16;
  // @ts-expect-error six-channel YM2610B still has no YM2612 DAC
  fm.dac.stop();
  // @ts-expect-error six-channel YM2610B still has no YM2612 DAC
  pg.fm.writeDac(128);
  const neo = await useSoundChip('ym2610');
  neo.adpcmA.keyOn(0);
  // @ts-expect-error separately added Neo Geo is four-channel
  neo.noteOn(4, 'C4');
}
