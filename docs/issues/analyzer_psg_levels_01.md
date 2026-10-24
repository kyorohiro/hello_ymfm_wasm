# AnalyzerのPSG系初期音量の再調整

2026-10-24。[FM／SSG／PSGの比較](analyzer_psg_balance_01.md)に続き、
単音のピーク振幅を揃えた結果、大きくなり過ぎたPSG系の初期音量を抑える。
YM2608内部のSSGは下げず、既存のFM／SSG／rhythm／ADPCM比率を維持する。

## 適用値

| Analyzerの音源 | 以前のMixer倍率 | 新しいMixer倍率 | 以前に対する比率 |
| --- | ---: | ---: | ---: |
| Sega PSG（Genesis経路） | 1.840254 | 1.301200 | 約70.7% |
| Sega PSG（他の経路） | 0.644089 | 0.455420 | 約70.7% |
| AY-3-8910 | 1.545813 | 1.100331 | 約71.2% |
| NES APU | 1.981272 | 1.512236 | 約76.3% |

Genesis経路では既存の後段0.35倍を考慮して、Sega PSGのMixer表示が約184%から約130%になる。
補正倍率を別段に重ねず、現在のMixer初期値を置き換える。

YM2608全体の倍率`1.033570`、内部SSG対FMのRMS比`1.878361`は維持する。
YM2203／YM2610等の内部SSGも変更しない。
Game BoyとPC Engineは波形チャンネルのsin波を基準にした校正のため、今回の対象から外す。
NESはAPU全体の倍率で、pulse／triangle／noise／DMC／FDS間の元の比率を変えない。

## 測定と生成

同じAnalyzerのmixed engine、44,100 Hz、master=1で、単独のSega PSG、AY、NES pulseを
明示unityで測定した。220／440／880 Hz、warmup 0.25秒、capture 1秒。
SSG／AYのDC成分は除き、440 HzのAC RMSから固定倍率を計算する。

基準は既存倍率`1.033570`を適用したYM2608のFM単carrierで、AC RMSは
`0.09108396077488734`。FM側や他音源の共通ピーク校正targetは変更しない。
演奏中の解析・AGC・limiter・音符ごとの補正は追加しない。

| 基準音 | unity出力のAC RMS（後段trim除外） | 新初期値でのAC RMS |
| --- | ---: | ---: |
| Sega PSG、矩形波1 CH | 0.199999948 | 約0.091084 |
| AY、矩形波1 CH | 0.082778692 | 約0.091084 |
| NES pulse、50% duty、1 CH | 0.060231321 | 約0.091084 |

AYの基準は以前の校正と同じtype0／flags1の出力モデルを使う。
flags0は別の抵抗／DACモデルで出力単位が小さく、比較測定のみ記録する。
音源のモデル間の出力差を平坦化する追加倍率は導入しない。
この初期値は最大固定levelの基準であり、任意の曲・音色・pulse duty・発音数の
聴感音量が同じになることを意味しない。

[測定JSON](analyzer_psg_levels_01.json)に、canonical 9条件とAY flags0比較3条件、
元の倍率、新しい倍率、PCM統計、source hashを保存する。
`generate_analyzer_mixer_defaults.mjs`は従来のpeak校正を維持した上で、
この3 IDだけをAC RMSの測定値で置き換える。
必要な周波数・測定経路・FM基準・倍率計算・source hashが揃わない場合は生成を拒否する。

```sh
node scripts/measure_analyzer_psg_levels.mjs --out docs/issues/analyzer_psg_levels_01.json
node scripts/generate_analyzer_mixer_defaults.mjs
node scripts/generate_analyzer_mixer_defaults.mjs --check
```

## 保存・対象範囲

初期値の更新だけでは保存済みの明示gainを上書きしない。
以前の値を保存している環境は、AnalyzerのMixer Resetで新しい初期値を選べる。
pan／muteだけを保存している場合は、音量の新初期値がそのまま適用される。

今回の適用先はVGM Analyzerと、その再生coreを共有するCLI。
Playground Systemと、公開済みnpmの`SOUNDCHIP_MIXER_PRESETS.calibrated`は変更しない。
低レベルcoreやWASMの生PCM、OPN内部の合成係数も変更しない。

## 聴き比べ

```sh
node scripts/render_analyzer_psg_comparison.mjs
```

`release/analyzer-psg-adjusted/01-before.wav`と`02-after.wav`を生成する。
FM → SSG → Sega PSG → AY → NESの順、各1秒、間に0.3秒の無音。
FM／SSGは前後とも同じ倍率を使い、後半3音源だけを変更する。
試聴用に平均DCを除去し、端を10 msでfadeする。区間ごとのpeak正規化はしない。

## 検証結果

- 関連自動試験596件中595件成功、失敗0件。既存の外部compiler依存1件のみskip。
  旧NESのraw測定再現、OPNのFM／SSG値の維持、生成器の不正入力拒否も検査した。
- [実PCM検証](analyzer_mixer_levels_validation.json)は8経路すべて成功。
  PSG／AY／NESはAC RMS、FM／RFは従来のピーク基準、OPNA SSGは既存の内部比率を検査する。
  gainの二重掛けがないことを確認し、最大sample誤差は約`5.94e-8`。
  明示値、reset後のgain、同じcore履歴からのWAV一致も維持した。
- ソースと配布stageの両方でChromium／WebKitのUI試験が成功した。
  新しい表示・Play時の適用、保存・Reset、PSGの構成別trim、OPNAの実gain／muteを確認した。
- CLIビルド、Analyzer ZIP生成、配布物752参照の検査が成功した。

```sh
node --test --test-concurrency=4 docs/vgm_analyzer/*.test.mjs test/playback-core.test.mjs test/msx-render.test.mjs test/msx-opm.test.mjs test/y8950-export.test.mjs web/soundchip_mixer*.test.mjs scripts/generate_analyzer_mixer_defaults.test.mjs
node scripts/check_analyzer_mixer_levels.mjs --out docs/issues/analyzer_mixer_levels_validation.json
node scripts/check_analyzer_mixer_browser.cjs
node scripts/check_analyzer_mixer_browser.cjs --root=release/itch_vgm_analyzer_analyzer-psg-adjusted
```

配布用ZIPは`release/hello_ymfm_wasm_analyzer-psg-adjusted_itch_vgm_analyzer.zip`。
公開・アップロードは行っていない。
