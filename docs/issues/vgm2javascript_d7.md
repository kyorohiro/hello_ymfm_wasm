Tetorica FM2612 Playground には既に VGM Import 機能があります。

現在の VGM Import は、
VGM の YM2612 register write をほぼそのまま JavaScript に変換し、

- write(...)
- sleepSamples(...)
- liveLoop("ch0", ...)
- liveLoop("ch1", ...)

のような低レベルコードを生成します。

この既存 VGM Import に、
「High Level Import」または「Readable Import」のような
もう1つの変換モードを追加してください。


# Goal

完全に高レベルな音楽コードへ変換することは目的ではありません。

安全にまとめられる部分だけをまとめ、
意味を確実に判定できる部分だけ Playground API に置き換えてください。

変換できない部分は、そのまま write() / sleepSamples() を残して構いません。

最重要なのは、

- 音を壊さない
- タイミングを壊さない
- 元の VGM の情報を失わない

ことです。


# Example

現在:

write(0xa4, 0x22);
write(0xa0, 0x83);

write(0x40, 0x14);
write(0x44, 0x18);
write(0x48, 0x14);
write(0x4c, 0x1b);

write(0x28, 0xf0);

await sleepSamples(3667);

write(0x28, 0x00);

これを安全に判定できる場合は、

await play("E4", {
  channel: CH1,
  durationSamples: 3667,
});

のようにまとめてもよいです。


# Partial conversion is expected

すべてを play() に変換しようとしないでください。

例えば音色設定のまとまりだけなら、

fm.setPatch(CH1, {
  algorithm: ...,
  feedback: ...,
  operators: [...]
});

のようにまとめてください。

周波数だけなら、

fm.setFrequency(...);

KEY ON / OFF だけなら、

fm.keyOn(...);
fm.keyOff(...);

のような中間レベル API でも構いません。

つまり、

Low Level
    write(...)
    write(...)
    write(...)

を

Readable
    fm.setPatch(...)
    fm.setFrequency(...)
    fm.keyOn(...)

へまとめ、

さらに安全に判定できる場合だけ

High Level
    play("E4", ...)

へまとめる方針にしてください。


# Important principle

変換単位は「1行」ではなく、
register write のまとまりとして判定してください。

例:

DT/MULTI
TL
AR
D1R
D2R
SL/RR
SSG-EG
ALG/FB

が連続して設定されている場合は、
1つの patch 設定としてまとめられる可能性があります。

同様に、

BLOCK/FNUM
KEY ON
sleepSamples(...)
KEY OFF

が成立している場合は、
1つの note event としてまとめられる可能性があります。


# State tracking

変換時には各 YM2612 channel の現在状態を保持してください。

最低限:

- BLOCK
- FNUM
- KEY ON/OFF
- ALG
- FB
- PAN
- AMS
- FMS
- operator parameters
  - DT
  - MULTI
  - TL
  - RS
  - AR
  - D1R
  - D2R
  - SL
  - RR
  - SSG-EG

CH0-CH5 と port 0 / port 1 に対応してください。


# Timing

sleepSamples() は重要です。

短い sleepSamples(1), sleepSamples(2), sleepSamples(3)
などは register write timing のために存在する場合があります。

これらを勝手に削除したり、
rest() や beat() に変換しないでください。

高レベル化したブロックの内部へ安全に吸収できる場合だけまとめてください。

それ以外は元の sleepSamples() を残してください。


# Note conversion

BLOCK/FNUM から pitch を確実に求められる場合は、
Playground の note name に変換してください。

例:

"E3"
"F#3"
"C4"

ただし pitch bend 的な値や、
通常の note とみなすのが危険な値は、
無理に note name に変換しないでください。

その場合は FNUM/BLOCK の API を残してください。


# Patch extraction

同じ音色設定が何度も出てくる場合は、
重複をまとめてください。

例えば:

const patch001 = {...};

fm.setPatch(CH1, patch001);

のようにしてください。

既存の TFI / preset 機能を再利用できるなら、
そちらを優先してください。

ただし、無理に別ファイルへ分割する必要はありません。
まずは生成 JavaScript 内でまとめるだけでも構いません。


# Output example

理想的には、低レベルと高レベルが混在して構いません。

例:

liveLoop("ch0", async () => {
  fm.setPatch(CH1, patch001);

  await play("E3", {
    channel: CH1,
    durationSamples: 3667,
  });

  await sleepSamples(1473);

  // Could not safely convert this section.
  write(0x22, 0x08);
  write(0x27, 0x40);

  fm.setFrequency(CH1, ...);
  fm.keyOn(CH1);
});

このような出力で問題ありません。


# Existing VGM Import

新しい parser をゼロから別実装するのではなく、
現在の VGM Import が持っている

- VGM command parsing
- YM2612 register decoding
- channel detection
- timing calculation
- comment generation
- TFI extraction
- note-ish conversion

などの既存処理を調査して再利用してください。


# UI

現在の VGM Import の近くに、

Import VGM
Import VGM as Readable

または

VGM Import:
- Raw
- Readable

のような選択肢を追加してください。

名前は既存 UI に合わせて決めてください。

Raw は現在の挙動を完全に維持してください。


# Implementation strategy

まず既存 VGM Import の内部データ構造を確認してください。

可能であれば、

VGM
  ↓
parsed events
  ↓
Raw JS Generator

となっているところを、

VGM
  ↓
parsed events
  ├─ Raw JS Generator
  └─ Readable JS Generator

という構造にしてください。

Raw JavaScript をもう一度文字列解析して
Readable JavaScript に変換する設計は避けてください。

VGM parsing 結果から直接 Readable output を生成してください。


# Conversion priority

まず以下から実装してください。

1. repeated register writes -> patch block
2. BLOCK/FNUM -> pitch/frequency
3. KEY ON / KEY OFF -> note event
4. repeated patch -> reusable constant
5. safe note event -> play()

それ以外は low-level write() のままで構いません。


# Testing

既存 Raw Import の結果を変更しない regression test を入れてください。

Readable Import については、

- CH0-CH5
- port 0 / port 1
- patch grouping
- BLOCK/FNUM
- KEY ON/OFF
- durationSamples
- tiny sleepSamples
- unsupported writes fallback

をテストしてください。

最初から完全変換を狙わず、
「確実にまとめられる部分だけまとめる」
実装にしてください。