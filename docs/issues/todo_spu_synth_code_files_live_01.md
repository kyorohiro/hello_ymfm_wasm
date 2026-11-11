# SPU Synth：Code・Files・Live表示（2026-11-11）

FM2612／SIDの構成をPCM系へ展開する。現在のSPU・音色・Master・monitorを共有し、`useSoundChip("ps1")`から既存APIで明示的な物理CHを操作する。新しい演奏helper、Looper／Event Rec、npm公開は含めない。

- [x] 既存SPU API／Worklet／音色・sample所有権を調査し、Codeの開始・終了と編集状態の境界を決める。
- [x] 同じSPUを借りる非同期Code endpointを追加する。Run／Apply／Stop、古い要求の拒否、出力fadeと編集音色の復帰、Noise／PMON／長いAudioを維持する。
- [x] 既存共通runtimeとKeyboard／Codeタブ・Monaco・最大化・Files・ローカル保存／project入出力を接続する。保存データの復元だけでは音を鳴らさない。
- [x] SPU用の型・補完・可読APIソースへの移動、既定index.js、`liveLoop`／`livePrepare`／`tween`／`liveFx`を整える。
- [x] Codeの選択CHを既存PCM／ADSR／FX UIでLive表示する。既定On・Off可能・上限20Hz・同時1要求とし、観察で保存音色を書き換えない。
- [x] Node／WASMと無音headless Chromium／WebKitで、既存鍵盤・Code・Files・Live・Stop／pagehide・モバイル幅を検証する。
- [x] 可読ソース付き配布ZIP、cache／README／検証記録を更新する。commit／push／tag／公開は行わない。

実音は出さない。通常browser／native app／OS音量は操作しない。headless確認はアプリ実行前から全destinationをgain0へ遮断し、Chromiumはmuteを併用する。既存ファイル・presetを勝手に置換しない。

## 実装の境界

- Codeは同じSPUの物理0–23を使用する。鍵盤のround robinは流用しない。既定indexは現在のsample／ADSR／reverbで発音し、PMON時は最初のcarrierであるCH2を選ぶ。
- Runごとの固定RAM／descriptor checkpointでCode中のupload／clear-RAMを分離する。Stopは出力fade後に元のsample ID／PCM／ADSR／reverb／Noise／PMON／Morphへ復帰する。長いhost PCMは共有し、Runや観察で録音全体をコピーしない。
- Liveは既存PCM／ADSR／FXを読み取り専用で表示する。CH切替は観察先だけを変更し、Live OffではCodeを継続して編集表示へ戻る。編集の実行や別instrument読み込み時は先にCodeを停止する。
- Filesはコード・module・opaque dataを独立保存し、起動時の復元だけではaudioを取得しない。Save soundだけが編集instrumentを`/presets/current.spu.json`へ保存する。projectは共有cassetteの16 MiB上限を維持し、大きいSoftware audioは既存Save presetを利用する。
- SPU用の共通Monaco source mappingを追加。自然な`const sample = await ps1.loadADPCM(...)`が共通Files preambleと衝突するTDZもscope分離で修正し、元hostのsample／MIDI file adapterと相対moduleを維持する回帰を追加した。
- 従来の無音回帰が検出したStop後monitor再wakeを修正。停止時は観察状態の復帰だけを行い、明示的に止めたanalyserを再起動しない。

## 完了記録

- Node／WASM／型・補完／shared Files回帰132件成功。
- 最終ZIPでChromium／WebKitのCode・Files・Live各7項目、実Monaco各5項目成功。PS1のみの補完、物理23の許可／24の拒否、可読API／runtimeへの移動、1240px／390pxの最大化・通常Live表示を確認。
- 従来のfull SPU browser回帰も両engine成功。24 voices・安全なsteal、PCM／WAV／preset、20 MiB Audio、VAB／PSF、Noise／PMON／Morph、monitorのStop／idle／wake、音源エラー後の明示的再起動まで確認。
- Code Liveは250msで5回／4回、実WorkletのFX出力・Master・Stop fadeを無音PCM測定。全destinationを起動前からgain0へ遮断し、実聴なし。
- ZIP：`release/tetorica_spu_synth_spu-code-files-live-final-20261111_itch.zip`（139 files、6,049,456 bytes、SHA-256 `ac81004e222f48c09b7ccc033c0f67b8060f379075e8b83291b8b7852baf74b8`）。JS／CSSは可読moduleを維持、minify／bundleなし。内包ソース106入力は現行repoと一致し、SPU固定Native SDKの整合も確認。
- 詳細：[検証記録](spu_synth_code_files_live_verification_01.json)。commit／push／tag／npm・itch公開なし。
