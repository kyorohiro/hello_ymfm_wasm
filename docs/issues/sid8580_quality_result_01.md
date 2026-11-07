# 8580の比較条件整備とopt-in resonance試作（2026-11-07）

独立8580 probeの初期状態・sample tick・観測窓を揃え、波形／ADSR／filterを外部参照と比較した。明確だったresonance差へ、**既定Off・8580限定の研究用damping profile**を追加した。未使用の設定で平均誤差は改善したが、悪化する点もあり、本番Player／Synth／SDKへの採用は行わない。既知8580のfile import拒否も維持する。

## 比較条件

[測定方法・一次資料](sid8580_quality_method_01.md)に設定と限界を残した。

- 全3voiceをAD／SR0・Gate OFF・TEST＋Triangleへ置き、skip後に各engine自身のOSC3／ENV3を読む。active voiceもTEST中に目標sustainへ進め、観測可能な初期状態を確認してから同じcycleで発音する。read値の注入や非公開stateの書換えはしない。
- 新しい外部oracleは公開APIで985,248Hzのchip-rate DECIMATEを使い、1tickにつき1sampleを生成する。候補／参照とも同じ整数host phaseで出力tickを選ぶ。skip中も同じphaseを進め、capture範囲と実sample tickを記録する。[6設定のcapture検証](sid8580_quality_capture_reference_01.json)も成功した。
- DC＋既知harmonicのsin／cosをHann重み付きで同時fitし、同じcore・同じ条件のfiltered／dry振幅比を測る。元PCMのgain／DC／phaseを補正せず、raw RMS比だけで音量・音質を合わせない。
- BPは自分自身のpeakから両側の−3dB点を求め、`apparent Q = peakHz / bandwidth`とする。片側が見えない、周波数重複、幅0等ではQを作らない。高FCの高調波診断を、到達不能な高周波基本波のsweepと混同しない。
- 既知sine＋DC／phase、harmonic混合、PCM保存、連続BPの解析解、無効条件を用いた[数学テスト](../../test/sid8580_quality_metrics.test.mjs)7件が成功した。

条件を揃えたのは観測可能な状態とsample gridであり、全noise state、read／audio pipeline、motherboard RC、analog非線形まで等しいとは宣言しない。外部参照は固定エミュレーターであり実機測定ではない。GPL参照は別processのままで、候補へその実装・tablesを取り込んでいない。

## 初期測定と研究用profile

[初期228ケース](sid8580_quality_comparison_01.json)はNative／WASM／chunk・初期read・sample tickが一致し、165の有効transferを得た。[解析](sid8580_quality_analysis_01.json)では元候補のRES15 apparent QがFC128で約1.706、参照約2.500、FC256でも約1.700対2.492と低かった。中心周波数の違いは別問題として残した。

fitに使ったのは**FC128／sustain4／48kHzのRES4・8・12・15だけ**。元のRES0係数1,448をanchorに、`Q(res)=Q0*exp(slope*res)`の傾きをblack-box測定から求め、整数の逆Q係数へ丸めた。参照実装の係数表をコピーしていない。FC256と中間RES・2つの入力levelはfitへ使用しなかった。

profile名は`8580-resonance-logfit-v1`。候補quality executableの`--8580-calibration`、controlled checkerの`--calibrated-8580`で明示選択する。defaultはOff。変更は8580のdamping係数だけで、cutoff／gain／RC／ADSR／noise／read pipelineは変えない。

## 未使用の設定での検証

[before](sid8580_quality_validation_before_01.json)／[after](sid8580_quality_validation_after_01.json)は各260ケースのNative／WASM／chunk・sample tickを確認した。[独立解析](sid8580_quality_validation_analysis_01.json)は、fitに使っていないFC256、RES2／6／10／14、sustain4／15の**8曲線**を区別して集計している。260の参照結果と61のcandidate dry結果はbefore／afterで同一だった。

| 未使用の設定 | Off | On |
| --- | ---: | ---: |
| 8曲線のQ平均絶対相対誤差 | 13.43% | 3.10% |
| 176周波数点の平均絶対誤差 | 1.437dB | 1.126dB |
| 同RMS誤差 | 1.745dB | 1.285dB |
| 同最大絶対誤差 | 4.024dB | 2.467dB |

Q誤差は7／8曲線で改善したが、RES2／sustain15では0.415%→0.482%へわずかに悪化した。周波数点では109改善・**67悪化**。RES14／sustain4の約1400Hzでは絶対誤差0.053dB→2.436dBという悪化例もある。すべての音・周波数で良くなったとは扱わない。

FC128／RES15の高密度再測定ではQが1.780→2.507、参照2.579へ近づいたが、これは**学習設定の再現確認**であり、9本目の独立holdoutではない。今回のholdoutは48kHzのBPと2levelに限られ、LP／HP・全rate／全level・実機品質の合格とはしない。

## 既存動作・browser

[校正policy検証](sid8580_calibration_policy_01.json)は6設定のdefault Off、無効値の原子的拒否、error解除、reset／Stopでの明示flag保持、stale handle、独立instanceを確認した。6581の42sceneはflag Onでも不変、8580は3rateのpositive controlでfilter出力だけが変化する。元sample API376,200samples、旧84 PCM、bus66・実CPU36も保持した。defaultのcontrolled228ケースも以前のPCM／read／capture範囲と一致した。

[Chromium／WebKit](sid8580_probe_browser_03.json)は各50 chip／bus＋12実CPU＋11 controlled quality、**計146一致**。quality側は実PCM／read／readEvents／sample tickとopt-in・reset／Stopを確認した。AudioContext／AudioWorklet、full C64、実曲・長時間・実聴の検証ではない。

## matching source kit・CI

[独立source kit検証](sid8580_probe_sourcekit_03.json)は62 compiled inputsから5出力とreceiptが同一compiler profileでbyte一致。kit内だけでbuild、84＋66＋36、校正policy、候補側controlled228、数学7件、元API376,200samplesの計11検証commandが成功した。親repositoryへのsource fallbackやGPL oracleを使っていない。

最終`release/tetorica_sid8580_quality_20261107_sources.zip`は**105files／1,059,166bytes**、SHA-256 `8356799fd4b2f8313d570687e089f04615cbfd32366f731bcb3aaab681741b62`。可読source／Node checker／数学テスト／2WASM／m6502 license／Rust標準library notices、compact fit／holdout記録を含む。大きいtraining-case記録はSHA／provenanceだけを保持し、Native binary・GPL SID参照・ROM・音楽・PCMは含めない。CRCと全archive filesのbyte一致も確認した。

| 最終WASM | bytes | SHA-256 |
| --- | ---: | --- |
| chip／bus／opt-in profile | 1,392,873 | `ca7c478e2dbc57f0a0203f908d625037aeaa92f39b23d7541db4d4be4d873c77` |
| CPU＋SID | 1,474,941 | `ba3836b85148ea93a8e732400b1f178dc7ee2db1cc0da14872b94d42a118a79f` |

```sh
node scripts/package_sid8580_sourcekit.mjs --plan
node scripts/package_sid8580_sourcekit.mjs --version NEXT --verify
```

`--plan`は出力せずclosureを確認する。生成時は既存stage／ZIPへの上書きを拒否するので、新しいversionを指定する。`--verify`は独立copyをbuild・検証し、再buildで作ったNative等をarchiveへ混ぜない。Node.js22＋、Rust1.91.1とWASM target、C11／WASM対応Clang、ZIP用Python3を使用する。Playwrightを要するbrowser checkerと、別GPL参照による比較はoptionalであり、kitの標準検証はネットワークや外部engineを必要としない。

CIは数学・候補quality・校正policy・source closureを加えた13steps。build／test部分をローカルで確認し、固定runtime33builds／68outputs／75mirrors、既存SID／PSID／C64 receiptも成功した。GitHub Actionsでの実行、commit／push／tag／公開は行っていない。

次は**cutoff／中心周波数の差を別に調べる**。FC256のpeakは候補約1600Hz、参照1750～1800Hzに残る。より広いFC matrixと、別training／holdoutで基本波・高調波を測り、resonanceや全体gainへ吸収しない。RC／DAC／combined wave／pipeline、実8580曲・C64／Worklet・実聴・本番UI／parser統合も後続。今回のprofileは明示opt-inの研究用のままとする。
