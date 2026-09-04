# Virtual File System / Cassette Extension

Tetorica Playground の Code Input Tab を、VS Code に近い複数ファイル編集 UI へ
拡張する。

## 決定事項

- 新しい project format は作らない。Cassette を唯一の配布・保存形式として拡張する。
- `cassette.json` は作らない。ZIP 内のファイル構造を形式とする。
- Cassette 内の全 ZIP entry を Virtual FS として保持する。
- Cassette の正本は Virtual FS とする。`timbres/`、`samples/`、`examples/` は既存
  Cassette を扱うための互換ビューであり、新しい manifest や別 format は追加しない。
- archive root の `index.js` が存在するとき、それを Run の entry point とする。
- `timbres/`、`samples/`、`examples/` は既存 Cassette v1 と同じ意味を保ち、
  従来どおり自動検出する。
- 古い Cassette に `index.js` がない場合は、これまでどおり timbre / sample / example
  の素材集として読み込み、勝手に実行しない。

例えば、次の archive は一つの Cassette であると同時に、実行可能な Virtual Project
でもある。

```text
my-song.cassette.zip
|- index.js
|- bass.js
|- lib/
|  `- chord.js
|- timbres/
|  `- bass.tfi
|- samples/
|  `- kick.wav
|- examples/
|  `- alternate.js
`- README.md
```

`README.md`、任意の `.js`、`.json`、`.tfi`、音声ファイルなども Virtual FS に残す。
既存のカテゴリに属するファイルだけを捨てず、カテゴリ検出は Virtual FS から派生する
情報として扱う。

## cassette.json を使わない理由

過去の検討では `cassette.json` に名前、説明、必要機能、preset / pattern / helper /
example などのメタデータを書く案があった。

しかし現在必要な情報はファイル構造で表現できる。

- `index.js` の有無で entry point を決める。
- `timbres/`、`samples/`、`examples/` で既存の公開素材を検出する。
- credits、license、使用方法は `README.md` や `LICENSE` に書ける。

作者・依存 chip・権利情報などを機械的に処理する具体的な要件が出るまで、manifest は
追加しない。

## 実装順

1. [x] Cassette loader が全 ZIP entry を path の `Map` として返し、既存の
   `timbres` / `samples` / `examples` をその Map から検出するようにする。
2. [x] `Map<string, VirtualFile>` の Virtual FS と、text / binary / JSON 読み出し API を
   実装する。
3. [ ] Code tab に Explorer と複数 text file の編集を追加し、既存の単一コードは
   `/index.js` として移行する。
4. [ ] `/index.js` を実行し、最初は string literal の relative dynamic import と `file()` を
   解決する。
5. [ ] Cassette import 時に Virtual FS と Monaco model を復元し、`/index.js` を開く。
6. [ ] static import/export、Worker 実行、Cassette export は main-thread の最小構成が
   安定してから追加する。

補完・定義ジャンプは step 3 で複数 Monaco Model を実際に接続した後に確認する。
期待どおりに機能しない場合は、実行方式を増やす前に Virtual FS の URI 規約と
module import の仕様を見直す。

## 元の要件

目的

現在の単一コード入力を、ブラウザ内だけで完結する小さな仮想プロジェクト形式にしたいです。

実ファイルシステムには依存せず、メモリ上に仮想 File System を持ちます。

基本データ構造は以下のイメージです。

Map<string, VirtualFile>

例:

type VirtualFile = {
  type: "text" | "binary";
  data: string | Uint8Array;
};

パス例:

/index.js
/bass.js
/drums.js
/presets.tfi
/samples/kick.wav

Code Input Tab UI

Code Input Tab の左側に、VS Code の Explorer のような仮想 File System の一覧を表示してください。

右側は現在選択中のファイルを編集するエディタです。

最低限以下をサポートしてください。

* File 一覧表示
* File 選択
* File 作成
* File 削除
* File 名前変更
* Folder 作成
* Folder 表示
* text file の編集
* binary file はコードエディタでは編集しなくてよい
* デフォルト entry point は /index.js

現在の単一コードは /index.js として扱ってください。

Monaco Editor

仮想 File System 内の JavaScript ファイルは、Monaco Editor の Model として登録してください。

例えば:

/index.js
/bass.js
/lib/chord.js

なら、Monaco 側では以下のような URI を使います。

file:///project/index.js
file:///project/bass.js
file:///project/lib/chord.js

仮想FS内の JavaScript ファイルを Monaco Model と同期し、別ファイルの import/export に対して補完・型推論・定義ジャンプが可能になる構成を目指してください。

JavaScript module import

ユーザーコードでは通常の dynamic import を使えるようにします。

例:

const bass = await import("./bass.js");
bass.play();

または:

const { playBass } = await import("./bass.js");
playBass();

Monaco にはこの元コードをそのまま見せます。

実行時だけ、仮想FS上の import path を実行可能な URL へ解決してください。

例えば:

await import("./bass.js");

を実行時内部で:

await import("blob:...");

相当に変換します。

各 JavaScript file を Blob にして URL.createObjectURL() し、依存先 import も仮想FSから解決してください。

const blob = new Blob([source], {
  type: "text/javascript",
});
const url = URL.createObjectURL(blob);

最初の実装では、以下のような string literal の relative import のみ対応で構いません。

await import("./bass.js");
await import("../lib/chord.js");

以下のような動的生成パスは未対応で構いません。

await import(path);
await import("./" + name);

できれば static import/export も同じ resolver で将来対応しやすい設計にしてください。

file() API

JavaScript 以外の仮想ファイルへアクセスするため、Playground API として file() を追加してください。

例:

const preset = await file("./presets.tfi");
const sample = await file("./samples/kick.wav");

file() は現在実行している JavaScript file の path を基準に relative path を解決してください。

テキストと binary の両方を扱える設計にしてください。

必要ならAPIは以下のようにしても構いません。

await file("./foo.txt");
await file("./foo.bin", { type: "arrayBuffer" });
await file("./foo.json", { type: "json" });
await file("./foo.txt", { type: "text" });

ただし、最初はできるだけシンプルなAPIにしてください。

Cassette Import / Export

現在の仮想 File System 全体を Cassette として保存・復元できるようにしてください。

Export Cassette

仮想FS内の全ファイルとディレクトリ構造を1つの Cassette file に保存します。

例:

/index.js
/bass.js
/drums.js
/presets.tfi
/samples/kick.wav

この一覧とデータをすべて保存してください。

Import Cassette

Cassette を読み込んだら、仮想FSを復元してください。

その後:

* File Explorer を更新
* Monaco Models を復元
* /index.js を開く
* そのまま Run 可能

という状態にしてください。

既存の Cassette format がある場合は、可能な限り互換性を維持してください。

Runtime

Run 時は /index.js を entry point とします。

概念的には:

Virtual File System
        ↓
module dependency resolution
        ↓
Blob URLs
        ↓
import(entryBlobUrl)

という流れです。

編集用のURIと実行用URLは分離してください。

Editor:
file:///project/index.js
file:///project/bass.js
Runtime:
blob:https://.../xxx
blob:https://.../yyy

Monaco のために実ファイルを作成する必要はありません。

注意

現在の Playground の liveLoop / play / sleep / setBpm など既存APIと既存の単一ファイル実行を壊さないでください。

まずは最小構成として、

/index.js
/bass.js
/presets.tfi

程度が正しく、

const bass = await import("./bass.js");
const preset = await file("./presets.tfi");

で動作するところまで実装してください。

その上で、Folder、Cassette Import/Export、Monaco補完を統合してください。
