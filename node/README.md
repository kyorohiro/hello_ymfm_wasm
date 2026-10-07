# MegaSynth Node realtime（実験用）

`MegaSynthNode` は Worker 内で YM2612、nativeFX、音声出力アダプターを動かす。
Main へ送るのは操作命令・応答・状態だけで、通常再生の PCM は Main を通らない。
Node 入口は npm 0.2.5 以降、出力なし初期化・後付け接続は 0.2.6 以降で利用できる。

## 実行

スピーカー出力に既定の audify アダプターを使う場合は、アプリ側で `npm install audify` を実行する。ブラウザとオフライン利用では不要。

出力なし初期化・後付け接続 API は npm 0.2.6 以降で利用できる。
初期アダプターは audify 1.10.1 の RtAudio。macOS の CoreAudio を Worker から開いて検証した。
Windows / Linux と他の音声デバイスは未検証。

```js
import {MegaSynthNode} from './node/megasynth.mjs';
import {FM_PRESETS} from './web/megasynth-fm-presets.js';

const synth = new MegaSynthNode({sampleRate: 48000, masterVolume: 0.15});
synth.on('error', error => console.error(error));
try {
  await synth.start();
  const fx = synth.fx;
  fx.setChain([fx.delay({time: 0.12, mix: 0.25}), fx.reverb({mix: 0.15})]);
  await synth.fm.setPreset(0, FM_PRESETS.sine);
  await synth.flush();
  await synth.fm.noteOn(0, 4, 553);
  await new Promise(resolve => setTimeout(resolve, 300));
  await synth.fm.noteOff(0);
  await synth.stop();
} finally { await synth.close(); }
```

ローカル配布物では `tetorica-fm2612/node` から import できる。
実行例は `node scripts/demo_megasynth_node.mjs`。
検証用に別の場所へ audify をインストールした場合は、実行例の第1引数に `audify/index.js` の file URL を渡せる。

## 出力なしで開始し、あとから接続する（0.2.6）

```js
import {MegaSynthNode} from 'tetorica-fm2612/node';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';
import {encodeWav} from 'tetorica-fm2612';
import {writeFile} from 'node:fs/promises';

const synth = new MegaSynthNode({outputModule: null});
try {
  await synth.start(); // ready。音声ドライバー不要。
  await synth.fm.setPreset(0, FM_PRESETS.sine);
  await synth.fm.noteOn(0, 4, 553);
  const pcm = await synth.render(48000);
  await synth.fm.noteOff(0);
  await writeFile('note.wav', encodeWav(pcm));

  // audify を導入済みなら、同じ Worker に既定のスピーカー出力を接続する。
  await synth.connectOutput();
  await synth.fm.noteOn(0, 4, 696);
  await new Promise(resolve => setTimeout(resolve, 300));
  await synth.fm.noteOff(0);
  await synth.disconnectOutput();

  // 利用者が選んだ別の出力アダプターへ切り替える。
  await synth.connectOutput({
    outputModule: new URL('./my-output.mjs', import.meta.url).href,
    outputOptions: {device: 'chosen-device'},
  });
} finally {await synth.close();}
```

`outputModule: null` は明示的なオフライン指定。出力指定を省略した場合、audify があれば従来どおりリアルタイムで開始し、未インストールなら `ready` / `output: null` で開始する。
音声なしの状態では `render(frames)` のときだけサンプル時計が進む。無音の仮想デバイスや実時間タイマーは作らない。
`render()` は `{left, right, sampleRate}` を Main に返す明示的な PCM 取得 API。音声出力を接続したままでは呼べない。
`stop()` は出力なしでも予定したイベントを消す。`resume()` は出力未接続なら接続を促すエラーを返す。

`connectOutput()` の失敗は呼び出しの Promise で受け取る。デバイスを開けない場合も出力なしの音源は維持する。
既定でオフラインへ移るのは audify が見つからない場合だけで、導入済み addon の読み込み失敗やデバイスのエラーを無音の成功に置き換えない。
`disconnectOutput()` はフェード・排出・停止・デバイス解放を待ち、`ready` に戻す。
切り替え時は演奏・予定イベントを止めるが、音色・FX 設定・looper unit は保持する。別の出力へ連続無停止で切り替える API ではない。

## 利用者側の既存 PCM 出力へ渡す

出力オブジェクトが既に Main にある場合、Worker へそのオブジェクトを送る必要はない。
`outputModule: null` で生成した PCM を、利用者側で必要な形式に変換して渡せる。
例えば `speaker` の Writable は interleaved PCM を受け取るので、以下のように接続する。
この `speaker` 経路は API 使用例であり、実デバイスではまだ検証していない。

```js
import Speaker from 'speaker'; // アプリが選んでインストールする依存

const pcm = await synth.render(48000); // 出力なしで初期化した MegaSynthNode
const bytes = Buffer.alloc(pcm.left.length * 8);
for (let i = 0; i < pcm.left.length; i++) {
  bytes.writeFloatLE(Math.max(-1, Math.min(1, pcm.left[i])), i * 8);
  bytes.writeFloatLE(Math.max(-1, Math.min(1, pcm.right[i])), i * 8 + 4);
}
const speaker = new Speaker({channels: 2, bitDepth: 32, float: true, sampleRate: pcm.sampleRate});
speaker.end(bytes);
```

継続して `write()` する場合は、利用者側の stream の backpressure と終了・エラー処理を扱う。
[speaker の API](https://github.com/TooTallNate/node-speaker) のような形式変換は出力側の責務で、MegaSynth の renderer は特定の出力依存を要求しない。
通常の音声生成を Main に戻したくない場合は、下記のアダプターを Worker 内で生成する。

## 操作と時計

- `start()`：Worker を初期化する。出力ありならデバイスを開いて短いフェードで開始する。既定の audify が未インストールなら出力なしの `ready` 状態になる。
- `fm`：非同期の命令 API。各メソッドの Promise を await する。
- `fx`：既存の nativeFX controller。命令は FIFO で送る。`flush()` を await して Worker での設定完了・エラーを確認する。
- `schedule(frame, command)`：絶対出力フレーム位置へ FM 命令を登録する。
- `getState()`：生成済み・消費済み・キュー内のフレーム数などを取得する。
- `stop()`：既存キューの後ろへ20msのフェードを追加し、排出後にデバイスを停止する。未来の命令と FX tail を消し、音色・FX chain を保つ。
- `resume()`：同じ Worker・設定で再開する。
- `close()`：初期化待ちと未完了 RPC をキャンセルし、デバイスを閉じて Worker を終了する。再度 `start()` できる。

`currentFrame` は生成側のサンプル時計。スピーカーがその時点まで再生したという意味ではない。
デバイスの消費通知でキューを補充し、通常は `queueBlocks * bufferFrames` まで先行生成する。
既定値は4ブロック × 512フレーム（48kHzで約42.7ms）。デバイス内部の遅延は別にある。
停止フェードの間だけ、キュー上限に20ms分を追加する。
Main の JavaScript が忙しくても Worker の生成・出力は続くが、Worker 自体の長い処理での音切れを防ぐ保証ではない。

非同期の重大エラーは `error` listener と `lastError` で確認できる。音声処理が失敗した場合は自動で終了する。
終了後の FX handle は再利用せず、新しい `start()` 後の `synth.fx` から作り直す。

## 出力アダプター

初期化オプション、または `connectOutput()` の `outputModule`（Node ESM の URL）と `outputOptions` で差し替えられる。
モジュールは `createOutput({sampleRate, bufferFrames, onDrain, onError, ...outputOptions})` を export する。
返すオブジェクトは `frames`、`queuedFrames`、`write(pcm)`、`start()`、`stop()`、`close()`、`getState()` を持つ。
`write`、`start`、`stop`、`close` は同期関数または Promise を返す関数として実装できる。`getState()` と `queuedFrames` は同期で取得できること。
PCM は `{left, right, sampleRate}` の planar stereo Float32。デバイスから1ブロック消費されるごとに `queuedFrames` を更新して `onDrain()` を呼ぶ。
通知はそのアダプターの音声消費／backpressureに合わせて実装し、過剰な先行生成を避ける。
初期化と操作は Worker 内で実行される。オプションは structured clone 可能な値だけを指定する。Main の関数や既存の音声オブジェクトは `outputOptions` に渡せない。
切り離したアダプターから遅れて届く通知・エラーは新しい出力に影響させない。

検証した `@kmamal/sdl@0.11.13` は Main Thread 専用だったため、このアダプターには採用していない。
audify の callback 参照が stream 終了後も残るケースに備え、音声 stream の解放後に所有 Worker を明示的に terminate する。
依存 library の読み込み・デバイスを開く処理は `start()` まで行わない。

## イベント録音と looper

音声と同じ Worker 内に recording / looper を置き、生成フレーム数を時計として使う。
Main のタイマーや AudioContext は使わない。API は非同期で、Promise を await する。

```js
await synth.recording.start();
await synth.fm.noteOn(0, 4, 553);
await new Promise(resolve => setTimeout(resolve, 150));
await synth.fm.noteOff(0);
const recording = await synth.recording.stop();
await synth.recording.import(JSON.parse(JSON.stringify(recording)));
await synth.recording.play(null, {loop: true});
// …
await synth.recording.stopPlayback();

await synth.looper.start();
await synth.looper.startRecording();
await synth.looper.noteOn(0, 4, 696);
await new Promise(resolve => setTimeout(resolve, 150));
await synth.looper.noteOff(0);
await synth.looper.finishRecording();
// ここから録音した1周分の noteOn / noteOff を繰り返す。
await synth.looper.undo();
await synth.looper.stop();
```

上の `setTimeout` は実演のキーを離す時刻を決めるだけで、再生エンジンの時計ではない。
正確な入力時刻が必要なら `schedule(frame, {target: 'fm' または 'looper', method, args})` を使う。
録音のタイムスタンプは Worker に届いて適用したフレーム位置であり、Main が命令を送った実時間ではない。

- `recording`：`start`、`stop`、`export`、`import`、`play`、`stopPlayback`、`getState`。
- `looper`：`start`、`stop`、`clear`、`startRecording`、`finishRecording`、`toggleRecord`、`undo`、`noteOn`、`noteOff`、`getState`、`getUnits`。
- JSON はブラウザと同じ `megasynth-recording-v1`。FM の音色・モード・発音イベントを扱い、FX 操作・PCM 波形は保存しない。
- JSON にはチップ内部の発振・エンベロープ位相を含まないため、イベント再演と PCM の完全保存は異なる。
- looper は既定で音符イベントと音色を保存する。PCM モードは下記のオプションで選ぶ。
- 再演したイベントを再び録音することを避け、演奏入力と再生側を分けている。
- Node の録音ループは、ブラウザ実時間タイマー用の10ms余白を使わず、録音長のフレーム数で繰り返す。
- `stop()` / `close()` は録音・ループを停止し、予定したイベントを消す。`resume()` で古いループを勝手に再開しない。保持した looper unit は明示的に `looper.start()` すると再利用できる。

`close()` は Worker 自体を破棄するため、録音 JSON や unit が必要なら終了前に取得・保存する。

実行例: `node scripts/demo_megasynth_node_events.mjs`。
録音 JSON を `/private/tmp/megasynth-events.json` に保存し、録音再生・looper・undo を短く実演する。

オフラインで同じイベント処理を検証する入口は `web/megasynth_session.js` の `createMegaSynthSession()`。
`await session.render(frames)` でのみ時計が進み、壁時計を待たずに録音・ループを生成できる。
ループ中の音符イベントを sample frame の境界で適用し、録音データの読み込みは live chip を変更する前に検証する。

## PCM looper

```js
const synth = new MegaSynthNode({engineOptions: {
  looperMode: 'pcm', looperMaxAudioSeconds: 60,
}});
// start()、音色設定、looper の演奏・録音操作は上の例と同じ。
const unit = await synth.looper.finishRecording();
const pcm = await synth.looper.exportAudio(unit.id);
// pcm = {sampleRate, channels: [Float32Array, Float32Array]}
```

FM を nativeFX・masterVolume・録音済み PCM のミックス前に取り込む。
重ね録りで以前のループを取り込まず、native の sample mixer で再生してから現在の FX と masterVolume を適用する。
録音対象は FM 全チャンネルで、FM 経路の DAC も含む。マイク入力や FX の残響を含む最終出力の録音ではない。
現在の FM に同時にイベント録音を再演していれば、その FM 出力も録音対象になる。
ノートイベントのない録音は従来どおり破棄する。

`finishRecording()` と `getUnits()` の `audio` は `{name, frames, sampleRate}` の情報だけ。
PCM は Worker 内に保持し、`exportAudio(unit.id)` で明示的に取得したときだけ Main へコピーする。
書き出す波形は FX と masterVolume の適用前である。
`undo()` / `clear()` は不要な PCM bank を解放し、`stop()` は再生 voice と予定した再生を止める。
`close()` 前に保存が必要な PCM を export する。

メモリーを制限するため、録音中の音声と保持済み unit の合計に `looperMaxAudioSeconds`（既定60秒、最大600秒）を適用する。
上限に達すると render はエラーを返す。リアルタイム Worker は音声処理エラーとして終了するため、長い録音には事前に十分な上限を指定する。
オフライン session では `undo()` / `clear()` で解放して続行できる。
PCM bank は最大64個。PCM モードでもサンプル時計を使い、ブラウザ用の10ms余白を加えない。

実行例: `node scripts/demo_megasynth_node_pcm_looper.mjs`。
CoreAudio で短い PCM ループを再生し、`/private/tmp/megasynth-pcm-loop.wav` に dry PCM を保存する。

## 未対応

PSG / Mega CD PCM、マイク入力、他の AudioNode への接続は未対応。
既存のブラウザ MegaSynth を置き換える API ではなく、Node 用の実験入口として検証を進める。

## チップ別の AudifyTransport（0.2.6）

`node/chip_transports.mjs` / package の `tetorica-fm2612/node/transports` から、
YM2612 / YM2608 / Gameboy / SegaPSG / YM2151 の AudifyTransport を import できる。
これは MegaSynthNode とは別の入口で、チップ・Synth は呼び出し元に置く。
Transport 内の出力 Worker はデバイス管理と PCM キューだけを担当し、終了時に明示的に終了する。
利用者がさらに音源処理を Worker に分ける場合は、チップ・Synth・Transport をその Worker で生成する。

`new YM2612AudifyTransport(chip, options)` の options は、sampleRate（既定48000）、
bufferFrames（512）、queueBlocks（4）、gain（0.25）、outputModule / outputOptions。
`start()` / `stop()` / `close()` は Promise を返す。レジスタ操作は同期。
`getState()` で出力のキュー・消費数・エラーを確認できる。
Transport は借りた chip を破棄しない。終了は `await transport.close(); chip.dispose();` の順。
詳細と WorkletTransport の例は [soundchip.md](../web/soundchip.md) を参照。
この入口は npm 0.2.6 以降で利用できる。

### 32X PWM (MAME-derived)

Enable `new MegaSynthNode({mega32X: true, outputModule: null})`, then `await synth.start()`.
The `synth.pwm` methods (`write`, `read`, `reset`, `scheduleWrites`, `clearSchedule`, `getState`) run in the existing audio Worker.
`await synth.pwm.scheduleWrites([{frame: 0, register: 0, value: 5}, {frame: 0, register: 1, value: 1047}, {frame: 32, register: 4, value: 700}])` queues output-frame offsets relative to receipt of that batch.
`await synth.render(48000)` includes PWM in the FM/nativeFX mix; `connectOutput()` uses the same mixer.
The default integrated PWM output is cycle-normalized (`duty`, gain 1), like the VGM player. Raw MAME DAC scaling is available through `pwmOptions: {outputMode: 'dac', gain: .4}`.

For standalone PWM, use `createSoundChip('pwm', {outputMode: 'duty', gain: 1})` with `PWM32XAudifyTransport` from `tetorica-fm2612/node/transports`.
PWM frame scheduling is independent of FM event recording/looping; the PWM methods are not recorded as FM events.
These additions are available from npm 0.2.7.
