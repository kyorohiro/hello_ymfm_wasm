Tetorica FM2612 Playground
MML Support - Design / Implementation Note

目的:
Tetorica FM2612 Playground から、簡易的な MML (Music Macro Language)
を利用できるようにしたい。

JavaScript と MML のどちらかを選択する設計にはしない。

MML は「音符・休符・音長などを簡潔に記述するための notation」として扱い、
YM2612 固有の制御、プログラム制御、ファイル操作などは
引き続き JavaScript 側で行う。

想定 Interface:

await mml.play(`
  T120
  O4
  L8
  C D E F G A B > C
`);

channel や preset など、Tetorica 側の情報は
MML 文法へ追加せず JavaScript API から指定できるようにする。

例:

const bass = await file("./presets/bass.tfi");

await mml.play(`
  T120
  O2
  L8
  C C G G A A G4
`, {
  channel: CH0,
  preset: bass,
});

重要:
独自の YM2612 MML 方言を作ることを目的にしない。

例えば以下のような YM2612 固有機能を
MML 文法へ追加しない。

- Algorithm
- Feedback
- Operator parameters
- TL
- Envelope
- LFO
- YM2612 register write
- TFI load
- Sample
- FX

これらは既存の JavaScript API を使用する。


--------------------------------------------------
基本設計
--------------------------------------------------

MML を直接 YM2612 register command へ変換しない。

可能であれば以下の構造にする。

MML text
   ↓
MML Parser
   ↓
Tetorica Note/Event representation
   ↓
既存 Playground scheduler / play API
   ↓
YM2612

MML と通常の JavaScript play() が、
できるだけ同じ演奏経路を利用するようにする。

MML 専用 scheduler を新しく作らない。

既存の timing / scheduling の仕組みを再利用する。


--------------------------------------------------
最初に対応する MML
--------------------------------------------------

完全な MML compatibility は目指さない。

まずは、多くの MML implementation で共通して見られる
小さな subset のみ対応する。

候補:

C D E F G A B
    Note

R
    Rest

O<n>
    Octave

L<n>
    Default note length

T<n>
    Tempo

V<n>
    Volume

< >
    Octave change

+ / # / -
    Sharp / Flat

<number>
    Individual note length

.
    Dotted note

例:

T120 O4 L8
C D E F G A B > C

T140 O3 L16
C C G8 R8 A+4


--------------------------------------------------
現時点では対応しないもの
--------------------------------------------------

MML implementation ごとに意味や仕様が異なる機能については、
最初から実装しない。

例:

- @ instrument
- Q gate
- P pan
- macro
- loop syntax
- tuplet
- FM tone definition
- hardware-specific commands
- driver-specific commands

Tie (&) についても必要性を確認してから追加する。

「一般的な MML では存在するから」という理由だけで
機能を追加しない。

実際に Tetorica で使用して必要になったものを追加する。


--------------------------------------------------
Parser
--------------------------------------------------

最初から parser generator や大きな AST infrastructure は導入しない。

今回の subset であれば、
単純な scanner / parser で実装できるか検討する。

例:

mml.parse(`
  T120 O4 L8
  C D E4
`);

↓

[
  { type: "note", note: "C4", length: 8 },
  { type: "note", note: "D4", length: 8 },
  { type: "note", note: "E4", length: 4 }
]

ただし、これは概念例であり、
既存 Playground の Event representation が存在する場合は
それを優先して再利用する。

新しい Event model を安易に追加しない。


--------------------------------------------------
API
--------------------------------------------------

最初の候補:

await mml.play(source, options);

必要なら:

mml.parse(source);

も公開できる構造にする。

例:

const events = mml.parse(`
  T120 O4 L8
  C D E F
`);

await mml.play(events, {
  channel: CH0,
});

ただし parse() の public API 化は、
内部設計を確認してから判断する。


--------------------------------------------------
Tetorica における役割
--------------------------------------------------

MML を JavaScript の代替言語にはしない。

役割を概念的に以下のように分ける。

MML
    楽譜 / note sequence の簡潔な記述

JavaScript
    制御、構造、条件分岐、live coding、
    YM2612 control、resource access

TFI
    FM tone / preset

VGM
    chip に実際に送られた command / performance data

MML は Tetorica の機能の一つとして
JavaScript から利用できるものにする。


--------------------------------------------------
Live Coding
--------------------------------------------------

既存 liveLoop() との組み合わせを壊さない。

例:

liveLoop("bass", async () => {
  await mml.play(`
    O2 L8
    C C G G
  `, {
    channel: CH0,
  });
});

ただし timing semantics は
既存 liveLoop / scheduler の仕様を優先する。

MML のために別の時間管理方式を導入しない。


--------------------------------------------------
将来検討
--------------------------------------------------

実際に使用してから、必要なら以下を検討する。

- Tie
- Gate
- Loop
- Chord
- Tuplet
- Multiple tracks
- VGM → MML conversion
- MML → Event visualization
- MML → JavaScript conversion
- LilyPond export/import

特に LilyPond は MML の代替として最初から実装しない。

現時点の仮説:

MML
    演奏入力 / compact notation に向く

LilyPond
    楽譜化 / 音楽構造の可視化 / export に向く可能性がある

必要性が確認できてから検討する。


--------------------------------------------------
実装前に確認すること
--------------------------------------------------

実装を開始する前に既存コードを調査すること。

特に以下を確認する。

1. play() の内部構造
2. note → frequency / FNUM conversion
3. BPM / beat / sleep の時間管理
4. scheduler
5. liveLoop()
6. channel allocation
7. preset / TFI loading
8. Worker / AudioWorklet との境界
9. 既存 Event representation の有無

その上で、

- 変更するファイル
- MML parser の配置場所
- 既存 scheduler をどう再利用するか
- 新しく必要になる型
- timing semantics

を説明すること。

説明後に実装する。


--------------------------------------------------
重要な制約
--------------------------------------------------

- MML の完全実装を目指さない
- 特定 MML implementation の完全互換を目指さない
- Tetorica 独自 MML 方言を増やさない
- YM2612 固有機能を MML syntax に入れない
- 新しい scheduler を作らない
- 既存 timing implementation を置換しない
- 既存 JavaScript API を壊さない
- 不要な refactoring を行わない
- MML 対応と関係ない機能を変更しない

まず最小実装で、

await mml.play(`T120 O4 L8 C D E F G`);

が既存 Playground の timing / YM2612 playback 上で
正しく演奏できるところまでを目標とする。