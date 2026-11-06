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

- [ ] sidplayfp等を用いた外部再生／WAV比較手順を用意する。6581／8580、PAL／NTSCを合わせる。
- [ ] PSID／RSIDのprogram実行を扱う既存engineとlicense・ROM依存を調査する。
- [ ] SID再生またはtimed register trace取得を試作する。既存VGM Player／Analyzerへの統合先は、この結果で決める。
- [ ] 後続: voiceの設定と時間変化を試奏用に取り込む。snapshotだけで元のinstrumentを完全復元したとは表示しない。

## 4. Synth／配布

- [ ] 既存FM2612／SPU／DMG等と同じ操作感で、3声の割当、wave／Pulse幅、ADSR、shared filter、Sync／Ringを操作する。
- [ ] shared filterと実voice間の依存、hardware機能とsoftware割当・modulationを区別する。
- [ ] preset保存／復元、可読JavaScript出力、keyboard focus、2箇所Pitch、Master380%、waveform／spectrumへ接続する。
- [ ] readable source付きWeb ZIP、README en／ja／AI、home、Native例を更新する。名称・iconは後で決める。
- [ ] Webの実聴後にTauri版を検討する。

## 再開メモ

TODOを作成してから調査を開始した。第1段階のcore／Native・WASM／独立ラボは実装済み。
通常Playground modeは下記第2段階で対応した。package-root raw chip factory／Native出力／Synth／SID曲再生は後続。
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

次は人がC64 modeの3例とfilterを試聴する。実装候補は **SID Synthの鍵盤／3声の割当／shared filter UI**。
外部sidplayfpや実機との比較、PSID／RSID program実行／register trace、Native SDK／出力は独立した後続として残る。

参考: [VGM specification](https://vgmrips.net/wiki/VGM_Specification)、
[HVSC](https://hvsc.c64.org/faq)、
[sidplayfp manual](https://github.com/libsidplayfp/sidplayfp/wiki/sidplayfp)。
