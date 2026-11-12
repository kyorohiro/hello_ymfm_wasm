# SPU／S-DSP：波形編集時の保持音継続（2026-11-12）

- [x] SPU full-sample ADPCMとS-DSP Wave／BRRの停止経路、共有sample／private slot、decoder cache・先読み・Echo・PMONとUI所有者の関係を確認する。
- [x] 長さ・loop・tuning・routingを変えない波形編集について、再生位置・envelope・保持／Releaseの所有者を維持する方式を決める。単なるKey Onし直しは使わない。初回private slot移動と既存bankの不変性も解決する。
- [x] SPUの長いサンプル編集へ適用し、通常鍵盤・Code・Pause中Synth編集と後続Key Up／Stop／失敗・取消・RAM不足を検証する。
- [x] S-DSPの波形編集へ適用し、carrier／PMON modulator、Echo履歴・nativeFrames／generation・Release・無効／終了済みvoiceを検証する。
- [x] 実WASMの数値回帰とChromium／WebKitを無音で確認する。全destinationをアプリ起動前にgain 0へ通し、Chromiumはmute指定。
- [x] help／README／cache revision・配布ZIPを更新し、検証記録と残る制限を残す。

前段: [FM2612／HuC6280対応](todo_pcm_wave_edit_held_notes_01.md)。今回はSPU／S-DSPが対象。SCSPの「保持音は旧PCM、次の発音から新PCM」は変更しない。

通常browser／native app・音声デバイス・OS音量は操作しない。ゲームPCM／RAMを保存・配布しない。commit／push／公開は行わない。まず既存の固定core／公開APIで成立する方式を確認し、必要性がない限りshared runtime／DSP／WASMの変更は行わない。

採用方式:

- SPU: 初回編集は再生中の物理アドレスAを維持する。元ADPCMを退避先Bへcopyし、元のimmutable sample IDをBへ付け替え、新しいprivate編集IDをAへ割り当てる。原音は元ID／元bytesで取得でき、VABのsample ID cacheは維持する。生の物理アドレスsnapshotは過去の値となる。同じ長さの既存private slotを安全に再利用できる場合は退避先に使い、元と同じRAM予算で繰返し編集する。register／KON／KOFF／resamplerをresetしない。固定coreのloadRamは全decoder cacheを再構築してplay offsetを保つため、既存の直接RAM更新を数値oracleにする。既に復号した先読みの継ぎ目はあり得る。Code中の作者編集は従来のStop／checkpoint復元を維持し、失敗前にCodeを止めない。
- S-DSP: 描画できる128点Wave（carrier／PMON modulator）の固定72B BRRだけを、同じsample slotへ上書きする。source／loop／tuning／routing／Echo配置は固定し、DSPの予測履歴・Envelope・Echo ring・generation／nativeFramesを保持する。次のBRR block fetchから新bytesを使う。読み込んだBRRは既存のread-only previewのまま。新規loadや構成変更は従来の置換処理を維持する。

完了: [検証記録](spu_sdsp_wave_edit_held_notes_verification_01.json)。`npm run test:spu-synth`326件、`npm run test:snes-synth`110件成功。SPU実WASM60件には44100／48000Hz・PMON＋Room・native Releaseの直接RAM更新とのbit一致、全register不変、原音保持・旧decoderを隠す次回Start設定・失敗時復元を含む。S-DSPはCarrier／Modulator／両方のWave、Echo履歴、Release・無効voice・dormant draftを確認。

Chromium／WebKit双方でSPU full-sample編集とS-DSP Wave編集の全チェック成功。元のKey Upで解放し、保存・再読み込み・取消と既存回帰も成功。SPUのCodeは従来どおり作者編集時にStop／checkpoint復元する。今回のCode継続を保証する変更ではない。

追加の既存PSF Capture checkerも両browserで成功。Pause位置／entry／frame／buffer予約を維持したfull-sample編集、凍結CH表示、CH→Synth切替後の編集音色保持、Resume／Stopまで確認済み。Capture／Noise／Code復元／容量ガードも成功。

配布ZIP: `sh scripts/package_itch_spu_synth.sh wave-held-20261112`（342 files）、`sh scripts/package_itch_snes_synth.sh wave-held-20261112`（62 files）。変更したreadable module12件が元bytesと一致し、S-DSPのroot entry書換えはcache queryを保持する。shared runtime／DSP／WASM・SDK0.1.7を変更せず、再ビルド・公開はしていない。
