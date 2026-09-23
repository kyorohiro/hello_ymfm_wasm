# YM2612 Playground：MIDI import の対応案

## 目的

MIDI ファイルを読み込み、パートと音色を選んで YM2612 Playground で再生できるようにする。
以下は設計案・未実装の TODO。既存の `play()` や物理 CH を指定する API の意味は変更しない。

まずは Standard MIDI File（SMF）の取り込みを対象とする。
外部 MIDI 機器の接続や MIDI Playground 全体の移植は今回の対象に含めない。

## 現在の API と実装の差

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

### 送り先・音色指定の採用方針（未実装）

```js
const lead = midi.output("tetorica-ym2612", { channel: 1 });
const bass = midi.output("tetorica-sega-psg", { channel: 2 });

await lead.setVoice(preset); // 既存の YM2612 Preset Object
// または FILES 内の音色ファイルを使用する
await lead.loadVoice("./lead.tfi");
await lead.play("C4", { velocity: 100, duration: 1 });
```

- [ ] `midi.output(destination, { channel })` を導入する。channel は MIDI CH 1–16 であり、物理 CH の予約ではない。
- [ ] YM2612 ハンドルの `setVoice(preset)`、`setVoice(bytes, { format: 'tfi' | 'vgi' })`、`loadVoice(path)` を移植する。
- [ ] 音色は次の Note On から適用し、発音中の音にはその音が開始した時点の音色を保持する。
- [ ] channel 省略時は既存仕様に揃え、YM2612 の音色設定は全16 MIDI CH、発音は MIDI CH1 とする。
- [ ] 音色設定と後続の Note On の処理順序を Worker 経由でも保証する。
- [ ] `loadVoice()` の相対パスは Run ファイル基準とし、TFI / VGI のバイナリアセット保存・カセット往復を確認する。
- [ ] ハンドルの `play()` の duration は MIDI Playground と同じ拍単位にする。既存の FM `play()` の秒単位とは区別する。

`setVoice` / `loadVoice` は YM2612 用。PSG に FM 音色設定を適用しない。
既存 Preset Object と TFI / VGI の変換処理を活かし、新しい音色形式は増やさない。
ブラウザー側の実装は既存 FM / PSG API へ接続する。
Native の Tauri 接続や SysEx 転送の仕組みをそのまま移植することは前提にしない。

参照：`w/tetorica-midi-playground/ui/playground-api.d.ts`、
`w/tetorica-midi-playground/docs/issues/midi_sysex_01.md`。
MIDI Playground の低レベル MIDI API は現状グローバル側にあり、ハンドルには
`play` / `setVoice` / `loadVoice` がある。ハンドルへの Note On / Off・CC 等の追加は別途設計する。

## 必要な改善

### 1. MIDI ファイル解析・時刻変換

- [ ] 対応する SMF 形式・時間単位を定義し、未対応形式を明示する。
- [ ] 複数トラックのイベントを統合し、同時刻のイベント順序を定義する。
- [ ] テンポ変更を反映して tick を再生時刻へ変換する。
- [ ] Note On / Off、Velocity を読み取る。Velocity 0 の Note On は Note Off として扱う。
- [ ] 不正なファイルや未対応イベントを診断できるようにする。

### 2. MIDI CH と物理 FM CH の分離

MIDI の１ CH にも和音が入るため、MIDI CH を物理 FM CH へ単純に固定対応させない。

- [ ] 発音ごとに物理 CH を割り当て、MIDI CH・音高・発音の所有権を管理する。
- [ ] 同時発音数を超えた場合の優先順位と、打ち切る音の選択方針を決める。
- [ ] 同音の重複、連打、割り当て直後の古い Note Off を正しく扱う。
- [ ] DAC 使用時の CH6 など、使用可能な FM CH の制約を反映する。
- [ ] 既存の `play()` やレジスタ直接操作と併用する場合の CH 所有権を決める。

### 3. MIDI の演奏状態

- [ ] Velocity を音色のキャリア構成に応じた音量へ反映する。
- [ ] Pitch Bend を発音中の音へ適用する。
- [ ] ベンド幅の扱いを定義する。固定幅で始める場合は制約を表示し、RPN 対応を別途検討する。
- [ ] CC7 Volume / CC11 Expression / CC10 Pan を反映する。
- [ ] CC64 Sustain と Note Off の保留・解除を実装する。
- [ ] All Sound Off / All Notes Off / コントローラーリセットを扱う。
- [ ] Modulation、Sostenuto、Channel / Poly Pressure は後続段階で検討する。

YM2612 のパンなど、音源の制約で MIDI の値をそのまま再現できない項目は近似方法を明示する。

### 4. 音色・パート選択 UI

- [ ] トラックと MIDI CH を確認し、取り込むパートを選べるようにする。
- [ ] パートの FM プリセットを手動指定できるようにする。
- [ ] Program Change とプリセットの対応表を後続段階で検討する。
- [ ] ドラムパートを識別し、初期段階では除外・手動指定など扱いを明示する。
- [ ] 発音数超過や無視したイベントを確認できるようにする。

Program Change の番号だけでは FM 音色は決まらない。
初期段階で GM 音色やドラムの完全再現を目標にしない。

### 5. 再生・停止・Worker 統合

- [ ] 既存のサンプル時刻指定スケジューラーへ接続する。
- [ ] 密なイベントでも画面更新や JS の待機時間に演奏タイミングが左右されにくい予約方式にする。
- [ ] Stop／Run 再実行で予約を破棄し、発音・Sustain 等の状態を解放する。
- [ ] Run in Worker の ON / OFF で同じ動作になることを確認する。
- [ ] 長い曲の全イベント・全レジスタ書き込みを無制限に展開しないよう、メモリと先読み範囲を検討する。
- [ ] 公開する API の型定義・補完・使用例を更新する。

## 推奨する実装順序

1. `midi.output()` と既存互換の音色指定、Note On / Off・Velocity・基本の発音割り当てを追加し、手書きコードで確認する。
2. MIDI import を接続し、パート選択・音色指定・テンポ変更に対応する。
3. 発音数超過・同音連打・Stop／再実行を含む再生の安定化。
4. Sustain・Pitch Bend・Volume／Expression／Pan。
5. Program Change の音色対応表、ドラム、その他の CC・Pressure。

基本の発音割り当てと停止処理は第１段階から必要。後続段階で複雑なケースを拡充する。
まず単旋律と簡単な和音で検証し、その後にテンポ変更・密な曲・実際の MIDI ファイルへ広げる。

## 検証項目

- [ ] 単旋律、和音、同音連打、重複ノート、同時発音数超過。
- [ ] 複数トラック、同一 MIDI CH を使う複数トラック、テンポ変更、同時刻イベント。
- [ ] Sustain 中の Note Off と Stop、ベンド中の新規発音と音の打ち切り。
- [ ] Worker 切り替え、再実行、曲終了後に音や予約が残らないこと。
- [ ] 既存の Playground サンプルと `play()` の挙動が変わらないこと。
