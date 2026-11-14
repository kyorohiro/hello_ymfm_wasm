# HuC6280 Synth: paused CH audition / Capture and compact reference UI

開始: 2026-11-14。[仕上げTODO](todo_huc6280_synth_finish_01.md)の次工程。

- [x] Pause中の選択CHを、曲とは別の試奏用voiceで鍵盤から鳴らす。
      曲のnative状態・消費位置・未消費PCMを保ち、Resumeで続行する。
- [x] 既知Wave／Noise／固定CH2→CH1のLFO設定を取り込む。
      不明Wave、無効period、未取得のDDA sample等は理由を表示し、音色を推測しない。
      LFOの変調側と可聴CH2の扱いを明示する。
- [x] Capture to Synthで通常の単一音色presetへ取り込み、Filesへ保存可能にする。
      Capture後も曲はPauseのまま、選択をSynthに戻す。CH表示へ戻すと元曲の状態を表示する。
      取り込み失敗・遅い結果・Stop／曲切替／Code Run／workspace置換を安全に処理する。
- [x] Import VGM / VGZをハンバーガーメニューへ移動する。
      メニューを閉じた後も音色一覧・取込状態・キャンセルは操作できる。
- [x] 曲一覧 → Sounds from VGM → Channel / Auto update → Waveform / Spectrum
      の順でモニター上へ配置し、FM2612／SPUの操作位置へ揃える。
      Wave / PCM: keep loudest volume variantは機能・状態・再選択時の挙動を維持する。
- [x] 実WASM・所有権・Pause／Resume・Capture保存・不正／不明状態と、
      通常／Code／VGMの既存機能を確認する。独立ZIPをChromium／WebKitで無音検証する。
- [x] README／CI／検証記録・仕上げTODOを更新する。commit／push／公開はしない。

今回もVGM再生中の直接編集、Seek、CH別On／Off、DDAの動的サンプル復元は含めない。
実聴・実ゲーム比較は未実行なら未実行と記録する。ユーザー保存・物理出力は触らない。

## 検証完了（2026-11-14）

[検証記録](verification_huc6280_synth_paused_capture_20261114.json)。Node 341/341、
独立ZIPのChromium／WebKit全5スイートで122/122項目成功。1240px／390pxを画像確認済み。
WASM／SDK／Master補正は変更なし。実聴・実ゲーム比較・長時間動作は未実行。

確認手順: Menu → Import → VGM / VGZ… → Play → Pause → CH選択 → 鍵盤で試奏。
Capture to Synthで編集用音色へ取り込み、必要ならSave to Filesで保存。
曲はPause位置を保ち、Resumeで再開する。Captureだけではファイルは増えない。

次は仕上げTODOのCH別On／Off・Seek、続いてVGM自動演奏＋手動操作。
Tauriへの固定ZIP反映・公開はまだ行っていない。
