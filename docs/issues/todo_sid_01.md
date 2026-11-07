# C64 SID: playback reference, Playground, Synth

## 方針（2026-11-06）

ユーザー承認: VGM PlayerへのSID再生、Playground先行、Synth先行のうち、
実装・検証しやすい順で進める。最初に音源単体を動かす入口と比較手順を作り、
その後に通常のPlayground／Synthへ広げる。標準VGMにSIDを独自追加したとは扱わない。
既存Synthの操作と、可読ソースを改造・再利用できる配布方針を維持する。

## 1. コア選定と検証の入口

- [x] 既存SIDコアのlicense、6581／8580、filter、Native／WASM対応、依存関係を確認して採用理由を記録する。
- [x] 固定revisionの原本・license・変更点・再ビルド手順を同梱する。既存fixed SDK snapshotを直接変更しない。
- [x] SID単体のregister read／write、clock、reset、renderをNativeとWASMから使えるようにする。
- [x] 自作register列でTriangle／Saw／Pulse／Noise、ADSR／Gate、3声、Sync／Ring、Filter routing／LP／BP／HP／cutoff／resonanceを検証する。
- [x] 比較条件（core revision、model、PAL／NTSC clock、sample rate、sampling方式）とWAV／測定結果を保存する。Native／WASM一致は移植検証であり、実機一致とは区別する。
- [x] ブラウザーで音を試せる最小の可読コードと操作入口を作る。AIの無音測定と人の実聴を区別する。

## 2. Playground／公開API

### 通常mode接続の今回の作業（2026-11-06）

ユーザーの「進めて」により、第1段階の独立ラボから通常Playgroundへの接続を開始する。
正本のSID core／WASMを再利用し、固定SDK snapshotへ直接追加しない。
mode idは `c64`、chip名／global APIは `sid` とする。6581専用・creation時のclockは固定。

- [x] `SidSynth` のvoice／filter／note helperと、Main／logic Workerから直接使うclient、AudioWorklet endpointを実装する。予約時刻・Loop所有権・Stop／再Runを既存performance queueへ接続する。
- [x] `createSoundChip('sid')`／`useSoundChip('sid')`、SID primary／追加instance、Clock／model optionsの検証を揃える。未対応Native audio backendでは明示的に拒否する。
- [x] C64 mode、自作コード例、3voice／shared filterの状態表示、モード別型と補完からのsource参照を追加する。
- [x] SID専用receiptで通常Playground ZIPとmatching sourceを検証・同梱し、既存SDKの認証は維持する。可読コードを保持する。
- [x] Main／Worker、追加instance、予約された発音／離鍵、Stop／再Run、非対応option拒否、source／独立ZIPのChromium／WebKit、型・配布を検証し記録する。
- [x] README en／ja／AI、接続マップ、再開TODO、CIを今回の実装範囲へ更新する。npm公開、SID曲再生、Synthは後続。

- [x] JS API・型・Main／Worker／AudioWorklet、音声の開始／停止／再発音を既存構成へ接続する。
- [x] Playground mode／サンプル／voice・filter表示／補完からの実装参照を用意する。
- [x] 独立ラボのbuild、checked WASM／JS配布、対応source kit、license、offline ZIP、CI workflowを追加する。通常Playgroundのartifact profile／SDKへの登録は後続。
- [x] 独立ラボの実WASMを使ってChromium／WebKitで発音・停止・parameter変更・エラーを検証する。通常modeのMain／Workerは後続。

## 3. SID曲の比較／解析

### 参照再生／比較CLIの今回の作業（2026-11-07）

ユーザーの「進めて」により、SID曲を基準にした検証を開始する。
最初は単一SID・PAL／6581の自作PSIDを対象に、既存C64再生engineを外部の検証toolとして使う。
本体のBSD／zlib runtime・Synth・WASM・SDK／校正値は変更せず、engineのlicenseと依存・ROM条件を記録する。

- [x] 参照engineの固定revision、license、build依存、PSID／RSIDとROM条件、cycle付きSID write取得方法を調査する。
- [x] 著作物を含まない自作PSID fixtureを用意し、実C64 program実行によるSID write列を検証する。
- [x] clock／model／sample rate／engine revision／入力hash／cycle順を持つbounded trace形式を定義し、無効・巨大・非対応入力を明示拒否する。
- [x] 外部engineでの参照再生／trace取得と、同じwrite列を既存Tetorica SIDへ流す比較CLIを実装する。WAVと測定JSONを保存する。
- [x] timing／render分割／再現性、wave／ADSR／filter変化、自作programの期待write列、エラー経路を自動確認する。参照engineとの差は実機一致・PCM完全一致とは扱わない。
- [x] 再現可能なbuild／実行手順、license境界、対応範囲、CIと再開メモを更新する。実ゲームSID、人の実聴、RSID／ブラウザー統合／音色取り込みは後続に分ける。

- [x] sidplayfp等を用いた外部再生／WAV比較手順を用意する。初版はPAL／6581を明示して揃え、NTSC／8580は拒否する。
- [x] PSID／RSIDのprogram実行を扱う既存engineとlicense・ROM依存を調査する。
- [x] SID再生またはtimed register trace取得を試作する。初版は外部比較CLIとし、既存VGM Player／Analyzer／browserへの統合は後続とする。
- [ ] 後続: voiceの設定と時間変化を試奏用に取り込む。snapshotだけで元のinstrumentを完全復元したとは表示しない。

## 4. Synth／配布

### 独立Synthの今回の作業（2026-11-06）

ユーザーの「進めて」により、通常Playgroundの検証済みSidCore／SidSynthを使う独立Synthを開始する。
仮称 **Tetorica SID Synth**、product id `tetorica-sid-synth`、入口 `docs/synth-sid/index.html`。
初版は6581近似・PAL985,248Hz、Native SDK／既存校正値を変えず、共有runtime／WASMも再利用する。
名称専用iconは今回新規生成せず、既存シリーズと整合する明るい筐体色とcompact controlsで作る。

- [x] strict v1 portable preset（wave／Pulse幅／hardware ADSR／TEST／Sync・Ring／software modulator ratio／shared filter・chip volume）と可読Playground JavaScript出力を実装する。
- [x] 通常は実3voiceをround-robinで割当。steal後の古い離鍵を無効化し、hardware release中のvoiceも保持する。Sync／Ring時はsilent voice3→carrier voice1の1pairへ切り替え、最大1音にする。
- [x] Pulse幅／ADSR／filter／resonance／chip volume／ratio／Pitchは保持音へ反映する。pair topology変更・preset load・Stopは所有権と尾音を安全に破棄する。発音・pitch範囲エラーは現在音を保持して拒否する。
- [x] AudioWorkletで実coreをrenderし、lazy audio・startup中Stop・障害時の無音化／retry・FIFOのpreset反映を整備する。既存の最終Master0..380%と100%超orange、Waveform／Spectrumを使う。
- [x] 既存Synthのcompact keyboard／Octave、2箇所Pitch、stepper／slider、演奏を妨げないfocus、折りたたみ、save/load presetとCopy JavaScriptへ接続する。hardware機能とsoftware割当／ratioを明示する。
- [x] unit／実WASM／Chromium・WebKit／独立ZIPで3音・pair・live編集・保存復元・出力・keyboard・startup取消を検証する。可読JS／CSS・対応source／license／再ビルド手順を同梱しREADME・CI・再開記録を更新する。

- [x] 既存FM2612／SPU／DMG等と同じ操作感で、3声の割当、wave／Pulse幅、ADSR、shared filter、Sync／Ringを操作する。
- [x] shared filterと実voice間の依存、hardware機能とsoftware割当・modulationを区別する。
- [x] preset保存／復元、可読JavaScript出力、keyboard focus、2箇所Pitch、Master380%、waveform／spectrumへ接続する。
- [x] readable source付きWeb ZIP、README en／ja／AI、home、既存Native例・再ビルド手順への入口を用意する。
- [ ] 人が実聴し、和音／Pulse幅／ADSR／filter／Sync／Ringを確認する。
- [x] 専用iconを作成する（2026-11-07追記）。[1254px WebP](../tetorica_sid_synth.webp)・[元PNG](../tetorica_sid_synth.png)・[生成プロンプト](tetorica_sid_icon_prompt_20261107.txt)。既存シリーズと同じ寸法、C64のbeige／brownとfilter波形を使った。
- [x] 選択済みiconを採用する（2026-11-07、ユーザー「これでお願い」）。Synth header／favicon／Apple touch icon、home en／ja、配布ZIPとsource receiptへ同じWebPを反映した。既存音声コードを保持し、source／実ZIPのdesktop／390px表示とlocal画像読込を確認した。
- [ ] Webの実聴後にTauri版を検討する。

## 再開メモ

TODOを作成してから調査を開始した。第1段階のcore／Native・WASM／独立ラボは実装済み。
通常Playground modeは下記第2段階、独立Synthは第3段階、限定PSID参照CLIは第4段階で対応した。
package-root raw chip factory／Native出力／browserのSID曲再生／RSIDは後続。
`.sid`はC64演奏programとdataを含むため、単体SIDのregister APIと曲再生を別段階にする。
既存の公開済みS-DSP、SDK receipt、npm packageはこのTODO作成時点では変更していない。

## 第1段階の結果（2026-11-06）

- 採用: [chips/m6581の選定メモ](sid_core_selection_01.md)。zlib、6581専用の簡略モデル。
  GPLのreSID／libresidfpは別の比較候補として調査した。8580、実機analog個体差、SID曲再生は未対応と画面・ガイドに表示する。
- `docs/playground/sid-lab/index.html` に独立した **SID Register Lab** を追加した。
  通常PlaygroundのMode一覧に入れたとは扱わない。Play 220 Hz／3声triad／Release gate／Stop、
  Triangle／Saw／Pulse／Noise、ADSR、LP／BP／HP／Notch、cutoff／resonance、Sync／Ring、PAL／NTSC、
  同じcanvasのWaveform／Spectrumを操作する。test note／triad／output gainはsoftwareと表示する。
- `SidCore`と`SidTestInstrument`をcanonical runtimeと公開コピーへ追加。readRegisterは実bus、
  getStateのregister配列は書込みshadow。pin access1回で1cycle進み、その間のPCMを落とさずqueueへ保存する。
  12Hzのsoftware DC blockerを明記した。
- 原本を保持したmarked adaptationで、sample clockの丸め、Sync方向と同時抑止、TEST時のedge残留、
  triple-waveの論理演算、8-bit envelopeのretrigger overflow、C++ cutoff表の並列初期化を修正した。
  詳細は `third_party/chips-m6581/PATCHES.md`、生成は `scripts/prepare_sid_core.py`。
- `npm run test:sid`: **12件成功**。発音、周波数、分割render一致、register access中のPCM保持、
  filter／Pulse／Sync／Ring、release／Stop、無効編集時の保持、dispose等を実WASMで確認した。
- [Native比較](sid_native_01.json): **18ケース・1,881,000 mono frames、最大PCM誤差0**。
  44.1／48／96kHz × PAL／NTSC × 波形・変調／filter sweep／retriggerの3場面。
  self-testで20 clock条件、queue満杯、Sync／TEST／8-bit retriggerの回帰も確認する。
  Native fixtureをASan／UBSanで確認し、C++初期化は別のTSan probeでも8 threads・800 instances・1600回のreset/renderで診断0だった。
- `release/sid-validation/wav/` に自作register列のWAV2本（各2秒、PCM16、clip0）を作成した。
  実ゲームのreference音源ではなく、このcoreを試聴するための出力。
- Source kitだけをZIPから展開して別の出力directoryへ実ビルドし、WASM SHA-256が
  `7069bfb865d51c4b7493560561f42f1f1541555c867c79d969d234ee634b9025` で配布用と一致した。
  WASMは14,502 bytes。原本hash・13個のbuild入力・JS／公開sourceコピーを別receiptで検証する。
- README en／ja／AI、ラボguide、`.github/workflows/sid-lab.yml` を追加した。
  CIはunit／Native／browser／独立ZIPを実行する構成で、GitHub上の実行はまだ行っていない。
  `npm run check:runtime-artifacts` は既存33 SDK builds／66 outputs／73 mirrorsの一致を維持した。
- [Source browser](sid_lab_browser_01.json)と[独立ZIP browser](sid_lab_zip_browser_01.json)は
  **Chromium／WebKit各9項目成功**。実WASMとAudioWorkletで発音・停止・live filter／cutoff／resonance・
  Sync／Ring配線・clock変更・読み込み中Stop・processor障害からの復帰・390px表示を確認した。
  speakerはmute、page／console error・404・外部通信は0。desktop／mobile画像も目視確認した。
- [配布記録](sid_lab_package_01.json): `release/sid-lab-0.0.1.zip`、31 files、75,422 bytes、
  SHA-256 `9d2934aed0f20550e49fdb351392ac484ddac63d818438014bde78266a8ad925`。
  実ブラウザーで再生したpreview ZIPとの違いはTODOのsnapshot2件のみで、全実行asset・元sourceはbyte一致。
  ZIP CRCと原本・Native／WASM source・再ビルド手順の同梱も確認した。

上記は第1段階の記録。通常Playgroundへの接続は下記で完了した。

## 第2段階: 通常Playground（2026-11-06）

- `playground/index.html?mode=c64` に **C64 (SID 6581)** を追加。global `sid`、primary／追加instance、
  `createSoundChip('sid')`／`useSoundChip('sid')`をMain／Workerで使える。default melodyとtriad／filter sweepの3例を用意した。
- `SidSynth`とport clientで3つの実voiceのwave／Pulse幅／ADSR／Sync／Ring／TEST、音階／周波数、shared filter／routing／chip volumeを操作する。
  初期routing0・filter mode off・chip volume8でdry発音。mode offはfilter出力bits0なので、routing7のままでは無音になるhardware semanticsをガイドに明記した。
- SIDタブは3voice、shared filter、written shadowのread-only表示。表示やgetStateはbusをclockしない。
  SID向けのkeyboard audition／tabからの編集は後続。既存のkeyboard対象へ未対応SIDを出さない。
- 予約されたCTRL Gateをvoiceごとに所有し、古いloopの離鍵が新しいownerを切らない。async readRegister／getState後もcaller contextを復元する。
  keyOff／allNotesOffはhardware release、Transport Stopはqueue／envelope／DC尾音をflushして適用patchを保持する。
- modelは6581のみ、creation時clock900,000..1,100,000Hz、出力8..96kHzを検証。異なるclockへのsetClockとNative出力は明示拒否する。
- SID runtime unit **35件成功**（既存Core12を含む）。担当AのMain／Worker／既存音源のfocused回帰は14files・**691件成功**。
  mode／例／source navigation／panelの関連テストと、全mode型・default／3例のcheckJsも成功。
- `npm run build:fm2612` と実tarballの隔離offline install検証成功。403宣言のstrict check、28 WASMのロード／既存音源PCM、
  NodeNext／Bundler／Node ambient無しのbrowser型を確認。SIDの明示型3本を同梱し、raw SDK factoryへSIDを誤追加していないことも型で確認した。npm公開はしていない。
- [Source browser](sid_playground_browser_01.json)と[展開ZIP browser](sid_playground_zip_browser_01.json)で、
  Chromium／WebKit × Main／Workerの**各4構成・各7項目成功**。初期化中Stop、3例、再Run、RPC、cache／追加SID、
  live LP／BP／HPの実PCM変化、同名LoopのApply／古いfinally、SID表示と390pxでFiles非侵食を確認した。
  speakerはgain0。既存MonacoのCDN通信はeditorDependenciesへ分離記録し、想定外の外部通信・page／console error・404は0。
- [配布記録](sid_playground_package_01.json): `release/hello_ymfm_wasm_sid-playground-01_itch_playground_for_run.zip` は
  **993 entries**でitch.ioの1000件上限内。対応sourceを展開したdownload版も作成した。SIDの実行JSは可読のまま保持し、
  重複するSID source-kit scripts／typesは完全なcorresponding-source.zipへ収録する。guideに取り出し方を表示した。
  `prepare_itch_playground_run`7件とruntime artifact／builder／staging29件の検証が成功。
- 固定SDKは33 buildsのまま。SIDは別receipt付きapplication instrumentとして通常catalog／full・Playground profileへ追加し、
  **68 outputs／75 mirrors**を検証する。matching Native／WASM source、原本・license・型と再ビルド手順を同梱した。
- 既存測定JSON／target／他音源gainは変更せず、SIDはunityを明示しunmeasuredKindsへ登録した。
  [SID追加だけのsource receipt](sid_playground_source_revision_01.json)と別pinの復元helperで、既存校正時のsource hashを厳密に維持する。
  20pathsの完全なbefore／after hashと80逆差分を検証し、1byteの将来変更・gain／DSP／WASMの許可外変更を拒否する。
  このreceiptは実機精度やSID音量を測定した証拠ではない。
- 校正／source／legacyの24 test filesは`--test-concurrency=1`で**534件成功**。
  実ファイルを一時変更する拒否テストも含むため、browser／配布検証とは別枠で直列実行した。
  検証前後の336ファイルのhashを比較し変更0、receipt／両policy generatorのcheck成功を確認した。
- [ガイド](../sid.md)、README en／ja／AI、source kit、配布チェック、SID CI workflowを更新した。
  GitHub上のCI実行／commit／push／npm公開／tag作成は今回行っていない。

第2段階終了時の候補だった **SID Synthの鍵盤／3声の割当／shared filter UI** は下記第3段階で対応した。
人がC64 modeの3例とfilterを試聴する作業は残る。
外部sidplayfpや実機との比較、PSID／RSID program実行／register trace、Native SDK／出力は独立した後続として残る。

## 第3段階: 独立SID Synth（2026-11-07）

- 仮称 **Tetorica SID Synth** を `docs/synth-sid/index.html` に追加。
  固定PAL985,248Hz・6581近似の既存SidCore／SidSynthを再利用し、共有runtime／WASM／既存校正値を変更していない。
  固定SDK33 buildsを保持し、runtime artifacts全体の68 outputs／75 mirrors、両Mixer policyのcheckも成功した。
- 通常は3実voiceのround robin。未使用／envelope0、古いrelease tail、古いheldの順に割り当て、stale noteOffを拒否する。
  Sync／Ring時はsilent voice3→carrier voice1の1pair・最大1音。ratio／Pitch／鍵盤割当はsoftwareと画面で区別する。
  RingはTriangleのみ。sourceのGateはOFF、filter routing対象外・voice3offで、位相によるhardware couplingを使う。
- wave／Pulse幅／ADSR／filter／resonance／chip volume／ratio／Pitchのlive編集はheld所有権と位相を保持。
  範囲外のnote／ratio／Pitchはrelease中のvoiceも含め事前検証し原音を保持する。
  Sync／Ring／TEST変更・preset load・Stopはheld／tailをflushしPitch0へ戻す。
  実SIDのrapid Gate／ADSR255のwrap・freeze挙動はraw coreと一致させ、software envelopeの補正を追加していない。
- 最初の鍵盤／Enable時だけaudioを作る。startup中の離鍵・Stop、fatal後の無音化と明示retry、FIFO ACKを検証した。
  coalesceされたload／topologyのreset義務をlatestへ継承し、古いStop ACK／連続invalid Pitch／未ACK draftでheld keyを失う競合も修正した。
- compact keyboard／Octave、2箇所Pitch、stepper／slider、演奏を妨げないfocus、折りたたみ、post-Master Waveform／Spectrumを接続。
  Masterは0..380%、100%超はorange。filter modeの選択で自動Enableし、OFF時はdryへrouteする。
  strict v1 JSONは最大64KiB、cancel／invalidは既存presetを保持。Copy JavaScriptは同じC64 APIで試奏できる。
- `npm run test:sid-synth`: **42件成功**。実WASM44.1／48／96kHzで独立した手書きregister列とのPCM完全一致、
  Copy JavaScriptの実行・PCM一致、割当／尾音／配線／live編集／atomic reject／startup取消／UI競合を確認した。
  最終CSS変更後にも配布テスト2件を再実行し成功。
- [Source browser](sid_synth_browser_01.json)／[実ZIP browser](sid_synth_zip_browser_01.json)は、
  **Chromium／WebKit各11項目、計44チェック成功**。実PCMのfilter変化、380%とMaster比率、rapid load／topology、
  error復帰、390pxの横overflow0、閉じたpanelの高さを確認した。page／console／HTTP error・外部通信は0。
  speakerは最終gain0で無音化し、人の実聴は行っていない。Stop後の実PCMはRMS／peak0。
- [配布記録](sid_synth_package_01.json): `release/tetorica_sid_synth_0.0.1_itch.zip`、
  **57 files／234,160 bytes**、SHA-256 `93b905423e26d7b33b8e5c8a1713a94ca05e1e35077b109643b354000779d501`。
  可読JS／CSS14 modules、26個の元browser入力とhash receipt、元WASM、13個のNative build入力、原本／license／再ビルド手順を同梱。
  独立した2回のpackagingでZIP byte一致、全元入力と最終sourceのhash一致、CRC、local import／WASMのclosureを確認した。
- README en／ja／AI、両home、feature status、Synth guide、配布手順と `.github/workflows/sid-synth.yml` を更新。
  GitHub上のActions実行・commit／push・tag・公開は行っていない。

次は人が `/synth-sid/index.html` で3声、Pulse幅、ADSR、filterのCutoff／Resonance、TriangleのRingとSyncを実聴する。
名称案はTetorica SID Synth、専用iconは上記で作成した。Webの実聴後にTauriを検討する。
SID曲／音色抽出、外部reference／実機比較、Native出力は別TODOとして残る。

### 選択iconの採用（2026-11-07）

- ユーザーが選択したbeige／brownの1254px WebPをheader、favicon／Apple touch、英日homeへ適用。
  desktop112px／mobile72pxで表示し、音声JS／WASMは変更していない。
- 配布は同じWebPをlocal同梱し、root／nested entry両方のhref／srcを調整。
  元WebPと生成プロンプトをsource archive／hash receiptへ含め、PNG原本はrepositoryへ保持する。
- 配布テスト2件成功。[Source](sid_synth_icon_browser_01.json)と[実ZIP](sid_synth_icon_zip_browser_01.json)は
  Chromium／WebKit各12項目、**計48チェック成功**。画像3参照のSHA・1254角、homeの参照、1180px／390pxの横overflow0、
  従来の演奏／filter／preset／停止も確認した。page／console／HTTP error・外部通信0、speakerはmute。
- [配布記録](sid_synth_icon_package_01.json): `release/tetorica_sid_synth_0.0.1-icon_itch.zip`、
  **57 files／1,301,238 bytes**、SHA-256 `a7001d835a0893c6c9aea4f86373bf2bb867fb502fcc148b7461f9a1716260a0`。
  WebPは元とbyte一致、27個のbrowser入力も最終sourceのhashと一致する。旧0.0.1のZIP／検証記録はその時点のsnapshotとして保持した。
  CIの監視対象にもicon／生成記録／両homeを追加した。commit／push／公開は行っていない。

## 第4段階: 外部PSID参照／比較CLI（2026-11-07）

- [手順・対応範囲](../sid-reference.md)。`npm run sid:reference -- --fixture melody-filter --seconds 2`
  で自作PSIDを実C64 programとして実行し、PHI2 cycle付きのSID write、参照／Tetorica／DC前のfloat WAVと比較JSONを保存する。
  `npm run sid:reference -- ./my-tune.sid --subtune 1 --seconds 10 --offline` も使える（先に参照toolをbuildする）。
  毎回uniqueなdirectoryを作り、入力・既存の測定・WAVを上書きせず、deviceは開かない。
- 外部toolはGPL-2.0-or-laterのlibsidplayfp **3.1.2**（`b1e8f1deedf41d343123319237c0d008d72cbea7`）と
  libresidfp **1.2.3**（`32c8525418a643eaed8dfafa3d7039e250050cfa`）。official release archiveのSHAを固定する。
  [license／再ビルド](../../third_party/sid-reference/README.md)・GPL通知・元archive・marked patchのbefore/after hashを保持。
  参照専用GPL adapterを別processにし、browser／npmのentry closureや既存SDKへ追加していない。
- 元libresidfpのfilter table初期化が並列に共有dither stateを更新して微小な実行差を出すことを確認し、
  参照toolだけに **serial-table-init** patchを適用。初期tableの順序だけを固定し、DSP式／gain／sampling式は変えていない。
  engineを`1.2.3+serial-table-init`と識別する。36回の4profile／3rate／chunk・repeat検証でPCM／write列が一致し、
  patch前後のCPU write列も同じだった。両hostの初期register／volumeは0に揃え、上流から要求されたreset volume15は別metadataで保持する。
- 初版は **PSID v2・単一SID・明示PAL／6581・全VBI・relocation0・RAM$0800..$CFFFのexplicit init/play**。
  ROM dump／ゲーム音楽を同梱せず、upstream KERNAL stubで動く自作programを使う。
  parserのv3/v4 metadata対応と実行subsetを区別し、RSID・CIA速度・IRQ play0・NTSC／8580・追加SID等は理由付きで拒否する。
  実ゲームdriverのROM独立性や完全再現をheaderだけで保証していない。
- `tetorica-sid-trace` v1は32MiB／最大100万write、clock985248Hz、cycle0からtick後commit、終端exclusive。
  同cycle重複・逆順・範囲外・coercion・非JSON metadata等を拒否し、RO／reservedを含むreg0..31や同値writeも省略しない。
  読込はfdを固定して上限+1byteまでに抑え、file成長でも無制限にreadしない。compact保存と読込の上限を一致させた。
- 新Native replayerは既存patched m6581を直接tickし、write中のsampleを含め全部回収する。
  既存12Hz DC後／rawを分け、render()でwrite時刻をsample境界に丸める処理をしない。
  実WASMと44.1／48／96kHzでPCM・register・ENV・phaseが一致し、chunk1／17／128／4096／8192でも同一。
- 参照clock985248.611111／sampling float985248.625とTetorica整数985248を別記する。
  参照の2段RESAMPLEの1/1024周期量子化により、48kHz指定でも実効約48010.4765Hzとなるframe差を保存する。
  CPU eventの終端overshootと、SID自身を指定cycleでclampする処理も区別した。
  元PCMのgain／DC／位相／長さを補正せず、共通index範囲のRMSE・correlation・level／bandを診断値として出す。
  waveform・filter等の差は別model間の測定結果であり、実機一致の合否には使わない。
- `npm run test:sid-reference`: **29件成功**。PSID／trace異常系、元bytecode、実WASM、time／chunk／DC、
  float WAVの非clip保存、compiler／flags／OS／archのcache改変拒否、bounded読込を確認した。
- [統合結果](sid_reference_comparison_01.json): **6ケース＋完全repeat＋init0の2load形式** が成功。
  toneを44.1／48／96kHz、pulse／noise／melody-filterを48kHzで実行し、各init36write＋play順が期待値と一致した。
  既知A4のpitchも確認。player event chunk4096→1／render chunk4096→1でtraceと両backendのPCMが完全一致。
  initAddress0がeffective loadへ解決されることを、embedded／explicit loadの実CPU実行・PCM一致で確認した。
- `.github/workflows/sid-reference.yml`、README en／ja／AI、SID guide／feature statusを更新。
  固定SDK33 builds／全68 outputs／75 mirrorsと、両Mixer policy checkも成功。runtime／WASM／校正値は変更していない。
  GitHub上のCI実行・commit／push・npm／Web公開は行っていない。

再開時はまず上記コマンドと比較用WAVを使う。次は実ゲームの対応subset PSIDでdriver依存と実聴を確認する。
その結果をもとにbrowserでの曲再生／状態表示、時変parameterを含む音色取り込みを設計する。
CLIの比較結果をSynth音色の完全復元や実機精度と呼ばない。

参考: [VGM specification](https://vgmrips.net/wiki/VGM_Specification)、
[HVSC](https://hvsc.c64.org/faq)、
[sidplayfp manual](https://github.com/libsidplayfp/sidplayfp/wiki/sidplayfp)。
