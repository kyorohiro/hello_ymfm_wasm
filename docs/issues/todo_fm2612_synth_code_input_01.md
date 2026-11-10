# FM2612 Synth：Keyboard／Code入力（2026-11-10）

ユーザー承認：32Xの専用Synth UIは工事中のまま、下部をKeyboard／Codeタブにする。Filesに`/index.js`を置き、`useSoundChip('ym2612'|'segapsg'|'rf5c164'|'pwm')`、`liveLoop`／`liveFx`／`context`を使って演奏する。Playgroundの実行部品を共有し、画面の音色操作とコード演奏をつなぐ。

- [x] 軽量な共通コード実行hostを用意する。Playground既存の時計・liveLoop／livePrepare・音楽helper・FX lifecycleを再利用し、4チップのproviderを注入する。Runは新規セッション、Applyはcontextと名前付き資源を保持、Stopはループ／待機／FX／音を停止する。独自のbeat時計を二重実装しない。
- [x] SynthのFM／PSG／PCMへ接続するproviderを実装する。上の音色UI変更がコード演奏に反映されるようにし、Master／System補正・可視化を既存の経路へ一度だけ通す。PWMはCodeから既存APIで使い、専用鍵盤UIは工事中のままとする。
- [x] Keyboard／Codeのコンパクトなタブ、Run／Apply／Stop、ログ／エラー表示を追加する。Code編集中に演奏・Space録音へ文字が流れないようにし、VGM／Looper／Event Rec／音源切替／出力切替／終了との所有権と取消を整理する。
- [x] FilesへJS作成／選択／編集・保存を追加し、`/index.js`は不在時だけ用意する。音色のactive pathとCode pathを分離し、既存Cassetteのコードを上書きしない。Files内モジュール読み込み、Cassette／draft復旧、移動／名前変更／削除も接続する。Cmd/Ctrl+Sは編集中の対象へ送る。
- [x] MonacoをCode初回表示時に遅延ロードし、Playgroundの補完・型・定義参照を再利用する。読み込み失敗時もtextareaで編集・実行できる。contextはセッションの状態であり、音源handleをCassetteへ永続化しない。
- [x] 自作fixture・実WASM・Nodeの意味あるテストと、全speaker接続を事前gain 0へ迂回するheadless Chromium／WebKitで実際の音声配列・UI操作・取消・保存復旧・既存機能の回帰を確認する。通常browser／native app／OS音量は操作せず、実聴はしない。
- [x] README／help・cache key・配布ファイル一覧／ZIP・再開記録を更新する。読みやすいソースを配布し、commit／push／公開はしない。

## 再開時の設計注意

- 全Playground runtimeは全音源providerを静的にimportする。4チップだけのSynthへそのまま追加して配布物を広げるのではなく、共通部品＋provider注入で接続する。
- FM以外のSynth編集音源は独立endpoint。Playgroundのfactoryをそのまま使うと別音源になるので、Synth専用adapterが必要。
- 音色編集のTFI／VGI sidecar・checkpoint・各音源のeditor contextは既存Files管理を維持する。
- 新PCM専用Workletはdirect semantic command対応。Worker実行を載せる場合は専用bridgeが必要で、初期版は既存Main実行の共通部品から接続する。

## 実装記録（2026-11-10）

- 下部のKeyboard／Codeだけを切り替える。Codeの初回表示時に既存Filesへ`/index.js`を用意し、上部の音色設定・Waveform／Spectrumは共用する。
- `tetorica_src/runtime/playground_code_runtime.js`と`docs/js`の同名mirrorを追加。全音源入りhostを読み込まず、既存の時計・liveLoop／livePrepare・音楽helper・実行guard・native FXを組み合わせた。Runで新規context、Applyで同じcontext、Stopで旧音源handleを無効化する。
- FM／PSG／PCMは編集用音源へ接続。FMのOP選択・物理CH3特殊周波数、PSGの実機Attenuation／任意のSoftware Envelope、PCMのサンプルとVolume／Pan／Root／Loop変更を反映する。CodeのPCM RAM編集はStopで現在の編集用サンプルへ戻す。PWMは既存のCode APIを接続し、専用鍵盤UIは工事中のまま。
- Code FXは演奏用busに挿入し、System補正とMasterを一度だけ適用する。MasterはCode FXより後。Applyや上部タブの閲覧では保持音を止めず、通常CH3のコード指定音程も保持する。明示的な音色選択・つまみ編集は音源へ反映する。
- Code中はKeyboard／Looper／Event Recと所有権を分ける。Keyboardへ戻る・VGM再生・出力切替・終了でCodeを停止。初回Runで録音系の停止を待ち、Applyでは未稼働Recorder／Looperの全CH離鍵処理を再実行しない。
- Monacoは初回Code表示時のみロード。対応する4音源・6FMチャンネルと実際のglobalsだけを補完／型診断へ渡す。型定義から軽量hostや音源の読みやすい実装ソースを開ける。CDN不通時はtextareaで実行／保存を続けられる。
- JS／MJS、ローカルの動的import、text／JSON／binaryデータ、Cassette、draft／未保存文字の復旧、rename／deleteを接続。音色のactive pathとCodeのpathは独立し、runtime contextや音源handleは永続化しない。読み込みで自動実行しない。
- 操作例は`docs/synth/CODE.md`。配布ZIPにも追加し、英日READMEに案内を追加した。

## 検証結果（初期実装・2026-11-10）

- `node --test --test-concurrency=1 docs/synth/*.test.mjs scripts/playground_code_runtime.test.mjs docs/playground/playground_monaco*.test.mjs docs/playground/playground_declarations.test.mjs docs/playground/playground_virtual_files.test.mjs`：513成功、失敗／skipなし。
- `sh scripts/package_itch_synth.sh code-input-final-20261110`：421 local module／asset参照成功。最終stageは`release/itch_synth_code-input-final-20261110`。
- `scripts/check_synth_code_browser.cjs`：Chromium／WebKit成功。4音源の実WASM出力配列、Applyのcontext保持・loopの重複防止・保持音、上部タブ往復時の通常CH3の約523.4 Hz保持、Masterの一度だけの適用と非線形FX後の音量調整、PSG／PCM編集、PWM予約、遅延Promise／旧handleの取消、Keyboard／VGMへの所有権移譲、JS／module／file、Cassette／draft／renameを確認。CDNを遮断してtextarea fallbackも実際に使用した。
- `scripts/check_synth_code_monaco_browser.cjs`：Chromium／WebKit成功。実Monaco 0.52.2のworkerによる型診断、4音源だけの文字列補完、定義／実装ソース表示を確認。Codeは実行せず、AudioContextのspeaker接続も0件。読み取り専用ビューのmodel切替でMonaco内部の単語ハイライトが未処理の取消を出すため、そのビューだけoccurrences highlightを無効化した。メインeditorの補完・ハイライトは維持した。
- `scripts/check_synth_pcm_browser.cjs`：最終stageのChromium／WebKit成功。従来のPCM鍵盤・離鍵・RAM／WAV編集・Files／Cassette・FM／PSG切替・実Worklet交換も確認。
- 各browser scriptの再現引数：`--root=release/itch_synth_code-input-final-20261110 --entry=/index.html --engines=chromium,webkit`。詳細receiptは`/private/tmp/fm2612-code-input-{browser,monaco,pcm-browser}-final-20261110.json`、Nodeログは`/private/tmp/fm2612-code-input-tests-final-20261110.log`。
- 通常コマンド`sh scripts/package_itch_synth.sh`も実行済み。`release/hello_ymfm_wasm_dev_itch_synth.zip`は1,046,524 bytes／276 files。検証用ZIPと全ファイル内容が一致し、browserへ配信した全assetのSHA-256もZIP内容へ照合した。通常ZIPのSHA-256：`611d6447d613cdf3f47ab62ca2f6f7f7bcfae4092c234b7f4d90d812ff6a07e8`。
- 共通runtimeのsource／served mirrorはbyte一致。`git diff --check`成功。通常browser／native app／OS音量は操作せず、実聴・commit・push・公開は未実施。

## 次回以降

### 追加：音源オブジェクトを明示するCode API

ユーザー方針：多音源を扱うため、初期コードは`const fm = await useSoundChip("ym2612")`で取得した音源の`noteOn`／`noteOff`を使う。暗黙にFMへ出力する`play()`はSynthのCode実行・補完から外す。通常PlaygroundのAPIは変更せず、既存Filesのユーザーコードも自動書き換えしない。

- [x] 初期コード／Codeガイドを取得した音源オブジェクトによる演奏へ変更する。
- [x] Keyboard／Codeを上部のYM2612／PSG／PCM／PWMと同じ共通タブデザインへ揃える。
- [x] Synth用軽量hostの`play`／`pg.play`と型定義を外し、明示的な音源API・loopの取消／離鍵を検証する。
- [x] 無音のbrowser確認・型／補完確認を更新し、配布ZIPと検証記録を更新する。

初期コードは`fm.noteOn(CH1, "C4")`→`await sleep(0.2)`→`fm.noteOff(CH1)`→`await beat(0.5)`とした。既存の`/index.js`は保持する。古い`play()`の例は手動でこの形式へ移す。軽量hostの`pg`／livePrepare APIからも`play`を除外し、通常Playgroundの`play`と他の音楽helperは維持した。

追加検証：`node --test --test-concurrency=1 scripts/playground_code_runtime.test.mjs docs/synth/synth_code_*.test.mjs docs/playground/playground_declarations.test.mjs docs/playground/playground_monaco*.test.mjs`は104成功。新規index.jsそのものの実演奏、取得handleによるloop・取消／離鍵、`play`／`pg.play`の実行API・型からの除外、通常Playgroundの維持を確認。両browser checkerは`--root=release/itch_synth_code-explicit-api-20261110 --entry=/index.html --engines=chromium,webkit`で成功し、幅1240／390の画像も確認した。全speaker接続は事前gain 0、実聴なし。

最新receiptは`/private/tmp/fm2612-code-explicit-api-{browser,monaco}-20261110.json`、Nodeログは`/private/tmp/fm2612-code-explicit-api-tests-20261110.log`。通常ZIPも再生成し、各checkerが配信した全assetのhashと現行`CODE.md`を照合した。`release/hello_ymfm_wasm_dev_itch_synth.zip`は1,046,721 bytes／276 files、SHA-256：`9f3546411661287dbc59915f3d0229922e765e178f791c4a08798575d75f178b`。runtime mirror一致、差分チェック成功。commit／stage／push／公開は未実施。

- [ ] 人による実聴：普段の音色でKeyboard／Code切替、Apply、上の音色つまみ、liveFxの使い心地を確認する。今回のAI検証は音声配列だけを読み、スピーカー出力は全接続を事前gain 0へ迂回した。
- [ ] Worker実行が必要になったら、Synth専用PCM endpointへのbridgeと所有権を設計する。今回のJavaScript loopはMainで実行する。
- [ ] ユーザーのタイミングでcommit／push／itch.io公開。自動公開はしていない。
