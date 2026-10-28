# PS1 SPU: SDK集約とTauri Native接続

2026-10-28。PS1のPCM描画・ADSR・reverb・Sample Editorの次段階。SDKへの収録とTauri Native接続の実装・offline検証は完了。Browser回帰で観測したChromium clock連続性の失敗は別の追跡課題として残す。npm／GitHub／itch.ioの公開、commit・tag・pushは行わない。

## SDK原本と固定取り込み

- `w/tetorica-soundchip-native`にSDK **0.1.6の未公開ローカル候補**を作成。base commitは`3bb8d9ceffa50ad183d1ab856e031fe649425bca`。候補の変更ファイル一覧を本体／Tauriのpinの`localCandidate`に明記し、既に存在するtagの成果物とは扱わない。
- 従来の本体`native/ps1/`の全17ファイルを、SDKの`vendor/mame-ps1-spu/`へbyteを変えず集約。MAMEの原本5ファイル、immutable revision、SHA-256リスト、pSXAuthor／R. BelmontのBSD-3-Clause表記とTetoricaの改変説明を含む。本体の独立した二重原本は削除し、固定SDKをビルド入力とする。
- `tetorica::ps1_spu`／`<tetorica/ps1_spu.h>`／既存`ps1_spu_*` C ABIを提供。C++17の4translation unitだけで同期register／RAM／stereo renderが使える。固定44,100 Hz、24声、512 KiB。ホストのdevice・scheduler・resamplerはSDKに含めない。
- SDKの`instruments: [ps1_spu]`に独立して記録。従来の24 generic chip IDs、29 chip WASM artifacts、2 application-audio modulesを変更せず、合計**32ビルド**に拡張。本体Browser APIの`createSoundChip('ps1')`は上位adapterの識別子であり、SDKに新しい汎用factoryを追加した意味ではない。
- 固定source ZIP: `tetorica-soundchip-native-0.1.6-sources.zip`、1,246,563 bytes、SHA-256 **`3c7c2a9cdfcb0316162f6365aef89f0c9fd92140ae4828599cd613255d153952`**。source manifest 454payload files＋manifest、raw manifest SHA-256 `7495c878275149c3dfd55a4a3482c2ad5bb1739ca200dca60b39b735ede99c87`。本体とTauriは同じZIPを明示取り込みする。
- `/private/tmp/ps1-sdk-candidate-final/local-candidate.json`に候補のbase commit、changedPaths、ZIPのhashと検証結果。SDK原本はこの候補生成後に凍結した。候補source ZIP・metadata・SHA256SUMSは、再開用に本体`release/soundchip-sdk-0.1.6-candidate/`にも同じhashで保持する。

## SDKの完了した検証

- source inventory: **324 snapshot records**、24 chip IDs／29 chip artifacts／2 application-audio／1 instrument／2 JavaScript references。
- Python audit／release回帰 **101件成功**。欠落・重複・古いinstrument catalog、汎用chipへの混入、誤ったNative target/header、source/license hashの欠落・改変、対象WASMなしのNative parity要求を拒否する。
- 独立して展開したsource ZIPのみで**24 static libraries／51 executables**をビルド。**30 CTest entries／29 fixture executables**が成功、**22 WAV examples**が有限・非無音・非clipのstereo PCM16。PS1の自作波形／旋律は44,100 Hz／132,300frames、従来21例は48,000 Hz／144,000frames。二つのJavaScript参照の10checksも成功。
- PS1 fixtureは全24声、high key mask bank、stereo、ADSR release、Roomの残響、RAM境界・保持／clear、独立instance、render分割一致を検証。実WASMは311,605frames。dry／Room reverbの**98,828 interleaved Native/WASM samplesで最大差0**（許容1e-6）。
- 最終候補のsource／WASM ZIPを改めて独立展開し、PS1のNative fixtureとWASMを再ビルド。添付WASMと再ビルドWASM双方の実試験／Native parityが成功。Emscripten 6.0.6の生成JS／WASMは従来Browser配布物とbyte一致。core／音量／補間の変更は行っていない。
- SDKのactionlint／`git diff --check`が成功。SDKの5 OS Native matrixと6番目のPS1 WASM jobを設定したが、今回のremote CI実行はまだ行っていない。

ログ: `/private/tmp/ps1-fixed-sdk-main-core-tests.log`、`/private/tmp/ps1-native-js-tests.log`、`/private/tmp/ps1-sdk-python-final.log`、`/private/tmp/ps1-sdk-extracted.log`、`/private/tmp/ps1-sdk-final-isolated.log`、`/private/tmp/ps1-sdk-wasm-smoke.log`。

## 本体／Tauriへの接続

- 本体のPS1 build入口は固定SDKへ委譲し、SDK pinと全入力／出力hashをreceiptに保持。配布ソースはSDKから生成し、利用者向けの既存`sources/native/ps1/`パスはrelocationとして保持する。配布物単独ビルド用recipeの5vendor pathだけを書き換え、SDKの未変更recipeと真正manifestも同梱する。
- 32ビルドrunnerはPS1のimports／exports ABI、旧配布JS／WASM byte一致、CMake／CTestが返すNative fixtureの実行path、実WASM／NativeのPCMを確認する。通常の29 chip comparisonsとapplication-audioを別々に記録し、PS1 instrumentの失敗／未実行もsummaryに残す。
- TauriにPS1 primary／additional instanceの準備・upload・予約命令・所有者cancel・status／RAM・render経路を実装。JS側も既存PS1 client／共通Keyboard／音作りUIから同じ命令を送る。Browserが既定の方針は維持する。
- 完了済み: 本体import 26件、Tauri import 13件、inventory／runner等87件。32ビルドの**63出力ファイルは全て既存配布物とbyte一致**。新しいPS1 runner単体の16件は上の87件に含まれる。PS1固定SDK実Native／WASM core groupは29件、Native JS関連groupは162件成功（新PS1 13件を含む）。各groupの重複は合算しない。

## 本体／Tauriの完了した最終機械検証

- 最終32ビルドrunnerが**PASS**。29 chip artifacts＋2 application-audio＋1 instrument、63出力のABI／旧配布byte一致、**40,474件のexact chip comparisons**、両application-audioの実試験／Native parityが成功。PS1は98,828 interleaved samplesで最大差0。`repositoryInputsUnchanged: true`。最終reportは`/private/tmp/ps1-sdk-all-parity-final/summary.json`。
- 初回`/private/tmp/ps1-sdk-all-parity/`は検証中のNative adapter編集を入力不変性checkが検出して失敗した。その結果は成功扱いしない。全入力を凍結し、新しい作業directoryで再実行した上の最終reportだけを完了根拠とする。
- Native JS関連**162件成功**（PS1専用13件を含む）。起動後、最初のInspector readより先にStopすると、受理済みの初期24声のsample割当が失われる問題を修正。直前に受理したassignmentとRAM bankを保持し、古いupload continuationは取り消す。fresh start → Stop → Keyboard再演奏の回帰を含む。
- Tauri Rustは**793件成功／既存4件ignored**、PS1専用12件を含む。関連Python31件／Node31件も成功。GUIや物理deviceを開く試験とは区別する。
- 最終isolated npm配布物は**1,004files／1,097 local module・asset refs／28 WASM engines／15 renderer checks**、NodeNext／Bundler／Browserと正負の型試験が成功。compressed 1,951,829bytes、unpacked 7,405,489bytes。package versionは0.2.32のままで未公開。
- 配布用PS1 sourceは24inputs／28bundle filesのhash closureを検証し、`--build`でSDK checkoutなしに実際に再ビルド。生成JSとWASMはstage／本体双方とbyte一致。JS SHA256 `004e05f4f41bca695af9499c81cf5ce4b1c6fc94934618e56249c9de8e666f7a`、WASM SHA256 `ac5eff0c9c192730e247b79d67b1ac04bd80bf8f2a6324c2404a2b25b0102df6`。proofは`/private/tmp/ps1-native-sdk-source-rebuild-proof.json`。
- 標準package 4ZIPのCRCが成功。Playground fullは1,066files／SHA256 `67079670926b976ec84d92e330ff796c93bbd975bcf0f1a4672bfcf7563a878a`、itch実行用Run ZIPは**931files**／SHA256 `ab83876a942add3ab6a91ff7ab53e333dcc943134642ae151721235c0f6556e2`。Synth203files／Analyzer421filesも成功。詳細は`/private/tmp/ps1-sdk-package-check.json`。
- Tauriへ最終frontendを同期（1,065files）。frontend ZIPのSHA256は上のfullと同じ。対応source ZIPは**2,085files**／SHA256 `c02901cc47ace5ee8ff0aa5ae34bb9dc1a01fb70f153645bcbbef73d4d2e56f3`、24 source pins／snapshotsのoffline検査が成功。`/private/tmp/ps1-tauri-native-sources-check.json`はdeviceOpened／networkUsedともfalse。

## Browser確認の途中結果と未解決事項

- 実SPUモジュールのWindow／DedicatedWorker × Chromium／WebKitの**4条件が成功**。Node実WASM baselineと各32,776 sample comparisonsで最大差0。pitch／stereo／RAM／key-off／reset／独立instanceを確認。これは**AudioContextを作らないcore検証**であり、PlaygroundのAudioWorklet deadlineや連続性を検証した意味ではない。report: `/private/tmp/ps1-sdk-core-browser.json`。
- source本体と実Run ZIPのvoice UIは**WebKit Main／Workerの計4条件が成功**。PCM描画／CH24／ADSR／owned retrigger／per-voice send・reverb・実wet tail／Keyboard／Stop／error回復／slotと別CH保持を実際の公開UIで検証。物理出力はmuteし、人の実聴はしていない。reports: `/private/tmp/ps1-sdk-browser-source-webkit.json`／`/private/tmp/ps1-sdk-browser-zip-webkit.json`。同一checker SHA256 `1bd6c3c254629ad0c3462f7408480de3625f54d50c203a458837e3c6fe199cd4`で検証し、配信assetは本体287files／ZIP215filesを照合した。
- Chromium Mainはsource本体と実Run ZIPの両方で完走した。一方、Chromium Workerは**本体・ZIPの両方で追加SPU dispose後の`silent()`のclock連続性checkに`frameGaps: 1`**を観測して失敗した。対象captureのPCMはfiniteかつexact zeroまで確認済みだが、連続性の失敗は未解決であり成功扱いしない。別の負荷がある実行ではChromium Mainに**-128 frames（1 quantum）**のcurrentFrame不一致も出た。原因やBrowser固有の既知現象とは断定しない。
- strict clock assertionは変更していない。UIの全8条件のうち6条件が成功し、Chromium Workerの2条件は未解決の失敗として保持する。失敗した全routeジョブでは最終JSONを作成していないため、`/private/tmp/ps1-sdk-browser-source.log`／`/private/tmp/ps1-sdk-browser-zip.log`を根拠として保持する。**全8条件PASSとは扱わない**。

## 完了範囲と次の追跡事項

SDK集約とPS1 Native接続の実装、offline試験、型・配布source・package検証は完了した。Web Audioを既定とし、TauriでNativeを選択してPS1を使用できる。Chromiumのclock連続性は成功したcore試験やNative実装と混同せず、未解決の追跡事項として残す。

- [x] 32ビルドrunner最終summaryと入力不変性を確認。
- [x] Native JS162件、固定SDK実core29件、Rust793件（既存ignored4件）、関連Python31件／Node31件を確認。
- [x] isolated npm／型、配布ソース単独再ビルド、4ZIP CRCとTauri frontend／対応sourceを確認。
- [x] Browser実core4条件、source／Run ZIPのWebKit Main／Worker4条件、Chromium Main2条件の成功を記録。runtime versioner変更0と本体／SDK／Tauriの`git diff --check`も成功。
- [x] issue／JSON／savePointへ結果と限界を反映。SDK／Native実装段階は完了、未公開。
- [ ] **Chromium Workerのclock連続性**: source本体／Run ZIPの追加SPU dispose後、無音captureにframeGaps1。別実行のMain -128frames不一致も含め原因を調べる。PCM finite／exact zeroの確認だけでこの失敗を消さず、assertionを緩めない。
- [ ] Tauri GUIでの実操作・物理出力の実聴とWindows／Linuxを含むremote CI。機械試験と区別して記録する。

PS1のMixer基準音量は未測定unity **1.0**のまま。CPU／BIOS／PSF player、DMA／IRQ、CD-XA／external CD audioは今回の対象外。既存coreのlinear補間・近似ADSR・preset reverbとsample cacheは**最初のKON／render等でallocationが起こり得る**。準備処理だけに限定されるとは扱わず、hardware-exact／無条件のzero-allocationやreal-time保証はしない。

JSON記録: [ps1_sdk_native_01.json](ps1_sdk_native_01.json)。公開API guide: [../ps1_spu.md](../ps1_spu.md)。全体計画: [todo_ps1_01.md](todo_ps1_01.md)。
