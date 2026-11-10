# FM2612 / Genesis Synth：PCM Event Rec（2026-11-10）

ユーザー指示：PCMの発音・離鍵・Pitch・Volume・左右Pan・Loop設定とサンプル変更を記録し、サンプル込みのJSONで保存・読み込みできるようにする。既存Event Rec UIを使い、専用音源で再生して編集中の音色を保つ。ソフトウェアによる演奏記録と明記する。会議中の無音作業の制約を継続する。

- [x] PCM voiceが受理した意味上の操作を記録する。初期音色・サンプル・pitch clockと時刻、8 physical CH、設定／サンプル変更、stopを保持し、RAM転送準備中の未発音や失敗した操作を発音として記録しない。
- [x] 自己完結のバージョン付きPCM専用JSONを定義・厳格検証する。FM／PSG形式と混同せず、不正／巨大／時刻逆転／範囲外入力は元take・元音色を保持して拒否する。録音量・時間・再生用RAMに上限を置く。
- [x] 専用RF5C164とapp専用Workletでsample clock再生する。sample／Loop Endの変更を準備し、停止／連続loop／同時刻順序／8音／One-shotを扱う。共有SDK／DSP／WASM／校正値は変更しない。
- [x] 既存Event Rec操作・Space・JSON Export／Importへ接続し、FM／PSG／PCMごとのtakeを独立保持する。録音終了時の押しっぱなしを解放し、空takeは再生しない。Use current soundにも対応し、録音音色と現在音色を混ぜない。
- [x] 再生は編集用PCM・RAMを変更せず、System PCM補正×Masterは一度だけ適用する。CH／音源切替・VGM Play／Live／Seek・出力変更・終了で古い準備／再生を確実に止める。PCM Looperは引き続き未対応とする。
- [x] Software Event Recであることを簡潔に説明し、説明は既存helpへ置く。README／cache key／配布一覧・ZIP・再開記録を更新する。
- [x] 無音Node／実WASMと、全speaker接続を事前muteしたheadless Chromium／WebKitで、実PCM・設定変化・保存読込・停止競合・元音色保持・FM／PSG／PCM Liveを検証する。通常browser／native app／会議アプリ／OS音量は操作しない。

commit／push／公開は行わない。PCM LooperとPWM基本演奏は別作業。


## 実装記録

- `synth_pcm.js`の`onCommand`は受理した操作だけを通知する。RAM準備や未準備のnoteOnは記録しない。Volume／Pan／Root／Loopは完全なsettings、波形変更は完全なpresetとして記録する。サンプルやEnd変更に伴う停止は、それぞれの操作の意味に含める。
- `synth_pcm_recording.js`：`tetorica-rf5c164-recording-v1`／version 1。`initialState`は自己完結のPCM presetとpitch clock、`commands`は音声clockからの相対秒を持つ。8 physical CHを保ち、Stop時に押しっぱなしを閉じ、発音のないtakeは空のままにする。
- JSONは16 MiB／100,000操作／24時間、異なるsample dataとLoop Endの組合せは512個まで。初期状態も含め、同じRAMは重複計上しない。取込と録音に同じ制限を適用する。byte数は移植可能なUTF-8計算で測り、入力の不正や上限到達で最後に受理したtakeを失わない。
- `synth_pcm_recording_prepare.js`でJSON検証・base64復号・guard付き64 KiB bankの準備と重複排除を行い、最大32 MiBのbankを専用Workletへ転送する。描画側はJSON／base64や大きなRAM割当を行わない。
- `synth_pcm_recording_player.js`／`synth_pcm_recording_worklet.js`は独立RF5C164でsample clock再生する。元の順序と8CH、sample／End変更時の停止、One-shot／再発音、loop開始時のRAMと位相を保つ。Use current soundでも元の発音／停止タイミングは保ち、音色の変更だけを置き換える。
- `synth_pcm_recording_audio.js`は共通AudioContextを借用する。独自processor名で既存編集用RF Workletと共存し、転送ACK、sessionとabort、出力切替／古い初期化／timeoutを扱う。System PCM補正×Masterを一度だけ適用し、編集用PCM bankへ書き込まない。
- 既存Event Rec Start→Record／Stop（Space）→loop再生、Play／Stop Play、MenuのJSON Export／Importを使う。Use current soundは再生開始時の現在音色を固定し、再生中の編集では変化しない。FM／PSG／PCMのtakeとcheckbox設定は別々に保持する。PCM Looperは引き続き無効。
- 非同期JSON読込は最新操作だけを反映し、新しい取込・録音・再生操作や音源／VGM遷移で古い読込を破棄する。不正入力は現在のtake・再生・音色を保持する。
- Software Event Recの説明はPCM helpと既存ボタンのtooltipへ追加した。共有SDK／DSP／WASM／校正値は変更していない。
- 実ブラウザで見つけたWorklet読込時のTextEncoder依存を除去し、JSON準備を別moduleへ分離した。TextEncoder／TextDecoder／AbortController／btoa／atobのない描画環境で実Worklet moduleを読み込む回帰テストも追加した。

## 検証

- `node --test --test-concurrency=1 docs/synth/*.test.mjs`：357件成功。実WASMの手動編集操作と録音playerのPCM一致、異なる描画quantum、8音、sample／End／Root／Pan／Pitch、One-shot最大step、loop再開、所有権／ACK／取消／format上限を含む。
- `scripts/check_synth_pcm_browser.cjs`：最終配布stageのChromium／WebKitで通常PCM編集・WAV・8音・gain・Files／Cassette・復旧・FM6CH／PSG3CHを回帰確認した。
- `scripts/check_synth_pcm_live_browser.cjs`：同stageのChromium／WebKitでVGMの聴こえる位置、Live／Freeze／Pause／Seek／Copy、CH8試奏、元ファイル保持を回帰確認した。
- 一時記録：`/private/tmp/fm2612-pcm-recording-node-final-20261110.log`、`fm2612-pcm-recording-editor-regression-20261110.json`、`fm2612-pcm-recording-live-regression-20261110.json`。

再検証：

```sh
node --test --test-concurrency=1 docs/synth/*.test.mjs
sh scripts/package_itch_synth.sh pcm-event-rec-check
node scripts/check_synth_pcm_recording_browser.cjs --root=release/itch_synth_pcm-event-rec-check --entry=/index.html
node scripts/check_synth_pcm_browser.cjs --root=release/itch_synth_pcm-event-rec-check --entry=/index.html
node scripts/check_synth_pcm_live_browser.cjs --root=release/itch_synth_pcm-event-rec-check --entry=/index.html
```


最終確認（2026-11-10）：

- `scripts/check_synth_pcm_recording_browser.cjs`は配布stageのChromium／WebKitで成功。画面操作から8CH／9音目steal、押しっぱなしの終了、Pitch／Volume／左右Pan／Root／Loop／サンプル変更を含むtakeを取得した。JSONは元サンプルを含み、再取込後に専用音源で再生した。
- 実PCMの数値から左右Pan・octave・音量半減・RAM置換・停止を確認し、System補正×Masterが一度だけ作用すること、Use current soundが開始時の音色を保つことを確認した。FM／PSG／PCMのtakeは独立して保持し、元のPCM presetも変化しなかった。
- 不正format／version／逆転時刻／不正sample／16 MiB超過・遅延したJSONの拒否、VGM Play／Live／Pause CH／Seekでの録音禁止と再生停止も成功。HTTP応答を保留してWorklet初期化を遅らせ、音源切替後に遅れてReadyになっても再生開始しないことを両engineで確認した。
- 全speaker接続をアプリ実行前にgain 0へ迂回し、Chromiumは`--mute-audio`も使用。すべての物理出力がmuteされた数値を確認し、通常browser／native app／会議アプリ／OS音量は操作していない。実聴はしていない。
- 1240／390 pxの画像と横overflowなしを確認。page error／外部通信／欠落assetなし。Node 357件と3種類のブラウザ検証はすべて成功。
- `sh scripts/package_itch_synth.sh pcm-event-rec-check-20261110`成功、353ローカル参照を確認。ZIPの246 filesはstageと全byte一致。通常編集／Liveの各123、Event Recの124取得assetsもZIPとhash一致。
- ZIP：`release/hello_ymfm_wasm_pcm-event-rec-check-20261110_itch_synth.zip`（923,702 bytes）。SHA-256：`04090fc504142c09aa1e6cc6df587b34eddb845386170daef968b29977820569`。
- 記録：`/private/tmp/fm2612-pcm-recording-browser-20261110.json`、`fm2612-pcm-recording-package-proof-20261110.json`。画像：`/private/tmp/fm2612-pcm-recording-browser-20261110/`。
- `git diff --check`成功。README英語／日本語・cache key・配布module一覧を更新済み。commit／push／公開なし。

## 残り

- [ ] 人による実聴：実際のWAVで録音→loop再生→Export／Import、再生中の音色編集とUse current soundの聴こえ方。
- [x] PCM Looper：[重ね録り作業](todo_fm2612_genesis_pcm_looper_01.md)で実装・無音検証済み。
- [ ] PWM基本演奏は別作業。
