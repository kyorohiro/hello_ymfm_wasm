# PS1の残り3 Browser checkerを独立PCM判定へ統一

2026-10-28。[前回のclock診断](ps1_audio_clock_01.md)でvoice UIへ導入した判定を、Mode／PCM→ADPCM／Sample Editorの3 checkerへ展開した。製品runtime・C++・WASM・Mixer・固定SDK・Tauri・versionは変更していない。commit／push／公開は行っていない。

## 変更内容

- `check_playground_ps1_browser.cjs`、`check_ps1_adpcm_encoder_browser.cjs`、`check_ps1_sample_editor_browser.cjs`は、既存の共通`audio_clock_audit.cjs`のprocessorと自己完結した分析関数を使用する。共通helperとvoice checker自体のbyteは不変。
- 実音声はcapture input0、独立24bit sample counterはinput1へ接続。pilotを音源mixへ入れず、capture出力はzero、物理出力のgainも0に固定する。Sample Editorの複数AudioContext／private previewは従来のhost選択を維持し、contextごとに区別して収録する。
- 全captureでpilotの連続性、clock測定rowの有効性、収録長とcallback framesの一致、clock gap集計の一致を検査する。audible／silentの再試行前にも検査し、不一致captureを捨てて成功扱いにしない。
- global `currentFrame`の不一致は`clockContinuous`と診断へ分離して保持する。音源PCMのfinite／音程／stereo／preview／editor／Keyboard／RAM／Stopなど各checkerの既存条件は維持する。
- 3本のreportはschema2、oracle名・全capture集計・clock異常・checker／helperの凍結SHA256を記録する。既存voice reportはschema3のまま。

## 最終検証

source本体／実Run ZIP × 3 checker × Chromium／WebKit × Main／Workerの**新規24条件すべて成功**。同時Browser負荷を避けて直列実行し、計**771 captures／6,500,352 frames**でpilot PCM連続、測定row有効を確認した。

| Checker | Source captures / frames | Run ZIP captures / frames | Clock異常capture |
| --- | ---: | ---: | ---: |
| Mode | 198 / 1,744,896 | 198 / 1,744,896 | ZIPの1件 |
| PCM→ADPCM | 68 / 622,592 | 68 / 622,592 | 0 |
| Sample Editor | 119 / 880,640 | 120 / 884,736 | 0 |

Mode ZIPのChromium Workerでは1 captureにclock不一致を保持した。先頭frame6272の次が6528となり、期待6400との差は+128。そのoffsetが窓の最後まで残ったため、127 callback rowsが`firstFrame + offset`と一致しなかった。一方、独立pilotの16,384 samplesは欠落・重複0、非有限値0、入力長も一致。**1異常capture／127不一致rowsを、127回のPCM欠落と解釈しない**。reportに総数と先頭32診断rowsを残し、再試行や無音だけで隠していない。

- 共通helper18件＋新report集約25件＝**単体43件成功、失敗・skip 0**。既存helperの負例も今回再実行した。破損pilot／欠落・重複／入力長・非有限値等の拒否に加え、旧oracle、失敗report、hash不一致、異なるZIP、route欠落・重複、失われたclock異常などを拒否する。
- 4スクリプトの`node --check`と`git diff --check`が成功。checker／helper／配信assetの凍結検査も各Browser reportで成功。
- 既存voice UIのsource209 captures／1,953,792 framesとZIP206 captures／1,941,504 framesの**前回8条件は今回再実行していない**。現在のchecker・helper・同一Run ZIPのSHA256と一致することを照合して再利用し、新規24条件へ加算しない。
- 実Run ZIPは従来の37,403,090bytes、SHA256 **`ab83876a942add3ab6a91ff7ab53e333dcc943134642ae151721235c0f6556e2`**のまま。製品の再package／音声処理変更は不要だった。

共通helper SHA256は`0f1199be1e7719aa43b693cd941fba5cab5d5771e7508be30fc2dc71fc9d6133`。checker別hash、全route集計、全clock異常captureの診断、raw report／log hashは[JSON](ps1_capture_migration_01.json)へ保持する。

## CIへの接続

`.github/workflows/itch-web.yml`で4本のpackaged PS1 checkerを実行した後、`check_ps1_capture_reports.cjs`がreportを集約する。旧schema／oracle、現在のchecker／helperと異なるhash、不一致のRun ZIP、欠けた／重複したBrowser・execution条件、失敗したPCM検査、消されたclock異常等を拒否する。clockだけの異常をPCM破損に置き換えず、実際の診断を集約reportへ保持する。

実Run ZIPを指定したローカルの集約も成功。**4 reports／16 routes／592 captures／5,193,728 frames**で`passed:true, pcmContinuous:true, clockContinuous:false`、Modeのclock異常1 captureを保持した。この16 routesは今回のZIP12条件と再利用した前回voice ZIP4条件であり、新規16条件の再実行を意味しない。sourceの前回voice4条件も別に照合済み。

CIでは4 checkerともその実行中に新しいreportを生成する。**remote GitHub Actionsはまだ実行していない**。ユーザーのcommit／push後にworkflow結果を確認する。ローカル集約はremote成功を先取りしたものではない。

実reportは`/private/tmp/ps1-capture-migration/{source,zip}/ps1-{mode,adpcm,sample-editor}-browser.json`、再利用voiceは同directoryの`ps1-voice-editor-browser.json`、集約は`ps1-capture-summary.json`、単体logは`logs/capture-unit.log`。

## 限界と次の作業

pilotは別capture入力の連続性を検査する独立信号であり、SPUが生成した全frameの同一性を直接証明しない。音源PCMの性質は既存条件で別に検証する。物理device／driver deadlineや全環境の可聴ノイズ不存在は保証しない。全試験で物理出力はmuteし、人による実聴は行っていない。global clockの実装原因も未特定のまま。

次はユーザーのcommit／push後のremote CIと、Tauri GUIでの実操作・実聴。PS1 Mixerの基準音量は別作業で未測定unity1.0のまま。前段階の成功・失敗は元判定の履歴として保持し、遡って書き換えていない。今回の変更は未commit／未push／未公開。
