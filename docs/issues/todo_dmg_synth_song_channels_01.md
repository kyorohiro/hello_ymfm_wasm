# DMG Synth：VGM再生CH別On／Off（2026-11-13）

CH1 Pulse＋Sweep／CH2 Pulse／CH3 Wave／CH4 Noiseを個別に聴き分ける。4つの小さなOn／Offボタンを曲の操作欄へ置き、実機設定を変えないソフトウェアの試聴muteだと区別する。

- [x] VGM referenceだけの出力maskを追加。初期値は全CH On、読み込み前にも設定でき、Stop／曲変更／seekでもセッション中は保持する。Files／音色JSONには保存しない。
- [x] 既存APUのchannel muteを使い、曲のregister・Wave RAM・Envelope／Sweep／Noiseの進行や再生位置を変えない。既に先読みしたPCMは順に消費し、新設定は次の生成から反映する。短いbuffer分の遅延をhelpで説明し、不正なqueue破棄／再発音／全曲seekを避ける。
- [x] 作成中／seek中のAPUにも最新maskを適用し、古い非同期要求が新しいOn／Offや曲を上書きしないようにする。
- [x] Live／Pause試奏／Captureは元のCH設定を利用する。OffのCHも観察・鍵盤試奏・保存でき、編集用SynthとCodeの出力にはmuteを持ち込まない。
- [x] コンパクトなボタンにCH名とOn／Off、aria-pressed、keyboard操作、focusを用意。390pxでも収まり、既存Menu／Files／seekを保つ。
- [x] Node／実WASMで全16mask、全Offの無音、Onへ戻した時の位相・設定保持、先読みの反映境界、Pause／Resume／seek／source競合を検証。全出力gain0のheadless Chromium／WebKitで操作・実PCM・試奏／Capture／Codeと既存回帰を確認する。
- [x] README／CI／可読ZIP／検証記録を更新。通常browser／native app／OS音量は操作せず、実聴・commit／push／公開をしない。

CH選択（Live／鍵盤試奏対象）と、曲で聴くCHのOn／Offは独立する。CH別Volume、Solo、Looper／Event Rec、公開API／共有WASMの変更は今回の対象外。

完了：Node 175件（独立した実WASMの全16mask／位相／先読み境界など5件を含む）、無音Chromium／WebKitのCH全7項目と既存Song／seek／試奏・Capture／Code／Menu／keyboard回帰が通過。全Off RMS／peakは両engineとも0。1240px／390px目視と可読ZIPの全77 module／元input一致も確認済み。

- [検証記録](dmg_synth_song_channels_verification_01.json)
- ログ／画像：`build/verification/dmg-song-channels-20261113/`
- 配布候補：`release/tetorica_dmg_synth_dmg-song-channels-20261113_itch.zip`
- commit／push／公開は未実施。
