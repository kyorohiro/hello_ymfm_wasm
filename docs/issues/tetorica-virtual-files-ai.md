# AIが使うVirtual Files / Shell

2026-10-11。PlaygroundのshellをAIが操作することを前提にした最初の拡張。
共通コアとPlaygroundに反映済み。npmの公開版は0.1.1のまま。

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
詳しい構文と応答は[パッケージREADME](../../packages/virtual-files/README.md#agent-friendly-inspection-and-editing-working-tree)を参照。

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

## 次の候補

1. snapshotを使う明示的な変更取消。人間の後続編集を上書きしない競合判定が必要。
2. MCP経由で検索→patch→check→js→resultの一連操作を確認。
3. npmへの追加機能の公開。

検索はリテラル方式。正規表現検索、Git、pipe／redirect／command chainingは今後の拡張として残す。
