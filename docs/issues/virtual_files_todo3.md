# Virtual Files: 汎用 sync と checkpoint

作成日: 2026-10-15
状態: 共通 sync／checkpoint 実装・検証済み。Synth の current 自動反映と Sync／Revert UI を実装中（未公開）

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
`setMany(paths)` は既存の通常ファイルを重複なく指定し、全保存点を一つの検証済み commit で更新する。
音色と補助設定のような複数ファイルを一つの復元点として扱うために使用する。
`writeFiles([{path, data, expectedRevision?}, ...], {checkpointChanges?})` は複数の current を一括更新する。
既定は `checkpointChanges:true`。検証済みの組を復元するときは false とし、復元元の保存点を進めない。

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

### Synth UI への適用（実装中）

Synth では Auto checkpoint を ON にし、音色の編集を通常ファイルの current へ反映する。
切替時の Unsaved instrument 確認は Sync／Revert の明示操作へ置き換える。
内蔵音色は初回編集時に通常の VGI としてファイル化する。
TFI/VGI に収まらない音色設定は隣接する `<tone>.synth.json` に記録し、音色と一組で checkpoint／復元／Cassette を扱う。
起動時の復元・直後の reload・Undo との整合も対象とし、Auto checkpoint と current の永続化は別々に実装する。
詳細と追加接続の最終検証結果は末尾の Synth 接続仕様を参照。

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

### 共通機能の検証後に追加した作業

以下の Playground 操作と Synth の current 自動反映／Sync／Revert を同じ基盤へ接続する。
上表は共通機能の検証結果であり、その後の Synth 接続の最終検証結果を含まない。
`app-storage://~/` の provider、外部同期中の競合検出／原子性は将来の実装として扱う。

## Playground での試用: Ctrl/Cmd+S（2026-10-15）

以下は初回実装の記録。TFI／VGI の対象追加は後述の 2026-10-17 の拡張を参照。

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

## Sync 完了のフィードバック（2026-10-15）

同期成功後、同じボタンを **緑色の `✓ Synced`** に 1.8 秒間変更する。ボタンクリック／Ctrl/Cmd+S の両方、同内容の再同期にも適用する。
幅は 80px で固定し、ラベルが変わっても Revert／Panel の位置が動かないようにする。
フォーカスは移動せず、読み上げ用の小さな非表示 `role=status` で完了を通知する。通常の Sync ラベルへ戻す際は読み上げ用のメッセージを更新しない。

編集・ファイル／パネル切替・同期先更新・同期失敗時は古い成功表示を解除する。
対象ファイルとその revision を確認して表示するため、別のファイルへ移った後に前の同期成功を表示しない。

検証: Chromium／WebKit の Monaco／textarea でクリックと両ショートカット、変更なしの再同期、表示解除と時間経過、固定幅・Panel 位置・フォーカスを確認した。
既存 Revert／Undo／Redo も成功。関連 Node テスト **12/12** と itch 配布生成も確認した。

## Playground の TFI／VGI に Sync／Revert を拡張（2026-10-17）

- Files で表示中の TFI／VGI も、同じ Sync／Revert ボタンと Ctrl/Cmd+S の対象とする。
- Playground の自動 checkpoint は従来どおり OFF。明示的な Sync が保存点を作り、その後の変更で Revert を有効にする。
- Sync は現在のバイナリを `/.tet.ss` へコピーする。Revert はバイト列を復元し、登録済みプリセット・Operator 画面・既存の試聴音源へ反映する。保存点と他のファイルは更新しない。
- バイナリの変更判定は内容を比較する。音色表示中は、隠れている Monaco／textarea の内容を読み書きせず、直前のコードへ誤って同期しない。
- 保存点の種類が異なる場合は Revert を無効にする。不正な音色データは復元前に検証し、現在のファイルや試聴状態を変更せずエラーを表示する。
- テキストの Revert は従来の編集経路を維持し、Monaco の Undo／Redo を残す。

関連 Node 回帰 **434/434 成功**、配布パッケージの **363** 個のローカル参照確認が成功。
`check_playground_sync_shortcut_browser.cjs` は Chromium／WebKit とも成功。TFI／VGI の
ボタン・両ショートカット・バイト一致・音色登録・画面・実 PCM の復元と、既存の
Monaco Undo／Redo・textarea fallback を確認した。既知の Monaco `setModel` 取消は
既存の stack 判定で Chromium 4 件／WebKit 1 件を識別し、それ以外の page error は拒否する。
Tauri 実機での今回の操作は未確認。

## Synth の current 自動反映と Sync／Revert（実装済み・2026-10-15）

### 編集と操作

- Synth の VFS は **Auto checkpoint ON** で作成する。ライブラリー自体の既定値 OFF は変更しない。今回 Auto の UI チェックボックスは追加しない。
- 音色パラメーターを変更すると、通常パスの current を更新する。最初の実変更の前に元の内容を一世代だけ退避し、二回目以降の編集でその退避先を進めない。
- 既存の音色ファイルは元の実形式を保つ。拡張子だけ変更された TFI／VGI もバイト長で形式を判断し、編集によって勝手に別形式へ変換しない。
- 内蔵音色は初回編集時に `/presets/<builtin-id>.vgi` を一意な名前で作成する。同名があれば別名にし、内蔵プリセット自体を変更しない。元の内蔵音色を baseline としてから編集内容を反映する。
- **Sync**／**Ctrl+S・Command+S** は、現在の音色と補助設定を最後の同期コピーへ反映する。変更がない再同期も成功表示を返す。
- **Revert** は最後の同期コピーを current へ戻す。同期コピー自体と他の音色は維持する。コピーがない場合や内容が同じ場合は無効にする。
- 音色切替・ファイル選択・Import・Cassette Export では current を保持し、保存確認ダイアログを出さない。これらの操作が明示的な Sync の代わりに baseline を更新することもない。
- 名前付きの別音色は既存の **＋ Instrument**、Rename／Duplicate で扱う。ファイルのダウンロードは従来の TFI／VGI Export を使う。
- Sync／Revert は Files を閉じても見える音色見出しに置く。Sync 完了は Playground と同じ緑色の `✓ Synced` と読み上げ通知で示す。ファイル操作の **Undo files** は Files 側へ分ける。

### 音色と補助設定の組

```text
/presets/bass.vgi                        current の標準音色
/presets/bass.vgi.synth.json             current の Synth 補助設定
/.tet.ss/presets/bass.vgi                 標準音色の同期コピー
/.tet.ss/presets/bass.vgi.synth.json      補助設定の同期コピー
```

- TFI の本体は operators／algorithm／feedback。VGI の本体は加えて pan／AMS／PMS／B4 を保持する。
- 補助設定は版番号と種類を持つ JSON。TFI／VGI で表現できない LFO の有効状態・速度、operator AM を保存する。TFI では pan／AMS／PMS／B4 も補助設定に入れる。
- 音色の本体を通常の TFI／VGI として使い続けるため、既存フォーマットへ独自のバイト列を付け足さない。
- 読み込みだけでは既存ファイルを書き換えない。旧 Cassette に補助設定がなければ、編集または明示的 Sync の際に補助設定を作成する。baseline は変更後の設定から推測せず、元音色・既存保存点と定義済みの既定値から決める。
- 本体と補助設定を一組として検証する。Sync は `checkpoints.setMany()`、複数 current の反映・Revert は `writeFiles()` を使い、不正な補助設定や保存先衝突による片方だけの復元を防ぐ。
- 個別音色の移動・名前変更・複製・削除では、補助設定と対応する checkpoint も追従する。フォルダー全体の操作、Cassette の Export／Import も両方を保持する。
- **DAC と CH3 special mode はセッション設定**として扱い、今回の音色保存対象には含めない。
- Playground は同じ Cassette の current と補助設定を保持するが、**補助設定の LFO／operator AM などをまだ演奏へ適用しない**。Synth から持ち出した TFI／VGI 単体にも、その形式に収まらない設定は含まれない。

### 起動・永続化と確認項目

current と checkpoint はどちらも Cassette と IndexedDB のプロジェクト保存対象にする。
ノブ操作直後の reload は、従来の遅延した全体保存だけでは書込み完了前になり得るため、小さな pending-tone journal をその場で書き込み、IndexedDB の全体 draft と組み合わせる。
起動時は保存済みプロジェクトの復元を優先し、古い画面や空の初期プロジェクトを上書き保存しない。復元中のパラメーター操作も競合させない。
ブラウザーの Storage が利用不能・容量不足の場合は保持を保証せず、エラーを表示して Cassette Export による退避を可能にする。

この追加接続では、次を実ブラウザーと関連 Node テストで確認した。

- 初回の元音色退避、二回目以降の baseline 不変、内蔵音色の一意なファイル化。
- ダイアログなしの音色切替、Sync／Revert、変更なしの Sync、Files 非表示、キーボード試奏の継続。
- LFO／operator AM と TFI の追加設定、ファイル本体と sidecar、checkpoint の組の移動・復元。
- 音色編集直後・Sync 直後・ファイル操作直後の reload、IndexedDB の遅い復元、Storage エラー。
- Cassette 往復で current と元音色・補助設定を保持し、不正な sidecar を部分適用しない。
- Playground の既存 Sync／Revert と、配布 ZIP に必要な VFS モジュールが含まれること。

### 追加接続の検証結果

| 検証 | 結果 |
| --- | --- |
| VFS 全 Node テスト＋Synth project／補助設定／recovery | **124/124 成功** |
| Synth Files の自動反映、初回退避、Sync／Revert、ファイル操作、Cassette 往復 | Chromium／WebKit 成功。確認ダイアログ・page error ともなし |
| 編集直後の reload、A を編集→B に切替→B を編集→即 reload | 両ブラウザーで current と両 checkpoint を保持 |
| 遅延した IndexedDB 復元中の操作 | 保存済みファイルを保持し、起動中のノブ操作を抑止。Files の表示切替は維持 |
| localStorage 書込み失敗／IndexedDB なしの障害注入 | 両ブラウザーで確認。前者は実 IndexedDB へ即時保存、後者はエラー表示で切替を止め、Cassette Export は可能 |
| メニュー・演奏・visualizer | Chromium／WebKit 成功。visualizer は ymfm／Nuked 両エンジン |
| Playground Sync／Revert | 両ブラウザーの実 Monaco／textarea とも成功 |
| npm pack の別 consumer への offline install・型・optional Git | 成功。依存なし core、batch API、NodeNext／Bundler と init／add／commit／status を確認 |
| itch 配布生成 | Synth **165**、Playground **353** のローカル参照を検証 |

recovery は編集中の音色本体・補助設定・両 checkpoint・`.gitignore` のみを同期的に localStorage へ書く。上限は 128 KiB。workspace ID と世代を IndexedDB にも記録し、古い保存完了で新しい退避を消さない。別の音色への切替前には前の draft の書込み完了を待ち、A の退避が B に置き換わる前に A を保持する。

主な実装: `docs/synth/{synth_files,synth_project,synth_recovery,synth}.js`、`docs/synth/index.html`、VFS の `writeFiles()`／`checkpoints.setMany()` と生成済み型・browser／Git bundle、Synth 配布スクリプト。検証スクリプトは `check_synth_files_browser.cjs`／`check_synth_recovery_browser.cjs` など。

検証用 ZIP は `release/hello_ymfm_wasm_synth-auto-sync-dev_itch_{synth,playground}.zip`。npm 公開・バージョン更新は行っていない。Tauri アプリ実機、Windows／Linux、実 itch.io 埋込み環境は未確認。Storage 障害時に全ファイルの永続化は保証しないため、エラーを表示し Export を利用できるようにした。
