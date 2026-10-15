# Virtual Files: 汎用 sync と checkpoint

作成日: 2026-10-15
状態: 共通 sync／checkpoint 実装・検証済み。Synth UI 接続は次段階（未公開）

## 汎用 sync を基礎にする

ライブラリーの基本操作を `await fs.sync(srcPath, {syncRoot?})` として整理する。
`srcPath` はファイルとフォルダーの両方を受け付ける。フォルダーでは配下の構造と空フォルダーも扱う。
Checkpoint はこの同期処理を利用する用途の一つであり、同期そのものと初回編集時の自動退避ルールは区別する。
任意の同期先を指定しただけでは、その保存先を非表示・Git 除外にはしない。

- 同期は一方向。ファイルの種類とバイト列を維持する。
- 同期先の選択範囲へ内容を反映し、フォルダーでは同期先だけにある子要素も除く。
- 対象外のパスは維持し、不正なパスや型の衝突は反映前に検証する。
- 外部 Storage でも呼び出し方を維持できるよう、公開 `sync` は初めから Promise を返す。
- `app-storage://~/` 等は将来の対応先。今回実装しない URI を仮想パスへ誤変換せず、明確に拒否する。

第 2 引数はユーザーの提案に合わせて明示的な options オブジェクトとし、文字列の引数は受け付けない。
`syncRoot` は格納先のルート。元ファイル／フォルダーの絶対パスをその下に保つ。省略時は `/.tet.ss`。

```js
await fs.sync('/tones/bass.vgi');
// -> /.tet.ss/tones/bass.vgi
await fs.sync('/tones', {syncRoot: '/ss.tet'});
// -> /ss.tet/tones/ 以下
// 戻り値: {sourcePath:'/tones', destinationPath:'/ss.tet/tones', changed:true/false}
```

- 同期先のみの子要素を除く範囲は対応する subtree に限定する。`/ss.tet/other` 等には触れない。
- 同期元なし、ファイル／フォルダーの型衝突、保存先祖先にファイルがある場合は全体を拒否する。
- 同内容の同期では revision と通知を更新しない。
- `sync('/')` は同期先 subtree を同期元から除外し、入れ子のバックアップを作らない。
- 同期元が `syncRoot` 自身または配下の場合は拒否する。`syncRoot:'/'` は同一パスへの no-op。
- 通常の `sync` は自動 checkpoint や `.gitignore` 追加を行わない。`.git` も同期可能な通常データとして扱う。
- `/.tet.ss` は checkpoint 用に予約した保存先なので、Git アダプター／アプリ一覧の除外はこの場所にだけ適用する。
- 公開 `sync` は Promise を返すが、現在の同一 VFS 内では待機せず原子的に反映する。外部 Storage の非同期・競合制御は未実装。

## 目的と合意したルール

音色専用の current/saved state ではなく、Virtual Files 共通の保存点を持つ。
通常パスのファイルが常に current。演奏・Run・通常の読み込み・Git は current を使う。
checkpoint は戻り先であり、外部 Storage への Save/Sync、Git の commit、操作ごとの Undo とは独立する。

- **Set checkpoint**: 現在の内容でファイルの保存点を作成・更新する。
- **Revert to checkpoint**: 保存点を通常ファイルへ戻す。保存点自体は残す。
- **Auto checkpoint ON**: 既存ファイルを最初に実変更する直前、保存点がなければ変更前の内容を記録する。
- **Auto checkpoint OFF**: 自動作成しない。既存の保存点は削除・更新しない。
- Auto が ON でも、既存の保存点は更新しない。更新するのは明示的な Set checkpoint のみ。
- 内容・種類が同じ書き込みでは保存点を作らない。新規ファイルの作成自体も退避しない。作成後の最初の編集は、その作成済み内容を退避する。

```text
初期 A
編集 -> current=B, checkpoint=A
編集 -> current=C, checkpoint=A
Set checkpoint -> current=C, checkpoint=C
編集 -> current=D, checkpoint=C
Revert to checkpoint -> current=C, checkpoint=C
```

## 保存形式と API

保存点は 1 ファイルにつき 1 世代。文字列・バイナリを元の種類のまま複製し、読み取り時もコピーを返す。

```text
/presets/bass.vgi                  current
/.tet.ss/presets/bass.vgi   checkpoint
```

既存の `createVirtualFileSystem(entries)` を維持し、第 2 引数に `{autoCheckpoint?: boolean}` を追加する。ライブラリの既定値は OFF。

```js
const fs = createVirtualFileSystem(entries, {autoCheckpoint: true});
fs.checkpoints.set('/index.js');
fs.checkpoints.revert('/index.js');
fs.checkpoints.has('/index.js');
fs.checkpoints.get('/index.js');
fs.checkpoints.isModified('/index.js');
fs.checkpoints.setAuto(false);
console.log(fs.checkpoints.auto);
```

`autoCheckpoint` はインスタンスの設定で、外部 Storage へ保存する設定はホストが担当する。
通常の snapshot は current と checkpoint の両方を含むが、この実行時設定は含めない。
既存 `fs.checkpoint()` は同一ストアに束縛された全体 Undo 用 API として変更しない。
保存点 API は通常ファイルだけを対象にし、ディレクトリー、`.git` 内部、`/.tet.ss/` 内部への操作は拒否する。

### 概念と API の区分

実装中の相談を受け、今回追加する公開操作は `fs.checkpoints` 名前空間にまとめる。
未公開の試作段階の `setCheckpoint` 等の flat API は残さない。

| 概念 | API / 担当 | 用途 |
| --- | --- | --- |
| Current | `fs.get/writeFile/...` | 普段の読み書き、演奏・Run・Git の対象 |
| ファイル／フォルダーの同期 | `fs.sync(src, {syncRoot?})` | 別ルート配下へ元のパスを保って一方向に反映 |
| ファイル単位の保存点 | `fs.checkpoints` | 同期を利用する 1 ファイル 1 世代の復元点。初回退避等の運用規則を持つ |
| プロジェクト全体の状態 | `fs.snapshot/restore` | データの受渡し・Import・永続化 |
| 既存の操作 Undo | `fs.checkpoint()` / `undoFileChanges` | セッション内 revision に基づく競合検出付き Undo |
| 外部 Storage / Git | ホストの永続化、任意 Git アダプター | 永続化・共有・履歴。外部 Storage を syncRoot に接続するのは将来の拡張 |

`checkpoints.get()` は内部保存点ファイルのコピー（内部パス・revision を含む）を返す。
`set/revert` の `expectedRevision` は通常ファイルの revision を検証する。
保存点がない場合の `isModified()` は false。存在の判別には `has()` を使う。

## 編集・復元・ファイル操作

- 単一ファイルの書き込みと、patch／Shell リダイレクト等の編集経路で Auto を適用する。
- `replace`／`restore` の既定は完全置換・完全復元を維持する。Import、Undo、New Cassette は追加の退避を発生させない。
- bulk の編集経路は `replace(entries, dirs, {checkpointChanges: true})` を使う。
- 退避先のパス衝突や revision の不一致、型の不正などは、current・checkpoint の双方を変える前に検証する。
- ファイル／フォルダーの移動・名前変更では対応する checkpoint も移動する。複製では checkpoint も複製する。
- 削除は対応する checkpoint も削除する。削除したファイルの復元履歴は今回の対象外。既存の操作 Undo は引き続き使用できる。
- 保存点の内部書き込みが再帰的に checkpoint を作らないようにする。

## Git・Cassette・利用アプリ

- 保存点を初めて作る際、ルート `.gitignore` に `/.tet.ss/` を重複なく追加する。既存の内容を保持し、管理処理自体を自動退避の再帰対象にしない。
- Git の通常 status/add から内部保存点を除外する。明示的な内部パスの add も拒否する。
- Git 操作の検証用 clone、Import、復元は Auto OFF／完全置換で扱い、作業ファイルの実変更だけを意図して退避する。
- snapshot と Cassette Export/Import は両状態を保持する。Export・読み込み・音色切替・終了で保存点を勝手に更新しない。
- Synth／Playground の通常ファイル一覧・音色一覧では checkpoint を通常のファイルや音色として二重表示しない。内部データは消さない。
- 同じ通常パスを読む限り、Synth／Playground とも current を使用する。別の下書き優先解決は作らない。

## 今回の実装範囲

1. Virtual Files 共通 API、型定義、移動／複製／削除、編集経路の統合。
2. Git 除外、snapshot／Cassette 往復、既存 Undo との整合。
3. README、Node/browser 配布モジュール、インストール済み package の検証。
4. 実装結果と未実施事項をこの文書へ追記する。npm 公開は今回の指示には含めない。

### 次段階: Synth UI への適用

共通機能の後、Set checkpoint／Revert to checkpoint／Auto checkpoint を Synth に接続し、切替時の Unsaved instrument 確認を置き換える。
現在の Synth は変更中の音色を VFS へ都度反映する構造ではないため、共通 API 追加だけではダイアログの動作は変わらない。
内蔵音色の初回編集時のファイル化、起動時 IndexedDB 復元との競合、ファイル操作 Undo との区別も対象にする。
TFI/VGI に含まれない編集情報を無断で失わないよう、音色ファイルの表現範囲を先に整理する。
Auto checkpoint の ON/OFF と current の永続化を混同しない。

## 必須検証

- Auto の既定 OFF、ON/OFF 切替、初回変更前の退避、既存保存点不変、同内容書き込み、新規作成。
- 手動 Set、Revert、テキスト／空文字列／バイナリ／データ種類変更、コピー分離。
- 無効なパス・内部パス・保存先衝突・revision 不一致時の原子性。
- rename／move／copy／delete と保存点の追従、空ディレクトリー・フォルダー全体の操作。
- patch／Shell リダイレクト／Git の作業ファイル変更、通常 status/add、内部 Git データ除外。
- snapshot／restore／Cassette の両状態保持、Import で追加退避しないこと。
- 従来の revision・patch・Undo・Shell・任意 Git の回帰、型チェック、依存なしの npm tarball インストール。

## 実装結果（2026-10-15）

- `packages/virtual-files/src/sync.js`: ファイル／フォルダーの同期計画を共通化。対象 subtree のみを置換し、型衝突・重なりを反映前に検証する。
- `filesystem.js`: 公開 `fs.sync(src, {syncRoot?})`、`fs.checkpoints`、初回実変更時の自動退避、bulk 編集の運用規則。既存の transactional `checkpoint()` は維持。
- Checkpoint の Set/Revert と汎用 sync は同期処理を共有する。自動退避・管理用 ignore は checkpoint 側の規則。同期先は `/.tet.ss` に統一した。
- 同期時に対象外の大きな sample／Git pack を複製しないよう、内部だけで不変データを共有する。同期先と公開読み出しのバイナリは引き続きコピーする。
- `patch.js`／`shell.js`／`git.js` と Playground の guarded shell が編集モードを引き継ぐ。
- Git の draft を snapshot 復元すると revision が再採番され、同サイズの再編集が clean と誤判定される既存問題も修正。Git stat に実ストアの revision を引き継ぐ。
- Synth／Playground の一覧・通常操作から checkpoint 内部を除外し、Cassette／autosave では内部ファイルを保持。Clipboard Copy はコピー時点の current／checkpoint を保持する。
- 型定義、README、`docs/js/tetorica_virtual_files` とブラウザー／Tauri 用 Git bundle を再生成。
- Synth 配布スクリプトへ新しい `sync.js` を追加。Playground は既存のディレクトリーコピーを使用し、移設後の import も検証した。

### 検証結果

| 検証 | 結果 |
| --- | --- |
| VFS・sync・checkpoint・Shell・Git・Synth／Playground 関連 Node 回帰 | **172/172 成功** |
| 依存なしの npm tarball install、インストール済み sync／checkpoint、任意 Git peers | 成功。追加の必須依存なし |
| インストール済み package の型チェック | NodeNext／Bundler、strict、skipLibCheck:false とも成功 |
| 型生成・ブラウザー／Tauri Git bundle ビルド | 成功 |
| Synth Files／音色 import／Cassette 往復／内部 metadata 保持 | Chromium／WebKit とも成功 |
| Playground ローカル Git／Cassette 履歴往復／New Cassette | Chromium／WebKit とも成功 |
| Synth itch 配布生成 | 成功。161 個のローカル module／asset 参照を確認 |
| Playground itch 配布生成 | 成功。353 個のローカル module／asset 参照と release assets を確認 |
| canonical source／browser modules／両配布の VFS コア一致 | 成功 |
| `git diff --check` | 成功 |

検証用配布物は `release/hello_ymfm_wasm_checkpoint-sync-dev_itch_{synth,playground}.zip`。
npm への公開とバージョン更新は行っていない。今回のブラウザー Git 検証はローカル操作で、native HTTPS push は対象外。
Tauri 実機・Windows／Linux アプリでの再検証、外部 Storage の実装も今回行っていない。

### 残る作業

Synth の現在の音色編集を都度 VFS へ反映し、Set／Revert／Auto の UI と接続する。
今回の共通機能だけでは **Unsaved instrument ダイアログはまだ置き換わっていない**。
前述の音色ファイルで表現できる状態・初回ファイル化・起動時復元の整理を含めて次段階で対応する。
`app-storage://~/` の provider、外部同期中の競合検出／原子性は将来の実装として扱う。

## Playground での試用: Ctrl/Cmd+S（2026-10-15）

コード画面で **Ctrl+S / Command+S** を押すと、表示中のテキストファイルを `fs.sync(path)` する。
Monaco／textarea の最新内容を通常パスへ反映した後、既定の `/.tet.ss` 配下へ同期する。
既存の同期コピーもこの明示操作では更新する。成功・失敗は既存の status に表示する。

- `document` の capture handler 1 個で Monaco と textarea を共通に扱い、ブラウザーの「ページを保存」は同期の前にキャンセルする。
- キー押し続けの repeat では重複同期しない。Shift／Alt 併用、IME composition は対象外。
- Code 非表示、開いている dialog、Code 外の入力欄はショートカット対象外。
- 音色ファイルを表示中、内部パス／Git metadata／非テキストでは同期しない。特に音色画面に切り替えると `activeVirtualPath` が直前のコードを指すため、それを誤って更新しない。
- 対象は現在の 1 ファイルのみ。Run・Export・音色編集の checkpoint UI は変更しない。
- これは VFS 内の同期。ブラウザーのローカルファイル保存・Cassette ダウンロードではない。Cassette Export には同期コピーを含む。Tauri の既存 autosave も VFS 変更として取り込む。

検証: `scripts/check_playground_sync_shortcut_browser.cjs` で Chromium／WebKit の実 Monaco と textarea fallback の両方に対し、Ctrl+S／Command+S、最新バッファ、現在のファイル限定、手動再同期、音色画面の誤同期防止、衝突時のエラー表示を確認した。
関連 Node テスト **32/32**、itch 配布生成と **353** 個の module／asset 参照確認も成功。
WebKit の既存 Monaco `setModel` 時のキャンセル 1 件は rejection stack を確認して別記録し、それ以外の page error はテストで拒否する。
今回 Tauri 実機でのキー操作は未確認。

## Playground での試用: Sync / Revert ボタン（2026-10-15）

既存 **Panel ボタンの左隣**へ、同じタブバー内に小さい `Sync`／`Revert` を追加した。新しいヘッダー行は増やさない。

- **Sync**: Ctrl/Cmd+S と同じく、表示中の最新テキストを通常パスへ反映してから、そのファイルを既定ルートへ同期する。
- **Revert**: 表示中のテキストを最後に同期した内容へ戻す。同期コピーは更新しない。他のファイルにも触れない。
- 同期コピーがない、同期コピーが非テキスト、または現在のエディターと同じ内容なら Revert を無効にする。理由は tooltip に表示する。
- Code 以外のパネルではボタン群を隠す。音色・内部ファイルを表示中は操作を無効にする。
- Revert はエディターへの編集を先に適用してから通常の編集経路で VFS へ反映する。Monaco の Undo/Redo で Revert 前後を行き来でき、Undo 後も同期コピーは維持する。
- textarea fallback でも復元と VFS への反映を行う。fallback のネイティブ Undo 履歴は保証しない。
- 保存点の読み出しは path と checkpoint revision でキャッシュする。キー入力のたびに無関係なファイルやバイナリを複製しない。

検証: 実ブラウザーの Chromium／WebKit でボタンとショートカット、最新内容、対象限定の復元、同期コピー保持、Monaco Undo/Redo、textarea、TFI／内部ファイルの無効化を確認した。
1280px／390px で Panel の左隣に並び、ボタン同士の重なりがないことも確認済み。
関連 Node テスト **42/42**、itch 配布生成と **353** 個の module／asset 参照確認が成功した。
rename の既存モデル回帰テストは古い mock を実 VFS に変更し、名前変更で同期コピーも移動することを検証するよう更新した。
検証用 ZIP: `release/hello_ymfm_wasm_sync-revert-dev_itch_playground.zip`。Tauri 実機は未確認。
