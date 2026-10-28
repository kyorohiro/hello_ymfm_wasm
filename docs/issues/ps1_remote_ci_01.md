# PS1 packaged Browser検証のremote CI確認

## 2026-10-29 follow-up — 修正commitのremote確認が完了

対象commitは`3c784c18ae1a8869b1b45178ee0ad42a9c6d76f9`。以下の2 workflowは共にattempt 1で成功し、downloadした成果物も検証した。このturnの変更は作業記録のみ。

- [itch web release ZIPs — run 40751583440](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40751583440)：全steps成功。汎用Playground新規20条件と、**PS1新規4 reports／16条件／594 captures／5,201,920 frames**が成功。今回は既存reportの再利用を含まない。pilot PCMは全て連続し、ModeのChromium WorkerとVoice editorのChromium Mainのclock異常各1 captureを診断へ保持した。
- Sample EditorはChromium Main／Workerでsynthetic stream＋実MediaRecorderによる録音を検証。Linux WebKit Main／Workerはnativeの`getUserMedia`がある一方`MediaRecorder`がなく、disabled button・代替入力noticeを検証して`tested:false`を記録した。forced flagはfalse。**この2条件を録音成功には数えない**。実マイク・device permissionは使用していない。
- [WASM SDK build and parity — run 40751583248](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40751583248)：全32 builds側とCD-DA／PC Engine CD ADPCM側の両jobが成功。29 chip＋2 application audio＋1 PS1 instrument＝32 builds／63 outputs、192 source pathsを検証した。29 chipの独立比較40,474件、PS1 24 voice／311,605 framesの各検査も成功。PS1 Native／WASM比較98,828 interleaved samplesの最大差は0（許容1e-6）。snapshot 2,294 filesの記録追記前checkoutとのhash一致、2,394 metadata recordsと再buildした63 outputsのhash一致、repository input不変を確認した。unit128件・audio Node55件・Python3件も成功。

release artifact `12845242194`とvalidation artifact `12844946681`の外側CRC、4つの配布ZIPの内側CRC・manifest全fileのbytes／SHA、`SHA256SUMS`、manifestのsourceCommit、両artifact内manifestのbyte一致を確認した。実Run ZIPは**37,401,619 bytes／930 entries・files**、SHA256 `e2bead8543381582c6f96233f0ed9c92afbddf9830a0e2ff177c57fdf968ae0f`。現checker／helperとこの実ZIPで集約を再実行し、remote集約と`archive.path`以外は完全一致した。旧runやローカルの別ZIPとは混ぜていない。

主証拠は`/private/tmp/ps1-ci-40751583440-verified/artifact-verification.json`（SHA256 `b30f960cb8c89e7e60d0572d2e0c898b6a23c535b53d963c27f161f04fb84363`）と`/private/tmp/wasm-ci-40751583248-verified.json`（`690ddd3648228a2313cf3f8efd2c20224e95f0e8aa94922f18732ecc8874a478`）。actual artifact／report／logのIDとhashは[JSONのfollowUps](ps1_remote_ci_01.json)に追加した。

同HEADのSBI `40751583147`、VGM `40751583058`、Pages build/deployment `40751582674`も全てattempt 1で成功。Pagesの自動deploymentは完了している。npm／itch.io／SDK tagの手動release操作は今回行っていない。

旧ローカル録音decode失敗の原因は未確定のまま。今回の成功で過去の失敗原因を解決済みにはしない。Tauri GUI・人による実聴は未実施で、物理device deadlineや可聴ノイズ不存在を保証しない。製品runtime・Mixer値・npm versionはこのturnでは変更していない。

## 以下は79d9ab時点の履歴（本文変更なし）

2026-10-28。対象は`itch web release ZIPs`のUbuntu 24.04上での実行。製品runtime、音源コア、WASM、Mixer値、npm versionは変更していない。過去のローカル検証記録は[ps1_capture_migration_01.md](ps1_capture_migration_01.md)へ残し、remote成功へ読み替えない。

## 現在の状態

対象commitは`79d9ababe8a565fca8c2a8d5519c647605cbe3a7`。[run 40676381623](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40676381623)のattempt 1は、汎用Playground Browser検証のstep 22で失敗した。PS1専用のpackaged検証4本と集約（steps 25–29）は到達せず、成功とも失敗とも判定できない。

同じcommitについて`rerun-failed-jobs`を1回実行した。**attempt 2（job 122778611612）も失敗**。今回はgeneric Playground（step 22）、Game Boy（step 23）、SNES BRR（step 24）、PS1 mode／ADPCM／voice editor（steps 25–27）は通過した。PS1 Sample Editor（step 28）のWebKit Mainで録音非対応のボタンを押そうとしてtimeoutし、集約（step 29）は未実行。この文書の両attemptの失敗は残し、ローカル修正の結果と分けて記録する。

2026-10-29 JSTにテスト側の2修正をローカル検証した。Sample Editorのsource／Run ZIP／強制録音非対応の新規12条件、単体171件、実ZIPを指定した4 report集約が成功した。**修正版は未commit・未push・未公開で、remote再確認は未実行**。remote workflowが全体成功したとは扱わない。

## Attempt 2で到達した検証と残った失敗

generic Playgroundは5 modes × Chromium／WebKit × Main／Workerの20条件全てに成功。attempt 1のeditorロードtimeoutは同一commitの再実行では再現しなかった。これにより初回の根本原因が確定したわけではない。

packaged PS1のMode、PCM→ADPCM、voice editorはそれぞれ4条件に成功。合計**12 routes／477 captures／4,329,472 frames**で、pilot PCM連続、clock異常0。各reportは対象commitのchecker／共通helper SHAを記録し、manifestと同じRun ZIP SHAへ一致している。

| Remote checker | Routes | Captures | Frames |
| --- | ---: | ---: | ---: |
| Mode | 4 | 199 | 1,748,992 |
| PCM→ADPCM | 4 | 68 | 622,592 |
| Voice editor | 4 | 210 | 1,957,888 |

Sample EditorのChromium Main／Workerはlog上で成功したが、WebKit Mainが`Record microphone`のdisabled buttonをクリックしようとして40秒timeoutした。画面は`Microphone recording is unavailable here. Choose an audio file or draw a cycle.`と表示していた。これは録音APIを使えない環境へのテスト側の前提不足であり、音源PCM破損を示す結果ではない。WebKit Workerへは到達していない。

Sample Editor reportはchecker完走後に書くため生成されず、4本を揃える集約も未実行。logだけのChromium2条件をreportのcapture総数へ加算しない。`itch-web-release-zips`もuploadされていないため、今回はRun ZIP実体のローカルSHA再検証はできていない。

attempt 2が生成したRun ZIPは37,401,617 bytes、930 files／directory 0、SHA256 `4595cf4cfd130f72e18d37183ff955d3ea45a7900c6e295500a25f5af8335a23`。同一commitでも再packageしたZIP byteはattempt 1と異なるため、各attemptのmanifest／reportを混ぜない。

録音APIがある環境では従来のsynthetic streamと実MediaRecorderによる録音→変換→保存・track解放確認を続け、ない環境では製品UIの非対応表示とファイル／手描き入力を検証するよう、Sample Editor checkerだけをローカル修正した。製品と同じ`Boolean(mediaDevices?.getUserMedia && MediaRecorder)`で分岐し、非対応時はdisabled button、代替入力のnotice、生成track 0をassertし、`microphone.tested:false`を記録する。未録音のassetを要求せず、録音できたと偽装しない。

`--force-no-media-recorder`は非対応pathを明示的に検証するためのflag。native／effective capabilityと、録音を実際に検証したrouteをreportへ残す。ファイル入力、手描き、ADPCM変換、24 voice、Keyboard、Stop、独立PCM判定はどちらのpathでも維持する。

2026-10-29 JST時点でcheckerのSHA256は`8ddedc25c161d157d4bf9a92477ddeb37c6c3d24a81e88f15b91b899f4cb6d02`に固定した。最初のsource試行で下記の別の失敗が出たため、その履歴を残し、forced-unavailableを先に確認してからnormal sourceの試行2とRun ZIPを別名で検証した。後述の3 matrixは完了したが、未commitの修正版がremoteで検証済みとは扱わない。

### ローカルnormal source試行1の失敗（未解決）

Chromium Mainで録音停止後の変換完了を待って40秒timeoutした。Sample Editorのnoticeは`Unable to decode audio data`で、comparison jobs／PCM capturesは空、page errors／bad responsesも空だった。試験のJSONは生成されていない。この結果を録音非対応pathの成功や音源PCMの不具合へ読み替えず、実MediaRecorderから`decodeAudioData`へ渡す経路を切り分け中。

凍結した失敗logは`/private/tmp/ps1-sample-capability-source.log`、SHA256 `8c402686eb09931883ded632a6ffae55810cf7e42c3c83dfcd8d1ff5113e8e63`。このlogを再試行で上書きしない。以後のnormal／forced試行は別のファイル名で記録する。物理出力muteは維持し、実マイク・device permissionは使用していない。

### ローカルforced-unavailable Run ZIPの4条件

`--force-no-media-recorder`でChromium／WebKit × Main／Workerの**4条件が成功**。各30 captures／221,184 frames、計**120 captures／884,736 frames**で独立pilot PCMが連続した。全4条件でnative capabilityは対応あり、強制後はMediaRecorderがなく非対応となった。録音の`testedRoutes`は空、`unavailableRoutes`は4条件全てで、**録音機能を検証した結果ではない**。

Chromium Mainの1 captureでclock不整合1件を保持した。index38、offset4864で`currentFrame`は146048を重複観測し、期待値は146176。一方、同captureの16,384 pilot samplesに欠落・重複・非有限値はなく、入力長も一致した。この時計診断は無視せず、reportへ残している。

reportは`/private/tmp/ps1-sample-capability-forced-zip.json`、SHA256 `3f7484a12a17a2d55bfa44f83dcfc80c90a753fa2e8724daf2de988f3321549c`。使用した既存ローカルRun ZIPは37,403,090 bytes、SHA256 `ab83876a942add3ab6a91ff7ab53e333dcc943134642ae151721235c0f6556e2`で、remote attempt 1／2のZIPとは別に扱う。

`/private/tmp/ps1-mic-probe.cjs`による専用診断はtoolの権限確認段階で中断され、processも出力も生成されず実行されなかった。decodeの原因は依然未確定。normal source試行2が後に成功したことだけを根拠に、試行1のdecode失敗を解決済みにしない。

### ローカル検証の最終結果

| Sample Editor matrix | Routes | Captures | Frames | Clock異常capture | 実MediaRecorder録音の検証 |
| --- | ---: | ---: | ---: | ---: | --- |
| Source normal試行2 | 4 | 119 | 880,640 | 0 | synthetic streamで4条件 |
| Run ZIP normal | 4 | 119 | 880,640 | 1 | synthetic streamで4条件 |
| Run ZIP forced unavailable | 4 | 120 | 884,736 | 1 | 未検証。非対応UIを4条件 |
| 計 | 12 | 358 | 2,646,016 | 2 | 実マイクは未使用 |

新規12条件全てでpilot PCM連続、非有限値・欠落・重複なし。normal ZIPにもChromium Mainの1 captureでclockの重複観測を保持した。capture6、index38、offset4864でframe181888、期待182016、直前181888。16,384 pilot samplesの連続性は保たれており、forced試験のclock異常と別の1件として記録する。

CIと同じSDK関連5 test filesの128件＋clock helper18件＋report集約25件の**単体171件全て成功、失敗・skip 0**。この追加実行ではfull stdoutを保存していないため、`/private/tmp/ps1-ci-fixed-unit-summary.txt`はterminal要約であると明記した。先行する128件のfull logとは区別する。

実Run ZIPを渡した集約も**4 reports／16 routes／591 captures／5,189,632 frames**で成功し、clock異常capture2件を保持した。これは今回のnormal ZIP Sample Editor4条件と、同じ実ZIP・現在のchecker／helper SHAに一致する以前のMode／ADPCM／Voice12条件の組み合わせ。**新規16条件を全て再実行した結果ではない**。forced録音非対応4条件は別matrixであり、この集約へ混ぜていない。remote attempt 2の別ZIPの12条件も流用していない。

最後に新3 Browser reportのchecker／helper SHAと実ZIPのSHAを再照合し、現ファイルとの一致を確認した。再利用する3 reportについても集約時に同じchecker／helper／ZIPの一致を要求している。

| 最終ローカル証拠 | SHA256 |
| --- | --- |
| `/private/tmp/ps1-sample-capability-source-attempt2.json` | `590c2f8b00719307306817974ecba6f45cc6c599e01d16c6308595a434a5f72f` |
| `/private/tmp/ps1-sample-capability-normal-zip.json` | `3c67662272e85cfdbddccade5504d3ca1ac8926e057837a978722e45b87e8022` |
| `/private/tmp/ps1-ci-fixed-capture-summary.json` | `ced975fa0b159398dd5181de8fb85fe2ff3a08a30f336d156b7b88d52ca142f4` |
| `/private/tmp/ps1-ci-fixed-unit-summary.txt`（terminal要約のみ） | `44b3511a4785bf5fab1b5f0f7ca2fb0e98d3f57259403838cd614aded798ed07` |

製品runtime・gain・npm versionには変更を入れていない。残る確認は修正commitのremote CI再実行。初回sourceのdecode原因調査と、Monaco外部通信・起動待ちの再現性は未確定の履歴として残る。Tauri GUI確認・人による実聴は別作業。

## 別workflowのWASM SDK検証

同じcommitの[WASM SDK build and parity run 40676381545](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40676381545)にも失敗がある。全32ビルドを扱うjob `122775757381`はstep 7のunit testが128件中126成功・2失敗。`test/application_audio_sdk.test.mjs`に残る旧期待値の31 builds／61 outputsと、現在の32 builds／63 outputsの不一致である。このjobの後段のcompileには到達していないため、compile失敗と扱わない。

一方、同workflowの`CD-DA and PC Engine CD ADPCM` job `122775757807`は成功した。最終のjobs再照合でも失敗は上記unit stepだけであり、両jobが失敗したとは扱わない。

ローカルでは`test/application_audio_sdk.test.mjs`だけを修正した。fixtureのsource収集をchipだけの`installed.artifacts`から`installed.builds`全体へ広げ、PS1 instrumentのsource closureも含めた。期待値を32 builds／63 outputsに更新し、29 chips＋2 application audio＋1 instrumentの構成、`ps1_spu`がgeneric chip IDへ入らないこと、全source closureの検証件数も明示した。

CIと同じ5 Node test filesを実行し、**128件全て成功、失敗・skip 0**。これはローカルのunit検証であり、SDKの全compile・parityを今回実行したものではない。未commit・未pushなので、修正版のremote workflowはまだ未実行。PS1 packaged CIの結果と、この別workflowの修正・再確認を混同しない。

- 修正ファイルSHA256：`7ce13d86234fc35bf5a657ab721e3c5163845f06cd11c9ed5d0d6dc556945bc7`
- 単体log：`/private/tmp/wasm-ci-40676381545-unit-fixed.log`、SHA256 `db2af7d2c1df4756fb6ae4a2aeb52ff87cffd38ec9775e5663ba006992064ee7`

## Attempt 1の確認できたこと

- native／WASM PS1コア、PCM→ADPCM、Sample Editor、ADSR／reverb／波形編集およびPCM判定helperの単体試験、Node Exampleが成功した。
- standalone PS1 SPUのChromium／WebKit × Window／DedicatedWorkerの4条件が成功。各条件はNode WASM基準との32,776 sample comparisonsで最大差0、計8,194 stereo frames。これはPlaygroundのAudioWorklet再生試験ではない。
- Synth・Analyzer・Playground full・Runの4 ZIPを生成し、CRC、展開後stageとのbyte一致、ソース・ライセンスclosure、Runのbundle参照を検証した。manifestの`sourceCommit`も対象commitに一致した。
- SynthとAnalyzerのChromium／WebKit確認が成功した。
- 以降の汎用Playground検証は、最初の`chromium / genesis / main / /`で起動完了待ちが40秒を超過した。pageは`Loading Playground…`、startupは`Project ready. Loading the code editor… The first load may take a little longer.`のままだった。記録された`errors`、`failed`、`bad`、`consoleErrors`は全て空だった。
- 失敗したgeneric checkerのreportは`passed:false`、記録caseは1件。PS1 mode／encoder／voice editor／Sample Editor／集約reportは生成されていない。検証失敗のため`itch-web-release-zips`のuploadへ到達せず、配布ZIPそのものは今回downloadしていない。

Run ZIPについて確認できるのは、CI内のarchive検証結果とgeneric Browser reportが同じSHA256を記録していることまで。

| 項目 | CIが記録した値 |
| --- | --- |
| Run ZIP | `hello_ymfm_wasm_dev_itch_playground_for_run.zip` |
| Bytes | 37,401,620 |
| ZIP entries / files / directories | 930 / 930 / 0 |
| Expanded bytes | 43,027,872 |
| SHA256 | `68d69e474f5accf71dda48ba15808105f7d0a870c32c24b4f61441e942799d5d` |

## ひとつ前の失敗とは区別する

[run 40671354331](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40671354331)は以前のcommit `581be50b8ce6f6421b7eec26d59c4eefa93f126e`の実行。generic Playground検証のGenesis Main／Workerが成功し、次のChromium／Mega-CD Mainの型検査で失敗した。

この前回runには、cdnjsのMonaco 0.52.2 `vs/language/typescript/tsWorker.js`を`importScripts`で取得できなかった`NetworkError`が明記されている。製品の`playground_monaco.js`はloader／editor／Workerをこの外部CDNへ要求する。URLの恒常的な誤りより一時的な通信失敗が疑われるが、DNS・CDN制限などの内訳は不明。

一方、今回attempt 1はeditorロード中のtimeoutであり、同じURLの取得失敗はreportへ記録されていない。**前回にCDN失敗があったことだけを根拠に、今回の原因まで確定しない**。PS1／PCM不具合とする根拠もまだない。型検査assertやnetwork error検出は削らず、まず同一commitの再実行を確認する。

## 保存した証拠

attempt 1の`itch-web-validation` artifactはID `12810553037`。複数upload pathの共通祖先が`/home/runner/work`なので、ZIP内部のreportは`_temp/itch-web/`、manifestは`hello_ymfm_wasm/hello_ymfm_wasm/release/itch-web-release.json`にある。7日保持のCI artifactと`/private/tmp`のローカル控えは永続的な配布場所ではない。

| ローカル控え | SHA256 |
| --- | --- |
| `/private/tmp/ps1-current-validation.zip` | `281683de7d1716274d094517a247b99e389d65c1dfe8debf10240194c7a5067b` |
| `/private/tmp/ps1-current-itch-ci.log` | `4f9ed034c8c836d081c8744463d739d56ca0d8707573eb9c151b54b812408c47` |
| `/private/tmp/ps1-previous-itch-ci.log` | `ed36b05d43aca565785e10a0444fd91c775e712356f0d02f5a2c90b972965c7a` |
| `/private/tmp/ps1-validation-attempt2.zip` | `25f488afc1832a41774a716252b9589ce5152dde9d0e5baca92b972111d4dd51` |
| `/private/tmp/ps1-itch-ci-attempt2.log` | `ed661474d94240d4ef531a09b2a2abb02d885d87404113fb7888f2f27cba04c8` |

attempt 2のvalidation artifactはID `12811259078`で、同じ内部path配置を使う。内部reportのSHA256、archive情報、失敗本文と未実行の範囲は[JSON](ps1_remote_ci_01.json)へ記録した。remote CI全体の成功、remoteでのpackaged PS1全16条件完了、Tauri GUI確認、人による実聴はまだ主張しない。物理出力muteの自動検証は、可聴ノイズ不存在やdevice deadlineを保証しない。
