# SCSP Synth 最終出力接続の修正 — 2026-10-31

- [x] デフォルトPCMで発音してもスピーカーへ届かない原因を修正。
- [x] browser検証をworklet直後からVolume通過後のdestination入力へ移す。
- [x] PCM／FM、Volumeのmute→復帰、再接続をChromium／WebKitで確認。

`audio.js`でAudioWorkletNodeからVolume GainNodeへの`connect`が抜けていた。
生成済みPCM自体は正常だったが、スピーカーへの経路が切れていた。
旧browser検証はworkletへ独自analyserを接続していたため、この欠落を検出できなかった。
修正前の最終出力は無音で、初期和音の音声待機を通過しないことを確認した。
現在はアプリがdestinationへ送る信号だけを測り、その後をmuteして物理出力を抑える。
音声待機には15秒の上限も追加した。旧FM報告のraw-worklet測定は最終出力の証明にはならない。

検証：Node 11件成功。配布stageの両browser結果は[report](scsp_synth_output_fix_01.json)。
修正ZIP：`release/tetorica_scsp_synth_fm2-output-fix-20261031_itch.zip`
（1,177,807 bytes、SHA256 `47e011cbc36611d4ea3598f74b520415421b3bb3c6ed6d3df865cb63e98f4e43`）。
旧ZIPは保持。音量係数、core、Playground、npmは変更していない。公開・commitは未実施。
