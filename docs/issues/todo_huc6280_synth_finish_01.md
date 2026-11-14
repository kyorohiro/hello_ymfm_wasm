# HuC6280 Synth: finish the current product before expanding to another Synth

開始: 2026-11-13。ユーザーの方針は、S-DSPへの横展開より先にPC Engineの
HuC6280 Synthを仕上げること。FM2612／SPU／DMGと同じく、音を鳴らすだけでなく
「元の演奏を見る → 選択CHを試す → 編集・保存 → Codeで利用する」までを揃える。

## 現状

- [x] Wave／Noise／固定CH2→CH1のHardware LFO／ソフト供給DDA PCM。
- [x] 波形描画、Software Envelope、Pitch、音声入力、プリセット保存・読込。
- [x] VGM／VGZからWave／Noise／LFOペア／対応PCMの音色抽出。
- [x] 同一チップのKeyboard／Code、Files／Cassette、補完・実装表示・Software FX。
      [実装記録](todo_huc6280_synth_code_01.md)と
      [検証記録](verification_huc6280_synth_code_20261113.json)。
- [x] Tauri版の既存リポジトリは作成済み。
      `w/tetorica-huc6280-synth-tauri`はWeb 0.0.8を取り込み済み。
      今回のCode版を取り込んだ状態ではない。

## 残作業の順番

- [x] **VGMの模範演奏**: Filesの`vgm/`に元のVGM／VGZを保持し、曲一覧、
      Play／Pause／Resume／Stopを、既存モニターの上へ追加する。
      既存の音色抽出と区別し、読込だけで音やCodeを開始しない。
      VGM AnalyzerのHuC6280再生基盤とDMG／FM2612の操作を調べて再利用する。
      最初は単一HuC6280の対応範囲を明示し、別チップの音を黙って省略しない。
- [x] **同じUIでCHを見る**: 通常／Code／VGMで共通の
      `Synth · edit and play / CH1–CH6`選択を用意し、表示・設定・鍵盤の対象を揃える。
      CH表示は既存のWave／Noise／LFO／DDA操作を使い、自動更新をOn／Offできる。
      表示対象の変更だけで別CHの設定を統一しない。
- [x] **Pause中の試奏と取り込み**: 選択CHの音で鍵盤を試奏し、編集用Synthや
      Filesのプリセットへ取り込める。元曲のPause位置とResumeを保つ。
      Noise、LFOペア、DDAで再現できる設定・できない状態を区別する。
- [x] **CH別On／Off**: VGMのCH1–CH6を出力だけ切り替える。既存PCMと内部状態を保ち、
      Pause／Resume・Stop／Play・曲切替でも選択を保持。共有LFOを止めない。
      [実装TODO](todo_huc6280_synth_channel_mixer_01.md)。
- [x] **Seek**: 気になる位置へ戻り、再生／Pause・CH別On／Off・表示CHを保持する。
      Auto update Offでも目的位置を一度表示する。取消・失敗時は元の位置を保つ。
      [実装TODO](todo_huc6280_synth_seek_01.md)。
- [ ] **再構築キャッシュ**: 現在のSeekは先頭から再構築する。実WASMのNode計測で
      2分先が約4.3–5.9秒。native／parserの正確な状態を復元できる方式を調査する。
      生のWASM heapのコピーや、phase・Noise・DDA状態を無視したcacheは採用しない。
- [ ] **自動演奏＋手動操作**: VGMまたはCodeを動かしたまま同じCHを編集・発音できる。
      VGMとCodeの同時実行は行わず、手動操作だけがそれぞれに加わる。
      後の自動writeを優先し、古い離鍵・Pitch解除が新しい発音を消さない。
- [ ] **UI整理と配布確認**: Menu／Files／音色抽出／曲選択の入口、狭い画面、
      キーボードFocus、説明の折りたたみを確認する。読めるソースの独立ZIPで
      実WASM／Worklet、Chromium／WebKitを無音検証し、README・CIを揃える。
- [ ] Web版のまとまりを確認後、Tauriへ固定ZIPを取り込み、既存のMenu／Pin／
      保存・出力経路を確認する。公開・tag・pushは別のユーザー指示で行う。

各段階で、このTODOと検証記録を更新する。VGM再生の具体的なチップ所有・
観測・時刻管理は実装前に詰め、仕様が異なるDMGのコードをそのまま複製しない。
共有WASM／音量補正を変更する必要がある場合は、その理由と影響を記録する。

## 今回の完成条件に含めない拡張候補

CD-ROM² ADPCM／CD-DA、可変間隔DDAの音色抽出、圧縮bankの音色抽出、
Software morphは別の機能追加として扱う。上記の未完了項目を、これらの追加で
置き換えない。既存のSoftware FXはCodeで利用可能。

物理出力を鳴らさずに検証する。実聴・長時間試奏・実ゲーム比較は未実行なら
未実行と記録し、AIの配列計測で聴感確認を代替したとは書かない。

## 模範演奏の実装記録（2026-11-13）

最初の工程を実装・無音検証済み。[詳細TODO](todo_huc6280_synth_vgm_playback_01.md)、
[検証記録](verification_huc6280_synth_vgm_playback_20261113.json)。
次は同じUIでのCH Live表示。Pause中の鍵盤は現時点では編集中の音色を鳴らし、
選択CHの試奏／Capture・CH別On／Off・Seek・VGMへの直接操作は未実装。
Tauriへの固定ZIP取り込みと公開も未実行。

## 共通CH選択・VGM Live表示（2026-11-13）

実装・無音検証済み。[詳細TODO](todo_huc6280_synth_live_channels_01.md)、
[検証記録](verification_huc6280_synth_live_channels_20261113.json)。
通常CHは個別編集・鍵盤・Stop後の保持に対応。VGM CHは読み取り専用で、聞こえた位置を表示する。
次はPause中の選択CH試奏とCapture。現状ではPause中の鍵盤はSynth選択時の編集用音色のみ。

## Pause中のCH試奏・Captureと配置整理（2026-11-14）

[詳細TODO](todo_huc6280_synth_paused_capture_01.md)。既知Wave／Noise／CH1 LFOペアを
同じMasterへつないだ専用voiceで試奏し、Capture後も曲のPause位置を保つ。
取り込んだ音はSynthで編集し、Filesへ保存する。VGMのDDA値からPCMは推測しない。
Import VGMはMenuへ、Sounds from VGMとChannel／Auto updateはモニター上へ移動。
Wave／PCMの音量違いをまとめる機能を維持。CH別On／Off、Seek、VGMへの直接操作、
最終的なTauri反映は残作業。検証記録は今回の詳細TODOから参照する。

## CH別On／Off・共通操作のコンテナ整理（2026-11-14）

[詳細TODO](todo_huc6280_synth_channel_mixer_01.md)。VGM出力の6CH On／Offを追加し、
記録レジスタ・発振器・Noise・DDA・LFO・Live／Captureは維持する。
通常Synth／Code／Pause試奏とは独立。既存PCMを保ち、新しい出力設定はその先から反映する。
Channel／Auto update／CaptureはVGM・Play／Stopと同じコンテナにまとめ、
Sounds from VGMより上へ移した。音量違いをまとめる機能は維持。
次はSeekと再構築キャッシュ。VGMへの直接操作・最終Tauri反映は後続。

## Seek・再構築の計測（2026-11-14）

[詳細TODO](todo_huc6280_synth_seek_01.md)。ドラッグ確定時に別の音源を無音で目的位置まで
再構築し、成功した時だけ参照演奏を置き換える。再生／Pause、CH別On／Off、表示対象CH、
編集用音色を保ち、Auto update Offでも目的位置の全CHを一度反映する。
元のrunと未消費PCMは成功まで保持し、取消・失敗では元の位置へ戻す。
Escape／Cancel、連続Seek、Stop／Code Run／曲・project切替で古い処理を破棄する。
長い移動は数秒かかる。cacheは実測と正確な状態保存方式の検討を別の残作業にした。
