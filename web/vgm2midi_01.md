# VGM → MIDI 出力（第1段階）

更新日: 2026-09-08
状態: Analyzer の Export MIDI を実装済み。DAW での読み込み・ブラウザー操作は未確認。

## 目的

VGM の音符抽出結果を MIDI として保存し、DAW のピアノロールで確認・編集できるようにする。
量子化と MML の整形は後続段階。まず抽出した音符と元のタイミングを見える形にする。

## 使い方

1. VGM Analyzer を再読み込みして、YM2612 を含む VGM / VGZ を開く。
2. `Export BPM` に基準テンポを指定する（初期値120、自動推定ではない）。
3. `Export MIDI` で `.mid` を保存する。再生を開始しなくても書き出せる。

YM2612 の S98 は既存の VGM 正規化後に同じ経路を使う。
YM2203 / YM2608、RF5C164 単独など YM2612 を含まないファイルではボタンを無効にする。
従来の Export MML は非表示のまま。

## 出力仕様

- Standard MIDI File format 1、960 ticks / quarter。
- テンポ・説明のトラック1本と YM2612 CH1〜6 のトラック6本。
  MIDI チャンネルは1〜6を使用し、打楽器チャンネルへの割り当ては行わない。
- 元の44100 Hzサンプル時刻から絶対 tick に変換。拍のグリッドへの量子化はしない。
  テンポメタイベントに保存する整数値から tick を計算し、BPM を変えても
  秒単位の再生位置が tick 丸めの範囲で維持される。
- FNUM / BLOCK と VGM クロックから基準音高を推定し、最寄りの MIDI ノート番号にする。
- KEY ON / OFF に従って音符を作る。同じキーオン中の同音高への書き込みは連結し、
  KEY の打ち直しは別音符にする。同時刻の Note Off は Note On より先に出す。
- MIDI Program 0（GM 音源ではピアノ）、Velocity 100 固定。
  FM パッチを GM 音色へ変換しているわけではない。
- VGM 終端までの末尾の無音を保持し、鳴り続けたキーは終端で閉じる。
  VGM のループは展開せず1回分を出力する。
- 不明音高、MIDI 範囲外、tick 丸めで長さがなくなる音符は省略し、件数を表示する。
  制限と抽出時の警告は MIDI 内のテキストメタイベントにも保存する。

仕様確認先: [MIDI Association — Standard MIDI Files](https://midi.org/standard-midi-files)、
[Mido — MIDI files / tempo](https://mido.github.io/mido/files/midi.html)。

## 実装

- `docs/vgm_analyzer/vgm_notes.js`: 既存 MML の音符抽出部分を共通化。
  サンプル単位の開始・終了、浮動小数の MIDI 音高、KEY ID、パッチ ID を保持。
- `docs/vgm_analyzer/vgm_midi.js`: MIDI バイナリ出力。量子化処理を経由しない。
- `docs/vgm_analyzer/vgm_mml.js`: 共通の抽出結果を従来の量子化・MML 出力に渡す。
- `docs/vgm_analyzer/index.html` / `vgm_analyzer.js`: Export MIDI ボタン、BPM、保存処理。
- `scripts/package_itch_vgm_analyzer.sh`: 新規モジュールを配布に含める。

## 確認

```sh
node --test docs/vgm_analyzer/vgm_midi.test.mjs docs/vgm_analyzer/vgm_mml.test.mjs docs/vgm_analyzer/vgm_mml_music.test.mjs
```

計15テスト通過。MIDI バイナリを別の読み取り処理で再解析して、ヘッダー・
トラック長・可変長 delta・テンポ・Note On/Off・トラック終端を確認。
同音の打ち直し、別チャンネル、音高変更、末尾無音、BPM 変更時の実時間、
グリッド外の時刻、非対応音符・警告を確認。共通化後の既存 MML テストも通過。

## 制限・次の段階

- [ ] DAW で MIDI 読込、ピアノロール、再生を確認。
- [ ] 実曲でキー・音高の抽出品質を確認し、必要なら抽出部分を改善。
- [ ] Pitch Bend。現在は半音単位の別音符として表現し、滑らかなベンドは再現しない。
- [ ] 音量・パン・音色マッピング。
- [ ] YM2203 / YM2608 の FM 対応、PSG / PCM の扱い。
- [ ] MIDI 読込 → 量子化 → MML 出力。

現状では部分 KEY、CH3 特殊モード、DAC モードの音高は不明として省略。
FM オペレーターの倍率・デチューン・LFO・リリース音長も再現しない。
音源の忠実な再生ではなく、通常 FM 音符の抽出結果を編集するための出力。
