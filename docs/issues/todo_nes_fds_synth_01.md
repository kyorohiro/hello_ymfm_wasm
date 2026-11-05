# Tetorica 2A03 Synth

2026-11-04開始。FM2612／DMG／SPU Synthと同じ操作の流れで、NES APUとFDSの音作りを触って理解し、プリセット・JavaScriptとして持ち帰れる独立したブラウザーSynthを作る。

現在の製品名は **Tetorica 2A03 Synth**（`tetorica-2a03-synth`）、正本は`docs/synth-2a03/`。以下のNES名・旧ZIP名は当時の実装・検証記録として残す。

## リリース記録

- 2026-11-04：ユーザーより **Tetorica 2A03 Synthをリリース済み** と報告。
- 2026-11-04：ユーザーより **VGM／VGZ音色読込版も動作確認・リリース済み** と報告。
- 2026-11-04：ユーザーより **DMC読込・デモ改善版も動作確認・リリース済み** と報告。
- 下記の「公開は未実行」などは各作業・検証時点の履歴で、現在の公開状態を示さない。VGM音色読込、DMC／DPCM読込とデモ改善、今回のVGM DMC抽出は下記を参照。音声からのDPCM変換、追加形式、Tauri版は後続TODOとして残す。

## DPCMファイル書き出し（2026-11-05 完了・追加分は未公開）

編集・抽出したDMCのbytesを`.dmc`として持ち帰れるようにする。先にTODOを記録してから実装する。Noise Envelope、PCM音声の自動変換、範囲編集は今回の対象に含めない。

- [x] DMCカードへ`Save DPCM…`を追加し、現在確定している元bytesをraw binaryで保存する。空sampleでは無効にする。
- [x] 生成padding・未確定stroke・Redo側のbytesを混ぜず、Undo後とVGM抽出後の現在値を保存する。
- [x] 保存で音声device・sample・parameter・Undo履歴を変更せず、pointer操作後のkeyboard演奏を保つ。
- [x] `.dmc`はRate／Loop／Initial levelを含まず、それらは既存preset保存に残せることをUIとガイドへ記載する。
- [x] Chromium／WebKitの実download、1／4081 bytes・paddingあり・Undo／描画・VGM・再読込、独立ZIPを検証し、結果と再開方法を記録する。

既存preset schema・runtime・共有DSP／WASMは変更しない。

`editor.js`は確定済みの`preset.dmc.data`を独立copyし、`onSaveDpcm`へ渡す。`synth.js`は既存download helperを使い、headerなしの`application/octet-stream`として`2a03-sample.dmc`を保存する。32-byte originalは32 bytesのまま書き出し、再生用に生成した33-byte bufferは使わない。保存はcommit／音声更新／読込cancelを通さない。空ではbuttonを無効にし、設定も保存したい時は`Save preset…`を使う説明を近くへ置いた。

検証：`npm run test:2a03-synth`は既存の**93件成功、失敗0**。ソース版・独立ZIPは双方**Chromium／WebKitで成功**。実downloadのfilenameと全bytes、1／4081-byte境界、生成padding除外、bit／描画／Undo／VGM、未確定stroke中の確定値保存、保持音・設定・履歴・非同期読込の保持、保存したファイルの再読込を確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0。物理出力はmuteして実PCMを測定した。記録：[ソース版](2a03_synth_dpcm_export_browser_01.json)、[ZIP版](2a03_synth_dpcm_export_zip_browser_01.json)。mobileの保存buttonと設定説明、描画previewの画像も確認済み。

初回ZIP検証は全ページ撮影のviewport変更で描画が正しくcancelされ、release検証が失敗した。描画中だけviewport撮影へ変更し、撮影直後もdrawing中であることを追加確認して、両matrixを再検証した。製品のresize時cancel動作は変更していない。

配布候補：`release/tetorica_2a03_synth_dpcm-export-20261105_itch.zip`（35 files／3 bundles、1,168,443 bytes、SHA-256 `abc8b2c3dac36c8753ad85da4579c1bc21f7c19b86505325ca0a815a5e5e2d68`）。元WASM／native source・license・source ZIPを同梱し、browser receiptの45 inputsは現在のworkspaceと一致した。ガイド・英日AI README・homeの案内も更新した。

試し方：ページ再読込 → DMC → Demo sampleまたはVGM音色を選択 → bit／描画で編集 → `Save DPCM…` → `Load DPCM…`で保存したfileを再読込。Rate／Loop／Initial levelを含む全設定は`Save preset…`へ保存する。今回追加分のcommit／push／公開は未実行。ローカルURLは`http://localhost:8008/synth-2a03/index.html`。

## DMC Undo／Redo（2026-11-05 完了・追加分は未公開）

マウス描画の次の作業として、DMCのbit編集・確定した描画を1操作ずつ戻し、やり直せるようにする。PCM音声変換と範囲編集は今回追加しない。

- [x] 長さ・件数を制限した独立copyの履歴を作り、no-op／キャンセルを履歴に入れず、新しい編集でRedo側を破棄する。
- [x] Undo／Redo buttonをDMC Editorへ追加し、bit編集1回・stroke確定1回を単位にする。目標線と未確定strokeは復元データと混同しない。
- [x] Undo／Redoでも既存のDMC data更新・停止・試奏・保存経路を使い、Rate／Loop／Initial levelは現在値を保つ。
- [x] ファイル・Demo・VGM音色・presetの読込やResetでは履歴を区切り、別sampleを誤って復元しない。
- [x] Ctrl／Cmd+Z、Shift+Ctrl／Cmd+Z等をDMC Editor内で扱い、名前・textarea・他source・演奏入力やbrowser shortcutを奪わない。
- [x] 単体テスト、実WASM、Chromium／WebKit、独立ZIPで分岐・上限・Focus・キャンセル・読込境界を検証し、ガイドと結果を記録する。

履歴はセッション中のDMC bytesだけを対象にし、preset schema・共有DSP／runtime／WASMは変更しない。

`dmc_history.js`は最大64編集・全snapshot合計256 KiBの論理byte数で制限し、上限時は古い履歴を破棄する。baseline・Undo／Redo返却値は独立copyとし、無効な入力は履歴変更前に拒否する。新しい編集でRedo branchを捨て、同じbytesの編集では維持する。

`dmc_editor.js`のUndo／Redoは未確定strokeと緑の目標線を消し、現在のRate／Loop／Initial levelで復号・適用する。通常のsource切替とparameter変更では履歴を保つ。file／Demoと`load:true`のVGM／preset／Resetには明示的にresetを伝え、同一bytesの再読込でも新しいbaselineへ区切る。履歴はpreset・JavaScriptには保存しない。pointer操作はblurして演奏へ戻す。Ctrl／Cmd+Z、Shift+Ctrl／Cmd+Z、Ctrl+YはEditor内にfocusがあり、実行可能な時だけ処理する。buttonがkeyboard操作でdisabledになった時もfocusはEditor内へ残す。

検証：`npm run test:2a03-synth`は**93件成功、失敗0**（既存85件＋履歴8件）。分岐、no-op、所有権、invalid時のatomicity、件数・byte上限、空dataを確認し、既存の実WASM検証も成功した。

ソース版・独立ZIPは双方**Chromium／WebKitで成功**。音声deviceを作らない編集、bit／stroke単位のUndo／Redo、preview・cancel除外、parameter保持、source切替、shortcutの範囲、held owner停止と次の発音、Undo後の保存、同一file／Demo／VGM／preset読込とResetによる履歴切替を確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0。物理音声はmuteして実PCMを測定した。desktopのUndo状態とmobile画面も確認済み。記録：[ソース版](2a03_synth_dmc_undo_browser_01.json)、[ZIP版](2a03_synth_dmc_undo_zip_browser_01.json)。

配布候補：`release/tetorica_2a03_synth_dmc-undo-20261105_itch.zip`（35 files／3 bundles、1,167,384 bytes、SHA-256 `91382149acf6354c0a3b082c3d1716891b6df6dc65c292bc37a64b3b6f137d08`）。元WASM／native source・license・source ZIPを同梱し、browser receiptの45 inputsは現在のworkspaceと一致した。

試し方：`http://localhost:8008/synth-2a03/index.html`を再読込 → DMC → Demo sample → グラフ描画・release → Undo／Redo → 新しい鍵盤で比較。今回追加分のcommit／push／公開は未実行。

## DMCマウス描画（2026-11-05 完了・追加分は未公開）

ユーザー指定：FDSのようにマウスで波形を描きたい。描いた高さを目標に、DMCの各bitを±2／境界保持に従って選び、目標線と実際に復号したDAC波形を同時に見せる。

- [x] 選択bytes／全体表示のcanvasに描画を追加し、目標線から元bytes範囲だけのbitを決める。LSB-first・DAC偶奇・上限下限を保つ。
- [x] ドラッグ中はbit列と復号波形をpreviewし、releaseで既存DMCへ適用する。中断・source／sample変更時は未確定strokeを破棄する。
- [x] 生成paddingは編集せず、元のsample長と保存形式を保つ。bit単独編集・VGM音色・preset保存との連携を保つ。
- [x] ソフト側の描画支援であり、自由なPCM波形そのものや音声ファイルのPCM→DPCM自動変換とは区別して説明する。
- [x] 純粋な描画変換処理・実WASM・Chromium／WebKit・独立ZIP、Focus・キャンセル・最大長を検証する。
- [x] ガイド、TODO、検証結果、試し方を記録する。

共有DSP／runtime／WASMは変更しない。描いた線へ完全一致できない範囲も、DMCの制約として見えるようにする。

`dmc_draw.js`の`applyDmcTargets()`は、描いた各bit後のDAC目標に対し、実際の上昇／下降・境界保持のうち近い方を選ぶ。同距離なら元bitを保ち、LSB-firstで真のprefix levelから進める。指定外のbitとsample長は変えない。最大32,648個の目標に制限し、無効な入力は編集前に検証する。PCM音声の取り込み・resample・自動変換APIは追加していない。

既存`dmc_editor.js`のcanvasをマウス／pointerで描けるようにした。Selected bytes／All dataの両方に対応する。pointer位置はbit後のstep endpointへ合わせ、疎なpointerイベントの間もbitごとに補間し、戻って描いた部分は最後の目標を使う。緑＝目標線、青＝復号した1周目、amber破線＝Loopの次周。目標とDMCの制約による差が見える。paddingの領域は元bitへ丸めず、境界の最初の半bitも含めて編集を開始しない。

stroke中はbit列とDACだけをdraftとして更新し、Workletのbytes・保持音は変えない。releaseで変更を確定し、既存のdata-change停止／RAM uploadへ渡す。既存preset／VGM音色／keyboardと共用する。Escape、pointercancel／lost capture、blur／非表示、resize、source／sample／parameter、page／view変更で未確定strokeを破棄する。resizeが最終pointer preview内で中断した場合も、安全にcommitを中止する。適用した目標線は次の編集まで見せるが、presetへは保存しない。

検証：`npm run test:2a03-synth`は**85件成功、失敗0**（既存78件＋描画helper 7件）。到達可能／不可能な目標、tie、DAC境界と偶奇、prefix／suffix、重複目標、最大長・padding保護・不正入力を確認した。描画後の各bitは44.1／48 kHzの実WASM DAC値と一致し、有限な発音も確認した。

ソース版・独立ZIPは双方**Chromium／WebKitで成功**。実pointer操作でドラッグ中の表示と未確定bytes／owner保持、release後の確定・停止・試奏・保存、Escape／pointer／Rate／source／keyboard page／resize中断、padding境界、4081 bytes全体描画、VGMからの描画を確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0。物理音声はmuteして測定した。目標と実波形のpreview、モバイル画面も確認済み。記録：[ソース版](2a03_synth_dmc_draw_browser_01.json)、[ZIP版](2a03_synth_dmc_draw_zip_browser_01.json)。

配布候補：`release/tetorica_2a03_synth_dmc-draw-20261105_itch.zip`（35 files、3 bundles、1,163,631 bytes、SHA-256 `5c43113379fab43b9b44eefeb14d2f2dbc93681fd999ced4cfbe3d1a959fffb9`）。browser receiptの44 inputsは作業ファイルと一致した。元WASM pair／Native対応ソース11 inputs／権利通知・preset schemaは保持し、npm更新は不要。Synthガイド・英日AI README・日英ホームも更新した。

試し方：Source→DMC→Demo sample→All data→canvasをドラッグ→release→鍵盤。Loop Onで繰り返し聴ける。細部はSelected bytesで描く。手元の実聴確認、commit／push／公開は今回AIからは未実行。ローカルURLは`http://localhost:8008/synth-2a03/index.html`。

## DMCビット編集・DAC波形の可視化（2026-11-05 完了・追加分は未公開）

ユーザー指定：DPCMをbit単位で表示・編集し、LSB-first／±2 step／7-bit DAC境界を視覚的に理解できるEditorを追加する。PCM→DPCM自動変換は実装しない。

- [x] LSB-first、DAC境界・LSB保持、hardware長paddingを扱う復号helperを用意し、実WASMのDAC値と比較する。
- [x] 既存DMCカードへbit編集と7-bit DAC波形を追加する。最大4081 bytesでも操作できる範囲表示と、bitとstepの対応を示す。
- [x] bit変更・Initial level・Rate・Loopの変更を即時に表示へ反映し、paddingとLoopの継続状態を実データと区別する。
- [x] 既存のDMC音源・ファイル読込・VGM抽出・preset保存／読込・JavaScript出力へ同じ編集データを接続する。
- [x] サンプル編集時の停止とFocusを保ち、実WASM・Chromium／WebKit・独立ZIP・狭い画面で検証する。
- [x] ガイド、仕様の説明、検証結果と再開手順を記録する。

共有DSP／runtime／WASMとpreset schemaは保ち、ソフト側の可視化・編集機能として追加する。波形表示はDMC DACの数値で、Master後のオシロスコープとは区別する。

実装：`dmc_decode.js`が元bytesと生成paddingを分けて扱い、LSB-firstで各bitの前後DAC値を返す。1はlevel≤125のとき+2、0はlevel≥2のとき−2、それ以外は保持する。従って偶数開始は0..126、奇数開始は1..127を保つ。Rateは時間軸だけを変え、Loopの次の周回は前の終端levelから始める。実音源のDMA開始phaseや部分byte、mixer／filter／Masterはプレビューへ含めない。

`dmc_editor.js`を既存DMCカードへ組み込んだ。byte offset・hex値と、b0→b7の順で並ぶbit buttonを4 bytesずつ表示する。クリックで編集・即時復号し、選択bitの0／1命令とDACの前後値・境界保持を示す。1つのcanvasで`Selected bytes`の正確な階段表示と`All data`の全体表示を切り替える。全体表示はpixelごとの範囲で描き、最大32,648 bitsを無数のDOM nodeにしない。First／Previous／Next／Lastで最大1021 pagesを移動できる。生成`0xaa` paddingは灰色・読取専用で、保存される元bytesと区別する。

Loop Onでは最初の周回を青、次の周回をamber破線で重ねる。Whole pass summaryと選択bitのreadoutを分け、2周目を定常状態と誤認させない。Initial levelを変えたときのプレビューは即時で、音のInitial levelは既存どおり次のtriggerに適用する。データ編集は既存の所有権・停止・RAM再uploadを通るので、新しい鍵盤から編集済みDMCを試奏できる。preset v2保存・復元・生成JavaScript、VGMから選んだDMCにも同じEditorを使う。

Focus：pointer編集はblurして演奏へ戻す。bitにfocusした状態では0／1で値を設定し、Space／Enterでtoggle、矢印／Page Up・Down／Home・Endで移動できる。0／1は演奏キーへ伝播させず、Ctrl／Meta／Alt shortcutは奪わない。親Editorの二重renderでもpage／focusを保つ。bit編集や他の編集は古い非同期ファイル読込を無効化する既存経路を使う。

検証：`npm run test:2a03-synth`は**78件成功、失敗0**（既存72件＋decoder 6件）。bit順、偶奇と境界、padding、Loop継続、空／不正／最大長と独立copyを確認した。44.1／48 kHz、Initial level 0／1／64／65／126／127で、paddingを含む2周分の各bitのDAC値が実WASMと一致した。

ソース版・独立ZIPとも**Chromium／WebKitで成功**。無音のbit編集と即時preview、Loop 64→80→96、奇数境界、Rate時間軸、modifier保護、focus継続／演奏復帰、編集時停止、4081 bytesの末尾編集とDOM上限32 bit buttons、編集済みpreset保存・復元、VGM DMCとの共用を確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0、物理音声出力はmute。通常画面・末尾pageのモバイル画像も確認済み。記録：[ソース版](2a03_synth_dmc_editor_browser_01.json)、[ZIP版](2a03_synth_dmc_editor_zip_browser_01.json)。

配布候補：`release/tetorica_2a03_synth_dmc-editor-20261105_itch.zip`（35 files、3 bundles、1,157,492 bytes、SHA-256 `f18d66c4078f80c39b3871d577349e5e5500f4d19457e9d6693178c032b3a6dc`）。browser receiptの43 inputsは作業ファイルと一致した。元WASM pair／対応ソース11 inputs／権利通知は保持する。共有runtime／DSP／WASM／preset形式と、PCM→DPCM自動変換は変更していない。ガイド・英日AI README・日英ホームも更新済み。

試し方：Source→DMC→Demo sampleまたはVGMのDMC音色を選択→0／1 buttonを変更→previewのstepを確認→新しい鍵盤で試奏。上の出力モニターは実音、Editorはraw DAC値。今回のcommit／push／公開はAIからは未実行。ローカルURLは`http://localhost:8008/synth-2a03/index.html`。

## VGM／VGZからのDMCサンプル抽出（2026-11-04 完了・追加分は未公開）

ユーザーの「次に進めて」を受け、既存のVGM音色一覧とDMCプリセットを接続する。記録されたCPU RAMデータとDMCの再生設定を追い、選んだDMCを鍵盤で試奏・編集・保存・JavaScriptコピーできるようにする。

- [x] VGMのNES RAM blockとDMCのaddress／length／rate／loop／initial level／triggerを調べ、対応範囲と近似を明確にする。
- [x] 記録済みRAMからDPCMを独立コピーし、未知・不足RAMをゼロやデモで補わない。上書き・重複・境界と再triggerを扱う。
- [x] DMCフィルターとCH5の音色選択を既存library UIへ追加し、現在のDMC editor・鍵盤・保存へつなぐ。
- [x] 直接DACによるPCM、未対応stream、時間変化や途中書換え等は説明し、再現範囲を誤認させない。
- [x] 自作VGM／VGZ、不正・不足・上書きRAM、実WASM、Chromium／WebKit、独立ZIPで検証する。
- [x] ガイド、英日AI README、日英ホーム、リリース記録と後続TODOを更新する。

曲再生・NSF・音声DPCM encoder・共有DSP変更は含めない。先に作った単体DPCM読込とデモ改善を保つ。

実装：`vgm_import.js`から新規`vgm_dmc.js`のRAM／reader追跡を呼ぶ。`0xc2` RAM blockと、raw `0x07` bank→`0x68` RAM copy（複数bank chunkをまたぐcopyも含む）に対応。`$4012/$4013`で指定された1..4081 bytesを、`$ffff→$8000`のwrapも含め、trigger時点の独立した配列へ取り込む。bytes・Rate・Loop・Initial levelが同じ設定はまとめる。同じaddressでも上書き後の異なるbytesは別の音色になる。

継続中の`$4015` mask書込を毎回新しい発音として数えないよう、残りbyteと出力byte境界を算術追跡する。1-byteの初回fetch、one-shot終了後の同一mask再trigger、live Rate、PALのsource clockも検証した。これは曲再生やCPU／DMAの完全な再現ではなく、元の出力phase／後続命令は試奏で再現しないと音色ごとに表示する。DAC levelは最後の`$4011`書込を使い、既に進行した場合は近似と表示し、未記録なら64を使う旨を明記する。再生中のRAM書換えやrate／loop変更も選択音色へ説明を付ける。

未知・不足RAMや必要設定が足りないtriggerは採用しない。未対応の圧縮bank `0x47`や範囲外bank参照からのcopyは宛先をunknownへ戻し、古い`0xc2`のbytesを誤用しない。直接DAC PCMとNES DAC streamは復元しない。未対応stream後はreaderの動作状態もunknownとし、記録された明示的なDMC Off・設定・Onが来るまで新規captureを再開しない。空の解析結果や失敗では既存library／楽器を保持する。

従来の64 MiB入力／展開上限、400万commands／10万observations／4096 voicesに加え、独自DMC sample合計8 MiB、NES RAM転送合計128 MiB、raw bank 65,536 chunksで制限する。長いwaitはbitごとに回さず算術計算する。小さな入力で128 MiBを超えるRAM copyと、約20時間分のloop waitも検証した。

検証：`npm run test:2a03-synth`は**72件成功、失敗0**（既存51件＋DMC抽出21件）。VGM／VGZ、DMCのみ／混在、C2／07＋68、上書き・所有権・不足・wrap・1／4081 bytes・trigger timing・初期level近似・PAL・不正block／second chip／stream・保存と生成コードを確認した。抽出音色は44.1／48 kHzの実WASMで発音した。

ソース版・独立ZIPとも**Chromium／WebKitで成功**。音色一覧のDMC filter、混在7音色の選択、DMC-only VGZのbank copy、bytes／Rate／Loop／levelのeditor反映、実PCM、keyboard focus、保存／コード、不足RAM時に保持中の音とlibraryを守る動作を確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0、物理音声出力はmute。DMCを選んだモバイル画面も確認済み。記録：[ソース版](2a03_synth_vgm_dmc_browser_01.json)、[ZIP版](2a03_synth_vgm_dmc_zip_browser_01.json)。

配布候補：`release/tetorica_2a03_synth_vgm-dmc-20261104_itch.zip`（35 files、3 bundles、1,144,247 bytes、SHA-256 `bccedc5e6ef13e9d07d24a98975510a2e3fb568f13be17b4e39e599a59a5b970`）。browser receiptの41 inputsは作業ファイルと一致し、元WASM pair／Native対応ソース11 inputs／権利通知を保持する。共有DSP／runtime／WASM／preset schemaは変更していないため、npm更新は不要。Synthガイド・英日AI README・日英ホームも更新済み。

仕様確認：[VGM specification](https://raw.githubusercontent.com/vgmrips/vgmplay-legacy/master/VGMPlay/vgmspec171.txt)、[NES APU registers](https://www.nesdev.org/wiki/APU_registers)、[libvgm RAM copy実装](https://raw.githubusercontent.com/ValleyBell/libvgm/master/player/vgmplayer_cmdhandler.cpp)。

次は実ゲームVGM／VGZで`Load VGM / VGZ…`→DMC filter→音色選択→鍵盤試奏し、元の曲と近似部分を聴き比べる段階。今回のcommit／push／公開はAIからは未実行。ローカルURLは`http://localhost:8008/synth-2a03/index.html`。

## DMCデモのプチプチ音改善（2026-11-04 完了・リリース済み）

ユーザーよりデフォルトのデモでプチプチ音が多いと報告。旧257-byteデータは256 bytesの上下周期に最後の`0xff`が加わり、初期level 64から上限126に当たり、末尾level 78となる。Loop時には約62 msごとに非対称な周期が入り、飽和部分を作る。実WASMの128-frame分割生成は一括生成と一致した。

- [x] 同じ257-byteの長さで、標準Initial level 64から飽和せず、先頭と末尾のlevelが揃う低振幅の周期DPCMへ変更する。
- [x] software生成のデモであることと、発音／離鍵時のDAC切替クリックとは別であることをガイドへ記録する。
- [x] bit列のlevel範囲／始終level／釣り合いと、実WASMの繰り返し波形を確認し、旧デモの周期的な乱れが減ることを検証する。
- [x] 既存テスト、Chromium／WebKit、独立ZIPを確認し、結果と試し方を記録する。

共有DMC core・任意の読込サンプル・音量・離鍵方針は変更しない。既存の保存データはそのまま保ち、新しい`Demo sample`の内容を改善する。

`createDemoDpcm()`を、257 bytes全体に16周期を収めた低振幅sineのDPCMへ変更した。標準Initial level 64でデコードするとlevel 40..88、上昇／下降bit各1028、末尾64、飽和0になる。3周しても同じlevelに戻り、hardware長に余分なbyteを足す必要はない。デモ専用のsoftware生成処理で、一般の音声DPCM encoderは公開していない。

実WASMの比較は開始後1秒を除き、32周分のPCMでループ周波数16.12 Hzの低次8倍音（約16..129 Hz）の電力比を測定した。48 kHzでは旧`6.3313e-4`→新`2.0898e-6`（約303分の1）。これは周期的な乱れに着目した指標で、全ノイズ量や発音／離鍵クリックの削減率ではない。記録：[品質比較](2a03_dmc_demo_quality_01.json)。44.1／48 kHz両方で新デモの比率が旧デモの1/50未満となる回帰検証を追加した。

`npm run test:2a03-synth`は**51件成功、失敗0**。新デモの範囲／終端／周期／独立bytesと実WASM比較を追加した。ソース版・独立ZIPとも**Chromium／WebKitで成功**し、Demo読込、発音、Loop／Rate、停止、ファイル・プリセット・VGM／FDSの既存操作も確認した。記録：[ソース版](2a03_synth_dmc_demo_browser_01.json)、[ZIP版](2a03_synth_dmc_demo_zip_browser_01.json)。ページエラー／欠落asset／外部requestは0、390 pxでoverflow 0、物理音声出力はmute。

配布候補は`release/tetorica_2a03_synth_dmc-demo-20261104_itch.zip`（35 files、3 bundles、1,137,272 bytes、SHA-256 `8aef4b92c5556d8008fa549db33aa0ed1a4f44c1357f6d036a25361809d469cc`）。browser receiptの40 inputsは作業ファイルと一致した。元WASM pair／対応ソース／権利通知を保持する。

確認方法：ページ再読込後にSource→DMC→`Demo sample`を選び直し、Initial level 64／Rate 15でLoopをOnにして鍵盤を保持する。保存済みの旧デモは自動で置き換えない。1-bit量子化の質感と発音／離鍵のDAC切替は別に残る。ガイドも更新済み。今回追加分のcommit／push／公開は未実行。

## DMC／DPCMサンプル読込（2026-11-04 完了・リリース済み）

VGM音色読込版のリリース後の次の作業。既にエンコードされたDPCMサンプルを読み込み、既存のNES DMC回路で鍵盤から試す。音声ファイルのDPCM変換、VGMからのDMC抽出、曲再生は後続とする。

- [x] 既存DMC APIと実WASMのlength／rate／loop／level／停止挙動を確認し、共有DSPを変えずに接続する。
- [x] DMCを5番目のSound sourceとして追加し、同じサンプルを1chで再triggerする。鍵盤の音階とPitchではrateを変えない。
- [x] 1..4081 bytesのDPCM読込、hardware長へのpaddingの説明、rate 0..15／loop／initial level 0..127を既存stepper・button UIへ追加する。
- [x] 旧プリセットを読み込める形で、サンプルbytesを含む保存・再読込・JavaScriptコピーを追加する。
- [x] 不正・過大ファイルや古い非同期読込から現在の音色を守る。サンプル変更・停止・置換後の古い離鍵・one-shot終了を検証する。
- [x] 自作DPCMと実WASM、Chromium／WebKit、独立ZIPで発音・rate／loop・Focus・export・停止を確認する。
- [x] ガイド、英日AI README、日英ホーム、検証結果と次のTODOを更新する。

実装：`preset.js`へversion 2と`dmc:{data,rate,loop,level}`を追加し、旧version 1は厳密に検証してversion 2へ移行する。元の最大4081 bytesを保存し、実行時だけ`0xaa`で16×n+1 bytesへpaddingする。version 2保存物は旧リリースでは読めない。Copy JavaScriptは`await nes.dmc.loadSample(...)`→`nes.dmc.play(...)`を生成する。

`instrument.js`は既存の同期DirectTransportとmemory／register APIを使用し、Workletの命令順序と共有DSP／runtime／WASMを保つ。DMCはCH5（index 4）1chで、音階やPitchはrateを変えない。Rate／Loopは即時、Initial levelは次のtriggerに反映する。one-shotが終わっても保持キーの所有権を残し、新しいtrigger・離鍵・停止で更新する。残りbytes 0だけを見て最終byteを切らない。off/on時の途中byte継続は共有coreの挙動を保ち、全core resetで隠さない。離鍵・Stop all soundではソフト側の停止方針としてDAC levelも0にする。

UI：Source→DMCに`Load DPCM…`、`Demo sample`、`Cancel load`、既存形式のstepperとLoop checkboxを追加。自作257-byte demoはソフトで生成したデータと表示する。読み込みではAudioContextを作らない。空DMC draftは読込案内を出して鍵盤を無効にする。bit rate（約4.18–33.14 kbit/s）とpadding込みの概算時間を表示し、通常のPCM sample rateとは区別する。古い非同期読込は新しいファイル・Demo・source変更・その他の編集で無効になる。不正／空／過大／通常の音声ファイルやキャンセル時は現在の音色を保つ。

検証：`npm run test:2a03-synth`は**49件成功、失敗0**（既存40件＋preset 2件＋DMC実WASM 7件）。44.1／48 kHzで発音、1-byte／4081-byte境界、32→33-byte padding、独立したサンプルbytes、rateによる長さ変化、loop、終了／再trigger、古い離鍵、DAC停止を確認した。最終ソース版と独立ZIPは双方**Chromium／WebKitで成功**。既存VGM／FDSに加え、無音の読込・Focus・競合／キャンセル／Demoによる無効化・サンプル交換・v2保存／コード・v1移行も確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0、物理音声出力はmute。記録：[ソース版](2a03_synth_dmc_browser_01.json)、[ZIP版](2a03_synth_dmc_zip_browser_01.json)。DMCのモバイル画面も確認済み。

配布候補：`sh scripts/package_itch_2a03_synth.sh dmc-20261104`で`release/tetorica_2a03_synth_dmc-20261104_itch.zip`を作成（35 files、3 bundles、1,136,707 bytes、SHA-256 `c576d4f15830aa3de258f36205179d420750fe3143f51cc75b8783d490ee7f8a`）。browser receiptの40 inputsは作業ファイルと一致し、元WASM pair／Native対応ソース11 inputs／権利通知を保持する。共有runtimeの変更やnpm更新は不要。ガイド・英日AI README・日英ホームも更新した。

次は手元の実DPCMで実聴確認。音声からのDPCM変換とVGMからのDMC抽出は未実装。今回追加分のcommit／push／公開は未実行。ローカルURLは`http://localhost:8008/synth-2a03/index.html`。

## VGM／VGZ音色読込（2026-11-04 完了・リリース済み）

ユーザーの希望でDPCM単体読込より先に進める。DMG版と同じ「ファイル読込→音色選択→鍵盤試奏→編集・保存・JavaScript」の流れを2A03へ追加する。

- [x] 既存parserを再利用し、Pulse／Triangle／Noise／FDSの記録された初期設定を既存プリセットへ変換する。
- [x] FDSのWave RAM・変調table・音量／depth／rate／biasを扱い、未知のRAMを記録済みとして補わず、近似値は明示する。
- [x] 現在のSynthで再現できないEnvelopeや時間変化、DMC、非標準clock等は明示し、近似値を使う場合は音色ごとに説明する。
- [x] DMGと同じ音色一覧・音源filter・page・cancelを接続し、読み込みだけでは演奏・現在の音色を変更しない。
- [x] 不正／未対応ファイル、キャンセル、古い非同期読込から現在の楽器とlibraryを守る。
- [x] 自作VGM／VGZ fixture、実WASM、Chromium／WebKit、配布ZIPで検証する。
- [x] README・CI依存パス・検証結果・残作業を記録する。

`vgm_import.js`は既存のVGM parser／raw command walkerを再利用し、VGM／展開後VGZを各64 MiBまで解析する。PulseはDuty／音量／Envelope／Sweep、Noiseはperiod／mode／音量、FDSは記録された64点Wave RAMと32命令modulation、6-bit depth／rate／signed biasを既存プリセットへ変換する。DMCと曲再生は追加していない。

読み込みだけではAudioContextを作らず、楽器と保持中の音を変えない。一覧を選ぶと編集画面へ適用し、鍵盤・保存・JavaScriptコピーへ進める。24件単位のページと音源filter、キャンセルを用意した。選択音色の近似説明は常時表示し、ファイル全体の注意事項は`File notes`へ折りたたむ。表示のmatchesは同じ設定の捕捉回数で、曲中のノート数とは区別する。

FDSの不完全なWave RAMや、有効だが不完全な変調tableは音色として採用しない。無効な変調に完全な記録がない場合は、中立tableを使うことを説明する。Noise EnvelopeやFDSの時間変化するEnvelopeは静的な近似を明記し、変調phase／counterは試奏時に再開する。Envelope停止中のgain 0、後から開くvolume／frequency gate、動作後の変調table書込位置も検証した。

検証：`npm run test:2a03-synth`は**40件成功、失敗0**（既存25件＋抽出15件）。自作fixtureから抽出した5音色を実WASMで発音し、VGZ、他chip blockの透過、不正データ、上限、abortも確認した。最終ソース版・独立ZIPは双方**Chromium／WebKitで成功**し、filter／ページ送り／近似説明／保存／keyboard focus、失敗・キャンセル後の保持を確認した。390 pxでoverflow 0、ページエラー／欠落asset／外部requestは0。物理音声出力はmuteして測定した。記録：[ソース版](2a03_synth_vgm_import_browser_01.json)、[ZIP版](2a03_synth_vgm_import_zip_browser_01.json)。最終ZIPのモバイル画面も確認済み。

最終配布候補：`sh scripts/package_itch_2a03_synth.sh vgm-import-20261104-r2`で作成した`release/tetorica_2a03_synth_vgm-import-20261104-r2_itch.zip`（35 files、3 bundles、1,129,116 bytes、SHA-256 `dfdca555721702dc5a1daefb85347ad3ead527f1114c26432505ac5a566e11d1`）。browser receiptの40 inputsは作業ファイルと一致し、元WASM pair／対応ソース11 inputs／権利通知を保持する。先の`vgm-import-20261104` ZIPはFDS Envelope停止条件の最終修正前なので、このr2を使用する。

共有DSP／runtime／WASM／プリセット形式は変更していない。英日AI README・日英ホーム・Synthガイド・CIのparser依存パスも更新した。実ゲームデータとの実聴比較は次の手動確認。今回追加分のcommit／push／公開は未実行。ローカルURLは`http://localhost:8008/synth-2a03/index.html`。

## 2A03への命名・アイコン（2026-11-04 完了）

- ユーザー指定の製品名：`Tetorica 2A03 Synth`。NES APU + FDSをサブタイトルとして残す。
- [x] 正本を`docs/synth-2a03/`へ移し、旧`/synth-nes/`の入口を保つ。
- [x] 既存シリーズに揃えたグレー・赤のアイコンをimagegenで生成し、プロジェクト内へ保存する。
- [x] 表示名、favicon、日英ホーム、英日AI README、配布ZIPとコマンドを2A03へ揃える。
- [x] 既存NES API／WASMとプリセット形式を保ち、unit・Chromium／WebKit・独立ZIPで検証する。

内蔵`image_gen`でアイコンを生成した。原本は`docs/tetorica_2a03_synth.png`（1254×1254）、Web用はlossless変換した`docs/tetorica_2a03_synth.webp`。元の生成結果も残している。使用した最終promptは[tetorica_2a03_icon_prompt_20261104.txt](tetorica_2a03_icon_prompt_20261104.txt)。グレーの筐体、深い赤の2A03、矩形波・三角波・変調波、`NES APU + FDS`の表示に揃えた。

`npm run test:2a03-synth`は25件成功。ソース版と独立ZIPは双方Chromium／WebKitで成功し、製品名、1254px正方形アイコンの読込、WebPのbytes一致、favicon／Apple icon、旧URLのquery／hashを保った移動、発音・描画・Focus・保存を確認した。390 pxでoverflow 0、画面も確認済み。記録：[ソース版](2a03_synth_branding_browser_01.json)、[ZIP版](2a03_synth_branding_zip_browser_01.json)。

正規コマンドは`sh scripts/package_itch_2a03_synth.sh VERSION`、`npm run test:2a03-synth`、`npm run test:2a03-synth:browser`。旧NESコマンドは互換aliasとして残す。新ZIPは`release/tetorica_2a03_synth_branding-20261104_itch.zip`（35 files、3 bundles）。元WASM pair／対応ソース／Apache-2.0・MIT通知を保持し、browser receiptの35 inputsも作業ファイルと一致した。プリセットの`tetorica-nes-fds-voice`形式とaudio processor identifierは変更していない。CIは`.github/workflows/2a03-synth.yml`。

新しいローカルURLは`http://localhost:8008/synth-2a03/index.html`。今回のcommit／push／公開は未実行。

## 初版の範囲

- 初版実装時の仮の製品名は`Tetorica NES + FDS Synth`、旧配置は`docs/synth-nes/`。現在の製品名・配置は上記の2A03を参照する。
- 1台のNTSC NES APU＋FDSを使用する。Pulseは2chのラウンドロビン、Triangle／Noise／FDSは各1ch。鍵盤は選択した音源を全域で演奏し、最も古いノートを置き換える。古い離鍵で置換後の音を止めない。
- PulseのDuty／音量／Envelope／Sweep、Triangle、Noiseのperiod／mode／音量、FDSの64点6-bit波形／音量／変調table・rate・depth・biasを編集できるようにする。
- FDSの波形と変調をUIから試し、波形の再生周波数にどう作用するかを説明する。Yamaha式のOP構成・algorithmとしては扱わない。
- UIは既存Synthと同じMaster 0–380%、実出力モニター、2箇所のPitch、Octave、共通鍵盤、フォーカスを奪わない選択ボタン・数値ステッパーに揃える。
- 既存Native／WASM／Synth APIを再利用する。共有DSP・既存Synthを変更しない。音源の初期化と権利表記・対応ソースは配布ZIPでも自己完結させる。
- DMC／DPCMとVGM音色library読込は後続段階とし、初版はPulse／Triangle／Noise／FDSの独立Synthを完成させる。曲再生・自動伴奏・シーケンサーは対象に含めない。

## 作業

- [x] TODO、音源別の発音方式と初版の範囲を記録する。
- [x] 厳密なプリセット形式、再利用コード生成、音源別allocatorと所有権・Pitchを実装する。
- [x] 既存WASMを使うAudioWorkletと遅延初期化、Master、失敗後の再接続を用意する。
- [x] 既存Synthに揃えた画面と、Pulse／Triangle／Noise／FDS編集、波形・変調table描画を実装する。
- [x] 鍵盤、モニター、保存／読込、JavaScriptコピー、Playground／APIへの導線を接続する。
- [x] 実WASMで各音源・Envelope／Sweep／FDS変調・発音所有権・停止・Pitchとプリセット検証を行う。
- [x] Chromium／WebKitでソース版と独立ZIPを検証し、狭い画面・Focus・音声失敗を確認する。
- [x] 配布コマンド、CI、日英ホーム／READMEの入口と検証記録を整備する。

## 初版の実装・検証結果（2026-11-04）

- 初版の配置は`docs/synth-nes/`（現在の正本は`docs/synth-2a03/`）。`preset.js`／`instrument.js`／`audio.js`／`processor.js`／`editor.js`／`synth.js`に分け、DMGと共通の鍵盤・受動的モニターとSPUの基礎CSSを再利用した。この時点では仮の製品名で、専用アイコンは未決定だった。
- PulseはSweepを有効にしても2chを使う。Triangle／Noise／FDSは1ch。置換した古いキーの離鍵は現在の所有者を止めない。Noiseは音階非追従で両Pitch wheelを無効にする。
- FDSのWave／Modulationは1つのcanvasで編集対象を切り替える。Waveは64点・0..63、Modulationは32命令・`0,+1,+2,+4,Reset,−4,−2,−1`。波形はfreehand、変調は命令brushで描画し、releaseで適用する。shape／table presetも即反映。中断したstrokeは破棄する。
- FDSは初期modulation Offだが、非ゼロのtable・rate・depthを設定済みなのでOnにするだけで変化する。rate／depth／bias／volumeは保持中にも変更でき、tableは不用意に書き直さない。table／wave変更は保持ノートを停止する。
- PulseのEnvelope／Sweep編集は次回triggerで反映。Pitchでは不要なtimer上位byte書込を避けるが、境界を越えた場合は共有coreのEnvelope／length counterへの副作用を再現する。Triangleの許容範囲も、実coreが無音になるperiod 8未満を避ける。
- `npm run test:nes-synth`は**25件成功、失敗0**（engine 23件＋package 2件）。44.1／48 kHzの全音源、FDS modulationによる実PCM周期変化、所有権、プリセット原子性、初期化失敗／再接続、URL／Node globalsなしの実Workletを確認した。
- ソース版・ZIP版とも**Chromium／WebKitで成功**。4音源の実出力、Pulse RR、2つのPitch・spring、Focus、Master mute／380%、canvas適用、保存・読込・不正データ、再接続を確認した。FDS modulation Onで正規化した出力spectrum分布が変わることも測定した。390 pxでoverflow 0。ZIPの最終画面では変調brushを4列×2段に揃え、ラベルとcanvasの軸も確認した。検証中の物理出力はmute。
- 記録：[ソース版](nes_fds_synth_browser_01.json)、[ZIP版](nes_fds_synth_zip_browser_01.json)。画像は`/private/tmp/nes-fds-synth-source-images`と`/private/tmp/nes-fds-synth-zip-images`。
- `sh scripts/package_itch_nes_synth.sh preview-20261104`で`release/tetorica_nes_synth_preview-20261104_itch.zip`を作成（34 files、3 bundles）。元のNES WASM pair、Nativeの対応ソース11 inputs、Apache-2.0／MIT通知、browser inputs archiveを同梱。browser receiptの34 inputsは作業ファイルと一致した。既存ZIPの上書きは拒否する。
- `.github/workflows/nes-synth.yml`を追加し、unit→ZIP→実browser検証を接続した。日英ホーム、英日README、英語AI READMEにも入口を追加。共有DSP／runtime／WASMは変更していない。
- ローカル確認URLは`http://localhost:8008/synth-nes/index.html`。今回の確認では`python3 -m http.server 8008 --bind 127.0.0.1 --directory docs`を起動し、タイトルが返ることを確認した。サーバー停止時は同じコマンドで再開できる。
- commit／push／npm更新／itch.io公開／リモートActionsは未実行。次は手元での実聴と、必要に応じて専用名・アイコンを決める段階。

## 後続

- [x] DMC：既エンコードDPCMのファイル読込、rate／loop／level、鍵盤からのtrigger（上記2026-11-04の追加作業）。
- [ ] 手元の実DPCMファイルで実聴し、Rate／Loop／Initial level、離鍵と再triggerを確認する。
- [ ] 音声ファイルからDPCMへの変換。既存APIにPCM encoderはないため、別途仕様・検証を用意する。
- [x] VGM／VGZのDMCサンプル抽出。CPU RAM blockと再生address／length／rate／loop／initial levelを追い、現在のDMCプリセットへ取り込む（上記2026-11-04の追加作業）。
- [ ] 実ゲームVGM／VGZのDMCでRAM記録の有無と試奏を確認する。必要なら圧縮NES bank `0x47`や追加stream形式を別段階で拡張する。
- [x] VGM／VGZのNES／FDS音色library抽出と、初期設定からの試奏。既存の音符抽出と音色抽出を区別する（上記2026-11-04の追加作業）。
- [ ] 実ゲームVGM／VGZの音色を選び、原曲と聴き比べる。静的な初期設定読込と時間変化の違いを確認する。
- [ ] FDS／Triangle／Noiseの追加Envelope／length counter編集を段階的に検討する。
- [ ] 2A03の製品名・アイコンを使って、Tauri版と配布を整備する。

## 再開時

まずこのTODOと`git status`を確認する。実装途中のファイルを上書きしない。commit／push／公開はユーザーの指示に従う。
