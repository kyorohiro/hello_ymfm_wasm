# FM2612 / Genesis Synth：PCM VGM Live・Pause試奏・Copy（2026-11-10）

ユーザー指示：既存FM／PSGと同じ流れで、Mega CD PCMのVGM Live表示→Pause中の選択CH試奏→Synthへコピーを進める。UIをコンパクトに保ち、無音で作業・検証する。

- [x] RF5C164の元レジスターとbanked RAM書込を、先読みではなく聴こえる位置に合わせて追跡する。Seek／cache／Pause／Live Offでも同じ時点の状態を表示する。
- [x] PCMタブでCH1〜CH8とSynthを切替可能にし、既存のSample／Waveform／Spectrumと設定UIで波形・Volume・左右Pan・step／再生速度・start／loop addressをread-only表示する。変更ハイライトも既存On／Offに従う。
- [x] Pause中は別のPCM endpointへ取得したサンプルを転送し、選択したphysical CHで鍵盤試奏する。曲／編集中音色／RAM／元VGMを変更せず、Resume／Seek／CH切替で止める。
- [x] Copyでサンプルと設定を新しい`.pcm.json`へ保存する。動的RAM書換え等の曲プログラムは単一音色へ復元できない旨を説明し、不完全／境界をまたぐ／終端不明などの未対応snapshotは理由付きで安全に拒否する。
- [x] PCMを見ている間は編集中のFM／PSG／PCM contextを保持し、Synthへ戻ると復元する。既存FM／PSG Live／Copy・録音機能を回帰確認する。
- [x] Node実WASM／headless Chromium・WebKitの全speaker接続を事前muteして検証。通常browser／native app／会議アプリ／OS音量は操作しない。
- [x] README／cache key／配布ZIP・再開記録を更新する。commit／push／公開はしない。

PCM Event Rec／LooperとPWM基本演奏は別のTODOとして残す。


## 実装メモ

- `synth_song_pcm_state.js`は8CHレジスター・global enable／active-low mask・4 KiB RAM window／bank ORを追跡する。先読みで生成したRAMをそのまま表示せず、聴こえるframeまでの元書込だけを適用する。MixのMute／Pan上書きより外で観測する。
- sample RAM／known mapは変更時だけ不変snapshotを生成し、レジスター変更や時刻の進行では再コピーしない。隣接するRAM stream書込はまとめ、消費済みの待機イベントを捨てる。Seek cacheはRAM／knownと未消費書込を含む。native resetがRAMを保持する点にも合わせる。
- `synth_song_pcm_voice.js`は現在のstartから既知の連続サンプルと0xff終端を抽出する。上限65,503 framesと再生stepに応じた終端guardを検証し、Loopが範囲内か、既知の0xffへ向かうOne-shotかを判定する。未知RAM・wrap・範囲外Loop・unsafe markerは理由を返す。
- 同じRAM／start／loopの再走査とbase64再生成を避ける。Live表示は元音色の設定を書き換えない。サンプル不明時はcanvasを理由の表示へ切り替える。
- CH1〜CH8／Synthは既存のCH selectへ統合。Live既定On／Off固定、Pauseの正確な時点、Seek、変更ハイライトOn／Offを共通操作で扱う。
- PCMの同じcanvasと数値UIを使い、Live時だけRoot noteをhardware Playback stepへ切り替える。Sampleの横軸は取り出したサンプルの相対frame、下のLoop／Endは元RAMの絶対addressを表示する。元の音程は推定しない。
- Pause試奏は独立したRF5C164 endpointでRAM ACKを待って有効化する。選択physical CHだけを使い、Resume／Seek／CH切替で入力・発音を止める。曲、編集中PCM bank、FM／PSG音色には書き込まない。
- Copyはguard付き自己完結`.pcm.json`を新規保存する。Root note C4を取得時の再生速度へ割り当てる。後続のRAM書換えやゲームプログラムのEnvelopeは単一snapshotから復元しない。
- PCMを含まない曲など、snapshotがない場合もLive観察から抜けると元の編集中音源へ戻す。PCM Event Rec／LooperとPWMは今回の範囲に含めない。

## 検証

- `node --test --test-concurrency=1 docs/synth/*.test.mjs`：331件成功。実WASMのsourceとCopyのPCM一致、One-shot／Loop、選択CH、RAM／bank、Pause／Seek／cache、元RAMの保持を含む。
- 通常PCM編集の回帰：`scripts/check_synth_pcm_browser.cjs`を配布stageのChromium／WebKitで実施し、WAV／8音／gain／Files／Cassette／復旧／FM6CH／PSG3CHと欠落PCMからの復帰が成功。
- 一時記録：`/private/tmp/fm2612-pcm-live-node-final-20261110.log`、`fm2612-pcm-live-editor-regression-20261110.json`。通常browser／native app／会議アプリ／OS音量は操作していない。

再検証：

```sh
node --test --test-concurrency=1 docs/synth/*.test.mjs
sh scripts/package_itch_synth.sh pcm-live-check
node scripts/check_synth_pcm_browser.cjs --root=release/itch_synth_pcm-live-check --entry=/index.html
node scripts/check_synth_pcm_live_browser.cjs --root=release/itch_synth_pcm-live-check --entry=/index.html
```


最終確認：

- `scripts/check_synth_pcm_live_browser.cjs`が配布stageのChromium／WebKitで成功。聴こえる位置より未来のVolume／Panを表示しないこと、Live Off／On、RAM patch、前後Seek、選択CHだけの試奏、RAM ACK、再生速度／Pan、Resume／Seekでの停止、CH8の512 bytesをそのままCopy、元FM／PSG／PCM／VGMの全byte保持、欠落RAM／PCMなしの理由表示・元音源への復帰を確認した。
- 通常編集の回帰とLive検証はともに全speaker接続を初期scriptでgain 0へ迂回した。Chromiumは`--mute-audio`も指定。音声の数値配列を測定し、人による実聴は行っていない。
- 1240／390 pxの画像を確認し、横overflowなし。page error／外部通信／欠落assetなし。
- ZIP：`release/hello_ymfm_wasm_pcm-live-check-20261110_itch_synth.zip`（909,850 bytes／241 files）。stageと全byte一致。通常編集・Live両検証の各119取得assetsもZIPとhash一致。
- SHA-256：`c16133cf961d34c12fb8d696670b10906106cf76318ca47918f15941a7fabd17`。
- 記録：`/private/tmp/fm2612-pcm-live-browser-20261110.json`、`fm2612-pcm-live-package-proof-20261110.json`。画像：`/private/tmp/fm2612-pcm-live-browser-20261110/`。
- `git diff --check`成功。README英語／日本語・entryと変更moduleのcache key・配布module一覧を更新した。commit／push／公開なし。

## 残り

- [ ] 人による実ゲームVGMでの実聴・Loop境界と試奏の使い勝手。今回の無音検証は自作fixtureと実WASMを使用している。
- [x] PCM Event Rec：[演奏記録作業](todo_fm2612_genesis_pcm_event_rec_01.md)で実装・無音検証済み。
- [ ] PCM Looper、PWM基本演奏は別作業。
