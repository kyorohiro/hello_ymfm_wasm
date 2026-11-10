# RF5C164：Playground／npm共通の音名API（2026-11-11）

ユーザー依頼：Synth Codeに追加した`setRootNote()`／`setNote()`／`noteOn()`をPlaygroundとnpm packageでも使えるようにする。元のPCMの周期・基準音を尊重し、C++／WASMの音源機能とJavaScriptによる音程計算を区別する。

- [x] 共通RF5C164 APIの音程基準・Root note・初期化・clock／reset／raw書込みとの関係を確定。音名／integer MIDI 0〜127の検証とstep範囲を共通化し、不正入力で音やRAMを変更しない。
- [x] 共通Synthクラス・Playground Main／Worker／Nativeのport API・Node direct transportを接続。`setPitch()`／`keyOn()`などのraw APIを維持し、元サンプルの速度を明示して音名を使えるようにする。
- [x] Synth Codeは既存のUI／Code Root・software release・準備待ち／Stopの意味を保ちつつ、音名→stepの共通処理を利用する。
- [x] 型定義・補完・Playground／Nodeの使用例・npm／開発者ガイドを更新。自動音程推定ではなくsoftware tuningであることを記載。
- [x] raw書込み／基準速度／Root／clock／reset／全8CH、Main／Worker／Native／Nodeの意味ある回帰を、WASM出力配列やheadlessの全speaker事前gain 0で検証する。実聴しない。
- [x] 正規runtime artifact同期と必要な校正検証、npm build／型／pack検査、Playground・Synthの配布ZIPと再開記録を更新。commit／push／npm公開は行わない。

## 実装済みの仕様

- 共通APIは全8CH対応。`setChannel(ch, {...sample, ...})`／raw `setPitch`で基準stepを宣言し、`setRootNote()`で元の音名を指定する。Rootはclientごとのsoftware metadataで、初期値／`null`はC4。音程の自動検出はしない。
- `setNote()`は基準速度から計算して保持音を変更するため、繰り返しても音程が累積しない。`noteOn()`は音程設定＋再発音、`noteOff()`はhardware key off。raw APIと既存RPC／C++／WASMは維持する。
- Root setterは同期MIDI値を返す。Playground／MegaSynth／Nativeの通信操作はPromise、Node direct `RF5C164Synth`は同期。
- raw step変更は基準速度を更新する。resetはRootを維持して基準stepを消す。clock変更はrawと同じ音程変化を保つ。
- Synth Codeは既存どおり上段PCM editorのRootを継承し、`setRootNote(null)`もUI継承へ戻す。software release／Apply／Stopの動作は維持する。

## 完了時の状態

- npmの現公開版は0.2.37。package.jsonとローカル配布候補は0.2.38。npm publishは未実施。
- 共通API／Native／Node／型検査とnpm consumer検証は成功。Playground Main独立PCMの`stopLoop()`後の鳴り残りを修正。197＋44件の関連回帰が成功し、Chromium／WebKitともMain／Worker・共有／独立の全ケースが成功。
- ブラウザはheadlessのみ。アプリ読込前に全destination接続をgain 0へ通し、Chromiumにも`--mute-audio`を指定する。通常ブラウザ／音量操作／実聴はしない。

## 配布候補・検証記録（完了）

- npm: `tetorica-fm2612-0.2.38.tgz`。正規 `npm run pack:fm2612` 成功（358 modules／409 declarations）。隔離インストール、全8CHの実WASM出力、NodeNext／Bundler／browser型検査成功。
- itch.ioの通常コマンド `sh scripts/package_itch_playground.sh`／`sh scripts/package_itch_synth.sh` は両方成功し、`release/`のdev ZIPを更新済み。Playgroundのブラウザ向けZIPは1000 entries以下。
- 校正: strict 44-path receiptを更新し、helperの全文SHAもpin。372件成功。測定reportとgainは変更していない。
- 停止回帰: privateなraw gate lifecycleを共通facadeに追加。不正なnoteがownershipを奪うこと、古いfinallyが置き換え音を止めることも防止した。新しいRPCは追加していない。
- Synth Codeの最終ZIPはChromium／WebKit双方で成功。全speaker接続はアプリ読込前にgain 0へ通している。
- 最終照合も成功。Playground 199 assets／Synth 162 assetsのbrowser served bytesがdev stageと一致。dev ZIPの全ファイルとstage、npm tarballとsource／生成済distも照合済み。Run ZIPは1000 files／1000 entries。
- 恒久記録: [rf5c164_shared_note_helpers_verification_01.json](rf5c164_shared_note_helpers_verification_01.json)。各ZIP／tgzのサイズ・SHA、browser・Nodeテスト結果を記録した。
- 配布物: `release/hello_ymfm_wasm_dev_itch_playground.zip`（完全版）、`release/hello_ymfm_wasm_dev_itch_playground_for_run.zip`（itch.ioブラウザ実行用）、`release/hello_ymfm_wasm_dev_itch_synth.zip`、`tetorica-fm2612-0.2.38.tgz`。
- 実ゲーム素材の実聴は行っていない。npm公開・commit・pushは未実施で、今回の実装・配布物作成は完了。
