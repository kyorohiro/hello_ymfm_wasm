Codex には、次のように指示するとよいと思います。

既存の Playground の実行機構をできるだけ再利用し、Virtual Files と連携する方針です。

---

## Codex への指示：Tetorica Playground に JavaScript Shell を追加

### 目的

Tetorica Playground に、JavaScript をシェルスクリプトとして実行できる機能を追加してください。

既存の `tetorica-virtual-files` を利用し、Playground の FILES、Monaco Editor、Shell が同じ仮想ファイルシステムを共有する構成にしてください。

Bash や POSIX Shell の完全な互換実装は不要です。

### 1. コマンド

基本コマンドは既存の `tetorica-virtual-files` の機能を確認し、利用できるものを再利用してください。

JavaScript 実行コマンドとして、次を追加します。

```shell
js scripts/example.js
```

`js` は Virtual Files 内の JavaScript ファイルを読み取り、実行します。

相対パスは Shell の現在の作業ディレクトリーを基準に解決してください。

### 2. JavaScript Shell API

シェルスクリプトから仮想ファイルシステムを操作できるようにしてください。

API は次の形式を目標とします。

```javascript
const { fs, shell } = await import('tetorica:shell');

const files = await fs.readdir('/src');

for (const file of files) {
  console.log(file);
}
```

`tetorica:shell` は仮想モジュールとして提供します。

import は既存の Playground と同様、dynamic import を使う方針です。
静的な `import { ... } from '...'` の対応は今回の対象外です。

既存の解決処理は、主に文字列リテラルで指定した相対パスの `import(...)` を扱います。
この処理を再利用し、`await import('tetorica:shell')` を実行ごとの API に解決する処理を追加してください。
`tetorica:shell` は現在の解決処理では扱えないため、dynamic import に書き換えるだけでは利用できません。

初期段階では、文字列リテラルで指定する相対パスと `tetorica:shell` を対象とします。
変数や式で import 先を指定する機能は、必要になった段階で検討してください。
`js` の入口ファイルは Shell の作業ディレクトリーから解決し、そのファイル内の相対 import は、import を記述したファイルから解決してください。

スクリプトには、少なくとも次の機能を提供します。

- `fs`：Playground と共有する Virtual Files
- `shell`：シェルコマンドの実行
- `console`：Shell の出力先に接続
- `args`：コマンドライン引数
- `cwd`：現在の作業ディレクトリー

API の具体的な形式は既存実装との整合性を優先して決めてください。

### 3. Playground の実行環境との分離

通常の音楽演奏コードと、シェルスクリプトの実行を区別してください。

```shell
js scripts/build.js
```

これはシェル用 JavaScript として実行します。

```shell
play index.js
```

これは既存の Playground の音楽実行機構を利用します。

`play` は既存の再生 API を呼び出す薄いラッパーとし、音楽実行エンジンを新しく実装しないでください。

既存の再生・停止・エラー表示の動作を維持してください。

### 4. JavaScript によるコマンド拡張

将来的に、JavaScript ファイルをシェルコマンドとして登録できるようにします。

想定 API：

```javascript
// commands/hello.js

export default async function ({ args, stdout }) {
  stdout.write(`Hello ${args[0]}\n`);
}
```

利用例：

```shell
hello world
```

初期段階では、既存のコマンド登録機構を確認し、必要最小限の拡張にとどめてください。

コマンドの自動探索や npm パッケージの動的インストールは不要です。

### 5. Virtual Files との連携

次の状態を保証してください。

1. Monaco Editor で編集した内容を Shell から読み取れる。
2. Shell で変更したファイルを Monaco Editor に反映できる。
3. Shell と Playground は同じ Virtual Files インスタンスを利用する。
4. ファイル変更時に既存の自動保存が機能する。
5. New Cassette、ZIP 入出力、既存のファイル操作を壊さない。

編集中の内容を Shell が古いスナップショットから読み取らないようにしてください。

Shell によるファイル更新が、Monaco の未反映の編集を無条件に上書きしないようにしてください。

### 6. 実行環境と安全性

ユーザーが入力したコマンド文字列を、そのまま `eval` しないでください。

コマンド文字列は Shell のパーサーで解析し、登録済みコマンドを実行してください。

JavaScript ファイルの実行には、既存の Playground の JavaScript 実行機構を調査してください。

シェル用スクリプトには、仮想ファイルシステムを操作する API を提供します。

ただし、Virtual Files を利用するだけでは JavaScript の実行権限を制限できません。

既存の実行環境で OS やネットワークにアクセスできる場合、その制約を明確にしてください。

初期段階では、完全なサンドボックスの新規実装は不要です。

### 7. UI

Playground に簡単な Shell パネルを追加してください。

想定する表示：

```text
Tetorica Shell

/> ls
index.js
README.md
scripts/

/> cd scripts

/scripts> ls
build.js

/scripts> js build.js
Build completed.

/scripts>
```

最低限必要な機能は、コマンド入力、実行結果の表示、エラー表示、コマンド履歴です。

既存の Playground の UI 設計に合わせてください。

### 8. 実装方針

最初から大規模な Shell を実装しないでください。

まず、次の動作を完成させてください。

```shell
ls
cat index.js
js scripts/example.js
```

`example.js` から Virtual Files を読み書きできることを確認してください。

次に `play index.js` を接続してください。

Git、パイプ、リダイレクト、複雑なシェル構文、npm パッケージ実行機能は今回の対象外です。

**重要：既存の `tetorica-virtual-files` と Playground の実装を確認してから着手し、既存機能の重複実装を避けてください。**

### 9. 完了条件

実装後、以下を確認してください。

- `js` コマンドで Virtual Files 内の JavaScript を実行できる。
- `await import('tetorica:shell')` から共有 Virtual Files にアクセスできる。
- 相対パスの dynamic import で Virtual Files 内の別ファイルを読み込める。
- `console.log()` が Shell パネルに表示される。
- 相対パスとコマンドライン引数を扱える。
- Monaco と Shell のファイル変更が相互に反映される。
- `play` で既存の音楽再生が動作する。
- 既存の Playground の動作に回帰がない。
- Node.js とブラウザーの既存ビルドが壊れない。

実装内容、変更ファイル、テスト結果、残された制約を最後に報告してください。

---

一点だけ補足すると、**`tetorica:shell` という仮想モジュールの仕組みが、今回の設計の重要な部分**です。

これが実現すると、将来的には次のようなコードも書けます。

```javascript
const { fs, shell } = await import('tetorica:shell');

const files = await fs.readdir('/');

for (const file of files) {
  if (file.endsWith('.js')) {
    await shell.execute(`format ${file}`);
  }
}
```

つまり、Playground の中で JavaScript を使って開発作業そのものを自動化できます。

ただし、スクリプトに渡す `fs` は、既存の Playground のアクセス制御ポリシーを維持する必要があります。コマンド引数を組み立てる際も、ファイル名を安全に引用するか、文字列ではなく引数配列を渡せる API が望ましいです。

### 実装 TODO

以下の順で進め、実装と検証が済んだ項目を更新してください。
Git や静的 import など、今回の対象外の機能は追加しません。

#### 既存の土台

- [x] 仮想ファイルシステムと基本シェルを `tetorica-virtual-files` として分離。
- [x] Playground の Console にコマンド入力・結果表示を用意。
- [x] エディターと基本コマンドのファイル共有、自動保存、空フォルダーの保存に対応。

#### 1. 実行 API と競合の扱い

- [x] 既存の実行機構を調べ、音楽再生から再利用する部分と、シェル用に分離する部分を決める。
- [x] `js` の実行単位、`args`、`cwd`、終了コード、中断用 signal の契約を決める。
- [x] `js` 内から `await shell.execute(...)` を呼べる実行経路を用意する。外側のコマンド終了を待つキューへ内側のコマンドを追加して、デッドロックしないようにする。
- [x] スクリプトへ渡す `fs` に、共有データを操作する窓口を用意する。生のインスタンスで既存のアクセス制御を迂回させない。
- [x] 実行中の人の編集と書き込みが競合した場合の扱いを決め、未反映の編集を無条件に上書きしない。
- [x] 停止、New Cassette、Cassette の読み込み・切り替えで実行を無効化する。古い実行から新しいプロジェクトへの書き込みを拒否する。

#### 2. `js` と dynamic import

- [x] `js PATH [ARGS...]` を登録し、入口ファイルを Shell の作業ディレクトリーから解決する。
- [x] `await import('tetorica:shell')` を実行ごとの API に解決する。
- [x] 文字列リテラルによる相対 dynamic import を再利用し、記述元ファイルから解決する。
- [x] `console.log()` とエラーを、その実行の Shell 出力へ接続する。Playground 全体の console を上書きしない。
- [x] 同じスクリプトを再実行したとき、編集後の入口ファイルと依存ファイルが使われるようにする。
- [x] ファイル名を安全に渡す方法を用意する。引数配列の API、または共通の引用処理で対応する。

#### 3. Playground と UI

- [x] 読み書きの際に、現在のエディター内容と共有 Virtual Files を同期する。
- [x] ファイル更新・作成・削除・移動を FILES と Monaco に反映し、既存の自動保存につなぐ。
- [x] Shell のコマンド履歴を追加する。
- [x] シェル用 JavaScript の実行状態と停止操作を用意し、音楽再生の停止と区別する。
- [x] `scripts/example.js` のサンプルを追加し、ファイル操作・引数・出力を試せるようにする。

#### 4. `play` の接続

- [x] `play PATH` を既存の音楽再生 API に接続する。
- [x] 既存の Run file、Main／Worker 実行、STOP のフェードアウト、エラー表示を維持する。

#### 5. 検証と配布物

- [x] ファイル操作・相対 import・引数・出力・再実行をテストする。
- [x] シェルからの再入実行が停止しないことをテストする。
- [x] 停止・プロジェクト変更後の遅延書き込みと、編集中の内容との競合をテストする。
- [x] 自動保存からの復元、New Cassette、空フォルダー・バイナリを含む ZIP 入出力を確認する。
- [x] ブラウザーで `js` と `play` を操作し、Node.js の既存テスト・型定義・ビルドも確認する。
- [x] 必要なモジュールを配布 ZIP に含め、Tauri 側の取り込みとロック検証を確認する。
- [x] 実装内容・検証結果・残された制約を本文と報告に反映する。

最初の到達点は、`js scripts/example.js` からファイルを読み書きし、
その変更がエディターと自動保存に反映され、スクリプト内からも基本コマンドを呼べること。
これを確認してから `play` の接続へ進む。

### 実装結果（2026-10-10）

Shell タブで次を実行できます。

```sh
js /scripts/example.js hello
play /index.js
```

`js` は実行ごとに専用の module Worker を作ります。既存の音楽実行は音声の
ライフサイクルとファイルのスナップショットを前提にしているため、Shell の
実行は分離しました。基本コマンド、パス処理、共有ストア、自動保存は既存の
仕組みを利用し、`play` は既存の `runCode()` に接続しています。

```javascript
const {fs, shell, args, cwd} = await import('tetorica:shell');
const source = await fs.readFile('/index.js');
await fs.writeText('/scripts/copy.js', source);
const result = await shell.execute(['ls', '/scripts']);
console.log(args, cwd, result.stdout);
```

- ファイル API は Promise を返します。処理は `await` してください。テキスト、
  バイナリ、ディレクトリーの読み書き・作成・コピー・移動・削除に対応します。
- `args` は入口ファイルの後の引数、`cwd` は実行開始時のディレクトリーです。
  `shell.cwd` は `shell.execute()` の終了時に更新されます。
- 外側のコマンドは順番に実行します。コマンド内の `context.execute()` は直接
  再入実行するので、`await shell.execute()` や入れ子の `js` で待ち合わせません。
- ホストの `AbortSignal` は実行単位で管理します。正常終了は 0、エラーは 1、
  中断は 130。Stop Script は Worker を終了させ、音楽は既存の STOP で止めます。
  スクリプトへ AbortSignal 自体を渡す API は初期版にはありません。
- New／Cassette import／pagehide は実行と古いプロジェクトの待機コマンドを
  無効化します。停止後に届いた RPC とコマンド返信も無視します。
- 読み書きの直前にエディターを共有ストアへ同期します。人が途中で変更した
  ファイルへの書き込みはエラーにし、その内容を残します。最新内容を読み直した
  後の書き込みは可能です。`/sys` は読み取り専用、`/index.js` の削除・移動は禁止です。
- import は es-module-lexer 3.0.3 で解析します。文字列リテラルの相対 dynamic
  import と `tetorica:shell` のみ対応します。実行中はモジュールをキャッシュし、
  次の実行では編集後のソースを使います。循環 import はエラーにします。
- `tetorica-shell.d.ts` を Monaco に登録し、API の補完・型表示を提供します。
  コマンド履歴は現在のページ内で最大 100 件、表示ログは最大 50,000 文字です。

#### 検証

- 追加・関連の Node.js テスト 17 件が成功。
- 型チェックと `build:virtual-files` が成功。
- ブラウザーで、相対 import、引数、入れ子のコマンド／`js`、再実行時の更新、
  エディターとの同期、競合検出、無限ループの停止、コマンド履歴を確認。
- バイナリと空ディレクトリーの自動保存・再読み込み、New 後の遅延書き込みの
  拒否、初期サンプルを確認。`play` は Main／Worker の両方で再生・停止を確認。
- 配布版でも、Shell が作ったバイナリと空ディレクトリーを Cassette ZIP に
  export し、import 後の内容が一致することを確認。
- 配布 ZIP のローカル依存検査と Tauri への取り込み・ロック検証が成功。
- Playground 全体とライブラリーの 303 テスト中 302 件が成功。既存の
  `scheduled export expands YM2612 DAC stream data while readable export omits it`
  が失敗します。VGM export 関連のファイルは今回変更していません。

#### 初期版の制約

Git、パイプ、リダイレクト、静的 import、計算した import 先、外部モジュール、
JavaScript ファイルを新しいコマンドとして自動登録する機能は未対応です。
Worker は DOM から分離しますが、完全なセキュリティサンドボックスではありません。
通常の Worker のネットワーク・ストレージ API は利用可能で、OS コマンド実行 API は
提供しません。完了後は Worker を終了するため、実行後に残すタイマーは使えません。
今回の npm 公開は行っていません。

### Shell タブとターミナル表示（2026-10-10）

Console と Shell を独立したタブに分けました。Console は音楽のログを表示し、
Shell はスクロールする出力の末尾にプロンプトと入力行を置きます。

- Enter で実行、↑↓で履歴、Tab でファイル名を補完。
- Tab は相対パス、ディレクトリー、空白・引用符を含む名前に対応。
  候補が複数ある場合は共通部分を補完し、候補を表示します。
- Ctrl+C は実行中のスクリプトを停止し、入力を取り消します。
  テキストを選択している場合は通常のコピー操作を維持します。
- Ctrl+L または Clear で表示ログを消します。履歴とプロジェクトは保持します。
- Stop Script ボタンも残し、音楽の STOP と区別しています。

パス補完の Node.js テスト 3 件と、ブラウザーでタブの分離・補完・Ctrl+C・
既存のスクリプト実行／保存／再生の回帰テストを確認しました。
配布 ZIP を更新し、Tauri の取り込みにも反映しています。
