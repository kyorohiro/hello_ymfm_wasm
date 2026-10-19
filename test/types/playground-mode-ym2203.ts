/// <reference path="../../docs/playground/tetorica-playground-ym2203.d.ts" />
/// <reference path="./playground-mode-common.ts" />
/// <reference path="./playground-mode-opn.ts" />

async function checkPc98OpnModeTypes() {
  fm.setPreset(CH3, {algorithm: 7, feedback: 2});
  await play('C4', {channel: CH3});
  const lastFmChannel: 2 = pg.CH3;
  // @ts-expect-error a three-channel mode does not expose pg.CH4
  pg.CH4;
  // @ts-expect-error a three-channel mode does not expose pg.CH6
  pg.CH6;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH7;
  // @ts-expect-error MIDI channel constants belong to Genesis modes
  pg.CH16;
  // @ts-expect-error YM2203 only exposes three FM channels
  fm.setPreset(3, FM_PRESETS.sine);
  // @ts-expect-error pg.fm follows the selected mode
  pg.fm.setFrequency(3, 440);
  // @ts-expect-error play follows the selected mode's channel count
  await play('C4', {channel: 3});
  // @ts-expect-error YM2203 has no stereo pan
  fm.setPan(0, true, false);
  // @ts-expect-error YM2203 has no FM LFO
  fm.setLfo(true, 1);
  // @ts-expect-error YM2203 presets cannot configure stereo pan
  fm.setPreset(0, {pan: {left: true}});
  // @ts-expect-error YM2203 presets cannot configure modulation sensitivity
  fm.setPreset(0, {ams: 1});
  // @ts-expect-error YM2203 has no DAC
  fm.dac.stop();
  // @ts-expect-error YM2203 has no DAC enable register
  pg.fm.setDacEnabled(true);
  await pg.livePrepare('opn', ({fm}) => {
    // @ts-expect-error livePrepare receives the selected YM2203
    fm.setPan(0, true, false);
  });
  const primary = await useSoundChip('ym2203');
  primary.setNote(2, 'C4');
  // @ts-expect-error the shared primary has the same bounds as fm
  primary.setNote(3, 'C4');
  // @ts-expect-error the shared primary has no FM LFO
  primary.setLfo(true, 1);
  const extra = await useSoundChip('ym2612');
  extra.setPan(5, true, false);
}
