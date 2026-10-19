/// <reference path="../../docs/playground/tetorica-playground-ym2608.d.ts" />
/// <reference path="./playground-mode-common.ts" />
/// <reference path="./playground-mode-opn.ts" />

async function checkPc98OpnaModeTypes() {
  fm.setPreset(CH6, {algorithm: 7, pan: {left: true}, ams: 1});
  fm.setPan(CH6, true, false);
  fm.setLfo(true, 2);
  await play('C4', {channel: CH6});
  const lastFmChannel: 5 = pg.CH6;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH7;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH16;
  // @ts-expect-error OPNA has no YM2612 PCM DAC
  fm.dac.stop();
  // @ts-expect-error pg.fm follows OPNA capabilities
  pg.fm.writeDac(128);
  await livePrepare('opna', ({fm}) => {
    // @ts-expect-error livePrepare follows OPNA capabilities
    fm.setDacEnabled(true);
  });
  // Full YM2608 is still independently available in its own mode.
  const opna = await useSoundChip('ym2608');
  opna.ssg.setFrequency(0, 440);
  await opna.rhythm.loadRom(new Uint8Array(8192));
  await opna.prepareTimeline([], [], 44100);
}
