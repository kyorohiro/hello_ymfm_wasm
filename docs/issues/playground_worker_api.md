# Playground Main / Worker API

`runtime.play(name, { execution: "worker" })` は、ユーザーの Playground
コードを Logic Worker で評価する。音声処理と Web Audio のオブジェクト操作は
Main thread で行い、Worker から FIFO のコマンドとして渡す。

Playground の通常 API は両実行モードで同じ名前・書き方を使う。Worker は
`AudioBuffer` や `AudioNode` の実体を直接扱わず、音声操作を Main thread へ委譲する。

## 共通 API

次の API は Main thread 実行と Worker 実行の両方で使える。

- `fm`、`write()`、`psgTone()`、`psgNoise()`
- `play()`、`sleep()`、`sleepSamples()`、`beat()`、`nextBeat()`、`setBpm()`、`tween()`
- `liveLoop()`、`livePrepare()`、`liveCleanup()`、`stopLoop()`、`stopAllLoops()`、`stopAll()`
- `onKeyboardPressKey()`、`onKeyboardReleaseKey()`
- `sample`、`stream`、`dac`
- `fx`、`noise`、`control()`
- `beginSampleSchedule()`、`scheduleWritesSamples()`
- `choose()`、`cycle()`、`rand()`、`rrange()`、`randInt()`、`lerp()`、`scale()`、`chord()`、`noteToBlockFnum()`、`noteLerp()`
- `context`、`CH1` - `CH6`、`OP1` - `OP4`、`FM_PRESETS`、`pg.presets`、`log()`、`console`

`play()`、`sleep*()`、`beat()`、`nextBeat()`、`tween()` は、どちらの実行モードでも
`await` して使う。

## Worker 実行の仕組み

- 音声命令は Worker から Main thread へ FIFO で送られる。値を返さない操作は、
  Main thread の Web Audio 操作が完了する前に Worker の次の JavaScript 行へ進む。
- Main thread は受け取った命令を FIFO で実行する。`run` と `stop` は Worker 側でも
  直列化され、Stop の cleanup / 音声停止 / dispose が完了する前に次の Run を評価しない。
- `fm.read()`、`fm.readStatus()`、`fm.getIrq()`、`sample.isLoaded()`、`sample.list()`、
  `stream.isLoaded()`、`stream.list()` は Worker でも `await` して値を取得できる。
- Worker の `sample.load()` / `play()`、`stream.load()` / `play()`、`dac.loadBase64()`、
  `setMasterVolume()`、`getMasterVolume()`、`setDacLookahead()`、`getDacLookahead()` は
  RPC 完了を待つため `await` できる。Web Audio のオブジェクト自体は返らない。
- Worker の `fx` はリモート handle である。`fx.setChain()`、`fx.branch()`、
  `fx.parallel()` と各 effect の `param.get()` / `param.set()` / `param.rampTo()` を
  Main thread 実行と同じ書き方で使える。
- Worker の `noise.create()` が返す voice は `start()`、`stop()`、`dispose()`、
  `type`、`attack`、`release`、`gain`、`pan`、`filter.set()`、`filter.cutoff`、`filter.q` の
  remote handle を提供する。Main thread の voice を直接操作するコードは Worker では
  動かない。
- キーボード callback の event は serializable な
  `type`、`key`、`code`、`repeat`、`altKey`、`ctrlKey`、`metaKey`、`shiftKey` のみで、
  DOM の `KeyboardEvent` ではない。
- `beginSampleSchedule()` と `scheduleWritesSamples()` は両モードで使える。Worker の
  `sleepSamples()` は DAC lookahead を含む累積 sample clock を使うため、連続する
  VGM sample wait のタイマー誤差を蓄積しない。

## ブラウザ実オブジェクトの境界

次は `AudioBuffer` / `AudioNode` のような browser object であり、Worker へは
構造化複製できない。現在は Main thread 実行でのみ実体を取得できる。

- `sample.get()` / `stream.get()` が返す AudioBuffer、voice、または AudioNode を直接
  操作する処理。
- effect / noise voice の native AudioNode API と任意の `connect()` 呼び出し。

通常の Playground コードは上記の実体を使わず、`sample` / `stream` / `fx` / `noise` の
公開メソッドだけを使う。完全に同一の戻り値 contract が必要な場合は、これらも
portable handle に統一する。

## ライフサイクル

- 同じ実行モードでの Run は `context` と `livePrepare(name, fn)` の結果を維持し、
  source を再評価する。
- Worker は Run のたびに terminate しない。`runtime.finalize()` でのみ Worker 自体を
  terminate する。
- Worker モードで Stop を押すと、Main thread は停止要求だけを送る。Worker は
  `liveCleanup()` を実行した後、`audio.stopAll`、`fx.detach`、音声 handle の dispose を
  順に発行し、`context`、`livePrepare()` cache、keyboard 定義を破棄する。
- Playground UI の `Run in Worker` は再生中に disabled となる。Stop 後にのみ Main thread /
  Worker の実行モードを切り替えられる。
