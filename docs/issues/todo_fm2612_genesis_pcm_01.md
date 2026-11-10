# FM2612 / Genesis Synth：Mega CD PCM基本演奏（2026-11-10）

ユーザー指示：既存RF5C164を使い、内蔵波形・WAV読み込み・Loop範囲・Pan・Pitchを、従来と同じUIと共通鍵盤で演奏できるようにする。

- [x] 既存RF5C164 Synth／Worklet／PCM encoderを再利用し、64 KiB RAM・0xff終端marker・256-byte aligned start・16-bit step・volume／左右4-bit panを正しく扱う。共有DSP／WASM／校正値は変更しない。
- [x] PCMタブを実画面にし、内蔵波形／WAV、波形表示、Loop On／Off・Start／End、Root note、Volume／Panをコンパクトに配置する。±／drag操作と文字鍵盤focusを維持する。
- [x] 共通鍵盤から8 physical CHをround robinで演奏し、Pitch／Octave／Masterを共有する。既存FMは6CH、PSGは3Tone／1Noiseのままにする。
- [x] WAVをmonoの8-bit sign-magnitudeへソフトウェア変換し、markerをデータへ混入させない。64 KiBへ収めるsoftware resamplingは明記し、不正／取消／遅延した読込で元の音を壊さない。
- [x] PCM音色を自己完結の読みやすい`.pcm.json`へ保存し、既存Files／Sync／Revert／Cassette／復旧と3音源の独立contextを接続する。
- [x] PCMのVGM音色取込／Live表示・Event Rec／Looperは次の段階へ残し、未対応操作でFM音やFMファイルを誤操作しない。
- [x] 引き続き無音でNode実WASMと全speaker接続を事前muteするheadless Chromium／WebKitだけを使い、実PCM・loop／one-shot・8CH・gain・WAV・保存復旧・既存FM／PSG回帰を確認する。
- [x] README／cache key／配布ZIP・再開記録を更新する。通常browser／native app、会議アプリ／OS音量は操作せず、commit／push／公開は行わない。


## 実装記録

- `synth_pcm.js`：既存RF5C164 coreに対する音色・RAM・8CH演奏adapter。`.pcm.json`は波形のbase64と全設定を含み、元WAVなしでも再利用できる。共有SDK／DSP／WASM／System補正値は変更なし。
- `synth_pcm_audio.js`：既存Workletと共通AudioContext／出力を利用するlazy接続。RAM転送の完了を待って鍵盤を有効化し、古い転送や出力切替で発音しない。System PCM補正×Masterは一度だけ適用。
- `synth_pcm_controls.js`：Sine／Triangle／Saw／Square、Load WAV、Volume、左右Pan、Root note、Loop On／Off／Start／End。数値は既存と同じ±／左右drag。Sample canvasでもStart／Endをdragでき、Waveform／Spectrumへ切替可能。説明は「?」へ収納。
- WAVはRIFF WAVを最大64 MiBまで受け付け、monoの8-bit sign-magnitudeへソフトウェア変換する。RAMを超える場合は時間長を保ってsample rateを落とし、Software resamplingと表示する。WAVの初期値はLoop Off。全音が同じサンプルを共有する。
- サンプル上限は65,503 frames。最大stepでも古いRAMへwrapしないよう、残り33 bytesを0xff終端guardにする。Loop Offはmarker→markerの無音経路を使う。Loop End／サンプルの変更は全発音を止めてRAMを再転送する。
- 初期の実機Volumeは64／255。8音同時のSineでも内部clipしにくい値にした。音量上限255とMaster 380%は維持し、出力側の補償倍率は追加しない。
- FilesはFM／PSG／PCMごとの編集contextを保持する。PCMの最大長サンプルも復旧できるようPCMだけ384 KiBのjournal上限を用い、FM／PSGの128 KiB上限は維持する。
- WAVの遅延完了が新しい波形選択を上書きせず、不正WAV／JSONでも現在音を保持する。RAM再転送は読み込み完了の表示を上書きしない。

## 無音検証（2026-11-10）

- `node --test --test-concurrency=1 docs/synth/*.test.mjs`：313件成功。実WASMの8CH、Pan／Pitch／Root、Loop／One-shot、最大step／RAM境界、8音のheadroom、保存・復旧を含む。
- `scripts/check_synth_pcm_browser.cjs`：Chromium／WebKitで配布stageを検証。全speaker接続をページ実行前からgain 0へ迂回し、Chromiumは`--mute-audio`も併用。実出力を数値配列で測定した。人による実聴は未実施。
- ブラウザでは8CH／9音目steal、System／Masterの倍率、左右Pan、Pitch、Loop drag、WAV One-shot／Loop、3秒WAVのRAM fit、不正／遅延WAV、PCM JSON、Sync／Revert、混在Cassetteの元データ保持、dirty reload復旧を確認。FM6CH／PSG Tone3CHと出力経路の差替えも成功。
- FMの特殊CH3／部分OPに対するLooper／Event Rec回帰も、完全muteしたChromium／WebKitで成功。
- 幅1240／390 pxの配置と横overflowなしを確認。page error・外部通信・欠落assetなし。
- `sh scripts/package_itch_synth.sh pcm-editor-check-20261110`成功。ローカル参照333件。ZIP内239 filesはstageと全byte一致し、ブラウザが取得した117 assetsのhashもZIPと一致。
- ZIP：`release/hello_ymfm_wasm_pcm-editor-check-20261110_itch_synth.zip`（901,118 bytes）。SHA-256：`6521c37cd1173b0ad5b3346965fed0a3f3fb9584f724e4518dbf8ba633164e34`。
- 一時検証記録：`/private/tmp/fm2612-pcm-node-20261110.log`、`fm2612-pcm-editor-source-20261110.json`、`fm2612-pcm-editor-package-20261110.json`、`fm2612-pcm-fm-recording-20261110.json`、`fm2612-pcm-package-proof-20261110.json`。画像：`/private/tmp/fm2612-pcm-editor-package-20261110/`。
- commit／push／公開はしていない。通常browser／native app・会議アプリ・OS音量は操作していない。

再検証の例（Playwright Chromium／WebKitを事前に用意する）：

```sh
node --test --test-concurrency=1 docs/synth/*.test.mjs
sh scripts/package_itch_synth.sh pcm-editor-check
node scripts/check_synth_pcm_browser.cjs --root=release/itch_synth_pcm-editor-check --entry=/index.html
```

## 次の段階

- [ ] 人による実聴：内蔵波形／WAV、Loop境界、Pitch範囲と8音演奏の使い勝手。
- [x] VGMのRF5C164音色・サンプル取込とPCM各CHのLive表示／Pause試奏／Copy：[Live作業記録](todo_fm2612_genesis_pcm_live_01.md)で実装・無音検証済み。上記のPCMタブ無効化は基本演奏を追加した時点の記録。
- [ ] PCM Event Rec／Looper。現段階では操作を無効化し、FM／PSGの録音データを変更しない。
- [ ] PWMタブの基本演奏。工事中表示を維持する。
