## 2026-10-29 — PS1 SPUのADSR図を直接ドラッグ編集

- SPUタブへA／D／S／Rの操作点を追加。左右は各rate、Dの上下はSustain Level。矢印キーでも1段階調整でき、数値欄と連動する。クリックだけでは書き込まず、PC Keyboardの試奏focusを保持。既存Retrigger設定で、このeditorが保持するnoteへ反映する。
- 更新はframeごとにまとめ、前のinspector requestを待って送信。未送信draftのsnapshot上書き、異なるpointer、channel切替／hide／blur／disconnect等の古いdrag、失敗したwriteの楽観表示を処理する。idle pollingなし。DSP／WASM／公開APIは不変。
- 関連Node144件、校正／出典319件成功。実SPUを通るsource Chromium／WebKit×Main／Worker4経路と、実Run ZIPの両browser Main2経路でmouse・矢印・owned retrigger・reserved bits・他voice・Keyboard・FX／Stopを確認。物理出力はmute、実聴／Tauri GUI／remote CIは未実施。
- 通常Playground包装成功、両ZIP CRC成功。Runは931files、SHA256 `b1b410a183adef9a279c431cbfa057ce2c2d6deaae18a20fb1a93db0f8fd0fcd`。`release/hello_ymfm_wasm_ps1-envelope-drag-dev_itch_playground_for_run.zip`。元の音量測定JSONは変更せず、cache-only token差分と今回のexact UI revisionを別receiptで検証し、以降のcode変更は引き続き拒否する。
- 詳細：[ps1_adsr_graph_01.md](ps1_adsr_graph_01.md)、同名JSON、`ps1_adsr_graph_ui_receipt_01.json`。未commit／未push／未公開。npm／SDK releaseやTauri importは今回行っていない。以下は各時点の履歴。

## 2026-10-29 — SDK 0.1.6正式公開・本体／Tauri採用、npm 0.2.33公開完了

- SDK [v0.1.6](https://github.com/kyorohiro/tetorica-soundchip-native/releases/tag/v0.1.6)を正式公開。SDKの説明5filesだけを整えたcommit `ba2a52943f0ac43b02b57f07b48ffb8b3ccb54f6`をmain／tagへpush。タグCI [40779666941](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/40779666941)のNative 5構成・WASM 6種類・publisherがすべて成功した。公開ZIPは1,246,902 bytes／455 members、SHA256 `2e6126935756c517d10cc6849977fb0132387e7abf6160185c341ea67b4fcc17`。GitHub asset digest、SHA256SUMS、CRC、全454payloadのmanifest hash／sizeとローカル準備物の全byte一致を確認。公開資産は`release/soundchip-sdk-0.1.6/`へ保持した。
- 本体とTauriは同じ公開ZIPとタグcommitへ切り替え、`localCandidate`を除去した。manifest SHAは`e0a86268aaa3dbbb2bf0567bf2a11925bf8da785b846b58ea4b8f71d280adfeb`。PS1を正式固定SDKから再ビルドし、全77配布JS／WASMが従来と同byteであることを確認。旧候補との変更は5つのMarkdownとmanifestだけ。以前の全32ビルドCIは旧候補の結果として保持し、608 source records／192 unique paths、63 outputs、30checkerが正式版と同一であると別途照合した。原測定JSONのhashやDSPを更新して検証を通す変更はない。
- 本体のSDK Python142件・Node116件、両Mixer generatorのfreshness／再現が成功。配布PS1 source28files／SDK24inputs、CD-DA／MSM5205各8files／6inputsから、SDK checkoutのない場所で同じJS／WASMを再生成。C11／C++14も成功。初回のEmscripten cache sandbox拒否は同じbuildの権限付き再実行で解決し、所有権変更なし。
- [tetorica-fm2612 0.2.33](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.33)をnpmへ公開し、`latest=0.2.33`を確認。PS1 SPU／ADSR／FX／ADPCM・sample helpers、SNES BRR／Neo Geo ADPCM-A encoder、Game Boy preview、任意calibrated 25種類と正式SDK sourceを収録。公開tarballは1,951,319 bytes／unpacked7,394,104 bytes／1,004files、SHA256 `e0225b57b3936cd449d9d93a42712b481a69d4551141f4e160e3807b474271b7`。npm shasum `bb15cff9d01281f65eb7edb3bc4a8719c7103410`とSHA512 integrityが一致し、registryから再取得した全byteも検証済みtarballと一致した。
- 最終npm tarballの隔離install・全1,004payloadのbyte照合、1,097refs／28WASM engines／15renderers／385declarations、NodeNext・Bundler・Browser型が成功。installed DX7／HuC6280をChromium／WebKit × Main／Workerの8条件で実際に鳴らし、Mixer・live変更・Keyboard・Stop／再開を確認。ユーザーがnpm loginと追加web認証を完了した。非対話publishの初回EOTPは公開前の失敗として保持し、同じ検証済みtarballの対話retryが成功。認証URLやcredentialは記録しない。
- Tauriへ新しい完全Playground ZIPをimportし、1,065frontend filesと正式SDK pinの一致を確認。Python31＋Node31、Cargo Native757件成功・2ignored・38filtered。ignoredは明示されたmonitor microbenchmarkと物理audio-device smoke。対応source ZIPは2,085files、SHA256 `6030f1d16dc58480aa6841043c95b12c754a3e206c024a72127b38527ced3234`、24snapshot checks成功。Native C/C++／Rustとchip JS／WASMは不変、物理device・Tauri GUIは開いていない。
- 開始時の本体commit `1abd009bae02c323676d7e4551e047b62dd2757c`は最新5workflows全成功。WASM [40778420584](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40778420584)は32builds／63outputs／40,474 exact chip comparisonsとPS1 Native parity成功。itch [40778420717](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40778420717)はBrowser校正PS1 48／WS48／POKEY96行の完全matrix、PS1公開UI 16routes／595captures／5,206,016framesを含め成功。別clock診断では36windowsのPCMは連続し、Chromiumのglobal clock診断1件を保持する。これらは旧候補・旧commitの証跡であり、正式版consumer commitの新しいCI結果へ読み替えない。
- 採用変更は途中でユーザーがcommit／push済み。本体 `9cb0ab772763c5f1583b76023b3461b657c8fb2d`、Tauri `6ac2f78d204c5055de0dc1f6576d05979e0397b2`、ともに`tetorica-fm2612 0.2.33`。この公開後の記録追記は未commit。itch.io upload／desktop app releaseは今回行っていない。詳細：[SDK採用](sdk_016_release_adoption_01.md)／[JSON](sdk_016_release_adoption_01.json)、[npm公開](npm_ps1_mixer_release_01.md)／[JSON](npm_ps1_mixer_release_01.json)。次は新consumer commitのCI確認と、必要なら手動のitch.io／desktop公開。以下は各時点の履歴。

## 2026-10-29 — POKEYの単体／追加／DualのMixer基準を実測、System／任意npm presetは25種類へ

- POKEYを未測定unity `1.0`から、単体・追加・Dual 1台目 **`0.413033`**、Dual 2台目 **`0.413034`**へ変更。distortion 5／volume 15の保持squareを使用し、現在のGenesis Sega PSGの実測AC RMS `0.19981240874842915 × 0.35`＝`0.06993434306195019`へ合わせた。2台構成も各chipへ個別適用し、合計から半分にする補正は追加しない。Mixerの表示は丸めた41%。保存済みの絶対値は優先するため、比較時は**System**を選ぶ。
- Chromium／WebKit × 44.1／48 kHz × Main／Worker × primary／extra／dual-first／dual-second × 220／440／880 Hzの96 POKEY、8 FM・8 Sega PSG対照、8 Dualケース（左右split＋center sum）が成功。反映後も同じ全条件を新規測定。raw／verifyは各248 captures／14,023,680 frames、独立pilotは全sample連続、全Stopはexact zero。verifyの最大相対誤差はpeak 0.008457%、RMS 0.006655%、Dual予測 0.033344%。rawのclock診断2件は保持し、verifyは0件。初回は測定コードがWorkerの非同期`mixer.get()`を待たず停止したため、awaitを修正して全条件を取り直した。DSPの修正ではない。
- 固定SDK raw core＋独立C++ 10 Hz speaker oracleと、実WASM＋既存speaker Workletを比較。24条件とDual独立性の5,397,360 Float32比較で差0。実Tauri bridgeも手元では別途同数を比較して差0、出典hashを保持した。必須試験は隣接Tauri repoに依存せず、clean checkout相当の28 reference testsも成功。Browser測定は物理出力muteであり、実聴・実機のアナログ出力・device deadlineの保証ではない。
- 既存153測定、PS1、WonderSwanのraw SHAを保持。実生成物の28 modesをgit HEADと比較し、POKEY以外のfactory値が不変と確認。汎用Mixerのunity、raw PCM、core／WASM／既存10 Hz blocker、初期コードの音色・音量は変更なし。cacheは`pokey-mixer-calibration-1`。旧UI cacheの2つの既知import値だけを許可するWonderSwan receiptを追加し、原report／元source／receipt objectのhashを照合する。
- 関連Node **456件成功・skip 0**、両generator再現・原source 293 assetsのfreshness・actionlintが成功。installed npmは1,004 files／1,097 refs／28 WASM engines／385 declarations、NodeNext・Bundler・Browser型も成功。npm cacheへのsandbox EPERMは同じ検証の権限付き`--skip-build`再実行で成功し、所有権変更なし。任意の`calibrated`を25種類へ拡張し、共通値／ID別値の絶対置換と繰り返しrestoreを検証した。
- Playground両ZIPを新規生成・CRC成功。実Run ZIPは37,403,840 bytes／931 files、SHA256 `e9cad9c3cffa0255a9372bc3674832fd6157d7a1d795cc896d080ce8691b22af`。その実体でChromium／WebKit × Main／Worker × 単体／Dualの8条件成功。公開MixerのSystem値、unityとのPCM比、System復元、左右分離、Stop／Rerun、VFS／Shell、実Workerを確認。ZIP checkerには独立pilotはなく、raw／verifyの連続性証明をZIPへ流用しない。
- 詳細：[pokey_chip_levels_01.md](pokey_chip_levels_01.md)、[raw](pokey_chip_levels_01.json)／[verify](pokey_chip_levels_verify_01.json)／[offline](pokey_chip_levels_offline_01.json)／[実ZIP](pokey_chip_levels_zip_01.json)。itch web CIへunit・自己完結offline・全条件verify・実ZIP試験を追加し、timeoutを60分へ拡張。今回のremote CIは未実行。**未commit／未push／未公開**、npm 0.2.32／SDK 0.1.6 local candidate据え置き。開始時HEADはユーザーcommit `abe7e6e1`。次はSystemでの実聴とcommit／push後のremote CI確認。以下は各時点の履歴。

## 2026-10-29 — WonderSwanのMixer基準を実測、System／任意npm presetは24種類へ

- WonderSwanの主音源／追加音源を**`1.0 → 1.172528`**へ変更（約17.25%増）。32点4bitの自作sine、CH0 volume15/15、全DAC範囲を用いるためheadroom1。既存speaker境界のDC除去後を測り、raw DAC／音声core／通常の9/9音色／endpointの別倍率.25を変更しない。153測定とPS1 .128832を含む既存倍率・共通目標値を保持。保存値は絶対優先、試す場合はMixerのSystemを選ぶ。
- Chromium／WebKit × 44.1／48 kHz × Main／Worker × primary／extra × 220／440／880 Hzの48 WS＋8 FM対照が成功。反映後も同じ全条件を新規測定し、peak最大相対誤差6.50e-8、RMS .061%未満。各112 captures／6,200,320 frames、独立pilot連続／Stop exact zero／今回clock異常0。rawは292配信資産＋5 script/reportのSHAを保持。Native／WASMは12条件・1,338,528比較で差0、実speaker Worklet VMの552,600 framesも既存DC補正のみを確認した。
- 既存PS1測定のraw SHAと全出典を保持し、UIの2つの既知importのcache version値だけに独立receiptを追加。作成時に元asset bytes／SHAの一致を確認し、receipt自身のobject SHAを別にpinした。コード、path、追加query、重複import、DSP／transport／WASMの変更は引き続き拒否。型importのcache queryを除いてpublic presetのweb／docs mirrorは一致。
- 関連Node296件、generated checks、installed npm 1,004 files／1,097 refs／28 engines／385 declarations／NodeNext・Bundler・Browser型が成功。初回のfixture CLI1件のflag不足は修正して全件再実行、npm cache EPERMは権限付き再実行で解決し所有権変更なし。Playground両ZIP CRC成功。実Run ZIPは37,403,523 bytes／931 files、SHA256`f8a961be4e04a0ca85a6c992b044482cfa0c8af56d1ce9dcf2c3c0cb76b3e302`。この実ZIPでChromium／WebKit Main／Worker4条件、起動／VFS・Shell／実PCM／Stop・Rerunが成功。実聴は行っていない。
- 詳細：[wonderswan_chip_levels_01.md](wonderswan_chip_levels_01.md)、raw／verify／offline／ZIP JSON。itch web CIへ新基準・出典・cache receiptの試験と全条件のWS再測定を追加。未commit／未push／未公開、npm0.2.32／SDK0.1.6 local candidate据え置き。次はSystem実聴とcommit／push後のremote CI確認、残る未測定POKEY（単体／2台）の基準測定。以下は各時点の履歴。

## 2026-10-29 — PS1のMixer基準を実測し、System／任意npm presetへ反映

- PS1の未測定unity `1.0`を、主音源・追加音源とも**`0.128832`**へ変更。既存153測定／他音源の倍率／共通目標値は保持。public calibratedは既存22＋PS1の23種類。汎用Mixerのunity、raw PCM、core／WASM／初期サンプル、明示的な保存値は変更しない。試す場合はMixerでSystemを選ぶ。独立Sample Editor previewはraw gain 1を維持する。
- 専用112-frame／64-byte ADPCM sine（filter0／shift0、decoded peak .875）、単音full sustain／reverb Offで測定。Chromium／WebKit × 44.1／48 kHz × Main／Worker × primary／extra × 220／440／880 Hzの48 PS1条件＋8 YM2612対照が成功。生成済み係数でも同じ全条件を新規再測定し、peak最大相対誤差2.01e-9、RMS 0.05747%。各112 captures／6,200,320 frames、全pilot連続／Stop exact zero、今回clock異常0。最初の測定コードのglobal名誤りと、Worker予約時間が混ざる短いwarmupは修正して再測定し、旧結果は流用しない。
- Native固定coreと配布WASMのoffline12条件／1,317,252 Float32比較は差0。関連Node182件、両generator再現／出典293 assets＋5 script/report hash、installed npm 1,004 files／1,097 refs／28 engines／385 declarations／NodeNext・Bundler・Browser型が成功。保存common／ID値は絶対置換し、繰り返しrestoreで倍率を重ねない。
- Playground download／Run ZIP新規作成・CRC成功。実Run ZIPは37,403,458 bytes／931 files、SHA256 `f6f331217f15b08ee3ff9871a39c971761e60b8294038d299e280de9280c4669`。このZIPでChromium／WebKit Main／Worker4条件、初期コード・Examples・CH24 Keyboard・SPU試奏・追加音源・Stop等が成功（196 captures／1,736,704 frames、全pilot連続／clock異常0）。物理出力はミュートで、実聴・過去のnoise解決・Native device deadlineの保証ではない。
- 詳細：[ps1_chip_levels_01.md](ps1_chip_levels_01.md)。raw／verify／offline／ZIPの各JSONを同じ接頭辞で追跡。itch web CIへNode182件と全条件の係数再測定を追加し、ZIP／npm buildは生成物と出典を検査する。今回の変更は未commit／未push／未公開、npm 0.2.32・SDK 0.1.6 local candidateは据え置き。次はユーザーのSystem実聴とcommit／push後のremote CI確認。WonderSwan／POKEYは引き続き未測定unityで別対象。以下は各時点の履歴。

## 2026-10-29 — 修正commitのremote CI全5件成功、実配布ZIPとPS1集約を照合

- 修正はユーザーcommit／push済み。対象`3c784c18ae1a8869b1b45178ee0ad42a9c6d76f9`のWASM SDK、itch web、VGM、SBI、Pagesの5 workflowsがattempt 1で全てsuccess。以前の`79d9...`の両remote失敗や最初のローカル録音decode失敗は、その時点の履歴として変更しない。
- WASM run `40751583248`は両job成功。29 chip＋2 application audio＋1 PS1の32 builds／63 outputs、192 source closureを確認。40,474 chip比較は全差分0。PS1は24声／311,605 frames、実Nativeとの98,828 interleaved samplesも差分0。unit128、application-audio Node55／Python3成功。inputSnapshot2,294 filesと記録追記前checkoutのhash一致を検証し、`repositoryInputsUnchanged:true`。証跡は`/private/tmp/wasm-ci-40751583248-verified.json`等。
- itch run `40751583440`は汎用Playground20条件、PS1の新規4 reports／16 routes／594 captures／5,201,920 framesと集約を含め全工程成功。clock異常2 capturesを保持しpilot PCMは連続。Sample EditorはChromiumの実MediaRecorderをsynthetic streamで2条件検証、Linux WebKitは実際にMediaRecorderがないため録音未検証・非対応UIとfile／描画／演奏等を2条件確認。強制非対応flagは使っていない。
- 成功CIの4 ZIP実体を取得し、CRC、SHA256SUMS、manifestのcommit／全収録file hash、validation側manifestのbyte一致を照合した。実Run ZIPは37,401,619 bytes／930 entries・files、SHA256 `e2bead8543381582c6f96233f0ed9c92afbddf9830a0e2ff177c57fdf968ae0f`。現checker／helper SHAとこの実ZIPで集約を再実行し、remote結果とarchive path以外完全一致。今回の16 routesは全て新runの結果で、過去reportを流用していない。
- 追記記録：[ps1_remote_ci_01.md](ps1_remote_ci_01.md)／[JSON](ps1_remote_ci_01.json)。このturnは作業記録のみ更新し未commit。SDK tag／npm公開／itch uploadは実施していない。Pagesの自動deploymentは上記CIで成功している。過去の録音decodeの原因未確定、Tauri GUI実操作・実聴は別の未確認事項。次候補はPS1のMixer基準音量測定（現在は未測定1.0）。以下は各時点の履歴。

## 2026-10-29 — remote CIの失敗を確認し、SDK件数と録音可用性の検証コードを修正

- commit `79d9ababe8a565fca8c2a8d5519c647605cbe3a7`のitch CIを確認。同一commitのattempt 1はeditor起動待ちでtimeout、1回再実行したattempt 2は汎用Playground20条件とPS1 Mode／ADPCM／Voice計12条件を通過した。Sample EditorはChromium2条件がlog上成功後、Linux WebKitで録音非対応のdisabledボタンを押して失敗。集約へ未到達で、remote全体は失敗のまま保持する。
- 別のWASM SDK CIはcompile前のunitで旧期待値31 builds／61 outputsにより失敗。`test/application_audio_sdk.test.mjs`を32／63へ更新し、fixtureへPS1を含む全buildのsource closureを収録。29 chips＋2 application audio＋1 PS1 instrumentの分離も検証する。CI同一の128単体がローカルで成功。修正版のremote compile／parityはまだ未実行。
- Sample checkerは製品と同じ録音APIの可用性を検査し、対応時は実MediaRecorder、非対応時はRecord無効・案内・track未生成を確認して`tested:false`を記録する。file／波形編集／保存／24声／Keyboard／Stop／PCMは全環境で維持。通常source4＋ZIP4＋強制非対応ZIP4の新規12条件、358 captures／2,646,016 frames成功。clock異常2 captureは別記録し、pilotは全て連続。最初の通常source試行で録音decode失敗が1件あり、原因未確定の履歴として保持する。専用probeは実行されていない。
- 関連単体171件成功。新sample ZIP4条件と、hashが一致する以前の同一ZIPのMode／ADPCM／Voice12条件を組み合わせたローカル集約も成功（16 routes／591 captures／5,189,632 frames）。新規16条件の再実行とは扱わない。詳細とraw証拠のhash：[ps1_remote_ci_01.md](ps1_remote_ci_01.md)／[JSON](ps1_remote_ci_01.json)。
- 製品runtime／C++／WASM／Mixer gain／SDK pin／npm versionは変更なし。今回の検証コードと記録は未commit／未push／未公開。次はユーザーのcommit／push後に修正版の両CIを確認する。録音decodeの一時失敗、Tauri GUI実操作・実聴は未解決／未確認として残す。以下は各時点の履歴。

## 2026-10-28 — PS1の残り3 Browser checkerを独立PCM判定へ統一、ローカル24条件成功

- Mode／PCM→ADPCM／Sample Editorへ既存24bit pilotを展開。実音声input0とpilot input1を分離し、物理出力mute。再試行を含む全captureでPCM連続性・測定row・長さ・clock集計を検査し、clock異常は別途保持。既存の音程／stereo／preview／editor／Keyboard／RAM／Stop等は維持。
- source本体／実Run ZIP × 3 checker × Chromium／WebKit × Main／Workerの新規24条件が直列実行で成功。計771 captures／6,500,352 frames、pilot PCM連続。Mode ZIPのChromium Workerの1 captureにclock +128の差が残り127 rows不一致だが、16,384 pilot samplesの欠落・重複0。異常を破棄せず診断保持。共通helper18＋集約25＝43単体成功、syntax／diffcheck成功。
- 既存voice8条件はchecker／helper／同一ZIPのhashを照合した前回reportの再利用で、今回再実行した24条件に含めない。実Run ZIPは37,403,090bytes／SHA256 `ab83876a942add3ab6a91ff7ab53e333dcc943134642ae151721235c0f6556e2`のまま。4 reportの実集約は16 routes／592 captures／5,193,728 framesで成功し、clock異常1 capture保持。集約の16 routesには再利用voice ZIP4条件を含む。CIへ現在のchecker／helper／ZIP hash・coverage・PCM・clock診断を検査する集約を接続したが、remote Actionsは未実行。
- 製品runtime／C++／WASM／Mixer／固定SDK／Tauri／versionは変更なし。未commit／未push／未公開。次はユーザーcommit／push後のremote CI、Tauri GUI実操作／実聴。pilotは別入力の検査でSPU全frameやdevice deadlineを直接保証しない。詳細：[ps1_capture_migration_01.md](ps1_capture_migration_01.md)／[JSON](ps1_capture_migration_01.json)。以下は各時点の履歴。

## 2026-10-28 — PS1 Browserのclock不一致をPS1なしで再現、実PCMを独立検査する判定へ変更

- 前段階SDK／NativeのBrowser失敗は履歴として保持。Chromiumのglobal `currentFrame`の重複と、収録PCMの欠落・重複を切り分けた。製品JS／C++／WASM、SDK／Tauri、Mixer gain、npm versionの変更なし。
- PS1なしの最小対照試験でChromiumのclock異常を再現。起動後300msを待ち、48kHz・並列／直列graph・追加なし／Oscillator／AudioWorkletの追加・停止・切断を18条件×3窓で比較。54窓中3窓で`83072 → 83072 → 83328`型の一時的-128framesを観測し、その間も全2,592,000counter samplesは欠落・重複0。process内4回のclock読みも一致。不一致窓はretry／discardしない。
- 旧版／現行×direct／Worker×44.1／48kHzの実PS1計8条件も確認。全条件finite／pilot連続／Stop後exact zero。追加SPU破棄後16窓でprimary保持・追加側exact zero、primary隣接sample最大差も旧版と現行で一致。旧判定の公開UIも旧版と現行のChromium Workerが今回完走したが、過去の失敗は消さない。並行負荷下の別PCM描画metadata失敗ログも保持しclock根拠とは扱わない。
- test helperの独立24bit pilotでPS1公開UIの全captureを検査。負例unit18件成功、portable診断36窓／1,728,000samplesでPCM連続、Chromium clock不一致1件は診断として保持。新schema3のsource4条件＋実Run ZIP4条件が成功し、計415captures／3,895,296framesを検査。このUI matrixのglobal clockは連続。旧6成功／2失敗は元の判定の履歴として保持し、新判定の成功と区別する。既存の音程／倍音／ADSR／reverb／Stop等の条件も維持。CIへunit／portable診断を接続、YAML parse／diffcheck成功、remote未実行。
- 物理出力は全試験でmute。pilotはcaptureの別入力の連続性でありSPU全frameの直接証明ではない。音源PCMは既存音声条件と実PS1新旧比較で確認。物理device／driverのdeadline、全環境での可聴ノイズ不存在、人の実聴を保証しない。clock異常の実装原因は未特定。8条件成功はvoice UI checkerのみ。Playground PS1／Sample Editor／ADPCM encoderの3 Browser checkerは旧currentFrame assertionのままなので共通判定への展開を残す。次はその展開、Tauri GUI実操作／実聴、remote OS CI。
- 詳細：[ps1_audio_clock_01.md](ps1_audio_clock_01.md)／[JSON](ps1_audio_clock_01.json)。JSONはraw診断のhash・対照条件・不一致前後read・実SPU PCM hashを保持し、27MBのraw PCMを重複収録しない。旧SDKissue／JSON／todoへ追跡先を追記。今回の作業は未commit／未push／未公開。以下は各時点の履歴。

## 2026-10-28 — PS1をSDK 0.1.6候補へ集約、Tauri Native実装・offline検証完了、Chromium clock課題を保持

- SDK原本`w/tetorica-soundchip-native`に`vendor/mame-ps1-spu/`を追加。本体の旧`native/ps1/`全17filesをbyteを変えず移し、BSD attribution／MAME原本5files／revision／hash／改変説明を保持。`tetorica::ps1_spu`＋C header＋既存同期C ABIを提供。24 generic chip IDs／29 chip artifacts／2 application-audioに、別categoryのPS1 instrumentを加えた32ビルド。
- SDK **0.1.6は未公開local candidate**。base`3bb8d9ceffa50ad183d1ab856e031fe649425bca`、source ZIP SHA256 **`3c7c2a9cdfcb0316162f6365aef89f0c9fd92140ae4828599cd613255d153952`**、454payload＋manifest。本体／Tauriは同じ候補をpinし、`localCandidate`にbase／changedPathsを保存。候補原本は凍結済み、`/private/tmp/ps1-sdk-candidate-final/`に成果物とmetadata。本体`release/soundchip-sdk-0.1.6-candidate/`にも同じsource ZIP／metadata／SHA256SUMSを永続保持。
- SDK source audit324records／Python101件／独立展開Native24libs・51executables・30CTests／22WAVs・JavaScript参照10checksが成功。最終source＋WASM ZIPからのPS1再ビルドも成功。実WASM311,605frames、Native比較98,828interleaved samples最大差0。core／Mixer gainの変更なし。
- 本体buildは固定SDKへ委譲し、配布`sources/native/ps1/`はSDKから生成する。最終**32ビルド／63出力／40,474 exact chip comparisons**とapplication-audio／PS1 Native parityが全成功、`repositoryInputsUnchanged:true`。reportは`/private/tmp/ps1-sdk-all-parity-final/summary.json`。初回`ps1-sdk-all-parity/`は並行編集の検出で失敗したため採用せず、凍結後のfresh runで成功を確認した。
- Tauri primary／additional PS1 Nativeと既存UI／Keyboard／PS1 clientの接続を実装。Browser既定は維持。固定SDK実core29件／Native JS関連162件（新PS1 13件）／Rust793件（PS1 12件、既存ignored4件）／関連Python31件・Node31件成功。最初のread前のStopで初期24声の割当を消してしまう問題を修正し、受理済みassignment／RAMを保持する。
- 最終isolated npmは1,004files／1,097asset refs／28WASM engines／15renderers・NodeNext／Bundler／Browser型が成功。配布sourceの`--build`も生成JS／WASM全byte一致（`/private/tmp/ps1-native-sdk-source-rebuild-proof.json`）。4ZIP CRC成功、Run ZIP931files／SHA256`ab83876a942add3ab6a91ff7ab53e333dcc943134642ae151721235c0f6556e2`。
- Tauri frontend同期1,065files、frontend ZIP SHA256`67079670926b976ec84d92e330ff796c93bbd975bcf0f1a4672bfcf7563a878a`。対応source ZIP2,085files／SHA256`c02901cc47ace5ee8ff0aa5ae34bb9dc1a01fb70f153645bcbbef73d4d2e56f3`、24source pins成功。device／network未使用。
- Browser coreはWindow／DedicatedWorker×Chromium／WebKitの4条件成功（AudioContextなし）。voice UIはsource本体／実Run ZIP×WebKit Main／Worker4条件成功、同一checker hash／配信287・215assets照合。Chromium Mainは本体・ZIPとも完走。一方、Chromium Workerは本体・ZIPとも追加SPU dispose後のsilent clock checkでframeGaps1、別実行でMain currentFrame -128を観測し未解決。PCMfinite／exact zeroとclock連続性を区別し、assertionを緩めず失敗を保持。**全8 UI条件中6成功・2失敗、全8条件PASSとは扱わない**。
- SDK／PS1 Native実装とoffline検証は完了。残りはChromium clock連続性の原因追跡、Tauri GUI物理実聴／remote OS CI。reportsは`/private/tmp/ps1-sdk-core-browser.json`／`ps1-sdk-browser-source-webkit.json`／`ps1-sdk-browser-zip-webkit.json`、失敗の両full-job logsも保持。runtime versioner変更0と3repo diffcheckが成功。coreは最初のKON／render等でallocationが起こり得て、無条件のzero-allocation保証はしない。
- 未commit／未push／未公開。npm0.2.32のまま、itch upload・SDK tag／GitHub Releaseなし。PS1 Mixerは未測定unity1.0、CPU／PSF／CD-XA等は対象外。詳細／再開点：[ps1_sdk_native_01.md](ps1_sdk_native_01.md)／[JSON](ps1_sdk_native_01.json)。以下は各時点の履歴。

## 2026-10-28 — PS1 SPUタブにCH別PCM波形描画を追加

- SPU → Voice選択 → Sine／Triangle／Saw／Squareを選び、波形を直接dragまたはindex／値で編集。112点のsigned PCMをMain準備側で64byteのloop ADPCMへ自動変換し、Sustain play／Keyboardで試奏。ADSR・pitch・左右volume・reverbを保持し、自分の試奏だけ任意で再発音する。
- Voiceごとに専用slotを初回だけ確保して同じsample ID／RAMを再利用。他Voiceへの割り当てを拒否し、共有初期sample・他CHを保持。全24slot最大1,536byte。通常uploadは共有可能。polyphonic Sample Editor楽器の同一RAM再利用は専用slotを除外する。
- Main／Worker／Workletのresourceだけを通知同期し、先行予約した音色値を上書きしない。接続直後・同時clear・古い通知・実Worker送信器内のreset fenceを検証。Stop／通常resetでRAM保持、clearRam:trueで全bank破棄。encoderはWorkletの58module依存graphに含まれず、pointer移動時の音声write・定期pollingなし。
- Copy voice JavaScriptはPCM・変換・upload・tuningを含めて別bankへ復元可能。実Browserで判明した`const sample`とPlayground prologueのTDZ衝突はps1Wave*名へ変更し、実runtime回帰でも確認した。
- focused185件、最終Main runtime＋panel177件（26panel件はfocusedと重複）、Worker110件、全mode型が成功、skip0。isolated npm991files／383宣言／1,089asset参照／28WASM engine／15renderer・型が成功。version0.2.32のまま未公開。最終7sourceとnpm stageもbyte一致。
- source本体／実Run ZIP × Chromium153／WebKit26.6 × Main／Workerの8条件成功。同一checkerで実drag／cancel／数値／1stroke1upload／slot固定／別CH保持／A4音程維持・倍音変化／Keyboard／ADSR・reverb／Stop・error回復を確認。UI編集後public uploadはID2、clear後copy復元は通常ID0でADPCM全byte一致。全captureのquanta連続・finite、配信287／215assetsを最終byte照合。物理出力mute、人の実聴／hardware比較は未実施。
- 標準3package command・4ZIPのCRC／path／全stage byte一致・Analyzer8基準guard・actionlint・runtime versioner変更0が成功。Run ZIPは`release/hello_ymfm_wasm_ps1-pcm-waveform-dev_itch_playground_for_run.zip`、923entries、SHA256 `7934d7ae4f88ef7d73a588f7bf815e9f21e1fc44e42af02447cf68561c5f7348`。fullは同prefixの_for_runなし。cache `ps1-pcm-waveform-1`、既存CIへ試験を拡張、remote未実行。
- 今回は**未commit／未push／未公開**。前段階はユーザーcommit `6bd7fdfc12e973b43da11d59728db078d9f82ac2`に含まれる。C++／WASM・receipt／Mixer gain／固定SDK／Tauri Native・versionは変更なし。tag・SDK／Tauri取込・npm／itch uploadなし。次はPS1のSDK集約とTauri Native adapter。
- 詳細：[ps1_pcm_waveform_01.md](ps1_pcm_waveform_01.md)／[JSON](ps1_pcm_waveform_01.json)、公開guide：[../ps1_spu.md](../ps1_spu.md)、計画：[todo_ps1_01.md](todo_ps1_01.md)。以下は各時点の履歴。

## 2026-10-28 — PS1 SPUタブでのADSR／reverb音作りを追加

- SPUタブで24声から選び、**Sustain play**で鳴らし続けながら音作りできる。Hold／1秒試奏／右下の共通Guitar・PC・pointer Keyboardも使用可能。名前付きADSR 9項目、模式図、raw words、左右volume／pitch／sample、設定JavaScriptのcopyを提供。
- ADSRは既存coreがkey-on時に取り込むため、既定のretriggerはこのeditorが所有する試奏だけを再発音する。コード演奏や別声は再発音しない。ADSR2の予約bit13を保持。rateはraw indexで0が速く、高い値では停止／無限releaseになることを表示し、模式図を実測時間とは扱わない。
- 声ごとのreverb sendと、SPU全体のRoom／Studio Small・Medium・Large／Hall／Space Echo／Half Echo／Off、左右returnを追加。既存coreの近似effectを操作し、C++／WASM変更やsample RAM予約なし。StopはRAM・音色・effect設定を保持して即時無音、ResetはOff／send無効。
- 実BrowserでInspectorの`structuredClone`がAudioWorklet内にない問題を修正。validated scalar patchを明示copyする。Stop後の直接試奏は既存`prepareAudition()`を通して出力fadeを戻す。準備中のRelease／声・タブ切替／disconnectでは遅れて発音しない。定期pollingは追加なし。
- focused 116件、Sample Editor等69件、Main／Worker runtime 260件、全mode型が成功、skip0。isolated npmは989files／382宣言／1,087asset参照／28WASM engine／15rendererとconsumer型が成功。version0.2.32のまま未公開。
- source本体／実Run ZIP × Chromium153／WebKit26.6 × Main／Workerの8条件成功。同一checker hashでADSR、owned retrigger、別声の継続、実wet tail、左右return、Stop直後／コードerror後の直接Sustain、Keyboard、idle／hidden要求0、disconnectを検証。全captureのquanta連続・finite、配信286／214assetsを最終byte照合。物理出力mute、人の実聴／hardware比較は未実施。
- 標準3package commandと4ZIPのCRC／path／stage全byte一致、Analyzer測定guard8基準、actionlint、runtime versioner変更0が成功。Run ZIPは`release/hello_ymfm_wasm_ps1-voice-editor-dev_itch_playground_for_run.zip`、922entries、SHA256 `e3a1d3c6627cdd8af49c17a86d18ab8a17da5654f22d1ad765e000b4fd65d7a0`。fullは同prefixの_for_runなし。cache `ps1-voice-editor-1`。CIにunit／実Run ZIP browser試験追加、remote未実行。
- 今回は**未commit／未push／未公開**。前段階Sample Editorはユーザーcommit `e2cadeafb0e1b433d5870b83d62873749e8e9bfa`に含まれる。C++ core／WASM／receipt／Mixer gain／固定SDK／Tauri Nativeは変更なし。次はPS1のSDK集約とTauri Native adapter。tag・SDK／Tauri取込・npm／itch uploadなし。
- 詳細：[ps1_voice_editor_01.md](ps1_voice_editor_01.md)／[JSON](ps1_voice_editor_01.json)、公開guide：[../ps1_spu.md](../ps1_spu.md)、計画：[todo_ps1_01.md](todo_ps1_01.md)。以下は各時点の履歴。

## 2026-10-28 — PS1 Sample Editor／保存楽器のKeyboard演奏を追加

- PS1 modeのMenu → Sample Editorで、音声file／マイク録音／描画から楽器を作成可能。44.1kHz monoへ変換し、元WAV＋source-relative編集JSONを保存。`examples/ps1/ps1-sampler.js`をRunしてGuitar／PC／pointer Keyboardで演奏する。PS1の実行Example一覧へPCM encoderとsamplerを登録し、計4本にした。
- 比較／試奏／楽器が同じ変換を使用。変換前／raw ADPCM再構成後の波形・byte数・RMS／最大誤差・SNRを表示。loopはnative28frame境界の内側へ揃え、指定／適用範囲・切り落とす末尾を明示。intro保持、one-shotはzero PCM padding、元録音・編集markerは保持。保存のみでも不正loopを拒否する。
- 実SPUの独立WASM instanceでroot noteを0.85秒試奏しfinally解放。root／cents補正をKeyboardと共通化。gain／crop／fadeを二重適用しない。変換は準備Workerで行い、比較応答を集約、編集／停止／close後の古い再生を防止。常時pollingやAudioWorklet上のencoder処理は追加なし。
- 選択範囲全体がRAM予算を超える場合はresample前に拒否し、大量の一時PCM生成を防止。live uploadは実空き容量も検査。同一sampleはfresh metadata＋実RAM全byteの一致で再利用し、hot Run／Stop後Runでもbankは1→2のまま。24声のleaseを共有し、古い楽器のcleanupが新しい声を止めない。
- 音声69件・runtime等297件・最終catalog13件（前groupと12件重複）・mode/project31件と全mode型が成功、skip0。共通Sample EditorとGame Boyの既存Browser回帰も成功。最終source本体／実Run ZIP × Chromium／WebKit × Main／Workerの8条件成功。同一checker hashで実録音API・保存再表示・音程・24声・exact RAM・連続quanta・Stop後exact zeroを確認。物理出力mute、実マイク／人の実聴は未実施。
- isolated npm最終987files／381宣言／1,085asset参照／28WASM engine／15rendererが成功。新helperとinstrumentのweb／npm原本はbyte一致。Browser mirrorはversion付きimport／asset pathを使うため、別途配信byteを検証（source289files、ZIP217files）。version0.2.32のまま未公開。
- 標準3package command、4ZIPのCRC／path／stage全byte一致、Analyzer測定hash guard、actionlint、runtime versioner冪等性が成功。Run ZIPは`release/hello_ymfm_wasm_ps1-sample-editor-dev_itch_playground_for_run.zip`、921entries、SHA256 `9ca8460faff07d48aebf01e3c8d9531eddd6e23c15990dc89675fbe7aa84c4fd`。fullは同prefixの_for_runなし。cache `ps1-sample-editor-1`。CIへunit／packaged Browser試験を追加、remote未実行。
- C++ core／WASM／receipt／既存renderer／Mixer gain／固定SDK／Tauri Nativeは変更なし。**未commit／未push／未公開**、tag・SDK／Tauri取込・npm／itch uploadなし。前段階encoderはユーザーcommit `94b62d45`に含まれる。次はPS1のSDK集約とTauri Native adapter。
- 詳細：[ps1_sample_editor_01.md](ps1_sample_editor_01.md)／[JSON](ps1_sample_editor_01.json)、公開guide：[../ps1_sample_editor.md](../ps1_sample_editor.md)、計画：[todo_ps1_01.md](todo_ps1_01.md)。以下は各時点の履歴。

## 2026-10-28 — PCM → PS1 SPU ADPCM encoderを追加

- 純JSの`encodePs1Adpcm()`／`pg.encodePs1Adpcm`とnpm subpathを追加。有限mono Float32 PCMから16byte／28frame packetsへ変換。28frame境界のloop、one-shot zero padding、容量制限、所有されたbytesとJSON保存可能な誤差を返す。再sample／音量補正／pitch推定なし、tuningはloadADPCMで明示。default520,192bytesは空Synth用、既存bankの容量はcaller管理。
- 予測filter0–4／shift0–12からgreedy最小誤差を選択。signed16bit overflowを使う候補は除外。先頭／loop先頭filter0で履歴依存を除去。変換はMain／logicWorkerの準備処理だけ、AudioWorkletやInspector定期pollingは追加なし。
- `examples/ps1/ps1-pcm-adpcm.js`を追加してPS1 Example計3本。自作PCMをlivePrepareで一度uploadし、演奏中のRunでは再利用。Mixer指定なし。Node `main_ps1_adpcm.js`はloop＋one-shot ADPCM／tuning・metrics JSON／実SPU WAVを出力。preview `/private/tmp/ps1-adpcm.wav` は44.1kHz／2秒／peak0.500519／最後200ms exact zero。
- Encoder7＋実core4＋Synth7＋rawSPU15、Main／Worker260、catalog／declaration／Monaco43、全mode型が成功。実Native decoderの誤差と完全一致、28frame一packet／末尾packetだけのloopも64周期完全一致。CH24／440Hz／signed stereo／END／Stop・再発音、Native／WASMのPCM・RAM・register全byte一致を確認。skip0。
- ソース本体／実Run ZIP × Chromium153／WebKit26.6 × Main／Workerの8条件成功。exact Example各2回、演奏中Runの追加upload0、8不正入力、CH24、Stop後無音、error recovery。物理出力mute、実聴／hardware比較は未実施。
- isolated npm983files／379宣言／1,079asset参照／既存28WASM engine／15renderer・consumer型が成功。version0.2.32のまま未公開。web／docs／npm encoder同byte。標準3package commandとAnalyzerの既存測定hash guard、actionlintも成功。
- Run ZIP `release/hello_ymfm_wasm_ps1-adpcm-encoder-dev_itch_playground_for_run.zip`、918entries、SHA256 `3860c93c7153a8bbd46ff3b9bb41ef8ded8fcb48972ab8ecc874f4dbd3e37540`。fullは同prefixの_for_runなし。両ZIPのCRC／path／全stage bytes一致を確認。cache `ps1-adpcm-encoder-1`、CIへcore／Node／packaged Browser試験を追加。
- C++ core／WASM／既存再生経路／Mixer gain／固定SDK／Tauri Nativeは変更なし。**未commit／未push／未公開**、tag・version変更・SDK／Tauri取込・remoteCIなし。前段階のPS1 Modeはユーザーcommit `baf12fc1`に含まれる。次はSample Editor変換・楽器保存、SDK集約、Tauri Native adapter。
- 詳細：[ps1_adpcm_encoder_01.md](ps1_adpcm_encoder_01.md)／[JSON](ps1_adpcm_encoder_01.json)、公開guide：[../ps1_adpcm_encoder.md](../ps1_adpcm_encoder.md)、計画：[todo_ps1_01.md](todo_ps1_01.md)。以下は各時点の履歴。

## 2026-10-28 — PS1 Browser Mode／Synth／Keyboardを追加

- experimental **PlayStation (PS1)** Mode。`spu`／`pg.spu`、独立した`createSoundChip('ps1')`／`useSoundChip('ps1')`をBrowserへ接続。24 physical voices／512KiB RAM／44.1kHz。初期音色を全24声へ準備、index.js＋自作Example2本、Mixer指定なし。
- `Ps1Synth`でADPCM packet／loop／tuning／RAMを検証し、signed stereo volume・pitch・raw ADSR・key-on/offを操作。`Ps1Resampler`は44.1／48／96kHz等へ位相を保持して必要分だけbatch変換。44.1kHzは直接render、出力quantumごとのscratch再生成なし。
- SPUタブから声・sample・pitch・左右volume・ADSRを編集し、Hold／1秒試奏／右下Keyboardを使用。共通Guitar／PC／pointer KeyboardでChip／CH24まで選択。表示中の無操作・非表示ともInspector定期要求0件。Mode選択だけではAudioContextを生成しない。
- 実WorkletでのWASM byte注入をbuild recipeへ明示し、URL／fetchなしのloader起動を検証。Resetは即時の準備barrierとし、後続Worker命令やuploadを消さない。pending uploadのdefault resetはAbortErrorを維持しつつ保持RAMのIDを同期、clearRamは旧bankを破棄。Stopはbank／presetを保持して即時無音。
- 実core／Synth／resampler／client／Worklet48件成功・skip0。関連client／Worklet／runtime／追加生成150件（48件と重複あり）、UI・mode・全mode型も成功。isolated npm installed tarball981files／378宣言／1,077asset参照／既存28WASM engineが成功。同梱source18inputsだけの再buildでJS／WASM／receiptがbyte一致。
- Chromium153／WebKit26.6 × Main／Worker × source本体／実Run ZIPの**8条件成功**。初期code各2回、両Example、CH24／floating Keyboard、Reset競合後440Hz、追加SPUの独立破棄、error recovery、Mode往復、Stop後exact zeroを検証。1600／390px表示確認、物理出力mute、実聴／Tauri GUI未確認。
- 既存C++ core／WASM binary／固定SDK／Tauri Native／既存gainは変更なし。生成JS loader／recipeとruntime接続は更新。PS1 Mixerは**未測定unity1.0**を登録。cacheは`ps1-mode-1`、既存Analyzerの測定hash guardは変更なしで成功。
- 既定3package command成功。Run ZIP `release/hello_ymfm_wasm_ps1-mode-dev_itch_playground_for_run.zip`、916entries、SHA256 `28f8220eacb04ac9e7a22c58893ad3b993d0a8635e2933a8b5a36a43a060827c`。fullは同prefixの_for_runなし。両ZIPのCRC／path／全stage bytes一致を確認、actionlint成功。新CIを追加したがremote未実行。
- **未commit／未push／未公開**、version変更・SDK／Tauri取込・tag・npm／itch公開なし。前段階はユーザーcommit `3421bb5a`に含まれる。次はPCM→SPU ADPCM encoder、Sample Editor、SDK集約、Tauri Native adapter。精度は実験段階のlinear補間／近似ADSR／reverbを維持、hardware-exact／real-time allocation保証なし。
- 詳細：[ps1_mode_01.md](ps1_mode_01.md)／[JSON](ps1_mode_01.json)、作業計画：[todo_ps1_01.md](todo_ps1_01.md)、公開guide：[../ps1_spu.md](../ps1_spu.md)。下記は各時点の履歴。

## 2026-10-28 — PS1 SPUのNative／WASM基盤を追加

- `native/ps1/`へ実MAME SPUをCPUなしで単体化。24声／512KiB RAM／44.1kHz stereo。C register／RAM／PCM API、`web/ps1_spu.js`とdocs mirror、共有WASMビルド＋18input／2output hash receipt。上流5filesをpin・原本・BSD attributionと共に収録。
- 15件の実コア試験が成功（skip0）。NativeとWASMのPCM／register／RAMが完全一致。loop cache参照、RAM末尾、pitch／PMON上限、voice0 PMON、pitch0補間境界を修正。Native sanitizerの10case＋256fixture×24声も成功。macOSのLSanは未対応でleak検証はしていない。
- Chromium／WebKit×Window／DedicatedWorkerの4構成成功。実PCM、24声目、音程倍増、stereo、ownership、reset／RAM保持・clear／disposeを検証。AudioContext生成・物理再生なし。
- Node自作Exampleはvoice0／23で3秒のWAV＋JSON＋2bankを生成。preview `/private/tmp/ps1-spu-foundation.wav`、peak約0.095636、非clip、最後1024frames exact zero。Mixer指定なし。実聴未実施。
- full-runtime／npm stageへ単独source・recipe・noticeを同梱。stageのsourceだけでNative build成功。SDKなしでWASM再buildも行い配布JS／WASMとbyte一致。最終969filesのisolated npm pack／install、全28pair、372宣言、NodeNext／Bundler／Browser型検証も成功。
- **低レベル基盤まで**。上流のlinear補間・float ADSR・preset reverbを保持する実験実装。real-time allocation保証なし。PS1 Mode／Synth／Keyboard／encoder／Tauri接続は次段階。固定SDK・既存mode／音声経路・Mixerは変更なし。未commit／未push／未公開、version変更なし。新CI追加済み、remote未実行。
- 詳細：[ps1_spu_01.md](ps1_spu_01.md)／[JSON](ps1_spu_01.json)、次段階：[todo_ps1_01.md](todo_ps1_01.md)、公開guide：[../ps1_spu.md](../ps1_spu.md)。元作業はユーザーcommit `5a746b00`に含まれる。以下は各時点の履歴。

## 2026-10-28 — Neo Geo PCM → ADPCM-A変換API・6声Exampleを追加

- `web/adpcm_a_sample.js`／docs mirrorに`encodeAdpcmA()`。Playground Main／Workerのglobal／`pg`、npm subpathで使用可能。mono Float32 PCMを16候補探索・実12bit wrap規則で変換。256byte境界までzero PCMを符号化し、元／padding後長さとJSON保存可能な誤差を返す。再sample／音量補正／pitch／hardware loopなし。既定上限0xfff00bytes、ROM配置はcaller管理。
- 両Neo Geo modeに`examples/neogeo/neogeo-adpcm-a-drums.js`。選択中のprimaryを使い、clock/432で生成した自作6打楽器を8,960byte bankで演奏。Mixer指定なし、既存Exampleを残し各4本。Node版は両variantの実コアから48kHz・6.9秒WAV＋bank／JSONを生成。6声単独・同時、EOF無音、peak0.285522を確認。
- codec／OPNB／ADPCM-B22件（新encoder6件・skip0）、runtime／Worker／Monaco266件、catalog／declaration50件、全mode型が成功。実C++ raw decoderと一致、両variantのNative／WASM全出力一致。6声・pan・固定rate／duration・EOS／EOF・再発音・keyOff・reset／ROM保持・A/B分離・ownership／disposeを検証。npm installed tarball941filesの両export・実音源・型も成功、version0.2.32のまま。
- Chromium153／WebKit26.6 × 両mode × Main／Worker × source本体／実Run ZIPの16条件成功。exact Example各2回、入力拒否、有限PCM、Stop後exact zero。物理出力mute、人の実聴／Tauri GUI未確認。
- Run ZIP：`release/hello_ymfm_wasm_adpcm-a-encoder-dev_itch_playground_for_run.zip`、894entries、SHA256 `4b2408a687113f46a66a8001a12e6ba5e6f386c2ee4909a252faa0ce837d3812`。fullは同prefixの_for_runなし。CRC／全stage bytes一致、cache `adpcm-a-encoder-1`。CIへcore／packaged browser試験を追加、actionlint成功。
- **未commit／未push／未公開**。DSP／WASM／Mixer／固定SDK／既存再生APIの変更、SDK／Tauri取込、npm公開、tag、itch uploadなし。remote CIは未実行。Sample Editor組込みは次の段階。公開guide：[../adpcm_a_sample.md](../adpcm_a_sample.md)。前のBRR作業はユーザーcommit `43754226`に含まれる。
- 詳細：[adpcm_a_encoder_01.md](adpcm_a_encoder_01.md)／[JSON](adpcm_a_encoder_01.json)。以下は各時点の履歴。

## 2026-10-28 — PCM → SNES BRR変換API・Example・実コア検証を追加

- `web/snes_brr_encoder.js`／docs mirrorに純JSの`encodeBrr()`。正規化mono Float32 PCMからBRRへ変換し、元／padding後の長さ・loop位置・JSON保存可能な誤差を返す。再sample／音量補正／音程推定なし。16sample境界を検証、先頭／loop先頭filter0で周回ごとのPCM差を防ぐ。既定上限64,512bytes、他sampleとのRAM配分はcaller側。
- Playground Main／Workerでglobalと`pg.encodeBrr`を公開。SNES modeに`examples/snes/snes-pcm-brr.js`、Nodeに`.brr`＋tuning／metrics JSON＋実S-DSP WAVを生成するExample。外部音声／game asset不要、Mixer指定なし。公開guideは[../snes_brr_encoder.md](../snes_brr_encoder.md)。Sample Editorへの接続は次の作業。
- core37件（新encoder8件）、runtime／Worker／Monaco261件、catalog／declaration50件、既存CI unit36件が成功。実NativeとWASMのraw decodeおよび31,040 stereo framesが完全一致。全mode型とnpm installed tarballの型／実行／両subpath／実DSP再生・releaseも成功。versionは0.2.32のまま。
- Chromium153／WebKit26.6 × Main／Worker × source本体／実Run ZIPの8条件成功。実音声PCM・不正入力拒否・各Example2回・Stop後exact zeroを確認、物理出力mute。人による実聴／Tauri GUI確認は未実施。
- ZIP：`release/hello_ymfm_wasm_snes-brr-encoder-dev_itch_playground_for_run.zip`、892entries、SHA256 `1b986790fb3f2d010dbd5d0c607a7420c7612d07bd4807da016cc584762df159`。full ZIPは同prefixの_for_runなし。両ZIPのCRC／全stage bytes一致と依存を確認。cacheは`snes-brr-encoder-1`。CIへcore／packaged browser試験を追加、actionlint成功。
- DSP core／WASM／Mixer／固定SDKは変更なし。今回featureは**未commit／未push／未公開**、新CIはremote未実行。SDK／Tauri取込、npm公開、tag、itch uploadなし。前のGame Boy作業はユーザーcommit `02d6e82e`に含まれる。
- 詳細：[brr_encoder_01.md](brr_encoder_01.md)／[JSON](brr_encoder_01.json)。下記は各時点の履歴。

## 2026-10-28 — Game Boy Sample Editorの変換後比較・試奏を追加

- Menu → Sample EditorでGame Boyを選ぶと、編集後の選択範囲と32点・4bit変換後波形を比較できる。Preview Game Boyで基準音を0.85秒試奏。表示・試奏・保存後Keyboardは同じ既存converterを使用。保存形式は元WAV＋編集JSONのまま。
- 実Game Boy WASMをWorker内の独立コアで使い、標準音量0.36を1回適用。両端fadeとfinally解放。演奏中チップ／Mixerの変更なし。変更ごとの比較を集約、古い応答や停止後の試奏は破棄する。常時pollingは追加なし。
- 音声関連53件、更新後CI unitコマンド36件が成功（重複7件を除く計82件）。既存Sample Editorの両Browser回帰も成功。新checkerはChromium／WebKit×fixture／本体／実Run ZIPの6条件すべて成功。実PCM、保存／再読込／実wave RAM一致、読込失敗回復、取消、390px横overflow0を確認、物理出力mute。
- 配布用Run ZIPは`release/hello_ymfm_wasm_gameboy-sample-preview-dev_itch_playground_for_run.zip`、890項目、SHA256 `eac99fa6e79dfbe1f7e46662150c5c6e3b16c9b31d580fb55c904b58247e0a12`。full ZIPは同prefixの_for_runなし。新helperとpreset依存も同梱、cacheは`gameboy-sample-preview-1`。新checker／core試験をitch web CIへ追加、actionlint成功。
- 前回CIはユーザーの`v0.93.2+1+test`／`3db298f7`で全4workflow成功済み（itch run40611365941）。今回featureは**未commit／未push**で新CIは未実行。npm／SDK／Tauri取込／tag／uploadなし。Tauri実機での試聴は未実施。
- 詳細：[gameboy_sample_preview_01.md](gameboy_sample_preview_01.md)／[JSON](gameboy_sample_preview_01.json)。下記の「初回CI未実行」等は各時点の履歴。

## 2026-10-28 — itch.io Web配布ZIPのCI追加完了

- ユーザーの既定3コマンド（Synth／VGM Analyzer／Playground）をそのまま実行する`itch web release ZIPs` workflowを追加。push／PR／手動で起動し、成功時に4ZIP＋`SHA256SUMS`＋manifestを`itch-web-release-zips`へ14日保存。GitHub Releaseへの添付とitch.ioへのuploadは手動のまま。
- ZIPのCRC／path／stage全byte一致／実行用3ZIPのhosting上限を検証。Playground fullは1115項目のdownload用、Runは888項目の実行用。Runの元UI77files／対応source91files／872未変更files／47noticesも照合。音声コード・WASM・Mixer・SDKは変更なし。
- 29 targeted tests／実4ZIP／checksum／actionlint 1.7.12が成功。Chromium153・WebKit26.6でSynth各1、Analyzer各12checks、Playground全20条件（5mode×Main/Worker×2browser）が成功。実PCM・停止・再実行等を確認、物理出力mute。
- 手順は[itch_web_release.md](../itch_web_release.md)。Actionsから取得した外側のartifactを展開し、その中の各アプリZIPをReleaseへ添付する。itch.ioのPlayground実行対象は`_for_run.zip`。
- 前回bundle版はユーザーがcommit・itch.io動作確認済み。今回CI追加は**未commit／未push**、GitHub／Ubuntuでの新workflow実行はまだ。次はcommit・push後に初回CIを確認する。npm／SDK／Tauri取込／tag／公開操作なし。
- 詳細：[itch_web_ci_01.md](itch_web_ci_01.md)／[JSON](itch_web_ci_01.json)。下の未upload等は各時点の履歴。

## 2026-10-28 — itch.io Run用UI bundle＋minify完了

- `sh scripts/package_itch_playground.sh`はRun版だけroot UIをbundle＋minifyする。全展開ソース付きfullZIPとTauri取込形式は維持。canonical docs/webの音声コード・WASM・Mixer・SDKは変更なし。
- root UI75files／1,204,257B → main810,885B（約32.7%減）。71filesを統合し、Workerのroot依存3filesは保持。js／vendor／generated等の元byteと動的URLを維持。元UI入力75＋license2は別ZIPへ保存し、bundle receipt／hash付きentryURLも生成。
- Run ZIP957→888entries、directory0。元ソースも同梱するためZIP全体は36,843,597→37,106,027B。実行コードのサイズとZIP総容量は別の値。
- 10targeted tests成功。実minified ESM／import.meta URL・query／関数名／Worker closure／元ソース／legal／1,005入力から上限内への縮小を確認。Chromium153／WebKit26.6×Genesis／MegaCD／GameBoy／NES／WonderSwan×Main root／Worker nestedの20条件すべて成功。実PCM・MegaCD4音源分離・stereoCDDA・Stop後exact zero・再実行・Monaco／Shell／VFS相対importを確認。物理出力mute。
- 確認済みRun ZIP：`release/hello_ymfm_wasm_bundle-dev_itch_playground_for_run.zip`、SHA256 `f7d576c77e592ec9e20d443e8e31733a11bb9f3f6636ab55c793ee6699b3d3f9`。fullZIPは同prefixの`_for_run`なし。前の957項目dev ZIPは退避せずそのまま保持した。
- 未commit／未upload／設定変更・npm・SDK・Tauri取込・tagなし。itch.ioではこの_for_run.zipを手動uploadしbrowser実行対象にする。次は公開後の実ページ確認。VGM／Synthのbundleは今回対象外。
- 詳細：[itch_playground_bundle_01.md](itch_playground_bundle_01.md)／[JSON](itch_playground_bundle_01.json)。下の「bundle未実施」は前段階の履歴。

## 2026-10-28 — itch.io Playground実行ZIPの1,000項目制限を修正

- ユーザーの実エラーは`Too many files in zip (1115 > 1000)`。元ZIPは1,005files＋110directory records。先の依存参照チェックではこの上限を見落としていた。元ZIP自体はChromium／WebKitのroot／nested全4条件で正常起動。
- `sh scripts/package_itch_playground.sh`は従来の全展開ソース付きZIPに加えて`release/hello_ymfm_wasm_dev_itch_playground_for_run.zip`を生成する。itch.ioで実行対象にするのは**_for_run.zip**。957entries／directory0、SHA256 `8d76fef18c9247dcbb98c566d860cec13d6e1e500a7e3e44e779abfb446e5cf2`。
- 実行資産・Example・ライセンス等の914非sourceファイルは全byte不変。全91sourceファイルを`sources/corresponding-source.zip`へ元byteのまま収録し、外側のC/C++/header/sh50filesだけを集約。既存guideにダウンロード／展開案内を追加。従来のfullZIP・Tauri取込形式は維持。
- 新helperは実ZIPのdirectoryを含む項目数・サイズ・path等を検証。境界・完全なsource復元等6tests成功。新ZIPもChromium／WebKit×root／nested全4起動条件成功。音声再生の追加試験はしていない。
- 未commit／未upload／itch.io設定変更なし。次の案はユーザー提案のRun用JS bundle＋minify。今回の修正では未実施。Worker／AudioWorklet／WASM参照とMain／Worker演奏の確認を含める。
- 詳細：[itch_playground_file_limit_01.md](itch_playground_file_limit_01.md)／[JSON](itch_playground_file_limit_01.json)。

## 2026-10-28 — itch.io Web版2本の公開準備完了

- ユーザーがVGM Analyzer／Playgroundを手動公開予定。本体baseは`3df4336b`（Mega-CD CD-DAまでcommit済み）。アップロード操作は行っていない。
- Analyzerの測定source hash不一致を解消。14filesの差はJSDoc cache URLのみ。実18＋12captureを再測定し、旧記録のsources以外はPCM hash・測定値・gainを含め完全一致。extra06／PSG07を追加しgeneratorと生成物の由来コメントだけ更新。音量・WASM・実行コードは不変。
- 関連12tests／実Analyzer8routes／配布stageでChromium・WebKit各12checks成功。Playground新ZIPの1005payloadは前回の実Browser検証済ZIPと全byte一致。両ZIPの依存参照・root index.html・stage全byte一致を検証済み。
- 手動upload用：`release/hello_ymfm_wasm_web-20261028-3df4336_itch_playground.zip`／`release/hello_ymfm_wasm_web-20261028-3df4336_itch_vgm_analyzer.zip`。itch.io公開後のiframe上の確認は未実施。
- 今回の測定記録等は未commit。npm／Tauri取込／tag／公開操作なし。詳細：[analyzer_mixer_calibration_refresh_04.md](analyzer_mixer_calibration_refresh_04.md)／[JSON](analyzer_mixer_calibration_refresh_04.json)。

## 2026-10-28 — Mega-CD CD-DA／4音源デモ追加完了

- Mega CD modeにCD-DAタブ。YM2612／Sega PSG／RF5C164／CD-DAの4系統を表示する。既存の共通API／read-only panelを再利用し、定期pollingや音声書込は追加しない。Genesis／32X／PC Engineの構成は維持。
- New Cassetteの初期コードと`examples/mega-cd/megacd-four-sources.js`で4音源を合奏。PCM／4秒stereo WAVはコード内で生成、外部disc／BIOS／ROM不要。fade・無音loop・連続end markerでPCM終端を保護。index.jsにMixer指定なし。既存samplerはbyte一致、編集済みCassetteを保持。
- UI等56／runtime142／Example等44／全mode型／Native JS37／Rust CD-DA8件が成功。実Native coreの44.1／48 kHzで4音源の和、master1回、CD-DA単独Stopと全体Stopを確認。Rustは`#[cfg(test)]`追加だけでproduction prefix一致。
- Chromium153／WebKit26.6 × Main／Worker全4構成＋他mode8回帰が成功。実4音源寄与・個別Mute・CD-DA transport・全体Stop後exact zero・再実行・System Mixer値を確認。4秒録音6件でもclip／非有限値／振幅差0.1超jumpなし。物理出力mute、実聴／Tauri GUI／実機比較は未実施。
- 作業前の本体`524552e`は4workflow成功。Tauri`764816f`のBuild Desktop run40597042397もmacOS Intel／ARM・Windows x64・Linux x64／ARMの5構成成功。今回の未commit変更はこのCIに含まれない。
- Playground ZIP1005files／SHA256 `3205170c9dbbd67203ce6cc075e7a83f65d45ee6d942b047fc1884bdeeb76125`。`release/hello_ymfm_wasm_mega-cd-cdda-dev_itch_playground.zip`。Tauriへ1004effective files取込済み、source ZIP1996files／SHA256 `7c62a289ed86115b2805aa8589fa41fceb5b32c0ea853a9180aec26b109bc123`。全stage byte／24offline snapshot／固定SDK431files／source ZIPを検証済み。
- Cacheは`mega-cd-cdda-1`。音声runtime／DSP／Mixer値／固定SDK0.1.5／WASMは変更なし。本体・Tauriは未commit／未push、npm／SDK／itch.io／app公開なし。次は実聴後のconsumer commitと、そのcommitのCI確認。
- 詳細：[megacd_cdda_01.md](megacd_cdda_01.md)／[JSON](megacd_cdda_01.json)／[Browser](megacd_cdda_01_browser.json)。これより下は各時点の履歴。

## 2026-10-28 — SDK 0.1.5公開／本体・Tauriの固定SDK移行完了

- SDK集約commit `52062d0`のCIはNative5platform＋WASM5構成が成功。公開metadataを整えた`3bb8d9ceffa50ad183d1ab856e031fe649425bca`をcommit／pushし、`v0.1.5`を作成。タグCIも全10構成＋公開job成功、[SDK 0.1.5](https://github.com/kyorohiro/tetorica-soundchip-native/releases/tag/v0.1.5)は公開済み。SDK repoはclean。
- 公開source ZIPは431files、SHA256 `e37be75316a35a4159d8760afa9e4b86a9a4b8d4d24f674cc15e3e5e52c44309`。ローカル候補とbyte一致、全payloadがtagged sourceと一致。Manifest SHA256 `e2b5703a2bbf44323d5331b522aa167fa091fcb13ceadebe14d021efe3aa07e7`。本体・Tauriとも同一公開SDKへ更新しlocalCandidateを除去。
- 本体は29chip＋別枠2applicationAudioの計31buildへ対応。全31実build、183source input、61unique outputs／75deployed filesが移行前とbyte一致。metadata receiptのみ更新。40,474比較とCD-DA／MSM5205の実Native/WASM／raw JS互換が成功、最終試験中の入力変更なし。
- 本体125 Node＋55 audio unit＋25 Python importer＋3 wrapper routingが成功。固定SDKのみをcompileし、旧`native/cdda`／`native/msm5205`の複製11filesを削除。配布source bundleは従来のnative/*レイアウト維持、SDKがなくてもC11／C++14／WASMを単独再buildでき、2組ともdescriptor／WASMが完全一致。
- Tauriの2C11 buildも固定SDKへ変更。旧原本11filesを削除し、同期ツールはread-only検証へ。Rust/API／時計／DSP／gainは変更なし、既存284core入力＋新4C/Hが移行前と同byte。Cargo780成功／既存4ignore、Python30成功、24offline source checks成功。
- npm stage／tarballは935files、実行・型・source receipts・license検証成功。version0.2.32のまま、**npm再公開なし**。tarball SHA256 `9217432e28bddbb4b65ff9e3f4f77193de3df0d090016399f9c54ff6482b0c2b`。将来公開する場合は新versionが必要。
- Playground ZIP `release/hello_ymfm_wasm_sdk-015-cdrom2-dev_itch_playground.zip`、1004files／SHA256 `e3f63f9fea0f948879ae9c43afa8c7615b18b856e53173615d7cba771f4f7449`。全stage bytes／2source bundleを検証しTauriへ1003effective files取込。対応source ZIP1995files／SHA256 `d43176f2d17940a06527e30e61a1079290a310f24968c45c0d5f0b44576824bf`も生成・検証済み。
- **本体・Tauriは未commit／未push**。SDKだけcommit／tag／公開済み。本体とTauriのremote CI、GUI実聴、itch.io／desktop app公開は未実施。次はconsumer変更のcommit後、desktop CIで確認。
- 詳細：[sdk_015_cdrom2_release_adoption_01.md](sdk_015_cdrom2_release_adoption_01.md)／[JSON](sdk_015_cdrom2_release_adoption_01.json)。これより下の未公開／候補扱いは各時点の履歴。

## 2026-10-28 — CD-DA / MSM5205 SDK集約完了

- `w/tetorica-soundchip-native`へ本体の新C11 coreを収録。`vendor/tetorica-cdda/`／`vendor/tetorica-msm5205/`にソース・BSDライセンス・NOTICE・英語README。原本core／header／WASM bridgeは本体とbyte一致、全306snapshot hashを検証。
- `tetorica::cdda`／`tetorica::msm5205`のNative targetとC public header、単独WASM buildを追加。既存24 chip ID／29 chip WASM recipeは維持し、新2moduleは`applicationAudio`で別枠。SDK 0.1.5候補のmetadataを維持、version変更なし。
- checkout外へ展開したsource ZIPだけで全23library／49executableをbuild。29/29 CTest、21件の48kHz stereo PCM16 WAV、既存JS reference10checkが成功。Python audit／release回帰88件も成功。
- CD-DA／MSM5205のWASMをSDKと展開ZIPからそれぞれ生成、JS／WASMとも本体配布物とbyte一致。実C11／C++14とNative/WASM PCM・state差0。CD-DAは8/44.1/48/384kHz、MSMは44.1/48kHz・全16rate・raw互換・alternate clock等を確認。
- `tetorica_pcengine_cd_wav`はHuC6280＋MSM5205＋CD-DAを個別→合奏。外部asset不要、master0.5を1回。peak約0.30832／clipなし／末尾0.2秒exact zero。preview `/private/tmp/sdk-pcengine-cd.wav`。実聴・実機比較は未実施。
- full checker終盤でEmscripten cacheのsandbox権限エラーが1回発生。必要権限で該当buildを再実行し、展開sourceからの新2WASM build／smoke／parityが成功。最終ZIP audit／JS／実WASM／Native parityはexit0。
- 最終候補は`/private/tmp/sdk-cdrom2-archives-final/`。source ZIP SHA256 `824f4c218d086f439c66f36a46c353c66ab96bc6f333292846351ae86e988985`、WASM ZIP `09a6676c03988001fe97ea9e8edc5f3f9fa1e6f3d026c5a2b57910080634e977`。全build inputはfull build済ZIPと同一。
- CIのWASM対象へ新2moduleを追加し5job、Nativeは既存5platform。今回remote CIは未実行。未commit／未push／未tag／未公開、本体・Tauri固定SDK／runtime／Mixer／npmには変更なし。
- 詳細：[soundchip_native_cdrom2_01.md](soundchip_native_cdrom2_01.md)／[JSON](soundchip_native_cdrom2_01.json)。次はSDK変更のcommit後にremote CI確認、公開とconsumer pin更新は別作業。

## 2026-10-28 — PC Engine CD-ROM² external Examples complete

- `w/tetorica-fm2612-examples`を公開npm **0.2.32**へ更新。CD-DAのトラック操作、MSM5205のサンプル変換／ループ、HuC6280＋ADPCM＋CD-DAの合奏をWeb／Nodeで各1例追加。各例は自作音声を生成し、外部disc／BIOS／ROM不要。
- Webは`Playground({chip:'huc6280', pcEngineCd:true})`、Main／Worker選択・コード編集・初期化中／再生中Stop・終了時解放。Nodeは48 kHzの実WASMを共通frame時計で混ぜてWAVへ保存。
- Node全**36例**成功。Chromium153／WebKit26.6×3例×Main／Workerの全**12構成**成功。実PCMで各音源の寄与と合奏、Pause／EOF／Stop後exact zero、再実行・エラー・pagehide・解放を検証。物理出力はmute、実聴／実機比較は未実施。
- `npm run build`／`build:docs`で各**1181 files**を生成、全byte一致。Browserが取得した**191 assets**は両tree一致。npm **929 members**はinstall／docs/vendor／dist/vendor／public/vendorで公開アーカイブと同hash。
- 通常dev serverも18routeのHTTP200／source byte一致を確認し終了。Ready状態のdesktop3枚＋compact1枚を確認、audio contextは0。プレビューWAV3件はExamplesの`output/pc-engine-cd-*.wav`。
- ExamplesのREADME／catalog／runtime guide／依存lockも更新済み。**未commit／未push／GitHub Pages未公開**。本体・Tauri・SDK・VGM・Mixerデフォルト値の変更、npm再公開は行っていない。
- 詳細：[pcengine_cd_examples_01.md](pcengine_cd_examples_01.md)／[JSON](pcengine_cd_examples_01.json)。次の候補は新C11 coreのSDK集約。`docs/cdda.md`末尾の古い未実装案内整理とTauri GUI実聴は別途。

## 2026-10-28 — CD-ROM² npm release published

- Target: `tetorica-fm2612 0.2.32` only. CD-DA / MSM5205 APIs, real WASM, complete source/notice bundles and README examples are staged. Fixed SDK and VGM package unchanged.
- Exact candidate: `/private/tmp/npm-cdrom2-release-20261028/tetorica-fm2612-0.2.32.tgz`; SHA-256 `57a8a6acc607b304b3fdadd2c525a3cee78f2ece85023d3cafd802c1461583c1`; 929 members match stage and isolated install.
- Passed: 55 audio tests, all 28 packaged chip/engine WASMs, 367 declarations / three consumer TS configurations, both Node README examples, eight isolated Chromium/WebKit CD-DA/MSM5205 44.1/48 kHz cases.
- Status: **published and registry verified**. npm `latest` is `0.2.32`; the downloaded registry archive is byte-identical to the tested candidate. SHA-1, SHA-512 integrity and all 929 member hashes match. No republish is needed.
- Detailed receipts: [npm_cdrom2_release_01.md](npm_cdrom2_release_01.md) / [JSON](npm_cdrom2_release_01.json). No commit, push, tag or SDK publication.

# Save Point

Last updated: 2026-10-28

## 最新の再開ポイント — 2026-10-28

この節が現在の作業状態。末尾まで残している旧記録には、現在と異なる構成・未実装扱い・次の作業案が含まれる。
再開時はこの節と実際の各リポジトリの状態を先に確認する。

### CD-ROM² tab名を短縮 — 2026-10-28

ユーザー指定に合わせ表示名を`HuC6280`／`MSM5205`／`CD-DA`へ統一。
HuC6280のmode別上書きを外し、MSM5205のtab文字列を短縮。説明本文・音声処理は維持。
page cacheは`cdrom2-tab-labels-1`。ZIPを再作成しTauri frontend／source ZIPを更新。
`release/hello_ymfm_wasm_cdrom2-tab-labels-dev_itch_playground.zip`。
frontend ZIP SHA256 `568006eeb2d758b0e11b96dbf1422136088e29e4135f5a8750fdc07fa4088b63`。
未commit／未push。直下の検証記録とBrowser画像は短縮前の表示名に対する履歴。

### CD-ROM² sourceタブ追加完了 — 2026-10-28

新modeへHuC6280 PSG／MSM5205 ADPCM／CD-DAの3タブ。既存HuC音色編集は維持。
MSMはRAM／rate／nibble位置、CD-DAは形式／track／位置などをread-only表示。
Run前から構成が分かる。新2panelはtab-entry／Refresh等のsnapshotのみ、定期pollingなし。
`runtime.getSystemAudioState(kind)`は既存endpointを読むだけで、音声準備・発音・設定書込なし。
Stop／旧Run／hide後の遅延応答を保護。通常PC Engineでは2タブを隠す。DSP／Rust／SDK変更なし。

新規runtime12／panel8／workbench1を含むWeb関連4657件、型・npm367宣言・CI guard105件が成功。
大量並列で既存Workerの300ms待機が1件timeout、単独103件と並列数4の全件は成功（コード変更なし）。
Chromium／WebKitのdesktop／compact4構成＋通常PC Engine2確認が成功。
Run前のaudio context／worklet／messageは0、再生中のinspection messageはstateのみ。
全280source hash、192flat runtime assetの同一性、画面2枚を目視確認。物理出力mute。

`release/hello_ymfm_wasm_cdrom2-panels-dev_itch_playground.zip`（998files）を作成。
SHA256 `d405028c329aa89b7ed838d4e81ff108ba6e48fd2949d4f91b6fc96c06e1abee`。
Tauriへ997effective files取込、Native source ZIP1976filesと24offline pin検証。
source ZIP SHA256 `7a243c9fbaf2a13a6c449b8dae66c354cc01519729f2466b268db08ad6d0a4f0`。
今回のUI変更は未commit／未push。先にpushされた`v0.91.2+test`はNative実装側のCI確認。
同tagのBuild DesktopはmacOS ARM／Intel・Windows x64・Linux x64／ARMの全5構成で成功。
run: https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40564352907
詳細：[cdrom2_operator_tabs_01.md](cdrom2_operator_tabs_01.md)と同名JSON。

### PC Engine CD-ROM² 3系統の音声対応完了 — 2026-10-28

ユーザーの続きの「進めて」で、MSM5205を共通C11／WASM／Nativeへ接続。
新mode `pc-engine-cd`（PC Engine CD-ROM²）で`pce`／`adpcm`／`cdda`を使用できる。
`pg.msm5205`は他modeでも共通system sourceとして利用可能。OPN等の`adpcm`は従来通り。
64KiB符号化RAM、16段階rate、WAV／PCMの変換、nibble単位の範囲、Loop／Stop／Reset、raw write、状態取得。
3入力のMixer、Main／Worker、offline WAV出力、元音声を生成するstarter／Exampleまで実装済み。
既存VGMのMSM5205 JS／公開command／既存gain／SDK pinは変更なし。新汎用createSoundChip typeは未追加。

原本`native/msm5205/`と`web/msm5205_*.js`。WASM3590bytes／固定128KiB／host importなし。
準備時に最大64KiBへ符号化、renderは確保・file読込・UI block要求なし。Nativeは同じcallbackで混合。
Stop／置換／旧generation／raw write取消を保護。Mix予約は保持。無準備hostはstrict zero。
loopはpredictorを継続するため、Exampleには25ms fadeを入れてstep0に戻し、音量増大を避けた。
新modeのPSGは既存PC Engineの0.44を継承。ADPCM／CD-DAはunity、index.jsでMixer指定なし。

実C11／C++14／WASM・従来JS raw PCM／全状態が44.1／48kHzで一致。全16rate等も検証。
Web関連4636、音声用unit55、全mode型、実3core offline合算／WAV3件が成功。
Chromium153／WebKit26.6の全8route成功：単体44.1／48kHz、実Playground Main／Worker。
WASM差0／Stop後0／Mixer各入力・volume維持・再実行・実starterを確認。
全292served sourceが最終treeと一致、198runtime assetもflat ZIPと同hash。
全Cargo780成功／4既存ignore／失敗なし（共通callback変更のため全回帰）。
Tauri Python28／Node31、全24offline pin、Native source ZIP1975filesも成功。
実聴・実機比較・Tauri GUIは未実施、Browser試験の物理出力は捕捉後mute。

ZIP `release/hello_ymfm_wasm_pcengine-cd-dev_itch_playground.zip`（997files）作成、全byte照合済み。
SHA256 `3dbcb98e458bc71c92b8feacf90e7b58ee0686f8644d06952d7db58ccfc456f1`。
Tauriへ996effective files取込、dist／lock／ZIP一致。appで`npm run dev`して新modeと初期コードを選べる。
Native source ZIP SHA256 `9a3459d61325162fcfa2134b6ef69cb597637f0309c54e6246d51d193227b7a7`。
同期は`node scripts/sync_msm5205_native.mjs --write|--check`、app側`sync_native_msm5205.py --check`。

npm開発候補は318modules／28chip pairs＋CD-DA／MSM5205／367宣言／929files。
隔離installで実ADPCM／CD-DA WASMと型が成功。今回は公開していない。
CIへapp音声core build／parity／unit jobを追加。SDK referenceは既知app pairを別枠で検証。
SDK候補／prebuiltは従来の厳密検証を維持。CI guard105件成功、remote CIは未実行。
commit／push／tag／npm／itch.io公開なし。

詳細：[msm5205_pcm_01.md](msm5205_pcm_01.md)と同名JSON、Browser／coreの専用JSON。
使用法：[../msm5205.md](../msm5205.md)、[../cdda.md](../cdda.md)。
次は実聴確認と公開範囲の選択。CUE／BIN、圧縮disc音声、物理CD、BIOS／CPU／DMA／SCSI／IRQは対象外。

### CD-ROM²音声・CD-DA第1段階完了 — 2026-10-27

ユーザーの`todo_cdromrom_01.md`確認後の「進めて」で、共通CD-DA PCM音源を実装。
44.1kHz stereo PCM16 WAV／JSON track manifest、Play／Pause／Resume／Stop／Seek、位置取得、独立Mixerを追加。
PC EngineのPSGとBrowser／Nativeで混合でき、PlaygroundのMain／Workerとoffline WAV出力へ接続した。
MSM5205は従来のAnalyzer向けJSのまま。3系統のCD-ROM²全体は未完了として、計画10章に段階を明記。

共通C11 coreは`native/cdda/`（BSD-3-Clause）。WASM2257bytes、固定128KiB memory／4KiB入力窓。
元PCM16を保持して必要部分だけ変換。描画中の確保・拡張・ファイル読込やUIからのblock供給はない。
選択track最大256MiB、Nativeは現在source＋upload＋retainedの合計。同じ音声frame時計で進める。
Stopの予約取消、準備中の取消、切替とStopの競合、旧generationのcleanupを検証。
既存SDK pin／chip source・WASM／Mixer校正値は変更なし。

PC Engine modeのNew Cassetteへ`examples/pc-engine/pce-cdda.js`を追加。
元WAVをその場で生成するPSG＋stereo CD-DAのExample。外部音声／BIOS不要。
API使用法は[../cdda.md](../cdda.md)、実装詳細・検証は[cdda_pcm_01.md](cdda_pcm_01.md)と同名JSON。
次はMSM5205をNative／WASM・Playgroundへ接続し、その後3系統を混合するExampleと完了条件を確認する。
CUE／BIN、圧縮音声、CD全体の保持、物理CD、CPU／SCSI／BIOSは初回対象外のまま。

Web関連199件・全mode型＋CD-DA正負fixtureが成功。実coreは8／44.1／48／384kHzのNative/WASM/独立基準が一致。
Chromium153／WebKit26.6の単独44.1/48kHz＋実Playground Main/Worker全8routeが成功。
捕捉PCM差最大1.1920941123122475e-8、全282served file/checkerが最終checkoutとhash一致。
音声/runtime190assetは最終flat ZIPと同hash。実聴／Tauri GUI操作／実機比較は未実施、物理sinkは捕捉後mute。
全Cargo771成功／0失敗／4既存ignore。共有callback/event queue変更のため全Rust回帰を実行した。

ZIP: `release/hello_ymfm_wasm_cdda-pcm-dev_itch_playground.zip`、全975fileがstageとbyte一致。
SHA256 `18cbe5f9c64ca0bda4561f6cff9b5f5fc077c80deecef6c7af38c3698904f6c9`。
Tauriへ974effective payload取込、ZIP/dist/lock全一致。`npm run dev`で利用できる状態。
Native source ZIP1943file、SHA256 `48460e85d45f76b086459bb722ee7614555c63718607ba2b0db4f30510027897`。
全23offline pin・Python26／Node31成功。Tauriの新CD-DA snapshotもstandalone検証へ追加。
本体の同期／照合は`node scripts/sync_cdda_native.mjs --write|--check`、app側は`sync_native_cdda.py --check`。

npm開発候補は312module／28chip pair＋CD-DA／360宣言／903file。
隔離installでCD-DAの実WASM再生・44.1→48kHz・stereo／EOF／予約Pause／WAV出力と公開型を確認済み。
公開npmはFM0.2.31／VGM0.2.16のまま、今回の候補は未公開。commit/push/tag/remoteCI/itch.io公開も行っていない。

### POKEY外部Examples追加完了 — 2026-10-27

`w/tetorica-fm2612-examples`を公開済みnpmの`tetorica-fm2612@0.2.31`へ更新。
POKEYの4CH melody、distortion/noise・joined timers、2台4+4CHの3例をWeb/Node両方へ追加。
各例は独立した編集・再生可能なコードで、Nodeでは44.1kHz stereo PCM16 WAVを保存する。
catalog/README/runtime説明へ反映し、`npm run build`と`npm run build:docs`でサイトを生成済み。
`npm run dev`のPOKEYカテゴリから開ける。今回の変更前からあったWonderSwanの未commit作業は保持。

単体clockは1789790Hz、dualは各1789773Hz。dualは独立した2coreをmonoで合算。
engine unity・10Hz DC blockerを通し、出力gain0.25は一度だけ適用。Mixer校正値やcoreは変更なし。
noise比較のA4はpoly9の周期とtimerが重なりDCとなったため、同じtimer条件で比較できるB4へ変更。
通常tone、joined C2/G2/C3/E3、dual両側8CHと片側停止後の残り4CHを確認。

Node全33例が成功。新3例は145530/180810/145530frames、peak0.079376/0.039734/0.122406。
最終docsでChromium153/WebKit26.6 × 3例の全6routeが成功。
実PCMのpitch・noise/volume・2台独立・Stop後exact zero、取消・error・再実行・pagehide cleanupを検証。
物理sinkはcapture後にmuteしており、今回の実聴・実機比較は未実施。
desktop3画面/mobile1画面の表示と、dev server5routeのHTTP200・source byte一致も確認。serverは停止済み。

dist/docs全1120fileがbyte一致し、Browserが読んだ73assetも最終両treeとSHA256一致。
公開npm archiveの880fileはnode_modules/docs/vendor/dist/vendorと全byte一致。
archive SHA256: `6941d3474abd619fd0cec1b41b79f51c6011ca49d3bf9ab47ca31422e641851d`。
Browser receipt SHA256: `890bd27b7c73d4b635a2c435c35791857ddef79dec9e5a6a0afd8420f3edd4f3`。
詳細は[atari_pokey_examples_01.md](atari_pokey_examples_01.md)と同名JSON。
commit/push/npm/GitHub Pages公開操作なし。SDK/core/WASM原本は変更なし。
次の候補はSDK0.1.5 localCandidateの公開準備。SDKの公開tag/releaseは未実施。

### POKEY Operators / voice editor完了 — 2026-10-27

ユーザーの「pokeyでやり残したことを進めて」で、PlaygroundにPOKEYタブを追加。
Atari 8-bit / Dual POKEYの4物理CH、2台の選択、Browser/Nativeの追加POKEYを扱う。
適用済みtimer/register/volume/distortion/DAC/shared clock・poly・joinを表示・編集し、
Hold/1秒preview/Guitar・PC Keyboardで試奏。共通Keyboardは右下にも表示できる。
joined lower helperやtimeline準備/再生中は、共通Keyboardも発音命令を送らない。
コードcopyはprimaryのpokey/pokey2を区別し、追加instanceは明示的なchip binding commentを出す。
可視タブ用の既存更新処理を使い、開く・選択・状態取得では音源を書き戻さない。
Browser追加POKEYのavailabilityはmetadataのみで更新し、hidden中のInspector RPCはない。

実Browserで見つけた再Run後の試奏音残りも修正。
Main/Workerとも音声準備完了と現run確認の後、新しいコード実行前に既存clearAuditionsを呼ぶ。
無効な実行方式/未対応Worker/未知のsource/準備失敗では試奏を解除しない。
新たに通るNative経路のテスト用snapshotを実際のRust protocolへ補完し、assertは維持。
SDK/core/生成WASM/Mixer値・Rust/DSPは変更なし。cacheはpokey-voice-1。

全Web/Playground4567件・mode型・Mixer生成値checkが成功。
package305module/28WASMpair/352declaration・隔離install・実WASM・型3構成・880file検証成功。
最終flatのChromium153/WebKit26.6 × single/dual/Genesis extras全6routeが成功。
142capture/720896frames per channelで発音・pitch/level反応・解除後exact zero・左右一致を確認。
単体のMain/Workerで手動lease/別CH所有権、hidden RPCなし、helper/busyの試奏RPCなしも確認。
物理sinkはcapture後mute。実聴/実機比較は今回行っていない。

ZIP全959fileがstageとbyte一致、実Browserの277served assetも同ZIPとSHA256一致。
ZIP: release/hello_ymfm_wasm_pokey-voice-dev_itch_playground.zip
SHA256: d367568cc0dfd300f0fdff05f5b50fc719c4e7028535706bd189f3a6a2499675
Tauriへ958effective payload（既存規則で.DS_Store除外）を取り込み、dist/lock全一致。
Python24/Node31・22offlinepins・source ZIP1919fileの検証が成功。Cargo再実行なし。
source ZIP SHA256: f0afc0a1696c9b33f145215136a99b05e6f3c771ac923fd1ee2922784a9eb2d6
詳細は[atari_pokey_operators_01.md](atari_pokey_operators_01.md)と同名JSON。
commit/push/tag/remoteCI/npm/itch.io公開操作なし。npm公開版はFM0.2.31/VGM0.2.16のまま。
残りの候補は実際のPOKEY VGM/音色の実聴・Atari実機との比較、外部POKEY I/O等。

### POKEY npm公開完了 — 2026-10-27

ユーザー指定はnpm2packageのみ。FM0.2.31/VGM0.2.16へversion/README/CLI文書を更新し、配布物を検証済み。
FM305module/28pair/352宣言・隔離install/実WASM28種/型3構成が成功。880file全byteがstage/installと一致。
VGMは1157成功/1既存optional skip、隔離168module/単双POKEY/12channel/2seek/API/CLI/source/全277file照合成功。
検証済tgzとreceiptは`/private/tmp/npm-pokey-release-20261027/{fm,vgm}/`へ保持。
FM tgz SHA256 `6941d3474abd619fd0cec1b41b79f51c6011ca49d3bf9ab47ca31422e641851d`。
VGM tgz SHA256 `1ee60b3caa7978f0129d3af7436860f6d19bc32aabe65977de9f4ab8d8add0a2`。
更新リンクでのユーザー認証後、両方の検証済tgzのnpm publishはexit0。FM0.2.31/VGM0.2.16の公開とlatestをregistryで確認済み。
registryから取得し直したtgzは検証済候補と全byte/SHA1/SHA512が一致。公開物のFM880file/VGM277fileも照合済み。
公開時の認証待機とnpm側の非同期反映待ちは解消済み。今回のnpm2package公開作業は完了。
SDK/core/WASM/Mixer変更なし。SDK候補0.1.5の公開、Examples/itch/Tauri/ZIP更新、commit/push/tagは今回対象外。
詳細は[npm_pokey_release_01.md](npm_pokey_release_01.md)と同名JSON。

### POKEY timeline準備の分割 — 2026-10-27

ユーザーの「すすめて」で、演奏中の大trace prepareによるWorklet集中負荷を軽減。
Browser clientは呼出側でsnapshot後、最大16KiBのowned chunkをtransferし、検証ACKごとに次を送る。
Workletはprocess1回あたり最大1024writes/16KiBを検証。render分割の回数では増やさない。
chunk列を保持したままO(1)commitし、playback cursorも連結copy/イベントごとのtyped view生成なし。
準備中は既存の通常voice/commit済scoreを保ち、Stop/reset/allNotesOff/dispose/owner/session/port置換でstageを取り消す。
別loopへの準備置換では元ownerのidentityでACKなしabortを送り、古い遅延ACKからの再開を防ぐ。
Nativeは従来のcontrol側prepare RPCを継続。SDK/core/生成WASM/Mixer値・Rust/DSP変更なし。
cacheは`pokey-prepare-1`。4SDK checkerの既知cache keyも追加し、実Web/docs21組の正規化を確認。

全Web/Playground4531件、helper/Worklet/timeline26件、mode型が成功（重複あり）。
package305module/28pair/352declaration、隔離consumer/実WASM28種/型3構成が成功。
local tgz880file全byteがstageと一致。version0.2.30据置の未公開候補。公開npm0.2.30にPOKEYは未収録。
tgzは`/private/tmp/pokey-prepare-package/tetorica-fm2612-0.2.30.tgz`、SHA256
`c795d9e4689bb1dbeb79bd0ba6da483eed12f37f4c5422abaeec6d33c4ba2bb5`。
docsのChromium/WebKit×44.1/48kHz×Main/Worker全8routeで、別POKEYの演奏中にprepare/取消を確認。
最大8MiBの4routeは512chunk/同時pending ACK最大1、約8.2秒でprepare完了。
300KiBは約0.325–0.356秒。全1762432framesが独立WASM基準と差0、stereo/非有限値/欠けたcapture quantumも0。
stage取消48caseと取消後の短いscore再生も成功。物理sinkは測定後mute、実聴/OS出力deadline保証は含まない。
ZIPは`release/hello_ymfm_wasm_pokey-prepare-dev_itch_playground.zip`、958file全byteがstageと一致。
ZIP SHA256 `34404c07c2ba398a3f8485dc8850dc7305db3d9c4e2af0df8611b8af367bc834`。
Tauriへ957effective payload取込済み。source ZIP1918file/22pins・Python24/Node31件が成功。
source ZIP SHA256 `bd07482e8c7ffba7faf037260792eed91185a6891c1aba9f0c026fa3fe84be82`。今回はCargo再実行なし。
追加のflat Browser/取り込みUI再試験は、実行要求がsession/outputを返さず起動待ちとなったため中止。拒否の通知はなくrunnerも残っていない。
完了済docs Browserが実際に読んだ25runtime assetは全て最終ZIPとSHA256一致。flatでの追加capture成功とは扱わない。
詳細・配布検証は[pokey_timeline_prepare_01.md](pokey_timeline_prepare_01.md)と同名JSON。
commit/push/tag/remoteCI/npm/itch.io公開操作なし。

### Playground POKEY VGM import完了 — 2026-10-27

ユーザーの「進めて」で単体/dual POKEY-only VGM/VGZの取り込みを実装。
専用dialogはRaw/解説付き/High＋byte-identical raw fallback。生成owned chipは元clockを保持し、
offline builderで全scoreをprepareしてから同じabsolute startFrameで一度だけ再生する。
DAC stream0x1e/0x9eは共通parserの時刻をpacked delta/register/valueへ展開。dualも1sidecar、ordinaryはsidecarなし。
Browser Worklet/Native callbackが直接cursorを消費。clock/8MiB/rolling512writes/128frames等の検証付き。
開始frameでcore+speakerをcold resetしmonitor muteを保持。Stop/reset/owner/session/dispose/Run置換を処理。
await後のBrowser/Worker owner復帰とNative primary POKEY group管理を修正。
Nativeのupload byte-accounting/expected control rejection/Stop→finalize後audition掃除も修正。
Mixer値・SDK・音源core・生成WASMに変更なし。cacheは`pokey-import-1`、npm metadataはFM0.2.30/VGM0.2.15据置。

docsのChromium153.0.8010.12/WebKit26.6×44.1/48kHz×単/双×ordinary/DAC×3style×Main/Worker全96PCM成功。
2,873,520frames/channelで最大差0。44.1kHzは元VgmPlayerとも差0。48kHzはabsolute source sampleのceil配置を基準に直接render。
Monaco diagnostics/Cancel/invalid4種/自然終了/dispose/Run置換/即Stop/404/pageerrorも成功。
receiptは `/private/tmp/pokey-import-browser-docs.json`。最終全Web/Playground4503件・NativeJS65件・mode型成功（重複あり）。
Native futurestart待機時の旧gate消音とendframe MAX_SAFE検証もBrowserと揃えた。POKEY Rust17件、全Cargo764成功/4既存ignore。
最新Native/WASM timeline PCMは44.1/48kHz計1945framesで差0。
package304modules/28pairs/351declarations build・isolatedconsumer・3種型構成成功。
最終candidate878fileは全tarball memberとstageのbyte一致。0.2.30据置の未公開開発版で、公開npmにPOKEYは未収録。
tgz SHA256 `7bb63c433763600aea071fde06f26f0b13b4424008d1d04f28e686f6bf1e191a`。
docs96後のBrowser変更はJSDoc注釈のみ、Native側はexpectedrejectのrange messageを1件追加。両方flatへ反映済み。
ZIPは`release/hello_ymfm_wasm_pokey-import-dev_itch_playground.zip`、stageは`release/itch_playground_pokey-import-dev`。
最終flat Chromium44.1k＋WebKit48k計48PCMも差0。ZIP957file全byte一致。
ZIP SHA256 `dfa777c90ab8877ed84fd1a68336b2573d02ab26c3e5c8adb10e33abc780d059`。
Tauriへ956payload全byte取込（既存規則で.DS_Store1件除外）、source ZIP1917fileと22pins照合、Python24/Node31成功。
source ZIP SHA256 `211483a292816751745362e17f9a101c60a542a5427a4366bdcdda4f45a1a3c5`。
詳細・証跡は[atari_pokey_vgm_import_01.md](atari_pokey_vgm_import_01.md)と同名JSON。

Browserの大trace prepareは現状Workletで全scan/copy。warm Node8MiB約32–35msなので演奏中prepareでは割込み得る。
生成importは全準備後に発音する。次はユーザー環境で実際のPOKEY VGMを聴き、必要なら演奏中prepareの分割upload/validationを進める。
実聴/実機比較は未実施。commit/push/tag/remoteCI/npm/itch.io公開操作なし。

### POKEY VGM Analyzer接続完了 — 2026-10-27

ユーザーの「すすめて」で、POKEYのVGM Analyzer対応を実装。
VGM1.61+ header0xb0/dual bit30、BBのchip選択bit7、標準DAC stream0x1e/0x9eを共通parser/playerへ接続。
Analyzerは単体4CH/2台8CH、独立Mixer `pokey`/`pokey:2`、Operator Infoのregister/mode表示。
通常tone・poly noise・volume-only・joined/helper・shared clock/filterを区別。新polling/audioへのUI書戻しなし。
Muteはタイマーを維持し再生/seek後も保持。seekは両コア/DC状態を先頭から再実行し、checkpoint非対応。
Note-ish/Song/楽譜/MIDI/FM音色/sample exportはPOKEYで無効。既存header-composed mixにも独立接続。
SDK/core/生成WASMは変更なし。POKEYのMixerは未校正unity1、隠れたdual減衰なし。
Analyzer既存18Extra/12PSG capturesを実測しPCMhash/音量が完全一致。Extra05/PSG06へreceipt更新、strictguard維持。
共通parser/playerとAnalyzerの1151testは1150成功/1既存optionaltool skip/0失敗。実WASM/seek/mixed等18件も成功（重複あり）。
最終flatのChromium153/WebKit26.6で全4/8CH、可視Operator Info更新、独立Mixer、DACstream、pause/seek/Stop/replayが成功。
193served assetをZIPとhash照合、全421fileをstageとbyte照合。測定出力は物理sink直前で無音化、実聴/実機比較は未実施。
ZIP: release/hello_ymfm_wasm_pokey-vgm-dev_itch_vgm_analyzer.zip、SHA256
`415eca667067e9df6678d6c650f4f87e3739c53977df67d22caf508df7d7e2d7`。
Analyzer Tauriへ同421payload取込済み。ZIP/dist/lock全hash一致、Python6/Node4件成功。NativeDSP変更なし。
npm VGMローカル候補277file/168module/API/CLI/12CH/WAV/JSON/stream/noise seek/独立lifecycleが成功。
tgz SHA256 `f04a33327c4df3d1c119f211c328666abcd5887f8d6c2c895b7108c3769f9141`。
version0.2.15据置の未公開候補で、公開npm0.2.15にPOKEYは未収録。
FM packageも302module/28pair/349宣言のbuild・型3構成成功。version0.2.30据置、再公開なし。
cacheは`pokey-vgm-1`。version_playground_runtime＋version_vgm_analyzer_runtimeでwebsiteのみ同期更新。
詳細・配布証跡は[atari_pokey_vgm_analyzer_01.md](atari_pokey_vgm_analyzer_01.md)と同名JSON、npm証跡はatari_pokey_vgm_package_01。
本体/Analyzer Tauriは未commit。公開npm/tag/push/remoteCI/itch.io操作なし。前節のSDK0.1.5候補公開も未実施のまま。
次は実際のPOKEY VGMをユーザー環境で聴き、続けるならPlaygroundのPOKEY VGM import対応。

### SDK0.1.5候補・POKEY JS/Playground接続完了 — 2026-10-27

ユーザーの「すすめて」で、前節のSDK更新/importとJS API・Playground接続を完了。
SDK原本は0.1.5へ更新しlocal source ZIPを生成。本体/Tauriへ408fileを固定import済み。
公開tagではなくlocalCandidateで、base commit f45cd27…と変更metadata5fileをpinへ明記。
source ZIP SHA256 `aebde59e8c8c95ea55d69d42b17e6b9ef2231835a4935411292948e740d98a07`。
全29WASM recipeをbuild、従来55outputsはbyte不変、POKEY pairを追加。中央receiptは29artifact/57outputs。
詳細は[sdk_015_adoption_01.md](sdk_015_adoption_01.md)。SDK/publictag・release・commit/pushは未実施。

`Pokey` raw/Synth/10Hz speaker engine/汎用WorkletとTransportを追加。直接read/PCMは同期、Worklet read/barrierはACK付き。
Playgroundには`pokey`（Atari 8-bit、1789790Hz）と`pokey-dual`（Atari Arcade、1789773Hz）を追加。
各modeはchip:'pokey'。global `pokey`/`pokey2`、primary id `pokey`/`pokey:2`、4CHは0..3。
Browserは専用Worklet、Nativeは独立extrasをprimaryとして所有。WorkerのNative portはglobalNameで分離する。
POKEYのclockは生成時固定（同値ACK・異値拒否）。Mixerは新kind/2modeとも明示unity1・未校正、既存gainは不変。
KeyboardのChip/CH選択、音量0保持、rawread、手動試奏保護、joined helper保護、停止・再実行を実装。
POKEY固有Operatorsタブは今回追加せずchipTabs:[]。VGM Analyzer/importは未接続。

全Web/Playground4419件、mode型、SDK76Node/22Pythonが成功（重複あり）。
Native speaker36case・294912framesが差0、Native実コア9件、全Cargo756成功/4既存ignore。
全29WASM batchは57outputs/40474厳密比較が成功。事前build済みSDK出力を再検証して利用。
終了後の変更は4つのtest fixture/cache期待値のみで、runtime/SDK/build入力は不変。最終4419件は修正後の全体再実行。
パッケージbuildは302module/28pair/349宣言、型3構成/実WASM28種/dual独立/全874file byte照合が成功。
version0.2.30据え置きの未公開開発版で、npm公開版にはPOKEYは含まれない。
候補tgz SHA256 `ce03debb000a5b09c8232775319754c3a2dfabcc70be4eb9de450e2da0d04bae`。
PSG18実測は全値不変、source receipt04へ更新（soundchip_psg_calibration_refresh_03）。
最終flatのChromium/WebKit全6routes（各Main/Worker）で単体/dual・Keyboard全4CH・独立Mixer・Stop/rerun・Genesis追加2台/片側disposeが成功。
runnerはscripts/check_playground_pokey_browser.cjs。272served fileをZIPとhash照合、全954fileをstageとbyte照合（うち1件は既存.DS_Store）。
Playground ZIPはrelease/hello_ymfm_wasm_pokey-mode-dev_itch_playground.zip、SHA256
`e2cf91820eb2b5c946edbfe42fa9f6dd604f344dc2818768306442d9cdd734fe`。Synth ZIPも再生成・参照検査成功。
Tauriへ953payload file取り込み済み、Python24/Node31件成功。
対応source ZIP1913fileのSHA256 `46dcc0dea85b28ab97d521741fc342b2fe04dec30d880464a1d18a0294b9b001`。
詳細・最終配布証跡は[atari_pokey_playground_01.md](atari_pokey_playground_01.md)と同名JSON。
物理出力はミュートした自動測定。実聴/実機比較・POKEY Operators編集・VGM Analyzer/importは未実施。
次は単体/dualをユーザー環境で実聴し、SDK0.1.5のcommit/tag公開後に公開archive来歴へ明示更新する。npm公開は別途。
本体/SDK/Tauriは未commit。公開npm/tag/push/remoteCI/itch.io操作なし。

### Atari POKEY SDK原本・2台構成 — 2026-10-27

作業対象は`w/tetorica-soundchip-native`のSDK原本。POKEYの単体Native/WASMコアを追加。
BSD-3-Clause明示のlibvgm `pokey.c`をcommit61b62d…へ固定し、原本/SHA/credits/LICENSEを保持。
ライセンス無記載の別framework headerは含めず、独自C++14接続へ置換。
`tetorica::Pokey`とC ABIの各handleが4CH/clock/ノイズ/位相/mute/resetを独立所有する。
同一WASM内の複数handleにも対応。2台はホスト側でmono合成/明示stereo routingできる。
Atari TetrisのMAME driverは2台をMASTER_CLOCK/8、mono0.5ずつで接続。Exampleは整数近似1789773Hz。
raw coreはlegacy gain744・32767clip・/32768・DCを保持。Mixer調整やboard filterは追加しない。
Native/WASM57case×2分割・235091framesが差0。独立DAC/pitch/bounds/dual検証32件成功。
Native CTestとWASM smoke1524102framesが成功。独立コードreviewもblockerなし。
配布ソース抽出から全21Native libraryをbuild、全26CTest/20WAV/10JSチェック成功。
POKEY fixture3,055,137checks・ASan/UBSan、Python全70testが成功。
抽出ソースから再buildしたWASMもpair全byte一致し、配布/再build両方でsmoke1,524,102framesとNative比較57caseが成功。
最終archive監査済み。再build試験後の差分は文書4fileのみ、全286Native source/header/CMake fileは全体build試験時と一致。
CIは5Native構成と3WASM構成、POKEY jobでNativeとの2比較を行う形へ拡張。remote CIは未実行。
試聴用は`/private/tmp/pokey-sdk-native/dual-pokey-mono.wav`（自作3秒・48kHz）。
ホストExampleだけ20Hz DC blockerとfadeを使い、raw coreとは分離。実聴/実機比較は未実施。
本体の固定SDK0.1.4・既存WASM・runtime/Mixer/npmは変更なし。JS API/Mode/Analyzerは未接続。
詳細は[atari_pokey_core_01.md](atari_pokey_core_01.md)とJSON。SDK原本/本体記録は未commit。
次はSDKの新versionをrelease/importし、JS raw/Synth APIとPlaygroundへ接続する。
今回のlocal検証ZIPは既存manifest0.1.4の開発物。公開tag/release/npm/本体固定snapshot更新は行っていない。

### WonderSwan汎用Worklet・Examples・npm0.2.30 — 2026-10-27

`createSoundChip('wonderswan', {execution:'worklet'})`と`WonderSwanWorkletTransport`を追加。
共通Mixer・Main/Worker・転送MessagePort・非同期RAM/read/mute・ACK barrierに対応。
実AudioContext sampleRateと固定chip clockを使い、出力は既存speaker rendererの中心値補正を再利用。
raw Direct PCM・Mixer値・SDK0.1.4・C++・生成WASMは不変。source音量1.0とendpoint gain0.25は別。
時刻付きVoice PCMは最大65,536件を事前予約、cursorで消費し、Stop/reset/dispose/owner取消で解除。
短区間のborrowed viewをcacheし、heap拡張後も再生成する。owned PCM APIは保持。
source94/既存generic8/既存WonderSwan73test成功。raw126case・3,096,576frames差0。
293module/27pair/339宣言build、985参照/15renderer/実WASM27/3種の型構成が成功。
最終archive841fileをstage/隔離installとbyte照合。Chromium153/WebKit26.6でMixer・実Worker・Voice PCM・停止後無音を確認。
Examplesへ4CH Wave、Noise/Sweep、1秒12kHz Voice PCMのWeb/Node3例を追加。Node全30例とBrowser全6caseが成功。
物理音声はミュートしたPCM測定で、ユーザーによる実聴は未確認。
PSG校正18件を再実測し全数値一致。source receipt03へ更新しguardは維持、gain変更なし。
検証済みtgz SHA256は`37039bfec4786e09163e955a8830b7c32b3db12651c68b41bedd22e8aec298e4`。
npm0.2.30公開済み・latest確認済み。registry再取得と検証済みtgzの全byte/SHA1/SHA512一致。
Examples依存/lockはregistry公開版0.2.30へ更新済み。全841package fileを検証済み配布物と照合。
`build:docs`で59例・1,069fileを生成、ソース/リンク照合とdiff検査が成功。
詳細は[wonderswan_factory_worklet_01.md](wonderswan_factory_worklet_01.md)と同名JSON。
本体・Examplesは未commit。commit/push/tag/CI/itch.io/Examplesサイト公開の操作なし。
次はExamplesをユーザー環境で実聴し、必要ならcommit/pushしてサイトを更新する。

### npm共通factoryのWonderSwan Direct対応 — 2026-10-27

npm入口の`createSoundChip('wonderswan')`を追加。既存loaderと生coreを使い、独立handle・readonly ID・同期register/RAM/PCM APIを返す。
clock/sampleRate/moduleFactory/moduleOptions/assetBaseUrl/signalを共通規則で転送する。raw wrapperのJSDocを補い、数値read・RAM bytes・mute・PCM引数の型を明示。
READMEへSynth波形→A4→WAVの実行可能Example、生成RUNTIME案内も追加。汎用Worklet・Playground専用endpointの変更は今回に含めない。
source39test（新factory7件を含む）、293module/27pair/339宣言build、NodeNext/Bundler/Node型なしBrowserの型確認、隔離package/実WASM27種が成功。
最終local archive841fileをstage/隔離installと全byte照合。Chromium153/WebKit26.6のWindow/実module Workerで26,648 PCM比較が差0、14 served fileがarchiveと一致。
README Exampleも同archiveのconsumerで実行成功。音声device/AudioContext/Workletを開いていない。
入口変更で失効したPSG校正receiptは実測18件＋過去loader/current PCMの完全一致で02へ更新。Mixer値/生成preset/WASM/core/SDKは変更なし。
local tgzは`/private/tmp/wonderswan-direct-factory/tetorica-fm2612-0.2.29.tgz`、SHA256 `8a47f4dc0d86b9a8579a397c9f216154ee275b9c57403e5be8bf6e31093f2c59`。
versionは0.2.29据え置きで未公開。この追加は公開済みnpm0.2.29には含まれない。commit/push/CI/Tauri/itch.io操作なし。
詳細は[wonderswan_factory_direct_01.md](wonderswan_factory_direct_01.md)と同名JSON。
次の候補は汎用Worklet対応（専用Playground経路とは別）か、予定していた新音源Atari POKEY。

### WASM SDK CI修正 — 2026-10-27

GitHub Actionsのrun40431173080/40432531260は、全28音源のbuild後、7番目Nuked OPN2のWeb/docs同期確認で失敗。
JSDoc importへ追加した`wonderswan-pcm-timeline-1`が4checkerの既知cache keyに未登録だった。
Nuked OPN2/YM3438/YMF276/YMF288の許可リスト4行へ同keyを追加。他の検証は維持。
全28checker/68wrapper組の静的監査、CI先頭95testが成功。
失敗CIで実build済みのLinux Emscripten6.0.6成果物を再利用し、全28音源/55出力/40,360厳密比較が差0で完了。
ローカル比較はNode26.12.0、元CIはNode22.23.3。新しい再compileや修正後remote CI実行はしていない。
Runtime/SDK/JS・WASM/Mixer/npm配布物は不変、npm再公開不要。今回の修正・記録は未commit/push。
次はcommitしてpushし、既存workflowの再実行結果を確認する。
詳細は[wasm_sdk_cache_key_ci_01.md](wasm_sdk_cache_key_ci_01.md)と同名JSON。

### npm公開 — 2026-10-27

`tetorica-vgm@0.2.15`と`tetorica-fm2612@0.2.29`を公開済み。両方のlatestとregistry配布物を確認。
registryからの再downloadは検証済みtgzと全byte一致し、SHA1/SHA512 integrityも一致。
VGMは時間付きVoice PCM/未使用Wave RAM区別、FMはWonderSwan core/Synth/Worklet/timelineとSDK0.1.4 sourceを含む。
VGM隔離install/API/CLI/JSON/ZIP/WAV/実曲/CLI16件、FM全841file照合/実WASM27種/型/Chromium・WebKit Worklet試験が成功。
Mixer値は変更なし。詳細は[npm_wonderswan_release_01.md](npm_wonderswan_release_01.md)と同名JSON。
今回のversion/README/公開記録変更は未commit。tag/push/CI/itch.io操作なし。

### 現在地

VGM AnalyzerのWonderSwan Sample Explorerへ時間付きVoice PCM抽出を追加。
Cat Songの以前の6波形/11観測はすべて未使用RAMで、実際のCH2 Voice PCMが抽出対象外だった。
今は元byte/time、gate/mode/output/routing、current/last-tick registers/source phaseを捕捉し、
Voice off/CH2 off/EOF/10秒windowで区切る。固定12kHzへ丸めず、元の3/4samples間隔を保持する。
位相と保持値を2秒以下のpre-rollで復元し、Voiceだけの試聴・JSON・44.1kHz stereo WAVを提供。
未使用Wave RAMは別の閉じた候補groupへ移動。Waveの発音後/同時刻の周波数・音量・出力変更も反映する。
usedInPlayback/audibleは正の時間、gate/headphone/音量の条件による使用区間であり、実音量の測定や楽器境界推定ではない。

実曲はVoice10区間+未使用RAM6件、PCM1,151,160bytes。
全byteのSHA256は元sourceと同一の`dde01930a60baf9da477565c7ed9561a4b43924b33fe6b3d435243ae1c1ebf52`。
全Analyzer/API試験599成功+既存1skip。新実WASM比較9件（重複あり）、Node/npm隔離offlineのAPI/CLI/JSON/ZIP/WAV検証成功。
最終flatのChromium153/WebKit26.6で実曲0秒/10秒地点の各0.5秒(22,050frames/ch)が独立CH2出力と差分0、WAV PCM16差分0。
全10区間JSON/ZIPのbyte/timehashが元VGMと一致。UI JSONはZIP内ファイルと同一。
通常docs機能確認も両Browser成功（その後support案内文のみ訂正）。現行正本は最終flat証跡。
flat187served fileのhashを最終ZIPと照合、ZIP401fileはstageとbyte一致。Analyzer Tauriへ同401file取り込み済み、Python6/Node4件成功。
最終AnalyzerZIPは`release/hello_ymfm_wasm_wonderswan-voice-dev_itch_vgm_analyzer.zip`、SHA256
`e9e43bbb75131ce853006062daca111c1c18a0621bdceb1d52da86ff89e29bd5`。
local npm tgz SHA256は`f9a893540c7fe8beabeccd92dd33a352d4ecd3ddda396f7f01735f6a1daeae2b`。
README/CLIを含む主要17sourceが現行原本と一致。

cacheは`wonderswan-voice-samples-1`。更新Analyzerを再読み込みし、同じVGZをLoad→Samples→Analyze samplesする。
同一音源の元出力を検証しているが、previewは外側のMixerと先行Wave出力を含まない。実機比較/人による実聴は未実施。
元C++/SDK固定ソース/55 WASM出力は不変。配布時の既存校正receiptのJSDoc cache URL差分は、
実測30件の完全一致を確認して新receiptへ更新。Mixer値/計算式は変更していない。

Analyzer/Samplesの本体変更は`c5dd39fc`までcommit済み。続いてnpm VGM0.2.15/FM0.2.29を公開（上記）。
次は更新Analyzerを再読み込みし、同じVGZから抽出したVoice PCMをユーザー環境で実聴する。
詳細は[wonderswan_voice_samples_01.md](wonderswan_voice_samples_01.md)。最終配布証跡は同名JSONへ保存済み。

### 直前のPlayground WonderSwan PCM再生タイミング修正

WonderSwanの取り込み自体は成功するが曲が崩れるという報告を調査。Voice PCMの値／時刻の解析は正しく、
JSのwaitUntil→即時writeでは同じ音声量子へ複数値が到着して途中の値が鳴らない問題だった。
AnalyzerのWave RAM抽出はVoice PCMを対象外にしており、抽出失敗と再生のPCM認識は別問題。

ws.createTimeline({clock,pcmData})で音を鳴らさずにscoreを作り、score.at(sample)・raw/high API・score.pcm()を記録。
prepareTimeline(score.finish(total))→await playTimeline()として、レジスター／RAM／packed PCMを同じ時刻表で
音声側へ渡す。44100Hz source sample→ceil(sample*outputRate/44100)の境界で適用する。
Web WorkletとNative共通primary/extra rendererへcompact cursorを追加。Stop/reset/dispose/session/owner取消、
予約済み開始・clock変更・手動試奏の競合も扱う。Native primary Mainのgroup所有者も接続した。
データ8MiB・参照PCMの検証作業量8MiB・連続128出力frameで最大512writesの事前制限。
元の音源C++・SDK固定ソース・55 WASM出力・Mixer値は不変。

実曲の全1,151,363操作はRaw/Readable/Highとも元のtrace SHA256
`da5772eadf630cabbe1120d1d79219c22055e8ef64b7e44bdc0baa04e4651ada`と一致。
204rows・PCM2,302,320bytes。新Web実WASM比較、Native実コア比較とも44.1/48kHzで波形一致。
全Playground1,138件・core/import/builder50件・Web Worklet41件・scheduler78件・全mode型検証が成功（重複あり）。
最終flatのChromium153/WebKit26.6でRaw/Readable/High×Main/Workerの全組合せについて、
合成12kHzの31,200frames/ch（終端無音を含む）と実曲冒頭0.5秒の24,000frames/chが独立基準と差分0。
既存4CH Wave/Noise/Sweep/Voice/Genesis/Run再実行/Cancel/不正入力/Stop/disposeも成功。
通常docs WebKitのtiming比較も成功。通常257/flat266served fileのhashを現行ソースと照合、flatはZIPとも一致。
Native JS87件・Tauri Cargo747active成功/4既存ignored（MCPのport試験2件は権限付き再試験で成功）。
Tauri Python22/Node31件も成功。55 WASM出力は固定SDK採用時とbyte一致。

最終ZIPは`release/hello_ymfm_wasm_wonderswan-pcm-dev_itch_playground.zip`、SHA256
`7c37e1b8e986989f356073a844496be5170b06f599fc0b30ee0194cb33b90391`。Synth ZIPも更新。
Playground Tauriへ922fileを取り込み、対応sourceZIP1,864fileのSHA256は
`15adcedf7d0d4284f4cd0e5459614eae08e30aab5955d9b4d20a394d3242dc70`。
22固定Native snapshots・SDK0.1.4/395file・対応sourceZIPを照合済み。
実聴・実曲全96秒のNative再生・実機比較は未確認。物理出力は測定後にミュート。

cacheは`wonderswan-import-3`＋`wonderswan-pcm-timeline-1`。
以前保存したJSは個別timer方式が残るため、再読み込み後に原VGM/VGZを取り込み直す必要がある。
新しいJSとPCM.datは同じCassetteへ保存する。実曲の音声・PCMはrepo／ZIPに収録しない。
本体／Playground Tauriが未commit。npm・version変更・tag・push・CI操作は行っていない。
次は更新版を再読み込みして同じVGZを再Importし、ユーザー環境で実聴確認する。
詳細と証跡は[playground_wonderswan_pcm_timing_01.md](playground_wonderswan_pcm_timing_01.md)とJSON。

### 直前のWonderSwan importサイズ修正（再生タイミングは上記で置換）

WonderSwan VGM importの高密度Voice PCMをコンパクト化した。100万write／64MiBコード上限に当たる実曲を確認し、
Voice bit有効中の連続0x89だけを「varuint時間差＋元のPCM値」の1つの.datへ保存する。
制御・RAMの書き込みは編集可能なJSとして保持。別命令でPCM runを分割し、同時刻順序・3/4samples間隔・最終時刻を維持する。
事前検証は非保持sink。通常命令／run header上限1MとPCM64MiBのメモリ／処理上限を分離し、上限を単純に引き上げていない。
データ破損は音源生成前に拒否、変換失敗時はVirtual Filesを変更せず、再生停止／例外はfinally disposeする。

実曲「04 Cat Song ~ Theme of UPA.vgz」は約96秒・PCM1,151,160回。元の1,151,363操作すべてについて、
Raw／Readable／Highの時刻・address・値のhash一致を確認した。保持イベントは204、PCMデータ2,302,320bytes、
UI生成JSは9,154／21,642／21,693bytesに収まる。実曲データをrepoや配布ZIPへ収録していない。
全Playground1,139件・新converter44件が成功（重複あり）。独立reviewも問題なし。
通常docs／最終flatのChromium・WebKitで全3形式・Main／Worker・実曲冒頭約1秒のPCM／Stop／disposeを確認。
通常267／flat265 served fileのhashを照合し、flatはZIP内容とも一致する。全曲の実聴・PCMのサンプル精度は未確認。
非同期の個別PCM配送は従来どおりで、今回直したのはImportのメモリ／コード量。音源・Worklet・Native・Mixer・55 WASM出力は不変。

現行ZIPは`release/hello_ymfm_wasm_wonderswan-import-dev_itch_playground.zip`、SHA256
`2436452222a5a84f655b0b6f5bfbc15be146dba94d3d5c441bd6ab9ab68fe2f1`。この開発ZIPパスは初回接続時から再生成済み。
Playground Tauriへ921fileを取り込み済み。対応sourceZIP1,862fileのSHA256は
`d60db8d7cdb46d64470a45a728254eab3163abda5106692a75f00863b441cac4`。
cacheは`wonderswan-import-2`。再読み込み後に同じVGZを取り込むと、JSとPCM.datが同時に作成される。
本体とPlayground Tauriの初回接続＋今回修正は未commit。公開・npm・tag・CI操作は行っていない。
次はユーザーの実聴、本体／Playground Tauriのcommit／pushとCI。詳細と最終証跡は
[playground_wonderswan_vgm_import_large_01.md](playground_wonderswan_vgm_import_large_01.md)とJSONを参照。

### 直前のWonderSwan VGM import初回接続

PlaygroundのVGM importへWonderSwanを追加した。VGM／VGZからRaw／説明付き／Highの演奏JavaScriptを生成する。
4CH Wave・RAM・Noise・Sweep・Voice PCM、source clock、BC相対レジスターとC6 big-endian物理RAMを保持。
DAC streamは既存parserのplayStep／consumeWaitで展開し、sample0・wait終端・同時刻の命令順を維持する。
生成コードは独立createSoundChipを作成し、setClock→reset→1回再演奏→finally dispose。初期化による追加writeはしない。
Highはbyte一致する音量・周波数pair・Voice PCMだけAPI化し、RAMにsetWaveform／keyOffを追加しない。
型宣言に既存adoptRegisterStateがなかったため追記した。全mode型検証成功。runtimeメソッドは元から存在した。
相対sleepSamplesは密なPCMで待機遅延が積み重なることをBrowserで確認したため、SPC importと同じ
createTimeline().waitUntil(sample/44100)へ変更し、曲全体の遅れを累積させない。
非同期wait方式であり、sample-accurate schedulingや元のloop点による繰返しは対応しない。密なPCMの実聴は要確認。
mixed／dual／variant・Hyper Voice／DMA・圧縮bank等は事前拒否。命令・展開・bank-copy・出力に上限を設ける。

全Playground Node試験1,130件、WonderSwan関連72件が成功（重複あり）。新converter35件で実WASMのPCM／timed write一致と遅延累積の回帰を検証した。
独立reviewと2,048period×6clockの12,288周波数roundtripも成功。音源・Worklet・Nativeコード・Mixer・SDKは変更しない。
55 WASM出力は固定SDK0.1.4採用時とbyte一致。Playground／Synthのstandalone packageも成功した。
現行ZIPは`release/hello_ymfm_wasm_wonderswan-import-dev_itch_playground.zip`、SHA256
`838ee8d1853f9d74b07a467b9e224f25abeb6cc768e06e299ca72cc77d676490`。
Playground Tauriへ921ファイルを取り込み、import照合・Python22／Node31件が成功した。
全22固定Native snapshot・SDK395ファイル・対応sourceZIP1,862ファイルを照合。sourceZIP SHA256は
`517e039c805a284f4873ef7dca23d33fb11d637a6af33d2df707d659508fa080`。
最終docs／flatをChromium・WebKitで確認。全3変換・4CH・Noise／Sweep／Voice PCM・Main／Worker・Genesis mode、
Stop／自然終了dispose／Run再実行／不正入力・Cancel時のファイル保持が成功。Monaco診断0、Stop出力peak0。
2秒の密なVoice PCMは全8構成で2.02〜2.19秒に収まり、タイマー遅延の累積を解消した。個々のPCM境界は非同期なので原音一致は保証しない。
通常267／flat265ファイルのhashを現行ソースと照合し、flat265件は最終ZIP内bytesとも一致。
物理出力は測定後に0にしており、実聴・実機精度・実Tauri WebViewの音声は未確認。
本体とPlayground Tauriが未commit。Analyzer Tauri／SDK原本はこのターンでは変更していない。公開・tag・CI実行なし。
次は実際のWonderSwan VGM／VGZをImportしてWeb／Nativeで聴き、本体とPlayground Tauriのcommit／push・CIを確認する。
詳細は[playground_wonderswan_vgm_import_01.md](playground_wonderswan_vgm_import_01.md)と最終JSONを参照。

### 直前のWonderSwan Wave RAM抽出

WonderSwanのWave RAM抽出をVGM AnalyzerのSample ExplorerとNode／CLIへ追加した。
16KiB RAMへの既知writeだけを追跡し、1波形16byte／32点・low nibble firstで保存する。
同一波形は重複排除し、CH・時刻・bank・物理アドレス・基本音程の観測履歴を保持する。
未write領域を0で補完せず、Voice PCM／Noise区間は波形抽出から除外。Sweepは書き込まれた基本波形だけを保存する。
Sample Explorerで波形表示・履歴選択・`ws.setWaveform()`コードコピー・JSON保存・1秒試聴・試聴WAV保存を対応。
試聴は既存の実WASM音源を使い、選択した観測の基本音程を固定して中央定位で鳴らす。
元の楽器名・発音長・曲中の音量／pan／Sweep推移を復元する機能ではない。Voice PCM captureは次段階。

関連全体試験940件中939成功＋既存1skip。その後の最終focused31件は全て成功（重複あり）。
コピーしたコードをPlaygroundの実Synth／WASMへ戻し、RAMのpacked bytesが元波形と一致した。
通常docsと最終flat ZIPのChromium／WebKitで抽出・表示・Copy・JSON・WAV・実PCM試聴・Stop／file切替を確認した。
最終ZIPの従来再生も両Browserで4CH mute・Noise／Sweep／Voice PCM・seek／Stopが成功。
測定出力はdownstreamで0にしており、実聴・実機精度・実Tauri WebView音声は未確認。
browserが読んだ通常186／flat184ファイルのhashを現行ソースと照合し、flat184件はZIP内容とも一致した。

最終ZIPは`release/hello_ymfm_wasm_wonderswan-waves-dev_itch_vgm_analyzer.zip`、SHA256
`b53c76ccac9893d491aec93e46fe8b4d51738f2c4602c6b45852f134e8117ba9`。
Analyzer Tauriへ398ファイルを取り込み、import照合・Python6／Node4件が成功した。
VGM npm配布物のbuild・隔離offline install・実行・CLI／JSON／WAV exportも成功。版は0.2.14のまま未公開。
固定SDK0.1.4・55 WASM出力・音源engine・従来再生core・Mixer値を変更していない。再校正guardも成功した。
この抽出作業の後、本体`28adb38f09569312aa6e35407cb4d9e7a15c93b3`／
Analyzer Tauri`591ec071e03d267af49bf27dde6f862b8924eff9`へユーザーがcommit済み。
SDK原本とPlayground Tauriはこの抽出ターンでは変更していない。記載の試験・ZIPは抽出段階のもの。
Voice PCM captureは別段階で、波形snapshotを元のPCMサンプルと誤認しない形で検討する。
詳細・hash・再現手順は[wonderswan_wave_samples_01.md](wonderswan_wave_samples_01.md)とJSONを参照。

### 直前のWonderSwan Analyzer再生接続

WonderSwanをVGM Analyzerと共通Node／CLI再生へ接続した。
VGM1.71 header0xC0・BC相対レジスター・C6 big-endian RAM・PCM stream0x21／0xA1を対応。
4CH Wave／Noise／Sweep／Voice PCM、4CH mute、通常seek再構築、Stop再演奏、Mixer unity1.0を確認した。
Live／Song Note-ishとMIDI／MusicXML／LilyPondは波形の基本音程のみ。Voice PCM／Sweep／Noiseの区間は音符にしない。
この接続段階ではHyper Voice／DMA・dual／variant・音色／サンプル抽出は対象外とし、対応外レジスターは明示エラーにした。
Wave RAM抽出は上記の後続作業で追加済み。
他chipとのmixedは従来どおりchipごとのMixer／mute／WAVを対応し、混合音符解析は無効にする。
cacheは`wonderswan-vgm-1`。固定SDK0.1.4と55 WASM出力、既存Mixer数値は変更していない。

実Workletと24構成・72,864ステレオframesでPCM完全一致。新parser／engine11件、共通再生／Editor9件成功。
Analyzer554成功＋既存1skip。Core／Web3,571件の試験では既存YM2608参照の未補正unityをSystem gain1.03357へ修正した。
HEAD／現行／補正済み参照はFM／SSG／ADPCM-B／rhythm4パターンでbyte一致、音源処理は変更していない。
修正後の全体試験3,569成功、既存Worker2件は負荷中の時間切れ。該当2fileの単独再試験59件はすべて成功、deadlineは変更しない。
全28 WASM／55出力の回帰40,360比較は差0・入力snapshot不変。過去に実再buildしたSDK成果物を再利用した。
Analyzer音量の18＋12captureを再測定し、全測定数値／既定gainが旧記録と一致。guardを維持してsource hashのみ更新。
FM npm配布物のbuild／install／runtime／型と、VGM tarballの隔離offline install・4音源mode／mute／CLI／楽譜出力が成功した。
公開版番号は変更せず、npm公開・commit／pushは行っていない。

通常docs／最終flat ZIPのChromium・WebKitで実WASM＋実output WorkletのPCMを確認。
4CH muteは全てpeak0。RAM0x1200・音符表示・Noise／Sweep／Voice PCM・pause／resume／2秒seek／Stop再演奏が成功。
測定用downstream Workletで物理出力は0にしたため、実聴・実機精度・deadline・実Tauri WebView音声は未確認。
最終ZIPは`release/hello_ymfm_wasm_wonderswan-dev_itch_vgm_analyzer.zip`、SHA256
`d9e068525898ec91a54d65af850f547152785a18d29c0882f6a2d9ede3630c06`。
`w/tetorica-fm2612-vgm-analyzer-tauri`へ396fileを取り込み、Python6／Node4件・import照合成功。
この接続作業の後、本体`3dbee68137067c6b51d4efe9464ee811ad512f67`／
Analyzer Tauri`eb0344e106bb6277f9b95f413cbdaed1f35097a2`へユーザーがcommit済み。
Playground Tauri／SDK原本はこの接続ターンでは変更していない。旧記録の試験・ZIPは接続段階のもの。
詳細・hash・再現用scriptは[vgm_analyzer_wonderswan_01.md](vgm_analyzer_wonderswan_01.md)とJSONを参照。

### 直前のWonderSwan Native接続

WonderSwanのTauri Native Audio接続を実装し、ローカル検証と配布物の取り込みを完了した。
選択中`wonderswan` modeと独立した`createSoundChip('wonderswan')`、Main／Worker、4CH Keyboard、
波形／pan／Noise／SweepのInspectorを接続。Web Audioが既定のまま、Nativeの対応modeにWonderSwanを追加した。
固定SDK0.1.4のrawコアを一度だけビルドし、アプリ側の新adapterでBrowserと同じspeaker補正・初回fetch境界・clock変換を行う。
共有0x90のmask merge、実アドレスによるRAM保護、manual lease、clock予約とcancel、Stop／reset／retirementを検証した。
Stopは主音源のRAM・音色・clockを保持。定期観測で16KiB RAMを毎callbackコピーしない。

実Worklet対Nativeは204ケース・995,328ステレオフレーム、raw WASM比較9ケース・73,728フレームで差0。
C++377,424チェックとASan／UBSan成功。2,048 hot blockでC++ new／delete 0。
新Rust15件・全体741成功＋4ignored、Native23mode・631,488frames・92 Run／Stopが成功。
追加音源は4混合／8単独／16台制限／17台目拒否／予約rollback／Stop予算0が成功した。
JS関連1,276件・page＋focused1,106件（重複あり）、新機能10件・creation lifecycle12件、mode型／npm配布物も成功。
全28 WASM／55出力の最終回帰40,360比較は差0・入力snapshot不変。以前実再buildしたSDK0.1.4成果物を再利用した。
固定SDKは本体／Tauri各395ファイルのまま、音声55出力とMixerソース3ファイルもHEADとbyte一致。

最終flat ZIPのChromium／WebKitでNative UIと実Web Audioを別々に確認した。
Native UIはRPCモックによる接続試験でAudioContext／Workletを作成せず、音声計算自体は上記C++／Rust試験で別途検証した。
ZIPは`release/hello_ymfm_wasm_wonderswan-native-dev_itch_playground.zip`、SHA256
`b74be494e9da737f09b62aa8a417ac7b4c74ecadbfaf28042f069a7368b077f1`。
Tauriへ920ファイルを取り込み、Python22／Node31件・frontend照合・Native22固定記録も成功。
新adapter・SDK原典・BSDライセンスを含む対応sourceZIPは1,861ファイル、SHA256
`c9dafaca455a09a743065a3ebe9ecb7a4dc4c8eeccd3415ef530cfbcc247530f`で照合済み。

この記録直後に本体`637da3fa...`／Playground Tauri`9836c13...`へユーザーがcommit済み。SDK原本／公開tag・npm版は変更していない。
Native接続の5構成CIと実アプリの実聴が後続作業。このAnalyzer対応のターンではNative CIを新たに実行していない。
今回の実装はローカルmacOS ARM64の検証で、物理音声・実時間deadline・聴感ノイズ・新コードの他OS動作は未確認。
実装と再現手順・hashは[native_wonderswan_01.md](native_wonderswan_01.md)とJSONを参照。

### 直前のSDK取り込みCI（今回のNative接続前）

固定SDK0.1.4の取り込みは本体`a72c44cf5569ad8f9a628ee380987fe3d5a735ef`／
Tauri`d3885716a152994b7c483ab4675a5a9e3e6aa37f`へユーザーcommit／push済み。
本体の全28 WASM CI run `40391153310`と、Tauriの全5構成run `40391737139`はsuccess。
両28／55 receipt・170入力・全40,360比較と、全5構成の検証artifact計15 JSONを取得して照合した。
Windows／Linux x86_64・ARM64／macOS Intel・ARM64で検証とinstaller生成が成功。installerの起動／実聴は未実施。
当時のfrontendは918ファイル、対応sourceZIPは1,851ファイル。これらのCIは今回のWonderSwan Native接続を含まない。
SDK取り込みの詳細は[sdk_014_adoption_01.md](sdk_014_adoption_01.md)とJSONを参照。

### 直前のSDK公開とPlayground接続

WonderSwanをSDK原本へ集約し、`w/tetorica-soundchip-native`の0.1.4を準備した。
原本6ファイル・WASM wrapperは本体とbyte一致。Native raw C++公開API `tetorica::wonderswan`、fixture・WAV例・28番目のWASM recipeを追加。
23 IDs／28 recipes／20 libraries、Python67件・ソースZIPからのNative25 CTest／19 WAVが成功。
WonderSwanの配布／独立再build WASM各52,228frames、既存YM2612の配布／独立再build smoke、最終archive監査も成功。
ユーザーがSDK `6f8b872b6f35f5df619b2468d58da57037c96e07`へcommit／pushし、`v0.1.4`タグもpush済み。
タグCI run `40384846634`はNative5＋WASM2の全7構成と自動公開が`completed / success`。
正式[GitHub Release v0.1.4](https://github.com/kyorohiro/tetorica-soundchip-native/releases/tag/v0.1.4)のソースZIPと`SHA256SUMS`を取得し、hash一致・独立archive監査・JS10項目を確認した。
最終ソースZIPは395ファイル、SHA256 `f173092241badd27c84d6846a69bd175375f080a57fdaf4983c56751c201f65e`。
SDK公開を確認した時点では本体／Tauriの固定SDK0.1.2を維持した。その後、上記の0.1.4取り込みと全receipt再生成・WASM検証拡張を完了した。
SDK公開までの詳細は[wonderswan_sdk_014_01.md](wonderswan_sdk_014_01.md)とJSON。

WonderSwan commit `92b1ba87...`のWASM SDK CI #10が、独立WonderSwanの2出力を余剰と判定して前段3件で失敗した。
参照元のみ独立receiptによる出力照合を許可し、SDK27種類／53出力の厳密検証を維持した。
比較4scriptの既知cache番号にも`wonderswan-mode-2`を追加した。音源／WASM／Mixerは変更しない。
前段93件成功、全27新規ビルド成功、39,982比較で差0、53出力byte一致。
ユーザーが本体`23f13282...`へcommit／pushし、CI run `40379809938`の`completed / success`を確認した。
詳細は[wonderswan_wasm_ci_01.md](wonderswan_wasm_ci_01.md)とJSON。CI修正の元記録は修正直後の状態を保持する。

WonderSwanをPlaygroundへ接続した。Mode `wonderswan`、主音源`ws`、追加生成、4CH Keyboard、波形描画／音程／左右音量／Noise／Sweepのタブ、
初期コード・3 Example・型／補完・Main／Workerを用意した。BrowserとTauriのWeb Audio対応であり、Tauri Native backendは次段階。
共有gateレジスターのmask merge、手動試聴と演奏の所有・clock予約、Stop／state handoff／processor異常からの再起動を確認した。
rawコアは維持し、スピーカー出力側にDC補正を置く。Mixerは未校正を明記したunity 1.0で、既存の校正値は変更しない。
初回波形出力前の補正による余分なパルスも修正した。初期コード先頭の最大段差は0.294189→0.0390625、raw PCM差0。
複数loopの`allNotesOff()`とMain追加音源の所有・終了済みcallerも修正。関連437件、全Mode型、npm配布物の生成・インストール・実行・型が成功。
通常docs／最終flat ZIPのChromium・WebKit、Tauri Python22／Node31件・frontend918ファイル・Native固定22記録／SDK381ファイル・対応ソースを照合した。
ZIPは`release/hello_ymfm_wasm_wonderswan-dev_itch_playground.zip`、SHA256 `1bb95a493cbb645a05e9670199cceaaeff1f7d380d9a608e30771cd579000905`。
詳細と最終成果物は[playground_wonderswan_mode_01.md](playground_wonderswan_mode_01.md)とJSONを参照。
固定SDK 0.1.2と既存27 artifactは維持。次はSDK原本への集約・新版の固定取り込み・Tauri Native backend接続。
Playground側は本体`92b1ba87...`・Tauri`6e9c2b8...`へユーザーcommit済み。SDK0.1.4も上記のタグCI経由で公開済み。

### 直前の作業記録

WonderSwanの最初の段階として、MAME BSD-3-Clause音源を単体C++へ切り出し、同じ原本からWASMを生成した。
4CH波形・Noise・Sweep・Voice PCM・16KiB RAM・同期read/write/PCM APIを用意。
Native/WASM126構成・3,096,576ステレオフレームでPCM／全レジスター／RAM一致。24項目の別期待値も成功。
C ABI境界／allocation selftest1,091 checks、ASan＋UBSan、Chromium／WebKitのWindow・DedicatedWorkerも成功。
これは単体Nativeコアの検証で、Playground Mode／Tauri Native backendの接続は次段階。
raw出力はMAME準拠のunipolar PCMなので、接続時のDC方針を検証する。
固定SDK0.1.2と既存27種WASM inventory・Mixerは変更しない。npm／SDK公開・commitはしていない。
次は高級API・Worklet・Mode／Keyboard／Inspector、SDK集約を順に進める。
詳細は[wonderswan_core_01.md](wonderswan_core_01.md)、Native/WASM・BrowserのJSONを参照。

Atari ST初期コードの発音／消音時のプチ音について、normalized DACの固定バイアスとhard muteの段差を実WASMで再現した。
新YM2149 speaker profileだけ、その基準値をクロック変換前に補正する。raw PCM／既存AY／Native／Mixer値／index.jsは維持。
44.1／48kHzの初期コード3周で最大段差0.125→0.0353794（約72%減）、定常AC・レジスター・分割PCM一致。
修正前Browserで失敗する段差の回帰試験を追加。通常docs／最終flat ZIPのChromium・WebKitが成功、関連122件と重複あり70件も成功。
cacheは`atari-st-mode-2`。Tauriへ901ファイルを取り込み済み。ZIP SHA256は`092733c6756ecba7f00af3d71d5b6b75933b6e9f366e7a77c53394b8fa46f21f`。
聴感上の最終確認はユーザー側。変更は未commit／未公開。[作業記録](playground_atari_st_click_01.md)とJSONを参照。

Playgroundに`Atari ST` mode（`atari-st`）を追加した。YM2149 type16／flags1／2MHz、
`ay`の3CH・共有noise／envelopeを使う。初期コード・3 Example・型／補完・YM2149タブ・Keyboardを接続した。
BrowserとTauriのWeb Audio対応。固定Native AY adapterはAY-3-8910専用なので、Native一覧には追加しない。
244件と292件の関連Node試験、全mode型検証、通常docs／最終flat ZIPのChromium・WebKitが成功。
Main／Worker A4は440.13–440.15Hz、左右PCM一致、Stop／再Run・編集・全Exampleを確認した。
Tauriへ901ファイルを取り込み、Python22／Node31件、frontend・固定SDK・対応source bundleの照合も成功。
本体／TauriのSDK0.1.2・各381ファイルは維持。今回のコード変更は未commit、公開・タグ作成はしていない。
詳細は[Atari ST mode](playground_atari_st_mode_01.md)。生成ZIPは`release/hello_ymfm_wasm_atari-st-dev_itch_playground.zip`。

SDK原本へ、versionタグのpushでGitHub Releaseを自動生成する処理を追加した。
Native5構成とYM2612 WASMが成功した後、source ZIPとsource専用SHA256SUMSを生成・添付して公開する。
gh/npmやローカルZIP作成は不要。導入版は`0.1.3`とし、本体／Tauriが固定した`0.1.2`は変更しない。
SDK側の`.github/workflows/verify-sdk.yml`、`scripts/publish_release.py`、`docs/releases.md`を参照。
公開処理はタグ／version／remote commit／添付bytesを照合し、draftの再開にも対応する。
Python67試験（公開プロトコル16件を含む）、YAML読込、生成ZIPの独立ビルド19 library／CTest24件／WAV18本／JS10項目が成功。
その後ユーザーがSDK `303f0450ed3c2fc286fecb29f6d51768d3efd0f6`（`checksum`）へcommit／pushし、`v0.1.3`タグもpush済み。
確認時のタグCIはrun `40305965753`で進行中だった。Atari STの作業では、そのCIの最終結果やRelease公開を再確認していない。

SDK `0.1.2`を準備し、本体とTauriへ同じ正式sourceZIPを取り込んだ。各381ファイル。
SDK sourcecommitは`53b33a15f5c4b919b185cb912016eccfbbb6d3a6`、ZIP SHA256は
`752d0f449fd69300881f7c369f190932154e96ab8fd103676917087a454b8c72`。
Sega PSGの分離先`vendor/tetorica_sega_psg/`と専用BSD noticeが固定SDKにも反映された。
独立展開で19 library／CTest24件／WAV18本／JS10項目成功。WASM27件を実再buildし53出力は旧版とbyte一致、
新receiptの全入力hash検証後にcentral build-infoを更新し、39,982比較が成功した。音声bytes・Mixer値は維持。
Tauriは`fe391fb...`へcommit／push済み。Cargo726成功＋4ignored、22mode、追加混合／制限／Stop予算0とsourceZIP照合が成功。
SDKのCI `40297659488`（Native5構成＋WASM）、Tauriの`40297874215`（全5構成の検証／installer）、
本体の`40298606800`（全27 WASM）がすべてcompleted／successで完了した。
対象はSDK `53b33a15...`、Tauri `fe391fb543280a8a3cc2f11c319268c3d538d24e`、
本体 `38d520955bdc853e33dd8fef49687c0b090c9cd7`。run／job API結果を保存し対象HEADを照合した。
CI artifact内容の独立再照合・installer起動／聴音は行っていない。後続はCI結果の文書追記のみで音源コード変更はない。
詳細は[sdk_012_adoption_01.md](sdk_012_adoption_01.md)。SDKのタグ／GitHub Releaseやnpm公開は行っていない。

SPC初期化中closeのWebKit問題を修正した。`close()`直後はclosedでも、その後runningへ戻る動きを
旧runtimeの20反復中19回確認。owned AudioContextにだけstatechangeで再closeする処理を追加した。
共有context・音声生成・WASM・Mixer値は維持し、pollingやasset完了待ちは追加していない。
修正版は同じ診断20反復成功、Chromium／WebKitの再生4件＋初期化close40件、関連Node128件とFM npm検証が成功。
詳細は[spc_webkit_close_01.md](spc_webkit_close_01.md)。旧SPC移行記録の失敗証跡は保持し、この後続修正で解決した。
本体`f0b78629...`の全27 WASM CI run `40286728456`は81試験・53出力・39,982比較が成功。
SDK `0e9379bf...`のrun `40286698097`もNative5構成・WASM全6job成功。これらのCIは今回のSPC修正前のcommitが対象。
SPC修正は本体`2c0b40e0...`へ、Tauriのcollector3本は`44e2a591...`へユーザーがcommit済み。

Sega PSGの原本分離を実施した。本体は`third_party/tetorica_sega_psg/`、SDK原本は
`vendor/tetorica_sega_psg/`へ移し、BSD-3-Clause・kyorohiroの著作権表示とSMS Powerの資料参照を追加した。
確認した履歴・公式MAMEソースの範囲では、MAME特有のコード／コメントのコピーは見つからなかった。
分離当初のユーザー選択では固定SDK 0.1.1の各379ファイルを保持した。その後、上記0.1.2への明示的な更新を実施した。
新SDK原本の実WASM build・7,074比較は差0、Native fixture・109固定SDK試験・npm配布物検証・3種itch ZIPも成功。
旧本体パスは互換includeで残し、Tauriの将来用collectorと配布用source／notice収録先を修正した。
詳細と再開用記録は[segapsg_provenance_layout_01.md](segapsg_provenance_layout_01.md)を参照。

現在は代替Nuked YM2612のSDK移行・ローカル検証・5構成CIまで完了した。SDK `0.1.1`の単体ターゲットを追加し、
TauriのGenesis Nuked／32X Nukedと独立追加Nukedのビルド入力を固定SDKへ切り替えた。最終同梱数は379ファイル。
今回着手時の本体`f22249959...`、Tauri`baec0b9a...`、SDK`affd1059...`はすべてclean。
直前の成功CI run `40171879716`は今回のNuked移行を含まない。
作業内容・最終pinと検証結果は[native_sdk_nuked_adoption_01.md](native_sdk_nuked_adoption_01.md)を参照する。
対応ソースZIP全1,801ファイルとSDK379ファイルを含む22件の固定記録は照合済み。
本体`02b2e3ad...`とTauri`367fd7a...`へcommit／pushし、Nuked移行を含む
[Tauri CI run 40175615215](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40175615215)は全5構成の検証・インストーラー生成が成功した。
対象は`367fd7a851ffadd3a01c3cfb985972112156ca63`、attempt 1。SDKの修正版CI run `40175263453`もNative 5構成＋WASMの全6ジョブ成功。
通常22音源IDと代替NukedのSDK参照が揃った。機種用補助処理・Rustの所有／予約・Mixer／FXはアプリ側に残る。
本体の通常YM2612 WASMビルドも、その後同じ固定SDKソースへの切り替えを完了した。
同梱379ファイルをoffline検証し、SDKのWASM用レシピで既存APIを維持して生成する。
実施内容と検証は[YM2612 WASMのSDK移行](wasm_sdk_ym2612_adoption_01.md)を参照する。
続いてYM2203 WASMも同じ固定SDKへ切り替えた。
旧レシピ再ビルド／配布済みWASMとの比較各432ケースで差0、Browser・npmも検証済み。
詳細は[YM2203 WASMのSDK移行](wasm_sdk_ym2203_adoption_01.md)を参照。
続くYM2608 WASMも同じ固定SDKへ切り替えた。旧再ビルド／配布済みWASMとの各586比較で差0。
リズム・ADPCM・RAM転送／状態復元、Browser／npmも検証済み。校正04の全数値は旧03と一致した。
今回の詳細は[YM2608 WASMのSDK移行](wasm_sdk_ym2608_adoption_01.md)。
続くYM2610／YM2610Bの共有WASMも同じ固定SDKへ切り替えた。
通常OPN系5種類／4 artifactのWASMビルドが同梱SDKを使う。Mixer値・公開APIは維持する。
詳細は[YM2610／YM2610B WASMのSDK移行](wasm_sdk_ym2610b_adoption_01.md)を参照。
続くYM2151／YM2164の共有WASMも同じ固定SDKへ切り替えた。
既存8CH・LFO／noise・timer／状態APIとMixer値を維持する。
詳細は[YM2151／YM2164 WASMのSDK移行](wasm_sdk_ym2151_adoption_01.md)を参照。
続くOKIM6258 WASMも同じ固定SDKへ切り替えた。旧配布版・再ビルド・SDKのJS／WASMがbyte一致。
X68000のFM・ADPCM双方のビルド元が揃った。詳細は[OKIM6258 WASMのSDK移行](wasm_sdk_okim6258_adoption_01.md)を参照。
続くYM2413 WASMも同じ固定SDKへ切り替えた。既存snapshot APIはないため、reset／再演奏／seekで復帰経路を比較した。
詳細は[YM2413 WASMのSDK移行](wasm_sdk_ym2413_adoption_01.md)を参照。
続くYM3526 WASMも同じ固定SDKへ切り替えた。9CHの2OP FM・リズム・timer／IRQ／CSMとreset／再演奏／seekを比較した。
詳細は[YM3526 WASMのSDK移行](wasm_sdk_ym3526_adoption_01.md)を参照。
続くYM3812 WASMも同じ固定SDKへ切り替えた。OPL2の4波形・gate、9CH FM・リズム・timer／IRQ／CSMと再演奏／seekを比較した。
詳細は[YM3812 WASMのSDK移行](wasm_sdk_ym3812_adoption_01.md)を参照。
続くYMF262 WASMも同じ固定SDKへ切り替えた。18CH・4OP・8波形・4bus合算とreset／再演奏／seekを比較した。
詳細は[YMF262 WASMのSDK移行](wasm_sdk_ymf262_adoption_01.md)を参照。
続くY8950 WASMも同じ固定SDKへ切り替えた。FM・リズム・ADPCM、2MiB RAMとJSミラーのreset差、VGMサンプルブロックのseekを比較した。
詳細は[Y8950 WASMのSDK移行](wasm_sdk_y8950_adoption_01.md)を参照。
続くAY-3-8910／YM2149 WASMも同じ固定SDKへ切り替えた。tone・noise・envelopeと全対応type／flag、register読出し、reset／再演奏／seekを比較した。
JS／WASMは配布済み版・旧手順再ビルド・SDK版・通常出力がすべてbyte一致した。
詳細は[AY-3-8910／YM2149 WASMのSDK移行](wasm_sdk_ay8910_adoption_01.md)を参照。
続くSega PSG WASMも同じ固定SDKへ切り替えた。Genesis系・Game Gear・Master System・追加PSGで共有するartifactのビルド元を統一した。
3 tone／noise・Game Gear stereo、状態保存／復元とowned／borrowed PCMを比較し、生成物は旧版とbyte一致した。
詳細は[Sega PSG WASMのSDK移行](wasm_sdk_segapsg_adoption_01.md)を参照。
続くRF5C164 WASMも同じ固定SDKへ切り替えた。Mega CDと追加PCMのビルド元を統一した。
8 voice、64 KiB RAM・bank OR、bus読出しと状態復元を比較し、生成JS／WASMは旧版とbyte一致した。
詳細は[RF5C164 WASMのSDK移行](wasm_sdk_rf5c164_adoption_01.md)を参照。
続く32X PWM WASMも同じ固定SDKへ切り替えた。FIFO／timer・DAC／duty・状態復元とborrowed PCMを比較した。
配布用PWM sourceも固定SDKのstandalone recipeへ揃え、source単体で再buildした生成物の一致を確認した。
詳細は[32X PWM WASMのSDK移行](wasm_sdk_pwm32x_adoption_01.md)を参照。
続くHuC6280 WASMも同じ固定SDKへ切り替えた。PC Engineと追加音源のビルド元を統一した。
既存の6CH・wave RAM・DDA・noise・LFOとowned PCMを維持し、snapshot APIは追加していない。
詳細は[HuC6280 WASMのSDK移行](wasm_sdk_huc6280_adoption_01.md)を参照。
続くGame Boy APU WASMも同じ固定SDKへ切り替えた。2 pulse・wave・noiseと既存保存状態APIを維持した。
直接Web用に残っていた保存状態exportのない旧生成物も、別のPCM比較後にSDK版へ揃えた。
詳細は[Game Boy APU WASMのSDK移行](wasm_sdk_gameboy_adoption_01.md)を参照。
続くNES APU／FDS WASMも固定SDKへ切り替えた。31項目の観測ABIとowned／borrowed PCMを維持し、保存状態APIは追加していない。
配布ソースもSDKの検証済み入力とstandalone recipeから作り、単体再buildを確認した。
詳細は[NES APU／FDS WASMのSDK移行](wasm_sdk_nesapu_adoption_01.md)を参照。
続くSNES／SPC WASMも固定SDKへ切り替えた。32 kHzのSPC700／accurate S-DSPと33 C exportを維持した。
旧再ビルド・配布済み・配布ソース単体の各80ケースでSDKとの差0。パスを埋め込むassertionによりWASMのbytesは異なる。
対応ソース単体の再build、FM／VGM npm・Analyzer ZIPも検証した。WebKitの初期化中close試験は未解決として分けて記録した。
詳細は[SNES／SPC WASMのSDK移行](wasm_sdk_spc_adoption_01.md)を参照。
続くSega PCM WASMも固定SDKへ切り替えた。配布済み・旧再ビルド・SDK・docs／webの生成物はbyte一致した。
旧再ビルド／配布済みとの各612比較でPCM・ROMを含むnative stateの差0。Analyzer両browserとnpm／ZIPも確認した。
既存CLI WAV比較の参照側に抜けていた校正Mixerは、旧版で失敗を再現して試験だけ修正した。
詳細は[Sega PCM WASMのSDK移行](wasm_sdk_segapcm_adoption_01.md)を参照。
続くK051649（SCC）WASMも固定SDKへ切り替えた。配布済み・旧再ビルド・SDK・docs／webの生成物はbyte一致した。
各774比較でPCM・続行probe差0。保存状態APIは追加せず、SCC／SCC+・reset／再演奏とMSX混合／seekを確認した。
詳細は[K051649 WASMのSDK移行](wasm_sdk_k051649_adoption_01.md)を参照。
続くYM3438 WASMも固定SDKへ切り替えた。旧再ビルド／配布済み版との各450比較でPCM・read／status／IRQ差0。
今回は生成WASMのhashが異なるため、SDKソースの配置だけを旧構成へ戻す再ビルドで差を切り分けた。
詳細は[YM3438 WASMのSDK移行](wasm_sdk_ym3438_adoption_01.md)を参照。
続くYMF276 WASMも固定SDKへ切り替えた。旧再ビルド／配布済み版との各462比較でPCM・read／status／IRQ差0。
固有の14-bit FM／DAC shiftと既存direct Synthを維持し、DACの正の対照2,048通りも確認した。
詳細は[YMF276 WASMのSDK移行](wasm_sdk_ymf276_adoption_01.md)を参照。
続くYMF288 WASMも固定SDKへ切り替えた。旧再ビルド／配布済み版との各606比較でPCM・read／status／IRQ差0。
既存のFM 6CH／SSG・再構築reset・500 kHz native出力を維持した。
詳細は[YMF288 WASMのSDK移行](wasm_sdk_ymf288_adoption_01.md)を参照。
続くYMF278B WASMも固定SDKへ切り替えた。FM 18CH／PCM 24CH、4 MiBメモリーと既存Analyzer／VGM経路を維持した。
各684比較で差0。Analyzer再測定18行は旧値・PCM hashと完全一致し、実測03記録へ更新した。
詳細は[YMF278B WASMのSDK移行](wasm_sdk_ymf278b_adoption_01.md)を参照。
続くNuked OPN2 WASMも固定SDKへ切り替えた。旧版／SDK／対応ソース単独buildの生成JS／WASMがbyte一致し、各462比較で差0。
配布ソースをSDK由来のstandalone recipeへ揃え、coreのLGPLとwrapper／recipeのBSD表記を保持した。
詳細は[Nuked OPN2 WASMのSDK移行](wasm_sdk_nuked_opn2_adoption_01.md)を参照。
最後のDX7／MSFA WASMも固定SDKへ切り替えた。全27 artifact（26 JS／WASM pair＋DX7 standalone）の参照元が揃った。
旧配布・旧再build・SDK・中央／Web／docs出力がbyte一致し、各360比較で差0。既存JS／型・Mixer値は維持した。
詳細は[DX7／MSFA WASMのSDK移行](wasm_sdk_dx7_adoption_01.md)を参照。WASM移行の残りはない。
その後、DX7初期コードのMixer `0.5`上書きと、小音量の初期音色を調整した。
Mixer指定を初期コード・基本Exampleから除き、ユーザーの選択に従って初期音色の単一キャリアをOP99／EG99へ揃えた。
System倍率と既存保存データは保持する。詳細は[DX7初期コードとMixer](dx7_starter_mixer_01.md)。
続いて全27 WASMビルドの一括検証を追加した。`npm run test:wasm:sdk`で、一時領域へ全生成・receipt必須照合・既存PCM／API比較を行う。
実build27件・53出力・39,982比較が成功し、生成物は配布版とbyte一致。別checkout・npm installなしのarchiveでも再比較が成功した。
同じコマンドを使うCI設定を追加した。詳細は[全27 WASMの一括検証](wasm_sdk_batch_validation_01.md)。
既存の音量調整では、Game BoyのMixer初期値をユーザー指定の`0.36`へ調整した。
Playground Systemの主音源／追加音源とAnalyzer、npm向けcalibrated presetへ適用し、元の測定値は保持した。
内容と検証は[gameboy_mixer_balance_01.md](gameboy_mixer_balance_01.md)を参照。
その後、未反映だったPSG・AY・NES・PC Engineの初期値も揃えた。
Mixerは調整値そのものを表示し、Genesisの既存倍率は接続側で相殺するsource単位へ整理した。
旧保存設定の読込み時換算と検証は[psg_mixer_balance_02.md](psg_mixer_balance_02.md)を参照。
続く指示で`tetorica-fm2612@0.2.28`をnpmへ公開し、latest・integrity・公開tarballの全byte一致を確認した。
[npm公開記録](npm_mixer_source_units_release_01.md)を参照。Tauriの同梱frontendとExamplesの更新は未実施。
さらにCLIのWAV描画へ同じ調整を入れた`tetorica-vgm@0.2.14`も公開済み。
11種類のWAV一致、latest・integrity・公開tarballの全byte一致を確認した。[VGM公開記録](npm_vgm_mixer_release_02.md)を参照。
その後、itch.io Analyzerの校正ソースhash検証が旧記録で停止する問題を修正した。
Extra／PSGを実際に再測定した`_02`記録へ切り替え、音量定数を変えずにZIP作成と両ブラウザー検証を完了。
手順と生成物は[校正記録の更新](analyzer_mixer_calibration_refresh_01.md)を参照。
その後、Synthで内蔵音色のOP配列を1つずらして読み、OP4へ以前の設定が残るバグを修正した。
`1OP Basic`のTLは`[127, 127, 127, 2]`へ戻る。記録は[SynthのOP対応修正](synth_preset_operator_mapping_01.md)を参照。
Synth修正はユーザーがrelease済み。その後、通常YM2612 WASMのSDK参照を実装し、
旧ビルド・配布済みWASMとの比較各444ケースでPCM・内部envelope・read/status/IRQ・状態bytes差0。
Analyzerの影響する校正は03として実測し直し、校正値・Mixerの数値は維持した。

`tetorica-soundchip-native`で全22種類のPlayground音源IDの単体Nativeターゲットが揃い、
最初の利用側としてPlayground TauriのYM2612を固定SDKソースへ切り替えた。
ユーザーがcommit／pushした`v0.90.2+test`で、5構成すべての試験とインストーラービルドが成功済み。
その後、PC-98と追加生成のYM2203も切り替え、ローカル検証後にユーザーが`16610b0e...`としてコミット済み。
YM2608移行もローカル検証後、Tauriでは`53ab3d27...`、本体では`26f6e6e5...`にコミット済み。
Neo Geoと追加生成のYM2610／YM2610BもSDK参照へ切り替え、PCM／状態一致、Rust全試験、再生・混合試験まで成功。
その後ユーザーがTauriの移行を`5280f83a...`としてcommit／pushし、本体のcheckerと記録も`562fcbcf...`にコミット済み。
CI確認を開始する前は、本体・SDK・Tauriの3リポジトリともcleanだった。SDK本体と取り込み記録の変更はない。
ユーザーの指示で、全OPN移行を含むTauriのmainを5構成のActionsへ手動実行した。
全5構成のNative検証とインストーラービルドが成功し、run全体も`completed`／`success`。
このCI確認では音源・ビルドコードを修正せず、本体の記録とTauriのSDK取り込みガイドだけを更新している。
そのCI結果をTauriの`6f4d4db0...`、本体の`ce4dc4de...`へユーザーがコミット済み。
YM2151移行の着手前は両作業ツリーがcleanで、TauriのCI対象`5280f83a...`からの差分はガイド1ファイルのみだった。
その後、X68000のFMと追加生成YM2151のSDK参照も切り替えた。
同梱版を変えず、OPM providerと独立YM2151の接続をSDKからビルドする。
このYM2151作業はTauriの`e4d68b27...`、本体の`f0e00dda...`へユーザーがコミット済み。
X68000と追加生成OKIM6258のデコーダー、および追加生成OKI接続もSDK参照へ切り替えた。
SDK原本は保持し、ビルド時の生成で従来と同じスレッド安全なテーブル初期化を適用する。
X68000の機種用接続・サンプル管理・混合はアプリ側に保持する。
このOKIM6258作業もTauriの`250489fd...`、本体の`fed03f7a...`へユーザーがコミット済み。
追加生成YM2413と共有OPL provider／PCM依存のSDK参照も切り替えた。
Master System／MSXの機種用接続・NativeOpllCore、PSG／AY、DOS PC／Y8950の接続はアプリ側に保持する。
このYM2413作業はTauriの`634e56f4...`、本体の`6c0b5770...`へユーザーがコミット済み。
その後、同コミットを対象とする5構成のActions確認を行った。
GitHub上のmainとローカルHEADの一致、両作業ツリーがcleanであることを確認してから、
ユーザーの指示で[Build Desktop — run 40137093552](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40137093552)をmainへ手動実行した。全5構成の試験とインストーラービルドが成功し、run全体も`completed`／`success`。
今回のCI確認では、音源やビルドコードを変更せず、本体の記録とTauriの取り込みガイドだけを更新している。
TauriのCI結果ガイド更新はユーザーが`a8edd891...`にコミット済みで、CI対象との差はガイド1ファイルのみだった。
DOS PC／MSX Audioと追加生成のOPL系4音源の接続も固定SDKへ切り替えた。
共有providerは変更せず、選択中／追加生成cppとY8950メモリーhelperの参照先をSDKへ移した。
Y8950の最大2 MiBの可変RAMページの所有・COW・予算・回収、RF5C164の接続とホスト処理はアプリ側に保持する。
このOPL作業と前回CIの記録は、本体の`4137e903...`、Tauriの`4451195...`へユーザーがコミット済み。
AY-3-8910の共有コアと追加生成用接続も固定SDKへ参照を切り替えた。
選択中MSX／MSX Audioの機種用接続とAYレート変換、Rustの予約・owner・混合は保持する。
AY着手時は本体・Tauri・SDKともcleanだった。その後ユーザーが本体を`ce2ad308...`、Tauriを`276e744e...`としてcommit／pushした。
両作業ツリーがcleanであることを確認し、ユーザーの指示でOPL接続移行と今回のAY差分を含む
[Build Desktop — run 40142510765](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40142510765)を`main`へ手動実行した。
CIは`completed`／`failure`で終了し、macOS ARM64・Windows・Linux 2構成の4ジョブ成功、macOS x86_64の1ジョブ失敗。
試験だけのローカル修正後はRust全試験が723成功、対象試験の反復も50／50成功した。
その後ユーザーが本体`a278e1d5...`とTauri`842245dd...`をcommit／pushした。
両作業ツリーがcleanでremote mainと一致することを確認し、修正を含む別の5構成CI
[Build Desktop — run 40143851548](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40143851548)を`main`へ手動実行した。
修正版CIは`completed`／`success`で終了し、macOS x86_64を含む全5構成の検証とインストーラービルドが成功した。
全5構成の検証JSONと取得ZIPのdigest照合も成功し、計10アーティファクトの存在を確認した。
先行するrun `40137093552`の成功と、後続のOPL接続／AY移行のローカル検証・今回のCI結果は区別する。
修正版CIの結果は本体で`29b9b885...`にコミット済み。Tauriガイドの同結果はステージ済みだった。
Sega PSGの共通コアとraw C APIも固定SDKへ参照切り替えした。
Genesis／Mega CD／32X系、Game Gear／Master Systemと追加PSGが、同じSDKコアを一度だけコンパイルして使う。
機種用接続、NativePsgCore、GenesisのDC／gain／混合・Rustの制御は維持する。
このPSG作業は本体`1da2fb00...`、Tauri`51dca52...`へユーザーがコミット済み。
RF5C164の選択中／追加生成接続、共通decoderとraw C APIも固定SDKへ参照を切り替えた。
双方の64 KiB所有RAM、追加接続の声別保持出力、Rustの転送payload・予約・寿命・予算管理を維持する。
RF着手時は本体・Tauri・SDKともcleanだった。ローカル検証後、本体を`1d35f48a...`、
Tauriを`4939ddc7...`へcommit／pushし、両作業ツリーがcleanでremote mainと一致することを確認した。
ユーザーが承認したPSG／RF両移行の5構成CI
[Build Desktop — run 40148943609](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40148943609)を`main`へ手動実行した。
CIはattempt 1で`completed`／`success`となり、全5構成の検証とインストーラービルドが成功した。
全5構成の検証JSON・取得ZIPのdigestと、計10アーティファクトのrun／commit一致も確認した。
RFのCI結果記録は本体の作業記録2ファイルとTauriガイドだけで、コード変更やローカル試験の再実行はしていない。
Tauriガイドは`66004f00...`へcommit／push済み。更新後の対応ソースZIPも再生成・照合し、CI入力との差はガイド1ファイルだけだった。
32X PWMのNative接続cpp／headerと`pwm32x_core.h`も固定SDKへ参照を切り替えた。
既存のPWM archive、C++17・O2・`/EHsc`・`-ffp-contract=off`と、Rustの予約・owner・混合を維持する。
PWM着手時は本体`88049cad...`、Tauri`66004f00...`、SDKともcleanだった。ローカル検証後、本体`2b1b8cf1...`、Tauri`39a02786...`へ保存済み。その時点ではPWMを含む新しいCIは未実施だった。
固有Native命令列132件・911,616フレームで旧／SDKがbyte一致し、実WASMのblock分割比較282回・1,800,960フレームとJS参照の差も0だった。
`npm test`は31／31成功。sandbox内Cargoの2件のTCP bind制限を受け、製品を修正せず制限外で再実行し、723成功・0失敗・4件ignoredだった。
22 mode・88 Run／Stopと既存の3混合構成・7単独音源、受入れ／16台制限・Stop後の予算回収も成功した。直前run `40148943609`はPWM移行を含まない。
その後、PC Engineの選択中／独立追加HuC6280のNative接続とコアの固定SDK参照へ切り替えた。
接続cppはinclude2行だけが異なり、接続headerとコアcpp／headerはbyte一致。直接includeを維持し、同archive内の1翻訳単位だけでコンパイルする。
HuC6280着手時は本体`2b1b8cf1...`、Tauri`39a02786...`、SDKともcleanだった。Rustの予約・PCM・Stopと機種APIは維持する。
旧／SDKはbyte一致し、実WASM比較192回・1,556,352フレームの差は0だった。
選択中39入力が追加側51入力の部分集合のため、両suiteの延べ90入力を重複加算せず、固有Native入力は51件・438,912フレームとする。
既存fixtureとSDK既存の検証fixtureによる公開状態・Stop／reset・waveコピー・callback allocation／free 0も成功。
`npm test`は31／31、Rust全試験は723成功・0失敗・4件ignored。今回はMCPのTCP bindのため初めから制限外で実行し、sandbox内の失敗や製品修正はない。
再生ライフサイクル22 mode・604,032フレーム・88 Run／Stopと、3混合構成・7単独音源、受入れ／16台制限で17台目の拒否も成功。両制限試験でStop後の予約予算は0、両runnerはexit code 0・`deviceOpened: false`だった。
HuC6280のローカル検証終了後、ユーザーが本体`a8169ac2...`、Tauri`2125896b...`へcommit／pushした。
両作業ツリーがcleanでremote mainと一致することを確認し、PWM／HuC6280を含む5構成CI
[Build Desktop — run 40162092207](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40162092207)を`main`へ手動実行した。
attempt 1、対象は`2125896b7173c5c662c6eaf2f2b69b4a010f12b7`。runは`completed`／`success`で終了した。
全5構成のsources／Cargo／再生／混合とインストーラービルドが成功し、検証レポート5組のJSON・ZIP digest監査も成功した。
計10アーティファクトのrun／commit一致・有効期限内・非空と、全5ドラフトリリース添付stepのskippedも確認した。
このCI開始後にコード・試験を変更せず、本体の結果記録とTauriガイドだけを更新した。
その結果記録は本体`77d93c04...`、Tauri`0191864a...`に保存済み。
先行する成功CI `40148943609`はPWMもHuC6280も含まない。
その後、Game Boyの選択中／独立追加音源に共通のNative接続とMAME由来APUを固定SDK参照へ切り替えた。
接続cpp／headerとAPU cpp／headerの4入力はbyte一致。既存のarchive・コンパイル設定・リンク順序を維持し、Rustの予約・PCM・Stopや機種APIは変更しない。
Game Boy着手時は本体`77d93c04...`、Tauri`0191864a...`、SDKともcleanだった。
`npm test`は31／31、Rust全試験は723成功・0失敗・4件ignored。MCPのTCP bindのため初めから制限外で実行し、sandbox内の失敗や製品修正はない。
旧／SDKのstdoutはbyte一致し、実WASMの分割比較186回・1,714,080フレームの差は0。延べ90入力のうち36入力の重複を除き、固有Native入力は54件・488,208フレームだった。
公開60バイトABIやStop／reset・NR52／DMG波形RAM・clock・位相、render allocation／free 0の自己試験と、22 mode・604,032フレーム・88 Run／Stopも成功。
追加音源の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否が成功し、両制限試験でStop後の予約予算は0。再生／混合の両runnerはexit code 0・`deviceOpened: false`だった。
Game Boyのローカル検証終了時点ではcommit／pushと新しいCIは未実施だった。その後ユーザーが本体`62fc578e...`、Tauri`407a75b3...`へ保存済み。
その後、選択中NES＋FDSと独立追加NESの共通Native接続と、その中のAPU／FDS移植実装を固定SDK参照へ切り替えた。
接続cpp／headerはbyte一致し、既存の1翻訳単位・archive・flags・リンク順序を維持する。RustのDMC転送payload所有・予約・予算と回収、PCM・Stopや機種APIは変更しない。
NES着手時は本体`62fc578e...`、Tauri`407a75b3...`、SDKともcleanだった。
`npm test`は31／31、Rust全試験は723成功・0失敗・4件ignored。MCPのTCP bindのため初めから制限外で実行し、sandbox内の失敗や製品修正はない。
旧／SDKのstdoutはbyte一致し、実WASMの分割比較315回・3,064,320フレームとJS参照の差は0。選択中72入力の重複を除き、固有Native入力は81件・784,512フレームだった。
400バイトABI、64 KiB DMCコピー・reset後の全RAM読出し、IRQ・最終バイト保護・FDS・6声のmuteとrender allocation／free 0の自己試験も成功。
再生ライフサイクル22 mode・604,032フレーム・88 Run／Stopと、追加音源の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否も成功。両制限試験でStop後の予約予算は0、再生／混合の両runnerはexit code 0・`deviceOpened: false`だった。
NESのローカル検証終了後、ユーザーが本体`3349ac14...`、Tauri`a70e86d2...`へcommit／pushした。
本体・Tauriがcleanでremote mainと一致し、SDKの作業ツリーもcleanであることを確認し、Game Boy／NES＋FDSを含む5構成CI
[Build Desktop — run 40168462256](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40168462256)を`main`へ手動実行した。
attempt 1、対象は`a70e86d2061349a396de7e4816a5438fea5dcb4f`。runは`completed`／`success`で、全5構成の検証とインストーラービルドが成功した。CIのためのコード修正は不要だった。
全5構成の検証JSON・取得ZIPのdigestと、計10アーティファクトのrun／commit一致・有効期限内・非空を確認した。全5ジョブのドラフトリリース添付stepはskipped。
このCI開始後にコード・試験を変更せず、本体の結果記録3ファイルとTauriガイドだけを更新した。その記録もユーザーが本体`95bba16c...`、Tauri`853d87f9...`へコミット済み。
先行する成功CI `40162092207`はGame BoyもNES移行も含まない。今回のCIと、先行するローカルの旧／SDK・WASM比較結果は区別する。
新しいタグ、ドラフトリリース、一般公開は作成していない。

その後、選択中／独立追加DX7の共通Native接続とMSFAを固定SDK参照へ切り替えた。
着手時は本体`95bba16c...`、Tauri`853d87f9...`、SDKともcleanだった。
接続cpp／headerはbyte一致。24共有ファイルと6 Native overrideを`OUT_DIR/tetorica_sdk_dx7_msfa/`へコピーして組み立て、既存の14翻訳単位・archive・flags・リンク順序を維持する。
SDKのNative Panicは事前確保済み`Dx7Note`へ初期状態を値代入し、feedback履歴をallocation／freeなしで初期化する。
このPanic後の再発音は意図した差分のため、通常再生の旧／SDK一致と分けて検証する。Rustの音色所有・lease・16 slot制御・予約、PCM・Stop・Mixer／FXと機種APIは変更しない。
既存135入力・1,032,192 Nativeフレームは旧／SDKのstdoutがbyte一致。新しいPanic／再発音96入力はSDKと実WASMの差0で、旧版79入力の意図した再発音後の差と区別した。
合計231固有Native入力・1,818,624フレーム、実WASM273比較・2,297,856フレームの最大差0。Panic後の新規インスタンス一致96／96とrender／制御中allocation／free 0の自己試験も成功。
`npm test`のPython 22件・Node 31件、Rust全試験723成功・0失敗・4件ignored。MCPのTCP bindのため初めから制限外で実行し、sandbox内失敗や製品修正はない。
22 mode・604,032フレーム・88 Run／Stopと、3混合構成・7単独音源、受入れ／16台制限で17台目の拒否が成功。両制限試験でStop後の予約予算0、両runnerはexit code 0・`deviceOpened: false`。
直前の成功CI `40168462256`はDX7移行を含まない。DX7ローカル検証後、ユーザーが本体`24ab8cbd...`、Tauri`46920010...`へコミット済み。

最新の作業では、選択中／独立追加SNES S-DSPと独立追加SPC700ファイルプレーヤーの共通コア・接続を固定SDK参照へ切り替えた。
着手時は本体`24ab8cbd...`、Tauri`46920010...`、SDKともclean。2接続cpp／2 ABI headerとSNES-SPC 24ファイルの28組はbyte一致する。
既存の`tetorica_native_snes` archive内の6翻訳単位を維持し、共有`SPC_DSP.cpp`を一度だけコンパイルする。既存のflags・リンク順序も保持する。
SNESの所有RAM／借用timeline、SPCのコピーloadと元ファイル保持、control側の準備とcallbackへの公開・回収は既存のRust実装を使う。
旧34件のsnapshot pin・LGPLライセンス・由来、SDK374ファイル・版と取り込み記録は保持する。
旧／SDKのstdout／stderrはbyte一致。SNESの重複を除く75入力・761,856フレームと、SPCの84入力・688,128フレームで、実WASM比較519回・4,792,320フレームの最大差は0。
SNES／SPCの公開ABI・RAMコピー／timeline／load／seek／観測とallocation／free 0の自己試験、実Cargoの6 object・35 C ABIの各1回の定義も確認した。
`npm test`のPython 22件・Node 31件、Rust 723成功・0失敗・4件ignored。初めから制限外で実行し、sandbox内失敗はない。
22 mode・604,032フレーム・88 Run／Stopと3混合構成・7単独音源、受入れ／16台制限と17台目拒否も成功。両制限試験のStop後予約予算0、両runnerはexit code 0・`deviceOpened: false`。
ローカル検証・文書と対応ソースZIPの照合後、本体`8898a75f...`、Tauri`8b9e922a...`へcommit／pushした。
両作業ツリーがcleanでremote mainと一致し、SDKもcleanであることを確認し、DX7とまとめた5構成CI
[Build Desktop — run 40171879716](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40171879716)をmainへ手動実行した。
attempt 1、対象は`8b9e922ad6e9c1f8d33cf5719b05330b58311944`。runは`completed`／`success`で、全5構成の検証・インストーラービルドとアップロードが成功した。
検証レポート5組のJSON・取得ZIP digestを照合し、計10成果物の対象run／commit一致・有効期限内・非空を確認。全5ドラフトリリース添付stepはskipped。
CI開始後は結果記録だけを更新し、製品・試験入力は変更していない。直前run `40168462256`はDX7もSNES／SPC移行も含まない。
これで通常の22音源IDのSDK参照が揃う。代替Nuked YM2612と機種用の補助処理はアプリ側に残る。

作業ルートは `/Users/kyorohiro/development8/wfm/hello_ymfm`。
`w/`以下はそれぞれ独立したGitリポジトリなので、本体だけのcommitで保存できたと判断しない。

| リポジトリ | ローカルパス | 直前の成功CI run `40171879716`の基準コミット（すべてmain） |
| --- | --- | --- |
| 本体 | `hello_ymfm/` | `8898a75fc4424aca11596d8cd7fb6046d1c3b585` (SNES／SPC移行・ローカル検証までcommit／push済み。CI開始時はclean) |
| Native SDK | `w/tetorica-soundchip-native/` | `affd1059599f3c7598191c14f5a864b44963d4aa` (`tetorica::spc`) |
| Playground Tauri | `w/tetorica-fm2612-playground-tauri/` | `8b9e922ad6e9c1f8d33cf5719b05330b58311944` (DX7／SNES／SPCを含む成功CI run `40171879716`の入力) |

本体には次のメモがある。SNES／SPCまでの移行・ローカル検証は上記基準コミットへ保存済み。
その後のDX7／SNES／SPCの成功CI結果も記録済みで、現在は上記Nuked移行を進めている。表は直前の成功CI入力を固定して示し、現在のSDK pinはNuked移行節とTauriの取り込み記録で、最新HEADは各リポジトリの`git log -1`／`git status`で確認する。

- [native_sdk_ym2612_adoption_01.md](native_sdk_ym2612_adoption_01.md)：YM2612移行と5構成のCI結果。
- [native_sdk_ym2203_adoption_01.md](native_sdk_ym2203_adoption_01.md)：YM2203移行とローカル検証。
- [native_sdk_ym2608_adoption_01.md](native_sdk_ym2608_adoption_01.md)：YM2608移行とローカル検証。
- [native_sdk_ym2610_adoption_01.md](native_sdk_ym2610_adoption_01.md)：YM2610／YM2610B移行と全OPNの5構成CI。
- [native_sdk_ym2151_adoption_01.md](native_sdk_ym2151_adoption_01.md)：YM2151／X68000移行とローカル検証。
- [native_sdk_okim6258_adoption_01.md](native_sdk_okim6258_adoption_01.md)：OKIM6258移行と初期化対策の保持。
- [native_sdk_ym2413_adoption_01.md](native_sdk_ym2413_adoption_01.md)：YM2413／共有OPL provider移行と先行する5構成CI。
- [native_sdk_opl_adoption_01.md](native_sdk_opl_adoption_01.md)：OPL系4音源の接続移行とRAM付きY8950比較。
- [native_sdk_ay8910_adoption_01.md](native_sdk_ay8910_adoption_01.md)：最新の共有AYコアと独立接続の移行、OPL接続／AY移行後のCIと追加SNES試験のローカル修正。
- [native_sdk_segapsg_adoption_01.md](native_sdk_segapsg_adoption_01.md)：Sega PSG共通コア／raw C APIの移行。
- [native_sdk_rf5c164_adoption_01.md](native_sdk_rf5c164_adoption_01.md)：RF5C164接続／decoder／raw C APIの移行と、PSGと合わせたCI。
- [native_sdk_pwm_adoption_01.md](native_sdk_pwm_adoption_01.md)：32X PWM接続／コアヘッダーの移行とローカル検証。
- [native_sdk_huc6280_adoption_01.md](native_sdk_huc6280_adoption_01.md)：HuC6280接続／コアの移行とローカル検証、PWMと合わせたrun `40162092207`の全5構成成功。
- [native_sdk_gameboy_adoption_01.md](native_sdk_gameboy_adoption_01.md)：Game Boy共通接続／APUの移行とローカル検証、NESと合わせたrun `40168462256`の全5構成成功。
- [native_sdk_nes_adoption_01.md](native_sdk_nes_adoption_01.md)：NES＋FDS共通接続の移行とローカル検証、Game Boyと合わせたrun `40168462256`の全5構成成功。
- [native_sdk_dx7_adoption_01.md](native_sdk_dx7_adoption_01.md)：DX7共通接続／MSFAの移行、通常再生の一致とNative Panicのfeedback履歴初期化、ローカル検証。
- [native_sdk_snes_spc_adoption_01.md](native_sdk_snes_spc_adoption_01.md)：SNES S-DSP／SPC700共通コア・接続の移行、所有・再リンク境界と検証。
- [todo_schedule_register_01.md](todo_schedule_register_01.md)：AY／YM2149等の高速レジスタ制御の別案。今回のSDK移行では実装していない。

### SDK側の完了範囲

- 全22音源IDを18個のstatic libraryで提供。公開alias／headerは汎用OPLを含め23種類。
- 21 fixture実行ファイルから22件のCTestを実行。SNESだけ同じfixtureに2つの試験モードがある。
- 外部ROMやゲーム素材を必要としない17種類のWAV Exampleを用意。
- SDK版は `0.1.0`、stageはまだ `bootstrap`。全WASMレシピの実行や全低レベルAPIの統一を完了したという意味ではない。
- 代替エンジンのNuked YM2612は、SDKの単体Nativeターゲットとしてはreference-only。Tauriには既存のNuked実装がある。
- Analyzer専用のMSM5205／OKIM6295等の追加資料・JS参照は、上記22種類とは別枠。
- 直近のDX7追加では、SDKのNative overrideだけPanic後のフィードバック履歴初期化を修正済み。原本／修正版ハッシュを保持している。

詳細はSDKの[Nativeガイド](../../w/tetorica-soundchip-native/native/README.md)、
[検証記録](../../w/tetorica-soundchip-native/docs/verification.md)、
[音源ごとの差分](../../w/tetorica-soundchip-native/docs/chip-differences.md)を参照。

### Tauriで固定しているSDK

同梱先は `src-tauri/vendor/tetorica-soundchip-native/`。配布ソース全374ファイルを保持している。
取り込み記録の正本は [src-tauri/soundchip-sdk.json](../../w/tetorica-fm2612-playground-tauri/src-tauri/soundchip-sdk.json)。

| 項目 | 固定値 |
| --- | --- |
| SDK版 | `0.1.0` |
| 元コミット | `affd1059599f3c7598191c14f5a864b44963d4aa` |
| 元ZIP | `tetorica-soundchip-native-0.1.0-sources.zip` |
| 元ZIP SHA-256 | `26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce` |
| SDKマニフェスト SHA-256 | `d82f98a36cc934591e23d0ffb86b180e6bcead72e1fc25145246d9c59028ff88` |

元コミットは由来の記録で、署名検証の意味ではない。取り込み時のZIPハッシュと、
同梱マニフェスト／全ファイルのサイズ・ハッシュを照合する。
通常のTauriビルドに別のSDK checkout、submodule、GitHubからの音源ソース取得、CMake呼び出しは不要。
コンパイラーやCargo／npm依存まで同梱しているわけではない。

SDK同梱先を直接編集せず、更新時だけTauriの `scripts/import_soundchip_sdk.py` で検証済みローカルZIPを取り込む。
インポーターは既存の同梱内容に変更があると上書きを拒否する。
アプリ側で開発・検証した変更をSDK配布へ反映し、利用側が固定版を明示更新する運用を維持する。
ソース、ライセンス、NOTICE、原典記録も一緒に保持する。

### 今回切り替えたビルド境界

Tauriの [src-tauri/build.rs](../../w/tetorica-fm2612-playground-tauri/src-tauri/build.rs) は次をSDKからコンパイルする。

- Genesis主音源の `wasm/ym2612_wasm.cpp`。ファイル名にwasmを含むが、ここではNative C++として使う。
- 共通PSGの `wasm/segapsg_wasm.cpp` と `vendor/ymfm/segapsg.cpp`／`.h`、引用する`chip_state.h`。
- 追加生成YM2612の `native/reference/tauri/native_genesis_ym2612.cpp`。
- PC-98／追加生成YM2203の `native/reference/tauri/native_genesis_ym2203.cpp`。
- PC-98／追加生成YM2608の `native/reference/tauri/native_genesis_ym2608.cpp`。
- Neo Geo／追加生成YM2610・YM2610Bの `native/reference/tauri/native_genesis_ym2610b.cpp`。
- 追加生成YM2151の `native/reference/tauri/native_genesis_ym2151.cpp`。
- 追加生成YM2413の `native/reference/tauri/native_genesis_ym2413.cpp`。
- 追加生成AYの `native/reference/tauri/native_genesis_ay8910.cpp` と、選択中MSX／MSX Audioにも共通の `vendor/mame-ay8910/ay8910.cpp`／ヘッダー。
- DOS PC／選択中Y8950の `native/reference/tauri/native_genesis_opl.cpp` と、追加生成4種類の `native/reference/tauri/native_genesis_extra_opl.cpp`。
- 両接続が引用する `native/reference/tauri/native_genesis_y8950_memory.h`。
- 追加生成OKIの `native/reference/tauri/native_genesis_extra_okim6258.cpp`。
- 選択中RF5C164と追加RF5C164の `native/reference/tauri/native_genesis_rf5c164.cpp`、`native_genesis_extra_rf5c164.cpp`。
- 共通RF decoderの`vendor/mame-rf5c164/rf5c164.cpp`／`.h`とraw C APIの`wasm/rf5c164_wasm.cpp`。
- 選択中／追加生成Game Boyの`native/reference/tauri/native_genesis_gameboy.cpp`と、共通APUの`vendor/mame-gameboy/gameboy_apu.cpp`／`.h`。
- 選択中NES＋FDS／追加生成NESの共通接続とAPU／FDS実装を含む`native/reference/tauri/native_genesis_nes.cpp`／`.h`。
- 選択中／追加生成DX7の`native/reference/tauri/native_genesis_dx7.cpp`／`.h`と、`vendor/msfa/`の24共有ファイルおよび`native/reference/overrides/msfa/`の6ファイルからコピーして組み立てるMSFA。
- 選択中／追加生成SNES S-DSPの`native/reference/tauri/native_genesis_snes.cpp`／`.h`、追加SPC700の`native_genesis_spc.cpp`／`.h`と、`vendor/snes-spc/snes_spc/`の共通コア4翻訳単位。
- `vendor/mame-okim6258/okim6258.cpp`原本へ既存の初期化対策を適用して`OUT_DIR/tetorica_sdk_okim6258.cpp`へ生成したデコーダー。
- 共有 `native/src/ymfm_opn_provider.cpp`、`native/src/ymfm_opm_provider.cpp`、`native/src/ymfm_opl_provider.cpp` と `vendor/ymfm/ymfm_ssg.cpp`、`ymfm_adpcm.cpp`、`ymfm_pcm.cpp`。

共有providerは従来のarchive位置で一度だけコンパイルする。
上記のOPN接続は共通providerを使い、OPLL／OPL側も共通ADPCMを参照する。
共有OPL provider／PCMは従来の`tetorica_native_master_system` archive内で一度だけコンパイルする。
選択中Master System／MSXの機種用接続・NativeOpllCoreと選択中AYのレート変換はアプリ側に残す。
PSGのNativePsgCoreもアプリ側に残し、共通PSGコアとraw C APIはSDKを一度だけコンパイルする。
Game GearはSDKヘッダーを優先し、Master Systemも既存のSDK優先includeで同じヘッダーを使う。AYコアもSDKを共有する。
DOS PC／Y8950の選択中・追加生成接続とメモリーhelperもSDKを使用する。メモリーhelperはページを借用し、RAM本体の所有権をSDKへ移す変更ではない。
同じOPL archive内の追加RF5C164接続もSDKへ切り替えた。選択中接続・共通decoder・raw C APIは既存のMega-CD archiveを使う。
SDK接続は各64 KiB RAMを所有し、追加接続の声別履歴も維持する。Rust転送payload・予約・予算・寿命管理はホスト側。
OPLとRFの実cpp／headerをSDK側で監視し、実消費元のない旧native-opl／native-megacdディレクトリのソース監視は外した。
原典、ライセンスの同梱先、旧コピーとsyncスクリプトは保持する。
追加生成YM2413はSDKの独立接続を使用する。独立接続はNativeOpllCoreを流用する構造ではない。
CargoはSDKのOPL provider／ymfmと独立YM2413接続を監視する。
実消費元のなくなった旧native-master-systemディレクトリの監視は外し、ローカルの機種用接続／NativeOpllCoreの監視は保持する。
今回のAY移行ではSDKのAYディレクトリと独立接続cpp／headerを監視し、旧native-msxのソース監視も外す。
旧コピーとBrowser比較用固定記録、同梱AYライセンスの参照先は保持する。旧syncスクリプトの実行だけではSDKを更新しない。
X68000の機種用接続はアプリ側の`src/native_genesis_x68000.cpp`を保持し、FMのincludeとOPM providerをSDKから解決する。
OPM providerは従来の`tetorica_native_x68000` archive内で一度だけコンパイルする。
同archive内のOKIM6258デコーダーはSDK原本から生成し、選択中／追加生成で共用する。
SDKのコンストラクターへC++の関数内staticを使う置換を1箇所だけ適用し、従来のTauri生成物と同じバイト列にする。
置換元が1箇所でなければビルドを止める。SDKの374ファイルや固定記録を直接編集しない。
サンプル所有・保持、FM／OKI混合は引き続きアプリ側。
CargoはSDKのmame-okim6258ディレクトリと追加生成OKI接続を監視し、実消費元のなくなった旧native-x68000ディレクトリの監視は外した。
機種用接続のcpp／headerの監視と旧スナップショットの由来・ハッシュ照合は保持する。
他音源の接続全体までSDKへ移したわけではない。重複providerを追加したり、旧スナップショットをまとめて削除したりしない。

Genesisのgain／DC除去／PSG混合、Rustの予約・owner・回収・予算、CPAL、Mixer、FX／liveFx、録音、WebView／JS APIはアプリ側。
PSGのcpp／ヘッダーは既存のSDK ymfm／wasmディレクトリ監視で覆う。
旧native-genesisにはFX／noise等が参照する共通ヘッダーもあるためディレクトリ監視を維持し、原典やsyncスクリプトも保持する。
Browser／npmのWASM配布とTauriの `dist/` は今回の取り込みで変更していない。
Cargoは取り込み記録、SDKのymfmディレクトリ、wasmディレクトリ等を監視し、明示更新時に再ビルドする。
YM2608のRhythm ROMはRustが従来の`native-ym2608/snapshot/web/`から読むため、同ディレクトリの監視も保持する。
DX7はSDKから`OUT_DIR/tetorica_sdk_dx7_msfa/`へ13個のccと17個のheaderをコピーして組み立て、接続cppと合わせて既存archiveの14翻訳単位を維持する。
引用includeのヘッダー解決を統一するため、全翻訳単位が同じprivateツリーを使う。SDK本体を編集せず、新しいPython／CMake依存も追加しない。
Native Panicの修正だけは旧版と意図した差があり、事前確保済みnoteへの値代入でfeedback履歴を消す。通常note-on／release／kill、Rustの音色所有・lease・slot管理・予約、PCM・Mixer／FXは保持する。
CargoはSDKのMSFA共有／overrideディレクトリと接続cpp／headerを監視し、実消費元のない旧native-dx7／ローカル接続のソース監視を外す。
旧32ファイルのスナップショット、原本／修正版のハッシュとライセンスの同梱先、syncスクリプトは保持する。旧syncだけではSDKを更新しない。
SNES／SPCは2接続と4コアを既存の`tetorica_native_snes` archive内の6翻訳単位としてコンパイルし、`SPC_DSP.cpp`を重複しない。
SDKの独立CMakeターゲットを追加せず、C++17・O2・MSVC `/EHsc`・wrapv／noalias／ffp設定と既存のリンク順序を維持する。
SNESの所有64 KiB RAM／借用timelineとSPCのコピーload／元ファイル保持、control側の生成・seek・破棄とcallbackへの公開・回収は既存のRust実装。
CargoはSDKのSNES-SPCディレクトリと2接続cpp／headerを監視し、実消費元のない旧`native-snes/`／ローカル接続のソース監視を外す。
旧34件の固定記録とLGPLライセンス・由来・syncスクリプトを保持し、実際のSDKを改変して再リンクする手順を`NATIVE-SOURCES.md`へ更新する。

最初に読むファイルはTauriの [SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)。
配布ソースの再ビルドは [NATIVE-SOURCES.md](../../w/tetorica-fm2612-playground-tauri/NATIVE-SOURCES.md) を参照する。

### YM2612移行時のローカル検証

2026-10-25、macOSで実施。デバイスを開かない自動試験と実機で聴く確認は区別する。

| 対象 | 結果 |
| --- | --- |
| 旧ソース／SDKの入力 | 14組が同一。OPN providerの差分はinclude相対パス |
| 主YM2612の移行前後比較 | 24ケース、240,000フレームでPCM／status／IRQ／read等がbit一致 |
| 追加YM2612と実WASM | 198比較、1,216,512フレームでPCM／status／IRQ／4 readの差分0 |
| 主GenesisとWorklet | 6項目、49,152フレーム。最大差 `3.725290298e-9`、移行前と同じ |
| TauriのPython／Node | 22テスト／31テスト成功 |
| Cargo | 723成功、明示実行用4件ignored。`cargo check --locked --offline`も成功 |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源混在 | 3混合構成、代表7音源、受入れ・台数制限の試験が成功 |
| 同梱ソース | SDK374ファイル、22件の固定記録、アプリの対応ソースZIP1,796ファイルを照合 |
| 独立展開 | 対応ソースZIPからSDK照合、YM2612 fixtureのC++14ビルド／自己試験に成功 |

Sandbox内のCargo試験では既存HTTP bind試験2件が権限制限で失敗したが、承認済みの制限外実行では全体が成功。
この制限を回避するための製品変更は入れていない。
最終対応ソースZIPは文書のみ再更新した後にも照合済みで、独立ビルド時からコンパイル入力は変わっていない。

### YM2203移行のローカル検証 — 2026-10-25

同梱SDKの版を変えず、PC-98と追加生成のYM2203接続の参照先を切り替えた。
詳細は[native_sdk_ym2203_adoption_01.md](native_sdk_ym2203_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| 接続／includeのソース一致 | 9組が同一 |
| PC-98用の移行前後と実WASM | 186ケース、1,142,784フレーム。旧／SDKがbyte一致、WASMとの差分0 |
| 追加生成用の移行前後と実WASM | 195ケース、1,198,080フレーム。同じくbyte一致、WASMとの差分0 |
| 完全な状態取得 | 6ケース、49,152フレーム。280バイトの状態とPCM／status／IRQ／readが一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・88 Run／Stop、3混合構成・7単独音源、受入れ／台数制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP1,796ファイルの照合成功 |

本体の`scripts/check_native_ym2203.mjs`と追加生成用checkerは既定で実際のSDKをコンパイルし、
両方のWASM比較が成功している。使用した5つのcppのパス／SHA-256も記録する。
既定ビルドでの再確認を、381件の固有PCM比較へ二重に加算しない。
今回の結果はmacOS ARM64で、音声デバイスを開かない検証。ローカル検証時点ではYM2203差分の5構成CIは未実行で、後続の全OPN移行CIを下記で追跡している。

### YM2608移行のローカル検証 — 2026-10-25

PC-98と追加生成のYM2608も同じ固定SDKを使う。
Rhythm ROMの素材は引き続きRustが従来のスナップショットから読み込むため、その監視は残す。
詳細は[native_sdk_ym2608_adoption_01.md](native_sdk_ym2608_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| 接続／includeのソース一致 | 9組が同一 |
| PC-98用の移行前後と実WASM | 30ケース、184,320フレーム。旧／SDKのPCMがbyte一致、WASMとの差分0 |
| 追加生成用の移行前後と実WASM | 252ケース、1,585,152フレーム。PCM／status／statusHi／IRQ／4 readが一致、WASMとの差分0 |
| Native状態・RAM比較 | 6ケース、49,152フレーム。524／536バイトの状態とPCM／read、RAMの3範囲が一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・88 Run／Stop、3混合構成・7単独音源、受入れ／台数制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP1,796ファイルの照合成功 |

本体のYM2608用checkerも既定でSDKをコンパイルし、PC-98用／追加生成用の両方で比較成功。
固有の音声比較は282件、1,769,472フレーム。既定ビルドでの再確認は二重加算しない。
状態比較はNative同士、RAM比較は1観測あたり96バイトの3範囲で、全RAMの毎フレーム比較ではない。
今回の結果はmacOS ARM64で、音声デバイスを開かない検証。ローカル検証時点ではYM2608差分を含む各OSのCIは未実行で、後続の全OPN移行CIを下記で追跡している。

### YM2610／YM2610B移行のローカル検証 — 2026-10-25

Neo Geoの選択中音源と追加音源の両変種を、同じ固定SDKからビルドする。
詳細は[native_sdk_ym2610_adoption_01.md](native_sdk_ym2610_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース差分 | ヘッダー／interface 8組がbyte一致。SDK cppとの差は説明コメント1行のみ |
| 選択中音源の移行前後と実WASM | 72ケース、442,368フレーム。PCMがbyte一致、WASMとの差分0 |
| 追加音源の移行前後と実WASM | 504ケース、3,096,576フレーム。PCM／status／statusHi／IRQ／4 readが一致、WASMとの差分0 |
| Native状態・ROM比較 | 12ケース、98,304フレーム。524／536バイトの状態とPCM／read、256バイトのROM観測が一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・88 Run／Stop、3混合構成・7単独音源、受入れ／台数制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP1,796ファイルの照合成功 |

固有PCM比較は576件、3,538,944フレームで、両変種を含む。既定ビルドの再確認は二重加算しない。
Native状態の比較とWASM内部状態の比較は区別し、ROM全域の毎フレーム比較は行っていない。
選択中音源の連続ROMと追加音源の不変ページ方式、callback中のallocation／freeゼロも既存fixtureで検証した。
SDK cpp／headerの監視へ切り替え、素材の実消費元がない旧`native-ym2610b`ディレクトリの監視は外した。
今回の結果はmacOS ARM64で、音声デバイスを開かない検証。ローカル検証時点では今回の差分を含む各OSのCIは未実行で、後続の全OPN移行CIを下記で追跡している。

### YM2151／X68000移行のローカル検証 — 2026-10-25

同じ固定SDKを使い、独立YM2151接続と共有OPM providerを切り替えた。
X68000の機種用接続とOKIはアプリ側に保持する。
詳細は[native_sdk_ym2151_adoption_01.md](native_sdk_ym2151_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース差分 | 接続・混合・コア・ヘッダー11組がbyte一致。providerの差はinclude相対パスのみ |
| X68000の移行前後と実WASM | 42ケース、258,048フレーム。FM左右・OKI左右の4出力がbyte一致、WASMとの差分0 |
| 追加生成YM2151の移行前後と実WASM | 252ケース、1,548,288フレーム。PCM／status／IRQ／read等がbyte一致、WASMとの差分0 |
| Native状態比較 | 6ケース、49,152フレーム。272／292バイトの状態形式全体とPCM／status／IRQ／readが一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP全1,796ファイルのオフライン照合成功 |

固有の音声比較は計294件、1,806,336フレーム。更新したcheckerの既定ビルドでも成功し、
実際のSDKソースのパス／SHA-256を記録した。再確認分は固有ケースへ二重加算しない。
状態比較はNative同士で、WASM内部状態や全サンプルRAMの毎フレーム比較ではない。
今回の結果はmacOS ARM64／Clangで、音声デバイスを開かない検証。
先行する全OPNの5構成CIは今回のYM2151差分を含まない。各OSのCIと実機確認は別途行う。

### OKIM6258移行のローカル検証 — 2026-10-25

固定SDKから追加生成OKI接続とデコーダー原本を使う。
デコーダーにはビルド時に既存の初期化対策を適用し、SDK原本は編集しない。
詳細は[native_sdk_okim6258_adoption_01.md](native_sdk_okim6258_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース一致 | 接続・混合・ヘッダー6組がbyte一致。生成デコーダーも旧Nativeとbyte一致 |
| X68000の移行前後と実WASM | 42入力、258,048フレーム。FM左右・OKI左右の4出力がbyte一致、WASMとの差分0 |
| 追加生成OKIの移行前後 | 45入力、264,192フレーム。PCMとclock／divider／pan／再生状態等がbyte一致 |
| 追加生成OKIと実WASM | 3ブロック分割の135比較、792,576フレーム。差分0 |
| Native状態比較 | 6ケース、49,152フレーム。292／28バイトの状態全体とPCMが一致。借用バッファは破棄後も不変 |
| 並行生成 | 旧／生成SDK版でそれぞれ16スレッド・513インスタンス。初期化は各1回のみ |
| Cargo | 723成功、4件ignored |
| 再生 | 22 mode・604,032フレーム・88 Run／Stopが成功 |
| 混合 | 3混合構成・7単独音源、受入れ／16台制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP全1,796ファイルのオフライン照合成功 |

固有Native入力は87件、522,240フレーム。実WASMは177比較、1,050,624フレームで、
同じ追加生成入力を3種類のブロック分割で再生する比較を含む。177件をすべて固有入力と数えない。
更新checkerの既定ビルドも成功し、SDK原本と実際の生成デコーダーのハッシュを記録した。
Cargoが生成した`OUT_DIR/tetorica_sdk_okim6258.cpp`自体も旧デコーダーと一致した。
今回もmacOS ARM64／Clangで音声デバイスを開かない検証。各OSのCIや実機確認とは区別する。

### YM2413／共有OPL provider移行のローカル検証 — 2026-10-25

同じ固定SDKから追加生成YM2413、共有OPL providerとPCM依存をビルドする。
機種用接続・NativeOpllCore・PSG／AYとDOS PC／Y8950の接続全体はアプリ側に保持する。
詳細は[native_sdk_ym2413_adoption_01.md](native_sdk_ym2413_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース一致 | 15入力がbyte一致。providerの差はinclude相対パスのみ。保持するローカル13入力は変更なし |
| Master System／MSX／追加YM2413 | 60／93／558ケース、計711件・3,225,600フレーム。旧／SDKがbyte一致、実WASMとの差分0 |
| DOS OPL／追加OPL・Y8950／MSX Audio | 198／552／138ケース、計888件・5,455,872フレーム。同じくbyte一致、WASMとの差分0 |
| Native公開状態比較 | 9ケース、36,864フレーム。72／100／104バイトの公開状態全体とPCM／status／IRQ／readが一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限が成功 |

固有比較は計1,599件、8,681,472フレーム。更新した6つのcheckerの既定ビルドも成功し、
実際のSDK入力のパス／SHA-256を記録した。既定ビルドの再確認分は固有件数へ加算しない。
状態比較は公開C ABI snapshotをNative同士で比べたもので、ymfm非公開メモリーやWASM全内部状態の比較ではない。
SDK優先で解決するsegapsg.hも旧コピーと同一で、PSGのcpp実装はアプリ側のまま。
今回もmacOS ARM64／Clangで音声デバイスを開かない検証。このローカル検証終了時点では各OSのCIと実機確認は未実行で、後続のCI結果は下記に記録している。
最終文書を含む対応ソースZIP全1,796ファイルと、SDK374ファイルを含む22件の固定記録のオフライン照合も成功。

### OPL系4音源の接続移行 — 2026-10-25、ローカル検証

共有providerは既にSDKへ移行済みで、今回は選択中／追加生成の接続とメモリーhelperだけを切り替えた。
詳細は[native_sdk_opl_adoption_01.md](native_sdk_opl_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース一致 | 採用する4ファイルはbyte一致、追加生成cppはコメント1行のみ差分 |
| 選択中DOS OPL | 198ケース、1,216,512フレーム。旧／SDKがbyte一致、実WASMとの差分0 |
| 追加OPL系4種類 | 552ケース、3,391,488フレーム。同上 |
| 選択中Y8950 | 138ケース、847,872フレーム。PCM／status／IRQ／read等が一致、WASMとの差分0 |
| RAM付きY8950 | 選択中／追加生成で72ケース、589,824フレーム。RAMを使うPCM／状態が一致、WASMとの差分0 |
| Native公開状態・RAM | 6ケース、24,576フレーム。524／520バイトの状態全体とPCM／read／revision・毎観測384バイトのRAMが一致。終了時の全借用バッファは破棄後も不変 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限が成功 |

計960件、6,045,696フレーム。更新した4つのcheckerの既定ビルドも実SDKを使って成功し、パス／ハッシュを記録した。
再実行分と別のNative公開状態比較は二重加算しない。全RAMの毎フレームdumpやWASM内部状態全体の比較ではない。
前回の5構成CI `40137093552`は今回の接続差分を含まない。今回もmacOS ARM64で音声デバイスを開かない検証。
最終文書を含む対応ソースZIP全1,796ファイルと、SDK374ファイルを含む22件の固定記録のオフライン照合も成功。

### AY-3-8910移行 — 2026-10-25、ローカル検証

共有AYコアと独立追加接続の参照を、同梱済みSDKへ切り替えた。
選択中MSX／MSX Audioの機種用接続とAYレート変換、Rustの制御・混合は維持する。
詳細は[native_sdk_ay8910_adoption_01.md](native_sdk_ay8910_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース一致 | 独立接続cpp／headerとコアcpp／headerの4ファイルがbyte一致 |
| 選択中MSX | 93ケース、571,392フレーム。旧／SDKがbyte一致、実WASMとの差分0 |
| 独立追加AY | 114ケース、466,944フレーム。PCM／公開状態が一致、実WASMとの差分0 |
| Native公開状態 | 6ケース、24,576フレーム。104／24バイトの状態全体、PCMと毎フレーム16個のAY readが一致 |
| 共通fixtureの追加YM2413回帰 | 558ケース、2,285,568フレーム。実WASMとの差分0 |
| Cargo | 723成功、0失敗、4件ignored |
| 再生／混合 | 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限とStop後の予算回収が成功 |

AYの移行比較は計207ケース、1,038,336フレーム。既定ビルドの再確認分や追加YM2413回帰は二重加算しない。
全16 envelope形状、tone／noise、clock、明示的な音量0、Stop／reset／再試奏を含む。
公開状態比較はコアの非公開全メモリーやWASM内部状態のdumpではない。
fixture自己試験のcallback操作中のallocation／freeは0。macOS ARM64／Clangで音声デバイスを開かずに検証した。
このローカル検証終了時点では、OPL接続と今回のAY差分を含む5構成CIは未実行だった。
下記run `40142510765`は4構成成功・macOS x86_64失敗で終了した。実機の音声確認は未実行。

### Sega PSG移行 — 2026-10-25、ローカル検証

共通コア／raw C APIと関連ヘッダー4ファイルが旧コピーとbyte一致。
機種用接続は維持し、同じ固定SDKのコアを既存のGenesis archive内で一度だけコンパイルする。
詳細は[native_sdk_segapsg_adoption_01.md](native_sdk_segapsg_adoption_01.md)。

| 対象 | 比較数 | フレーム | 実WASMとの最大差 |
| --- | --- | --- | --- |
| Game Gear／追加PSG共通接続 | 69 | 454,656 | 0 |
| Master System | 63 | 387,072 | 0 |
| Nuked＋PSG | 222 | 1,363,968 | `2.9802322387695312e-8` |
| Genesis＋PSG | 6 | 49,152 | `3.725290298461914e-9` |

全360ケース・2,254,848フレームで旧／SDKの出力がbyte一致。混合FMのWASM丸め差は旧実装と同じ。
既定の4コンパイル経路も成功し、再確認分は二重加算しない。
raw C API別比較は6ケース・36,864フレームでPCMと全40バイトの直列化フィールドが一致した。
これはNative同士・同一ビルドの状態API比較であり、WASM内部状態や非公開オブジェクトのdumpではない。
状態APIはvectorを確保するためcallback割当てゼロの主張とは分ける。
Game Gear／Master System／Nukedのfixture自己試験は公開状態・独立性・callback allocation／freeゼロも成功。
PSGのattenuation 0は最大音量で、新しい比較はこの設定をStop／off／再試奏後も保持するもの。

Rust全試験は723成功・0失敗・4件ignored。
22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限と17台目拒否、Stop後の予算回収も成功。
両runnerはexit code 0、deviceOpened false。今回もmacOS ARM64／Clangでのローカル検証で、sanitizerは実行していない。
先行するrun `40143851548`の全5構成成功は今回のPSG移行を含まない。

### RF5C164移行 — 2026-10-25、ローカル検証

選択中／追加生成接続、共通decoder、raw C APIとヘッダー8ファイルが旧コピーとbyte一致。
詳細は[native_sdk_rf5c164_adoption_01.md](native_sdk_rf5c164_adoption_01.md)。

| 対象 | ケース | フレーム | 結果 |
| --- | --- | --- | --- |
| 選択中Mega CD | 21 | 98,304 | 旧／SDK byte一致、実WASM最大差0 |
| 独立追加生成 | 75 | 448,512 | 同上、毎フレーム95項目のPCM／公開状態／位置read／RAM probe |
| raw C API／追加状態の別比較 | 6 | 24,576 | PCM／毎フレーム16 readと、27観測点ずつの全64 KiB RAMが独立期待値・旧SDKの双方と一致 |

WASM比較は96ケース・546,816フレーム。既定2コンパイル経路の再確認は重複加算しない。
別比較のraw直列化状態は65,660バイト、追加公開状態は100バイト。これはNative同士の同一ビルド比較で、WASM内部状態や全RAMの毎フレームdumpではない。
追加fixtureのfull-RAM転送／保持／範囲拒否・9通りのrate／clock分離・声別取り消し・Stop／reset・callback allocation／freeゼロも成功。
Rust全試験は723成功・0失敗・4件ignored。22 mode・604,032フレーム・88 Run／Stopと、3混合構成・7単独音源・受入れ／16台制限・Stop後の予算回収も成功した。
両runnerはexit code 0／deviceOpened false。今回もmacOS ARM64／Clangで、sanitizerは実行していない。
ローカル検証後、下記run `40148943609`でPSG移行と合わせた5構成CIを実行し、検証とビルドが全5構成で成功した。
先行run `40143851548`は両移行を含まない。

### YM2612移行のGitHub Actions — 2026-10-25

- 対象: `v0.90.2+test`、Tauriコミット`9ef583e8e7fa9e75546b24dd89e119dab7d412c6`。
- [Build Desktop — run 40125688503](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40125688503)は全体が`completed`／`success`。
- 重複したmainの手動実行`40125700793`はキャンセル済み。タグ側の全5ジョブが成功した。
- タグ名とは別に、アプリの`package.json`／Tauri設定の版は`0.90.1`。

| 構成 | Native検証レポート | インストーラービルド |
| --- | --- | --- |
| macOS ARM64 | 成功 | 成功（DMG） |
| macOS x86_64 | 成功 | 成功（DMG） |
| Windows x86_64 | 成功 | 成功（NSIS） |
| Linux ARM64 | 成功 | 成功（DEB／AppImage） |
| Linux x86_64 | 成功 | 成功（DEB／AppImage） |

5環境それぞれの`native-validation-<platform>`を取得し、次のJSON内容まで照合した。

- `sources.json`: 22件の固定記録、SDK全374ファイル、対応ソースZIP全1,796ファイルが成功。
- `stability.json`: 22 mode、604,032フレーム、88 Run／Stop遷移が成功。
- `extra-stability.json`: 3混合構成、7単独音源、受入れと台数制限が成功。
- 全環境で`deviceOpened: false`。デバイスを開かない実Rustの生成処理の検証。

集計は`/private/tmp/tetorica-sdk-adoption-ci-40125688503/inspection-summary.json`。
ZIPのSHA-256はWindowsと他環境で異なるため、環境別の記録を参照する。
各環境でマニフェストとcheckoutに対する全ファイル照合は成功している。

インストーラーはDMG 2個、NSIS EXE 1個、DEB 2個、AppImage 2個の計7個を確認。
Actionsにもインストーラー5構成分と検証レポート5構成分の計10アーティファクトが保存されている。
タグのリリースは`isDraft: true`で未公開。インストーラーのダウンロード・インストールは今回の自動確認では行っていない。
今回のCIでOS間のPCM bit一致や各OSのWASM比較を確認したわけではない。
実機の音声出力・ノイズ・Keyboard操作・インストール後の起動も別に確認する。

Tauriの `Build Desktop` は `workflow_dispatch` または `v*` tagのpushで起動する設定で、通常のmain pushだけでは起動しない。

### 全OPN移行のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40130334227](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40130334227)をmainで手動実行。
- 対象コミットは`5280f83adebc542fdba1f49c5ff9bc8b51860734`。YM2612／YM2203／YM2608／YM2610／YM2610BのSDK移行を含む。
- run全体が`completed`／`success`で、macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5ジョブが成功。CIに通すためのコード修正は不要だった。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行なので、新しいドラフトリリースや一般公開は行わない。
- 各OSでのPCM bit一致、実機の音声出力・ノイズ・インストール後の起動は、このCIとは別の確認。

| 構成 | Native検証レポート | インストーラービルド |
| --- | --- | --- |
| macOS ARM64 | 成功 | 成功（DMG） |
| macOS x86_64 | 成功 | 成功（DMG） |
| Windows x86_64 | 成功 | 成功（NSIS） |
| Linux ARM64 | 成功 | 成功（DEB／AppImage） |
| Linux x86_64 | 成功 | 成功（DEB／AppImage） |

5つの`native-validation-<platform>`を取得し、各JSONの内容まで確認した。

- `sources.json`: SDK374ファイルを含む22件の固定記録と、対応ソースZIP全1,796ファイルの照合が成功。
- `stability.json`: 22 mode、604,032フレーム、88 Run／Stop遷移が成功。
- `extra-stability.json`: 3混合構成、7単独音源、受入れ・台数制限が成功。
- 全環境でrunnerのexit codeが0、`deviceOpened: false`。音声デバイスを使わない生成処理の結果。

SDK配布ZIPの固定ハッシュは全環境で同じ`26db7518...`。
対応ソースZIPはmacOS／Linuxが`d8930453ce6121b6ba63276c38a5b955c05360abe8a4a1b9eb140db3f4a1b502`、
Windowsが`f5ff2ada000b786419d1e5835a9d4fbdf391d779f588a877a0b4ff8a65959a53`で、
各環境のcheckout／マニフェストとの照合が成功した。
集計は`/private/tmp/tetorica-opn-ci-40130334227/inspection-summary.json`。

GitHub APIで、Native検証レポート5構成分とインストーラー5構成分の計10アーティファクトを確認した。
すべて有効期限内で、サイズは0より大きい。インストーラーをダウンロード・インストールして起動する確認は行っていない。
今回の手動実行はタグを作らず、新しいドラフトリリースも一般公開も行っていない。
実機の音声出力・ノイズ・UI操作・OS間のPCM bit一致を確認したという意味ではない。

結果を参照する場合は、対象runを次で確認できる。

```sh
gh run view 40130334227 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### YM2151／OKIM6258／YM2413移行後のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40137093552](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40137093552)をmainで手動実行した。
- 対象は`634e56f4dcbacd3d204ea5dace454d39fe0fc9ca`。全OPNに加え、YM2151、OKIM6258、YM2413／共有OPL providerの移行を含む。
- macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の5構成で、run全体と全5ジョブが成功した。CIのためのコード修正は不要だった。
- 全5環境の検証JSONとGitHubのアーティファクトdigestを照合済み。SDK374／22件の固定記録／ZIP1,796ファイル、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源と受入れ／16台制限が成功。両runnerはexit code 0、deviceOpened false。
- インストーラービルドも全5構成で成功。macOSはDMG、WindowsはNSIS、Linuxは各DEB／AppImage。
- 検証レポート5構成とインストーラー5構成の計10アーティファクトをGitHub APIで確認した。すべて有効期限内・サイズ0より大きい。インストーラー自体のダウンロードや起動は未確認。
- タグを作らない`workflow_dispatch`で、アプリ版は`0.90.1`のまま。新しいドラフトリリースや一般公開は作らない。
- 記録は[native_sdk_ym2413_adoption_01.md](native_sdk_ym2413_adoption_01.md)、取得したJSONと集計は`/private/tmp/tetorica-ym2413-ci-40137093552/`。
- CIのソースZIPに対する比較基準のマニフェストを同ディレクトリの`before-docs-source-manifest.json`に保存した。
  CI結果をTauriガイドへ追記した後のZIPも別に生成・照合済みで、差分は`docs/native-sdk-ym2612.md`のみ、コンパイル入力は同一。
- CIの対応ソースZIPはmacOS／Linuxが`2829e9f948e257535bf71aac86a702ffe75701ba878cc01cb5c8900787c5a2ee`、Windowsが`ba9920701daf4513d586ef92037c2afcf7bb8d84a83842d665286623ca6e1c20`。
  全環境でマニフェスト／checkoutとの照合は成功。Windowsとの差の原因は未断定で、SDK固定ハッシュは同じ。
- 先行する各ローカル検証の「CI未実行」はその時点の記録。今回のCIはYM2151／OKIM6258／YM2413移行を含むが、OS間のPCM bit一致や各OSでのWASM比較、実機の音声出力・ノイズ・インストール後の起動は別の確認。

```sh
gh run view 40137093552 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### OPL接続／AY移行後のGitHub Actions — 2026-10-25、4構成成功、macOS x86_64失敗

- [Build Desktop — run 40142510765](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40142510765)を`main`へ`workflow_dispatch`で手動実行した。
- 対象コミットは`276e744ee5ed00513558b1d995e950a3ef91884c`。`4451195...`のOPL接続移行と、今回のAY移行を含む。
- attempt 1は`completed`／`failure`。5ジョブ中4成功・1失敗で、再実行はしていない。
- 開始前に本体`ce2ad30833a96607721ce8ea3122aaf5e6fefa3d`とTauriの対象HEADがユーザーによりcommit／push済みで、両作業ツリーがcleanであることを確認した。
- macOS ARM64・Windows x86_64・Linux ARM64／x86_64の4ジョブは検証・インストーラービルドとも成功。macOSはDMG、WindowsはNSIS、LinuxはDEB／AppImage。
- macOS x86_64のRust試験は722成功・1失敗・4件ignoredでexit code 101。`native_genesis::extra_snes_tests::extra_snes_completion_wait_releases_control_and_history_expires`で、CI対象の`src/native_genesis_extra_snes_tests.rs:656`の`unwrap()`が`Native additional SNES state changed while reading; retry`を返す`Err`でpanicした。
- 検証アーティファクト5件のZIP digestを照合し、全環境の`sources.json`を確認した。SDK374ファイルを含む22件の固定記録とソースZIP1,796ファイルが成功。macOS x86_64の再生／混合reportは欠けており、成功とは扱わない。
- 残る4構成の完全なreportは、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源・受入れ／16台制限が成功。両runnerはexit code 0、`deviceOpened: false`。OS間のPCM bit一致や各OSでのWASM比較は未確認。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行で、新しいドラフトリリースや一般公開は行わない。
- 確認用レポートの取得先は`/private/tmp/tetorica-opl-ay-ci-40142510765/`。
- 集計は`inspection-summary.json`、失敗ログは`macos-intel-job.log`。最終状態は`run-final.json`、`jobs-final.json`、`artifacts-final.json`、`jobs-audit.json`。
- GitHub APIで検証レポート5件とインストーラー4件の計9アーティファクトを確認し、すべて有効期限内・サイズ0より大きかった。全5ジョブのドラフトリリース作成stepはskipped。実機の音声・UI操作・インストーラーのダウンロードや起動は別の確認。
- このCI対象と、その後のローカル試験修正は区別する。OPL／AY移行との因果関係は未確定で、元のCI入力ZIPのハッシュ`cf24143b...`は保持している。

```sh
gh run view 40142510765 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### 追加SNES試験のローカル修正と検証 — commit済み

Tauriの`src-tauri/src/native_genesis_extra_snes_tests.rs`だけを修正し、
上記のretryエラーに限って5秒を上限に`yield_now()`を挟んで再読取する。
ほかのエラーは検証へ渡し、通知受信の待機も200 msから5秒へ延長した。
完了前の待機・履歴失効・状態値などの意味上のassertは保持する。音源・製品のRust実装・ビルド・APIは変更しない。
修正後のRust全試験は723成功・0失敗・4件ignored。対象試験の反復も50／50成功し、
同じCI記録ディレクトリの`snes-test-fix-validation.json`に記録した。
この修正は最初のCI対象`276e744...`には含まれない。ローカル検証終了時点では未コミット・修正版CI未実行だったが、
その後ユーザーが修正とガイドをTauriの`842245dd...`へ、本体の記録を`a278e1d5...`へcommit／pushした。
Tauriのガイドも今回の結果に合わせて更新し、試験修正とガイドを含む対応ソースZIPを再生成・照合した。
CI入力とのマニフェスト差分はガイドとSNES試験の2ファイルだけ。製品のソース入力は変わらない。

### SNES試験修正後のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40143851548](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40143851548)を`main`へ`workflow_dispatch`で手動実行した。
- 対象は`842245ddf060fedaeb42e6b01d30175b488816b7`。OPL接続／AY移行に加え、SNES試験修正と前回CIのガイド更新を含む。
- attempt 1は`completed`／`success`。全5ジョブの検証とインストーラービルドが成功した。
- 開始前に本体`a278e1d565d0ef345bcdf1532763480cd156614d`とTauriの対象HEADがremote mainと一致し、両作業ツリーがcleanであることを確認した。ユーザーがcommit／push済みのため、追加のcommitはしていない。
- macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5構成で、ソース照合・Cargo・再生ライフサイクル・追加音源混合のstepが成功した。
- macOS ARM64／x86_64はDMG、Windows x86_64はNSIS、Linux ARM64／x86_64はDEB／AppImageが成功。最初のCIで失敗したIntel Macも今回はジョブ全体が成功した。
- 検証JSONと取得した検証ZIPのdigestは全5構成で照合成功。SDK374ファイルを含む22件の固定記録とソースZIP1,796ファイル、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源・受入れ／16台制限・Stop後の予約予算回収が成功。両runnerはexit code 0、`deviceOpened: false`。
- 前回reportが欠けたmacOS x86_64も、今回は`sources.json`／`stability.json`／`extra-stability.json`が揃って成功した。
- 最初に失敗したrun `40142510765`とは別の実行。アプリ版は`0.90.1`のままで、タグ・新しいドラフトリリース・一般公開は作成しない。
- 確認用レポートの取得先は`/private/tmp/tetorica-opl-ay-fixed-ci-40143851548/`。
- 集計は`inspection-summary.json`と`native-artifact-metadata.json`。対応ソースZIPはmacOS／Linuxが`2cafb70e...`、Windowsが`0cbc716f7d277d2a2e0e24f42134cb0f6b6ffb15f767fe0f74ea377b84c00920`で、各checkout／マニフェストとの照合は成功。差の原因は断定していない。
- 最終状態は`run-final.json`、`jobs-final.json`、`artifacts-final.json`。検証レポート5件とインストーラー5件の計10アーティファクトは、すべて有効期限内・サイズ0より大きかった。全5ジョブのドラフトリリース作成stepはskipped。
- インストーラーや対応ソースZIPのダウンロード、インストール後の起動・実機の音声・UI操作は未確認。OS間のPCM bit一致や各OSでのWASM比較も、このCIの確認範囲には含まれない。
- このチェックポイント更新は本体の2ファイルとTauriガイド。コードは変更せず、完了したローカル試験は再実行していない。ガイドを含む対応ソースZIPだけ再生成した。

```sh
gh run view 40143851548 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### Sega PSG／RF5C164移行後のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40148943609](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40148943609)を`main`へ`workflow_dispatch`で手動実行した。
- 対象は`4939ddc7f7125f47d969e29c975264eaa528d81c`。Sega PSGとRF5C164のSDK移行を含む。
- attempt 1は`completed`／`success`。全5ジョブの検証とインストーラービルドが成功した。
- 本体`1d35f48a16dbc5b0264755f82ec3e97242e34e8a`とTauriの対象HEADをpushし、remote mainとの一致と両作業ツリーがcleanであることを確認してから開始した。
- 全5構成の検証JSONと検証ZIPのdigest照合が成功。macOS ARM64／x86_64はDMG、Windows x86_64はNSIS、Linux ARM64／x86_64はDEB／AppImageのビルドも成功した。
- 各環境の`sources.json`でSDK374ファイルを含む22件の固定記録とソースZIP1,796ファイル、`stability.json`で22 mode・604,032フレーム・88 Run／Stopが成功。
- `extra-stability.json`では3混合構成・7単独音源、受入れ／16台制限とStop後の予約予算回収が成功。両runnerはexit code 0、`deviceOpened: false`。
- 最初のSSH公開鍵認証ではpushに失敗したが、コマンド単位のgh HTTPS認証で成功した。remoteやGit設定は変更していない。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行で、新しいドラフトリリースや一般公開は行わない。
- 確認用レポートの取得先は`/private/tmp/tetorica-psg-rf-ci-40148943609/`。
- `inspection-summary.json`は全5構成がpassedで、不足reportは0。CIの対応ソースZIPはmacOS／Linuxが`e1433b21...`、Windowsが`cac895015a0a3737fcb5116adf214c24b0ee7722d18938a4eae3c296592fe48a`で、各checkout／マニフェストとの照合は成功。差の原因は断定していない。
- 最終根拠は`final-ci-summary.json`、`jobs-audit.json`、`artifact-metadata.json`。検証レポート5件とインストーラー5件の計10アーティファクトは対象run／commitと一致し、すべて有効期限内・サイズ0より大きかった。全5ジョブのドラフトリリース添付stepはskipped。
- この結果記録は本体の作業記録2ファイルとTauriガイドだけ。コードは変更せず、完了したローカル試験は再実行していない。ガイド確定後の対応ソースZIPも別に再生成・照合した。Tauriガイドは`66004f00e66e7dba2394777cd281f7feeec46da0`へcommit／push済み。
- インストーラーや対応ソースZIPのダウンロード・起動・独立照合は未確認。OS間のPCM bit一致や各OSでのWASM比較、実機の音声・ノイズ・UI操作・インストール後の起動も別の確認。

```sh
gh run view 40148943609 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### Game Boy／NES＋FDS移行後のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40168462256](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40168462256)は`main`への`workflow_dispatch`、attempt 1。対象は`a70e86d2061349a396de7e4816a5438fea5dcb4f`で、Game Boy／NES＋FDSのSDK参照切替を含む。
- 2026-10-25 06:15:32 UTC開始、06:34:34 UTC更新の最終結果が`completed`／`success`。macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5ジョブの検証とインストーラービルドが成功した。CIのためのコード修正は不要だった。
- macOSはDMG、WindowsはNSIS、LinuxはDEB／AppImageのビルドが成功。アプリ版は`0.90.1`のまま。
- 全5構成で`npm test`のPython 22件とNode 31件が成功。CargoはWindowsが726成功・0失敗・3件ignored、ほか4構成が723成功・0失敗・4件ignored。OS固有の試験数を同一扱いしない。
- `sources.json`でSDK374ファイルを含む22件の固定記録と対応ソースZIP1,796ファイルが成功。SDK元ZIPのSHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`、frontend archiveは`97433be4f9573cc328ec3e943ce2de6267a84c5c84852f8283cbfb47d0683706`で、全5構成で一致。
- `stability.json`はGame Boy／NESを含む22 mode・604,032フレーム・88 Run／Stopが成功。`extra-stability.json`は既存の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否、両制限試験のStop後の予約予算0が成功。両runnerはexit code 0、`deviceOpened: false`。既存の混合構成はGame Boy／NES専用の組合せを追加したものではない。
- 検証レポート5組のJSONと取得ZIPのdigestを照合した。検証5件・インストーラー5件の計10アーティファクトは対象run／commitと一致し、有効期限内・非空だった。全5ジョブのドラフトリリース添付stepはskipped。
- 証拠は`/private/tmp/tetorica-gb-nes-ci-40168462256/`の`final-ci-summary.json`、`inspection-summary.json`、`test-log-summary.json`、`native-artifact-metadata.json`。CIの対応ソースZIPはmacOS／Linuxが`1fb6bf89c2a372abbad9190761b678ec611d944f12fabe7a0ac8f6ce8c7f0bec`、Windowsが`ac7cef894eff5ce76f14ebb25a47b3921b0068c6789840883c1e58674240d5ea`。各CIのソース照合は成功し、ハッシュ差の原因は断定しない。
- 取得したのは検証レポートZIPだけで、インストーラーや対応ソースZIPのダウンロード・起動・独立照合はしていない。OS間のPCM一致や各OSでのWASM比較、実機の音声出力・ノイズ・UI操作は別の確認。
- この結果記録は本体の3ファイルとTauriガイドだけ。コードを変更せず、完了したローカル試験は再実行していない。今回の記録更新のcommit／pushと、新しいタグ・releaseの作成は行っていない。

```sh
gh run view 40168462256 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### DX7移行 — 2026-10-25、ローカル検証

選択中／独立追加DX7の共通接続とMSFAを固定SDKへ切り替えた。接続cpp／headerとMSFA 30入力中29ファイルはbyte一致し、
Native-only `synth_unit.cc`のPanicで16個の事前確保noteへ初期状態を値代入する点だけが異なる。
SDKの374ファイル・版・取り込み記録、旧32件のsnapshot pin・ライセンスとBrowser／npmのWASMは変更していない。
詳細は[native_sdk_dx7_adoption_01.md](native_sdk_dx7_adoption_01.md)。

| 対象 | 固有Native入力数 | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| 選択中DX7の既存再生比較 | 114 | 792,576 | 114 | 792,576 |
| 独立追加DX7の既存比較 | 21 | 239,616 | 63 | 718,848 |
| 32 algorithm × 3 rateのPanic／再発音 | 96 | 786,432 | 96 | 786,432 |
| 合計 | 231 | 1,818,624 | 273 | 2,297,856 |

既存135入力の旧／SDK stdoutはbyte一致。新しいPanic比較はSDKと実WASMが全96入力で差0で、
旧版は79入力で再発音後だけに差があり、17入力は一致した。frame 1,403の再発音直前までは全入力が一致し、
最大差は`0.0002746583195403218`。全273比較のSDK／実WASM最大差は0だった。
追加側のblock分割3通りを固有Native入力へ加算せず、追加checker内の選択中再実行や既定経路の再確認・自己試験も集計へ加算していない。

旧／SDKのTauri既存fixture自己試験が成功。SDKの強化fixtureはrate境界、不正slot、保護slot／release tail、16音確保、live edit／voice identity、即時Panic無音と新規音源一致96／96が成功。
強化したPanicの新規音源一致判定は旧版で意図どおり失敗し、別に実行した旧版の制御試験は成功した。
本体＋16 noteの確保量35,320バイト、17通りの部分生成失敗の回収、render／制御中allocation／free 0、LFO／filter／resampler独立性、単一slot killも確認した。
private全状態やWASM内部状態を毎フレームdump比較したものではない。
公開JS adapterは44.1／48 kHzで確認し、96 kHzは実WASM exportsへ同じ整数位相変換を適用した比較。公開APIの96 kHz対応を追加したという意味ではない。

既定checker2本、inline fixture／out指定が成功し、不正12形式をコンパイル前に拒否。各fixtureのSDK32＋fixture側2の34入力のハッシュと、30組立入力の実読み込みを確認した。
実Cargo生成物も30入力がSDKとbyte一致し、32ソース入力の監視・14 archive object・10 C ABI exportの各1回の定義を確認。旧ヘッダー混入や新しい動的ライブラリー指示はない。
`npm test`はPython 22件・Node 31件成功、Rustは723成功・0失敗・4件ignored。TCP bindのため初めから制限外で実行し、sandbox内失敗はない。
22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源と受入れ／16台制限も成功。両制限試験のStop後予約予算は0、両runnerはexit code 0・`deviceOpened: false`。
このDX7ローカル検証の終了時点ではcommit／pushと新しいCIは未実施だった。後述のrun `40171879716`でSNES／SPCとまとめて確認した。
sanitizer、実機聴音やUI操作・速度保証は別の確認。
比較・ソース監査は`/private/tmp/tetorica-sdk-dx7-adoption/`の`parity-summary.json`、`source-audit.json`、`self-tests.json`、`build-assembly-audit.json`。
ホストログは`/private/tmp/tetorica-sdk-dx7-npm-test.log`と`/private/tmp/tetorica-sdk-dx7-cargo-test-unrestricted.log`。
再生／混合レポートは`/private/tmp/tetorica-sdk-dx7-stability.json`と`/private/tmp/tetorica-sdk-dx7-extra-stability.json`。

### SNES／SPC移行 — 2026-10-25、ローカル検証

選択中／独立追加SNES S-DSPと独立追加SPC700プレーヤーを固定SDK参照へ切り替えた。
28組のソース・ABI header・由来ファイルは旧コピーとbyte一致し、旧34件のsnapshot pinを保持した。
既存archiveの6翻訳単位と共有S-DSPの1回の定義を維持する。詳細は[native_sdk_snes_spc_adoption_01.md](native_sdk_snes_spc_adoption_01.md)。
macOS ARM64／Clang・Nodeで旧／SDKを別々にコンパイルし、全入力のstdout／stderrがbyte一致した。

| 対象 | 固有Native入力数 | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| SNES（選択中と追加生成の重複を除く） | 75 | 761,856 | 267 | 2,727,936 |
| 独立追加SPC | 84 | 688,128 | 252 | 2,064,384 |
| 合計 | 159 | 1,449,984 | 519 | 4,792,320 |

実配布WASM／Workletの最大差は0。選択中SNESの42入力は追加側75入力の部分集合で二重加算しない。
追加側の3通りのblock分割比較をNative入力へ加算せず、既定経路の再確認やfixture指定・自己試験も集計から除く。
実WASM SHA-256は`cbbe06819574249217f35da16eebd45a53274e53251f31242e7dd407b03d0d70`。
SNESの既存／SDK fixtureを旧／SDKで2種類の自己試験へ実行し、8回とも成功。152バイトstate ABI、ローカル確保量67,280バイト、コピーRAM・全体reset・境界・安定view、8声・保護gate、保持Stop・独立性と借用timelineのpause／完了／再開、render／制御allocation／free 0を確認。
SPCの28シナリオ×3 rateと、実WASMへの810 snapshot・358,056 DSP書込みを照合した。強化fixtureも旧／SDKで成功し、56バイトstate／16バイトevent ABI、ローカル確保量204,624バイト、コピーload・control側seek・pause・独立mute・観測／overflow・失敗／reload、render allocation／free 0を確認。
公開状態や限定された観測点の比較であり、毎フレームのprivate全状態のdump比較ではない。
3本の既定checkerとinline指定が成功し、不正18形式をコンパイル前に拒否。指定fixtureは保持し、SNES 10入力／SPC 15入力を依存列と実ファイルのSHA-256へ照合した。
実Cargo archiveは6 objectを保持し、35個のNative C ABI exportは各1回だけ定義された。6 CPPの依存preprocessでSDK側headerだけを解決し、SDK入力の監視を確認。旧sourceの全体監視を外し、個別のlicense／対応ソースresource監視を保持する。
`npm test`はPython 22件・Node 31件成功、Rustは723成功・0失敗・4件ignored。MCPのTCP bindのため初めから制限外で実行し、sandbox内失敗はない。
再生ライフサイクル22 mode・604,032フレーム・88 Run／Stopと、3混合構成・7単独音源、受入れ／16台制限で17台目拒否も成功。両制限試験のStop後予約予算は0、両runnerはexit code 0・`deviceOpened: false`。
証拠は`/private/tmp/tetorica-sdk-snes-spc-adoption/`の`source-audit.json`、`snes-parity-summary.json`、`spc-parity-summary.json`、`independent-checker-audit.json`、`build-audit.json`、`host-summary.json`。
ホストログは`/private/tmp/tetorica-sdk-snes-spc-npm-test.log`と`/private/tmp/tetorica-sdk-snes-spc-cargo-test-unrestricted.log`。
再生／混合レポートは`/private/tmp/tetorica-sdk-snes-spc-stability.json`と`/private/tmp/tetorica-sdk-snes-spc-extra-stability.json`。
直前の全5構成成功CI run `40168462256`はDX7も今回のSNES／SPC移行も含まない。
ローカル検証と対応ソースZIP照合後にcommit／pushし、次の5構成CIでも確認した。

### DX7／SNES／SPC移行後のGitHub Actions — 2026-10-25、全5構成成功

[Build Desktop — run 40171879716](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40171879716)をmainへ手動実行した。
attempt 1、2026-10-25 07:12:01 UTC開始、07:26:29 UTC完了。対象は`8b9e922ad6e9c1f8d33cf5719b05330b58311944`。
本体の基準は`8898a75fc4424aca11596d8cd7fb6046d1c3b585`。dispatch前に両作業ツリーがcleanでremote mainと一致し、SDKもcleanと確認した。
runは`completed`／`success`で、Windows x86_64、Linux x86_64／ARM64、macOS x86_64／ARM64の全5構成の検証・インストーラービルドとアップロードが成功した。
CIのための製品・試験修正は不要だった。
全5構成のログでPython 22件・Node 31件成功。Rust全試験はmacOS／Linuxが723成功・0失敗・4件ignored、Windowsが726成功・0失敗・3件ignoredだった。

- 全5構成でSDK374ファイルを含む22件の固定記録と対応ソースZIP全1,796ファイルの照合成功。
- 各構成の22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源と受入れ／16台制限が成功。17台目を拒否し、受入れ・台数制限の両方でStop後の予約予算は0、両runnerはexit code 0・`deviceOpened: false`。
- 5検証レポートZIPのdigest／サイズをGitHub metadataへ照合。検証5組とインストーラー5組の計10成果物は対象run／commitと一致し、有効期限内・非空だった。
- 全5ジョブのドラフトリリース添付stepはskipped。アプリ版`0.90.1`のままで、新しいタグ・ドラフトリリース・一般公開は作成していない。

CIの対応ソースZIP SHA-256はmacOS／Linuxが`39cd14b113557665c039d0af3960839ed566c7ad2fdc49286859d8b5c53fa684`、Windowsが`f3ac24c3a08277ebcdf3651dce8f2620ebae6dc05bc149fac4de48cb89fb19e3`。
各CI内の照合は成功し、ハッシュ差の原因は断定しない。証拠は`/private/tmp/tetorica-dx7-snes-spc-ci-40171879716/`の`final-ci-summary.json`、`jobs-audit.json`、`inspection-summary.json`、`test-log-summary.json`、`artifact-metadata.json`、`native-artifact-metadata.json`。
先行run `40168462256`はDX7もSNES／SPC移行も含まない。今回のCIと、ローカルDX7 273比較／SNES・SPC 519比較を区別する。
取得したのは検証レポートのみで、インストーラー／対応ソースZIP自体の取得・独立照合・起動、各OSのWASM比較、OS間PCM一致、実機聴音・UI操作は未確認。
CI開始後の変更は結果記録だけで、製品・試験入力は同じ。完了済みのローカル試験は再実行していない。

### Nuked YM2612移行 — 2026-10-25

通常の22音源IDに加えて、Genesis Nuked／32X Nukedと独立追加YM2612のNukedエンジンを固定SDKへ切り替える。
SDK `0.1.1`の単体ターゲットを追加するが、Tauriは既存の2 archiveとconsumer → adapter → provider順を維持する。
全8 OPN2 exportのprefix、初回のglobal chip type選択、選択中音源の自然なDC・PSG混合・gain／ramp、
独立エンジンの6CHと通常CH3／CSM取消し・Stop／reset、Rustの所有・予約・Mixer／FXを保持する。
接続cppはinclude位置だけが異なり、`.inc`・共通state header・C wrapper・コア・LICENSE等7組はbyte一致。
旧9 pin・由来・LGPLライセンスは保持し、syncスクリプトだけで実際のSDK入力が変わらないことを再ビルド手順にも記す。
選択中222入力・1,363,968フレームと追加198入力・1,216,512フレームの旧／SDK stdoutはbyte一致。
API profileを区別した合計420入力・2,580,480フレームを実配布WASMへ比較し、独立追加は差0、
選択中は既存のFloat32 ramp差`2.9802322387695312e-8`を保持する。共有する符号化命令列39件は同じAPI入力ではない。
旧／SDKのfixture自己試験でStop／再発音・6CH・公開状態とcallback allocation／free 0、
各providerの8 exportの各1回の定義と非prefix定義0を確認した。
SDK `0.1.1`・元コミット`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`の379ファイルを取り込み、配布ZIP SHA-256
`939fb035aef36c84cac3d1e058271ca3ddfc6ebd9ce5cfa4b3d04bc92876416b`とmanifestを照合した。
SDKのソースZIPを独立展開した全24 CTest・18 WAV exampleとJavaScript参照10試験は成功。
Tauriの`npm test`もPython 22件・Node 31件成功。ツール試験はSDK最終取り込み前の実行で、合成fixtureを使いreceiptに依存しない。
2本の既定checkerは初回取り込み後のSDK入力から成功し、選択中12入力／追加8入力のハッシュと不正12形式の拒否を確認した。
その後比較ツールにもSDKのLinux監査用shimを使い、記録対象は13／9入力になった。両既定checkerの同じ222／198ケース・自己試験も再実行して成功。再実行は合計420ケースへ加算しない。
実Cargoの2 archive各1 objectはSDK接続cpp／コアCから生成された。10 raw C ABI・16独立C ABI・8 prefix済みexportは各1定義、非prefix定義0。
6音源入力のSDK解決、実入力監視と旧ソース監視の除去、既存リンク順序も確認した。
Rust全試験は723成功・0失敗・明示実行用4件ignored。MCPのローカルTCP bindのため初めから制限外で実行し、sandbox内の失敗はない。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stopが成功した。
既存の追加音源3混合構成・7単独音源、受入れ／16台制限と17台目拒否も成功し、両制限試験のStop後予約予算は0へ戻った。
再生／混合runnerはともにexit code 0、`deviceOpened: false`。
この既存混合表に独立追加Nukedは含まれず、Nukedは別のPCM比較・同時リンクfixture・Rust試験と選択中modeの再生試験で確認した。
これらのホスト試験はSDK `60f06e629395b65f1777e7e28c80be9eefca2381`／378ファイルの初回取り込み後に実行した。
初回取り込みから最終配布への差は`RELEASE-MANIFEST.json`、`docs/verification.md`、`native/CMakeLists.txt`と新しい試験用`native/tests/nuked_audit.cpp`の4ファイルだけだった。
実際にTauriが使うコア・接続入力の全バイト列が一致することを`final-import-audit.json`で確認したため、完了済みのホスト試験を再実行していない。
最終ソースZIPを独立展開した全24 CTest・18 WAV exampleとJavaScript参照10試験は改めて成功し、検証scriptのexit codeは0だった。
SDKの初回CI run `40174420834`はLinux 2構成で試験専用のallocation macroと標準ヘッダーのinclude順によりコンパイル失敗。
SDKの監査用shimで標準ヘッダーを先に読む形へ修正済みで、製品音源・接続は変更していない。
修正コミット`e4b7d7e...`のSDK CI run `40175263453`は全6ジョブ成功。Native 5構成それぞれで19ライブラリー・24 CTest・18 WAV exampleが成功し、診断ZIP 5個のdigestも照合した。
移行を本体`02b2e3ad...`、Tauri`367fd7a...`へcommit／push後、両作業ツリーがcleanでremote mainと一致することを確認し、Tauri CI run `40175615215`を手動実行した。attempt 1、対象`367fd7a851ffadd3a01c3cfb985972112156ca63`で全5構成の検証・インストーラービルド／アップロードが成功。
全構成でPython 22件・Node 31件成功。CargoはWindows 726成功／3 ignored、ほか4構成723成功／4 ignored。検証JSONでSDK379／22固定記録／ZIP1,801、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源・受入れ／16台制限・Stop後予算0も成功。両runnerはexit code 0、`deviceOpened: false`。
取得した検証ZIP 5個のGitHub digestと、計10アーティファクトのrun／commit一致・非空・有効期限内を確認した。ドラフトリリース添付は全5構成skipped。
CI内のソースZIP SHAはWindows`013f72711887d4cc9cfa7b0901fce422f1ee2f54a164ea72be920b35470456b4`、ほか4構成`1a56f72f99db7f09e71c6bbc588d5430823bd9ae408780f5965cdfc2b295420c`。内容照合は全構成成功し、ハッシュ差の原因は断定しない。
SDK CI証拠は`sdk-ci/summary.json`、Tauri証拠は`tauri-ci/final-ci-summary.json`ほか。後者のSHAは`df46e7fc4764bdb243f46a9e5970b193d87653dc0de8ec159d832640093c415b`。
TauriのCI対象からの差分は結果記録ガイドだけ。本体比較ツールはSDK監査shimへ揃えて同じケースを再検証した。インストーラーの取得・起動、実機聴音・UI操作は別の確認で、新しいタグやreleaseは作成していない。
証拠は`/private/tmp/tetorica-sdk-nuked-adoption/`。毎frameのprivate全状態・各OSでのWASM比較・実機聴音は別の確認。

### 再開手順

Nuked移行のCI前チェックポイントでは、対応ソースZIP全1,801ファイルのSHA-256は
`1a56f72f99db7f09e71c6bbc588d5430823bd9ae408780f5965cdfc2b295420c`。
全22件の固定記録・SDK379ファイル・ZIPの照合結果は`/private/tmp/tetorica-sdk-nuked-adoption/sources.json`。
CI結果記録後の最終ZIPも全1,801ファイルを照合し、SHA-256は
`0413ecb4f5c9fe8f96a4b6a87ac46bd244a32c393af05e819363cbae9fc9c720`。
CI入力との差はTauriガイド1ファイルのみで、結果は同ディレクトリの`local-final-sources.json`と`final-doc-source-audit.json`へ保存した。
文書変更だけなので完了済みの製品試験は再実行していない。

まず現在の差分とHEADを確認する。保存時点のHEADへ無条件に巻き戻さない。

```sh
cd /Users/kyorohiro/development8/wfm/hello_ymfm
git status --short
git -C w/tetorica-soundchip-native status --short
git -C w/tetorica-soundchip-native log -1 --oneline
git -C w/tetorica-fm2612-playground-tauri status --short
git -C w/tetorica-fm2612-playground-tauri log -1 --oneline
```

Tauriで同梱SDKと配布ソースを確認する。

```sh
cd /Users/kyorohiro/development8/wfm/hello_ymfm/w/tetorica-fm2612-playground-tauri
python3 scripts/import_soundchip_sdk.py --check
python3 scripts/prepare_native_sources.py
python3 scripts/check_native_sources.py --bundle --out=native-validation/sources.json
```

コードを変更した場合の通常の検証手順は次のとおり。変更していなければ、完了済みの重い試験をやり直す必要はない。

```sh
npm test
cargo test --locked --offline --manifest-path src-tauri/Cargo.toml
node scripts/check_native_stability.mjs --out=native-validation/stability.json
node scripts/check_native_extra_stability.mjs --out=native-validation/extra-stability.json
```

`--offline`は依存キャッシュがある環境向け。別PC／fresh checkoutでは、
先にNATIVE-SOURCES.mdに従ってNode／Rust／C++環境とロック済み依存、音声sidecarを準備する。
SDK自体をリモートから自動取得する設計には戻さない。

### 完了した作業 — 本体YM2612 WASMの固定SDK参照

[ビルドスクリプト](../../scripts/build_ym2612_wasm.sh)は完全同梱したSDK `0.1.1`／
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`のWASM用レシピを使う。
Native用wrapperへの置換ではなく、既存と同じWASM ABI・同期JS APIを維持した移行。
全379ファイルをmanifestと取り込み記録でoffline検証し、通常ビルドでリモート取得は行わない。
改変検出・分離したfresh copyからの入力解決と出力先も試験した。

旧レシピの再ビルド／配布済みWASMとSDK版の2比較が各444ケースで差0。
状態の継続、内部envelope、全6CH、timer/IRQ、DAC、block分割も一致した。
Chromium／WebKitの実Workletと隔離したnpm配布物・型も検証済み。
SDKとコンパイラー・入力／出力hashは[移行記録](wasm_sdk_ym2612_adoption_01.md)とそのJSON、
`docs/generated/build-info.json`に記録した。

この節はYM2612移行時の記録。続けて実施したYM2203移行は次の節に記載する。
JS adapterのパッケージ分離・公開API再設計、高速レジスタ演奏は扱っていない。

### 完了した作業 — YM2203 WASMの固定SDK参照

`scripts/build_ym2203_wasm.sh`も同梱SDK `0.1.1`のWASM用レシピを使う。
固定SDK原本379ファイルと取り込み記録は変更せず、必須入力の検査とビルド経路の試験を拡張した。
通常出力先での実ビルドが比較用SDK出力とbyte一致し、既存YM2612の生成記録・出力も維持した。

旧レシピ再ビルド／配布済みWASMとSDKの2比較は、各432ケース・9,770,400出力ステレオフレームで差0。
FM／SSG、プリスケーラー、timer／IRQ、mute、状態復元、既存Engineのリサンプリングを含む。
Python23件、既存OPN／YM2203試験34件、Chromium／WebKit計4経路、隔離npm配布物と型も成功。
校正記録の再測定は不要で、Mixer値・公開API・モノラル左右同値の出力は維持した。
詳細と入力／出力hashは[YM2203移行記録](wasm_sdk_ym2203_adoption_01.md)とそのJSONを参照する。

この節はYM2203移行時の記録。続けて実施したYM2608移行は次の節に記載する。

### 完了した作業 — YM2608 WASMの固定SDK参照

`scripts/build_ym2608_wasm.sh`も同梱SDK `0.1.1`のWASM用レシピを使う。
固定379ファイルと取り込み記録は変更せず、共有検査・ビルド経路試験を拡張した。
生成物と共有build-infoを更新し、先行するYM2612／YM2203の記録と出力を保持した。

旧再ビルド／配布済みWASMとSDKの2比較は各586ケース・7,264,744出力ステレオフレームで差0。
FM／SSG／リズム／ADPCM、2MiB RAM転送／clear、22設定での保存状態継続を含む。
Python27件、既存OPN／YM2608試験38件、両Browser計4経路、隔離npm配布物と型も成功。
影響する校正を04として実際に測定し直し、旧03と全数値が一致した。Mixer値・APIは維持する。
詳細と入力／出力hashは[YM2608移行記録](wasm_sdk_ym2608_adoption_01.md)とそのJSONを参照する。

この節はYM2608移行時の記録。続くYM2610／YM2610B移行は次の節に記載する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM2610／YM2610B WASMの固定SDK参照

`scripts/build_ym2610b_wasm.sh`も同梱SDK `0.1.1`の共有WASMレシピを使う。
固定379ファイルと取り込み記録は変更せず、4CH／6CHのvariant選択と既存ABIを維持する。
通常出力と比較用SDK出力はbyte一致し、先行3音源の生成記録・出力も保持した。

FM／SSG／ADPCM-A／Bと独立ROM、状態復元・既存Engineを旧再ビルド／配布済み版の両方と比較した。
各1,108比較・14,063,856出力ステレオフレームで差0。重点36設定のown／cross／resetを各72回確認した。
A全6声とBの終了フラグ・再発音、B repeatの末尾折返しも別枠で確認した。
Python31件、既存OPN／YM2610試験40件、両Browser計8経路、隔離npm配布物・型・Analyzer ZIPは成功。
旧配布版でも失敗するCLI比較試験のMixer適用漏れも、試験側だけを直して比較条件を揃えた。
影響する校正hash参照はなく、再測定・Mixer値・公開APIの変更は不要だった。
詳細と最終比較結果・hashは[YM2610／YM2610B移行記録](wasm_sdk_ym2610b_adoption_01.md)とそのJSONを参照する。

これで通常OPN系5種類／4 artifactのWASMビルドが固定SDK参照になった。
この節はYM2610／YM2610B移行時の記録。続くYM2151／YM2164移行は次の節に記載する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM2151／YM2164 WASMの固定SDK参照

`scripts/build_ym2151_wasm.sh`も同梱SDK `0.1.1`の共有WASMレシピを使う。
固定379ファイルと取り込み記録は変更せず、OPM／OPPのvariant選択と既存ABI・ビルド条件を維持する。
通常出力と比較用SDK出力はbyte一致し、先行4音源の生成記録・出力も保持した。

旧再ビルド／配布済み版との各1,408比較・17,640,320出力ステレオフレームで差0。
重点32設定でown／cross／resetを各64回確認し、LFO4波形・noise全32periodとTimer BのOPP倍周期も検証した。
Python35件、既存YM2151／Synth／state／Playground・MSX複合試験53件、両Browser計4経路と音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。
影響する校正hash参照はなく、再測定・Mixer値・公開APIの変更は不要だった。
詳細と最終比較結果・hashは[YM2151／YM2164移行記録](wasm_sdk_ym2151_adoption_01.md)とそのJSONを参照する。

これで通常OPN用4 artifactとOPM／OPP用1 artifactのWASMビルドが固定SDK参照になった。
この節はYM2151／YM2164移行時の記録。続くOKIM6258移行は次の節に記載する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — OKIM6258 WASMの固定SDK参照

`scripts/build_okim6258_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録を保持し、旧配布版・旧再ビルド・SDKの生成JS／WASMがすべてbyte一致した。
先行5音源の生成記録・出力を保持し、API・Mixer値も維持する。

旧再ビルド／配布済み版との各2,048比較・23,949,880出力ステレオフレームで差0。
重点34設定でown68回（raw48／公開20）・cross68回・reset68回を確認した。
FIFO・部分nibble・clock／divider・pan・10／12-bit clampも検証した。
Python39件、既存OKI／Synth／state／Playground・VGM試験52件、両Browser計4経路とPCM音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
SDK個別catalogにchip_state.hの列挙漏れがあり、全379検証と実依存hash・改変拒否試験で補足した。SDK原本は変更していない。
詳細と比較結果・hashは[OKIM6258移行記録](wasm_sdk_okim6258_adoption_01.md)とそのJSONを参照する。

これで通常OPN用4 artifact、OPM／OPP用1、OKIM6258用1の計6 artifactが固定SDK参照になった。
この節はOKIM6258移行時の記録。続くYM2413移行は次の節に記載する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM2413 WASMの固定SDK参照

`scripts/build_ym2413_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行6音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。
既存WASM／JSにはsnapshot機能がないため、reset再生成／raw reset／再演奏／seekを区別して比較した。

旧再ビルド／配布済み版との各1,284比較・16,133,748出力ステレオフレームで差0。
重点54設定のpublic reset／再演奏108回と、実VgmPlayerの9構成×6seekを確認した。状態bytes比較は行っていない。
Python43件、既存YM2413／Synth／Inspector・MSX描画／OPM混合試験37件、両Browser計8経路とMaster System音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。
校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[YM2413移行記録](wasm_sdk_ym2413_adoption_01.md)とそのJSONを参照する。

この節はYM2413移行時の記録。続くYM3526移行は次の節に記載する。
前回のOKIM6258 catalogのchip_state.h追記はSDK更新時の候補として保持する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM3526 WASMの固定SDK参照

`scripts/build_ym3526_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行7音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。OPL1のsineのみという既存仕様も維持する。
既存snapshot機能はないため、raw／public reset・再演奏・seekを比較した。

旧再ビルド／配布済み版との各1,494比較・18,759,234出力ステレオフレームで差0。
重点75設定のpublic reset／再演奏150回と、実VgmPlayerの9構成×6seekを確認した。
全9CH・5打楽器、timer A/B・IRQ・masked CSM単独発音、OPL2波形registerの無効動作も確認した。
Python47件、既存OPL／Synth／Inspector／VGM試験81件、両Browser計4経路とYM3526音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[YM3526移行記録](wasm_sdk_ym3526_adoption_01.md)とそのJSONを参照する。

この節はYM3526移行時の記録。続くYM3812移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM3812 WASMの固定SDK参照

`scripts/build_ym3812_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行8音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。OPL2の4波形とregister `0x01` bit5のgateも維持する。
既存snapshot機能はないため、raw／public reset・再演奏・seekを比較した。

旧再ビルド／配布済み版との各1,848比較・23,074,584出力ステレオフレームで差0。
重点84設定のpublic reset／再演奏168回と、実VgmPlayerの9構成×6seekを確認した。
全9CH・5打楽器、波形gate無効中の編集保持、timer A/B・IRQ・masked CSM単独発音も確認した。
Python51件、既存OPL／Synth／Inspector／VGM試験81件、両Browser計4経路とYM3812音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[YM3812移行記録](wasm_sdk_ym3812_adoption_01.md)とそのJSONを参照する。

この節はYM3812移行時の記録。続くYMF262移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YMF262 WASMの固定SDK参照

`scripts/build_ymf262_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行9音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。同期IntoとAudioEngineのscratch再利用も維持する。
既存snapshot機能はないため、raw／public reset・再演奏・seekを比較した。

旧再ビルド／配布済み版との各3,456比較・44,658,756出力ステレオフレームで差0。
重点162設定のpublic reset／再演奏324回と、実VgmPlayerの9構成×6seekを確認した。
全18CH・6組の4OP・8波形・4busのstereo合算／clamp、NEW切替、5打楽器、timer／IRQとCSM無効の既存仕様も確認した。
Python55件、既存OPL／Synth／Inspector／VGM試験81件、両Browser計4経路とYMF262音色／4OP stereo／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[YMF262移行記録](wasm_sdk_ymf262_adoption_01.md)とそのJSONを参照する。

この節はYMF262移行時の記録。続くY8950移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — Y8950 WASMの固定SDK参照

`scripts/build_y8950_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行10音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。snapshot／Into APIは追加していない。

旧再ビルド／配布済み版との各1,794比較・22,833,498出力ステレオフレームで差0。
重点171設定のpublic reset／再演奏342回と、実VgmPlayerの9構成×6seek・0x88データブロックを確認した。
9CH OPL1 FM・5打楽器・ADPCM、2MiB境界、CPU writeとJS uploadミラーの違い、raw／public resetも比較した。
既存read_dataの09／1A割当は外部RAMのreadbackへ届かないため、その機能を追加・検証したとは扱わない。
Python59件、既存OPL／ADPCM／Inspector／VGM／MSX試験126件、FM Worklet4経路とFM UI両Browserが成功。
ADPCMも両Browserのprimary／追加音源でPCM・Stop・Sample Editor／Keyboardが成功した（Web Audio／mainのみ）。
Y8950 WAV比較試験の手組み参照側に校正Mixerが抜けていた既存問題を、配布済みWASMで再現後に試験だけ修正した。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[Y8950移行記録](wasm_sdk_y8950_adoption_01.md)とそのJSONを参照する。

この節はY8950移行時の記録。続くAY-3-8910／YM2149移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — AY-3-8910／YM2149 WASMの固定SDK参照

`scripts/build_ay8910_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、公開APIとMixer値を保持し、先行11音源の記録・22生成物も維持した。
AYのC++17・10個の公開C export・EXPORT_ALLなしを保持する。
配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各8,208比較・37,468,404出力ステレオフレームで差0。
6つの対応type／flag、3CH tone・noise・全16 envelope shape、register latch／実効mask、mute位相とresetを確認した。
54構成の実VgmPlayerと各6地点のseek、重点reset／再演奏1,260回も成功。snapshot APIは追加していない。
Python63件と既存AY／MSX試験45件、両Browserの6 Worklet経路、MSX／AY音色・Keyboard UIを検証済み。
隔離npm配布物と型、Analyzer ZIPも成功。出力bytesと校正hashが変わらず、再測定や音量変更は不要だった。
詳細と最終比較結果・hashは[AY移行記録](wasm_sdk_ay8910_adoption_01.md)とそのJSONを参照する。

この節はAY移行時の記録。続くSega PSG移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — Sega PSG WASMの固定SDK参照

`scripts/build_segapsg_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、公開APIとMixer値を保持し、先行12音源の記録・24生成物も維持した。
PSGのC++14／O2・ASSERTIONS／EXPORT_ALL・12個の公開C exportを保持する。
配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各7,074比較・32,864,256出力ステレオフレームで差0。
3CH tone・noise・byte latch、全256 Game Gear stereo mask、mute位相と40byte状態を比較した。
public同一instance復元414回・raw状態の相互復元324回・reset／再演奏432回も成功。
実GenesisAudioEngineのFM＋PSG継続と、実VgmPlayerの状態／checkpoint／seekを確認した。
既存VGM parserが0x4fをskipする仕様は保持し、直接APIのGame Gear stereo検証と区別する。
Python67件と既存PSG／Genesis試験52件、両Browserの10 Worklet経路、SMS／GGのKeyboard UIを検証済み。
隔離npm配布物と型、Analyzer ZIPも成功。出力bytesと校正hashが変わらず、再測定や音量変更は不要だった。
詳細と最終比較結果・hashは[PSG移行記録](wasm_sdk_segapsg_adoption_01.md)とそのJSONを参照する。

この節はSega PSG移行時の記録。続くRF5C164移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — RF5C164 WASMの固定SDK参照

`scripts/build_rf5c164_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、公開APIとMixer値を保持し、先行13音源の記録・26生成物も維持した。
C++14／O2・ASSERTIONS／EXPORT_ALL・16 C exportとHEAPU8を維持する。
配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各828比較でPCM・bus読出し・RAMを含むstate差0。
8 voice、sign-magnitude・loop marker・左右pan、64 KiB境界と16 window bankのORを確認した。
chipのresetはRAMを保持し、GenesisAudioEngineのresetは追加でRAMをclearする既存の違いを維持する。
public同一instance復元234回・raw状態の相互復元144回・reset／再演奏342回も成功。
実GenesisAudioEngineの混合と、実VgmPlayerのRAM転送／checkpoint／seekを確認した。
Python71件・既存RF／Mega CD試験53件、両Browserの主PCM／追加RFの4 Worklet経路が成功。
元のMega CD exampleとサンプラーのファイル入力・mock mic・8 voice Keyboard／Stopも、両Browserのmainで確認した。
隔離npm配布物と型、Analyzer ZIPも成功。出力bytesと校正hashが変わらず、再測定や音量変更は不要だった。
詳細と最終結果・hashは[RF移行記録](wasm_sdk_rf5c164_adoption_01.md)とそのJSONを参照する。
個別catalogのchip_state.h列挙漏れは固定SDKに残し、全manifest検証と改変拒否試験で保護する。

この節はRF5C164移行時の記録。続く32X PWM移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — 32X PWM WASMの固定SDK参照

`scripts/build_pwm32x_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルとpin、公開API／Mixer値を保持し、先行14音源の記録・28生成物も維持した。
C++14／O2・ffp-contract=off・23 C exportとU8/U16/F32を維持する。
配布済み・旧手順再ビルド・SDK・docs・webのJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各864比較・2,607,960主比較フレームで差0。
16 routing・FIFO／timer／DAC／duty、own状態復元336回・raw相互復元216回・reset／再演奏312回を確認した。
raw Stateは72byte構造体でpadding／未使用slotを含むため、有効fieldとPCMを比較する。portable stateとは扱わない。
clock／rate／gain／mode／muteはsnapshot外。標準GenesisAudioEngineのSimplePwm defaultは維持する。
Python75件・既存PWM／Genesis試験は最終51件、両Browserの実Worklet4経路とpackage runtimeが成功した。
WAV比較の手組み参照に校正Mixerが抜けていた既存試験だけを修正し、音源とMixer値は変更していない。
配布sourceはmain shimへの依存を除き、pin検証済みSDKのstandalone recipeと7入力を同梱する。
source単体の実buildとJS／WASM一致、改変拒否、最終npm／Analyzer ZIPの収録も確認済み。
詳細と最終結果・hashは[PWM移行記録](wasm_sdk_pwm32x_adoption_01.md)とそのJSONを参照する。

この節は32X PWM移行時の記録。続くHuC6280移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — HuC6280 WASMの固定SDK参照

`scripts/build_huc6280_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルとpin、公開API／Mixer値を保持し、先行15音源の記録・30生成物も維持した。
C++14／O2・EXPORT_ALL・8 C exportとcwrap／F32を維持する。
配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各828比較・1,650,420主比較フレームで差0。
6CH・wave RAM・DDA・noise・LFO、host mute／低clock時の保持sampleとowned出力を確認した。
snapshotはなく、reset／再演奏252回と実VgmPlayerのB9／DDA stream・先頭からのseekを比較した。
両Browserで主／追加Workletの計4経路と6CH voice UI・波形編集・Guitar／PC Keyboard・Stopが成功した。
Python79件・既存HuC6280関連試験63件とnpm／Analyzer ZIPの検証が成功した。
詳細と最終結果・hashは[HuC6280移行記録](wasm_sdk_huc6280_adoption_01.md)とそのJSONを参照する。

この節はHuC6280移行時の記録。続くGame Boy移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — Game Boy APU WASMの固定SDK参照

`scripts/build_gameboy_apu_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルとpin、公開API／Mixer値を保持し、先行16音源の記録・32生成物も維持した。
C++17／O2・11 C exportとcwrap／F32を維持する。core headerはNative用friend宣言だけがSDK側に追加され、DSPと生成物には差がない。
配布済みdocs・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済みdocsとの各876比較・2,437,980主比較フレームで差0。
own復元192回・trusted raw相互復元132回・reset／再演奏276回を確認した。
Stateは同一buildの312byte objectコピーで、padding全体の一致ではなくheaderとPCM続行を比較する。
直接Web用だけ旧state非対応pairが残っていたため、共通APIの270比較・1,158,300フレームで差0を確認後、2生成物をSDK版へ同期した。
Python83件・既存Game Boy関連79件とnpm／Analyzer ZIPの検証が成功した。
両Browserで主／追加Workletの4経路と、既存editor／Keyboard試験を絞った4 voice・対象切替・release／Stopが成功した。
詳細と最終結果・hashは[Game Boy移行記録](wasm_sdk_gameboy_adoption_01.md)とそのJSONを参照する。

この節はGame Boy移行時の記録。続くNES APU／FDS移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — NES APU／FDS WASMの固定SDK参照

`scripts/build_nesapu_wasm.sh`もSDK `0.1.1`のWASMレシピを使う。
固定379ファイルとpin、公開API／Mixer値を保持し、先行17音源の記録・34生成物も維持した。
C++17／例外・FP設定、18 C exportとloader／runtime各5項目を維持する。
配布済みdocs・旧再ビルド・SDK・通常出力・webのJS／WASMはすべてbyte一致した。

各912比較・2,354,100主比較フレームで差0。reset／再演奏276回と31項目のcontrol直後／終端観測・RAMを確認した。
400byte getStateは観測ABIで保存状態ではなく、WASM Player adapter／checkpointは追加していない。既存Analyzer／PlayerのJS referenceは維持する。
配布用ソースはSDK10入力を検証後に出力し、standalone recipeの2 vendor pathだけを既存third_party配置へ移す。
source単体buildと生成物一致、core／recipe／manifestの改変拒否、npm／Analyzer ZIPの収録も確認した。
Python87件・既存NES関連77件、両Browserの主／追加Worklet4経路・全6CH Keyboard／Operators／DMC／FDS／Stopが成功した。
詳細とhashは[NES移行記録](wasm_sdk_nesapu_adoption_01.md)とそのJSONを参照する。

この節はNES APU／FDS移行時の記録。続くSNES／SPC移行は次の節に記載する。


### 完了した作業 — SNES／SPC WASMの固定SDK参照

`scripts/build_spc_wasm.sh`もSDK `0.1.1`の`spc`ターゲットを使う。
着手時の本体は`ef783f2099a97cd8faed4ec5f1cf90efbd103059`でclean。固定379ファイルとpin、先行18生成記録・36出力を保持した。
C++14／O2・ASSERTIONS・accurate S-DSP、33 C export・runtime 3項目・Perl cleanupを維持する。
旧配布／旧再ビルドとSDKでWASM bytesは異なるが、SDKレシピのvendor path5箇所だけを旧配置へ移したsource単体buildで旧bytesを再現した。
旧再ビルド・配布済み・配布ソース単体の3組は、SDKとの各40シナリオ・80ケースでPCM／RAM／DSP／nativeFrames・trace／timeline差0。
各組の受渡し済み出力は両build計1,017,898ステレオフレーム、native位置の増分は1,017,766。解析用snapshotを保存状態とは扱わない。
配布source helperは26入力を全検証してから出力し、standalone recipeだけ5パスを移す。LGPL／由来・変更記録を保持する。
Python91件・既存SPC／SNES222件、FM npm・VGM npmの隔離offline検証とAnalyzer ZIPが成功した。
主／追加SNESの4 Worklet校正経路、SNES Mainの両browser、SPCファイル再生の両browser×2 output rateも成功した。
ただしWebKitの初期化中closeは2回失敗し、AbortError・nodeなしでもAudioContextがrunningのままだった。Chromiumは成功。
旧WASMのclose単独は成功したが、同じ再生順序を含む旧版試験は先に無音判定で停止し、移行との因果は未確定。
Browser全体の成功とは扱わず、元の試験・runtimeを保持して証拠と切り分け手順を残した。
詳細は[SNES／SPC移行](wasm_sdk_spc_adoption_01.md)と[検証JSON](wasm_sdk_spc_adoption_01.json)。証拠は`/private/tmp/tetorica-spc-wasm-sdk/`。

WebKit closeは、既存試験の再生→close順序・AudioContext所有／resume／closeと一時mute harnessの切り分けが必要。
SDK原本とTauri、Mixer数値は変更していない。commit／push・公開・remote CIは実施していない。
この節はSPC移行時の記録。続くSega PCM移行は次の節に記載する。


### 完了した作業 — Sega PCM WASMの固定SDK参照

`scripts/build_segapcm_wasm.sh`もSDK `0.1.1`の`segapcm`ターゲットを使う。
着手時の本体は`95edc7a8b11190c95a78694f3a887c8c47557e81`でclean。固定379ファイルとpin、先行19生成記録を保持した。
C++17／O2、13 C export・runtime 3項目・wasmBinary・Perl cleanupを維持し、公開APIは変更していない。
配布済み・旧再ビルド・SDK・通常docs・直接webのJS／WASMはすべてbyte一致した。
旧再ビルド／配布済みとの2組は各612比較（chip522＋Engine90）・5,204,966生成ステレオフレームでPCM／全state bytes／ROM差0。
16 voice、bank／loop／ROM転送、mute／reset・owned PCM、252 own＋252 raw相互復元、486再演奏と続行probeを確認した。
公開state tokenは同一インスタンス・build用。Engineの保存facadeはなく、実Player seekは先頭からの再演奏を比較した。
既存の手組みWAV参照に校正Mixerが抜けていたため、旧配布版でも失敗を再現した後、試験だけ既存Mixerを適用して修正した。
Python95件・既存Node71件、旧配布版の修正後比較2件、Checker CLIの46実行が成功した。
AnalyzerのChromium／WebKitでbank0／bank1／PSG混合とMixerを確認し、最初の音声接続前から最終zero gainを使った。
FM npmとAnalyzer ZIPも検証し、Sega PCM資産・noticeの一致を確認した。校正66 source hash・generator checksも成功した。
Analyzer gain0.261709・npmのgeneric unityを保持し、Playgroundの対応modeや音量調整は追加していない。
詳細は[Sega PCM移行](wasm_sdk_segapcm_adoption_01.md)と[検証JSON](wasm_sdk_segapcm_adoption_01.json)。証拠は`/private/tmp/tetorica-segapcm-wasm-sdk/`。

SPCのWebKit初期化中closeは引き続き未解決。今回のSega PCM Browser成功と混同しない。
SDK原本とTauri、Mixer数値は変更していない。commit／push・公開・remote CIは実施していない。
この節はSega PCM移行時の記録。続くK051649移行は次の節に記載する。


### 完了した作業 — K051649（SCC）WASMの固定SDK参照

`scripts/build_k051649_wasm.sh`もSDK `0.1.1`の`k051649`ターゲットを使う。
着手時の本体は`289dac7dd684046d3f7c39aecb69813c8444386b`でclean。固定379ファイルとpin、先行20生成記録を保持した。
freeze時にはimporter／試験編集が始まっていたため別statusを残し、旧レシピ・出力・pin・SavePointの56入力を基準commitへ直接照合した。
C++17／O2、9 C export・runtime 2項目・wasmBinaryを維持し、ASSERTIONS／EXPORT_ALL／Perl cleanupは追加していない。
配布済み・旧再ビルド・SDK・通常docs・直接webのJS／WASMはすべてbyte一致した。
旧再ビルド／配布済みの2組は各774比較（chip684＋Engine90）・6,568,338生成ステレオフレームでPCM／続行probe差0。
5 voice、SCC共有／SCC+独立wave、frequency／volume／key／test、mute／reset・owned PCMと各360再演奏を確認した。
chipのstate／read APIはなく、内部状態serializeは追加していない。実MSX Playerのseekは先頭からの再演奏で比較した。
Python99件・既存Node47件、Checker CLIの53実行が成功した。
AnalyzerのChromium／WebKitでSCC単独／SCC+／AY＋OPLL＋Y8950＋SCC混合、子音源の合計・Mixerを確認した。
最初の音声接続前から最終zero Gainを使い、合成は主スレッド・Workletは出力transport。初回の一時harness接続カウンターの失敗も記録した。
FM npm・実install済みSCC／MSX entryとAnalyzer ZIPを検証し、資産・BSD noticeの計21項目の一致を確認した。
校正66 source hash・generator checksも成功し、Analyzer gain1.103844・npm generic unityを保持する。Playground SCC modeは追加していない。
詳細は[K051649移行](wasm_sdk_k051649_adoption_01.md)と[検証JSON](wasm_sdk_k051649_adoption_01.json)。証拠は`/private/tmp/tetorica-k051649-wasm-sdk/`。

SPCのWebKit初期化中closeは引き続き未解決。SDK原本とTauri、Mixer数値は変更していない。
commit／push・公開・remote CIは実施していない。
この節はK051649移行時の記録。続くYM3438移行は次の節に記載する。


### 完了した作業 — YM3438 WASMの固定SDK参照

`scripts/build_ym3438_wasm.sh`もSDK `0.1.1`の`ym3438`ターゲットを使う。
着手時の本体は`8ad4aa8a4823e2c1797a19e51fbbaacbd864b332`でclean。編集前に57入力を記録し、固定379ファイルとpin、先行21生成記録を保持した。
C++14／O2・OPN_VARIANT=ym3438、11 C export・runtime 2項目・incoming 2項目を維持し、SSG flag／明示ASSERTIONS／EXPORT_ALL／Perl cleanupは追加していない。
本体の共有build_opn_variant_wasm.shとYMF276／YMF288レシピは変更していない。
旧再ビルドとSDKのWASMはsource path差があり、SDK入力11ファイルと共有recipeの4パスだけを旧配置へ戻す一時buildで旧再ビルドbytesを再現した。
配布済み版と旧再ビルドのcode section差は原因未確定として残し、別々の基準で比較した。JSは一致する。
旧再ビルド／配布済みの2組は各450比較・6,412,380生成ステレオフレームでPCM／read／status／IRQ・続行probe差0。
各114 warm reset／再設定を含む1,014実行。resetは一部counterとDAC設定を保持するため、新規インスタンス一致は仮定しない。
chipに保存状態／native mute／borrowed APIはなく、sampleRate(clock)は計算のみ。実direct SynthのJS model・callbackも確認した。
Python103件・既存Node58件、Checker CLIの60実行が成功した。
BrowserはChromium／WebKitでpublic wrapper／direct SynthとSoundChipMixer・meter、AudioBufferSourceによる出力を検証した。最初の接続前から最終zero Gainを使った。
YM3438のRuntimeSynth／合成Worklet／Analyzer再生／Playground modeは追加していない。
FM npm・install済みdirect SynthとAnalyzer ZIPを検証し、21項目の資産・noticeを照合した。Analyzer ZIPは従来どおりwrapperのみで、YM3438生成pair／named Synthを含まない。
校正66 source hash・3 generator checksが成功し、未測定YM3438のunity fallbackを保持した。
詳細は[YM3438移行](wasm_sdk_ym3438_adoption_01.md)と[検証JSON](wasm_sdk_ym3438_adoption_01.json)。証拠は`/private/tmp/tetorica-ym3438-wasm-sdk/`。

この節はYM3438移行時の記録。続くYMF276移行は次の節に記載する。

### 完了した作業 — YMF276 WASMの固定SDK参照

`scripts/build_ymf276_wasm.sh`もSDK `0.1.1`の`ymf276`ターゲットを使う。
着手時の本体は`64946c842d0365873f578dd088088b73691dd50a`でclean。編集前に57入力を記録し、固定379ファイルとpin、先行22生成記録・他50生成ファイルを保持した。
C++14／O2・OPN_VARIANT=ymf276、11 C export・runtime 2項目・incoming 2項目を維持した。SSG flag／明示ASSERTIONS／EXPORT_ALL／Perl cleanupは追加していない。
本体の共有build_opn_variant_wasm.sh、YM3438のSDK shim、YMF288レシピは変更していない。
生成JSは一致する。SDKと旧再ビルドのWASM差はSDKの11入力とrecipeの4パスだけを旧配置へ戻す一時buildで切り分け、旧再ビルドbytesを再現した。
配布済み版と旧再ビルドのcode section差は原因未確定として残し、両方を別々の基準で比較した。
旧再ビルド／配布済みの各462比較・6,668,340生成ステレオフレームでPCM／read／status／IRQ・続行probe差0。
各120 warm reset／再設定を含む1,044実行。resetは一部counterとDAC設定を保持するため、新規インスタンス一致は仮定しない。
固有の14-bit FM経路・DAC右shiftを維持し、DAC data／ninth-bit／panの2,048通りを正の期待値と照合した。YM3438 coreへの誤接続も負の対照で拒否した。
chipに保存状態／native mute／borrowed APIはなく、sampleRate(clock)は計算のみ。実direct SynthのJS model・callbackも確認した。
Python107件・既存Node58件、Checker CLIの67実行が成功した。67 closure／78 freeze記録は両比較の前後で再照合した。
BrowserはChromium／WebKitでpublic wrapper／direct SynthとSoundChipMixer・meter、AudioBufferSourceによる出力を検証した。最初の接続前から最終zero Gainを使った。
YMF276のRuntimeSynth／合成Worklet／Analyzer再生／Playground modeは追加していない。
FM npm・install済みdirect SynthとAnalyzer ZIPを検証し、21項目の資産・noticeを照合した。Analyzer ZIPは従来どおりwrapperのみで、YMF276生成pair／named Synthを含まない。
校正66 source hash・3 generator checksが成功し、未測定YMF276のunity fallbackを保持した。
詳細は[YMF276移行](wasm_sdk_ymf276_adoption_01.md)と[検証JSON](wasm_sdk_ymf276_adoption_01.json)。証拠は`/private/tmp/tetorica-ymf276-wasm-sdk/`。

この節はYMF276移行時の記録。続くYMF288移行は次の節に記載する。

### 完了した作業 — YMF288 WASMの固定SDK参照

`scripts/build_ymf288_wasm.sh`もSDK `0.1.1`の`ymf288`ターゲットを使う。
着手時の本体は`b1a05ef17f34e92f81a6db0fd6ba8805ed52f26a`でclean。編集前の57記録、先行23receipt・他50生成JS／WASMを照合した。
379ファイルの固定SDKとpin、共有アプリrecipe・先行YM3438／YMF276 shim、公開API・Mixer値は維持した。
C++14／O2・OPN_VARIANT=ymf288・OPN_HAS_SSG、11 C export・runtime 2項目・incoming 2項目を保持した。
4翻訳単位＋7headerの11入力は旧／SDK byte一致。SDK入力を旧配置に置きrecipe4パスだけ戻す一時buildで旧再ビルドbytesを再現した。
生成JSは一致。配布済み版と旧再ビルドのWASM code section差は原因未確定として残し、別々の基準でSDKと比較した。
各606比較・8,809,488生成ステレオフレームでPCM／read／status／IRQ・続行probe差0。reset／再設定150回を含む1,362実行。
YMF288は500kHz native出力、FM内部prescale固定6。sampleRate(clock)はfloor(clock/16)の計算のみ。
OPN_HAS_SSG resetはHandle再構築。新規インスタンスとの再現性を確認し、他variantのwarm reset条件を流用していない。
low-level resetは3FM、YMF288Synth.resetの29=83で6FM。SSG monoを左右のFMへ加算する既存経路を保持した。
3SSG tone／noise・16envelope、FM readmode／ID／IRQmask、CSM bit除去とnoDACも確認した。rhythmはzero external readの人工decode比較で、実ROM音色は未検証。
保存状態／native mute／borrowed／Into／ROM upload APIは追加していない。Synth.getStateはJS register model。
Pythonはbuild95＋import16の別実行で計111件、既存Node58件・CLI67実行が成功した。67closure／78freeze記録は両比較の前後で再照合した。
Chromium／WebKitで実direct Synth6FM／3SSG・混合とMixer／meterを確認。一時harnessのみ500k→48kに変換しAudioBufferSource出力、最初の接続前から最終zero Gainを使った。
合成Worklet／RuntimeSynth／Analyzer再生／Playground modeは追加していない。FM npm・実installとAnalyzer ZIP、資産／notice21項目を検証した。
Analyzer ZIPは従来wrapperのみでYMF288生成pair／named Synthを含まない。校正66source hash・3generator checksとunity fallbackを維持した。
詳細は[YMF288移行](wasm_sdk_ymf288_adoption_01.md)と[検証JSON](wasm_sdk_ymf288_adoption_01.json)。証拠は`/private/tmp/tetorica-ymf288-wasm-sdk/`。

この節はYMF288移行時の記録。続くYMF278B移行は次の節に記載する。

### 完了した作業 — YMF278B WASMの固定SDK参照

`scripts/build_ymf278b_wasm.sh`もSDK `0.1.1`の`ymf278b`ターゲットを使う。
着手時の本体は`a74a893c783056e5f371b52fd09700414ccb1139`でclean。編集前56記録、先行24receipt・他50生成JS／WASMを照合した。
379ファイルの固定SDK・pin、他レシピ・公開API・音源処理・Mixer数値は維持した。
C++14／O2・EXPORT_ALL、15 C export・runtime3項目・incoming wasmBinary、4翻訳単位＋7headerの11入力を保持した。
配布済み版と旧再ビルドのJS／WASMはbyte一致。SDK11入力を旧配置へ置きrecipe4パスだけ戻す一時buildで両方のbytesを再現した。4buildにcompiler警告はない。
各684比較・7,447,780生成ステレオフレームでPCM／read／status／IRQ／hook・続行probe差0。public reset再演奏140回を含む1,508実行。
18FM／24PCM、4OP pair、8／12／16-bit sample、4 MiB load／busRAM、DO2混合・独立mute、Engine rate変換・VGM seek/replayを確認した。
native rateはclock/768の計算。public resetはchip再生成＋JS upload mirror／mute再適用で、native bus RAMへの変更はmirrorへ反映しない。
raw resetはRAM・counter／address／FMfractionを保持し、FM callbackがtimer／IRQをresetする。保存状態／borrowed／Into APIは追加していない。
Analyzerを実測し直した18行は旧02とsources以外全項目・PCM hashが同じだった。実測03へ保存しgenerator／生成commentを03参照へ更新した。
Analyzer値1.465915とpackage unity fallbackを含む全数値は維持した。旧02を保存し、hashだけの更新はしていない。
Python115件・Node最終106件・CLI69実行成功。既存WAV試験の手組み比較engineにMixerが欠けていたため、旧WASMで同じ失敗を再現後、比較側に既存Mixerを追加した試験だけの修正を含む。
Chromium／WebKitでpublic factory／Engineの18FM・24PCMとMixer／meter、実AnalyzerのFM／PCM／混合／PSG4例を確認した。最初のdestination接続前からfinalzeroGainを設けた。
Analyzer既存出力Workletはtransportで、合成は主スレッドEngine。chip合成WorkletやNative経路を新設したものではない。
FM npm・実installとAnalyzer ZIP、資産／notice23項目を検証。Analyzerは生成pair・wrapper・Engine／VgmPlayerを含み、OPLSynthは含まない既存構成。
active66sourceguards・3generatorchecksとruntime／数値関連27ファイルの不変を確認した。
詳細は[YMF278B移行](wasm_sdk_ymf278b_adoption_01.md)と[検証JSON](wasm_sdk_ymf278b_adoption_01.json)。証拠は`/private/tmp/tetorica-ymf278b-wasm-sdk/`。

この節はYMF278B移行時の記録。続くNuked OPN2移行は次の節に記載する。

### 完了した作業 — Nuked OPN2 WASMの固定SDK参照

`scripts/build_nuked_opn2_wasm.sh`もSDK `0.1.1`の`nuked_opn2`ターゲットを使う。
着手時の本体は`b9a4cf604e08850d0da43d58cdf74b1292b66b96`でclean。編集前66記録、先行25receipt・全52生成JS／WASMを保持した。
379ファイルの固定SDK・pin、公開API・音源処理・Mixer値・過去の測定記録は維持した。
C11／O2・ASSERTIONS1／EXPORT_ALL、12 C export・cwrap／HEAPF32・incoming wasmBinary。CはEMCC、既存C++はEMXXで選択する。
2翻訳単位＋headerの3入力は旧／SDK byte一致。旧配布・旧再build・SDK・通常・対応ソース単独buildの生成pairがすべてbyte一致し、4buildにcompiler警告はない。
各462比較・6,662,684生成ステレオフレームでPCM／read／status／IRQ／hook・probe差0。reset再演奏120回を含む1,044実行。
各bus byte writeで24internalclock、1PCMframeも24clock合計×11の既存経路。coldidle792/32768のladder/DCやpan残差を消していない。
2048通りのDAC／ninth-bit／pan、6FM、timer／CSM、writeclock、owned／borrowed／zero-envelope、複数handleを確認した。
このWASMにnative state／mute exportやlowlevelIntoはない。実Synth／SegaPSG付きGenesisEngine／Playerでcheckpoint0からのreset／replayfallbackを確認した。
source helperをSDKmanifestで検証した入力＋2pathだけ移すstandalone recipeへ変更。coreのLGPL／provenanceと、SDKoriginalwrapper／recipeのBSD noticeをsources/LICENSE.tetoricaへ同梱した。
FM npmの重複sourcecopyを除き、full／Analyzer／Synth／Playgroundで共通helperを使う。READMEの古い配布除外記述も訂正した。
notice補完前の証拠をpre-notice/へ保存し、最終helper入力で再freeze／実WASM再比較・独立監査した。コンパイル入力と音声処理は変わっていない。
Python120件・Node193件・CLI70実行成功。active66sourceguards・3generatorchecksを維持した。既存4route×3周波数×2browserの24captureも旧primary0.9単位換算後相対差1e-6以内で一致し、値を書き換えていない。
Chromium／WebKitで実6CH／Mixer・各Playground12captureとPCkey、実Analyzer?engine=nukedのPCM・gain／mute／resetを確認した。最初のdestination接続前からzero Gainを使った。
最終FM npm805ファイル・26WASM・942参照と型／実install、Analyzer378／Synth190ファイルのpair・対応source・license68項目を検証した。
詳細は[Nuked OPN2移行](wasm_sdk_nuked_opn2_adoption_01.md)と[検証JSON](wasm_sdk_nuked_opn2_adoption_01.json)。証拠は`/private/tmp/tetorica-nuked-opn2-wasm-sdk/`。

この節はNuked OPN2移行時の記録。続くDX7移行は次の節に記載する。

### 完了した作業 — DX7／MSFA WASMの固定SDK参照

`scripts/build_dx7_wasm.sh`を追加し、SDK `0.1.1`の`dx7`ターゲットを使う。revisionは先行26件と同じ`e4b7d7ec...`、379ファイル。
着手時の本体は`2871c96dd54bf21fd982203dd805a2e5dcc5056f`でclean。編集前108記録と先行26receipt・全52生成JS／WASMを保持した。
別DX7 checkoutは`176aea739...`に既存の文書・package metadata変更があった。HEAD／dirty状態を保持し、一時領域の凍結ソースで旧手順を再buildした。
実compiler入力は14翻訳単位＋18 quoted headerの32件で旧／SDK byte一致。C++17／scalar・wrapv／alias／fp flagsを維持した。
DX7はgenerated JS loaderなしのstandalone。12 C export、fixed16MiB／stack1MiB、内部44100Hz mono・公開44100／48000出力を維持する。
既定buildは中央`docs/generated/msfa.wasm`＋27番目のreceiptを作り、既存Web／docsのruntime位置へ同じbinaryをコピーする。custom出力は隔離する。
`sync_dx7_runtime.mjs --wasm`もJS同期後に同じ固定SDKbuildを呼ぶ。外部checkoutのcompiledWASMコピーを廃止し、通常JS同期はWASMを保持する。今回そのJS同期は実行していない。
旧配布Web／docs・旧再build・SDK・通常中央／Web／docsの7コピーは32,084bytes／SHA f5de761e...で一致した。
最終107記録をfreezeし、両比較前後に原本とコピーを再hash。各360比較・752render実行でPCM／257frameprobe／API観測の差0。panic再演奏32回を含む。
両build合計7,654,140mono出力frame（本文6,160,384＋probe193,264＋wrapper/raw1,300,492）。内部prefetchは数えない。両報告は同じcoverageで重複加算しない。
32algorithm／6operator、SysEx、16voice・再利用、live level／frequency／feedbackとidentity、panic／release、owned／Into・独立instanceを確認した。native snapshot／register／heap-growth APIはない。
Python109＋importer16＝125件、Node132件・CLI155実行成功。Chromium／WebKitでpublic両rate4ケース・主mode4・Operators4・実npm追加DX7両rate8ケースとPCkey／pointerを確認した。最初のdestination接続前からzeroGainを使った。
active66sourceguard・3generatorcheck・runtime数値27ファイル・既存11level記録を維持。追加／主DX7×3周波数×両browserの12half peak-to-peak amplitude captureは、旧raw基準へChromium全一致・WebKit最大相対差約0.006222%。Mixer値は変更していない。
最終FM npm805ファイル・26pair＋DX7 standalone・942参照、型／installが成功。tar1,592,512bytes／展開5,937,815bytes、version0.2.28は据え置き。
Playground ZIP886ファイル、DX7payload25＋vendor noteの26項目とApache noticesを照合。古いnotice0.1.0は同梱metadataの0.3.1へ訂正した。元package25ファイルとmirrorは不変。
Analyzer／YM2612SynthにDX7再生経路はなく、そのZIPの追加buildはしていない。receiptは中央だけ、SDKに完全sourceを保持する。
詳細は[DX7移行](wasm_sdk_dx7_adoption_01.md)と[検証JSON](wasm_sdk_dx7_adoption_01.json)。証拠は`/private/tmp/tetorica-dx7-wasm-sdk/`。

固定SDKへ切り替えたWASMは全27／27 artifact。WASM移行の残りはない。次は全27件をまとめたビルド／配布確認の手順整理が候補。
SPCのWebKit初期化中closeは引き続き未解決。SDK原本とTauri、Mixer数値は変更していない。
commit／push・公開・remote CIは実施していない。

### 完了した作業 — DX7初期コードの音量とMixer保持

着手時の本体は`d3db10b0455a5cc31cd9d3e62bee3dbde76f120c`でclean。全27ビルドのSDK移行後の別作業。
初期コードとDX7の4基本ExampleにあったMixer `volume:0.5`を削除し、現在選択している設定をRun時にも保持する。
音量不足には音色側のOP85／EG85・75も影響していた。ユーザーの選択でMODE KEYSをOP99／EG99保持・離鍵releaseへ調整した。
Mixer Systemの1.038825、共有INIT SINE・SysEx・WASM／Native core、既存保存コード／Mixer値は維持する。
旧DX7starterをhistoryへ記録し、生成Example bundleを更新。既存保存コードは自動で書き換えず、新規作成・明示的な初期コード選択で新starterを使う。
Node34件・bundle照合、実配布WASMの44100／48000Hz測定と、Chromium／WebKit×Main／Workerの実Worklet4ケースが成功した。
System／任意0.73pan−0.2のRun／Example後の保持とSystem復帰、最終音色のRMS>0.06・非clipを確認した。destination前zeroGainで物理聴音はしていない。
詳細は[作業記録](dx7_starter_mixer_01.md)。証跡は`/private/tmp/tetorica-dx7-mixer01/`。commit／公開・Tauri配布物の取り込みは未実施。
この節はDX7音量調整時の記録。続く全27ビルドの一括検証は次の節に記載する。

### 完了した作業 — 全27 WASMビルドの一括検証

`npm run test:wasm:sdk`／`node scripts/check_wasm_sdk.mjs`を追加した。既存SDKのall recipeでcheckout外の新しい領域へ生成し、全27checkerを呼ぶ。
着手時は本体`3fedff04324d7946daf56f01a4a34146465898c1`でclean。SDK0.1.1／379ファイル・pinと、既存runtime／API／生成物・Mixerは変更していない。
共有inventory validatorで27件・53出力・固有164source/build入力、sourcefingerprint／実hash／sizeとWASM ABIを必須検証する。
既存／checkout内／入力重複／alias／TMPDIRを拒否し、失敗phase・artifact・未実行一覧、ログ／reportを残す。POSIXtimeoutは子process群も停止する。
DX7checkerの旧w/必須依存を除き、実SDK32入力・license・runtime／ABI／receipt guardは保持した。
新しい3試験fileは55＋14＋12＝81件成功。実Emscripten6.0.6-gitで全27ビルド（64.762秒）と合計39,982比較（70.106秒）が成功し、53ファイルは配布版とbyte一致した。
実行前後で1,952repository入力・元参照・参照コピー・再build候補の不変を確認した。音源別frameの単位は維持し、mono／stereoを合計しない。
git archive d98c245fc7316c7eafb7872c546458d6ec847f8eの3,444fileを、.git／w／node_modulesなしで展開した。
そこから--sdk-dirで同じ再build済み出力を再利用し、27件・39,982比較が再成功した。compilerの2回目実行や固有coverageの倍加はしていない。
Ubuntu24.04／Node22／Python3.12／Emscripten6.0.6のWASM SDK workflowを追加し、3試験と同じ一括コマンド、失敗時も7日保持の診断artifactを設定した。
remoteCIの手動起動・結果確認、npm／itch.io作成・公開、Native／Tauri・Browser音声実行は行っていない。SPCのWebKitclose問題も未解決のまま別扱い。
詳細は[作業記録](wasm_sdk_batch_validation_01.md)と[検証JSON](wasm_sdk_batch_validation_01.json)。証拠は`/private/tmp/tetorica-wasm-sdk-all-rpl7z7np/`。
次は新workflowをremoteCIでも確認する候補。個別音源のSDK移行は残っていない。

### その他の作業候補と未着手範囲

1. 通常22音源と代替NukedのNative側SDK参照切替・ローカル比較・ホスト試験・5構成CIが完了。Nukedの最終pinはSDK `0.1.1`／379ファイル、Tauri成功CIはrun `40175615215`。利用するOSのインストーラーでの起動・聴音確認は別途残る。
2. Master System／MSXと追加生成YM2413の再生・Stop・再Run、リズム・PSG／AY同時再生を実機でも聴いて確認する。先行するX68000等の実機確認も自動試験とは別。
3. 各成功CIの対象コミットを区別し、必要なOSのインストーラーで起動を確認する。実機の聴音・UI操作は自動試験とは別の確認。現在ステージ済みの差分はない。
4. 主要22音源IDとNuked別variantのSDK参照が揃った。今回の最終pin・ホスト試験と後続CIはNuked作業記録で確認する。機種用の補助処理とRustの所有・予約・混合はアプリ側に残る。
5. 高速レジスタ制御は [別メモ](todo_schedule_register_01.md) にある構想。現時点で着手済みと解釈しない。

### 一時成果物と記録の置き場所

- Tauriの `native-validation/`、`native-source-bundle/`、`src-tauri/target/` はignoredな生成物。
- 対応ソースZIP: `w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`。
  ローカルで生成したAY移行のCI入力ZIPのSHA-256: `cf24143b1449028742ff4e8490d63e5b5d66dc272f29cf87509c90164b1fc54a`。
  全1,796ファイルとSDK374ファイルを含む22件の固定記録の照合結果は`/private/tmp/tetorica-sdk-ay8910-sources.json`。
  追加SNES試験修正後のCI入力ZIPは全1,796ファイル、SHA-256は
  `2cafb70e38ffd8eecfab984253fc5cd01e696f3221a493da44850a5396a62e06`。
  `local-final-sources.json`で全照合成功、`local-final-manifest-diff.json`で差分がガイドと試験の2ファイルだけと確認した。
  このZIPは修正版CI結果をガイドへ追記する前のもの。そのCI結果のみを追記した旧ローカルZIPは全1,796ファイル、SHA-256は
  `ff6d69a7c1b701c9348ba51c037ee66ecc1fd5891bc2468989ee81864b4203bc`。
  `/private/tmp/tetorica-opl-ay-fixed-ci-40143851548/local-final-sources.json`で照合成功し、
  同ディレクトリの`local-final-manifest-diff.json`でCI入力との差分がガイド1ファイルのみと確認した。
  PSG移行直後の旧ZIPは全1,796ファイル、SHA-256は
  `c718713666283b34c8aa79ecdbf03d4f3760810877ad92cb44c43d21397cf875`。
  `/private/tmp/tetorica-sdk-segapsg-sources.json`でSDK374ファイルを含む22件の固定記録とZIPを照合した。
  PSG／RFのCI対象コミット時点のローカルZIPは全1,796ファイル、SHA-256は
  `e1433b213fc340762f0578944e8b5797fcff7af26af6ad308db4febb73db353e`。
  `/private/tmp/tetorica-sdk-rf5c164-sources.json`でSDK374ファイルを含む22件の固定記録とZIPを照合した。
  最初の照合で固定対象`native-megacd/README.md`への追記が検出されたため、そのファイルだけHEAD原本へ復元して再生成した。`PINNED`を変更した回避はしていない。
  PSG／RFのビルド参照切替も含むため、先行する成功CIの入力と同一ではない。
  今回のCI結果をガイドへ追記した後のローカルZIPも全1,796ファイル、SHA-256は
  `77c203bb0dc928ba7da75cdf0461525c9b531a438e8eaf8398eb6826fb0260e8`。
  `/private/tmp/tetorica-psg-rf-ci-40148943609/local-final-sources.json`で全照合成功、
  同ディレクトリの`local-final-source-delta.json`でCI入力との差分がガイド1ファイルのみと確認した。
  OPL接続移行直後の旧ZIPは`c2d20e9b...`で、今回のAY移行を含まない。
  前回CIの結果をガイドへ反映した直後の旧ZIPは`85850ce5...`で、今回のOPL接続移行を含まない。
  前回CI対象ZIPは`2829e9f9...`（macOS／Linux）。そのCI後の文書更新だけを行った時点では差分はガイド1ファイルだったが、最新ZIPには今回の接続参照・ビルド・文書の変更も入る。
  先行するOKIM6258移行後の旧ZIPは`7123fc45...`で、今回のYM2413差分を含まない。
  先行するYM2151移行後の旧ZIPは`b3c56199...`で、今回のOKIM6258差分を含まない。
  先行する全OPN CI後の文書更新だけを含む旧ZIPは`af8e3129...`で、今回のYM2151差分を含まない。
  再生成後に値が変わる場合は、その時点の作業ツリーとマニフェストを確認する。
- PWM移行直後のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `519b7c8853903f5bb34e33f3be201baa7cdf8e7bcddf1c831b4f0ff795fe07f3`。
  `/private/tmp/tetorica-sdk-pwm-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-pwm-adoption/source-manifest-delta.json`で着手時からの変更がTauriの5ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  今回のPWM差分を含むため、前回成功CIの入力と同一ではない。
- HuC6280移行後、run `40162092207`のCI対象時点のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `dcbc9710d9d89db204fec2d1841e82ca0976c73c192db7fc37a599a232a1c865`。
  `/private/tmp/tetorica-sdk-huc6280-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-huc6280-adoption/source-manifest-delta.json`で着手時からの変更がTauriの4ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  前回CIの入力にはないPWM／HuC6280移行を含むため、前回成功CIの入力と同一ではない。
- PWM／HuC6280 CIの証拠は`/private/tmp/tetorica-pwm-huc-ci-40162092207/`の`final-ci-summary.json`、`inspection-summary.json`、`jobs-audit.json`、`artifact-metadata.json`、`native-artifact-metadata.json`。
  全5構成で22件の固定記録・SDK374ファイル・ソースZIP1,796ファイル、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限・Stop後の予算0が成功。両runnerはexit code 0・`deviceOpened: false`。
  非Windows4構成のCIソースZIPは上記`dcbc9710...`、Windowsは`167ae8219491e94f1624330875be1d2ecdecf64cd87e3b571c4c81994ad826b2`。各CIの照合は成功し、ハッシュ差の原因は断定しない。
  取得したのは検証レポートZIPだけで、インストーラー・ソースZIPのダウンロード・起動・独立照合は行っていない。実機の聴音・UI操作・OS間PCM一致と各OSでのWASM比較も別の確認とする。今回は新しいタグやreleaseを作成していない。
- PWM／HuC6280のCI結果ガイドを反映した直後のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `229d8eb929c1504baa65085be4bf38ca966966e42c69b3546b1de1361002f495`。
  `/private/tmp/tetorica-pwm-huc-ci-40162092207/local-final-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合し、
  同ディレクトリの`local-final-source-delta.json`でCI入力との差が`docs/native-sdk-ym2612.md`だけと確認した。
  コードと試験のコンパイル入力はCI対象から変更していない。
- Game Boy移行直後の旧ローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `1db0c76e87d531e9daf300bc3dc985d92b672e51425c72a65009168c3258575c`。
  `/private/tmp/tetorica-sdk-gameboy-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-gameboy-adoption/source-manifest-delta.json`で着手時からの変更がTauriの5ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  直前の成功CIにはないGame Boy移行を含むため、そのCIの入力と同一ではない。
- NES＋FDS移行後、run `40168462256`のCI対象時点のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `1fb6bf89c2a372abbad9190761b678ec611d944f12fabe7a0ac8f6ce8c7f0bec`。
  `/private/tmp/tetorica-sdk-nes-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-nes-adoption/source-manifest-delta.json`で着手時からの変更がTauriの4ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  先行する成功CI `40162092207`にはないGame Boy／NES移行を含むため、そのCIの入力と同一ではない。今回の非Windows 4構成のCIソースZIPとは一致した。
- Game Boy／NES CIの証拠は`/private/tmp/tetorica-gb-nes-ci-40168462256/`の`final-ci-summary.json`、`inspection-summary.json`、`test-log-summary.json`、`native-artifact-metadata.json`。
  全5構成の検証JSONと取得した検証ZIPのdigestを照合済み。インストーラーやCIソースZIPのpayloadはダウンロードしていない。
  ガイド確定後のローカル対応ソースZIPも全1,796ファイルを再生成・照合した。SHA-256は
  `63ff0c8eeab3e7153089f3d868cb9c806e6472ae30de98a18a4f9e0ae594f007`。
  同ディレクトリの`local-final-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合し、
  `local-final-source-delta.json`でCI入力との差が`docs/native-sdk-ym2612.md`だけと確認した。
  製品コードと試験のコンパイル入力はCI対象から変更していない。
- DX7移行直後の旧ローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `a0869853f65bce864ab7dec114a85e4ac4f58d4064054b14159028efb9d755a8`。
  `/private/tmp/tetorica-sdk-dx7-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-dx7-adoption/source-manifest-delta.json`で着手時からの変更がTauriの4ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  直前の成功CI `40168462256`にはないDX7移行を含むため、そのCIの入力と同一ではない。
- SNES／SPC移行後、run `40171879716`のCI入力時点のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `39cd14b113557665c039d0af3960839ed566c7ad2fdc49286859d8b5c53fa684`。
  `/private/tmp/tetorica-sdk-snes-spc-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-snes-spc-adoption/source-manifest-delta.json`で着手時からの変更がTauriの4ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  直前の成功CI `40168462256`にはないDX7と今回のSNES／SPC移行を含むため、そのCI入力と同一ではない。
- DX7／SNES／SPCのCI結果をガイドへ反映した後の最新ローカル対応ソースZIPも全1,796ファイル、SHA-256は
  `3c18c7ca41db0477591881002501c0dbfeac39c9ba972a714e705666cfd99389`。
  `/private/tmp/tetorica-dx7-snes-spc-ci-40171879716/local-final-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合し、
  同ディレクトリの`local-final-source-delta.json`でCI入力との差が`docs/native-sdk-ym2612.md`だけと確認した。
  製品と試験のコンパイル入力はCI対象から変更していない。
- 最新SDKの元ZIP: `/private/tmp/tetorica-sdk-nuked-adoption/release-fixed/tetorica-soundchip-native-0.1.1-sources.zip`。
  元コミット`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`、全379ファイル、ZIP SHA-256
  `939fb035aef36c84cac3d1e058271ca3ddfc6ebd9ce5cfa4b3d04bc92876416b`。
  Tauriの同梱ソースと取り込み記録だけでオフライン照合できる。
- 先行移行で使ったSDKの旧元ZIP: `w/tetorica-soundchip-native/releases/tetorica-soundchip-native-0.1.0-sources.zip`。
  元ZIPが消えてもTauriの同梱ソースと取り込み記録だけでオフライン照合・ビルドできる。
- DX7移行の証拠は`/private/tmp/tetorica-sdk-dx7-adoption/`の`parity-summary.json`、`source-audit.json`、`self-tests.json`、`build-assembly-audit.json`。
  通常再生比較とNative Panic修正の確認は分けて記録した。ホストログと再生／混合レポートは上記DX7ローカル検証節を参照する。
- 検証ログ: `/private/tmp/tetorica-sdk-adoption-parity/`、`/private/tmp/tetorica-sdk-adoption-isolated.json`、
  `/private/tmp/tetorica-sdk-adoption-cargo-test-unrestricted.log`、`/private/tmp/tetorica-sdk-adoption-stability.json`、
  `/private/tmp/tetorica-sdk-adoption-extra-stability.json`。
  YM2203の最新検証は`/private/tmp/tetorica-sdk-ym2203-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2203-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2203-stability.json`、
  `/private/tmp/tetorica-sdk-ym2203-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2203-sources.json`。
  YM2608の最新検証は`/private/tmp/tetorica-sdk-ym2608-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2608-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2608-stability.json`、
  `/private/tmp/tetorica-sdk-ym2608-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2608-sources.json`。
  YM2610／YM2610Bの最新検証は`/private/tmp/tetorica-sdk-ym2610-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2610-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2610-stability.json`、
  `/private/tmp/tetorica-sdk-ym2610-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2610-sources.json`。
  YM2151／X68000の最新検証は`/private/tmp/tetorica-sdk-ym2151-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2151-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2151-stability.json`、
  `/private/tmp/tetorica-sdk-ym2151-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2151-sources.json`。
  OKIM6258の最新検証は`/private/tmp/tetorica-sdk-okim6258-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-okim6258-cargo-test.log`、`/private/tmp/tetorica-sdk-okim6258-stability.json`、
  `/private/tmp/tetorica-sdk-okim6258-extra-stability.json`、`/private/tmp/tetorica-sdk-okim6258-sources.json`。
  YM2413の最新検証は`/private/tmp/tetorica-sdk-ym2413-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2413-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2413-stability.json`、
  `/private/tmp/tetorica-sdk-ym2413-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2413-sources.json`。
  OPL接続の最新検証は`/private/tmp/tetorica-sdk-opl-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-opl-cargo-test.log`、`/private/tmp/tetorica-sdk-opl-stability.json`、
  `/private/tmp/tetorica-sdk-opl-extra-stability.json`、`/private/tmp/tetorica-sdk-opl-sources.json`。
  AY移行の最新検証は`/private/tmp/tetorica-sdk-ay8910-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ay8910-cargo-test.log`、`/private/tmp/tetorica-sdk-ay8910-stability.json`、
  `/private/tmp/tetorica-sdk-ay8910-extra-stability.json`、`/private/tmp/tetorica-sdk-ay8910-sources.json`。
  OPL接続／AY移行を含むCIの確認先は`/private/tmp/tetorica-opl-ay-ci-40142510765/`。
  RF移行の最新検証は`/private/tmp/tetorica-sdk-rf5c164-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-rf5c164-cargo-test.log`、`/private/tmp/tetorica-sdk-rf5c164-stability.json`、
  `/private/tmp/tetorica-sdk-rf5c164-extra-stability.json`、`/private/tmp/tetorica-sdk-rf5c164-sources.json`。
  PSG／RFを含む全5構成成功CIは`/private/tmp/tetorica-psg-rf-ci-40148943609/`で確認する。
  PSG移行の最新検証は`/private/tmp/tetorica-sdk-segapsg-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-segapsg-cargo-test.log`、`/private/tmp/tetorica-sdk-segapsg-stability.json`、
  `/private/tmp/tetorica-sdk-segapsg-extra-stability.json`。
  SNES試験修正後に全5構成が成功したCIは`/private/tmp/tetorica-opl-ay-fixed-ci-40143851548/`で確認する。
  前回のCI記録は`/private/tmp/tetorica-ym2413-ci-40137093552/`にあり、
  `inspection-summary.json`、`artifact-metadata.json`、`jobs-audit.json`、
  `local-final-sources.json`、`local-final-manifest-diff.json`を保存済み。
  `/private/tmp`は消える可能性があるため、再開の必須データとして扱わない。

ソースと由来の正本は各Gitコミット、Tauriの同梱SDK／取り込み記録、上記の手順書。
過去の作業メモにある「未コミット」は当時の状態。TauriのYM2612移行は`9ef583e...`、YM2203移行は`16610b0e...`、YM2608移行は`53ab3d27...`、YM2610／YM2610B移行は`5280f83a...`にコミット済み。
YM2151移行もTauriの`e4d68b27...`、本体の`f0e00dda...`、OKIM6258移行はTauriの`250489fd...`、本体の`fed03f7a...`、YM2413移行はTauriの`634e56f4...`、本体の`6c0b5770...`にコミット済み。前回CI記録とOPL接続移行も、本体の`4137e903...`、Tauriの`4451195...`にコミット済み。Tauriの前回CIガイド更新は`a8edd891...`。今回のAY移行は本体の`ce2ad308...`、Tauriの`276e744e...`にcommit／push済み。その後の追加SNES試験修正とCI結果の文書更新も、本体の`a278e1d5...`、Tauriの`842245dd...`にcommit／push済み。
Sega PSG移行は本体`1da2fb00...`／Tauri`51dca52...`、RF5C164移行は本体`1d35f48a...`／Tauri`4939ddc7...`へcommit／push済み。全5構成成功のCI結果ガイドはTauri`66004f00...`へcommit／push済み。本体の最終結果記録は本節とRF作業記録のみで、そのコミットはこの文書を含むgit logで確認する。

## 旧記録 — 2026-08-24以降の作業メモ

以下は履歴として保持する。この節以降の「Current」「Latest」「Next」は記録当時の意味で、現在の再開指示ではない。

## Latest Playground architecture direction

- `MegaSynth`
  now has listener support:
  - `addListener(listener)`
  - `removeListener(listener)`
- The intended responsibility split is now clearer:
  - `YM2612Synth`
    - readable low-level FM control layer
    - should stay thin
  - `MegaSynth`
    - browser/runtime wrapper
    - high-level FM event hub for demos/apps
  - `docs/playground`
    - subscribes to `MegaSynth.addListener(...)`
    - updates controller UI from those events
- `docs/playground/playground.js`
  has already started this shift:
  - Operator tab sync is no longer driven directly from the `fm` proxy
  - it now listens through `MegaSynth` events

## Important Playground direction

- Playground is expected to grow with:
  - TFI / VGI support
  - envelope UI imported from `docs/synth`
  - FX controller tab
  - guitar/fretboard-style input
  - more Sonic Pi-like live coding features
- Because of that, avoid letting `docs/playground/playground.js`
  become a "single giant file" again.
- The preferred long-term split is:
  1. `web/*`
     - shared library/runtime/features
  2. `docs/synth/*`
     - isolated learning/demo widgets
  3. `docs/playground/*`
     - orchestration/integration layer

## Suggested future Playground file split

- `playground_runtime.js`
  - `runCode`
  - `liveLoop`
  - `play`
  - `beat`
  - `sleep`
  - `livePrepare`
- `playground_editor.js`
  - Monaco init
  - completion / hover
  - fallback textarea
- `playground_console.js`
  - console tab
  - helper tab
  - log formatting
- `playground_sync.js`
  - subscribe to `MegaSynth`
  - push events into operator/future FX tabs
- `playground_examples.js`
  - example code strings
- `playground_operator_tab.js`
  - operator controller UI
- `playground_fx_tab.js`
  - future FX controller UI

## Recent browser/runtime observation

- A short temporary pause during playback was observed once or twice.
- It did not reproduce reliably afterwards.
- Current interpretation:
  - likely browser main-thread pause / GC / extension / temporary UI load
  - not yet strong evidence of a deterministic music-timing bug
- Also observed:
  - `Unchecked runtime.lastError: Could not establish connection...`
  - this does not appear to come from this repository code

## liveLoop error behavior reminder

- As of 2026-08-30, the intended distinction is:
  - top-level Run failure before `commitLiveLoops()`
    - keep the previously committed live loops running
  - error inside an already running liveLoop iteration
    - keep the loop alive
    - if the newly swapped callback fails, roll back to the last stable callback
    - if the current stable callback itself fails, report the error and retry
- This distinction should stay explicit in future Playground refactors.
- "Rollback to previous callback version for the same loop name" is now part of
  the live performance behavior when a hot-swapped callback fails.
  - likely browser extension / external page script noise
- For now:
  - treat both as investigation notes, not confirmed repo bugs

## Current sync status interpretation

- FM-side synchronization is now "organized enough" to move forward.
- Remaining sync work is mainly:
  - future FX-side synchronization
  - deciding how much raw low-level write sync is worth exposing
  - possible reuse of the same observer pattern in `docs/synth`

## Latest low-level YM2612 status

- `Ym2612` now exposes:
  - `write(offset, data)`
  - `read(offset)`
  - `readStatus()`
  - `getIrq()`
  - `setHooks({ onWrite, onRead, onIrq })`
- `YM2612Synth` now exposes readable low-level helpers:
  - `write(port, register, value)`
  - `writeAddress(port, register)`
  - `writeData(value)`
  - `read(offset)` on direct transport
  - `readStatus()` on direct transport
  - `setHooks({ onWrite, onRead, onIrq })`
- `AudioWorklet` side now forwards IRQ state back to the main thread.
- Remaining low-level gap:
  - synchronous `read()` does not make sense across `AudioWorklet`
  - if needed, add a separate `readAsync()` path
- After `readAsync()`, the next low-level work should be:
  - busy flag exposure
  - timer A / timer B exposure

## Latest Playground / FX / Monaco status

- `docs/playground/playground.js`
  now includes:
  - `livePrepare(name, async ({ fx, fm, log }) => { ... })`
  - `fx.gain(...)`
  - `fx.eq(...)`
  - `fx.filter(...)`
  - `fx.delay(...)`
  - `fx.reverb(...)`
  - `fx.setChain([...])`
  - `fx.clear()`
- `web/megasynth.js`
  / `docs/js/megasynth.js`
  now support a master FX chain after the YM2612 output:
  - `setFXChain()`
  - `getFXChain()`
  - `connect()`
  - `clearFXChain()`
  - `connectOutput()`
- `web/megasynth_fx.js`
  / `docs/js/megasynth_fx.js`
  now include:
  - `createGainFX(...)`
  - `createEqFX(...)`
  - `createFilterFX(...)`
  - `createDelayFX(...)`
  - `createReverbFX(...)`

## Important `livePrepare(...)` interpretation

- `livePrepare(name, fn)` is now the first mechanism for:
  - "do this once"
  - "reuse this across Run"
- Current behavior:
  - first time with a name:
    - execute `fn`
    - store result
  - later calls with the same name:
    - do not execute `fn` again
    - return the stored result
- This is useful especially for:
  - FX node creation
  - shared master chain objects
  - future browser-side live coding state
- Current limitation:
  - if the code inside `livePrepare("main-fx", ...)` changes
  - but the name stays the same
  - the old prepared result is still reused
- Likely future additions:
  - `livePrepareReset(name)`
  - `livePrepareClearAll()`

## Current Playground examples

- `FX Loop`
  now uses `livePrepare("fx-loop-chain", ...)`
  for reusable:
  - `filter`
  - `delay`
  - `reverb`
- `FX Motion`
  now uses `livePrepare("fx-motion-chain", ...)`
  for reusable:
  - `gain`
  - `eq`
  - `filter`
  - `delay`
  - `reverb`
- `FX Motion` also now proves that `liveLoop("fx-motion", ...)`
  can move:
  - `eq.bass`
  - `eq.mid`
  - `eq.treble`
  - `filter.cutoff`
  - `delay.mix`
  - `reverb.mix`
  while other loops are playing

## Current click-noise interpretation

- `Run` can still produce a short click / noise.
- Strong current suspect:
  - master FX chain is disconnected / reconnected
  - graph changes happen while audio is live
- `livePrepare(...)` reduces needless FX recreation,
  but does not fully solve routing click noise yet.
- Likely next fix:
  - fade master gain down briefly
  - rebuild chain
  - fade up again

## Monaco status

- `docs/playground/index.html`
  and `docs/playground/playground.js`
  now have a first Monaco-based editor path.
- Current behavior:
  - try loading Monaco from CDN
  - if it succeeds:
    - use Monaco
    - enable Tetorica-specific completion
  - if it fails:
    - keep fallback `textarea`
- Current Monaco completion focus:
  - `liveLoop`
  - `livePrepare`
  - `play`
  - `beat`
  - `nextBeat`
  - `setBpm`
  - `fx.`
  - `fm.`
  - `MEGADRIVE_FM_PRESETS["..."]`
- Current Monaco hover focus:
  - small explanations for:
    - `liveLoop`
    - `livePrepare`
    - `beat`
    - `nextBeat`
    - `fx`
    - `fm`

## Files to read first next time

1. `docs/playground/playground.js`
   - live runtime
   - `livePrepare(...)`
   - FX API
   - Monaco completion setup
2. `docs/playground/index.html`
   - Monaco host + fallback textarea
   - helper text
3. `docs/issues/playground_fx.md`
   - current FX design and implemented direction
4. `docs/issues/playground_autocomplete.md`
   - completion direction
   - Monaco-oriented next ideas

## Likely next steps

1. Verify Monaco behavior more deeply in browser:
   - completion quality
   - cursor behavior
   - fallback behavior
2. Decide whether `FX Motion` should become the default example.
3. Add `livePrepareReset(name)` / `livePrepareClearAll()`.
4. Reduce FX chain click noise on `Run`.
5. Expand Monaco completion:
   - object field completion
   - more snippets
   - better preset/value suggestions

## Playground status

- `docs/playground/index.html`
  now exists as a small browser-side JavaScript playground entry point.
- `docs/playground/playground.js`
  now has a first working runtime for:
  - `play(note, { channel, duration, preset })`
  - `sleep(seconds)`
  - `scale()`
  - `choose()`
  - `rand()` / `randInt()`
  - `setBpm()`
  - `beat()`
  - `nextBeat()`
  - `liveLoop(name, async () => {})`
  - `stopLoop(name)`
  - `stopAllLoops()`
  - raw `fm` access through `YM2612Synth`

## Important Playground interpretation

- The Playground is not only a demo page.
- It is meant to be the "this looks easy enough to try" entry point.
- That is why `docs/index.html` now links to:
  - `Playground`
  - above the normal `Demos` section
- The intent is:
  - show JavaScript first
  - make YM2612 feel approachable
  - then let people drop down into raw `fm` control later

## Current Playground sample state

- The default sample is now the `live-loop` example.
- It uses:
  - one bass loop
  - one lead loop
  - shared BPM / beat timing
- The original example bug:
  - sample code used `MEGADRIVE_FM_PRESETS["2op-bell"]`
  - but the actual preset key is `MEGADRIVE_FM_PRESETS["two-op-bell"]`
- This was fixed in:
  - `docs/playground/playground.js`

## Important note about `nextBeat()`

- `await nextBeat()` inside every `liveLoop()` cycle makes the loop re-attach to the next integer beat each time.
- Because of that, shortening:
  - `duration`
  - `beat(...)`
  may not feel effective if `nextBeat()` is still called every cycle.
- For faster lead patterns, removing per-cycle `nextBeat()` is currently more illustrative.

## Files to read first next time

1. `docs/playground/playground.js`
   - runtime behavior
   - helper API
   - sample examples
2. `docs/playground/index.html`
   - Playground page structure
   - helper list text
3. `docs/index.html`
   - top-level entry positioning
   - Playground is intentionally shown before Demos
4. `docs/issues/playground.md`
   - longer-term design notes
   - why JavaScript / why `liveLoop`

## Likely next Playground steps

1. Make the default `live-loop` sample feel musically better.
2. Decide whether `nextBeat()` should be:
   - a manual helper only, or
   - also have a "first loop only" convenience pattern.
3. Add safer live coding behavior:
   - replacing loops
   - stopping loops
   - handling broken user code
4. Continue toward the original direction:
   - Sonic Pi style `liveLoop`
   - but with YM2612 / Mega Drive specificity still visible.

## Looper direction changed

- The first `MegaSynthLooper` implementation used event replay:
  - record `noteOn` / `noteOff`
  - replay those events through YM2612 later
- That worked conceptually but still hit practical note cut problems.
  - YM2612 only has 6 FM channels.
  - Even after splitting live and loop synth instances, overdub units could still interfere.
- Current decision:
  - use recorded audio as the main looper playback source
  - keep events / patch snapshots as side metadata for export and analysis

## Latest looper observation

- Even after:
  - splitting live and playback synth instances
  - remapping playback channels per unit
  - scheduling new units into the current loop cycle immediately
- `unit 2` and later can still break up during playback.
- The audible result is:
  - notes sometimes cut partway through
  - overdub playback is not stable enough for the main user-facing looper path

Interpretation:

- this is no longer just a small scheduling bug
- it is strong evidence that the event-replay approach is the wrong primary looper playback model here

## Current looper-related code state

- `web/megasynth_looper.js`
  still contains the event-based looper implementation.
- `docs/js/megasynth_looper.js`
  is synced with the same event-based structure.
- `scripts/verify_megasynth_looper.mjs`
  now includes a 2-unit replay check and passes.
  This verifies the current event-looper channel remap behavior, but that is no longer the final target.

## Output bus preparation added to synth demo

- `docs/synth/synth_runtime.js`
  now accepts `outputNode` and passes it into `MegaDriveSynth`.
- `docs/synth/synth.js`
  now creates:
  - `liveOutputBus`
  - `loopOutputBus`
  - `liveCaptureNode`

Current graph direction:

- live YM2612 runtime
  - outputs to `liveOutputBus`
  - `liveOutputBus` goes to destination
  - `liveOutputBus` also goes to `liveCaptureNode`
- loop YM2612 runtime
  - outputs to `loopOutputBus`
  - `loopOutputBus` goes to destination

This was added so the next looper implementation can record only the live bus.

## Next likely steps for looper

1. Add audio recording for one unit from `liveCaptureNode`.
2. Store that result as unit audio.
3. Switch loop playback from event replay to audio replay.
4. Keep event log and patch snapshot as export-oriented metadata.

## Current UI / YM2612 learning demo status

- `docs/operator1.html`
  1-operator YM2612 learning demo now exists.
  It is no longer only a "play beep" page.
  It now tries to help the reader connect:
  - register parameters
  - envelope intent
  - actual generated sound
- The current demo exposes these parameters:
  - `MULTI`
  - `TL`
  - `AR`
  - `D1R`
  - `D2R`
  - `SL`
  - `RR`
  - `Pitch`
  - `Block`
- Layout was compacted so the parameter UI and `Envelope` panel fit in one desktop window more easily.
  - controls are smaller
  - `Envelope` is placed beside the controls
  - `Waveform` and `Spectrum` are below
- The `Envelope` panel now keeps its drawing after playback ends.
  - only `Waveform` and `Spectrum` return to idle
  - `Envelope` stays as a parameter/result reference view
- `docs/operator2.html`
  A 2-operator YM2612 learning demo now exists.
  It focuses on the jump from "single operator" to actual FM relationships:
  - `parallel`
  - `serial`
  - `feedback`
  The page currently lets the user compare:
  - operator 1 / operator 2 frequency multipliers
  - operator 1 / operator 2 total levels
  - shared `AR` / `RR`
  - `feedback`
  - `Pitch` / `Block`
  In the current design:
  - parallel mode uses algorithm 7 and leaves operator 1 + operator 2 audible
  - serial mode uses algorithm 4 and focuses on the `O1 -> O2` path while muting the other pair

## Important interpretation for `docs/operator1.html`

- The orange envelope line is not "real measured chip internals".
- It is a parameter guide built from:
  - `AR`
  - `D1R`
  - `D2R`
  - `SL`
  - `RR`
  - `TL`
- The cyan line is based on the actual generated audio output.
  - it is computed from the generated stereo samples
  - it is closer to an output amplitude trace than to an internal operator envelope
- This difference is expected.
  FM output amplitude can look very different from the intended parameter envelope because:
  - modulation changes harmonic balance
  - phase interaction changes visible amplitude
  - the final waveform is not a direct envelope plot

## What was added to `docs/operator1.html`

- parameter UI for:
  - `D1R`
  - `D2R`
  - `SL`
- register writes for operator 4:
  - `0x5c` for `AR`
  - `0x6c` for `D1R`
  - `0x7c` for `D2R`
  - `0x8c` for `SL/RR`
- actual output envelope overlay:
  - built from generated `left/right` sample arrays
  - uses short-window RMS buckets
  - normalized and drawn as the cyan overlay

## Current design decision

- For now, prefer "faithful to the actual heard sound" over "more smoothed and easier to read".
- That means:
  - keep the cyan line relatively honest to the generated output
  - do not over-smooth it just to make it look like the orange guide
- If a later toggle is added, it should be optional:
  - `raw output`
  - `slightly smoothed`

## Important unresolved point

- `docs/operator1.html` still does not show an explicitly staged `key on` -> `key off` boundary.
- A possible next improvement is:
  - generate a hold segment
  - then send `key off`
  - then generate the release segment
  - draw a vertical `key off` marker on the envelope panel
- This would make the `RR` / release part easier to understand.

## Another important unresolved point

- The cyan line is still derived from output audio, not YM2612 internal operator state.
- If "real internal envelope" is ever required:
  - JS/WASM interface changes alone are not enough
  - a C++-side export is needed
  - possibly a minimal debug getter in `ymfm` or a wrapper around it
- Current decision:
  - do not change `ymfm` yet
  - stay with output-based observation first

## Current status

- `docs/beep.html`
  YM2612 beep demo works in the browser.
- `docs/psg.html`
  Sega PSG demo works in the browser.
- `docs/vgm.html`
  VGM file can be parsed and played with YM2612 + PSG.
  Streaming playback now works in the browser.
  `Play`, `Pause`, `Resume`, `Replay`, `Stop`, and basic `Loop` controls now exist.
  `AudioWorklet` is now used when available, with `ScriptProcessorNode` fallback.
- `docs/embed.html`
  A small browser integration sample now exists to show both the VGM playback path and the direct chip control path.
- `docs/ym2612vgm.js`
  Minimal VGM support was expanded to reduce `SKIP`.

## VGM support added today

- YM2612 register write
  - `0x52`
  - `0x53`
- PSG write
  - `0x50`
- Wait / end
  - `0x61`
  - `0x62`
  - `0x63`
  - `0x66`
  - `0x70-0x7f`
- YM2612 DAC / stream related
  - `0x67` data block: store block data
  - `0x80-0x8f`: DAC write + wait
  - `0x90-0x95`: minimal DAC stream handling
  - `0xe0`: data bank seek

## What changed

- `docs/ym2612vgm.js`
  Added data block loading, YM2612 DAC handling, and minimal DAC stream playback.
- `web/ym2612vgm.js`
  Synced with `docs/ym2612vgm.js`.
- `docs/vgm.html`
  Wait rendering was split so DAC stream writes can happen during playback timing.
  Playback was moved from full offline rendering to chunked streaming playback.
  The page now uses `GenesisAudioEngine` + `VgmPlayer`.
  Browser audio output now prefers `AudioWorklet`.
- `docs/embed.html`
  Added a smaller sample that uses `GenesisAudioEngine` and `VgmPlayer` with a simpler UI.
  It now documents the decision to keep VGM playback and direct chip control as separate paths.

## What we observed

- The second VGM plays without `SKIP`.
- The first VGM also has no `SKIP` now, but sound starts after a long delay.
- That likely means:
  - the song has a long silent intro, or
  - the interesting part starts later, or
  - the track structure depends on data that is not ideal for this minimal player yet.

## Important interpretation

- "No sound at first" is not automatically a parser bug now.
- If there is no `SKIP`, the next thing to inspect is the VGM content itself:
  - long wait before first key-on
  - long wait before audible FM/PSG part
  - DAC-heavy intro
- The old "wait until 100% render" behavior was also a playback-model issue.
- After switching to streaming playback, audio starts before full rendering finishes.
- `Loop` now works both for:
  - VGM files with a loop offset
  - VGM files without a loop offset by restarting from the beginning
- queue draining after playback end needed a bug fix
  - audio must continue until `queuedFrames === 0`
- `Stop` is now distinct from `Pause`
  - `Pause` keeps the current position
  - `Resume` continues from that position
  - `Stop` resets to the beginning
- After switching to `AudioWorklet`, the progress text may feel a little less smooth.
  - This looks like a UI update timing difference, not an audio stability problem.
  - `queuedFrames` still stays healthy and scrolling does not become heavy.
- For practical browser/game design, VGM playback and direct chip control should be treated as separate paths for now.
  - VGM is good for prepared BGM.
  - direct chip control is good for experiments, realtime input, and future programmatic composition.
  - automatic coexistence is not guaranteed when the song already uses YM2612 / PSG resources tightly.

## Still not fully supported

- `0x68` PCM RAM write is still skipped.
- Special / uncommon `0x67` block types are still skipped.
- DAC stream handling is minimal.
- Real hardware accuracy is not the goal yet.
- `AudioWorklet` is used for output timing, but the player logic still runs on the main thread.

## Scope risk

- Building a serious "full VGM player" could easily consume 2-4 months.
- The expensive part is not only implementation.
- It also includes:
  - command coverage
  - DAC / PCM correctness
  - testing assets
  - result verification
  - compatibility differences between VGM files

## Practical scope for this repository

- This repository does not need to become a complete VGM player first.
- A more realistic target is:
  - a YM2612 + PSG learning-oriented VGM player
  - browser / WASM playback
  - support for a practical subset of Genesis / DefleMask-oriented VGM data
  - clear documentation about what is supported and what is not

## `examples/vgmrender` vs `web/ym2612vgm.js`

- `examples/vgmrender`
  - broader as a general VGM renderer
  - supports many `ymfm` chips, not only `YM2612`
  - renders to WAV offline
  - good as a reference for classic VGM command handling
- `web/ym2612vgm.js`
  - narrower, but closer to this repository's browser goal
  - focused on `YM2612 + PSG`
  - already has browser-oriented streaming playback
  - already has practical `0x90-0x95` DAC stream handling that is useful for some Genesis / DefleMask files

## What can still be borrowed from `examples/vgmrender`

- Priority 1: improve docs/comments around the classic YM2612 DAC route
  - explain `0x67` type `0x00` as the YM2612 PCM data bank
  - explain `0xE0` as seek within that PCM bank
  - explain `0x80-0x8f` as "write one DAC byte to `0x2A` and wait"
- Priority 2: make `0x68` more than a skip
  - current `web/ym2612vgm.js` only logs and skips `0x68`
  - first useful step is to parse and store:
    - data type
    - read offset
    - write offset
    - size
  - after that, decide whether target Genesis files actually need full behavior
- Priority 3: strengthen unsupported-command handling
  - when a command is not implemented, prefer:
    - known byte length
    - safe skip
    - clear log
  - this is safer than hard-failing on every uncommon command

## Important difference to remember

## 2026-08-21: TFI import/export status

- `web/tfi.js`
  - minimal TFI import/export helper now exists
  - current scope is 42-byte TFI
  - import:
    - `parseTfi(data)`
    - converts TFI operator file order `S1, S3, S2, S4` into logical operators `1, 2, 3, 4`
    - converts TFI detune values into YM2612 register detune values
  - export:
    - `createTfiFromPreset(preset)`
    - converts current logical operator preset data back into TFI byte layout
- `scripts/verify_tfi_import.mjs`
  - verifies:
    - operator order mapping
    - detune conversion
    - import/export round-trip

## `YM2612Synth` status for TFI

- `web/ym2612synth.js`
  - now accepts:
    - `rs`
    - `ssg`
    - `sr` as an alias for the same `0x70` register currently exposed as `d2r`
- important note:
  - current demo/UI naming still says `D2R`
  - TFI terminology would call the same register `SR`
  - this is a naming/UI issue more than a register support issue

## `docs/synth` status

- `docs/synth/index.html`
  - can now import TFI from the synth UI
  - can now export the current synth state as `.tfi`
- current flow:
  - choose a preset or edit knobs
  - import a `.tfi` file if needed
  - continue editing
  - export the current state back to `.tfi`

## `docs/synth` remaining work for TFI-friendly editing

- add `RS` control to the UI
- add `SSG-EG` control to the UI
- rename `D2R` to `SR` or `SR/D2R`
- possibly make a slightly more TFI-oriented operator panel later

## Packaging / release note

- `scripts/package_web_runtime_release.sh`
  - now includes `tfi.js`
- `scripts/sync_web_js_to_docs.sh`
  - now includes `tfi.js`
- `scripts/package_itch_synth.sh`
  - now includes `tfi.js`
  - rewrite for `docs/synth/synth.js` was generalized:
    - `../js/*.js` -> `./js/*.js`
  - this reduces future breakage when adding another shared JS file

## Important itch.io note

- the error
  - `Blocked a frame with origin ...`
  is mostly iframe noise from itch.io itself
- the real bug we hit was:
  - `tfi.js` 404 in the packaged synth build
- this was fixed by:
  - adding `tfi.js` to the package
  - rewriting the import path for packaged `synth.js`

- `examples/vgmrender` is not automatically "better" for this repository's goal.
- It is a stronger general VGM reference.
- But for this repository:
  - browser playback
  - `YM2612 + PSG`
  - DefleMask-oriented Genesis subset
  are more important than full generic coverage.

## Suggested next implementation order for `web/ym2612vgm.js`

1. Add clearer comments/doc for `0x67`, `0x80-0x8f`, and `0xE0`.
2. Add a structured `0x68` parser instead of pure skip.
3. Extend the raw command length table only for commands likely to appear in Genesis VGM files.
4. Only after that, decide whether to import more behavior from `vgmrender`.

## Progress added on 2026-08-17

- `0x68` is no longer only "skip and forget".
- `web/ym2612vgm.js` and `docs/ym2612vgm.js` now parse and store `0x68` PCM RAM write metadata:
  - `type`
  - `readOffset`
  - `writeOffset`
  - `size`
  - `commandOffset`
- A helper now exists:
  - `pcmRamWriteSummary()`
- Playback for `0x68` is still not implemented.
- But the parser can now preserve enough information to inspect real files and decide whether implementation is needed.

## `docs/vgm.html` status for `0x68`

- `docs/vgm.html` now has a dedicated section:
  - `0x68 PCM RAM Write`
- After loading a file, the page can now show:
  - where each `0x68` appears
  - its parsed offsets
  - its size
- This makes browser-side inspection possible before adding playback behavior.

## Safe-skip improvement added on 2026-08-17

- `web/ym2612vgm.js` and `docs/ym2612vgm.js` now have a small `ignoredCommandLength()` helper.
- Some known unsupported commands no longer hard-fail immediately.
- They are now:
  - length-checked
  - warned
  - safely skipped
- Current safe-skip coverage includes:
  - `0x30-0x3f`
  - `0x4f`
  - `0x40-0x4e`
  - `0x5d`
  - `0xb0-0xbf`
  - `0xc0-0xdf`
  - `0xe1-0xff`

## Why this matters

- This does not make the player "more correct" yet.
- It makes the parser more robust for mixed or broader VGM files.
- It reduces unnecessary hard parser stops when a file contains unrelated commands that this repository does not intend to render yet.

## Still intentionally not done

- `0x68` playback behavior
- full generic VGM compatibility
- broad support for non-Genesis chips
- automatic interpretation of every skipped command

## DefleMask-oriented finding

- At least one target Genesis VGM uses YM2612 DAC stream commands in a practical way.
- Observed pattern:
  - `0x67` data blocks
  - `0x90` stream target setup for YM2612 register `0x2a`
  - `0x91` data bank setup
  - repeated `0x92` with frequency `16000`
  - repeated `0x95` with block switching between `0x0000` and `0x0001`
  - final `0x94` stop
- This means `0x90-0x95` cannot always be ignored for DefleMask-oriented Genesis support.
- The good news is that this pattern still looks practical to support.

## Important reminder

- "Achieve this repository's goals" is not the same as "support all VGM files".
- Avoid accidentally turning this repository into a full compatibility project too early.

## Genesis-oriented work list

- Phase 1: keep the current base stable
  - keep `docs/beep.html` working
  - keep `docs/psg.html` working
  - keep `docs/vgm.html` working for the current sample VGMs
- Phase 2: clarify the Genesis audio model in docs
  - explain that Mega Drive / Genesis audio is mainly `YM2612 + PSG`
  - explain which part is FM and which part is PSG
  - explain where DAC / PCM belongs in YM2612
- Phase 3: strengthen VGM parsing for Genesis use
  - confirm handling for `0x50`
  - confirm handling for `0x52` / `0x53`
  - confirm handling for waits and loop-related behavior
  - document which DAC / PCM commands are supported now
  - inspect whether `0x68` matters for target Genesis VGM files
- Phase 4: prepare small test assets
  - one short FM-only Genesis VGM
  - one short PSG-including Genesis VGM
  - one short DAC / PCM-including Genesis VGM
  - keep them short enough for easy debugging
- Phase 5: improve debug visibility
  - show accumulated VGM time while parsing
  - show first YM2612 key-on timing
  - show first PSG write timing
  - show first DAC activity timing
  - show unsupported commands clearly
- Phase 6: define the practical compatibility target
  - write "supported Genesis VGM subset"
  - write "known unsupported patterns"
  - avoid claiming full VGM compatibility
- Phase 7: browser embedding path
  - keep the WASM build instructions simple
  - keep the JavaScript API simple
  - show the minimum code needed to connect to Web Audio
  - keep the demo pages as small reference implementations
- Phase 8: learning examples
  - add an example for YM2612 FM note playback
  - add an example for PSG tone playback
  - add an example for YM2612 DAC playback
  - add an example for mixed YM2612 + PSG playback
- Phase 9: optional later work
  - add better loop handling
  - add stricter DAC stream behavior
  - add more Genesis-focused VGM compatibility
  - consider DefleMask-oriented workflow notes

## Priority view

### Must

- keep `docs/beep.html`, `docs/psg.html`, and `docs/vgm.html` working
- document the Genesis audio model as `YM2612 + PSG`
- keep YM2612 / PSG / basic VGM playback understandable
- clarify the current supported VGM subset
- prepare short Genesis-focused VGM test assets
- keep the WASM + JavaScript browser path simple and reproducible
- add learning examples for:
  - YM2612 FM
  - PSG tone
  - YM2612 DAC
  - mixed YM2612 + PSG

### Nice to have

- improve debug visibility in `docs/vgm.html`
- show first key-on / first PSG / first DAC timing
- add better loop handling
- add clearer DefleMask-oriented workflow notes
- support more Genesis VGM command patterns as needed by real samples
- treat VGM DAC stream control `0x90-0x95` as a future compatibility target unless target Genesis / DefleMask files require it

### Not now

- full VGM compatibility
- real hardware accuracy tuning
- broad support for many non-Genesis chip targets
- turning this repository into a general-purpose VGM player project

## Current decision about `0x90-0x95`

- `0x90-0x95` DAC stream control is postponed for now.
- Reason:
  - it is part of broader VGM compatibility work
  - it can easily expand the scope too much
  - it should only be prioritized if target Genesis / DefleMask VGM files actually require it
- Important distinction:
  - YM2612 register writes such as `register=0x94` are normal FM register writes
  - that is different from VGM command `0x94`

## Game integration path

- Current playback style in `docs/vgm.html`
  - stream audio in chunks during playback
- This is good for:
  - debugging
  - command analysis
  - confirming that realtime audio can be generated
- This is closer to game use, but not finished yet because:
  - main-thread work still matters
  - loop handling is still basic
  - `AudioWorklet` output exists, but generation is not fully moved off the main thread yet

## What is needed for game-oriented playback

- audio generation that can feed Web Audio continuously
- start / stop / reset controls
- loop handling
- stable timing for long playback
- low enough main-thread cost for browser game use
- move from `ScriptProcessorNode` demo style toward `AudioWorklet` when needed

## Practical next steps toward game use

1. Keep the current streaming demo stable.
2. Keep `play / pause / resume / replay / stop / loop` behavior stable.
3. Confirm YM2612 + PSG + target DAC stream subset work during streaming.
4. Keep the `AudioWorklet` path stable and verify fallback behavior.
5. Move more generation/control work off the main thread only if needed.
6. Add a small game-like sample after streaming becomes stable.

## Proposed interface split

- Prefer a 3-layer structure for easier embedding:
  - chip layer

## Documentation direction added later

- `docs/index.html` is now being treated as the main browser-side entrance page.
- The page is now split into at least these entry sections:
  - `Demos`
  - `About YM2612`
  - `YM2612 Wasm`
- The direction is:
  - keep Markdown notes as repository source notes
  - add browser-readable HTML pages under `docs/info/`
  - let `docs/index.html` link to them as a small learning hub

## `docs/info/` direction

- `ex00.md`, `ex00_ja.md`, and `ex00_vgm.md` remain as original working notes.
- Browser-readable pages were added under `docs/info/`:
  - `info/index.html`
  - `info/ym2612.html`
  - `info/ym2612-ja.html`
  - `info/vgm.html`
  - `info/wasm.html`
  - `info/vgmplayer.html`
  - `info/audioworklet.html`
- Current interpretation:
  - Markdown files are the original notes / source material
  - `docs/info/*.html` are the public browser-reading path

## Demo page source links

- Source links were added to these browser demo pages:
  - `docs/beep.html`
  - `docs/psg.html`
  - `docs/embed.html`
  - `docs/vgm.html`
- The intent is:
  - demo first
  - source second
  - reduce the gap between "I heard it" and "where is the code?"

## Upstream-friendly reminder

- Do not treat upstream `examples` as project-owned documentation space.
- Keep `examples` easy to merge from upstream.
- Prefer:
  - repository notes in `ex00*.md`
  - browser-readable pages in `docs/info/`
  - demo implementations in `docs/*.html`

## Release packaging reminder

- A release zip was created for the first public browser-side runtime bundle:
  - `release/hello_ymfm_wasm_v0.0.1_web_runtime.zip`
- It currently contains:
  - `web/`
  - `docs/generated/`

## Current documentation/product split

- `hello_ymfm_wasm` is moving toward:
  - YM2612 / ymfm learning notes
  - browser demos
  - WASM / JavaScript integration examples
  - Genesis / DefleMask bridge notes
- The larger composer/tool idea should stay separate as another project.

## Good next steps after a break

1. Re-open `docs/index.html` and confirm the top-level site structure still feels right.
2. Continue growing `docs/info/` rather than pushing too much text into `README.md`.
3. Consider adding an FM-focused page next:
   - 1 operator
   - 2 operators in parallel
   - 2 operators in series
   - feedback
4. If possible later, connect parameter changes to:
   - audible output
   - waveform view
   - FFT view
  - player layer
  - audio output layer

### 1. Chip layer

- Purpose:
  - keep YM2612 / PSG handling low level
  - expose register writes and sample generation only
- Examples:
  - `Ym2612`
  - `SegaPSG`
  - optional combined `GenesisAudioEngine`

### 2. Player layer

- Purpose:
  - parse and drive VGM playback
  - hide chip-specific details from app / game code
- Candidate class:
  - `VgmPlayer`
- Candidate responsibilities:
  - `load(buffer)`
  - `reset()`
  - `play()`
  - `stop()`
  - `setLoopEnabled(enabled)`
  - `isPlaying()`
  - `sampleRate()`
  - `process(left, right, frames)`

### 3. Audio output layer

- Purpose:
  - connect the player to browser audio output
  - keep Web Audio details separate from VGM / chip logic
- Candidate implementations:
  - current demo-oriented `AudioWorklet` path
  - `ScriptProcessorNode` fallback path

## Why `process(left, right, frames)` is important

- It fits browser audio callback style well.
- It is reusable for:
  - streaming playback
  - offline rendering
  - future game-engine integration
- It gives a cleaner boundary than exposing raw register writes to app code.

## Interface direction for game use

- Do not force a single interface style.
- A practical split is:
  - high-level API for BGM
  - low-level API for SFX / realtime control

### High-level API

- Good for:
  - VGM playback
  - BGM handling
  - simple browser/game integration
- Prefer methods such as:
  - `load`
  - `play`
  - `stop`
  - `loop`
  - `process`

### Low-level API

- Good for:
  - sound effects
  - realtime note control
  - direct YM2612 / PSG experimentation
- Prefer methods such as:
  - `writeYm2612(port, register, value)`
  - `writePsg(value)`
  - possible future helpers like `noteOn` / `noteOff`

## Likely class direction

- `GenesisAudioEngine`
  - low-level YM2612 + PSG control
  - sample generation via `process(left, right, frames)`
- `VgmPlayer`
  - high-level VGM playback built on top of `GenesisAudioEngine`

## Why this split makes sense

- BGM and SFX do not always want the same API.
- VGM playback wants a higher-level player abstraction.
- Game SFX may still want direct register access.
- This keeps the repository useful for both:
  - embedding music playback
  - experimenting with chip-level sound design

## Good next steps

1. In `docs/vgm.html`, show more timing information:
   - total wait before first audible section
   - first key-on timing
   - first YM2612 DAC activity timing
2. Add a simple debug view:
   - command index
   - accumulated VGM samples
   - accumulated seconds
3. If needed, make the progress display smoother without changing the audio path:
   - UI-only refresh with `requestAnimationFrame` or a light timer
4. If the first VGM still feels suspicious, inspect which command appears just before the first audible sound.
5. Only after that, decide whether `0x68` or stricter DAC stream behavior is worth implementing.

## Files to reopen next time

- `docs/vgm.html`
- `docs/ym2612vgm.js`
- `web/ym2612vgm.js`

## Short reminder for future me

- The project is already past the "can browser/WASM make sound?" phase.
- The next work is mostly about VGM behavior, timing visibility, incremental compatibility, and game-oriented API cleanup.
- Do not overreact to silence if `SKIP` is already gone.
