# DMG Synth：VGM模範演奏・CH Live（2026-11-12）

FM2612／SPUと同じく、手元の曲を聴きながら音源の設定を既存Synth UIで追えるようにする。まず曲一覧・Play／Pause／Resume／StopとCH1〜4のLive表示を実装する。Pause中の鍵盤試奏／Capture、seek、Looper／Event Recは次の段階とする。

- [x] 既存VGM parser／player／Game Boy APU audio engineと、FM2612の音声時刻に合った曲Live表示を調査する。
- [x] DMG専用VGM／VGZの検証・曲再生と送信register timelineを実装する。buffer先読みではなく、実際に消費している音声位置のCH状態を表示する。Pause／Resumeは位置を保持し、Stop／エラー／取消／pagehideで遅い処理を無効にする。
- [x] Files `/vgm`への保存・既存Importとの連携、曲一覧とコンパクトな再生操作をmonitor上へ追加する。選択・読込・project復元だけでは音を鳴らさず、元の編集音色を保持する。
- [x] 同じPulse／Wave／Noise UIへ曲CH Liveを接続する。Code・鍵盤・曲の音声所有を切り替え、Master／monitorを共有する。Liveは既定On／Off可能、Pause中は表示を保持し、Stopでは編集画面へ戻す。
- [x] Node／実WASMと無音headless Chromium／WebKitで、再生位置・Pause／Resume・4CH Live・後着処理／不正入力／Code切替・Files永続化・既存鍵盤／VGM抽出・390pxを検証する。
- [x] 可読ソース付き配布ZIP・README／CI・検証記録を更新する。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前に全destinationをgain0へ遮断し、Chromiumはmute指定。ゲームの配布物を追加せず、自作register fixtureで検証する。commit／push／tag／npm／itch公開は行わない。WASM／共通再生基盤は、必要性を確認した範囲だけ変更する。

## 完了記録

- 既存 `VgmPlayer` / `GameboyApuAudioEngine` / APU WASMを再利用した。WASM・共有parser・公開GameboySynth APIは変更していない。
- 元VGM／VGZをFiles `/vgm`へ衝突回避で保存。選択・復元ではaudioを取得せず、検証済みsourceへの明示Playだけが別reference APUを準備する。不正／取消sourceは旧曲・編集音色を保持する。
- Play／Pause／Resume／Stop／EOF、4CHのaudible-position Live、Offで全CH Freeze、Pauseの正確なsnapshot、Codeとの相互停止を接続。Source balance .28とMasterを一度ずつ通し、既存monitorへ出す。
- Node／実WASM／型／Files／配布110件成功。実WASMのPCM一致と39689→39690 frameのLive境界を検証した。
- 最終ZIPでChromium／WebKitの新Song7項目、既存keyboard／音色／VGM抽出とCode／Files／Liveの回帰も成功。先読み漏れなし、Master半分でRMS約半分、Pause／Resume保持、遅延WASMのStop→新Code保護、local restore無audio、390px、pagehideでcontext閉鎖・source解放を確認。実音は出していない。
- 配布ZIP: `release/tetorica_dmg_synth_dmg-vgm-song-live-20261112_itch.zip`。123 files／1,810,452 bytes、SHA-256 `4133b2c9d4f451c0702fc1e78de20c8503ea343054985780d19f950a970e30ac`。可読module74件は最終workspaceとbyte一致。必要なAPU／既存FXのみを同梱。
- 対応範囲は単一4194304 Hz DMGのdirect register／通常wait。共有parserが未対応のDAC stream 0x13・data block等は再生前に明示拒否する。Pause中の試奏／Capture・seek・繰り返しloopは次段階。
- README／CI／package検証を更新。commit／push／tag／npm・itch公開なし。詳細：[検証記録](dmg_synth_vgm_playback_live_verification_01.json)。
