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

### 今回の続き: 複数波形をSynthへ取り込む（2026-11-08）

ユーザー承認: Combined waveformsの取り込み制限を外し、複数波形の選択・API・Preset・取り込みを対応させる。
追加指摘: 固定CHのNote On→Note Onで再発音できず、一度Offにする必要があるように感じる。後にユーザーが再確認して「今試したら大丈夫」と回答したため、再発音の挙動は維持する。

- [x] 高級API／型で全16通り（Offを含む）の波形maskを扱い、単一波形のregister／PCM互換と可読runtime／配布mirrorを維持した。
- [x] 旧Preset互換のまま組み合わせを保存・復元する。SID snapshot／Auto反映では全15通りの非zero maskを受理し、TESTや依存関係の制限は保持した。
- [x] 同じWaveformボタンを独立On／Offへ変更した。Pulseを含めばPulse widthが有効になり、Triangleを含むRingにも対応する。Round robinでは編集した波形bitだけを全CHへ反映する。
- [x] 固定CHの再発音で既存のGate Off→Onと発音所有権を確認した。通常ADSRで両model・全CHが再発音するため、ADSR／音源coreは変更していない。
- [x] Synth unit167件、Player unit139件、API／Main／Worker30件が成功。source／ZIPのChromium／WebKitで取り込み・保存・全mask・既存CH／Pause・更新互換・Player受け渡しを検証し、確認用フォルダーを最終ZIPと全265ファイル一致へ更新した。

結果・配布候補: [複合波形の編集・取り込み](sid_synth_combined_waveforms_result_01.md)。commit／push／公開は未実行。

### 今回の修正: Round robin選択だけでCH設定を揃えない（2026-11-08）

ユーザー指摘: Round robinを押しただけで個別設定が失われる。選択時は保持し、編集して初めて3CHへ反映したい。

- [x] Round robin選択・保存／復元では異なるCH設定を保持する。通常の編集は変更した項目だけを3CHへ反映し、明示的な音色loadは音色全体を反映する。
- [x] 各CHの音色でRound robin発音できるようにした。Sync／Ringは先頭の該当CHと物理的な前段sourceの1pair制限とし、他の保存設定を保持する。自動採用は実際の値が変わった時だけ行う。
- [x] unit162件、source／最終ZIPのChromium／WebKit計172項目とZIP更新互換10項目が成功。異なる実register・編集項目だけの反映・保存復元・Auto／Pause選択時の保持を確認し、指定フォルダーを更新した。

結果・配布候補: [Round robin選択時の設定保持](sid_synth_round_robin_preserve_result_01.md)。同じURLを再読み込みして試せる。commit／push／公開は未実行。

### 今回の続き: 設定と鍵盤のCHを統一する（2026-11-08）

ユーザー確認: CH 1／2／3では設定・鍵盤・発音先をその物理CHへ統一する。
Round robinでは設定を3CHすべてへ反映し、鍵盤を3CHへ順番に割り当てる。
従来のLive専用CH選択は置き換え、チェックは「再生中の設定を自動反映」とする。

- [x] CH別の設定を保持し、固定CHの編集・単音発音、Round robinの全CH反映・3声割当を実装した。model／filterの共有とSync／Ringの物理的な前段CHを維持する。
- [x] CH選択を常時使用可能にし、Auto update from song・Pauseの設定保持・曲から鍵盤への切替を接続した。Round robin時は直前の明示CHを観察元とし、古い観察や明示loadとの競合を防ぐ。
- [x] 従来のvoice Presetを維持し、3CHとtargetを保存するchannel setup・復元・選択した物理CHのCopy JavaScriptを追加した。
- [x] unit154件、source／独立ZIPのimport・Pause・更新互換と既存鍵盤のChromium／WebKit計224項目が成功。35可読module／196原入力の一致、263ファイルの配布と指定の確認用フォルダー更新を確認した。

結果・配布候補: [CH設定・発音先とRound robin](sid_synth_channel_settings_result_01.md)。同じ `localhost:8793/itch_sid_synth_dev-wVDGAN/` を再読み込みして試せる。commit／push／公開は未実行。

### 今回の続き: 実SafariでLive中のPauseクリックが反応しない（2026-11-08）

ユーザー指定の `localhost:8793/itch_sid_synth_dev-wVDGAN/` で再現した。
配布ファイルは正本と一致し、アクセシビリティ操作ではPauseできるが、
Live更新をまたぐ120ms／250msのマウスクリックでは再生が続く。
毎回同じボタンのtextContentを置換する更新との関係を検証する。

- [x] Live観察で変化していないボタンのラベルを置換しないようにした。Pause／Resumeの音声処理とchip状態は保持する。
- [x] 押下中に複数のLive更新をまたぐマウス操作の回帰検証を追加。source／独立ZIPのChromium／WebKit計156項目、unit135件が成功した。
- [x] ユーザー指定の配布フォルダーもmatching source／receipt込みで更新し、実Safariの同じURLで120ms／250msのマウスPauseとResume、位置の保持を再確認した。

結果・配布候補: [実SafariのPauseクリック修正](sid_synth_safari_pause_click_result_01.md)。タブはRollin.sid・Master70%・Live On・Pausedで残した。commit／push／公開は未実行。

### 今回の続き: SynthでPauseが拒否されResumeが出ない更新不整合（2026-11-08）

実画面 `localhost:8791/synth-sid/index.html` で `SID pause failed: Unknown SID command: pause` を確認した。配信中audio.jsにはpauseがあるため、ブラウザー内の旧audio moduleと新UIが混在している可能性が高い。表示があると断定せず、実画面で成功を確認する。

- [x] Synth entry／controller／共有audio facade／Workletを同じ`sid-transport=2`で読む。独立ZIPのroot HTMLもqueryを保持するよう修正し、WASM／Native資産は変更しない。
- [x] Workletの起動時にprotocol 2と全6commandを確認し、不一致は再生前にReload案内を出してcontextを終了する。
- [x] 旧facade残存と旧ready応答を再現するfocused検証がsource／ZIP・両engineで20項目成功。既存の読み込み／Pause等152＋通常Player70＝合計242 browser項目、Synth135＋Player138＝273 unitが成功した。可読配布とCIも更新。
- [x] 実際のChromeで同じFroehn.sidを開き、Pause→Resume表示→再開と位置進行→再Pauseを確認した。元のタブを残し、修正版を別タブ・Master70%・Pausedで保持した。

結果と再開手順: [更新不整合の修正](sid_synth_transport_upgrade_result_01.md)。起動済みの旧ページは再読込が必要。実測したHTTP cacheの挙動と、制御した旧URL／旧ready応答のシミュレーションは区別する。

### 今回の続き: SID試聴のPause／Resume（2026-11-08）

ユーザー承認: 変化の速い音色を狙って取り込めるよう、再生を一時停止し、同じUIでCHを確認・Captureして続きから再開する。

- [x] 専用Pause／Resumeを追加し、Pause ACK以降は同じC64／SID instanceの進行を止め、Resumeで続きから再生する。Stop／再loadと区別し、Native DSP／WASM／固定SDKは変更しない。
- [x] 一時停止時の一貫したWorklet状態を共通UIへ固定表示する。停止中のCH切替・Live On／Off・Captureを可能にし、Capture結果と止めた時点の状態を一致させる。
- [x] Pause／Resume中のStop・file／subtune／model変更・古い応答・previewエラー・dispose・鍵盤への切替で所有権を守る。Master変更で停止中の出力が復帰しないようにする。
- [x] 一時停止／再開に限る5msのhost出力bridgeを加えた。Pause中はchipをclockせず、通常再生・元のchip状態や進行は変更しない。
- [x] 実6581／8580・VBI／CIA／RSIDの保持・再開PCMを確認した。unitはSynth135＋Player136＝271件、Chromium／WebKitのsource／独立ZIPと通常Player回帰は計286項目が成功。README・CI・可読配布・再開記録を更新した。

結果と再開手順: [Pause／Resume](sid_synth_pause_result_01.md)。`Play song → Pause → CH確認／Capture → Resume`。CaptureしたVoiceを選ぶと試聴を閉じて鍵盤へ取り込む。実聴・長時間・実Safari／WKWebView、commit／push／公開は後続。

### 今回の続き: Liveも編集と同じUIで表示する（2026-11-08）

ユーザー指摘: Live時に別の表へ切り替わると、どの項目が変わったか把握しにくい。同じ配置のつまみ・ボタンを使って追従表示する。

- [x] 同じeditor DOMをLive／編集で共有し、波形・Pulse width・ADSR・Filter・Sync／Ring／TESTの値をその場で更新する。折りたたみ状態と要素の位置を保持する。
- [x] Liveでは観察専用にし、曲や作成中Presetへ書き込まない。合成波形・無音routing・範囲外ratioも偽のPresetへ丸めず表示し、編集へ戻すと元の楽器を復元する。
- [x] 周波数・Gate・観測Envelope等の補助情報は同じ操作部の下へ簡潔に残し、変化が分かる表示にした。
- [x] 長い操作説明は各セクションの「？」から開く。初期状態では閉じ、Live更新やモード切替で勝手に開閉しない。閉じたカードの「？」でも説明を確実に開く。
- [x] unit 122件、Chromium／WebKitのsource／独立ZIP計176項目が成功した。同一DOM／相対配置・追従値・編集復帰・非対応状態・既存操作と可読配布を確認し、READMEと再開記録を更新した。

結果と再開手順: [共通のLive UIと「？」ヘルプ](sid_synth_shared_live_ui_result_01.md)。配布候補も更新済み。実聴・実Safari／WKWebView、commit／push／公開は後続。

### 今回の続き: Voice選択で即反映と再生CHのLive表示（2026-11-08）

ユーザー指摘: Use Voiceの追加操作は不要。曲は波形・ADSR等を頻繁に変えるため、瞬間のCaptureだけでは音作りの動きが分かりにくい。

- [x] Use Voiceボタンを除き、CaptureしたVoiceを選ぶとそのまま楽器へ反映する。非対応Voiceは理由を表示して現在の楽器を保持する。
- [x] 再生中の指定CHを継続観察するLive表示を用意した。波形の全flag・周波数・Pulse width・ADSR code・Gate・Sync／Ring／TEST・観測可能なEnvelope・共有Filterとroutingを表示する。
- [x] 観察は既存Workletのreadだけを用い、楽器・曲・DSPへ書き込まない。50ms以上の間隔と1 read待ちで通信を制限し、Stop・曲変更・取消・切替・dispose後の古い応答を反映しない。
- [x] ユーザーの配置選択に従い、Your soundをLive表示／編集で切り替える。追従On／Off・CH切替・snapshot選択の意味とCapture時刻を表示し、Presetへ変換できない合成波形等も観察できる。
- [x] unit 116件とChromium／WebKitのsource／独立ZIP計160項目が成功した。選択即反映・変動CH・追従停止・非対応候補・既存導線と可読配布を確認し、README／記録を更新した。

結果と再開手順: [Live CH表示・Voice選択](sid_synth_live_ch_result_01.md)。Liveは最大20回／秒のsample表示で、書き込み全履歴の記録や時変音色の再構築ではない。実曲の実聴・長時間確認、commit／push／公開は後続。

### 今回の続き: SID SynthからSIDを直接開いて音色を取り込む（2026-11-08）

ユーザー指摘: SynthにはSIDファイルの入口がなく、PlayerでPresetを保存してから読み込む別画面の手順しかない。Tauri化の前にSynth内の導線を追加する。

- [x] 既存Playerのmodel選択・PAL single-SID PSID／RSID検証・C64再生・snapshot変換を再利用する。最初はROM不要のC64経路に限定し、非対応候補の理由と既存Playerへの案内を出す。元headerや曲を自動で書き換えない。
- [x] 折りたためる「Sounds from SID」へLoad SID／subtune・model選択／曲の試聴・停止／Capture voices／3voice候補とUse Voiceを追加した。同じSynth画面から試奏・編集・Preset保存・Copy JavaScriptまで使える。
- [x] ファイル選択・失敗・取消・subtune／model変更・古いread／起動中Stopで現在の楽器や確定済みsnapshotを壊さない。既存のSynth鍵盤と試聴曲が意図せず重ならないようにし、pointer操作後は演奏focusを返す。
- [x] file loadは音声を開始せず、明示Playで試聴する。Captureは現在のregister設定であり、曲の時変instrument／元pitch・elapsed Envelope／phaseを完全復元したとは表示しない。Sync／Ring・TEST／合成波形・無音routing等の既存対応範囲と理由を維持する。
- [x] 制御の競合・bounded input・実6581／8580のPSID／CIA／RSID・bad file／cancel／Stop／古い応答・取り込んだ音の保存復元をunitとChromium／WebKit・source／独立ZIPで検証した。unit 100件、browser計136項目が成功。
- [x] 追加Player WASMとmatching source／license・再build kitをSynth ZIPへ同梱し、可読moduleを保った。README en／ja／英語AI・guide／CI／再開記録を更新し、固定SDK／既存校正は保持した。commit／push／公開は未実行。

結果と再開手順: [SID直接読み込み](sid_synth_direct_import_result_01.md)。`Sounds from SID → Load SID… → Play song → Capture voices → Voice選択 → Use Voice`で使う。実ゲームSIDの実聴・長時間・実Safari／WKWebViewと、Tauriへの取り込み・公開は後続。

### 次の実装順序とFilter組み合わせ（2026-11-07）

ユーザー承認: まずSID SynthのLP／BP／HPを独立On／Offにし、その後に8580代表実曲のAudioWorklet検証、通常Playerの6581／8580切り替え、Synthのモデル選択・Preset／API対応の順で進める。

- [x] 共有FilterのLP／BP／HPを独立したボタンにした。同じCutoff／Resonanceを共有し、出力を加算する実機の組み合わせを扱う。NotchはLP＋HPとして旧Preset互換を維持。
- [x] 高級API・型定義・Main／Worker・Preset保存／読み込み・Copy JavaScriptへ全組み合わせを通した。全モードOffはSynthではbypassとし、フィルター有効化時に選択がなければLPから始める。
- [x] 実WASMとブラウザーで各組み合わせ・live edit・既存Preset互換・演奏keyboardへのfocus影響・可読配布を確認した。Synth46＋runtime20件、ソース／実ZIPのChromium・WebKit計52項目、Playground型検証が成功。[結果](sid_synth_filter_result_01.md)。
- [x] 8580の代表実曲を実AudioWorkletでVBI／CIA／RSID・複数subtune・停止／再開まで確認した。3曲×2subtune×Chromium／WebKitの12ケースを各30秒完走。[結果](sid8580_real_worklet_result_01.md)。実聴・長時間・音切れ判定は別確認。
- [x] 通常SID PlayerのAuto／6581／8580 Preview選択と稼働model表示へ接続した。元header宣言と選択modelを分けて保持。[結果](sid_player_models_result_01.md)。
- [x] SID Synthの単体8580 core・model選択・Presetのmodel保存・API／型／Copy JavaScriptへ反映した。旧Presetは6581互換とし、未提供のvoice envelopeを0扱いしてreleaseを切らない。下の今回の続きに検証・配布記録を保存した。

### 今回の続き: 8580代表実曲のAudioWorklet検証（2026-11-08）

ユーザー承認: Filter組み合わせの次として、`ww/C64Music`から8580の代表実曲を選び、研究用Labの実AudioWorkletで確認する。通常Player／Synthのmodel対応は、この結果を確認してからの次段階とする。

- [x] 実行前に選定規則・file hash・元header・subtune・VBI／CIA／RSIDの分類を固定した。全3曲は元PAL／8580・v2 single SID、header書き換え／実行結果による差し替えなし。[Plan](sid8580_worklet_cases_plan_01.json)。
- [x] Chromium／WebKitで各代表caseを30秒再生し、全12ケースの有限・非zero出力、CPU／SID進行・Worklet処理時間を記録した。物理出力はgain0、ゲーム曲／PCM／ROMの保存・配布なし。[Report](sid8580_real_worklet_01.json)。
- [x] 3曲すべてで2subtuneの切り替えを確認し、停止／再開と不正候補時に旧実曲再生を保持する確認も3曲×2engineの6組で成功した。
- [x] 実行失敗0・無音0として全caseを保持し、再開手順・人の実聴用候補を[結果](sid8580_real_worklet_result_01.md)へまとめた。通常Playerへの採用・全曲互換・音質の合格とは区別する。
- [x] 後続: WebKitのcapture内予算超過248／62,016blocks（約0.40%、instance最大9ms）を、通常の無計測再生・観測負荷・timerと分けて比較した。下記80条件の結果は[別記録](sid_worklet_perf_result_01.md)。旧9msの原因や実際のdevice underrunを確定したとは扱わない。
- [ ] 人の実聴・長時間／background／device切替・高負荷・実Safari／WKWebView確認は残す。

### 今回の続き: WebKitの通常再生と観測負荷の切り分け（2026-11-08）

ユーザー承認: 6581／8580の通常再生と計測ありの負荷を比較し、以前の研究Labで観測した処理時間超過の原因を調べる。先にTODOへ範囲を記録し、計測値から実際のdevice underrunや実聴の合格を推定しない。

- [x] 旧Labのtimer／PCM scanと通常Playerのprocessor／画面poll・visualizerの差を確認する。`Date.now`の粗さ・非単調性、wall timeとCPU時間、audio論理clockと実時間を区別する。
- [x] 通常Playerを使う再現可能な比較tool・固定planを用意する。processor無改変の通常再生／軽い時間計測／同じ計測＋旧方式のPCM全frame scan／画面監視を抑えた計測を比較し、通常再生にはper-block timerやscanを混ぜない。実行順・warmup・sample rate・反復・入力hashを実行前に固定する。
- [x] 自作の同一programを元から6581／8580として生成して比較し、実曲は旧planの元PAL／8580宣言を保持する。header書き換え・成功曲への差し替え・曲／ROM／PCMの保存・配布はしない。
- [x] WebKitを中心に、Chromiumを対照として実AudioWorkletで有限・非zero出力／停止／状態進行と測定の負荷を確認する。無計測baselineには処理時間の数値を付けず、timer source／量子化の不確かさ・warmup／測定区間・観測回数を保存する。ブラウザーは逐次実行して相互負荷を避ける。
- [x] 実測で原因が特定できた範囲だけ改善し、関連unit・source／必要なら実ZIPを検証する。実装を変える根拠がなければ診断tool・根拠・残る限界を整理する。DSP／WASM／固定SDK／校正値を不用意に変更しない。
- [x] 結果・再実行手順・次の人の実聴項目を保存し、旧reportを保持する。commit／push／公開は別とする。

実行前に固定した範囲:

- [Plan `_02`](sid_worklet_perf_plan_02.json): 自作2model＋旧8580 planのVBI／CIA／RSIDの計5入力、4モード、正順・逆順の2反復、WebKit→Chromium逐次の80実行。全3実曲は元のpath／hash／model／subtuneを保持する。旧`_01` planはpilot履歴として残す。
- 計測3モードのwarmupは345blocks／44,160frames、測定は1,723blocks／220,544frames。通常再生はWorkletを無改変に保つため約1秒＋5秒のmain-thread待機と実際のRPC境界を記録する進行対照であり、同一PCM窓や処理時間を測ったとは扱わない。captureのPCM集計はwarmupを含む264,704frames、時間histogramは測定窓だけと明記する。
- `scripts/check_sid_worklet_performance.mjs`はHTTP応答だけに計測subclassを加え、原本processor／DSP／WASMを変更しない。ケースごとにcheckpointを保存し、`--resume`で入力・source一致を確認する。quiet-uiのpilotではtool自身のRAF待機が停止する問題を見つけ、startup待機を明示polling、測定完了を単一Worklet eventに直した。新pilot4条件は全成功。
- [再実行・解釈のガイド](../sid-worklet-performance.md)。本測定は`docs/issues/sid_worklet_perf_01.json`へ保存。`record()`は固定配列へ集計し、粗い時計と不正値を分ける。metrics unit7件成功。性能の実行中は別browser／compilerを並列起動しない。

結果と再開情報:

- [全80実行](sid_worklet_perf_01.json)が完走。無計測20件は時間`null`、計測60件は13,232,640frames、全frame scanはwarmup込み5,294,080frames。終了境界の80標本は有限・非zero、全context終了・error／HTTP失敗／外部request0。10組×6計測の固定境界で、再生位置・cycle／IRQ／NMI／play counter・target metadataの観測subsetが一致。完全なCPU／RAM／SID内部状態やPCMの一致とは扱わない。
- [厳密集計](sid_worklet_perf_summary_01.json)と[独立再計算](sid_worklet_perf_verification_01.json)が一致。WebKitのtimerのみ平均0.586ms／目安2.902ms、窓内最大3ms。全計測モードを合わせた生閾値超過31blocksのうち24は名目1msの分類で境界が変わり、残る7もdevice underrunではない。Chromiumの生閾値超過は0だが、音切れなしの保証にはしない。
- quiet-uiは同じcase・反復のtimedより20組すべてで平均wall spanが高く、画面を消せば改善する結果は得られなかった。全frame scanを加えたprocess()平均の差は正負が混在。2反復・制御外のOS／JIT／電力状態から因果は断定せず、旧Labの0.40%との率差を改善率にしない。[結論と測定表](sid_worklet_perf_result_01.md)。
- 製品DSP／WASM／UIを変更すべき不具合は特定できなかったため、製品へ常時計測や監視無効化を追加していない。[変更範囲](sid_worklet_perf_scope_01.json)で27製品assetのHEAD／実行中hash一致と、既存Player176／Synth160原本の一致を確認。既存`waveoff-20261108.1`のZIPを再生成する必要はない。
- 診断unit12件、CLI構文、CI YAML、diff check、SDK33 builds／68 outputs／75 mirrors・両Mixer freshness check成功。CIにはarchive不要の純粋テストと構文確認を追加し、実曲performance閾値をCIの合否にしていない。commit／push／GitHub Actions実行／公開は未実施。実聴、長時間・background・device切替・実Safari／Tauri実環境は別の確認項目。

### 今回の続き: 通常SID Playerの6581／8580選択（2026-11-08）

ユーザー承認: 代表実曲検証の次として、通常SID Playerへ6581／8580の選択を追加する。8580は試作modelとして表示し、Synth／Playground／SDKのmodel対応は別段階とする。

- [x] ModelをAuto（file declaration）／6581／8580 Previewから選択可能にし、元headerと稼働modelを分けて表示した。Autoは既知宣言を使用し、未指定／eitherは既定Onの補完設定でPAL／6581。既知宣言との不一致は理由付きで拒否する。
- [x] 既存6581 validator／CLIを保持し、8580を専用の二つのWASMへ接続した。PAL・single SID v2・C64 machineに限定し、8580 Direct VBI／NTSC／multi-SIDの非対応を明示。研究用filter補正はOff。
- [x] Main preflight／AudioWorklet／停止・subtune・失敗時の旧再生保持／ROM snapshotを接続した。8580の未提供Envelopeはdash表示。失敗したmodel draftは成功したsubtune選択／Stop時にaccepted表示へ復元する。
- [x] unit110件、ソース／実ZIPのChromium／WebKit各35項目・計140項目、通常Playerでの実曲pilot6ケースが成功。既存corpus10／reference29件も成功。[結果](sid_player_models_result_01.md)。
- [x] 可読ZIPへmatching 4WASM／99入力の8580 source／生成器／license・toolchain noticesを同梱。配布7項目照合成功、README en／ja／英語AI・home・guideとCI監視pathを更新した。[配布proof](sid_player_models_package_01.json)。

### 今回の続き: SID Synthの8580選択（2026-11-08）

ユーザー承認: 通常Player対応の次として、Synthの6581／8580選択・Preset保存・API／型・Copy JavaScriptを進める。

- [x] 既存endpoint WASMにある`sid8p_*`の単体chip batch APIを再利用してCPU不要の8580 Coreを追加した。C64 machineやchip-cycleごとのJS loopをSynthへ持ち込まず、既存Rust／DSP／Player WASMは維持した。
- [x] 不明Envelopeを0と判定せず、release尾のPitch追従と3voice割当を保守的に扱う。metadataは最大3slotsに限定し、不明な離鍵済みvoiceの音域外チューニングが現在の演奏を不当に妨げないようにした。
- [x] model選択を既存Shared SID filter内のボタン形式へ追加し、切り替え時は保持音とPitchをリセットする。準備失敗・Stop・古いACKを検証し、失敗後も実際の旧coreをreadしてPitch表示を復元する。
- [x] Preset v2へmodelを保存し、v1は6581として読み込む。Copy JavaScriptは8580の追加instanceを実際に作成できるようにし、対応する高級API・型・Main／Worker／Worklet接続を揃えた。
- [x] 既存6581のPCMと操作を維持し、8580の実WASM・全Filter組み合わせ・Sync／Ring・release／再発音・切替／取消・Preset／コード出力をunitと実browserで確認した。
- [x] 可読Synth ZIPへmatching source／WASM／license noticesを同梱し、Playground配布の必要資産と型・calibration freshnessも確認してREADME／AI引継ぎと再開記録を更新した。

検証と再開情報:

- `npm run test:sid-synth` **62件成功**。runtime／Main／Worker／Worklet／実WASM／Playground配布準備の関連テストは **217件成功**。独立`sid8e_tick`とのPCM一致、44.1／48／96kHz、frame分割・access時のsample保持、全8filter mask、null観測、未知release尾、model交換・取消を含む。Playgroundのモード別型チェックも成功。
- Synthの[Source](sid_synth_8580_browser_01.json)／[実ZIP](sid_synth_8580_zip_browser_01.json)はChromium／WebKit各16項目、**計64項目成功**。1180px／390pxでmodelボタン・表示も目視確認した。Playgroundの[Source](sid_synth_8580_playground_browser_01.json)／[実ZIP](sid_synth_8580_playground_zip_browser_01.json)は両browser×Main／Workerの各8項目、**計64項目成功**。Copy JavaScriptの8580追加instanceが実PCMを出し、primary6581を変更しないことを確認した。物理出力はgain0で、実聴・長時間・音切れの合格とは区別する。
- [Synth配布proof](sid_synth_8580_package_01.json): `release/tetorica_sid_synth_20261108-8580.1_itch.zip`、**193files／2,504,611bytes**、SHA `6f9b305f011345554096ae99a499da2d088ef3a6e7b3813f6009912bbfc8a540`。159 original inputs、readable JS／型、99 compiled inputsのmatching native kit・2WASM・license／toolchain noticesを同梱。ZIP CRC・全展開byte・原本hashを確認。
- [Playground配布proof](sid_synth_8580_playground_package_01.json): `release/hello_ymfm_wasm_20261108-sid8580.2_itch_playground_for_run.zip`、**1000files／directory記録0**、SHA `875cc1b02fedb9f420a3435784fa32229ab0d31b12d2e36591f92e1385302573`。itch.io上限以内。matching8580 kitは既存`corresponding-source.zip`へ全体を保持し、303 sourcefilesの原本byte・127 source／notice hashを確認。JS音源module・WASM・型は個別の可読fileを保持し、通常download用ZIPではnative sourceも展開状態。full ZIPのCRC・全byte一致も成功。
- 最終ZIPは案内・sourceリンクとlicense概要だけを整えて再梱包した。上記browser検証済みZIPと全実行assetのbyte一致を両配布proofに記録し、変更はREADME／source案内・archiveに限定した。以前のZIP・検証記録は保持している。
- measured共通sourceの変更はSID model validation／Worker metadata・JSDocのみ。[新しいexact receipt](sid_playground_source_revision_02.json)で20 source pairsを認証し、旧`_01`と4つの測定reportは保持。校正／source拒否の関連340テスト・4validatorが成功し、既存gain／DSP値は不変。fixed SDK **33 builds／68 outputs／75 mirrors** も成功。
- `sh scripts/package_itch_sid_synth.sh <new-version>`と`sh scripts/package_itch_playground.sh <new-version>`で再生成可能。新module同期は`node scripts/sid_model_artifacts.mjs --sync`。CI監視pathと検証を更新済みだが、今回のGitHub Actions実行・commit／push／tag／公開はしていない。
- [ ] 手動の次: 同じPresetを6581／8580へ切り替え、Cutoff／Resonance・LP／BP／HP、Pulse／Ring、短い連打と長いReleaseを聴き比べる。8580はPAL専用Previewで、Native出力・NTSC・実機精度／長時間検証は別作業。

### 今回の続き: SID PlayerからSynthへ音色snapshotを取り込む（2026-11-08）

ユーザー承認: 演奏中のVoice 1／2／3の瞬間設定を取り込み、SID Synthで試奏・編集・Preset保存できる導線を追加する。先にTODOを記録し、曲全体の音色変化の復元とは区別する。

- [x] 実AudioWorkletへのreadで同じ時点の稼働model・32register・位置を取得し、選んだvoiceの波形／Pulse幅／ADSR・共有filter／volumeを既存Preset v2へ変換した。display pollingの古い値やdraft modelを取り込まない。
- [x] 単一Triangle／Saw／Pulse／Noiseを初版の対応範囲とし、無波形・複合波形・Sync／Ring等の既存Synthで忠実に表せない設定は理由を表示する。Gate／elapsed Envelope／元の演奏pitch・software automationは再現しないことを明示し、共有filterの選択voice routing・voice3off・全output Offを黙ってbypassへ置換しない。
- [x] Playerへvoice選択・snapshot取得・Preset保存の小さなfoldable UIを追加した。取得失敗・Stop／再load／subtune／model変更中・古いread完了で、保存済みsnapshotや現在の曲を壊さない。
- [x] Synthへsnapshot JSONを既存Load presetから読み込めるようにし、同一originでは明示的な「Open in SID Synth」でも引き継げるようにした。音声・ROM・曲dataを渡さず、他origin／storage不可はPreset downloadを使う。
- [x] pure変換・actual 6581／8580 snapshot・取消／競合・旧Preset互換・Mainの操作をunitで確認し、source／実ZIPのChromium／WebKitで「再生→取得→保存→Synth→試奏」を実行した。物理出力はmuteし、実聴と区別する。
- [x] Player／Synth両方の可読ZIP・共通module・source kit・license・CI・README en／ja／英語AIと結果を更新した。Rust／WASM・fixed SDK／既存gainを変更せず、commit／push／公開は別とする。

検証と再開情報:

- `voice_snapshot.js`はpure変換、`voice_capture.js`は取得所有権・取消、`synth-sid/handoff.js`は同一origin・5分・一度限りのPreset転送。取得は明示的な1 readで、3voiceを同時点で保存し、後からvoiceを選んでも再生中の値に追従しない。保存済みsnapshotはStop／新しい曲でも保持する。
- `npm run test:sid-player` **122件**／`npm run test:sid-synth` **75件成功**。pure変換8件は4波形×8filter mask×routing×両model、無波形・複合／Sync／Ring／TEST・voice3off・無音filter routeを含む。実Direct6581／C646581／8580で、取得・変換前後の状態と次PCM不変を検証。handoff13件とcontroller4件では、未要求時のstorage非参照、未知key保持、サイズ／期限／token／厳密Preset、storage拒否、取消・late replyを確認。
- 既存Source browser回帰は[Player70項目](sid_voice_capture_player_regression_01.json)／[Synth32項目](sid_voice_capture_synth_regression_01.json)が成功。
- 専用の[Source結合検証](sid_voice_capture_browser_01.json)は両browser各9項目・**18項目成功**。取得元の実Worklet応答と保存Presetの一致、旧snapshot保持、実稼働8580とdraft6581の区別、storage拒否時のfallback、両modelの同一origin引き継ぎ・要求keyの一度限り消費・無関係storage／URL fragment保持・受信だけでは音声開始しないこと、Synth実PCM・再保存を確認した。
- [実ZIP結合検証](sid_voice_capture_zip_browser_01.json)は各8項目・**16項目成功**。standalone Playerの公開Synthリンクが別originであることを検出し、外部へ移動せずSave／Loadで両modelを展開済みSynthへ取り込み・実PCM試奏した。両browserで非対応設定の理由と1180／390px表示も確認。合計**136 browser項目**、全タブの物理出力はgain0、ゲーム曲／ROM／PCMの保存なし。実聴・長時間保証とは区別する。
- [配布proof](sid_voice_capture_packages_01.json): Player `release/tetorica_sid_player_20261108-voice-snapshot.1_itch.zip` は **223files／20 readable modules／2,691,350bytes**、SHA `0e7774f190c269832d22a657a5383e9120cef2ea912d6ed888dee886eb5c57f2`。Synth `release/tetorica_sid_synth_20261108-voice-snapshot.1_itch.zip` は **194files／16 readable modules／2,511,075bytes**、SHA `158ec2021606911d4d5765f330f66dcd2b979dbb65480b9401100a80c3715764`。実展開byte・CRC・各176／160 original inputsのnested ZIP／hash、全authored moduleの原本byte、99 compiled inputsを含む127 native source／notice hashを確認した。初回の無印ZIPは途中snapshotとして保持。
- fixed SDK **33 builds／68 outputs／75 mirrors**、PSID／C64 source receiptのcheckは成功。既存WASM・DSP・gain・preset v2形式は不変。両CIを更新し、SID Player workflowはsourceとPlayer／Synth両ZIPの結合検証・artifact保存を行う。GitHub Actions実行・commit／push／tag／公開はしていない。
- 再実行は`npm run test:sid-voice:browser`。ZIPは`node scripts/check_sid_voice_capture_browser.cjs --player-root <Player展開先> --synth-root <Synth展開先> --out <JSON>`。packageは`node scripts/package_sid_player.mjs <new-version>`／`sh scripts/package_itch_sid_synth.sh <new-version>`。
- [ ] 手動の次: 手元のSIDを再生し、`Voice snapshot → SID Synth`を開いてCapture now→Voice選択→Save preset／Open in SID Synthを試す。音の時間変化・元pitch・elapsed Envelopeは復元対象外。独立Sync／Ring pairは下の段階で対応済み。複合波形・時変instrument取り込みは別段階で検討する。

### 今回の続き: Sync／Ringペアの音色取り込み（2026-11-08）

ユーザー承認: Playerで選んだcarrierとその変調元を同じsnapshotから取得し、既存SynthのSync／Ringと周波数比・共有Filterを使って試奏・編集・保存できるようにする。先にTODOへ範囲を記録し、2声で成立する接続を初版の対象とする。

- [x] 固定のSID接続（Voice 3→1／1→2／2→3）と既存両modelのphase／Sync／Ring参照を確認し、現在のSynthで表現できる独立ペアだけを判定した。変調元／第三声の依存、TEST、zero frequency、範囲外ratio、非対応wave／routing等は理由付きで対象外とする。
- [x] pure snapshot変換でcarrier・sourceの周波数registerからratioを求め、Sync／Ring flags・carrier波形／ADSR・model・選択voiceの共有filter設定を既存Preset v2へ保存する。変調元のGate／ADSR／出力波形は通常phase／MSBを供給せず、Synthではsilent sourceを使うことを明示した。6581の無波形source例外は下記のとおり拒否する。
- [x] Playerの既存Voice snapshot UIへsource→carrierの接続・captured ratio・1音試奏の説明を加えた。single snapshot互換、古いreadの破棄、Save／Load・同一origin handoffとkeyboard focusを維持する。
- [x] 両model・3つのcarrier位置・Sync／Ring／併用・境界ratio・shared filterをunitと実WASMで検証した。取得で元Playerの次PCMを変えず、import後のratio・既存一音割当・再保存・Copy JavaScriptを確認した。
- [x] source／実Player・Synth ZIPのChromium／WebKitで取得→Preset保存／直接受信→試奏を確認し、chain／zero／TEST等の拒否を実programで確認した。位相／元pitch／elapsed Envelope・software時間変化の復元とは区別する。
- [x] 可読ZIP・source／license provenance・CIとREADME en／ja／英語AI・再開記録を更新した。Rust／DSP／WASM・fixed SDK・既存gainを変更せず、commit／push／公開は別とする。

検証と配布:

- `npm run test:sid-player` **130件**、`npm run test:sid-synth` **79件成功**。snapshot変換16件では全3carrier位置×Sync／Ring／併用×Direct6581／C646581／8580の27実CPUケース、旧single互換・境界／小数ratio・全filter mask・chain／TEST／zero拒否を含む。取得前後の状態・次PCMは不変。fresh SynthとCopy JavaScriptのPCMが一致し、元曲の位相再現とは区別した。
- source waveform／Gate／ADSRを変えた完全mute sourceの実比較で、対応sourceのphase挙動を検証。6581の波形nibble0だけはTriangle置換でcarrier PCMが変わり、専用guardと両model差の回帰を追加した。
- ratioスライダーは`step="any"`で0.125刻みへの丸めを避ける。ボタン／キーは現在の値から0.125ずつ動かし、短縮表示には`≈`、title／ARIA・preset・再保存・Copy JavaScriptは完全なNumberを保持する。HTML rangeの文字列はbrowser側で15桁程度に直列化される場合があるため、表示表現のみ32EPS以内を確認し、保存値・実音声側presetは厳密一致で検証した。
- [Source browser](sid_sync_ring_capture_browser_01.json)はChromium／WebKit各17、[実Player／Synth ZIP](sid_sync_ring_capture_zip_browser_01.json)は各16、[既存Synth回帰](sid_sync_ring_synth_regression_01.json)は各16、**計98項目成功**。各modelで3物理接続・Sync／Ring／併用を取得→保存／受信→実PCM試奏し、source mute・filter routing・mono steal／古い離鍵・非grid ratioの再保存／コード出力・1180／390pxを確認。全タブ物理出力gain0、実聴・長時間保証とは区別する。
- [配布proof](sid_sync_ring_capture_packages_01.json): Player `release/tetorica_sid_player_20261108-sync-ring.1_itch.zip` は **223files／20 readable modules／2,694,707bytes**、SHA `423151e2abeabe1def235f8fed0b905eadcad7aa8d97e4e5b11220ed0bc37cc6`。Synth `release/tetorica_sid_synth_20261108-sync-ring.1_itch.zip` は **194files／16 readable modules／2,512,362bytes**、SHA `03b3c8846e921a3db547504416cdf3751cbdb3b2694157aebb057b24d303cdab`。実展開全byte・CRC・各176／160 original inputsのnested ZIP／hash、99 compiled inputsを含む127 native source／notice hashを確認した。無印ZIPは追加guard前の途中snapshotとして保持する。
- fixed SDK **33 builds／68 outputs／75 mirrors** は成功。WASM／native source receipt・DSP・gain・Preset v2の形式は不変。両CIへ新しい自作pair fixtureの監視を追加済み。GitHub Actions実行・commit／push／tag／公開はしていない。
- 再確認は`npm run test:sid-voice:browser`。既存`Voice snapshot → SID Synth`から取り込み、対応ペアなら接続・frequency-code ratioが表示される。元sourceの音・第三声は取り込まず、Synthでは無音Triangle Voice 3→carrier Voice 1の1音として試奏する。

検証で判明したmodel差: 現在の6581近似coreは`_m6581_wavnone`で`wav_accum >>= 1`を行うため、無波形sourceとTriangle sourceの位相挙動が一致しない。sourceを完全muteして同じCPU write timingで比べても、Triangleへ置換するとcarrier PCMが変わる。今回は6581のsource波形nibble0を理由付きで拒否し、8580では引き続き許可する。native／WASM修正を混ぜず、既存の音を保持する。

- [x] 別段階: 6581の無波形sourceのphase／MSB挙動を独立fixture・一次資料／参照と照合し、core修正・WASM再build／source receipt・既存PCM／校正の更新範囲を検討する。下記の続きでphaseを修正し、検証後に専用guardを外した。上の記述は修正前の調査記録として残す。

### 今回の続き: 6581の無波形sourceと位相の修正（2026-11-08）

ユーザー承認: 既存6581 coreの無波形sourceを一次資料・独立参照と比較し、必要な修正とNative／WASM再build・検証を行い、Sync／Ring取り込みのmodel限定guardを外す。先にTODOへ範囲を記録する。

- [x] MOS SIDの資料・独立参照実装で、波形選択・Gate／TESTとoscillator accumulator／MSB・Sync／Ringの関係を確認する。無波形DACの保持／減衰とphase更新を区別し、実機一致の主張を限定する。
- [x] 変更前のordinary wave／filter／ADSR／Sync／Ring・無波形source fixturesを固定し、修正対象で変わるPCMと不変であるべきPCM／registerを分類する。変調元の出力を完全muteし、cycleごとのphase／MSBも比較する。
- [x] pristine upstreamを保持し、生成scriptから作るmarked6581 headerのみへ最小修正を加える。無波形の処理がphaseを変更しないようにし、DACの簡略表現・限界は明示する。ABI・gain／filter係数等を変更しない。
- [x] 依存するSID単体／Direct PSID／C64のNative・WASMとmatching receipts／source kitを再生成する。8580とfixed SDKを不用意に更新せず、共有inputのclosureに必要な再build／receipt更新は独立一致で検証する。
- [x] 6581の無波形source専用取り込みguardを、修正済み実coreでphase／PCM一致を確認してから外す。両model・全3接続・Sync／Ring／併用、Gate／ADSR・再発音・旧Preset・Copy JavaScriptを検証する。
- [x] Playground Main／Worker、Player／Synthのsource／実ZIPをChromium／WebKitで確認する。既存校正・SDK認証を保持し、必要なSID-only source revisionは範囲限定で記録する。
- [x] 一次資料・before／after・再build／package proof・CI・README en／ja／英語AI・再開情報を保存する。元曲／ROM／PCMは配布せず、commit／push／tag／公開は別とする。

今回の結果:

- 無波形処理を`wav_accum`の減衰から`wav_output >> 1`へ変更。phaseを進めたまま、出力latchだけを簡略減衰させる。Gateは位相を止めず、TEST／Syncは既存のreset／hold経路を維持する。出力latchの半減は実機floating DACの保持時間を再現したものではない。[一次資料・独立参照](sid_waveoff_reference_01.json)は6581／8580の12ケース・66実行でphaseと出力の区別を確認し、GPL参照engineは配布runtimeへ含めていない。
- [変更前記録](sid_waveoff_before_01.json)と[独立phase oracle／Native・WASM比較](sid_waveoff_native_01.json): 32 rawケースでphase不一致は変更前406観測→変更後0。32／44.1／48／96kHz×PAL／NTSCの280ケースでNativeとWASMはbyte一致。waveを先に設定する192ケースは変更前のPCM・stateとも一致。無波形の変調元・周波数を先に書く初期化・DAC履歴を含む88ケースは修正対象として分離した。[既存18場面](sid_waveoff_existing_native_01.json)も1,881,000 framesで最大誤差0。
- [Direct VBIの12ケース](sid_waveoff_player_regression_01.json)では旧baselineを保持し、変更前binaryが旧PCM／trace／stateに一致することを確認。修正後は別のNative captureとWASMがPCM／phaseまで一致し、旧CPU trace・register・Envelope・実行状態も維持する。新baselineは別名でhash固定し、旧記録の上書きで差を隠していない。
- [C64の27ケース](sid_waveoff_c64_01.json)も旧CIA9／RSID12／再配置CIA6のbaselineを保持し、変更前Native・WASMで旧PCM／trace／state・counter／sentinelを再現した。修正後は別名の3baselineとNative capture・WASMが一致。phase以外のCPU／register／Envelope／RAMを保持し、各programの周波数先行write区間も記録した。新baseline・proof・WASM・header・Native helperを独立hashで固定し、CIでNative比較を再実行する。
- 6581のsource無波形専用guardを削除。両modelでWaveなし・Gate On／OffのSync／Ringペアを読み込み可能。TEST・三声の依存・carrierの合成波・範囲外ratio等の拒否は維持。source／第三声の音や元の位相・曲automationは取り込まない。
- [sourceの取り込み・Synth試奏](sid_waveoff_voice_browser_01.json)はChromium／WebKit各20項目、[実ZIP間の保存・読込・試奏](sid_waveoff_voice_zip_browser_01.json)は各19項目成功。[Player全体](sid_waveoff_player_browser_01.json)は各35項目成功。[Playground source](sid_waveoff_playground_browser_01.json)と[実ZIP](sid_waveoff_playground_zip_browser_01.json)は各Main／Worker×2browserの32項目成功。physical outputはmuteで、実聴とは区別する。
- [実ZIPからの隔離再build](sid_waveoff_packages_01.json): SID13／Direct14／C6429入力を同梱recipeでbuildし、3組のWASMとreceipt全文が配布物にbyte一致。[8580の99入力closure](sid_waveoff_closure_01.json)も実buildと独立source kitの再buildを実施し、8580の2WASMとNative binaryは変更前とbyte一致。共有4入力のreceiptのみ更新。[Playground ZIP](sid_waveoff_playground_packages_01.json)も同じSID／8580 artifactと全入力hashを検証し、browser用は1000files以内。
- [変更範囲](sid_waveoff_scope_01.json): Runtime検証33 SDK builds／68 outputs／75 mirrors成功。固定SDKのbytes、4音源の測定report・既存source revision・Mixer gainを保持。SIDは未校正のapplication instrumentのため新しい測定値やsource revisionの例外を作っていない。
- 再確認: `npm run test:sid:waveoff`、`npm run test:sid-player`、`npm run test:sid-synth`。CIのSID labへphase回帰を追加し、Player CIは独立captureの新baselineと旧CPU不変条件を検証する。新規ZIPは`waveoff-20261108`名で作成済み。commit／push／tag／公開、人の実聴と長時間／background／実機比較は未実施。
- 最終unit結果: Player131／Synth79／Core12／新phase7／Main・Worker runtime30／参照・corpus39／校正revision7すべて成功。全Playground mode型・C64 exampleのcheckJs、CI YAML構文、`git diff --check`も成功。GitHub上のActions実行は未実施で、上記はlocal検証。

配布記録の追補（2026-11-08）:

- [x] 最終レビューで、`waveoff-20261108`のPlayer／Synth ZIP作成後に`package.json`のテストcommandを整理したため、ZIPのoriginal-input receiptが現在の原本と1fileだけ異なることを確認した。旧`_01` proofは変更前の記録として保持する。
- [x] 現在の原本からPlayer／Synthを`waveoff-20261108.1`へ再梱包した。Playgroundのbrowser-bundle入力にはrootの`package.json`は含まれず、同じ変更による再梱包は不要。
- [x] [新ZIP検証](sid_waveoff_packages_02.json): Player176／Synth160のoriginal inputが現在の原本と一致し、outer／nested ZIPのCRC・全展開byteも成功。[独立byte比較](sid_waveoff_repack_assets_01.json)でも各ZIPの変更はbrowser-input archiveとreceiptの2fileだけで、実行assets／native source kitは旧検証ZIPと同一。browser検証と13／14／29入力の再build証拠を明示的に引き継ぎ、今回compilerを再実行したとは扱わない。
- 配布用は`release/tetorica_sid_player_waveoff-20261108.1_itch.zip`（SHA `af8f29968dacb79043c811cbd233dbe76403b2b34459a16f11e7569ff7ce1d70`）、`release/tetorica_sid_synth_waveoff-20261108.1_itch.zip`（SHA `8dddca38046955351bbb73139967c6916ad8b7342f16b9783db1861e052abe4c`）を使用する。旧ZIP・旧proofは履歴として保持。commit／push／公開はしていない。

### PAL／6581補完設定の初期値（2026-11-07）

ユーザー報告: Zombi.sidのmodel未指定エラーと、設定に気付きにくい問題を受け、通常SID Playerの「Use PAL / 6581」を既定Onにする。

- [x] 未指定／eitherのclock・modelへPAL／6581を選ぶcheckboxを既定Onにし、画面説明とREADMEを更新した。元headerの表示と既知NTSC／8580の拒否は維持する。
- [x] 初期状態から未指定ファイルを読み込めることと、Off時の拒否／再試行を既存ブラウザー検証で確認した。Chromium／WebKitとも成功（`node scripts/check_sid_player_browser.cjs --out /private/tmp/sid-player-default-pal-6581.json`）。共有parserのAPI defaultは変更していない。

### VBI曲をC64実行環境へ接続する今回の作業（2026-11-07）

ユーザーが全体監査後の次段階として、VBI曲のC64実行環境対応を承認した。
Western_Games.sidの132,113-cycle initと実CIA操作を基準にし、元headerのVBI timingを維持する。

一次仕様は[HVSC SID file environment](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt)。VBIはVIC raster比較値`<$100`／IRQ有効、CIA1 timer Aは`$4025`でcounter稼働／IRQ無効、他timerは`$FFFF`で停止。毎回のinit／playでentryに応じたbankを書き、play後にVIC（`$D019`のwrite-one-to-clear）とCIA（ICR read）をackする。programのtimer／raster／mask変更は保持する。
UIはC64 VBIをdefault、Direct VBIを明示選択とする。共有parserのAPI defaultは従来互換の`direct`、C64 wrapperは`c64`を指定。C64 modeのdriver空きpageなし／`$FF/0`は理由付き拒否としてDirect VBIを案内し、header変更・隠れたfallback・RAM上書きをしない。
新VBI entryは100k-cycle preflight後もinitをstreamingで継続し、bootstrap開始から2M-cycleで打ち切る。UI候補はchunk間でyieldしRTS後に採用、workletはfresh loadのinit PCMから再生する。play上限16kは維持。新VBI経路だけ、I/O mapped時の未実装`$DE00..$DFFF`を拒否する。既存CIA／RSIDの実行policyを黙って拡張しない。
前61,157件の監査結果はimmutableなDirect VBI baselineとして保持した。旧VBI失敗3,233件（I/O 2,831・bank53・ROM177・init167・play5）とcontrol64件の計3,297件を、別checkpointで再検証した。旧失敗のうち3,025件が完走し、残りはROM195・play timeout9・init deadline3・expansion1。[結果と範囲](sid_c64_vbi_result_01.md)、[独立比較18項目](sid_c64_vbi_retry_comparison_01.json)は成功。61,157件すべての再実行ではない。

- [x] PSID VBIのVIC／CIA初期状態・IRQ呼出／ack・bank／driver RAM規約を確認し、自作fixtureを用意する。
- [x] 既存C64 machineへVBI entryを追加し、実VIC raster IRQでplayを呼ぶ。既存CIA／RSID経路の回帰を保つ。
- [x] 長いinitをbounded streamingで進め、init PCMを保ちながらStop／timeout／候補失敗時の旧音を保持する。
- [x] Main／Worklet／UI／parserへ接続し、driver空きRAMなし・ROM設定・subtune切替・従来VBI比較の扱いを明示する。
- [x] Western Gamesと他の実I/O失敗例、自作VIC／CIA・長いinit、既存CIA／RSID、source／実ZIPブラウザーを検証する。
- [x] 前監査の失敗対象を再検証し、matching sources／再build／可読ZIP・guide／README／CI・再開記録を更新する。

### ローカルHVSC全体の実行監査（2026-11-07）

ユーザーが`ww/C64Music`配下を一通り動作確認するよう依頼した。Zyx修正後の音は正常になっていそうとの実聴コメントあり。
全ファイルをmetadata確認し、現行backendで受理できる各ファイルの既定subtuneを短時間実行する。
曲全体・全subtune・聴感の正しさを確認したとは扱わず、silentも初期無音／D418等と区別せず記録する。

実行手順と分類は[ローカルSID corpus監査](../sid-corpus.md)。`npm run test:sid-corpus`の自作corpus8件が成功した。
5demoのpilotは全件nonzero／Stop成功、resumeは5件再利用・追加0件・checkpoint SHA不変。
`node scripts/check_sid_corpus.mjs --root ww/C64Music --checkpoint release/sid-corpus-audit-20261107/results.jsonl --out docs/issues/sid_corpus_audit_01.json`を既定2秒／48kHz／2workersで実行し、61,157件の分類が完了した（残0、約21.6分）。[結果](sid_corpus_audit_01.md)は非zero26,497／全zero1,050／未対応32,448／ROM要求・アクセス906／実行停止256。全件resumeは追加0件、checkpoint SHA・入力manifest・fingerprint・分類件数不変、lock残留なし。[独立検証](sid_corpus_audit_verification_01.json)も成功し、61,157行の欠落・重複0、完走27,547行すべて96,000 frames／有限PCM／Stop全zero・停止状態不変を確認した。
中断後は同じcommandへ`--resume`を追加する。JSONLと入力manifestはrelease配下、compact summaryだけdocs/issuesへ置く。実行中はfingerprint対象のsource／WASMを変更しない。

- [x] 実WASMによるVBI／CIA／RSID、PAL／6581の明示選択、ROMなし環境の全体監査CLIを作る。
- [x] 非対応header／ROM要求／不正入力／CPU・I/O・timeout失敗／有限PCM・有音／無音／Stopを別集計する。
- [x] JSONL checkpointと再開時の入力・source／WASM／条件一致確認、worker watchdog、無変更・非同梱を検証する。
- [x] 自作corpusのテストと小規模benchmark後、`ww/C64Music`全体の既定subtuneを実行して結果を残す。
- [x] 全件resumeの追加0件・checkpoint不変、入力manifestとsource／WASM／条件の一致を確認する。
- [x] 結果行の一意性と測定値を独立確認する。
- [x] 失敗上位と代表例を整理し、次の修正TODOと再実行手順をまとめる。元$1EE4のfileは未確認と区別する。
- [x] VBI宣言のままC64機械を使う再生経路と、init PCMを保持する長いbounded初期化に対応する。Western_Games song1の旧$1EE4停止・scratch132,113cycles後の実STA$DC04は[診断](sid_western_games_diagnosis_01.json)へ保持し、実C64経路では全3subtunesを各10秒確認した。speed bitは変更していない。下記第12段階へ記録した。

### PSID実行診断とZyx.sidの予備読み出し（2026-11-07）

ユーザーが `PSID init/play subroutine exceeded its cycle budget or did not return (at $1EE4)` を報告した。
対象ファイル・subtuneを確認し、正常な長い初期化／実行環境不足／returnやCPU処理の問題を区別する。
ユーザー添付の`Downloads/Zyx.sid`は別のエラーで、local HVSCのZyx.sidとbyte一致した。
initは750cyclesで戻り、playの`STA $D3FF,X`が最終SID書込$D418の前にdummy read $D318を行うため、
bounded VBI hostが未対応I/Oとして拒否していた。$1EE4の元ファイルはまだ特定していない。

[HVSC一次仕様の実行環境](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt)はPAL時`$02A6=1`と、毎回のinit／play entryに応じたbank選択を要求する。VBI hostのzero RAMと前callのbank保持を修正する。
100k init／16k playは本hostの安全上限でありPSID仕様・音源chipの制約ではない。元ファイルの原因確認前に上限は増やさず、init／play timeoutとCPU JAM/KILを区別して表示する。init PCMのbounded queueも維持する。
[固定m6502の一次source](https://github.com/floooh/chips/blob/9e88298ce56319953ac7a43213a1120359f7a3a6/chips/m6502.h)で、`STA abs,X`／`abs,Y`のpost-IR phase3、`STA (zp),Y`のphase4は次のstoreへ渡さない予備readと確認した。修正はwrong-page実bus addressと補正後SID addressが一致する場合のside-effect-free readに限定し、CPU／SIDのclockを省略しない。read時にcollision latchをclearするmirrored register `$1E/$1F`は拒否する。VICを一般的に再現する変更ではなく、実VIC／CIA／ROM readは拒否を保つ。
回帰・実ファイル・配布検証は下記第10段階に記録した。Zyx.sidの別症状を直しても、未特定の$1EE4 timeoutを解決済みとは記録しない。

- [ ] 後続: $1EE4の元ファイルで停止したroutine・cycle数・PC周辺を確認する。上限を増やすだけで無条件に受理しない。
- [x] 添付Zyx.sidのD318エラーを再現し、indexed SID storeの実bus cycleを確認する。
- [x] indexed SID storeの予備VIC readを厳密に識別し、実SID read／実VIC・CIA・ROMアクセスと区別する。
- [x] VBIの初期メモリ／bank／CPU／呼出・復帰条件を一次仕様と既存C64 backendに照合する。
- [x] 原因に必要な修正とinit／play別の診断、bounded実行・旧音保持の回帰を用意する。
- [x] 実ファイル・自作fixture・既存VBI／CIA／RSID・browser／配布・再開記録を確認する。

### PSIDの再配置情報による拒否を改善する今回の作業（2026-11-07）

ユーザーが `unspecified relocation (0/0) only` を報告した。
先にPSIDのstartPage／pageLengthと各backendのRAM使用を確認し、音楽payloadの移動要求と誤解してheaderを書き換えない。

[HVSC一次仕様の+78／+79](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt)では、再配置情報は再生driver用の空き領域を示す。`0/0`はdriver範囲でpayload外を書かないclean file、`$FF/0`は空きpageなし、それ以外は最大の連続空き範囲。
今回の方針はVBIとCIAを分ける。VBIは既存`$0200..$0203` callerのまま、構造が正当な明示範囲・`$FF/0`を受理する。
CIAは明示範囲内で最初のalways-visible page（`$04..$9F`または`$C0..$CF`）へ独自driverを1pageで配置する。範囲全体がそのRAM内に収まる必要はなく、使える1pageがあればよい。`$FF/0`／使えるpageなしはCIA用の理由付き拒否とする。
`0/0`の従来driver配置は保持し、音楽payload／header／load・init・play addressは変更しない。ABIは`sidr_load_psid`末尾の`driverPage`（0=従来配置）と`sidr_driver_address`。parserは選択subtuneごとにVBIなら`null`、CIAなら0またはpageを返す。旧CLIの実行subsetと既存strict parserを黙って拡大しない。検証・配布記録は下記第9段階。

- [x] 一次仕様で再配置情報の意味を確認し、VBI trampoline／CIA RAM driverとの関係と受理条件を決める。
- [x] 正当な明示範囲・$FF/0を必要に応じて扱い、不正範囲・payload overlap・RAM競合は区別する。
- [x] parser／Main／Worklet／nativeを必要範囲で変更し、元header・target・ROM snapshot・失敗時の旧音を保持する。
- [x] 自作fixture・実HVSC・既存VBI／CIA／RSID・strict CLI・Chromium／WebKitで確認する。
- [x] 可読ZIP／matching sources／再build・guide／README／CI・再開記録を揃える。

### PSID CIA再生と8580指定の扱い（2026-11-07）

ユーザーがPSIDのCIA-speed拒否と既知8580拒否を報告した。先にTODOを残し、PSID CIA再生をC64 machineへ接続する。
PSIDは選択したsubtuneのspeed bitでVBI／CIAを分け、CIAはC64 machineの割り込みからplayを呼ぶ。
8580は6581での代替試聴を追加せず、専用modelを選択できる方針で次の調査・試作へ進む。現行版の8580拒否は維持する。
既存のVBI／RSID・strict CLI・未commit／stage済み変更を保持する。

- [x] PSIDのsubtune別speed bitとCIA timer／play呼出／bank規約を確認し、自作PSID CIA fixtureを用意する。
- [x] 既存C64機械でPSIDのinitとCIA割り込み駆動のplay routineを実行し、固定host VBIで代用しない。
- [x] parser／Main／Worklet／native ABIへPSID CIAを接続し、subtune切替・Stop／旧音保持・明示targetを維持する。
- [x] 8580は専用modelを調査する方針にする。6581 preview overrideは実装せず、元のmodel宣言を保持する。
- [x] 自作IRQ／可変CIA・実HVSC、既存VBI／RSID、strict CLI・source／独立ZIPのChromium／WebKitを確認する。
- [x] source／license／再build／配布・guide／README／CI／再開記録を更新する。
- [ ] 後続: VBI宣言でもCIA／VICへアクセスするPSIDをC64環境で扱う。今回の実ファイル検証ではKayak song3（$D019）とIcicle Works song1（$DC04）が従来VBI backendのI/O制限で止まる。CIA-speed対応やheader受理だけで全PSID互換とはしない。

### 専用8580 modelの調査と次の段階（2026-11-07）

#### 今回の続き: 研究用C64／AudioWorklet接続（2026-11-07）

独立8580コアをPAL・単一SIDのC64機械と実AudioWorkletへ試験接続する。既存6581のWASM／parser／製品UI・固定SDKは比較基準として維持し、研究用の明示した入口を用意する。

- [x] C64のCPU／CIA／VICと8580自身のread／write／clockを一体で進める別moduleを作った。2WASMの直接function importで、trace再生・固定read値・6581への置換を使わない。[境界設計](sid8580_machine_design_01.md)と無変更原本／marked copyを記録。
- [x] 自作PSID VBI／CIA・RSIDとSID read依存CPU分岐を43 Native／WASM／分割renderケースで確認した。Stop／reload／instance分離、元宣言／実行8580・独立flag、未対応POT等のaddress付き拒否を保持。
- [x] 実AudioWorkletをChromium／WebKit各13項目・計26で検証。CIA demoの既定subtune2も確認し、load取消・失敗時の旧音保持、pending init・startup ACK中Stopと処理時間を記録。実聴・長時間・hard real-time保証ではない。
- [x] 既存6581を維持し、99inputsから全3出力／receiptの独立byte一致・unit12／機械43・可読source ZIP／license・CI／英語AI引継ぎを確認した。[結果](sid8580_machine_result_01.md)。試験接続と本番採用は区別する。

#### 今回の続き: 8580 cutoffの分離測定（2026-11-07）

共振の鋭さと中心周波数を分け、広いFC範囲でLP／HPの交点などを測る。本番Player／Synth／SDK・原本・既存profile・過去の記録は維持する。

- [x] LP／HPの同一harmonic比からoperational crossoverを推定し、共振・出力RC・入力level、実sample tick、高調波と基本波、測定下限を区別した。解析・無効条件・fit guardの13テストが成功。
- [x] training／holdoutのFC・level・rateを先に固定し、189 training・各270 holdoutを別processの公開APIでblack-box測定した。参照実装や係数表は移植しない。
- [x] 8580限定・既定Offの`8580-cutoff-crossover-v1`を作り、共振補正と独立に評価した。交点10／10改善でも、cutoff単独32／180点・共振のみへの追加16／180点は悪化と記録した。
- [x] default／6581／既存profile・Native／WASM／browser206一致、63inputsから5出力／receiptの独立byte一致、source ZIP／license／CI／英語AI引継ぎを確認した。[結果](sid8580_cutoff_result_01.md)。本番採用・実機一致とは区別する。

#### 今回の続き: 比較条件の整備と8580音声段の検証（2026-11-07）

ユーザー承認により、初期状態・発音時刻・sampling／出力段の違いを切り分け、8580の波形・ADSR・filter cutoff／resonanceを比較する。原本・既存6581製品・Player／SDK・過去の検証記録は維持し、参照への無条件な音量合わせやGPL音源実装の転用は行わない。

- [x] 自作TEST／Gate・settlingから両engine自身のOSC3／ENV3を確認する。公開APIのchip-rate出力と同じ整数samplerで、skipを含む実sample tickを揃えた。
- [x] 同一coreのdry対filter harmonic振幅比、窓・raw値・clip／安定guardを記録する。解析解による数学7テストも成功し、PCMのgain／DC／phase補正は行わない。
- [x] 初期228ケース・165transferで波形／ADSR／LP・BP・HP等の差を記録し、8580 dampingだけを既定Offのopt-in profileで試す。未使用の8設定曲線でQ平均誤差13.43%→3.10%、ただし176点中67点は悪化と記録した。
- [x] 6581・元API376,200samples・旧84PCM・bus66／実CPU36を保持し、browser146一致、62inputsから全5出力／receiptの独立再build・source ZIP・CIを確認する。[結果](sid8580_quality_result_01.md)。本番採用・実機・実曲・Workletは未完了。

#### 今回の続き: バス読み出しとCPU分岐の検証（2026-11-07）

ユーザー承認により、独立8580試作へwrite-only data-busの保持／減衰とread時の更新を追加し、自作6502プログラムへ実際のSID readを返して分岐・書込みまで検証する。原本sideraと既存6581製品・Player・SDKは比較基準として保持し、初期条件・音質・実曲・Workletの未検証項目は別に残す。

- [x] 一次資料と独立外部参照362probeで、write／OSC3・ENV3／write-only readと経過cycleのバス挙動を整理する。model別の近似と外部参照の異常edgeとの差を明示した。[測定](sid8580_bus_reference_01.json)。
- [x] wrapperへ保持／減衰・read更新を実装し、境界・無clock access・chunk・reset／Stop・instanceを66ケースで検証する。POTはerror5で明示拒否し、定数で偽装しない。[検証](sid8580_bus_verification_01.json)。
- [x] 固定m6502原本を使う実6502へSID自身のreadを返し、bus／OSC3／ENV3によるCPU分岐・RAM署名・SID write／PCMを36ケースで検証する。POT／JAM／ROMは値を捏造せず停止した。[検証](sid8580_cpu_verification_01.json)。
- [x] 元API376,200samples、旧84PCM hash、bus66・CPU36とChromium／WebKit124一致を確認する。59inputsから全4出力・receiptを独立再buildし、可読source／license／CI／再開記録を更新した。[今回の結果](sid8580_bus_cpu_result_01.md)。

以下は前段階の独立試作（第13段階）の記録。ゼロ固定busは当時の状態で、今回のwrapper対応とは区別する。[今回の結果](sid8580_bus_cpu_result_01.md)でも本番採用は保留し、6581音源・Player／Synth／校正済みSDKと8580 guardを保持する。

- [x] 候補の一次source・固定revision・必要な依存licenseを確認し、採用／保留理由を[比較メモ](sid8580_core_selection_01.md)へ残す。optional playerまで監査済みとはしない。
- [x] sidera 1.1.1の依存なしlibraryを独立したNative／WASM試作へ接続し、clock・write・read・reset・renderの条件を明示する。本番採用は保留。
- [x] 自作14fixtureでOSC3／ENV3／bus、wave／TEST／Sync／Ring／ADSR、filter／resonance／volumeを測定し、84ケースのNative／WASM・chunk一致とStop／resetを確認する。bus未実装を観測結果として残す。
- [x] 6581との差、外部参照28ケースの診断、実機再現精度を区別し、単体コアの処理速度・memoryとブラウザー56一致を記録する。C64／AudioWorklet／実聴は未検証。
- [x] matching source／license／再build手順と再開記録を残す。53inputsの独立再buildでNative／WASM／receipt一致、可読source ZIPを確認した。Player採用はbus等の課題により保留し、UI・実曲・ブラウザー実時間音声は完了扱いにしない。

CIA／C64 VBI対応後、独立試作の移植一致と外部差分を確認した。[結果](sid8580_probe_result_01.md)は本番採用や8580対応完了を意味しない。以下のlicense判断は必要な依存ファイルを含む固定版の調査で更新した。

- [perfect6581](https://github.com/libsidplayfp/perfect6581) はsimulation側MITに対し、必須netlistはCC BY-NC-SA 3.0。digital-onlyでanalog filter／mixed PCMもないため配布コアに採用しない。netlist内には8580分岐もあり、6581専用との以前の推測は訂正した。
- [sidera 1.1.1](https://crates.io/crates/sidera/1.1.1) の固定libraryはMIT／外部crateなし。sample単位APIを保持したまま内部1cycle処理を公開する最小patchで試作した。upstreamにないbusは今回wrapperへbounded近似を追加したが、POT readは未対応。8580のoffset／filter分岐は存在しても、combined wave、cutoff／resonance等の近似が残る。
- [MAMEのMOS6581／8580](https://github.com/mamedev/mame/blob/master/src/devices/sound/mos6581.cpp) は現行BSD wrapperの音源本体がGPL reSIDfp。旧BSD engineも必要な波形表がGPLで閉じる。BSD表示だけを理由にpermissive音源として採用しない。固定revisionと必要ファイルは比較メモへ記録した。
- [libresidfp](https://github.com/libsidplayfp/libresidfp) は両model・cycle単位read／write／renderを持ち、既存の外部参照toolでも使う。ただしGPL-2.0-or-laterであり、採用時は配布物と対応source／licenseを別途設計する。別WASMにするだけで条件を回避できるとは扱わない。
- 現行zlib m6581へ線形cutoffだけを追加して8580対応とはしない。DAC／DC、combined waves、bus／pipelineなどを含むmodel差を検証する。

- [x] permissive候補のrevision／必要なlicense／library sourceを固定し、cycle単位adapterの小さなNative／WASM試作で比較する。元sample APIは376,200samples・6設定で完全一致した。
- [x] write-only bus latch／保持・decay／read更新をwrapperのbounded近似として追加する。TTL6581=7,424／8580=663,552cycles、write-only readは残存寿命を半分・最小1とし、参照のゼロ寿命edge残留は再現しない。実機の普遍的定数とはせず、POTはerror5を維持する。
- [x] TEST／Gateで観測可能な初期OSC3／ENV3と実sample tickを揃え、同じcoreのdry比で外部比較する。hidden state／read・audio pipeline／RCまで同一とせず、raw RMS比で補償しない。
- [x] cutoff／中心周波数の差を広いFC matrixで分離し、training後に固定した専用profileを未使用条件で検証した。下記第16段階に記録した。
- [ ] 次: FC96の交点残差約−3.081%とmode別gain／loading・pipelineを分離する。研究用C64／AudioWorklet接続は第17段階で試作し、実8580曲・実聴・本番採用とは段階を分ける。
- [ ] 採用前: read／audio pipeline、motherboard RC／scale、hidden stateの残差を分離する。今回のcommon sampler・dry比を実機一致とは扱わない。
- [x] 自作RAMプログラムの実6502へ各core自身のOSC3／ENV3／bus readを返すclosed-loop fixtureを検証する。Native／WASM・chunk一致とmodel別の実分岐を確認した。full C64や実曲検証ではない。
- [ ] 採用前: DAC・D418／combined wave等と、今回のLP／HP・rate／level matrix外の品質を確認する。BP dampingとcutoffのholdoutにも悪化点があり、既定Offの研究profileを本番採用・音質合格としない。
- [ ] 既知8580曲、PSID CIA／VBI、RSIDで実行・音声を確認する。実機と参照engineの近似も区別する。
- [ ] Chromium／WebKitのCPU負荷・memory・音切れを計測して採用を決める。未計測の性能や安定性を保証しない。
- [ ] 採用後にModel UI／parser／Main・Worklet／Native ABIへ接続し、原宣言と実行modelを別表示する。可読source／license／build receipt／ZIPを揃える。

### PSIDの不明／両対応clock・model指定を改善する今回の作業（2026-11-07）

ユーザーがPSIDのPAL／6581必須エラーを報告した。RSIDで導入した明示選択をPSIDにも揃える。
旧CLIの厳密な参照条件と、既知NTSC／8580の非対応は維持する。既存のRSID作業と変更は保持する。

- [x] PSIDの宣言clock/modelを保ち、browserでは不明／両対応を明示PAL／6581選択で受理する。CLIのparsePsidは従来どおりstrictにする。
- [x] 共通の再生設定とApply/retryをPSIDにも接続し、AudioWorkletへ選択を渡す。PSIDにRSID用ROMを要求しない。
- [x] 未指定／両対応・既知NTSC／8580・保存済みsubtune・無効候補保持・取消のテストと既存RSID回帰を確認する。
- [x] 実ブラウザー／独立ZIP、可読sourceとhash、guide／TODO／CI記録を更新する。

### RSID再生を優先する今回の作業（2026-11-07）

ユーザーがbrowserでPSIDの実再生を確認し、次の作業として **RSID再生を先に対応する** と明示した。
音色取り込みは後続のまま。先に調査・TODOを残し、既存のbounded PSID playerを保って進める。

- [x] RSIDのfile／boot／timing仕様、CIA・VIC・IRQ／NMI、ROM初期化の条件を一次資料と既存参照engineで調査する。
- [x] browser用C64実行環境とlicense／ROM取扱いを決める。非対応ROM依存を黙って推測・偽装せず、対応範囲と必要入力を画面で説明する。
- [x] 自作RSID fixtureと実HVSC候補を用意し、割り込み・周辺機器がSID write／音声を動かすことを検証する。ゲーム／ROMデータを配布しない。
- [x] 既存画面のOpen SID／Play／StopへRSIDを接続し、subtune・失敗時の旧曲保持・起動取消・無音化を維持する。
- [x] 新しいcore／WASMの実行上限・render分割・再現性・異常系と、既存PSIDの回帰を確認する。
- [x] Chromium／WebKit・実ZIP、matching source／license／再build、README en／ja／AI・CI・再開記録を更新する。

### ブラウザーでSIDファイルを再生する今回の作業（2026-11-07）

ユーザーの「次に進めて」により、コマンド操作なしで `.sid` を選び、再生・停止できる入口を作る。
最初にブラウザー向けC64 program実行方法とlicense／ROM条件を確認し、対応するPSID subsetを明示する。
既存Synthの楽器編集、SDK／校正値、外部GPL参照CLIの境界を維持する。

- [x] ブラウザーで動くCPU／SID接続方法、実行上限、対応PSIDとROM／license条件を決める。
- [x] SIDファイル選択、曲情報、subtune選択、再生／停止、エラー表示と自作デモのある可読画面を作る。
- [x] AudioWorkletでprogram実行とSIDを接続し、読み込み中Stop／再読み込み／無効入力時の保持・無音化を整える。
- [x] 自作PSIDの期待write列、実音声、分割render、停止、異常入力を自動検証する。人の実聴と区別する。
- [x] Chromium／WebKit、mobile幅、配布・source／license／再ビルド手順、READMEと再開メモを更新する。

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
- [ ] 後続: SID volume-DAC／D418 digi音声のモデルを検討する。現行m6581はDC wave／mixer offsetを0にしており、Gary等はCPU／SID writeが進んでも無音になる。既存Synth／校正／Native・WASM／source receiptへの影響を分けて検証し、RSID file対応と混同しない。

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
通常Playground modeは下記第2段階、独立Synthは第3段階、限定PSID参照CLIは第4段階、
限定browser PSID Playerは第5段階、RSIDは第6段階、PSIDのsubtune別CIA再生は第8段階、再配置情報は第9段階で対応した。
第11段階で61,157件の既定subtune監査、第12段階でC64 VBI・長いinitと対象3,297件の再検証まで完了した。全件のC64再監査や実聴・全曲互換の確認ではない。
package-root raw chip factory／Native出力／専用8580 model・完全なC64互換は後続。
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

第4段階のコマンドと比較WAVはAI側の検証用。ユーザーには第5段階のbrowser画面を入口として案内する。
時変parameterを含む音色取り込みは後続。
CLIの比較結果をSynth音色の完全復元や実機精度と呼ばない。

## 第5段階: ブラウザーSID Player（2026-11-07）

- 入口は `docs/sid-player/index.html`。**Load demo → Play**、または **Open SID… → Play**。
  ファイルはブラウザー内で処理しuploadしない。曲名／作者／subtune、3voiceのwave／frequency／Pulse幅／Gate／ENV／ADSR、
  shared filter、post-Master Waveform／Spectrumを表示する。Master0..380%と100%超orangeを継承。
- GPL参照engineをbrowserへ移さず、同じ固定revisionのzlib **chips/m6502** と既存のadapted **m6581** を
  新しい独立WASMで接続。既存Synth／Playground SID WASM、固定SDK33 builds／68 outputs／75 mirrorsは変更していない。
  CPUの1bus cycleでSIDも1tick進み、writeはtick後commit。実SID readも同じbusで処理する。
- 初版は **PSID v2・明示PAL／6581・単一SID・全VBI・relocation0/0・RAM$0800..$CFFF・explicit init/play**。
  65,660-byte上限。init=0はload addressへ解決し、subtuneは1-based。共有parserをbrowser-safeに抽出しCLI互換entryも維持した。
  Windows-1252 metadataのdecodeはpure JSで、TextDecoderのないAudioWorkletでもimportできる。
- 完全なC64の代わりにbounded init/play driverを提供する。RAM／stack／JSRを用意し、initはA=subtune-1、
  playはA/X/Y=0。init上限100,000 cycles、play上限16,000 cycles、PAL frame19,656 cyclesごとに呼ぶ。
  init中の音声を保持し、initで過ぎたVBIをまとめて呼び戻さない。RSID／CIA／VIC／IRQ／ROM依存／非対応bankingは理由・address付きで拒否する。
  $A000..$BFFFのentryを呼ぶ際、BASICがmappedならLORAMだけclearして$37→$36にする。
  これはPSID host側のbank選択で、SID I/Oを隠さず、既に適合するmapは保持する。
- 旧CLIのlibsidplayfp driverには起動warmup／IRQ／driver命令があり、browser direct hostと絶対cycleは異なる。
  自作toneの最初のwriteはCLI168,000、browser16で、どちらも同じsubroutine内のSTA間隔は6cycles。
  driverを跨ぐPCM完全一致とは呼ばず、browserが記録した同じcycleのwriteを既存SidCoreへ再生したPCM一致を確認する。
- 候補のparse／initと最初0.25秒の無音preflightが成功するまで選択・再生中の曲を保持する。
  Stopは起動中のengineも即disposeし、遅れたACKで再発音させない。subtune変更取消時もaccepted選択へ戻す。
  persisted pagehideは音声だけ退役し、Back/Forward復帰後も同じ選択から再生できる。
- [HVSC metadata調査](sid_player_hvsc_metadata_01.json): ユーザーの `ww/C64Music`（Release85）をread-onlyで確認。
  **61,157件中15,214件**がheader条件を通過した。これは再生成功数ではない。
  [実WASM実行](sid_player_hvsc_playback_01.json): 候補10曲・16subtunesを各2秒、**14件でfinite/nonzero PCMとStop後0**。
  残り2件はCIA$DC04／VIC$D020で明示拒否。Cybernoidは両subtune成功。
  入力hash／metadata／scalar測定だけを保存し、ゲーム音楽／PCM／ROMを配布物へコピーしていない。実聴・長時間再生・原曲との一致は未確認。
- [配布記録](sid_player_package_01.json): 可読JS／CSS・自作4demoと元generator・source receipt・license・matching native source kitを同梱。
  source kitだけから別directoryへ再buildしたWASMが配布用とbyte一致した。
  最終WASMは74,012 bytes、SHA-256 `a47d619195117e2b4b0a43de06cd99eaa3da05e25364c9b070aa92b48a920491`。
  最新候補は `release/tetorica_sid_player_0.0.1-preview4_itch.zip`、40files／1,293,564bytes、
  SHA-256 `48f7737c4fe6fd87b4784bcc254465ac006cd1cbe98e1178ccebc642d6ababca`。
  旧preview〜preview3は修正前の履歴で、今回の最終候補には使わない。
- `npm run test:sid-player`: **27件成功**。4自作program×44.1／48／96kHz×chunk1／128／4096、
  期待CPU write列と6cycle間隔、VBI周期、既存SidCoreへの同cycle replay PCM一致、OSC3／ENV3 read→STAと実read値一致、
  A000／BFFFのinit／playとbank再選択、96kHzで4096を超えるinit音声queue、atomic load／Stop／fault無音化を確認。
  parser／TextDecoderなしWorklet／bounded input、RPC起動・取消、metadata scan、可読ZIP・hash／CRCも含む。
  既存SID Synth42件、PSID CLI／trace／共有parser関連38件、外部CLI6ケース＋repeat＋init0の2load形式も成功した。
- [Source browser](sid_player_browser_01.json)／[実ZIP browser](sid_player_zip_browser_01.json):
  **Chromium／WebKit各11項目、計44チェック成功**。実PCM・4demo・2subtune・pending preflightの取消・
  pending startのStop・不正候補で旧曲保持・runtime fault復帰・Master比率・380%・1出力pathを確認。
  persisted pagehide/pageshowはsynthetic eventでの停止・再Play確認で、実historyのBFCache適用条件を保証しない。
  desktop1180／mobile390のpage overflow0。mobileのcanvasはCSS幅に合わせ文字の縮小潰れを防ぎ、画像も目視した。
  page／console／HTTP error・外部通信0。speakerは最終gain0でmuteし、人の実聴はしていない。最終PCMはRMS／peak0。
- README en／ja／AI、両home、SID Synthからのlink、guide、feature statusとSID Player専用CIを更新。
  commit／push／公開・npm更新はしていない。ローカル入口は `http://localhost:8008/sid-player/index.html`。

PSID曲の再生はユーザーが実聴して「再生はできてる」と確認した。RSID未対応エラーの説明後、
次は音色取り込みよりRSID再生を先にする、と明示されたため下記第6段階へ進んだ。
その後、演奏中のvoice設定／時間変化から試奏用の音色を取り込む設計へ進む。
瞬間snapshotを元instrumentの完全復元とは扱わない。RSID／CIAは下記で進め、8580等の拡張は別の段階とする。

## 第6段階: RSID再生（2026-11-07）

- 同じSID Playerへ **RSID v2／PAL／単一6581** の入口を追加した。自作 **RSID · CIA interrupt** demoも選べる。
  `Open SID… → Play` は共通。PSIDは従来のbounded VBI backendを使い続ける。
- RSIDは固定revision `9e88298ce56319953ac7a43213a1120359f7a3a6` のzlib **chips/c64** とCPU・CIA1/2・VIC・既存adapted SIDを連続clockする。
  CPUへIRQ／NMIが届き、音楽program自身のhandler／RTIが演奏を進める。hostの周期play呼出で代用しない。
  upstream C64 headersは無変更のC11、既存SIDとoriginal hostはC++17の別TUでlinkする。
  SID DSP／既存PSID WASM／Synth／固定SDK／校正値は変更していない。
- 新しい `sid_rsid.js` は旧PSID parser／CLIと分離。RSIDのreserved load/play/speed、全RAMのload、非ROMのinit、
  BASICのinit0、byte上限65,660、1-based subtune、relocation、version／clock／modelを検証する。
  不明・両対応flagはcheckboxでPAL／6581を明示選択した場合だけ受け付け、既知NTSC／8580／複数SIDは拒否する。
- 既定は独立に書いたBSDの限定boot／IRQ／NMI shim。元C64 ROMやGPL player/stubを使わない。
  RSID規約のCIA1 timerA／VIC／bankを初期化し、未実装のmapped ROM data／codeはaddress付きで拒否する。
  initの100,000-cycle preflight後に戻っていなくてもbusy loop／IRQ演奏を継続できる。固定queue16,384frames、出力8..96kHz、chunk4096。
- 任意のuser ROM modeはCharacter4KiB／BASIC8KiB／KERNAL8KiBをmemoryだけへ読む。
  exact sizeをread前に検証し、detached copyで候補へ渡す。保存／upload／自動download／配布への収録はしない。
  2,000,000-cycle boot音声を捨てた後にprogramをphysical RAMへloadし、RUN／SYS、$030Cのsong値を渡す。
  自作synthetic firmwareでBASIC SYS／RUN／songの経路を検証したが、実Commodore firmware／一般BASIC曲の互換性は未確認。
- failed candidateは旧曲／ROM snapshot／次のPCMを保持する。ROM read中のApply／新規候補は旧ROMを誤採用しないよう拒否し、
  古いread完了を最新ROMへ上書きさせない。accepted曲のPlay／subtuneは保存済みROMを使う。
  Stopしたsubtune候補はApply retry先へ残さず、数値Native error codeも正常な失敗として表示する。
- [RSID header調査](sid_rsid_hvsc_metadata_01.json): local HVSC Release85のRSID3,924件、うちnonBASIC3,335／BASIC589。
  明示PAL／6581のnonBASIC候補2,319件。header候補数は再生成功数ではない。
  [実WASM](sid_rsid_hvsc_playback_01.json)は候補6曲を各2秒、**6件CPU実行・5件nonzero PCM・全Stop0**。
  GaryはD418-only volume-DAC/digiとみられ、SID writeが進むがPCM0。既存SID modelの未対応として隠さず記録した。
  music／ROM／PCMは同梱せず、hash／metadata／scalar測定だけを保存する。原曲との実聴一致や長時間再生は別確認。
- `npm run test:sid-player`: **50件成功**。自作CIA IRQ／VIC raster IRQ／SEI中NMI／one-shot／no-ack／可変timer／busyloop、
  44.1／48／96kHz×chunk1／128／4096のPCM・trace・CPU state一致、mapped ROM data/code／JAMのaddress、ROM所有権／Stop、
  synthetic firmware、旧PSID、parser、RPC、ZIPとuser ROM除外を確認した。
- 新RSID WASMは102,775bytes、SHA-256 `496f32f4bbdf2d788f42124c385da033861852b738147f59b61a338580b91a18`。
  matching source kitだけから別directoryへrebuildして同一WASMを確認した。独立receiptは `scripts/sid_rsid_artifacts.mjs --check`。
  [配布記録](sid_rsid_player_package_01.json): `release/tetorica_sid_player_0.0.2-rsid-preview_itch.zip`、80files、10 readable modules。
  最終ZIPは1,543,175bytes、SHA-256 `55375c33d86e1b324e26c1f5550da420989dc02c964ab00c4b5e25361952d6a6`。
- [Source browser](sid_rsid_player_browser_01.json)／[実ZIP browser](sid_rsid_player_zip_browser_01.json):
  **Chromium／WebKit各21項目、計84チェック成功**。旧PSID、RSID CIA/raster/NMI/multispeed、busyloop、
  数値Native ROM errorで旧曲保持、unknown flagsの明示Apply、synthetic3ROM/BASIC／song、取消候補のretry非採用、
  遅いROM read・ROM_PENDING・accepted ROM所有権、RSID起動取消、backend切替、storage書込0を確認。
  1180／390pxでROM controlsを開いてoverflow0、画像も目視確認した。未Applyの設定をaccepted曲へ混ぜない。
  page／console／HTTP error・外部通信0、最終PCM RMS／peak0。speakerはgain0でmuteし実聴はしていない。
- 固定SDK33 builds／68 outputs／75 mirrors、既存PSID／SID source receipts、両Mixer policy checkも成功。
  target amplitude `0.12881777435541153` と既存gainを保持した。旧PSID parser／CLIと両従来WASMはbyte不変。
- README en／ja／AI、home en／ja、player guide／scope、feature status、CIを更新。
  commit／push／tag／公開・npm更新はしていない。人はページをreloadして、RSID demoか
  `ww/C64Music/MUSICIANS/T/Tel_Jeroen/Hard_Rock.sid` 等の対応曲を試す。

次の候補はD418 digiモデル、実ROM／BASIC・長時間／実聴の確認、または音色取り込み。
RSID完全互換や実機精度の保証とは扱わず、ユーザーの優先順を確認して進める。

## 第7段階: PSIDのclock／model明示選択（2026-11-07）

- ユーザーがPSIDの「PAL／6581を明記する必要がある」エラー2種を報告した。
  不明／両対応flagと、実際に非対応のNTSC／8580専用を区別し、browserだけ明示選択を許可する。
- private構造parserを共有しつつ、公開 `parsePsid` はstrict PAL／6581条件・戻り値・exportを維持した。
  `validateBrowserPsid(bytes,{clock:'pal',model:'6581'})` は不明／両対応を受け付け、未選択時は `PSID_CHOICE_REQUIRED`。
  既知NTSC／8580は明示optionでも拒否する。v2／VBI／relocation0／RAM／entrypointの従来制約は維持。
  original bytes／flags／raw clock・modelは書き換えず、selectedClock／selectedModel／selectionを別に持つ。
- 共通パネルを **Playback settings · PAL / 6581 & RSID ROMs**、ボタンを **Apply / retry SID** とした。
  エラー時は設定を開き、**Use PAL / 6581 → Apply / retry SID → Play** で失敗したファイルを再選択せず試せる。
  PSIDはRSID ROMの未選択／読込中でもOpen／Applyでき、subtuneはaccepted targetを保つ。
  取消した候補はretry先へ残らず、Play／Workletで再検証する際にもclock／model optionを渡す。
- `SidPlayerCore.getState()` は実行値model6581／clockHz985248を保ち、declaredClock／declaredModel／detached targetSelectionを追加。
  新しいmetadataもnative候補成功時だけcommitし、失敗時は旧機械・metadata・次のPCMを保持する。
- `npm run test:sid-player` **55件成功**、CLI／trace／metrics **29件成功**。
  [外部参照の回帰](sid_reference_target_choice_01.json)は6ケース＋完全repeat＋init0の2load形式が成功し、
  旧baseline6ケースのwrite hash・参照／Tetorica／raw PCM hashがすべて一致した。WASM／Native／SID DSPは変更していない。
- [実HVSC検証](sid_psid_target_choice_hvsc_01.json): 元ファイル無変更、各2秒48kHz。
  A_P_E_X_preview（unknown/unknown）、Addams_Family（PAL/unknown）、Task_Force（PAL/any model）の3件で有音・Stop0。
  同じ3件はstrict CLIでは従来どおり拒否し、PAL/8580とNTSC/6581の実ファイル2件もbrowserで引き続き拒否した。
  入力hash／metadata／scalarのみを保存し、曲／PCM／ROMは同梱しない。
- [配布記録](sid_psid_target_choice_package_01.json): `release/tetorica_sid_player_0.0.3-target-choice-preview_itch.zip`、
  80files／10 readable modules／1,546,049bytes、SHA-256 `aa059accfeb783072903064f9ca1dd9185309821a83e0f7f5d584bae7c421f97`。
  両native WASMは前RSID版とbyte一致。旧PSID／RSID package記録は保持した。
- [Source browser](sid_psid_target_choice_browser_01.json)／[実ZIP browser](sid_psid_target_choice_zip_browser_01.json):
  **Chromium／WebKit各24項目、計96チェック成功**。追加3項目でPSID choice errorの旧音保持・設定開示、
  Applyから実Workletへ届くraw declaration／selected target／PCM、未Applyのcheckbox変更後のsubtune、取消後Apply、
  RSID ROM未選択／読込中でもPSIDが独立してOpen／Applyできること、既知NTSC／8580の保持付き拒否を確認。
  既存PSID／RSID・ROM・Stop・Master・mobile項目も成功。page／console／HTTP error・外部通信0、
  1180／390pxのoverflow0、speakerはmuteで最終PCM RMS／peak0。人の実聴は別。
- ガイド・英語AI README・TODOを更新。commit／push／公開・npm更新はしていない。

## 第8段階: PSIDのsubtune別CIA再生（2026-11-07）

- 選択songのspeed bitでVBI／CIAを決める。bit31はsong32以降にも適用する。
  VBIは既存bounded host、CIAはC64 machine／CIA1 Timer Aの実IRQからoriginal RAM driverでplayを呼ぶ。
  strict `parsePsid`／参照CLIはVBI限定のまま。既知NTSC／8580の拒否と元のheaderを保持した。
- CIAの初期latchは$4025、他timerは停止・$FFFF。initのlatch／control／IRQ mask変更を保持し、
  play後にICRをackする。init100k／play16k cycles、A／X／Y／bank復元、optional ROM boot、
  候補失敗時の旧機械・次PCM保持に対応。RSIDのnonreturning initは従来どおり許可する。
- Main／Workletをsubtune単位で切替え、CIA／VBI表示とplay回数を追加した。
  ROM読込中はCIAの新規Applyを待ち、VBIは独立して使える。
  適用済みROMはCIA→VBI→CIAでも保持し、未Applyのdraftや読込中の差し替えに置換されない。
- `npm run test:sid-player` **68件成功**、`npm run test:sid-reference` **29件成功**。
  自作CIA10テストで44.1／48／96kHzとrender分割、可変周期、IRQ mask／停止、ICR観測、
  bank、ROM初期値、timeout、Stopを確認した。旧RSIDのPCM／trace／状態は12ケース完全一致。
- [実HVSC](sid_psid_cia_hvsc_playback_01.json): 各2秒48kHz、CIA5件すべて有音・Stop0。
  VBIも2件成功、上記2件の既存I/O制限は明示した。曲／ROM／PCM payloadは保存・同梱しない。
- [source kit再build](sid_psid_cia_sourcekit_rebuild_01.json): 独立コピー29 inputsのみで再生成し、
  104,302bytesのWASMとreceiptが公開コピーへbyte一致。
  WASM SHA-256 `188bfbf25383233ca6cf820fa1fb753016969c1e76220ab06b3ed7a5c929fe00`。
- [Source](sid_psid_cia_browser_01.json)／[実ZIP](sid_psid_cia_zip_browser_01.json):
  **Chromium／WebKit各26項目、合計104チェック成功**。CIAの実Worklet音声・backend往復・ROM保持、
  既存VBI／RSID／BASIC synthetic firmware・失敗保持・取消・Masterを確認した。
  1180／390px overflow0、page error0、最終PCM0。physical outputはmuteで、人の実聴は別。
- [配布記録](sid_psid_cia_package_01.json):
  `release/tetorica_sid_player_0.0.4-cia-preview.1_itch.zip`、80files／10 readable modules／1,554,732bytes。
  SHA-256 `65116b390424588789ae949a23b6df0f889ac6836a307131e7efaab5db8fd797`。
  可読JS／CSS、matching native sources／license、68 original inputsのsource ZIPを検証した。
- 固定SDK33 builds／68 outputs／75 mirrorsと両Mixer policy checkは成功し、既存gainを保持。
  SID Synth／Playground音源、旧VBI WASM、npm／Native SDKは変更していない。
  README英日AI・guide・CI trigger／test登録を更新した。commit／push／tag／公開はしていない。
- 8580は専用model候補と採用条件を上のTODOへ記録した。6581 preview overrideは追加していない。
  実ROM／BASIC、長時間・実聴、D418 digi、音色取り込みも後続。

## 第9段階: PSIDの再配置情報（2026-11-07）

- `0/0 only` のbrowser guardを置き換え、VBIは正当な空き領域と$FF/0を受理する。
  CIAは明示範囲内のalways-visibleな1pageへ独自driverを配置する。音楽payload、header、entrypointは移動しない。
  $FF/0／利用可能pageなしのCIAは具体的理由で拒否し、不正範囲やpayload overlapも従来どおり拒否する。
- native側もpage範囲とpayload overlapを再検証し、IRQ／NMI／caller／bootstrapのemit境界を設けた。
  parserとstateに元のrelocation情報、選んだpage／実driver addressを保持し、UIに空きRAMと配置先を表示する。
  古いWASMのexport不在・配置address不一致は候補のみ破棄し、旧音と次PCMを保つ。
- `npm run test:sid-player` **76件成功**、`npm run test:sid-reference` **29件成功**。
  $20／$CFの1page配置、旧$0400／$0600／$0700領域を使う自作programの保護、44.1／48／96kHzの
  分割render、FF/0・不正範囲・ABI不整合時の保持を確認。旧CIA0/0の9ケースとRSID12ケースは
  PCM／trace／状態が完全一致し、既存VBI WASM・SID DSPは変更していない。
- [実HVSC](sid_psid_relocation_hvsc_01.json): Ski Weltcup／Bullseye／Hooper／Monty Moleの
  4ファイル×2subtunes、**8件すべて有音・Stop0**。CIA4件は宣言された$08／$20／$09／$04ページ、
  VBI4件は既存backendで実行した。元ファイル無変更、曲／ROM／PCM payloadは保存・配布しない。
- [独立source kit再build](sid_psid_relocation_sourcekit_01.json): 29 inputsのコピーだけから再生成し、
  WASM113,890bytes・receiptとも公開コピーへbyte一致。
  WASM SHA-256 `ef6ae771513cea3ec2f6bd6af90c2074c96ac733c5466fdc165a0b5c3480dc4e`。
- [Source browser](sid_psid_relocation_browser_01.json)／[実ZIP browser](sid_psid_relocation_zip_browser_01.json):
  **Chromium／WebKit各28項目、合計112チェック成功**。追加2項目で元metadataと実driver address、
  再配置CIAの実PCM、FF/0 VBIからCIAへの切替拒否、不正候補時の旧音保持を確認した。
  既存ROM snapshot／Stop／Masterと1180／390px表示も成功。physical outputはmuteで実聴とは別。
- [配布記録](sid_psid_relocation_package_01.json):
  `release/tetorica_sid_player_0.0.5-relocation-preview_itch.zip`、80files／10 readable modules／1,561,381bytes。
  SHA-256 `6921f7830a5bb16e22dfdbcd554dd5deaf32edadc4dab87d2caaeea74197aebf`。
  source ZIPの68 original inputs、同梱native sources／license、全hash・CRC・実展開file一致を確認した。
- README英日AI・home・guide・scannerの対応範囲を更新。既存CIが今回のtest／fixtureも実行する。
  固定SDK33 builds／68 outputs／75 mirrors、両Mixer policy checkは成功。commit／push／tag／公開はしていない。
  8580、実ROM／BASIC・長時間／実聴、VBIのfull C64 I/O、D418 digi、音色取り込みは引き続き後続。

## 第10段階: Zyx.sidのindexed storeとVBI実行環境（2026-11-07）

- 添付Zyx.sidはlocal HVSCと同一746bytes、SHA-256 `86636945eefd200ef6ebdaee2af0afba48a21f7c0064c51bd380887e0bc1c373`。
  init750cyclesで戻り、`STA $D3FF,X`がSID $D418へ書く前のdummy read $D318で止まっていた。
  最初の$1EE4 timeoutとは別症状とユーザーも確認した。元timeoutの入力は未特定で、上限を増やしていない。
- 固定m6502の正確なSTA abs,X／abs,Y／(zp),Y cycleで、wrong-page addressと補正後SID addressを照合する。
  返り値を使わない副作用なしVIC readだけを通し、CPU／SID clockは進める。
  read-to-clearの$1E／$1F mirrors、実VIC／CIA／ROMアクセス、他opcodeは引き続き拒否する。
- 必須PAL flag $02A6=1と、毎callのentry bank $37／$36を修正した。
  init100k／play16k上限は維持し、timeoutのphaseを区別、12種類のCPU JAM/KILをcode10／opcode addressで報告。
  読込失敗時の表示に候補ファイル名を加えた。
- `npm run test:sid-player` **83件成功**、参照CLI／trace／metrics **29件成功**。
  PAL分岐、12 bank組合せ、STA3方式の25 register blockと独立SidCore PCM／readback、
  timeout／JAM／実I/Oの区別・旧音保持を確認。従来4fixture×3rateのVBI12ケースはPCM／trace／状態が完全一致。
- [Zyx実ファイル](sid_zyx_vbi_verification_01.json): Native／実WASMとも10秒、501plays、RMS約0.113528／peak約0.351852、
  finite／有音・Stop0・cycle停止。入力は無変更、曲／PCM／ROMは保存・同梱しない。
  ユーザーは音が正常になっていそうとコメントした。全曲の実聴確認とは分ける。
- [source kit単独再build](sid_vbi_environment_sourcekits_01.json): VBI14inputs／C6429inputsで両WASM・receiptがbyte一致。
  VBI74,326bytes SHA `467a893714280a9830bb421dd255aac4ad7956fa8fd2895359a5e056cb98ab76`。
  共有CPU guide修正のためC64 receiptも更新したが、C64 WASMは前ef6ae771…480dc4eと不変。
- [Source browser](sid_vbi_environment_browser_01.json)／[実ZIP browser](sid_vbi_environment_zip_browser_01.json):
  **Chromium／WebKit各29項目、計116チェック成功**。追加項目でPAL／bank／STA／phase診断と候補名・旧音保持を実Workletで確認。
- [配布記録](sid_vbi_environment_package_01.json): `release/tetorica_sid_player_0.0.6-vbi-env-preview_itch.zip`、
  80files／10 readable modules／1,566,529bytes、SHA `b758542f6c9152f3e5ce5b2aa057658f8ab62df289dba68249b8969de031a5f8`。
  original inputs68件、matching sources／license、ZIPのhash・CRC・実展開一致を検証した。
- 固定SDK33 builds／68 outputs／75 mirrorsと両Mixer checkは成功、SID Synth／PlaygroundのDSP・gainは不変。
  commit／push／tag／公開はしていない。次は上のローカルHVSC全体監査を進める。

## 第11段階: ローカルSID corpus全体監査（2026-11-07）

- [全体結果](sid_corpus_audit_01.md)と[独立検証](sid_corpus_audit_verification_01.json): 61,157件すべてを分類し、27,547件が既定subtuneの2秒／48kHz実行・有限PCM・Stop検証を完走した。Direct VBIを使った当時のbaselineで、今回のC64経路とは区別する。
- 全件resumeは追加0件・入力manifest／fingerprint／checkpoint不変。元曲／ROM／PCMはコピー・同梱していない。全subtune・曲全体・実聴の確認は後続。

## 第12段階: C64 VBIと長い初期化（2026-11-07）

- 上の6作業は完了。[結果報告](sid_c64_vbi_result_01.md)に設計、対象限定再検証、残る制限と再開情報をまとめた。UIのdefaultはC64 machine、Direct VBIは明示選択。元header・payload・VBI timingを保ち、driver空きRAMがない場合は理由付き拒否とする。
- `npm run test:sid-player` **93件**、`npm run test:sid-corpus` **10件**、`npm run test:sid-reference` **29件**が成功。[Source](sid_c64_vbi_browser_01.json)／[実ZIP](sid_c64_vbi_zip_browser_01.json)のChromium／WebKit各31項目、**合計124チェック成功**。Stop／失敗保持・ROM snapshot・subtune・mobile表示を確認した。
- [実ファイル7ケース](sid_c64_vbi_verification_01.json)を各10秒確認し、すべて有限PCM・nonzero・init復帰・Stop成功。Western Games全3subtunesを含む。synthetic firmwareでの確認を含むが、実Commodore ROM／BASIC互換の検証ではない。元$1EE4のユーザー入力は未確認として区別する。
- [対象再検証](sid_c64_vbi_retry_01.json)は3,297件完了。旧失敗3,233件のうち3,025件が完走（nonzero3,015／全zero10）。control64件はstatusを維持し、CIA／RSID32件はRMS／peakも完全一致した。全完走3,089件で96,000frames／有限PCM／Stop zero・CPU停止／PSID init復帰を確認した。[独立比較18項目](sid_c64_vbi_retry_comparison_01.json)とresume追加0件・全hash不変も成功。全61,157件の再監査ではない。
- [source kit単独再build](sid_c64_vbi_sourcekit_01.json)は29 inputsのみからWASM116,131bytes・receiptがbyte一致。WASM SHA `d05d625d863c434e6992a2b553019b4a261c00d484faeff7633bc357ac5b5c9c`。
- [配布記録](sid_c64_vbi_package_01.json): `release/tetorica_sid_player_0.0.7-c64-vbi-preview_itch.zip`、80files／10 readable modules／1,573,534bytes、SHA `730c1c4d596506e96fba6cca40cbcc73c20d097f57a38c300697a9c6887ed895`。68 original inputs、43 native inputs、matching sources／license、ZIP・nested ZIPのCRCと実展開byte一致を確認した。
- 固定SDK33 builds／68 outputs／75 mirrorsと両Mixer checkは成功。既存SID Synth／PlaygroundのDSP・gainを保持した。known8580／NTSCは未対応、実ROM／BASIC・実聴／長時間・D418 digi・音色importは後続。commit／push／tag／公開はしていない。

## 第13段階: 専用8580コアの調査・独立試作（2026-11-07）

- [候補・license比較](sid8580_core_selection_01.md)と[結果](sid8580_probe_result_01.md)を記録した。sidera 1.1.1のMIT／依存なしlibraryを固定し、元APIを保持する最小cycle-access patchだけを追加した。本番Player／Synth／SDKは変更せず、既知8580の拒否は維持した。
- [Native／WASM](sid8580_probe_verification_01.json)は14fixture×3rates×2modelsの**84ケース**でPCM／read／chunk完全一致。[元API](sid8580_legacy_api_01.json)は6設定・**376,200samples**完全一致。外部GPL参照**28ケース**は診断のみで、実機精度や採用合格の判定ではない。
- [Chromium／WebKit](sid8580_probe_browser_01.json)は各28、**計56ケース**で最終WASMとNativeのPCM／read一致。単体コアのM2 batch測定は実時間の約70倍前後で、C64／AudioWorklet／音切れ・実聴を検証した結果ではない。
- write-only busは試作`[0,0,0]`に対し8580参照`[165,165,165]`。reset初期値・pipeline・resonance／RC／scale／sampling差も残る。上の採用前TODOへbus実装、条件を揃えた品質比較、各coreのreadをCPUへ返すclosed-loop fixtureを明示した。
- [独立source kit再build](sid8580_probe_sourcekit_01.json)は**53inputs**からNative／WASM／receiptがbyte一致。WASM1,390,542bytes、SHA `96abb0664a7aa7f3df7b1a63fa8f9b8e576a492936ce4175db1fd7019b4610bd`。
- 最終`release/tetorica_sid8580_probe_20261107_sources.1.zip`は71files／541,950bytes、SHA `244d0aa1f07ea70728bca200f94d0a89e1b61b488ea49af79ca09738c557bd8d`。source／license／WASMと、installed Rust1.91.1標準ライブラリーの無変更copyright／license notices・provenanceを含む。追加noticeは`third_party/sidera/toolchain-notices/`に分け、53app inputs／Native・WASM再build一致は不変。optional Cargo playerはbuildしておらず、Native binary／GPL SID参照／ROM／音楽も含めない。
- 新CI workflowのNative／WASM・元API・receipt手順をローカルで確認した。GitHub Actions実行、commit／push／tag／公開はしていない。既存runtime33builds／68outputs／75mirrorsとPlayer／native receiptのcheckは成功。実8580曲・Player接続・本番ブラウザー音声は後続。

## 第14段階: bounded busと実6502閉ループ（2026-11-07）

- [結果](sid8580_bus_cpu_result_01.md)と[一次資料・362probe](sid8580_bus_reference_01.json)を記録。wrapperのmodel別TTL7,424／663,552cyclesとwrite／read更新を追加した。write-only readの残存寿命は半分・最小1で、参照の残存0にbyteが残るedgeは意図して再現しない。実機の普遍的定数・完全一致とはせず、POTはerror5で拒否する。
- [旧probe `_02`](sid8580_probe_verification_02.json)は**84 PCM hash不変**。[bus](sid8580_bus_verification_01.json)**66**＋[実CPU](sid8580_cpu_verification_01.json)**36**、計**186 Native／WASM／chunkケース成功**。元sample APIも6設定・376,200samples完全一致を再確認した。旧`_01`記録は書き換えていない。
- 実m6502の同一programがcycle41,219で6581=0／8580=`$A5`を読み、RAM署名`$32`／`$31`とSID frequency-low64／128へ分岐する。OSC3／ENV3も実read`[0,255,177,255]`をRAM経由でSIDへ反映する。POT／JAM／ROMは偽の値を返さずaddress付き停止。full C64や実曲再生の検証ではない。
- [Chromium／WebKit `_02`](sid8580_probe_browser_02.json)は各50 chip・bus＋12 CPU、**計124一致**。Native `run(1)`は[局所測定](sid8580_tick_performance_01.json)で約5.09倍・valid PCM不変、CPU＋SIDのbatchはNode約40倍の実時間速度を観測した。Worklet／音切れ・実聴の性能保証にはしない。
- [独立source kit `_02`](sid8580_probe_sourcekit_02.json)は**59inputs**からNative2本／WASM2本・receiptがbyte一致。kit内でも84＋66＋36チェック成功。chip WASM1,391,574bytes SHA `2b82f306f1c9460ef4558d7faf73cf1eb49b7de2eead09d8c5e38c858429667d`、CPU WASM1,473,638bytes SHA `38118d68288cdde417a2fab099497ec057432de6c25058b7db467bb26e2dffb2`。
- `release/tetorica_sid8580_bus_cpu_20261107_sources.zip`は86files／962,936bytes、SHA `dc8cc1b3c358e0fe86b3dcfa0f3d658f540dbdbc3a271f6124bad898b0227835`。source／Node checker／2WASM／m6502 license／Rust標準library noticesを含み、Native binary／GPL SID参照／ROM／音楽を含めない。
- CI9stepsのローカル検証、runtime33／68／75・既存PSID／C64 receiptは成功。GitHub Actions実行・commit／push／tag／公開はしていない。本番Player／Synth／SDK・8580 guardは保持した。初期条件・filter／参照samplingを揃えた品質比較、実8580曲、C64／Worklet／UI採用は後続。

## 第15段階: 制御された品質比較・opt-in damping（2026-11-07）

- [方法](sid8580_quality_method_01.md)と[結果](sid8580_quality_result_01.md)を記録。TEST／Gate後の実readとchip-rate公開API＋整数samplerで観測条件を揃え、PCMを補正せずharmonicの同一core dry比を測定した。[数学7件](../../test/sid8580_quality_metrics.test.mjs)と[capture6設定](sid8580_quality_capture_reference_01.json)も成功。
- [初期228ケース](sid8580_quality_comparison_01.json)・165transferから、FC128／sustain4／48kHzのRES4・8・12・15だけでdamping係数をfitした。`8580-resonance-logfit-v1`は明示opt-in・既定Off。6581、cutoff／gain／RC／ADSR等は変更しない。
- [before](sid8580_quality_validation_before_01.json)／[after](sid8580_quality_validation_after_01.json)は各260ケース。[独立解析](sid8580_quality_validation_analysis_01.json)の真のholdoutはFC256／RES2・6・10・14／sustain4・15の8曲線で、Q平均絶対相対誤差13.43%→3.10%、7／8曲線改善。176点の平均絶対dB誤差1.437→1.126、109改善・67悪化。FC128／RES15のdense再測定は学習設定の再現で、9本目のholdoutではない。
- [policy](sid8580_calibration_policy_01.json)は6設定・6581不変42scene・8580 positive3・instance6を確認。旧84PCM／bus66／実CPU36・default controlled228・元API376,200samplesを保持。[browser `_03`](sid8580_probe_browser_03.json)は各73、**計146一致**。実機／full C64／Worklet／実聴とは区別する。
- [source kit `_03`](sid8580_probe_sourcekit_03.json)は62inputsから全5出力とreceiptがbyte一致、11検証command成功。`release/tetorica_sid8580_quality_20261107_sources.zip`は105files／1,059,166bytes、SHA `8356799fd4b2f8313d570687e089f04615cbfd32366f731bcb3aaab681741b62`。可読source・2WASM・test／checker・license／Rust noticesを含み、Native binary／GPL SID参照／ROM／音楽／PCMを含めない。
- CI13stepsへ数学・候補quality・policy・source closureを追加。固定runtime33／68／75・SID／PSID／C64 receiptも成功。GitHub Actions実行・commit／push／tag／公開はしていない。次はcutoff差の別検証で、Player／Synth／SDKと既知8580 guardは保持する。

## 第16段階: LP／HP crossoverとopt-in cutoff（2026-11-07）

- [事前plan](sid8580_cutoff_plan_01.json)・[方法](sid8580_cutoff_method_01.md)・[結果](sid8580_cutoff_result_01.md)を記録。同一harmonicのLP／HP比を使い、Qや共通RCと分離したoperational crossoverを推定する。内部pole／−3dB／実機精度とは呼ばない。数学・合成fit guard13件が成功。
- training7 FC／48k／sustain4／RES0の189ケースから`8580-cutoff-crossover-v1`を固定。未学習6 FC＋4 interactionを、Off／共振のみ／cutoffのみ／両方の各270ケースで比較した。profileは独立opt-in・既定Off、FC0の30Hzは未測定の元anchor。
- [独立解析](sid8580_cutoff_validation_analysis_01.json): cutoff単独は交点平均絶対誤差9.855%→0.918%、10／10改善、180点の平均絶対誤差1.331→0.648dB、148改善・32悪化。共振のみへ追加すると9.866%→0.902%、1.216→0.317dB、164改善・16悪化。FC96は約−3.081%・最大2.795dBが残る。
- [policy](sid8580_cutoff_policy_01.json)・旧84 PCM／bus66／CPU36・元API376,200samples、既存resonance260ケースを保持。[従来browser](sid8580_probe_browser_04.json)146＋[cutoff browser](sid8580_cutoff_browser_01.json)60で計206一致。full C64／Worklet／実聴ではない。
- [source kit `_04`](sid8580_probe_sourcekit_04.json)は63inputsから5出力／receiptがbyte一致し、15検証command成功。`release/tetorica_sid8580_quality_20261107-cutoff_sources.zip`は122files／1,214,079bytes、SHA `369fbbe97506407679c74f58c57cdad3973d7cea2880e79d86660717d27fc02c`。可読source・2WASM・training JSON／plan／fit／解析・test・license／Rust noticesを含み、Native binary／GPL SID参照／ROM／音楽／PCMは含めない。CI17steps、過去ZIP／記録は不変。
- 固定runtime33／68／75・既存SID／PSID／RSID receiptも成功。GitHub Actions実行・commit／push／tag／公開はしていない。低FC／mode gain／pipelineと研究用C64・AudioWorklet接続、実8580曲の実聴を次に分け、本番Player／Synth／SDK・既知8580拒否は維持する。

## 第17段階: 研究用8580 C64／AudioWorklet（2026-11-07）

- 独立[`/sid8580-lab/`](../sid8580-lab/index.html)と[結果](sid8580_machine_result_01.md)を追加。無変更chips C64 CPU／CIA／VICと、固定MIT sidera endpointを2WASMの直接function importで結ぶ。既存hostのmarked copy・実read→CPU・別memory／handle所有権・12Hz software DC blockerを明示し、本番Player／Synth／SDKや既知8580拒否は変更しない。
- [Native／WASM](sid8580_machine_verification_01.json)は13fixture×3ratesの39＋独立profile4、計43ケース成功。997分割、実IRQ／NMI／bus・OSC／ENV readに依存するRAM／SID書込、長いinit／Stop／reload／旧音保持／instance隔離を確認した。
- parser6＋[pending init検証6](../../test/sid8580_machine_preflight.test.mjs)の計12テスト成功。late ROM／取消／2M-cycle timeoutを採用前に検査し、fresh Workletで元init PCMを再生する。
- [実browser](sid8580_machine_browser_01.json)は各13・計26成功。VBI／CIA song2／RSID、実readの因果関係、profile、失敗RPC、load／Start ACK取消を確認。44.1k／128framesで通常render平均約0.19～0.47ms・最大1～2ms、load10～20msは別計測。粗い`Date.now`の短い無音測定で、実聴・長時間・音切れ保証ではない。
- [local実ファイルsmoke](sid8580_machine_hvsc_smoke_01.json)はPAL8580宣言PSID v2の3件を各2秒／48kで実行し、96,000frames有限・非zero／Stop全zero。CIA199・VBI各100 playを観測した。曲・PCMは保存せず、実曲のAudioWorklet／実聴・全corpus互換は未確認。
- [独立source kit](sid8580_machine_sourcekit_01.json)は99inputsから2WASM＋Native・receiptがbyte一致、5検証command成功。`release/tetorica_sid8580_machine_20261107-machine.1_research.zip`は161files／856,803bytes、SHA `c7b725a2fe7c212597188454dc4e4a03b7b35a4f2d257dd6c33a666d8a3f8d6f`。CRC／全files一致、可読source・test・生成器・2WASM・license／Rust・Emscripten noticesと自作demoを含み、Native binary／GPL SID参照／ROM／ゲーム曲／PCM・repo専用HVSC toolは除外した。初回失敗stageは保持。CI12stepsで、GitHub Actions実行・commit／push／tag／公開はしていない。
- [ ] 手動: 自分で用意した8580実曲のVBI／CIA／RSIDと複数subtuneを参照再生と聴き比べる。元曲／ROMはrepo・ZIPへコピーしない。
- [ ] 後続: 長時間・background／device切替・高負荷の音切れ／memoryを測定し、低FC／mode gain／read・audio pipelineやDAC／digi等の残差を調べる。本番採用は別判断。

参考: [VGM specification](https://vgmrips.net/wiki/VGM_Specification)、
[HVSC](https://hvsc.c64.org/faq)、
[sidplayfp manual](https://github.com/libsidplayfp/sidplayfp/wiki/sidplayfp)。
