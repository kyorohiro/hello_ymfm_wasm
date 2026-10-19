/// <reference path="../../docs/playground/tetorica-playground-ym2610.d.ts" />
/// <reference path="./playground-mode-common.ts" />
/// <reference path="./playground-mode-opn.ts" />

async function checkNeoGeoModeTypes() {
  fm.setPan(CH4, true, false);
  fm.setLfo(true, 2);
  fm.setNote(CH4, 'C4');
  await pg.play('C4', {channel: CH4});
  const lastFmChannel: 3 = pg.CH4;
  // @ts-expect-error Neo Geo does not expose pg.CH5
  pg.CH5;
  // @ts-expect-error Neo Geo does not expose pg.CH6
  pg.CH6;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH16;
  // @ts-expect-error Neo Geo exposes four logical FM channels
  fm.setNote(4, 'C4');
  // @ts-expect-error pg.fm follows Neo Geo's channel mapping
  pg.fm.noteOn(5, 'C4');
  // @ts-expect-error play follows Neo Geo's channel mapping
  await play('C4', {channel: 4});
  // @ts-expect-error YM2610 has no YM2612 DAC
  fm.setDacEnabled(true);
  // @ts-expect-error YM2610 has no YM2612 DAC
  fm.dac.stop();
  await livePrepare('neo', ({fm}) => {
    // @ts-expect-error livePrepare follows Neo Geo's channel mapping
    fm.keyOn(4);
  });
  const primary = await useSoundChip('ym2610');
  primary.noteOn(3, 'C4');
  // @ts-expect-error the selected shared facade has four logical channels
  primary.noteOn(4, 'C4');
  // @ts-expect-error the selected shared facade has no DAC
  primary.writeDac(128);
}
