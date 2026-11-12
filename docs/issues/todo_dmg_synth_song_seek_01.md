# DMG Synth：VGMシークバー（2026-11-13）

任意位置の音作りを見て、Pause中にその音色を試奏・Captureできるようにする。前回のPause試奏／Captureの変更は保持する。

- [x] VGM referenceに秒／frame単位の非同期seekを追加。再生中は移動後も再生、Pause中はPauseを保つ。停止状態からの明示seekは移動先でPauseし、自動再生しない。
- [x] 移動先まで音を出さずにAPU／parserを進め、移動先のPCMと全4CH snapshotを一致させる。Live Offでもseek完了時はその位置を表示する。共有WASM／VGM parserは必要な根拠なしに変更しない。
- [x] 先読みPCMと古いAudioBufferSourceを止め、試奏・Captureの所有を解放してからseek。Stop／新しいseek／source切替／Code開始／pagehideで古い処理を取消し、新しい所有者を触らない。
- [x] 曲一覧の下にコンパクトな位置barを追加。ドラッグ中はプレビュー表示、離した時にseek。キーボード操作と390pxを確認。処理中／位置を明示する。
- [x] Node／実WASMで前後seek、境界、PCM一致、Pause／Resume、CH／Wave RAM／Noise／Sweep、取消・競合、長い移動の協調yieldを検証。
- [x] 全出力を起動前からgain0へ遮断したheadless Chromium／WebKitで、Live・試奏・Capture・Code・seek競合を検証。通常ブラウザ／native app／OS音量は操作せず、実聴しない。
- [x] README／CI／可読配布ZIP／検証記録を更新。commit／push／公開は行わない。

今回はseekを先に追加し、checkpoint cacheやVGM loop繰り返しは別途検討する。位置の再現は実機APUを進めて行い、Wave RAMやEnvelope／Sweepの途中状態をregister再送だけで置き換えない。

完了：Node 147件（独立した実WASMシーク検証4件を含む）、無音Chromium／WebKitのシーク全7項目と既存Capture／Code／VGM再生／鍵盤の回帰を確認。1240px／390px目視と可読ZIPの全76 module／元input一致も確認済み。

- [検証記録](dmg_synth_song_seek_verification_01.json)
- 詳細ログ／画像：`build/verification/dmg-song-seek-20261113/`
- 配布候補：`release/tetorica_dmg_synth_dmg-song-seek-20261113_itch.zip`
- commit／push／公開は未実施。
