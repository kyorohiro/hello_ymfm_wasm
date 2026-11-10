# FM2612 / Genesis Synth：PCM Software Looper重ね録り（2026-11-10）

ユーザー指示：PCMでも、ループ再生へ別の演奏を重ねて録音・保持できるようにする。各レイヤーのサンプルと設定を保持し、既存Looper欄から重ね録り／Undo／Clear／停止・再開を操作する。ソフトウェア機能と明記し、無音で実装・検証する。

- [x] 既存PSG Looperの状態管理を再利用してPCM Event Recを各レイヤーへ記録する。最初の録音で周期を決め、後続は録音開始位置から残りの周期までを記録する。押しっぱなし・空take・自動終了・短い周期を正しく扱う。
- [x] サンプル／Loop／Pitch／Volume／左右Pan／Root変更を含め、各レイヤーを独立したRF5C164で無音offline生成する。録音時の生PCMを保持し、後の音色編集で書き換えない。Event Recの繰り返し用paddingは含めない。
- [x] ソフトウェアのレイヤー再生をsample clockでmixする。8CHを超えた多層再生は実機機能と混同しない。System PCM補正×Masterは一度だけ適用し、再開／途中追加の位相や重複再生、短い周期での終端を扱う。
- [x] Undo／Clear／停止・再開と、録音／render／転送／再開中の取消を保護する。音源切替・VGM Play／Live／Seek・出力変更・終了で古い処理が再生を復活させない。16層／120秒／128 MiBを基準に資源を制限する。
- [x] 既存Looper欄とSpace操作へ接続し、FM／PSG／PCMのループとEvent Rec takeを独立保持する。編集音色／元WAV／PCM preset／VGMを変更しない。Software Looperと、レイヤーは現在のセッションのメモリ保持であることをhelpに明記する。
- [x] Node実WASM・状態機械・sample clock mixerと、全speaker接続を事前muteしたheadless Chromium／WebKitで、実際の2層以上の音・Undo／停止・再開・音量補正・取消・既存Event Rec／Liveの回帰を確認する。通常browser／native app／会議アプリ／OS音量は操作しない。
- [x] README／cache key／配布ZIP・再開記録を更新する。共有SDK／DSP／WASM／校正値を変更せず、commit／push／公開はしない。

PWM基本演奏とLooperの永続保存は別作業とする。


## 実装記録

- `synth_layer_looper.js`へ既存PSG Looperの状態管理を抽出し、`SynthPsgLooper`／`SynthPcmLooper`は各録音managerを渡すwrapperにした。最初の録音で周期を決め、後続は現在位相から周期の終わりまでを記録する。16層／120秒／生成PCM 128 MiB、空take、押しっぱなしの終了、Undo／Clear、停止・再開の制御を共有する。
- PCMの各層は専用`SynthPcmRecordingManager`が完全なサンプル／設定と操作を取得する。通常のPCM Event Rec takeは書き換えない。レイヤーの音色は後の編集やFiles操作から独立する。
- `synth_pcm_loop_render.js`は既存RF5C164 WASMとPCM録音playerで生stereo配列をoffline生成する。Event Recの繰り返し用10ms paddingは除き、停止後1msだけnativeを進める。音声デバイスは作らず、System補正／Masterも焼き込まない。
- `synth_audio_loop_player.js`にchip非依存のphase／prefix mixerを抽出し、PSG互換wrapperとPCM wrapperで再利用する。途中追加は次の録音位相から始め、過去に再生していない周期の尾音を借りない。
- `synth_pcm_loop_audio.js`と専用Workletは、cooperativeに検証・複製したレイヤーを事前に無音uploadしてACKを待つ。開始時は準備済みtokenの参照をbatchで原子的に反映し、大きな転送で開始時刻を逃さないようにした。元のstereo配列はdetachしない。
- 転送／render／開始／追加中のStop・Undo・音源変更をsession／abort／所有権で保護する。受理済みでもACK待ちの追加は取り消してrollbackし、未使用のuploadも破棄する。System PCM補正×Masterを再生busで一度だけ適用する。
- 既存Looper欄とSpaceを使う。各音源のループとEvent Rec takeは別々に保持する。Event Rec再生とLooperは互いに停止し、VGM Play／Live／Seek・出力切替・終了で旧処理を無効化する。
- 開始準備中のEvent Rec／Looper切替では新しいモードの意図を優先し、古い開始処理が後から再生しない。古い開始の完了で新しいループを停止しないよう、無条件の後追いStopを除いた。
- 既に走っているLooperのStopは編集用PCM RAMの準備を待たずに実行する。編集RAM転送待ち中の停止遅延を避け、遅延した転送完了でも再開しない。
- Software Looperと実機8CHを超えたレイヤーmix、セッション中だけのメモリ保持、Cassetteに保存しない点をPCM helpへ明記した。共有SDK／DSP／WASM／校正値は変更していない。

## 検証

- `node --test --test-concurrency=1 docs/synth/*.test.mjs`：382件成功。PCM実WASMと手動操作の一致、8CH／sample・Loop End変更／One-shot最大step／1ms flush／abort、状態遷移、atomic開始、ACK／Undo／上限を含む。既存PSGのcontroller／Release／mixer回帰も成功。
- `scripts/check_synth_pcm_recording_browser.cjs`：配布stageのChromium／WebKitでEvent Rec・JSON・実PCM・音量補正・元音色保持・取消を確認した。
- 既存の無音PSG Looper checker：同stageのChromium／WebKitで重ね録り・Release・位相・Undo／再開・gainと取消を確認した。検証script：`/private/tmp/check_fm2612_psg_looper_20261110.cjs`。
- 記録：`/private/tmp/fm2612-pcm-looper-node-final-20261110.log`、`fm2612-pcm-looper-event-regression-20261110.json`、`fm2612-pcm-looper-psg-regression-20261110.json`。

再検証：

```sh
node --test --test-concurrency=1 docs/synth/*.test.mjs
sh scripts/package_itch_synth.sh pcm-looper-check
node scripts/check_synth_pcm_looper_browser.cjs --root=release/itch_synth_pcm-looper-check --entry=/index.html
node scripts/check_synth_pcm_recording_browser.cjs --root=release/itch_synth_pcm-looper-check --entry=/index.html
```


## 最終確認・配布候補

- `scripts/check_synth_pcm_looper_browser.cjs`：最終配布stageのChromium／WebKitで成功。左右別の2層、録音後のsample／End編集からの独立、途中位相、押しっぱなし終了、空take、Undo／Clear／停止・再開、System補正×Masterの一度だけの適用を実stereo配列で確認した。
- Event Rec／Looperの相互排他と独立take、FM／PSG／PCMの独立ループ、VGM Play／Live／Pause CH／Seekとの切替、render中Clear、Worklet準備中の音源／モード切替を確認した。
- 編集用RAM転送を保留した状態でもLooper Stopが転送完了前に終了し、古い転送完了でループが復活しないことを確認した。16層は受理、17層／NaN／120秒超は既存層を壊さず拒否し、借用AudioContextを閉じずに破棄できる。
- 幅1240／390 pxで配置と横overflowなしを確認。page error・外部通信・欠落assetなし。全speaker接続を実行前からgain 0へ迂回し、Chromiumは`--mute-audio`も使用した。人による実聴はしていない。
- PCM Looper／PCM Event Rec／PSG Looperの3 browser検証をそれぞれChromium／WebKitで実施し、取得assetは順に131／130／126件すべてZIP内のhashと一致した。
- `sh scripts/package_itch_synth.sh pcm-looper-check-20261110`成功。ローカル参照373件。`release/hello_ymfm_wasm_pcm-looper-check-20261110_itch_synth.zip`は935,018 bytes／253 files、全fileがstageとbyte一致。SHA-256：`5e2388a980ca39dbbbca72ef0fb052945ec7aa8cf3f0a027eb9ddc9c80ddac38`。
- 最終記録：`/private/tmp/fm2612-pcm-looper-browser-20261110.json`、`/private/tmp/fm2612-pcm-looper-package-proof-20261110.json`。画像：`/private/tmp/fm2612-pcm-looper-browser-20261110/{chromium,webkit}-pcm-looper-{1240,390}.png`。

## 残り・再開時

- [ ] 人による実聴：WAVやVGMからコピーした音で重ね録りし、周期の境界・途中追加・Undo・停止／再開を聴き比べる。今回の検証ではスピーカーへ音を出していない。
- [ ] Looperの永続保存・読み込み。現在のレイヤーはセッションのメモリだけに保持し、再読込で失われる。Event Rec JSONとは別に設計する。
- [ ] PWMタブの基本演奏は別作業。

commit／push／公開は未実施。

## 後続修正

Loop End変更による停止は、[発音を保持する修正](todo_fm2612_pcm_live_loop_end_01.md)で解消した。通常編集・Event Rec・Looperで、EndのRAM更新だけではNote Offせず現在位置を保持する。上記のEnd停止に関する記述は初回実装時の記録。
