# VGM Analyzer Sample Explorer 仕様

## 目的

PCM / ADPCMを単なる発音イベントとして扱わず、次の関係を確認できるようにする。

```text
VGM内のデータまたは外部ROM
  → 音源メモリ
  → サンプル領域
  → 再生イベント
  → 曲中の使用箇所
```

最初の目標は、音源ROMのどの領域が、いつ、どのチャンネルから、どの設定で使われたかを確認できること。音名への変換は補助情報とし、サンプルID・アドレス・再生設定を一次情報にする。

## 対象チップと優先順位

| Phase | 対象 | 扱い |
| --- | --- | --- |
| 1 | YM2610 / YM2610B ADPCM-A | 外部サンプルROM、6チャンネル |
| 1 | YM2610 / YM2610B ADPCM-B | 外部サンプルROMまたはメモリ、1チャンネル |
| 1 | YM2608 ADPCM-B | 外部メモリ、1チャンネル |
| 2 | RF5C164 | 時系列で変化するPCM RAM |
| 3 | YM2608 ADPCM-A / Rhythm | 内蔵音源データ、6チャンネル |

YM2608のADPCM-AはYM2610の外部ADPCM-A ROMと同じモデルにしない。YM2608はADPCM-Aが内蔵、ADPCM-Bが外部というチップ差分があるため、内蔵データをVGMの任意サンプルROMとして抽出する仕様にはしない。[MAME/ymfmのチップ仕様](https://github.com/mamedev/mame/blob/master/3rdparty/ymfm/GeneralInfo.md#chip-specifics)

FM、SSG、PSGのNote Event解析とは内部モデルを分ける。後で同一タイムラインに重ねて表示できるよう、共通の時刻形式だけ合わせる。

## 内部データモデル

### SampleMemory

VGM Data Block、メモリ書き込み、または外部ROM情報から作った音源メモリの断片。Data Blockをそのままサンプルとはみなさない。

```js
{
  id: "ym2610-adpcma-rom-0",
  chip: "ym2610",
  kind: "adpcm-a",
  source: "vgm-data-block",
  rawStart: 0x10000,
  rawEnd: 0x1ffff,
  addressUnit: "byte",
  data: Uint8Array,
  embedded: true,
  generation: 0
}
```

`rawStart` / `rawEnd` と、チップのアドレス単位を解決した後のバイト範囲は区別する。ADPCM-A/Bではレジスタ値がそのままバイトアドレスとは限らないため、解析結果には `byteStart` / `byteEnd` も保持する。

同じメモリが複数のData Blockに分割されている場合は、アドレスを基準に結合する。重複部分が異なる場合は後勝ちにせず、競合として警告する。

### SampleDefinition

実際の再生レジスタから特定したサンプル領域。同じメモリ範囲は一つにまとめ、再生回数はPlaybackEventで管理する。

```js
{
  id: 3,
  memoryId: "ym2610-adpcma-rom-0",
  chip: "ym2610",
  kind: "adpcm-a",
  channel: 2,
  rawStart: 0x12000,
  rawEnd: 0x16fff,
  byteStart: 0x12000,
  byteEnd: 0x16fff,
  endInclusive: true,
  data: Uint8Array,
  embedded: true
}
```

重複判定には少なくとも `chip`、`kind`、`memoryId`、解決後の開始・終了アドレスを使う。RF5C164のように同じアドレスの内容が変化する音源では、`generation` もキーに含める。

### PlaybackEvent

あるSampleDefinitionが曲中で使われた一回分の記録。

```js
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
  pan: "center",
  loop: false,
  endReason: "natural"
}
```

時刻は既存Analyzerと同じサンプル時刻で保持し、表示時だけ秒・分秒へ変換する。`channel` はFMチャンネルと混同しないよう、`ADPCM-A channel 2` や `ADPCM-B` のように種別を含めて表示する。

## 再生状態と終了理由

再生開始は、開始・終了アドレスと再生開始ビットの状態から検出する。再トリガー、停止、リセット、ループもイベントとして記録する。

```text
natural  : 終端アドレスまたはEOSで終了
keyOff   : 停止ビット・停止書き込みで終了
restart  : 再生中に開始位置を変更
loop     : ループ設定で継続
unknown  : VGM情報だけでは判定不能
```

終了時刻を確定できない場合は、推測値を入れず `endTime: null`、`endReason: "unknown"` とする。ループイベントは無理に一つの有限区間へ展開せず、ループ設定と観測区間を別に保持する。

## 解析手順

1. VGMヘッダ、Data Block、メモリ書き込みを読み、チップごとのSampleMemoryを構築する。
2. レジスタ書き込みを時系列に適用し、各チャンネルの開始・終了アドレス、レート、音量、パン、ループ状態を復元する。
3. アドレス範囲をSampleDefinitionへ正規化し、PlaybackEventから参照する。
4. ROM未収録、範囲外、圧縮、未対応コマンドを警告として記録する。
5. 解析結果を一覧・タイムライン・個別試聴へ渡す。

RF5C164ではData Blockを静的ROMとして扱わず、PCM RAMへの書き込みを時刻順に再生して `memoryGeneration` を作る。これはPhase 2で実装する。

## Sample Explorer UI

最低限、次を表示する。

- サンプル一覧（チップ、種別、チャンネル、アドレス、サイズ）
- VGM内にデータが含まれるかどうか
- 使用回数と各使用時刻
- 再生レート、音量、パン、ループ状態
- 波形プレビューまたは未デコード表示
- サンプル単体の試聴
- 使用箇所からNote-ishタイムラインへ移動
- チャンネル単位のミュート

表示例:

```text
YM2610 ADPCM-A channel 2 / Sample 03
ROM 0x12000–0x16fff / 20,480 bytes
Used: 00:01.240–00:01.580, 00:04.120–00:04.460
```

音程が推定できる場合だけ音名を補助表示する。音程を推定できないサンプルでも、アドレスと使用時刻は表示する。

## デコードと出力

Phase 1では、まず元データとメタデータの確認を優先する。WAV化は、既存の音源コアで再生可能な場合に追加する。

- WAV: サンプル単体の試聴用ファイル
- MIDI: サンプル番号、チップ、使用時刻をテキストメタデータへ記録
- MML: FM / SSGの音符とPCM / ADPCMイベントを別セクションに出力
- 未収録データ: 変換せず、警告とアドレス情報を残す

既存のMAME移植コアや音源コアの結果は、実機の完全一致とは扱わない。

## Phase 1の受け入れ条件

- YM2610 ADPCM-AのVGM Data BlockからSampleMemoryを構築できる
- レジスタ書き込みからSampleDefinitionとPlaybackEventを作れる
- 開始・終了アドレスの単位と終端規則を表示できる
- 曲中の使用時刻、ADPCM種別、チャンネルを表示できる
- 同じアドレス範囲を重複登録しない
- ROMデータがない場合もイベントを失わず、未収録と表示できる
- 取得したデータを個別に試聴できる場合は再生できる
- 既存のFM / SSG / PSG再生、Note-ish表示、ミュート操作に影響しない


## 実装状況（初回）

YM2610 / YM2610B ADPCM-Aの初期実装を追加した。Analyzerの `Sample Explorer` タブから `Analyze samples` で解析する。

- Data Blockを時系列に適用し、発音時点のメモリ内容を参照する。
- 同じ世代・アドレス範囲を共有し、チャンネルはPlaybackEvent側に保持する。
- 分割ブロックの結合、データの完全収録・一部欠損・未収録を区別する。
- 一覧、使用時刻、チャンネル、開始時のレベル・パン、生ADPCM保存、中央定位で最大10秒の単体試聴に対応する。
- 解析中は定期的に処理を譲り、ファイル変更時はキャンセルする。保持データ64 MiB・イベント10万件を上限とする。
- 曲ループは展開しない。使用履歴表示はサンプルごとに先頭500件まで。

終了時刻は未確定として保持する。次の停止・再開始の書き込み時刻は別項目とし、それ以前の自然終了を否定しない。
ADPCM-B、RF5C164、Rhythm、発音途中の設定変更、自然終了追跡、波形、タイムラインへの移動、WAV / MIDI / MML連携は未実装。

上記のデータモデル例に対する実装上の補足:

- 書き込みによるメモリの置換は正当な場合があるため、時系列で適用して世代を変える。変更前の抽出結果は保持する。
- SampleDefinitionには固定のchannelを持たせない。
- バイト範囲は `[byteStart, byteEndExclusive)` に統一する。rawStart/rawEndはPlaybackEventにレジスタ値として保持する。
- YM2610 ADPCM-Aの終端比較は既存ymfmの下位20ビット比較に合わせる。

初期テストでは分割ROM、複数チャンネルによる再使用、後からのROM供給、ROM書き換え、欠損、停止観測、キャンセルを確認する。
