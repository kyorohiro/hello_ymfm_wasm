# YM2612 Playground：MIDI import の対応案

## 現行の channel 指定（物理 CH 選択）

`midi.output()` の `channel` は物理的な発音先を選ぶ。以下の過去の MIDI CH 指定の記述は初期実装の経緯であり、現行 API はこの節を優先する。

```js
const chords = midi.output("tetorica-ym2612", {channel: [CH1, CH2, CH3]});
const lead = midi.output("tetorica-ym2612", {channel: CH4});
const bass = midi.output("tetorica-ym2612", {channel: CH5});
const extra = midi.output("tetorica-ym2612", {channel: CH6});
const automatic = midi.output("tetorica-ym2612"); // 全6声が対象
```

- 省略 / undefined：FM 全6声、PSG トーン全3声。
- 数値：指定した物理 CH に固定。数値は0始まり、定数 CH1=0。
- 配列：指定した物理 CH だけを使用。順に空き声を探し、満杯なら範囲内の最も古い声を置き換える。
- 指定が重なるハンドルは同じ物理声を取り合う。undefined は固定 CH を自動で除外しない。
- 音色・CC・Pitch Bend・Sustain はハンドルごとに独立。音色の省略時全 MIDI CH への一括設定は廃止。
- 数値0〜15は入力可能だが、その音源に存在しない物理 CH は発音しない。配列からは除外する。空配列も無音。
- Worker は生成したハンドルIDと対象範囲を Main に登録し、全操作で同じIDを使う。
- Import の Physical CH 欄は空欄 / Auto、CH4、CH1,CH2,CH3 の形式。生成コードへ省略・数値・配列として反映する。
  別途割り当てる論理番号は `runChN()` のパート選択名に使用し、物理 CH の指定とは分ける。
- 旧生成コードの `channel: CH8` などは新仕様では FM の範囲外で無音となる。再 Import、または channel を省略・使用可能な範囲へ変更する。
- 既存 `midi.playFile()` の route.channel は互換性のため従来の論理 MIDI CH を維持する。
- Tetorica MIDI Playground（別アプリ）の API は今回変更していない。

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
- パートは初期状態で Skip。必要なパートを選ぶ。同一再生先・MIDI CH への複数パートの割り当ては初期 UI / API で拒否し、暗黙の状態共有を防ぐ。
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
  生成コードは `midi.createTimeline()` と `timeline.waitUntil(seconds)` を使用する。毎回 `開始基準時刻 + イベント秒数` を待ち、前回の処理遅れを待ち時間から差し引く。
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

### CH ごとの演奏命令と共通再生処理

- `song.js` の演奏部分は `function* ch1Events()` など、CH ごとのジェネレーターに分割する。
  各行は `yield [秒数, () => 音源.noteOn(...), 元の順序]` の形。演奏命令ごとの CH 選別用 `if` は生成しない。
- `runChannels()` は選択 CH の次の1イベントずつを保持し、時刻順に取り出す。
  同時刻では第3要素の元イベント順を使うため、CH 選択の配列順に発音順序が左右されない。
- 第1要素は曲開始からの秒数。各 CH 内では時刻順を維持する。第3要素は同時刻の順序を編集したい場合に変更する。
- 個別再生・選択再生・全体再生は同じ再生処理を使う。呼び出し側の API は変更しない。
- 再生時に全イベント配列を作らず、最大16 CH 分の次のイベントだけを保持する。

## Import の自動発音割り当て

- 各パートを Skip / Include: FM auto voices / Include: PSG auto voices で選択する。
- MIDI CH は Auto が既定。元の MIDI CH が空いていれば使用し、衝突時は別の空き番号を割り当てる。
  明示した MIDI CH は先に予約する。Skip のパートには割り当てない。
- FM は物理6声、PSG はトーン3声を共有する。空き声優先、満杯時は最も古い発音を置き換える。
  順番固定のラウンドロビンではない。物理 CH を固定指定・制限する機能は今回追加しない。
- 音色・CC・Bend の分離のため、生成コードには割り当て済みの論理 MIDI CH を明記する。
  channel 指定を省略して全パートを CH1 の設定に統合することはしない。
- 同じ音源につき最大16パート。超過時は状態を混ぜず、Skip または別音源への変更を案内する。
- `runChN()` の N は自動割り当て後の論理 MIDI CH。物理 FM の発音枠の番号ではない。
