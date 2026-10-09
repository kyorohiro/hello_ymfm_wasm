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
