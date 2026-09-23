# YM2612 Playground：MIDI import の対応案

## 目的

MIDI ファイルを読み込み、パートと音色を選んで YM2612 Playground で再生できるようにする。
以下は対応状況と後続 TODO。既存の `play()` や物理 CH を指定する API の意味は変更しない。

まずは Standard MIDI File（SMF）の取り込みを対象とする。
外部 MIDI 機器の接続や MIDI Playground 全体の移植は今回の対象に含めない。

## 初期実装（2026-09-24）

- `Import MIDI` から SMF format 0 / 1・PPQN のファイルを読み込み、パートごとに Skip / YM2612 / PSG、再生先 MIDI CH、FM プリセットを選択できる。
- 元の `.mid` を FILES に保持し、`midi.playFile()` を呼ぶ短いエントリー JS を生成する。音符列を編集用 JavaScript に展開する機能ではない。
- `midi.output()`、`play()`、`noteOn()`、`noteOff()`、YM2612 の `setVoice()` / `loadVoice()` を追加。FM６声・PSGトーン３声を共有し、満杯の場合は最も古い発音を置き換える。
- ハンドルの `play()` は拍単位。既存の `setBpm()` を使用する。ファイル再生はファイル自身のテンポマップを使用する。
- 音色は Preset / TFI / VGI に対応し、次の発音から適用する。`loadVoice()` は Run ファイル基準。
- Main / Worker の両経路に接続。FM と PSG の書き込みを同じ音声時刻予約に送る。イベントからレジスタへの展開は先読み範囲内で行う。
- ファイルは32 MiB・50万イベントまで。トラック・ポート・デバイス名・元tick・順序と Bank / Program / CC 等を解析結果に保持する。未対応イベントは適用せず通知する。

初期版の制限：

- MIDI import / ファイル再生は **YM2612 の ymfm モード**が対象。Nuked モードにはまだ接続していない。
- 音色は手動指定。Program / Bank の自動適用、Sustain・CC・ベンド・Pressure、PSGノイズ、ドラム割り当て、DAC / PWM は未対応。
- SMPTE 時間単位と SMF format 2 は未対応としてエラーにする。
- パートは初期状態で Skip。必要なパートを選ぶ。同一再生先・MIDI CH への複数パートの割り当ては初期 UI / API で拒否し、暗黙の状態共有を防ぐ。
- `midi.playFile()` はトップレベルから呼ぶ。liveLoop 内の呼び出しは初期版では拒否する。
- MIDI ファイル再生中の手動 MIDI 操作は拒否する。既存の FM / PSG 直接操作や DAC と併用せず、MIDI 専用の演奏コードとして使用する。
- ブラウザー上の実操作・試聴は未確認。以下のチェックは実装と自動テストの範囲を示す。

検証：MIDI API・パーサー・Main / Worker 接続の自動テスト、実 YM2612 WASM での発音、PSG の予約時刻を確認済み。
Playground 全体では、今回未変更の `vgm_export.test.mjs` の DAC stream export テストに１件失敗が残る。

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
const lead = midi.output("tetorica-ym2612", { channel: 1 });
const bass = midi.output("tetorica-sega-psg", { channel: 2 });

await lead.setVoice(preset); // 既存の YM2612 Preset Object
// または FILES 内の音色ファイルを使用する
await lead.loadVoice("./lead.tfi");
await lead.play("C4", { velocity: 100, duration: 1 });
```

- [x] `midi.output(destination, { channel })` を導入する。channel は MIDI CH 1–16 であり、物理 CH の予約ではない。
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
`play` / `setVoice` / `loadVoice` がある。今回の Playground 側にはハンドルの Note On / Off を追加した。CC 等は後続対応とする。

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
- [ ] Pitch Bend を発音中の音へ適用する。
- [ ] ベンド幅の扱いを定義する。固定幅で始める場合は制約を表示し、RPN 対応を別途検討する。
- [ ] CC7 Volume / CC11 Expression / CC10 Pan を反映する。
- [ ] CC64 Sustain と Note Off の保留・解除を実装する。
- [ ] All Sound Off / All Notes Off / コントローラーリセットを扱う。
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
- [ ] 既存の `setBpm()` / `beat()` は維持する。MIDI ファイルのテンポマップと手書きコードの BPM の関係を定義する。
  import 再生はイベントごとの `setBpm()` と逐次 `await beat()` だけに依存せず、時刻予約へ接続する。

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
初期の import は「取り込み → パート選択 → 音色指定 → 再生」を目標にする。
編集可能な JavaScript への変換・出力は、その後の別項目として検討する。

## 検証項目

- [ ] 単旋律、和音、同音連打、重複ノート、同時発音数超過。
- [ ] 複数トラック、同一 MIDI CH を使う複数トラック、テンポ変更、同時刻イベント。
- [ ] 送り先未指定、複数送り先の同じ CH 番号、MIDI CH7–16、複数ハンドルでの発音枠共有。
- [ ] Bank Select / Program Change の時刻・順序の保持と、手動音色指定での再生。
- [ ] PSG への割り当てと、FM / PSG 混在時の停止・発音数制限。
- [ ] Sustain 中の Note Off と Stop、ベンド中の新規発音と音の打ち切り。
- [ ] Worker 切り替え、再実行、曲終了後に音や予約が残らないこと。
- [ ] 既存の Playground サンプルと `play()` の挙動が変わらないこと。
