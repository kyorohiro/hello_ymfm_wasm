# npm向けの任意Mixerプリセット

0.2.27では[PSG系のAC RMS再調整](npm_mixer_psg_balance_01.md)を追加した。
以下は0.2.26での初回公開時の記録。

2026-10-24。[Playgroundの音源別初期音量](playground_chip_levels_01.md)を、
汎用ライブラリー側でも明示的に選べる形で提供する。
既存のnpm利用者の初期音量は変更しない。今回の対象は実装と配布物の検証であり、npm公開は別操作とする。

## 公開API

root entryと`tetorica-fm2612/soundchip_mixer_presets.js`から
`SOUNDCHIP_MIXER_PRESETS`をexportする。

```js
import {
  createSoundChip, SoundChipMixer, SOUNDCHIP_MIXER_PRESETS,
} from 'tetorica-fm2612';

const mixer = new SoundChipMixer(SOUNDCHIP_MIXER_PRESETS.calibrated);
const chip = await createSoundChip('ym2612', {
  execution: 'worklet', mixer,
});
try {
  // Synthなどで音色・音程を設定する。
  await chip.start();
  // 演奏する。
} finally {
  await chip.dispose();
}
```

外部`AudioContext`を渡す場合は呼び出し側がcloseする。
音色設定、実際の試奏、Transportの破棄を含む例は
[npm READMEのChip mixer節](../../packages/fm2612/README.md#chip-mixer)に記載する。

## 初期値と優先順位

- `new SoundChipMixer()`、または`createSoundChip()`の`mixer`省略時は従来どおり。
  Game Boyは0.28、他の音源は1を基本値とする。
- `calibrated`は、追加生成で実測した22種類の`factoryDefaults`と、
  YM2612/Nukedの`factoryEngines`を持つ固定プリセット。
  engineを報告する接続では対応する値を選ぶ。
- 優先順位は既存のMixer規則を使う。種類別・engine別factory値より、
  利用者が指定した共通初期値とID別設定を優先する。
  例えば`mixer.set(id, {volume: 0.5})`は0.5を最終のstrip volumeに選び、
  校正値へ0.5を掛ける処理にはしない。
- Worklet endpointの既存`gain` trimは別段のまま。
  このプリセットは保存設定を書き換えず、永続化処理も加えない。
- 実測対象外のnpm音源は従来の初期値へfallbackする。
  新たな音源のWorklet対応やNative対応を増やす機能ではない。

対象22種類は`ym2612`、`ym2203`、`ym2610`、`ym2610b`、`rf5c164`、
`ym2608`、`gameboy`、`segapsg`、`ym2151`、`pwm`、`nes`、`dx7`、
`snes`、`spc`、`huc6280`、`okim6258`、`ym3526`、`ym3812`、`y8950`、
`ymf262`、`ym2413`、`ay8910`。

## 対象範囲

既知の単音を使った出力単位の測定値から固定倍率を与える。
演奏中の音声解析、AGC、正規化、limiter、音色や発音数による補正は行わない。
知覚上の音量と多音時のheadroomは、演奏とMixer設定に依存する。

最初の用途は独立した追加音源／`createSoundChip`の出力経路。
MegaSynth内蔵音源には別のtrimがあるため、これを渡すだけで
Playgroundの機種別Systemプリセットと同じバランスになるとはしない。
機種別の内蔵IDに対する`factoryEntries`は、このnpmプリセットへ混ぜない。

低レベル`generateStereo()`のPCM、C++／WASMコアの音量、VGM Analyzerの出力は変更しない。
RF5C164の校正値もMixerのfallbackとして1回だけ適用し、コアや別trimへ重ねない。

## 検証項目

- 22種類と追加Nukedの値が、既存の実測reportから得た値と一致すること。
- importだけでは音声デバイスを開かず、プリセットの共有値を利用者側で変更できないこと。
- プリセット省略時の従来値、実測対象外のfallback、共通値／ID値の上書き、
  factory値を保存JSONへ混ぜない規則を維持すること。
- root／個別entryのexport、生成した型宣言、npm配布物でのimportを確認すること。
- 実Workletの代表音源で、プリセット選択時の出力比とStop／dispose後のroute解放を確認すること。
- raw PCMの生成結果が、プリセットのimportやMixer生成で変わらないこと。

## 生成と検証

`web/soundchip_mixer_presets.js`を追加し、`web/soundchip.js`から再exportした。
`scripts/generate_soundchip_mixer_presets.mjs`はPlaygroundと同じ完全な基準reportを検証して、
追加生成音源の`factoryDefaults`／`factoryEngines`だけを取り出す。
機種別の`factoryEntries`は含めない。生成値は深くfreezeし、各Mixerは構築時にコピーする。

npm用のbuildは、コピー開始前に生成ファイルの`--check`を実行する。
測定記録と異なる値、欠けた測定、検証用reportからの生成を通さない。
数値を更新するときは同じ基準reportから再生成する。

```sh
node scripts/generate_soundchip_mixer_presets.mjs
node scripts/generate_soundchip_mixer_presets.mjs --check
```

配布物検証コマンド：

```sh
npm run build:fm2612
npm run test:fm2612:types
npm run test:fm2612
node scripts/check_soundchip_mixer_presets_browser.cjs --webkit
```

## 検証結果（2026-10-24）

- 生成器・Mixer・chip factoryの関連61試験が成功。
  全22種類と追加Nukedの測定値一致、任意適用、個別／共通設定の優先、RF5C164の二重補正防止、
  保存JSONの維持、deep freeze、Mixer間の独立性、raw PCMの完全一致を確認した。
- `build:fm2612`が成功し、328型宣言を生成・検査した。
  NodeNext／Bundlerのconsumer型試験、Node ambient typesなしのbrowser型試験も成功。
  新しい公開テストに合わせ、Mixerのengine引数へstringの型注釈を補った。
- 最近追加されたNative補助APIの型注釈不足も、npm全体の宣言検査で見つかった。
  8モジュールのcallback／optionsをJSDocだけで補い、コメント除去後の実行JSが元と一致することを確認した。
- npm tarballを一時プロジェクトへoffline installし、root／個別entryのimport、
  942ローカル参照、26 WASM engine、実Synth PCMと既存Native／sample API、consumer型試験が成功。
  検証したtarballは801ファイル。npm公開は行っていない。
- `dist/fm2612`を配信し、Chromium／WebKitの実WASM／AudioWorkletを48 kHzで検証した。
  YM2612、Sega PSG、Game Boy、YM3812の出力比はそれぞれ
  `0.775938`／`0.644089`／`0.515271`／`1.033570`と一致した。
  明示0.5の上書きも全音源で0.5倍、Mixer省略時は従来の`1`／`1`／`0.28`／`1`を維持した。
  別sourceを維持したまま自分のrouteだけを破棄し、raw YM2612 PCMの最大差は0だった。
  capture Worklet後段は無音出力で、物理デバイスでの聴感比較ではない。
  最初のsandbox実行はローカルlistenのEPERMで停止し、許可された環境で成功した。

## npm公開（2026-10-24）

- `tetorica-fm2612@0.2.26`を`latest`で公開した。npmはHTTP 202で受理し、
  反映待ちの後にversionと`latest: 0.2.26`を確認した。
- 公開前に再buildし、328型宣言、942ローカル参照、26 WASM engine、
  tarballの隔離install後のPCM／API／consumer型試験がすべて成功した。
- MSM5205参照実装の`libvgm-msm5205` README／LICENSEの同梱漏れを修正し、
  配布物検査の必須項目へ追加した。READMEのY8950 ADPCMの古い説明も更新した。
- 最終tarballの803ファイルは検証したstageとバイト単位で一致。
  npmから再取得したtarballも、検証済みローカルtarballの全1,578,797 bytesと一致した。
- 公開URL: https://www.npmjs.com/package/tetorica-fm2612/v/0.2.26
- SHA-256: `e82377b557d6613e04a8c6ea0d606bc9fc6c5fd3e62e5990bbb5a5663f0840ae`
- SRI: `sha512-t/xDXvTh+2raXGd4m6Zsi4+rUtwB1Y/nfFtDBS/kmquG2dsGLY/koPUVPwyYXUjImogx7HLrWg1xWDXtd2xSLA==`

調整済みプリセットは任意適用のまま。従来のMixer省略時の音量とraw PCMは変更していない。
