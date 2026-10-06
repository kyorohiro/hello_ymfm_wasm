# MegaSynth Node realtime（実験用）

`MegaSynthNode` は Worker 内で YM2612、nativeFX、音声出力アダプターを動かす。
Main へ送るのは操作命令・応答・状態だけで、通常再生の PCM は Main を通らない。
この入口は現在のローカル開発版に含まれ、公開済み npm 0.2.4 にはまだ含まれない。

## 実行

アプリ側で `npm install audify` を実行する。ブラウザとオフライン利用では不要。
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

## 操作と時計

- `start()`：Worker とデバイスを初期化し、無音から短いフェードで開始する。
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

初期化オプションの `outputModule`（Node ESM の URL）と `outputOptions` で差し替えられる。
モジュールは `createOutput({sampleRate, bufferFrames, onDrain, onError, ...outputOptions})` を export する。
返すオブジェクトは `frames`、`queuedFrames`、`write(pcm)`、`start()`、`stop()`、`close()`、`getState()` を持つ。
PCM は stereo Float32。デバイスから1ブロック消費されるごとに `queuedFrames` を更新して `onDrain()` を呼ぶ。
初期化と操作は Worker 内で実行される。オプションは structured clone 可能な値だけを指定する。

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
