# VGM Analyzerの音源別初期音量

2026-10-24。Genesisの耳合わせで決めたバランスを、
[Playgroundの基準測定](playground_chip_levels_01.md)とAnalyzerの実経路の測定に基づく標準初期値へ更新する。
プリセット選択を追加する方式ではなく、未調整の音源とMixer Resetの初期値を置き換える。

## 基準と適用

- 共通の目標単音振幅は`0.12881777435541153`。
  無変調FM carrier、PCM／wavetableのsin波、PSGの矩形波など、既知の基準入力の
  左右半peak-to-peakを比較する。曲の知覚音量や発音数を自動補正する処理ではない。
- 既に測定した音源は`SOUNDCHIP_MIXER_PRESETS.calibrated`の種類別値を共有する。
  AnalyzerのIDをcanonical名へ対応づける（`psg`、`gameBoyDmg`、`nesApu`、`segaPcm`）。
- Genesis engine後段に既存のFM×0.9／PSG×0.35があるため、
  Analyzerのstrip初期値はそれぞれ校正値÷0.9、校正値÷0.35にする。
  FMは`0.862153`、PSGは`1.840254`。RF5C164は`0.280286`を1回だけ適用する。
  OPL／OPM等へ付属するPSGにはGenesis補正を適用しない。
- 再生engineの実source ownerとUIの構成情報の両方から経路を解決し、
  混在構成やサンプルレートadapterを通す場合も対応する。
  画面の操作前から初期値を設定するため、再生・seek・再開・WAV出力で同じ値になる。
- 再生中の測定polling、AGC、limiterは加えない。
  register／sample RAM／音色／coreの出力単位は変更しない。
  既存の再生engineとnpmの標準音量も変更しない。
  Analyzerと再生coreを共用するCLIのWAV出力には同じ新しい初期値が適用される。

## Analyzer専用の追加測定

NESはAnalyzerがJSNES/PAPUを使い、PlaygroundのWASM経路と異なるため、
実際のAnalyzerの44,100 Hz出力を測った。48,000 Hzの比較とFDS無音時の同一性も記録した。
他の5種類も`createPlaybackEngine()`を通し、Mixerをunity、masterを1にして測定した。
外部のゲームROMや音声デバイスは使用しない。

| Analyzer音源ID | 初期倍率 | 基準 |
| --- | ---: | --- |
| `nesApu` | 1.981272 | JSNES/PAPUのpulse、50% duty、固定最大volume |
| `segaPcm` | 0.261709 | 8-bitの自作sin波ROM、1 CH |
| `k051649` | 1.103844 | SCC／SCC+の自作sin波、1 CH |
| `ymf278b` | 1.465915 | FM単carrier、reset時mix、wave ROM不要 |
| `msm5205` | 0.128849 | 自作nibble列によるADPCM decoder基準 |
| `okim6295` | 0.128849 | 自作sample table／ADPCM、1 voice |

[NESの測定記録](analyzer_nes_levels_01.json)と
[Analyzer専用5種類の測定記録](analyzer_extra_levels_01.json)に、
220／440／880 Hz、量子化・実周波数、PCM統計、source hash、制約を保存する。
440 Hzの値を固定倍率に使い、他の周波数やsample rateを平坦化しない。
YMF278BはFMの基準で、wave楽器の個別音量を揃えるものではない。
NESもpulse基準であり、DMC／FDSなど内部音源間のバランスは保持する。

## 保存とReset

- 保存済みの明示`gain`／`pan`／`muted`は維持し、新しい初期値より優先する。
- 保存されていない項目だけを構成に応じて補う。pan／muteだけの編集で、
  そのときのgain初期値を共通の保存値として固定しない。
- 読込み、engine接続、再生の開始だけでは初期値をlocalStorageへ書き込まない。
- Resetは音源の保存上書きを消し、現在の構成の測定初期値とmaster=1へ戻す。
  FX設定は保持する。以後のファイル切替も、そのファイルの経路に合う初期値を使う。

## 再実行

```sh
node scripts/measure_analyzer_nes_levels.mjs --out=docs/issues/analyzer_nes_levels_01.json
node scripts/calibrate_analyzer_extra_levels.mjs --out=docs/issues/analyzer_extra_levels_01.json
node scripts/generate_analyzer_mixer_defaults.mjs
node scripts/generate_analyzer_mixer_defaults.mjs --check
```

生成器は同じtarget・必要な6種類・実測からの倍率・source hashを検査し、
`docs/vgm_analyzer/mixer_calibration_data.js`を生成する。
itch.io向けAnalyzer ZIPも生成値を検査し、共有presetとAnalyzer専用dataを同梱する。

## 検証結果

- Analyzer／再生core／MSXの関連自動試験は551件中550件成功、失敗0件。
  外部の`mml2mdr`を必要とする既存の1件のみskip。
- [実PCMの検証記録](analyzer_mixer_levels_validation.json)では、GenesisのFM・PSG・RF5C164と
  Y8950構成のPSGを、配布WASMと実際の再生engineで確認した。
  校正後の基準振幅は約`0.128818`で、目標との最大相対誤差は`0.000001446`。
  unity出力との倍率比較から、補正が一度だけ適用されることを確認した。
  再生し直したPCM、および同じPCMからの16-bit WAVエンコードも完全一致した。
- Chromium／WebKitの両方で、ソース版と配布用stageのUI試験が成功した。
  初期表示・Play時の適用・明示値の保存と再読込・構成別PSG初期値・Reset・FX保持を確認した。
  実WASM／AudioWorkletを使い、試験用の出力先だけを無音化した。
- CLIビルドとitch.io向けZIP生成が成功した。配布物のローカル参照752件を検査し、
  ZIP内370ファイルとstageの内容が一致することを確認した。

```sh
node scripts/check_analyzer_mixer_levels.mjs
node scripts/check_analyzer_mixer_browser.cjs
node scripts/check_analyzer_mixer_browser.cjs --root=release/itch_vgm_analyzer_analyzer-measured-levels
node --test --test-concurrency=4 docs/vgm_analyzer/*.test.mjs test/playback-core.test.mjs test/msx-render.test.mjs test/msx-opm.test.mjs test/y8950-export.test.mjs
node scripts/build_cli.mjs
sh scripts/package_itch_vgm_analyzer.sh analyzer-measured-levels
```

以前の音量を手動保存している環境では、MixerのResetを押すと新しい基準値を使える。
今回の変更にはnpm公開・itch.ioへのアップロードを含まない。

後続の[FM／SSG／PSG比較](analyzer_psg_balance_01.md)で、YM2608の借用PCM経路がMixerを
迂回する不具合を修正した。実PCMの検証記録もFM／SSGを追加した6経路へ更新している。
OPNA内のSSGは既存の内部比率を維持し、FMの共通targetへ個別に揃えたものではない。

さらに[PSG系の再調整](analyzer_psg_levels_01.md)で、Sega PSG・AY・NESの最終初期値だけを
FM基準のAC RMSで抑えた。上記の共通peak校正とNESの`1.981272`はその前段の測定記録であり、
この3音源の現初期値は再調整文書を参照する。
