Playground 内のデータ管理を、既存の Virtual File System に統一してください。

これまで Cassette / TFI preset / sample / example などを別々の仕組みとして扱っていましたが、今後はすべて Virtual File System 上のファイルとして扱います。

つまり、それぞれ専用の保存領域やRegistryを持たせるのではなく、単なる path の違いとして表現してください。

例:

/
├── index.js
├── examples/
│   ├── ambient.js
│   ├── techno.js
│   └── sonic.js
├── presets/
│   ├── bass.tfi
│   ├── piano.tfi
│   └── bell.tfi
├── samples/
│   ├── kick.flac
│   ├── snare.flac
│   └── choir.flac
├── lib/
│   ├── chord.js
│   └── rhythm.js
└── user/
    └── ...

基本ルール:

* default entry point は /index.js
* examples は /examples 配下
* presets は /presets 配下
* samples は /samples 配下
* JavaScript module も同じ Virtual File System 上に置く
* user-created file も同じ仕組みで扱う
* 新しい種類のresourceを追加するときも、原則として新しい保存機構を作らず Virtual FS 上の file として追加する

JavaScript module は通常の import で参照できるようにします。

const chord = await import("./lib/chord.js");

TFI やその他のraw fileは file() APIから取得します。

const preset = await file("./presets/bass.tfi");

sample data についても、既存の sample API がpathを受け取る形に寄せられる場合は、

await sample("./samples/kick.flac");

のようにしてください。

重要なのは、APIがデータを所有するのではなく、APIはVirtual FS上のpathを参照して処理するだけにすることです。

例えば:

preset registry
sample registry
example registry
cassette-specific storage

のような別々のデータ管理を増やさず、

Virtual File System
        │
        ├── /index.js
        ├── /examples/*
        ├── /presets/*
        ├── /samples/*
        ├── /lib/*
        └── user files/*

へ統一してください。

Cassette についても特殊な独立データ形式として扱うのではなく、

Cassette = Virtual File System の snapshot / package

という位置付けにしてください。

Export Cassette:

Virtual File System
        ↓
serialize / package
        ↓
Cassette

Import Cassette:

Cassette
        ↓
restore
        ↓
Virtual File System

Import後は、そのVirtual FSから以下を再構築してください。

* File Explorer
* Monaco Models
* /index.js
* presets
* samples
* examples
* JavaScript modules

理想的には、Examples / Presets / Samples / Cassette は独立したstorage conceptではなく、

Virtual File System 上の特定directoryに意味を付けているだけ

という設計にしてください。

今後 /vgm, /images, /data などを追加する場合も、同じVirtual FS上へ追加するだけで済む構成にしてください。

既存のVirtual File System実装はそのまま利用し、新しいVirtual FSを作り直さないでください。