# AnalyzerのYM2608 FM／SSGとSega PSGの比較

2026-10-24。[音源別初期音量](analyzer_chip_levels_01.md)のピーク振幅校正後、
PSGが大きく聞こえるという報告に対し、YM2608のFM・内蔵SSG・Sega PSGを比較した。

## 結果

Analyzerの実際のmixed engine、44,100 Hz、master=1で、同じ440 Hz付近の単音を測定した。
FMは無変調のcarrier一つ、SSGは1 CH・固定volume15、Sega PSGは1 CH・attenuation0。
他の音源・noise・envelope・rhythmは無音。warmup 0.25秒後の1秒を比較する。

| 基準音 | 現初期値での半peak-to-peak | DCを除くRMS | FMを1としたRMS比 |
| --- | ---: | ---: | ---: |
| YM2608 FM | 0.128818 | 0.091084 | 1.00 |
| YM2608 SSG | 0.172235 | 0.171089 | 1.88 |
| Sega PSG | 0.128818 | 0.128818 | 1.41 |

**YM2608のSSGへSega PSGを合わせると、Sega PSGは約33%大きくなる。**
SSGへのAC RMS一致はSega PSGのstandalone倍率`0.855443076`、
Genesisの既存0.35補正を考慮したMixer倍率`2.444123075`に相当し、現在のMixer上限2を超える。
単純なclampでこの案を適用しない。

一方、YM2608のFMへAC RMSを合わせる候補では、Sega PSGは現在の約0.707倍
（約29%小さく）、SSGは約0.532倍になる。
Sega PSGだけならstandalone倍率`0.455419922`、Genesis Mixer倍率`1.301199777`に相当する。
これは候補の計算であり、初期値はまだ変更していない。

この表と比較音声は再調整前の記録。以後、SSGは維持し、Sega PSG・AY・NESだけを
下げる方針を[PSG系の再調整](analyzer_psg_levels_01.md)として適用した。
現在の`render_analyzer_psg_comparison.mjs`は、その採用した調整の前後比較を生成する。

## 測定の意味と調整箇所

- 定常単音の出力比較であり、曲や音色ごとの聴感音量を測定したものではない。
  220／440／880 Hzを測り、実周波数と量子化も記録した。
- SSGにはDC成分があるため、絶対peakやDCを含むRMSで比較しない。
  半peak-to-peakとDCを除いたAC RMSを併記する。
- YM2608は既存wrapper内でFM＋ADPCMの左右出力とSSGのmono出力を合成している。
  現在のMixerはチップ全体の1 stripで、FM対SSGの比率を保つ。
  SSGだけを下げるには合成前の制御を追加する必要がある。
- このFM／SSG比率は、現在のcoreとwrapperの合成結果である。
  実機基板のアナログ出力を測定した比率ではない。
- 新しい音量定数、SSG専用gain、Mixer上限の拡張は、この比較では追加していない。

## 比較中に修正したMixer経路

YM2608AudioEngineは`generateStereoView()`を優先するが、AnalyzerのMixerは
`generateStereo()`に接続していた。このためYM2608の表示gain・pan・muteが実PCMへ反映されなかった。
Analyzerの接続先を実際に消費するViewへ修正した。

借用Viewの配列長は予約容量のため、PCMChipMixerは呼出しで指定した有効frame数だけを処理する。
未使用tailへgainを掛けず、gain rampも余分に進めない。
この修正は音量定数の変更とは別で、既存のMixer設定を実出力に反映するためのもの。

## 記録と再実行

[測定JSON](analyzer_psg_balance_01.json)に9条件のPCM統計・実周波数・倍率候補・source hashを保存した。
各音源のfresh coreを用い、unity出力×Mixer gainと実初期値出力が一致することも検査する。

```sh
node scripts/measure_analyzer_psg_balance.mjs --out docs/issues/analyzer_psg_balance_01.json
node scripts/render_analyzer_psg_comparison.mjs
```

聴き比べ用WAVは`release/analyzer-psg-balance/`へ出力する。
順序はFM → SSG → Sega PSG、各1秒、間に0.3秒の無音。

- `01-current.wav`：現在の初期値。
- `02-fm-rms-candidate.wav`：FMのRMSにSSG／PSGを合わせた候補。アプリへ適用するものではない。

聴き比べ用にのみ各区間の平均DCを除き、端を10 msでfadeする。
区間ごとのpeak正規化は行わず、基準音のACレベル差を保つ。

## 検証

- 関連自動試験591件中590件成功、失敗0件。既存の外部compiler依存1件はskip。
- 実音源6経路のunity／初期値比較で補正が1回だけ適用されることを確認した。
  最大sample誤差は約`2.42e-8`。YM2608のFM・SSGとも、明示gain・pan・mute、
  reset後のgain維持、同じcore履歴からのWAV出力を確認した。
- 借用PCMの予約tailを変更せず、renderの分割と0-frame呼出しでもgain rampが
  有効frame数だけ進むことを検査した。
- CLIビルド、Analyzer ZIP生成、配布物のローカル参照752件の検査が成功した。
- ソース版と配布stageの両方でChromium／WebKitのUI試験が成功した。
  YM2608のFM・SSGで、実際のView経路の音量比が初期値で約`1.03357`、
  明示50%で約`0.5`となり、Mute時の実PCMが完全な無音になることを確認した。
  保存・再読込・Reset・FX保持の既存UI試験も成功した。

```sh
node scripts/check_analyzer_mixer_levels.mjs --out docs/issues/analyzer_mixer_levels_validation.json
node --test --test-concurrency=4 docs/vgm_analyzer/*.test.mjs test/playback-core.test.mjs test/msx-render.test.mjs test/msx-opm.test.mjs test/y8950-export.test.mjs web/soundchip_mixer*.test.mjs
node scripts/check_analyzer_mixer_browser.cjs
node scripts/check_analyzer_mixer_browser.cjs --root=release/itch_vgm_analyzer_analyzer-psg-balance
```

修正済みAnalyzer ZIPは`release/hello_ymfm_wasm_analyzer-psg-balance_itch_vgm_analyzer.zip`。
ZIP内370ファイルがstageとbyte一致することを確認した。
SHA256は`31dcf225b10dfdd0033a415560753e05b00ccc2a07b6bc00d294a6739a883fbf`。
