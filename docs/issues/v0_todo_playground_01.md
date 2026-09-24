# YM2612 Playground：MIDI import の対応案

## 現行の channel 指定（MIDI CH）

`midi.output()` の `channel` は MIDI の演奏パート。既定は自動割り当て。
YM2612 は `midi.enableSoundChip(..., {roundRobin: false})` による物理 CH 固定も選べる（末尾参照）。

```js
const lead = midi.output("tetorica-ym2612", {channel: CH4});
const other = midi.output("tetorica-ym2612", {channel: CH5});
const defaultPart = midi.output("tetorica-ym2612"); // MIDI CH1
```

- 数値0〜15（CH1〜CH16）。省略 / undefined は0（CH1）。配列指定は廃止。
- 指定の有無にかかわらず、音源側が空き声を優先し、満杯なら最も古い発音を置き換える。FM6声・PSGトーン3声を共有。
- 同じ送り先・MIDI CH のハンドルは音色・CC・Pitch Bend・Sustain を共有する。別 CH の設定は独立。
- channel 省略時の YM2612 setVoice は MIDI Playground と同じ全16 CHへの音色設定。発音はCH1。
- 旧物理固定・配列指定の生成コードは再 Import を推奨する。数値指定の意味も MIDI CH に変更した。
- Import にラウンドロビン指定は設けない。Skip / Select、送り先、MIDI CH、音色を選ぶ。
- MIDI CH の Auto は、設定が衝突しないよう生成時に空いている論理番号を割り当てる機能。発音枠の割り当てとは別。

## 目的

MIDI ファイルを読み込み、パートと音色を選んで YM2612 Playground で再生できるようにする。
以下は対応状況と後続 TODO。既存の `play()` や物理 CH を指定する API の意味は変更しない。

まずは Standard MIDI File（SMF）の取り込みを対象とする。
外部 MIDI 機器の接続や MIDI Playground 全体の移植は今回の対象に含めない。

## 初期実装（2026-09-24）

- `Import MIDI` から SMF format 0 / 1・PPQN のファイルを読み込み、パートごとに Skip / YM2612 / PSG、再生先 MIDI CH、FM プリセットを選択できる。
- Import は `midi.output()` と Note On / Off・CC・Pitch Bend を並べた編集用 JavaScript を生成する。元の `.mid` は保存せず、変換後の実行にも不要。
- `midi.output()`、`play()`、`noteOn()`、`noteOff()`、YM2612 の `setVoice()` / `loadVoice()` を追加。FM６声・PSGトーン３声を共有し、満杯の場合は最も古い発音を置き換える。
- ハンドルの `play()` は拍単位。既存の `setBpm()` を使用する。Import はファイルのテンポマップをイベント秒数へ変換する。
- 音色は Preset / TFI / VGI に対応し、次の発音から適用する。`loadVoice()` は Run ファイル基準。
- Main / Worker の両経路に接続。FM と PSG の書き込みを同じ音声時刻予約に送る。既存 `midi.playFile()` は先読み予約、現在の Import 生成コードは基準時刻からの待機後に命令を発行する。
- 入力ファイルは32 MiB・50万イベントまで。解析時はトラック・ポート・デバイス名・元tick・順序と Bank / Program / CC 等を保持する。生成コードには対応する演奏命令を展開し、未対応イベントはコメントで通知する。

初期版の制限：

- MIDI import / ファイル再生は **YM2612 の ymfm モード**が対象。Nuked モードにはまだ接続していない。
- 音色は手動指定。Program / Bank の自動適用、未対応 CC・Pressure、PSGノイズ、ドラム割り当て、DAC / PWM は未対応。
- SMPTE 時間単位と SMF format 2 は未対応としてエラーにする。
- パートは初期状態で Skip。必要なパートを選ぶ。Import では同一再生先・MIDI CH への複数パートを統合できる。音色・ベンド幅は最初に選択したパートの設定を使い、CC 等は共有する。互換 API `midi.playFile()` は重複した割り当てを拒否する。
- `midi.playFile()` はトップレベルから呼ぶ。liveLoop 内の呼び出しは初期版では拒否する。
- MIDI ファイル再生中の手動 MIDI 操作は拒否する。既存の FM / PSG 直接操作や DAC と併用せず、MIDI 専用の演奏コードとして使用する。
- ブラウザー上の実操作・試聴は未確認。以下のチェックは実装と自動テストの範囲を示す。

検証：MIDI API・パーサー・Main / Worker 接続の自動テスト、実 YM2612 WASM での発音、PSG の予約時刻を確認済み。
Playground 全体では、今回未変更の `vgm_export.test.mjs` の DAC stream export テストに１件失敗が残る。

## Pitch Bend 追加（2026-09-24）

- FM / PSG ハンドルに `pitchBend(value)`（−1〜1、中央0）と `setPitchBendRange(semitones)`（0〜96半音、既定2）を追加。
- 同じ送り先・MIDI CH の発音中の音と、次の発音へ反映する。発音中は周波数だけを書き換え、キーオンや音量の再設定はしない。
- ファイルの14-bit Pitch Bend は最小0→−1、中央8192→0、最大16383→1として扱う。別トラックでも同じ元ポート・デバイス名・MIDI CH のベンドを反映する。
- Import の各パートに `Bend ± semitones` 欄を追加。`midi.playFile()` のルートでは `bendRange` で指定でき、省略時は2。手書き API の設定とは分けてファイル開始時に初期化する。
- Stop でベンドを中央、幅を既定値へ戻す。FM / PSG の周波数レジスタで表現できない範囲は既存変換処理の上限・下限に制限される。
- RPN による幅変更はまだ適用しない。該当コントローラーを含むファイルには、手動指定が必要な旨を表示する。

```js
const lead = midi.output("tetorica-ym2612", {channel: CH1});
await lead.setVoice(FM_PRESETS.sine);
await lead.setPitchBendRange(12);
await lead.noteOn("C4");
await lead.pitchBend(0.5); // +6半音。キーオンし直さない
await beat(1);
await lead.pitchBend(0);
await lead.noteOff("C4");
```

## 設計開始時の API と実装の差

| 項目 | Tetorica MIDI Playground | YM2612 Playground |
| --- | --- | --- |
| Note On / Off | MIDI CH・音高で操作 | 物理 FM CH・BLOCK / F-NUM で操作 |
| 和音の発音割り当て | 空き声・古い声への割り当てあり | `play()` は指定 CH で発音 |
| Velocity | 内蔵音源に反映 | 現在の `play()` では未反映 |
| Pitch Bend・CC・Pressure | MIDI API と内蔵音源側の処理あり | 同等の MIDI 操作層が必要 |
| Program Change | 送信 API あり。内蔵音色への対応付けは未実装 | プリセット選択あり |
| 時刻指定 | MIDI 送信側の仕組みあり | サンプル時刻指定のレジスタ予約あり |

MIDI Playground には `noteOn` / `noteOff` / `cc` / `programChange` /
`pitchBend` / `channelPressure` / `polyPressure` / `send` がある。
ただし、MIDI メッセージを作る JS API と、内蔵音源でそれを解釈する処理は別。
内蔵音源側の発音割り当て・コントローラー処理は Rust 実装であり、そのまま JS に移せるわけではない。

参考となる既存コード：

- `w/tetorica-midi-playground/ui/midi-primitives.js`：MIDI API・メッセージ生成。
- `w/tetorica-midi-playground/src-tauri/src/synth_core.rs`：発音割り当て・ベンド・CC 等。
- `w/tetorica-midi-playground/docs/issues/api_next_01.md`：MIDI API の仕様・実装状況。
- `web/playground_music.js`：既存の `play()` と発音所有権の管理。
- `web/playground_runtime.js`：`scheduleWritesSamples()` と再生処理。
- `docs/playground/tetorica-playground-globals.d.ts`：公開 API の型定義。

## 構成案

```text
MIDI ファイル
  → 時刻付き MIDI イベント
  → 発音割り当て・コントローラー・音色管理
  → 既存の YM2612 再生スケジューラー
```

ファイル解析と、MIDI イベントを YM2612 へ反映する処理を分ける。
既存の物理 CH 操作に MIDI CH の意味を混ぜず、MIDI 用の操作層を追加する。
送り先ハンドルと音色指定は MIDI Playground の API に揃える方針とする。
初期の送り先は `tetorica-ym2612` と `tetorica-sega-psg`。
DAC / PWM のサンプル割り当ては後続の検討項目とする。

### トラック・送り先・MIDI CH・物理 CH の区別

- トラックはファイル内のイベントのまとまり。MIDI CH と１対１とは限らない。
- ファイルの送り先情報（デバイス名・ポート等）は読み取り対象とするが、存在しないファイルも扱う。
- 元の送り先と MIDI CH を組として保持する。異なる送り先の CH1 を同じ演奏状態にまとめない。
- import UI で元のパートを、再生先の YM2612 / PSG と MIDI CH へ割り当てる。
- 再生時の音色・コントローラー状態は「再生先＋MIDI CH」で管理する。
  複数の元パートを同じ組へ割り当てる場合は、音色・CC が共有されることを表示する。
- 同じ `tetorica-ym2612` を指定したハンドルは１つの音源の発音枠を共有する。
  ハンドルを増やしても YM2612 のインスタンスや発音数を自動で増やさない。

例えば MIDI CH8 の単旋律は、空いている物理 FM CH で再生できる。
制限になるのは MIDI CH の番号ではなく、同時発音数。
MIDI CH1 だけで７音の和音を鳴らす場合でも、FM６声では収まらない。
PSG の発音枠・ノイズの扱いは FM と分けて管理する。

### 送り先・音色指定の採用方針

```js
const lead = midi.output("tetorica-ym2612", { channel: CH1 });
const bass = midi.output("tetorica-sega-psg", { channel: CH2 });

await lead.setVoice(preset); // 既存の YM2612 Preset Object
// または FILES 内の音色ファイルを使用する
await lead.loadVoice("./lead.tfi");
await lead.play("C4", { velocity: 100, duration: 1 });
```

- [x] `midi.output(destination, { channel })` を導入する。channel は MIDI CH の数値 0–15（CH1–CH16） であり、物理 CH の予約ではない。
- [x] YM2612 ハンドルの `setVoice(preset)`、`setVoice(bytes, { format: 'tfi' | 'vgi' })`、`loadVoice(path)` を移植する。
- [x] 音色は次の Note On から適用し、発音中の音にはその音が開始した時点の音色を保持する。
- [x] channel 省略時は既存仕様に揃え、YM2612 の音色設定は全16 MIDI CH、発音は MIDI CH1 とする。
- [x] 音色設定と後続の Note On の処理順序を Worker 経由でも保証する。
- [ ] `loadVoice()` の相対パスは Run ファイル基準とし、TFI / VGI のバイナリアセット保存・カセット往復を確認する。
- [x] ハンドルの `play()` の duration は MIDI Playground と同じ拍単位にする。既存の FM `play()` の秒単位とは区別する。

`setVoice` / `loadVoice` は YM2612 用。PSG に FM 音色設定を適用しない。
既存 Preset Object と TFI / VGI の変換処理を活かし、新しい音色形式は増やさない。
ブラウザー側の実装は既存 FM / PSG API へ接続する。
Native の Tauri 接続や SysEx 転送の仕組みをそのまま移植することは前提にしない。

参照：`w/tetorica-midi-playground/ui/playground-api.d.ts`、
`w/tetorica-midi-playground/docs/issues/midi_sysex_01.md`。
MIDI Playground の低レベル MIDI API は現状グローバル側にあり、ハンドルには
`play` / `setVoice` / `loadVoice` がある。今回の Playground 側にはハンドルの Note On / Off を追加した。CC7 / 10 / 11 / 64 / 120 / 121 / 123 にも対応。その他は後続対応とする。

## 必要な改善

### 1. MIDI ファイル解析・時刻変換

- [x] 対応する SMF 形式・時間単位を定義し、未対応形式を明示する。
- [x] 複数トラックのイベントを統合し、同時刻のイベント順序を定義する。
- [x] テンポ変更を反映して tick を再生時刻へ変換する。
- [x] 元のトラック、送り先情報、MIDI CH、tick、イベント順序を保持する。送り先未指定時の割り当て方針も定義する。
- [x] Program Change・Bank Select を、発生時刻付きのイベントとして初期段階から保持する。
  Bank Select は MSB / LSB の両方を保持し、同時刻の Program Change・Note On との順序を失わない。
- [x] Note On / Off、Velocity を読み取る。Velocity 0 の Note On は Note Off として扱う。
- [x] 不正なファイルや未対応イベントを診断できるようにする。

### 2. MIDI CH と物理 FM CH の分離

MIDI の１ CH にも和音が入るため、MIDI CH を物理 FM CH へ単純に固定対応させない。

- [x] 発音ごとに物理 CH を割り当て、MIDI CH・音高・発音の所有権を管理する。
- [x] 同時発音数を超えた場合の優先順位と、打ち切る音の選択方針を決める。
- [x] 同音の重複、連打、割り当て直後の古い Note Off を正しく扱う。
- [ ] DAC 使用時の CH6 など、使用可能な FM CH の制約を反映する。
- [ ] PSG のトーン発音割り当て・音量変換を追加し、ノイズを含む対応範囲と資源競合を定義する。
- [ ] 既存の `play()` やレジスタ直接操作と併用する場合の CH 所有権を決める。

### 3. MIDI の演奏状態

- [x] Velocity を音色のキャリア構成に応じた音量へ反映する。
- [x] Pitch Bend を発音中の音へ適用する。
- [x] ベンド幅は既定 ±2半音。API と Import UI で手動指定できる。RPN 対応は後続 TODO。
- [x] CC7 Volume / CC11 Expression / CC10 Pan を反映する（Pan は FM のみ）。
- [x] CC64 Sustain と Note Off の保留・解除を実装する。
- [x] All Sound Off / All Notes Off / コントローラーリセットを扱う。
- [ ] Modulation、Sostenuto、Channel / Poly Pressure は後続段階で検討する。

YM2612 のパンなど、音源の制約で MIDI の値をそのまま再現できない項目は近似方法を明示する。

### 4. 音色・パート選択 UI

- [x] トラック・元の送り先・MIDI CH を確認し、取り込むパートと再生先の音源・MIDI CH を選べるようにする。
- [x] パートの FM プリセットを手動指定できるようにする。
- [x] 初期段階は手動の音色設定を使用し、保持した Program Change / Bank Select は自動適用しないことを明示する。
- [ ] Bank / Program とプリセットの対応表を登録する API を後続段階で検討する。
  対応表を設定した後は、保持したイベントから曲途中の音色変更も反映できるようにする。
  未割り当て番号の扱いと手動設定の優先順位は、この API の追加時に定義する。
- [ ] ドラムパートを識別し、初期段階では除外・手動指定など扱いを明示する。
- [ ] 発音数超過や無視したイベントを確認できるようにする。

Program Change の番号だけでは FM 音色は決まらない。
初期段階で GM 音色やドラムの完全再現を目標にしない。

### 既存 Sheet Music 処理の再利用範囲

音符データやパート表示は再利用候補として調査する。
VGM の演奏命令から音符を抽出する処理と、MIDI の tick・テンポから再生時刻を求める処理は分ける。
音符だけのデータへ変換して、CC や曲途中の音色変更情報を捨てない。

- [ ] Sheet Music のデータ構造・表示部品の再利用可否を確認する。
- [x] 既存の `setBpm()` / `beat()` は維持する。手書きコードは設定 BPM、MIDI Import はファイルのテンポマップをイベント秒数へ変換する。
  現在の生成コードは標準 `sleepSamples()` の差分待機を使用する。旧生成コードの `midi.createTimeline()` は基準時刻からの絶対待機として残す。
  既存の `midi.playFile()` は音声時刻予約を使用するが、Import の生成先ではなく互換 API として残す。
  既存の時計処理にも基準時刻からの待機計算がある。`nextBeat()` は次の拍境界、ループ内の `sleepSamples()` は累積サンプル位置を基準とする。
  ただし `beat()` はループ内でも予定拍と現在拍の遅い方から次の待機先を決めるため、遅れを常に元の拍位置へ戻す方式ではない。
  JavaScript の待機終了時刻と、音声側に予約する発音時刻は区別する。

### 5. 再生・停止・Worker 統合

- [x] 既存のサンプル時刻指定スケジューラーへ接続する。
- [ ] 密なイベントでも画面更新や JS の待機時間に演奏タイミングが左右されにくい予約方式にする。
- [x] Stop／Run 再実行で予約を破棄し、発音・Sustain 等の状態を解放する。
- [x] Run in Worker の ON / OFF で同じ動作になることを確認する。
- [x] 長い曲の全イベント・全レジスタ書き込みを無制限に展開しないよう、メモリと先読み範囲を検討する。
- [ ] 公開する API の型定義・補完・使用例を更新する。

## 推奨する実装順序

1. `midi.output()` と既存互換の音色指定、Note On / Off・Velocity・基本の発音割り当てを追加し、手書きコードで確認する。
2. MIDI import を接続し、パート選択・音色指定・テンポ変更に対応する。
3. 発音数超過・同音連打・Stop／再実行を含む再生の安定化。
4. Sustain・Pitch Bend・Volume／Expression／Pan。
5. Program Change の音色対応表、ドラム、その他の CC・Pressure。

基本の発音割り当てと停止処理は第１段階から必要。後続段階で複雑なケースを拡充する。
まず単旋律と簡単な和音で検証し、その後にテンポ変更・密な曲・実際の MIDI ファイルへ広げる。
Import は「取り込み → パート・音色選択 → 編集用 JavaScript 生成 → 編集・再生」とする。

## 検証項目

- [ ] 単旋律、和音、同音連打、重複ノート、同時発音数超過。
- [ ] 複数トラック、同一 MIDI CH を使う複数トラック、テンポ変更、同時刻イベント。
- [ ] 送り先未指定、複数送り先の同じ CH 番号、MIDI CH7–16、複数ハンドルでの発音枠共有。
- [ ] Bank Select / Program Change の時刻・順序の保持と、手動音色指定での再生。
- [ ] PSG への割り当てと、FM / PSG 混在時の停止・発音数制限。
- [ ] Sustain 中の Note Off と Stop、ベンド中の新規発音と音の打ち切り。
- [ ] Worker 切り替え、再実行、曲終了後に音や予約が残らないこと。
- [ ] 既存の Playground サンプルと `play()` の挙動が変わらないこと。

## MIDI チャンネル番号の統一（2026-09-24）

- 公開 MIDI API と `midi.playFile()` の再生先 `channel` は 0〜15。省略時は 0（CH1）。
- `CH1 = 0`〜`CH16 = 15` を Main / Worker のグローバル・pg で使用できる。
- Import UI は CH1〜CH16 を表示し、生成コードには 0〜15 を保存する。元ファイルの解析結果・part キーは既存形式を維持する。
- 保存済みコードの旧 `channel: 1` は `channel: CH1` または `channel: 0` に修正が必要。以前 Import したエントリーも再取り込み、または再生先 channel を修正する。自作コードは自動変換しない。
- MIDI CH は物理 FM CH の固定指定ではない。既存の発音割り当て・直接操作 API の意味は維持する。

## CC 対応（2026-09-24）

- ハンドルに `await lead.cc(controller, value)` を追加。値は整数 0〜127。
  CC7 Volume、CC10 Pan、CC11 Expression、CC64 Sustain、CC120 All Sound Off、
  CC121 Reset All Controllers、CC123 All Notes Off に対応。未対応 CC は false を返して適用しない。
- Volume / Expression は Velocity と合成し、発音時の音色を基準に FM キャリア TL / PSG 音量へ反映。
  発音中の変更でキーオンし直さず、音色の再指定も次の発音まで反映しない。
- FM Pan は 0〜42 が左、43〜84 が中央、85〜127 が右。プリセットの左右出力設定と組み合わせる。
  PSG はチャンネル別 Pan を未対応とし、Import で制限を表示する。
- Sustain は 64 以上でオン。CC123 は Sustain を尊重する。CC120 は保留音と FM のリリース中の音も消音する。
- CC121 は Expression、Sustain、Pitch Bend を初期化。Volume、Pan、手動設定した Bend Range、音色は維持する。
  Stop とファイル再生開始では全コントローラー状態を初期化する。
- MIDI ファイルの CC は、別トラックにある場合も同じ元ポート・デバイス・MIDI CH の割り当て先へ予約時刻で反映。
  未対応 CC / Pressure / Bank / Program は保持し、未適用であることを通知する。
- Main / Worker、ペダル解除、音量復元、発音所有者のキャンセル、Stop、別トラックの時刻予約を自動テストで確認。
  ブラウザーでの試聴は未確認。

参考: [MIDI Association の CC 一覧](https://midi.org/midi-1-0-control-change-messages)。

## Import の生成コード方式（2026-09-24、意図の再確認）

Import VGM と同様に、ファイル再生 API の呼び出しではなく、演奏命令へ展開する。
既存 `midi.playFile()` は保存済みコード用に残し、Import では使用しない。

```js
const ym2612_1 = midi.output("tetorica-ym2612", {channel: CH8});
await ym2612_1.setVoice(FM_PRESETS.sine);
const timeline = midi.createTimeline();
await timeline.waitUntil(0);
await ym2612_1.noteOn(60, {velocity: 100});
await timeline.waitUntil(0.5);
await ym2612_1.noteOff(60);
```

- テンポ変更は絶対秒数へ変換し、テンポ情報はコメントにも残す。同時刻のイベント順序を維持する。
- 別トラックの CC / Pitch Bend も元ポート・デバイス・MIDI CH の組に従って展開する。
- 未対応イベントは未適用のコメントを残す。元のバイナリを完全保存する形式ではない。
- 生成コードは16 Mi文字以内。超えた場合は保存前にエラーにし、選択パートを減らすよう案内する。
- `createTimeline()` は Main では AudioContext の時刻、Worker では単調時計を基準にする。
  遅れは次の待機で吸収し、既に過ぎた予定時刻は Stop を処理できるよう一度実行権を返して追いつく。
  大幅な遅れでイベントを省略はしないため、復帰直後にイベントが集中する場合がある。
- この待機は累積ドリフトを防ぐもので、JS / Worker 通信による個々の発音遅延をなくすものではない。
  `beat()` 自体の既存の意味は今回変更しない。

## Import モジュールの再利用

Import は同じディレクトリに `song.js`（演奏モジュール）と `main.js`（Run 用エントリー）を生成する。
モジュールを import しただけでは初期化・発音しない。

```js
const marioWorld01 = await import("./song.js");
await marioWorld01.initCh(pg);
await marioWorld01.runAllCh();
// 単独: await marioWorld01.runCh1();
// 任意の組み合わせ: await marioWorld01.runChannels([1, 3]);
```

- `initCh(pg)` で実行中の Playground API を渡し、送り先と音色・ベンド幅を設定する。
- 選択した再生先 MIDI CH に応じて `runCh1()`〜`runCh16()` を export する。存在する CH のみ生成。
  FM と PSG が同じ番号を使用する場合は、その番号の関数で両方を再生する。
- `runAllCh()` / `runChannels([1, 3])` は共通の開始時刻・元のイベント順序で再生する。
  番号は関数名と同じ 1〜16（MIDI API の数値指定 0〜15 とは区別）。
- 同じモジュールの複数の run 関数を同時に呼ぶことは拒否する。任意の CH の合成には `runChannels()` を使用する。
- 個別再生でも元の曲中位置・冒頭の無音を保ち、選んでいない CH に命令を送らない。
- 別の曲モジュール同士の同期・音源割り当て競合・開始オフセットは後続の設計項目。
  今回は単一曲内の CH 選択と同期まで。

### 標準 API の演奏コードを生成する

Import VGM と同じく、通常の MIDI API と `await sleepSamples()` へ展開する。
`createSongPlayer`、`yield {at, ...}`、`order` / `offOrder` には依存しない。

```js
await output.pitchBend(0.1);
await output.noteOn("C4", {velocity: 100});
await sleepSamples(4410);
await output.noteOff("C4");
```

- 待機の基準は44,100 samples/秒。実際の AudioContext の出力レートには依存しない。
- MIDI のテンポ変更を絶対秒数へ変換し、絶対位置をサンプルに丸めてから差分を求める。
  各区間を独立に丸めることによる誤差の累積を避ける。`setBpm()` によって待機時間は変化しない。
- 重なる音、同音の連打、途中の CC / Pitch Bend、対応する片側がないノートも元のイベント順で記述する。
  単純な音符を `play()` へまとめる改善は後続。現在は明示した Note On / Off を使う。
- 生成した `performance(outputs, sleepSamples)` に演奏コードを1本だけ置く。
  CH 選択時は `if (出力先)` で命令を選び、待機は共通。同時刻の順序は CH 選択の配列順に依存しない。
  全体再生・個別再生で別の演奏コードを複製しないので、編集内容がどちらにも反映される。
- `runCh1(lead)`、`runChannels([1, 3], {1: lead, 3: bass})`、`runAllCh({1: lead})` を維持する。
  run 系は事前に `initCh(pg)` が必要。音色・ベンド幅は差し替え先で設定する。
- `ch1Events(output, sleepSamples)` は **async 関数**。generator ではない。
  初期化せず `await song.ch1Events(lead, pg.sleepSamples)` として呼び出せる。
  同じ番号に FM / PSG がある場合は `ch1Events(fm, psg, pg.sleepSamples)`。
- 終了・中断時は選んだ出力先へ CC120 を送り、発音を止める。
- 同じ output を複数パートで使うと音色・CC・Pitch Bend・消音対象も共有する。
- トップレベルの `sleepSamples()` は相対待機であり、命令処理やタイマーの遅延は累積し得る。
  liveLoop 内の累積サンプル時計とは区別する。今回は標準 API の時計仕様を変更しない。
- 旧 `createSongPlayer` API は保存済みコード用に残すが、新規 Import は使用しない。
  新しい生成方式を使う場合は再 Import。実ブラウザーでの新形式の操作・試聴は未確認。

## Import の自動発音割り当て

- 各パートを Skip / Select と送り先 FM / PSG で選択する。
- MIDI CH は Auto が既定。元の MIDI CH が空いていれば使用し、衝突時は別の空き番号を割り当てる。
  明示した MIDI CH は先に予約する。Skip のパートには割り当てない。
- FM は物理6声、PSG はトーン3声を共有する。空き声優先、満杯時は最も古い発音を置き換える。
  順番固定のラウンドロビンではない。物理 CH を固定指定・制限する機能は今回追加しない。
- 音色・CC・Bend の分離のため、生成コードには割り当て済みの論理 MIDI CH を明記する。
  channel 指定を省略して全パートを CH1 の設定に統合することはしない。
- 同じ音源につき最大16パート。超過時は状態を混ぜず、Skip または別音源への変更を案内する。
- `runChN()` の N は自動割り当て後の論理 MIDI CH。物理 FM の発音枠の番号ではない。

## Import UI

- ラウンドロビン / CH固定 のモード選択は撤去した。
- 各パートで Skip / Select、Output（FM / PSG）、MIDI CH（Auto / CH1〜CH16）、FM音色、Bend幅を選ぶ。
- MIDI CH は FM / PSG とも16 CHから選択可能。CH番号は物理音源の声数に制限されない。
- Auto でも生成コードに割り当て済み MIDI CH を明記し、パート別の音色・CC・ベンドを保持する。
- 共通の演奏関数に標準 API 呼び出しを並べる。出力コードの分割・結合は発音割り当てとは別事項。

### 演奏部分だけを別の出力先で使う例

```js
const song = await import("./song.js");
const lead = midi.output("tetorica-ym2612", {channel: CH1});
await lead.setVoice(FM_PRESETS["two-op-bell"]);
await song.ch1Events(lead, pg.sleepSamples);
```

この使い方では元の `initCh()` や音色設定に依存しない。
複数 CH を同じ時計で再生する場合は、`initCh(pg)` の後に
`runChannels([1, 2], {1: lead, 2: bass})` を使う。

## 生成コードの接続確認（2026-09-24）

- Main／Worker の実行処理へ生成したモジュールの本体を通し、標準 MIDI API と
  `sleepSamples()` による発音・終了・Stop・再実行を自動テストで確認。
  テストではモジュールの export をローカル関数へ置換し、ブラウザーの FILES import 自体は未検証。
- Worker の停止処理後に待機を登録すると次の Run が遅れる競合を修正。
  停止済みの Worker／ループは、新しい待機を開始せず中断する。
- Main の停止時の消音・再実行は確認済み。ただし停止と待機開始が重なった場合、
  旧実行の Promise が待機終了まで残るケースは引き続き改善候補。
- 接続可能なブラウザーがなかったため、実画面での Import、試聴、実機での Worker 切り替えは未確認。

### 長い生成コードのエディター解析負荷

長い MIDI の演奏命令は、128行以内の `async function sectionN()` に分割し、
順番に `await` する。標準 API 呼び出しと待機サンプル数・発音順序は維持する。
1つの関数に大量の条件分岐を並べることによる Monaco／TypeScript の型解析負荷を抑える。
3,000音の自動テストで分割後の順序と待機量を確認。報告されたブラウザー上の
スタックオーバーフローが解消するかは実機で再確認が必要。既存ファイルは再 Import で更新する。

## YM2612 の物理 CH 固定モード

```js
await midi.enableSoundChip("tetorica-ym2612", {roundRobin: false});
const lead = midi.output("tetorica-ym2612", {channel: CH4});
await lead.setVoice(FM_PRESETS["two-op-bell"]);
await lead.play("C4", {duration: 1, velocity: 100});
```

- `roundRobin: true`（オプション省略時も true）は従来の自動発音割り当て。
- `false` は MIDI CH1〜CH6（数値0〜5）を物理 CH1〜CH6に固定する。
  各 CH は単音で、次の Note On が前の発音を置き換える。CH7〜CH16 は発音しない。
- 省略した output channel は CH1。複数ハンドルでも同じ物理 CH を共有する。
- モード変更時は YM2612 の発音・余韻を止める。同じモードの再指定では消音しない。
  音色・コントローラー設定は保持する。再現性のため Run の冒頭でモードを明示する。
- PSG、外部 MIDI 出力にはこの設定を適用しない。CH3 special や DAC は追加対応ではない。
- 通常の `noteOn` / `noteOff` / CC / Pitch Bend / `setVoice` をそのまま使う。
  チップへ直接レジスタを書き込む API との併用を安全にする予約機能ではない。

固定モードのサンプル：YM2612 Playground の `MIDI fixed physical CH (YM2612)`、
MIDI Playground の `/examples/14_ym2612_fixed_channels.js`。
2 CH の同時発音、同一物理 CH の音の置き換え、CH7 が無音になることを試せる。

### 固定／自動割り当ての liveLoop デモ

- YM2612 Playground：`MIDI fixed CH liveLoop + CC / Bend` と `MIDI auto chord liveLoop + CC / Bend`。
- MIDI Playground：`/examples/14_ym2612_fixed_channels.js` と `/examples/15_ym2612_auto_chord.js`。
- 固定版は単音、自動版は同じ進行の3和音。CH1 のベースと一緒に繰り返す。
  CH4 の Pitch Bend でビブラート、CC11 で音量、CC10 で左右を動かす。Stop で終了。
  CC11／CC10 は音程変更ではなく、音程は Pitch Bend が担当する。

### MIDI liveLoop の Stop 後に発音が残る問題

MIDI の保持音がある状態で Stop すると、Run の無効化後の `cancelOwner()` が
同期的な `AbortError` を投げ、後続の音源消音処理を中断していた。
終了時のキャンセルを処理して、ラックの強制消音まで必ず進むよう修正。
停止時のキーオフ・TL による消音・再実行を自動テストで確認した。
