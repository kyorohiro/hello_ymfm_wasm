# SPU Synth：PSFの選択CHだけを聴く（2026-11-12）

- [x] 24CHを動作させたまま選択CHの出力だけを取り出す接続点を調べる。PMON変調元・Noise共有状態・ADSR・CPU／SPU RAMとregisterを変更しない。共有reverbの扱いと先読みPCMの切り替えを決める。
- [x] 必要なPSF player adapter／WASM／JS APIと再ビルド・sourcekit・互換性検証を整える。固定Native SDK本体は直接改変せず、対応が必要なら実装方針を記録する。
- [x] transportへ初期Offの「選択CHのみ」を追加し、CH切り替え・Pause／Resume・Live Off・Stop／曲変更・中断と先読みの整合を保つ。現在位置を飛ばさず、古いCHや全曲のbufferを誤再生しない。
- [x] コンパクトなチェックをCH選択の隣へ追加する。Tetoricaの試聴補助であることを既存「?」へ明記する。通常のPause試奏・Capture／Code・元の編集音色保持を維持する。
- [x] 自作PSF／Node／WASMで選択出力・PMON・Noise・reverb・全CH内部状態の不変性を数値検証し、Chromium／WebKitの無音headlessで切り替えと既存操作を確認する。
- [x] README／可読ソース付き配布ZIP／sourcekit／検証記録を更新する。commit／push／公開は行わない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。これは実機の音源設定ではなくTetorica側の試聴補助。音源の処理を止めるMuteと混同しない。

方式決定：固定SDKのファイルは変更しない。PSFビルド時だけSHA／挿入点を検証した一時コピーに読み取り専用tapを入れる。ABI 4の`psf_render_stems`で、元のfull stereoと24CH分のDry stereo（frame-major 48 floats）を同一passで得る。共有reverbはfull側だけに残し、全CH／CPU／RAM／registerの処理は同じ。各stemはvoice volumeとMain volume／SPUCNT muteを反映し、単独の空busとして飽和する。

JS coreは従来の`render()`を保ち、`renderWithVoices()`を追加する。transportはfull＋24CH raw stemを先読み分だけ保持し（標準で約2 MiB追加）、選択した1CHのAudioBufferだけを必要時に作る。24個のAudioNode／別SPUは作らない。切り替えは専用gainの短いfade後、同じ消費位置から未再生bufferを再配置する。先読みを再実行したり曲位置を飛ばさない。

旧ABI 3比較用factory／WASMを`/private/tmp/spu-psf-monitor-baseline/`へHEADから退避済み。新旧full PCMとCPU／SPU状態の一致、PMON／Noise／共有reverb保持を数値検証する。

完了：関連Node 478件成功（core 25／transport 44／共通fader 9件を含む）。旧ABI 3との10 fixture比較でfull PCM、CPU 2 MiB／SPU 512 KiB RAM、512 register views、trace／Gate／active／frame数が一致した。Playback／Live／Pause試奏の3系統が最終b ZIPでChromium／WebKitとも成功し、物理出力はgain 0、実聴なし。無音のPMON変調元CHのDry出力は厳密に0、carrierは非ゼロのまま。

切り替え後のフェードは新しいBufferSourceの開始時刻へ合わせ、Pause直後のResumeでも新しい入力時刻へ合わせ直す。先読み分をskip／再実行しない。配布sourcekitだけの再ビルドでfactory／WASMがbyte一致。固定SDK 476／Play provenance 158／同梱SPU 17ファイルも検証済み。

検証記録：[spu_psf_selected_channel_audio_verification_01.json](spu_psf_selected_channel_audio_verification_01.json)。配布ZIP：`release/tetorica_spu_synth_psf-selected-channel-20261112-b_itch.zip`（335 files、SHA-256 `115358401083319b54ef51d8b579fb4cbbebe90a4cf604110283651229e0c54e`）。
