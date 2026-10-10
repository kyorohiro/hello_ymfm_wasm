# AIが使うVirtual Files / Shell

2026-10-11。PlaygroundのshellをAIが操作することを前提にした最初の拡張。
共通コアとPlaygroundに反映済み。`tetorica-virtual-files@0.2.0` を npm の latest として公開済み（2026-10-11）。

## 今回の優先項目

- `find`: 再帰的なファイル一覧、basenameのglob、ファイル／フォルダー絞り込み。
- `rg`: リテラル文字列検索、行番号、長い行でも一致箇所周辺を表示。バイナリを除外。
- `read`: 必要な行だけを読む。出力上限と続きの位置を返す。
- `edit`: 既定で1箇所の完全一致置換。0件・複数件は変更せず失敗。dry-runと明示的な一致件数に対応。
- `help --json` / `help COMMAND`: コマンドと構文を取得する。

AIが出力を読み切れるよう、find / rgに結果件数と文字数の上限、offsetによるページ送りを用意。
4コマンドのJSON出力は既存の`{code,stdout,stderr}`契約のstdoutに格納する。
検索は必要なページだけを保持し、大量テキストは定期的に制御を返してAbortSignalを確認する。
Playgroundの`/sys`保護、プロジェクト切替・停止・人間の編集に対する既存guardを利用する。
実装は`packages/virtual-files/src/agent_commands.js`。ブラウザーコピーと型定義は`npm run build:virtual-files`で同期する。

MCP固有のAPIをこのライブラリーには追加していない。ホストがshellへ渡す文字列または引数配列をそのまま処理できる。
引数配列を使うと、改行・引用符・空白・シェル記号を含む置換文字列も誤解釈されない。
詳しい構文と応答は[パッケージREADME](../../packages/virtual-files/README.md#agent-friendly-inspection-and-editing)を参照。

## 確認

- 共通コア・Playground関連のテスト。ページ送り、出力上限、バイナリ、空ファイル、置換競合、abort、guarded sessionを検証。
- Node.js 22.22.0でも独立コアのテスト成功。
- Chromiumでhelp / find / rg / read / dry-run / edit / stale editを操作。エディター同期、入れ子のjsスクリプト、autosaveと再読込を確認。

## 第2段階（実装・検証済み）

- `patch`: JSON配列の置換・作成・削除を一時領域で検証し、全件成功時だけ一度に反映。dry-run / stdin / JSON応答。
- `snapshot` / `diff`: 名前付きbaseline（最大8個）と現在のファイル・空ディレクトリーを比較。テキスト差分は上限付き、バイナリはメタデータ。プロジェクト変更時にbaselineを破棄。
- `check`: PlaygroundがMonacoのJavaScript構文解析を登録。コードを実行せず、ファイル・行・列・エラーコードをJSONで取得。静的import / exportにも対応。
- 共通APIとして`applyTextPatch` / `diffSnapshots`をexport。guarded sessionと既存のホスト権限を維持。
- Chromiumでpatch / preview / diff / check / ESM / 構文エラー / 途中失敗の無変更 / 入れ子のjsを確認。
- itch梱包に構文チェック用モジュールを追加。

## 第3段階（実装・検証済み）

- `js --json`: 実行結果・終了状態・consoleのレベル・例外名／message／stack／file／line／columnをJSONで取得。
- `result --json [RUN_ID]`: 直近の完了結果または指定IDを取得。停止時の部分出力も保持。最大10件、プロジェクト変更時に破棄。
- 通常のjsはテキスト出力を維持。JSONモードでは入れ子のjsが余分なストリーム出力を混ぜない。
- Worker側とホスト側の両方でconsole出力を制限。出力・履歴のメモリー上限とtruncatedフラグ。
- ブラウザーで例外JSON→edit→再実行、import先のエラー位置、Promise失敗、停止結果、従来出力を確認。
- 共通コア／Playground関連51テスト成功。ブラウザー配布梱包の294参照チェック成功。

## 第4段階（実装・検証済み）

- `|` / `<` / `>` / `>>`: 仮想文字列のpipeとファイル入出力。引数配列・引用符・escape内では記号を文字列として維持。
- `cat -` / `read -` / `rg PATTERN -`: stdin対応。patchも`patch - < FILE`でJSONを読む。
- 途中の失敗で後段を停止。stderrは分離。`pipeline --json SOURCE`と`reportStages`で各段の終了コードを取得。
- リダイレクトの書込みは全段成功後にまとめて反映。出力先の内容変更・権限・型・親パスを検証し、人間の編集を維持。
- 上限: 32段、stdin／中間stdoutは100万文字。コマンド固有の読込・検索の出力上限は維持。
- Chromiumでpipe／stdin／追記／途中失敗／patch入力／JS出力の非stream化／人間の編集競合／sys保護／autosaveを確認。
- コマンド自身の副作用はpipeline全体で巻き戻さない。redirectの出力のみを遅延commitする。

## 次の候補

今回の追加機能のnpm公開とMCP経由の検証は完了。

検索はリテラル方式。正規表現検索、Git、command chainingは今後の拡張として残す。

## ファイルrevision（0.2.0で公開）

- ファイル／ディレクトリーのrevisionと削除後の履歴を保持。同一内容の再書込みは変更扱いにせず、変更後に戻した場合や削除・再作成は検知。
- `read --json`／`find --json`／get・list・statで取得、`getRevision`で削除済みパスも確認。
- `edit --revision N`、patch各操作の`expectedRevision`、直接writeの条件付き更新に対応。patchは1件の競合で全件拒否。
- Playgroundのスクリプト実行と出力リダイレクトもrevisionで競合判定。
- revisionはFSインスタンス内の情報。snapshotは内容のみ保存し、restoreで現在の番号を巻き戻さない。明示的な取消は後述のundoで対応。
- 検証: core＋Playgroundの65テスト成功、Node 22でcoreの34テスト成功。Chromiumでrevision取得／古いedit拒否／worker API／編集して元に戻した場合の競合保護、既存pipelineとautosaveを確認。dev ZIPの296参照検査も成功。

## snapshotの安全な取消（0.2.0で公開）

- `undo [--json] [--dry-run] BEFORE AFTER [PATH]`：名前付きsnapshot間の変更だけを取消。snapshotは内容に加え、同じFSインスタンス内のrevision履歴も保存。
- AFTER以降のrevision変更、削除・再作成、削除対象ディレクトリーへの後続追加を検知。1件でも競合したら全件を止め、無関係な編集は保持。
- テキスト／バイナリ／作成／削除／型変更／空ディレクトリーに対応。原子的に反映し、sys・entry pointの既存保護を適用。
- APIは`fs.checkpoint()`と`undoFileChanges`。履歴はメモリ内のみ。BEFORE〜AFTER間の編集者判定は行わないので、AFTERは対象作業直後に保存する。
- 検証: core＋Playgroundの74テスト成功。Node 22でもundoを確認。Chromiumでpreview／取消／人間の後続編集と元に戻す編集の保護／対象パス指定／入れ子のjs／autosave／再読込時の履歴破棄を確認。dev ZIPの296参照検査成功。

## Tauri MCPからのshell操作（検証済み）

- `w/tetorica-fm2612-playground-tauri` のMCPに `shell_execute` を追加。projectId／command／stdin／timeoutMsを受け、code／stdout／stderrを返す。
- 上流shellの実行APIに外部AbortSignalと待機終了時の事前チェックを追加。MCP Off／プロジェクト切替／期限切れの要求を停止し、期限切れ待機要求の後続実行を防止。
- projectIdはプロジェクトのinvalidate時に更新し、patch／undoの原子的replaceでは維持する。
- core＋Playground 74件、Tauri Python 8件／Node 26件／Rust 11件成功。ブラウザーで競合、停止、保護パスも確認。
- 2026-10-11: 起動中のTauriにStreamable HTTPで接続し、専用仮想ファイルでsnapshot→write→rg→read→patch→check→js→result→undoを検証。テストファイルとsnapshotの後片付けも確認。

## npm 0.2.0 リリース（2026-10-11）

- ソースコミット: `65cd0b9`。
- 配布物: `tetorica-virtual-files-0.2.0.tgz`、19ファイル、25,718 bytes（展開後84,527 bytes）。外部依存なし。
- integrity: `sha512-+jm9bkVIQFj+uIHpTYlnDMImU5goua4NJAV8Cpzc0yim3GD56id7lCzqjcfwdE48nIsS/yRJeZWrJGJO5MsKmw==`
- shasum: `c745655dbe066a56978a779868b4067fd8713268`。
- core＋Playgroundの74テスト、Node 22のcore 42テスト、tarballの独立インストール／Node 22実行／公開export／TypeScript strict型検査を確認。
- npmには共通コアを公開。Playgroundのcheck／js／result／playとTauri MCP adapterはホスト側で提供する。
- 公開レジストリのlatest=0.2.0とintegrityを照合。公開版の新規インストール後、Node 22と現在のNodeで実行し、TypeScript strict型検査も成功。
