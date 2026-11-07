# 8580 cutoffの分離測定とopt-in試作（2026-11-07）

独立probeのLP／HPを同じ条件で測り、研究用profile `8580-cutoff-crossover-v1` を追加した。未使用の10設定で交点誤差はすべて改善したが、周波数ごとの振幅には悪化も残る。**8580限定・既定Off**を維持し、本番Player／Synth／SDKには採用していない。既知8580ファイルの拒否も維持する。

## 測定とfit

[事前固定plan](sid8580_cutoff_plan_01.json)と[方法](sid8580_cutoff_method_01.md)を先に残した。同じ実sample tick・harmonicでLP／HPの振幅比を取り、log周波数上の0dB交点を推定する。これは**operational LP=HP crossover**であり、任意のQでの−3dB点や実機の内部poleとは呼ばない。共通のRC／gainやQは理想的な線形系では比から消えるが、mode別gain、非線形、noise、量子化、高調波には限界がある。弱い値・不安定・clip・交点内部の欠測を除外し、片側しかない交点を作らない。PCMのgain／DC／phase補正は行わない。

trainingはFC64／128／256／512／1024／1536／2047、48kHz、sustain4、RES0。全caseのvolume12は出力量子化への対策として事前固定し、入力levelの補正には使わない。[189 captures](sid8580_cutoff_training_before_01.json)の7交点から整数係数をfitし、holdoutを見る前に固定した。参照は別processの公開APIを通したblack-box測定で、GPL実装や係数表の転用はない。FC0の30Hz anchorは元のまま・未測定である。

[fit JSON](../../third_party/sidera/8580-cutoff-calibration.json)は補正根拠・元入力hashを保持する。[13の解析テスト](../../test/sid8580_cutoff_metrics.test.mjs)は理想系・無効条件・合成training・偽のcurveを拒否するfit guardを確認した。cutoffと既存resonanceは独立flagで、candidate quality executableでは `--8580-cutoff-calibration`／`--8580-calibration` を指定する。

## 未使用条件の結果

holdoutは未学習FC96／192／384／768／1280／1792の6設定と、FC192／1280・sustain15・RES12・44.1k／96kHzの4 interaction設定。各flag組合せ（Off、resonanceのみ、cutoffのみ、両方）を各270 capturesで比較した。[独立解析](sid8580_cutoff_validation_analysis_01.json)は実captureとcurveの対応、参照270件・candidate dry90件の不変、同じread events、fit後の再調整なしを確認している。

| 比較（10設定・180 LP／HP周波数点） | Off → cutoffのみ | resonanceのみ → 両方 |
| --- | ---: | ---: |
| 交点の平均絶対相対誤差 | 9.855% → 0.918% | 9.866% → 0.902% |
| 交点誤差が改善した設定 | 10／10 | 10／10 |
| filtered／dry振幅比の平均絶対誤差 | 1.331dB → 0.648dB | 1.216dB → 0.317dB |
| 周波数点の改善／悪化 | 148／32 | 164／16 |

未学習FCだけの6設定では交点平均誤差9.769%→0.865%。4つのrate／level／RES interactionとは別に集計した。残差が最大のFC96は交点約−3.081%、振幅最大誤差約2.795dB。9周波数の決定的な補間結果であり、実機精度の信頼区間や全周波数の音質保証ではない。悪化した点をholdoutへ合わせ直していない。

## 互換性・browser・配布

[policy検証](sid8580_cutoff_policy_01.json)は6設定で既定Off、4通りの独立flag、無効setterの原子的拒否、reset／Stop・model切替・instance分離を確認した。6581の42scene、歴史的PCM9件、8580 positive3設定、24 Native quality・24 raw Rust model caseが成功した。旧84 PCM／bus66／実CPU36、元API376,200samples、既存resonanceの260件PCM／read／capture範囲も保持した。

[従来browser `_04`](sid8580_probe_browser_04.json)はChromium／WebKit計146一致、[追加cutoff browser](sid8580_cutoff_browser_01.json)は各30、計60一致。同じ実PCM／read／sample tickとflag・reset／Stopを比較した。これはbatch WASMの検証であり、full C64／AudioWorklet／実曲・実聴の合格ではない。

CIは17stepsへ解析13件、training fitの再計算、policy、両flagの候補holdoutを追加した。[source kit `_04`](sid8580_probe_sourcekit_04.json)は63 compiled inputsから全5出力／receiptが同一compilerでbyte一致し、15検証commandが成功した。最終`release/tetorica_sid8580_quality_20261107-cutoff_sources.zip`は**122files／1,214,079bytes**、SHA-256 `369fbbe97506407679c74f58c57cdad3973d7cea2880e79d86660717d27fc02c`。CRCと全archive filesのbyte一致も確認した。

matching source／2WASM・可読checker・数学／fitテスト・cutoff training JSON・plan／方法／compact解析・license／Rust noticesを含み、Native binary・GPL SID oracle・ROM・音楽・PCMを含めない。大きい過去resonance training記録はSHA／provenanceのみ。固定runtime33／68／75・既存SID／PSID／RSID receiptも成功し、GitHub Actions実行・commit／push／tag／公開は行っていない。

次は低FCの残差、mode別gain／loading、read・audio pipelineを分けて調べる。研究用C64／Worklet接続の設計も後続とし、実8580曲・音切れ・実聴・本番UI採用は未完了のままにする。過去のsource ZIP／報告は書き換えていない。
