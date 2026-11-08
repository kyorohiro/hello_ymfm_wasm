# SID Player: 通常再生と観測負荷の比較（2026-11-08）

通常SID Playerで、**無計測20条件・計測60条件の計80条件が完走**した。
今回の範囲では、製品のDSPや画面を変更すべき不具合は特定できなかった。
旧研究Labの「予算超過」を音切れ回数として扱えない点と、計測条件の違いを整理した。
製品JS／WASM／gainは変更していない。

[固定Plan](sid_worklet_perf_plan_02.json)・[全実行記録](sid_worklet_perf_01.json)・
[厳密集計](sid_worklet_perf_summary_01.json)・[独立再計算](sid_worklet_perf_verification_01.json)・
[変更範囲と既存配布確認](sid_worklet_perf_scope_01.json)。

## 条件と観測範囲

- 自作の同一programを元から6581／8580として生成した2ケースと、以前に選定した元PAL／8580のVBI、CIA、RSID各1ケース。実曲のheaderは変更せず、失敗を見て曲を選び直していない。
- 各ケースは4モードを正順・逆順で2回ずつ実行。WebKit 26.6、Chromium 153.0.8010.12を逐次起動し、同時に動く実験page／AudioContextは1つ。44,100Hz、128frames／block。OSの他の活動や電力・JIT状態は制御していない。
- 計測3モードは、345blocksのwarmup後、frames **44,160〜264,704**を測定。合計13,232,640frames。比較する境界の再生位置、cycle／IRQ／NMI／play counter、target metadataは10組すべてで一致した。完全なCPU・RAM・SID register／Envelope／phaseやPCMの一致を確認した、という意味ではない。
- 無計測の`ordinary`は、原本processorをそのまま配信。ブロックごとのtimer／PCM scanを入れず、約1秒＋5秒のmain-thread待機と実際のRPC境界で進行を確認した。同一のPCM窓や処理時間の測定とは扱わず、時間の欠測を0と表示しない。
- `capture`の全frame検査はwarmup込みで合計5,294,080frames。非有限値・左右不一致・channel欠落は0。全80条件の独立した終了境界analyser標本は有限・非zero出力を確認。これは全条件の全PCMを検査したことや実聴の代わりにはならない。
- 全80条件で停止・context終了を確認し、page／console error・HTTP失敗・外部requestは0。物理出力はgain0、曲・ROM・PCMの保存なし。

## 時間の集計

各行は10実行・17,230測定blocks。数値はwindow内のblock数で重み付けした観測wall time。
`process()`には`renderInto()`とstereo copyが含まれ、純粋なWASMやCPU使用時間ではない。
集計更新・境界state取得の負荷はtimer外にあり、下の数値へ全observer overheadが含まれるわけではない。

| engine | 条件 | 元のprocess()平均 ms | scan込みspan平均 ms | process()の生閾値超過 | うち名目1ms差引後も超えるもの |
| --- | --- | ---: | ---: | ---: | ---: |
| WebKit | timerのみ | 0.586 | 0.586 | 9 | 0 |
| WebKit | timer＋全frame検査 | 0.571 | 0.590 | 5 | 2 |
| WebKit | timer＋画面監視抑制 | 0.741 | 0.741 | 17 | 5 |
| Chromium | timerのみ | 0.584 | 0.584 | 0 | 0 |
| Chromium | timer＋全frame検査 | 0.595 | 0.599 | 0 | 0 |
| Chromium | timer＋画面監視抑制 | 0.726 | 0.726 | 0 | 0 |

全条件のtimerは`Date.now`だった。128framesの目安は約**2.902ms**なので、整数msで記録された3msは境界の不確かさを含む。WebKitの生閾値超過31blocksのうち24は、この名目1msの差引で分類が変わる。残る7も、OSによるdescheduling等を含み得るwall spanであり、7回のdevice underrunを検出したとは言えない。1msは宣言した分類上の仮定で、実測した時計誤差の保証ではない。

今回のwindow最大はWebKit4ms／Chromium2ms、warmup最大は各3ms／2ms。
負の時計差・非有限な時計値・不整合spanは0だった。細かいhistogram区間や平均を出しても、元の時計の精度が向上するわけではない。

画面監視を止めた条件は、同じcase・反復のtimerのみ条件より、20組すべてでprocess()平均が高かった。これは「画面を動かすと音源が速くなる」という因果の証明ではない。2反復とこの実行条件では、UIを無効化すれば改善するという根拠は得られなかった。

全frame検査を加えた場合のprocess()平均の差は、WebKitで正3／負7、Chromiumで正5／負5と方向が混在した。同じcapture内のscan区間を追加した観測差は平均約0.019ms／0.004msだが、観測処理全体のコストや、旧Labの超過の原因をそれだけで説明した値ではない。

## 結論と残る確認

[旧研究Lab](sid8580_real_worklet_result_01.md)の248／62,016blocksは、実曲6subtunes×30秒、異なる画面監視・capture開始方法・常時timerで得た値。今回の通常Playerの5入力×2反復×5秒窓とは条件が違うため、超過率の差を改善率として扱わない。旧最大9msはinstance通算値であり、今回のwindow最大と同じ指標ではない。旧9msの原因を特定したとも、今回の短い測定で否定したとも扱わない。

今回の結果から、音源の精度や操作を変える最適化、監視画面の無効化、通常Playerへの常時計測は追加しない。再現可能な診断tool、時計の不確かさを区別する集計、再開可能な記録とCIの純粋テストを追加した。既存のPlayer／Synth ZIPの176／160原本は現在のtreeと一致し、再梱包は不要。

実際の音切れ、実Safari／WKWebView、長時間・background・出力device変更、高負荷時の安定性は別確認。人の実聴で問題があれば、曲・subtune・model・browser・発生位置を記録して、この固定planを残したまま別の調査条件を作る。

再実行・中断再開・pilot／fullの区別は[開発者ガイド](../sid-worklet-performance.md)を参照。
SDK33 builds／68 outputs／75 mirrorsと両Mixer freshness check、診断のunit12件、CI YAML・構文・diff検証は成功。GitHub Actions実行、commit／push／公開は行っていない。
