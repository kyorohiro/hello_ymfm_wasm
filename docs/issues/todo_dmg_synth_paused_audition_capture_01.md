# DMG Synth：Pause中のCH試奏・Capture（2026-11-12）

曲で見つけた音を鍵盤で確かめ、編集音色へ取り込む。曲のPause位置・保持PCMと、元の編集音色を保護する。Pulse CH1／CH2、Wave CH3、Noise CH4の物理的な役割を維持する。

- [x] Pause snapshotから試奏／取り込み用の音色を検証・準備する。Pulse Duty／Envelope／CH1 Sweep、Wave RAM／level、Noise clock／Envelope、panを保持し、復元できない現在のEnvelope位相／Sweep進行は区別する。
- [x] Pause中の選択CHを鍵盤で試奏する。曲用APU・再生位置・先読みPCMを変更せず、元の編集音色も保存し直さない。CH切替・Resume・Stop・Code開始・source変更・pagehideで古い試奏を確実に止める。
- [x] Capture to Synthを追加する。曲はPauseを保ち、元の音色をFilesへ残して、新しい編集音色とpresetを作る。曲CH表示／編集用Synthを明示して切り替えられるようにする。
- [x] Noiseは音階を付けず同じclock／Envelopeで発音、SweepはCH1のみとし、keyboard／pitch／遅いnoteOffの所有を安全に切り替える。
- [x] Node／実WASMと無音headless Chromium／WebKitで、全CHの試奏・Capture・元音色保持・Pause継続／Resume位置・古い要求拒否・Code排他・Files round-trip・既存回帰・390pxを検証する。
- [x] 可読配布ZIP・README／CI・検証記録を更新する。

現在値の完全復元ではなく、その瞬間の送信／設定registerを再トリガーする。Captureは既存のDMG音色preset形式を利用し、曲のNote列・length counter・Envelope／Sweepの途中位相はpresetへ追加しない。

通常browser／native app／OS音量は操作しない。headlessは全destinationを起動前からgain0へ遮断し、Chromiumはmute指定。自作fixtureと実WASMで数値確認し、実聴しない。commit／push／tag／npm・itch公開は行わない。共有WASM／公開chip APIは必要が確認された範囲だけ変更する。

実装・検証完了。Node 133件と無音Chromium／WebKitの試奏・Capture全8項目が通過。既存VGM／Code／鍵盤の両engine回帰も通過。Capture取消のrollback中にCodeを開始する競合と、直後の再Captureを確認済み。

- 最終配布候補：`release/tetorica_dmg_synth_dmg-paused-capture-20261112-r2_itch.zip`
- [検証記録](dmg_synth_paused_audition_capture_verification_01.json)
- 詳細ログ／画像：`build/verification/dmg-paused-capture-20261112/`
- commit／push／公開は未実施。
