# Synth：Run中の音色読み込みでCodeを止めない（2026-11-13）

Files／Presetで音色を選んでも、CodeのRun・liveLoop・context・prepared state・FXを維持し、演奏中の共有sound chipへ新しい音色設定を反映する。DMGを起点にCode対応Synth（FM2612／SPU／SID）を確認する。

- [x] 各SynthのFiles選択／preset適用／Code owner・Stop復元を調査し、音色変更とproject／実行中Code差し替えの処理を分ける。
- [x] DMGでCode ownerを維持した音色適用を追加。Stop後も最後に選んだ音色とWave RAMが残り、古いnoteOffや非同期返信が新しい音色／Runを壊さないようにする。default CodeのSource取得をloop内へ移し、Pulse／Wave／Noise切替も次の発音から追従する。
- [x] SPU／SID／FM2612の該当経路も同じ方針へ揃える。shared runtimeの再Run／context消去やFX破棄を行わない。必要なサンプル差し替えによる保持音の停止は、CodeのRun停止とは区別する。
- [x] project置換・実行中JS削除／置換・明示Stop・曲の模範演奏開始など、本来の所有権切替は維持する。読込失敗／取消では現在の音色・演奏を守る。
- [x] Node／実WASMで設定とStop復元、遅延／競合／失敗を確認。全出力を起動前からgain0へ遮断したheadless Chromium／WebKitで、Run中の音色切替・loop counter／context／FX・次の実PCM・明示Stop・project置換を確認する。
- [x] README／CI／可読配布物／検証記録を更新。通常browser／native app／OS音量は操作せず、実聴・commit／push／公開を行わない。

演奏用の新しいルーティングや仮想voiceを追加せず、各Codeが明示したchip／physical CHの意味を保つ。公開chip API／WASMは根拠なく変更しない。


完了：DMG 190件・FM2612 522件・SID 230件・SPU 332件、計1,274件のNodeテスト成功。全出力を起動前からgain0へ遮断し、Chromium／WebKitで各Synthの配布物からRun中の音色選択を検証。DMGのPause試奏／Capture、SID／SPUの既存Code操作も回帰成功。Stop／再Runと遅延読み込みの競合を追加保護。

検証記録：[verification_synth_code_live_preset_20261113.json](verification_synth_code_live_preset_20261113.json)。詳細receipt／ログは `build/verification/synth-code-live-presets-20261113/`。SPUの通常コントロール編集は今回の音色読み込み対応と別で、従来どおりCodeを停止する。公開chip API／WASM／nativeは変更せず、commit／push／公開もしていない。
