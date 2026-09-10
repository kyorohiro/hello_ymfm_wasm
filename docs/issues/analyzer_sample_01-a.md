VGM Analyzer: Sample Explorer 実装前の修正点

現在の方針は概ね問題ありません。

特に、

* サンプル本体と再生イベントを分離する
* 音名ではなく、サンプルID・アドレス・再生設定を一次情報として扱う
* サンプル本体がVGMに存在しない場合も再生イベントを残す

という設計は維持してください。

ただし、実装前に以下を修正してください。

1. YM2608 ADPCM-A を YM2610 ADPCM-A と同一扱いしない

YM2608のADPCM-A相当は6chのRhythm Sound Sourceで、基本的に固定の内蔵リズムROMです。

YM2610 ADPCM-Aのような、任意のサンプルROM領域として扱わないでください。

初期対応対象は以下のように分けます。

YM2610 / YM2610B
  ADPCM-A            Sample ROM
  ADPCM-B / Delta-T  Sample ROM
YM2608
  Rhythm             固定ROMとして別扱い
  ADPCM-B / Delta-T  Sample Memory
RF5C164
  PCM RAM            Sample Memory

YM2608 Rhythmについては、最初のSample Explorer実装から外して構いません。

2. VGM Data Blockをそのまま「Sample」としない

VGMのROM Data Blockは、必ずしも1ブロック = 1サンプルではありません。

例えばYM2610 ADPCM ROMでは、一つのROM image内に複数のサンプルが存在する可能性があります。

また、同じROM領域が複数のData Blockに分割されている場合も考慮してください。

そのため、

VGM Data Blocks
    ↓
Sample Memory / ROM Image
    ↓
Register Writes
    ↓
Playback Address Range
    ↓
Sample Definition

という順番で解析してください。

Data Blockから直接Sample IDを生成しないでください。

まずチップごとのメモリイメージを構築します。

例:

{
  chip: "ym2610",
  kind: "adpcm-a",
  startAddress: 0x10000,
  data: Uint8Array
}

その後、レジスタ書き込みから実際に使用されたstartAddress / endAddressを検出し、その範囲をSample Definitionとして登録します。

例えば:

{
  id: 3,
  chip: "ym2610",
  kind: "adpcm-a",
  startAddress: 0x12000,
  endAddress: 0x16fff,
  data: Uint8Array,
  embedded: true
}

同じaddress rangeが何度使用されてもSample Definitionは重複登録せず、Playback Eventだけを追加してください。

3. Sample MemoryとSample Definitionを分離する

内部モデルは最低でも以下を分離してください。

SampleMemory
SampleDefinition
PlaybackEvent

SampleMemory

VGM Data Blockなどから構築したROM/RAMイメージ。

SampleDefinition

実際に再生されたstart/end addressから特定したサンプル領域。

PlaybackEvent

SampleDefinitionを、いつ・どのchannelで・どの設定で再生したか。

この分離により、同じサンプルを異なるrate / volume / pan / loop設定で使用した場合でも正しく追跡できるようにします。

4. Playback Eventの終了理由を保持する

ADPCM / PCMでは、発音終了が単純なKEY OFFだけで決まらない場合があります。

Playback Eventには可能なら終了理由を保持してください。

例:

{
  sampleId: 3,
  chip: "ym2610",
  channel: 2,
  startTime: 54684,
  endTime: 70560,
  startAddress: 0x12000,
  endAddress: 0x16fff,
  rate: 1234,
  volume: 31,
  loop: false,
  endReason: "natural"
}

endReasonは例えば以下を想定します。

natural
keyOff
restart
loop
unknown

終了時刻を正確に決定できない場合は、無理に推定せず、

endTime: null,
endReason: "unknown"

として構いません。

loop中の場合も同様に、無理に終了時刻を生成しないでください。

5. RF5C164は後段階にする

RF5C164はYM2610/YM2608のROMベースADPCMとは性質が異なります。

RF5C164ではPCM RAMへの書き込みが時系列で発生するため、

RF5C164 memory state at time T

を考慮する必要があります。

そのため、最初からYM2610と同じ静的ROM抽象化へ押し込まないでください。

実装順は以下を推奨します。

Phase 1
YM2610 ADPCM-A
YM2610 ADPCM-B
YM2608 ADPCM-B
Phase 2
RF5C164 PCM
Phase 3
YM2608 Rhythm

まずPhase 1だけで、

* Data BlockからSample Memoryを構築
* レジスタ書き込みからPlayback Eventを検出
* address rangeからSample Definitionを作成
* Sample一覧を表示
* 使用時刻・channelを表示
* embedded dataがあれば単体再生

まで実装してください。

6. Analyzerの既存機能とは分離する

既存のFM / SSG / PSG Note-ish解析を変更しすぎないでください。

Sample Explorerは、

FM / SSG / PSG
    ↓
Note Event
ADPCM / PCM
    ↓
Sample Definition + Playback Event

という別系統の解析として追加します。

最終的にNote-ish timeline上で両方を表示できればよいですが、内部データモデルまで統合する必要はありません。

最初のゴール

まずYM2610のVGMについて、

ADPCM-A CH2
Sample 03
0x12000 - 0x16fff
20,480 bytes
Used:
00:01.240 - 00:01.580
00:04.120 - 00:04.460
00:08.540 - 00:08.880

のように、

「ROMのどの領域が、一つのサンプルとして、いつ、どのchannelから使われたのか」

を確認できるところまで実装してください。

WAV export、MIDI/MML export、波形UIなどは、この基本解析が正しく動いてから追加してください。