# PSG系の初期音量とMixerの単位を統一する

2026-10-25。Game Boyだけ反映済みで、Sega PSG・AY・NES・PC Engineの候補値は
Playground Systemへ反映されていなかった。各アプリの設定を共通の生成方針へ揃えた。

## 表示する値

| 音源 | System / Analyzer / npm calibrated preset |
| --- | ---: |
| Sega PSG | 0.35 |
| AY-3-8910 | 0.85 |
| NES | 1.16 |
| Game Boy | 0.36 |
| HuC6280 / PC Engine | 0.44 |

**1.0は音源の無補正出力**とする。Systemは上の調整値を持つPresetであり、
調整済みの音量をさらに1.0へ正規化する層は作らない。
Genesisでも追加生成でも、PSGの0.35は同じ倍率を表す。
HuC6280はチップ全体に0.44を適用するため、矩形波だけでなく正弦波も小さくなる。
任意の音色・曲・発音数の聴感を揃える処理ではない。

## 既存のGenesis倍率との関係

既存のGenesis出力にはFM 0.9 / PSG 0.35の機種用倍率がある。
これを残したままPresetの表示値を逆算する案（Genesis PSGだけ表示1.0）は採用しない。

新しいPlaygroundとnpm calibrated presetのMixerは`gainUnits: 'source'`を指定する。
ブラウザーWorklet／Native接続では、検証済みの表示値0〜2を内部のランプ目標へ換算し、
既存の機種用倍率を一度だけ相殺する。出力・メーターとも表示値が実効倍率になる。
FMの表示も同じ単位になり、通常のGenesis初期値は約0.775938になる。

Analyzerも公開するstrip値を音源単位へ揃え、アプリのPCM境界で既存倍率を相殺する。
汎用GenesisAudioEngine、Mixerを使わない低レベル生成PCM、OPN内部のFM/SSG等の比率は変更しない。
通常の`new SoundChipMixer()`は従来の`legacy`単位を維持する。
追加音源の独立した出力経路には、Genesisの機種用倍率を持ち込まない。

## 保存済み設定

- Playgroundの新しいPreset／current.jsonには`gainUnits: 'source'`を記録する。
- 旧Presetは読込み時に、Genesis主音源の明示音量だけFM×0.9 / PSG×0.35へ換算する。
  共通kind音量を指定していた場合は主音源用のID設定を補い、追加音源の共通音量を保つ。
- 選択・読込みだけでファイルを書き換えない。編集後の保存から新単位を記録し、二重換算を防ぐ。
- Analyzerの旧設定も、現在の音源構成に応じて読込み時に換算する。
  新しい音量編集だけsource単位として保存し、pan/muteだけの編集では旧音量の解釈を変えない。

## 生成元と検証

初期値は`generate_playground_mixer_defaults.mjs`の`MIXER_LISTENING_LEVELS`で一元管理し、
Playgroundとnpm向けPresetを生成する。Analyzerも同じ生成済み設定を参照する。
過去の測定JSONと歴史的なAC RMS校正値は保持し、聴感用の値で測定記録を上書きしない。
新しい校正captureにはgainUnitsを記録し、旧測定の機種用倍率を二重換算しない。

検証対象は生成の再現性、保存値の移行、System選択でcurrent.jsonを変更しないこと、
通常／Nukedの連続ランプとメーター、Nativeの命令と実コア出力、Analyzerの再開・seek・WAV出力。
PlaygroundはChromium／WebKit各18経路で、主音源・追加音源の実PCMとMixer値を確認した。
実音声の記録は[psg_mixer_balance_02.json](psg_mixer_balance_02.json)にまとめる。

- 関連JS試験258件が成功。
- Analyzerの実PCM 8経路とChromium／WebKit UI検証が成功。
- Nativeのsource_mix試験9件、既存Nuked試験13件、JS接続試験43件が成功。
- npm向け配布物の実インストール・型検証と、両ブラウザーの実Worklet検証が成功。

```sh
node scripts/generate_playground_mixer_defaults.mjs --report=docs/issues/playground_chip_levels_01.json --check
node scripts/generate_soundchip_mixer_presets.mjs --check
node scripts/check_analyzer_mixer_levels.mjs
node scripts/check_analyzer_mixer_browser.cjs
node scripts/check_fm2612_package.mjs
```

本体のWeb配布用JSとnpm向け配布物、およびTauriのNative接続ソースまで更新する。
npm公開、Web配信、Tauriの同梱フロントエンド更新／配布、Examplesの依存更新はこの作業では行わない。
次に予定していたYM2612 WASMの固定SDK参照への移行は、引き続き次作業として残す。

追記：その後の指示で、npm向け変更を`tetorica-fm2612@0.2.28`として公開した。
公開物と検証済み配布物の一致は[npm公開記録](npm_mixer_source_units_release_01.md)を参照。
