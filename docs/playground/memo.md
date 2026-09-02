# Playground "Run in Worker" レビューメモ

対象: `web/playground_logic_worker.js`（新規）, `web/playground_runtime.js`（Worker対応の追加分）
diff範囲: `23ad5e2`（before fx noize worker）〜 `HEAD`

## アーキテクチャ概要

Worker は AudioWorklet / FX / Noise Generation の実処理そのものは行っていない。
Worker が担うのは liveLoop のスクリプト実行とタイミング制御（setTimeout ベースの疑似クロック）のみで、
`write` / `fx.create` / `noise.create` / DAC 操作などの副作用は `postMessage` 経由のコマンドキューで
メインスレッドに転送し、そこで実際の AudioContext / AudioWorkletNode / FXチェーンを操作する構成。
（AudioWorkletNode は生成元の AudioContext と同じスレッド＝メインスレッドに紐付くため、この設計自体は妥当）

## 見つかった問題点（優先度順）

### 1. Worker の `sleep`/`sleepSamples` が絶対時刻を持たず、タイミングがドリフトする【最重要】
- 場所: `playground_logic_worker.js` の `createClock` 内 `sleep`/`sleepSamples`
  vs メインスレッド側の実装 `web/playground_clock.js:95-153`（`sleepSamples`）
- メインスレッドの `sleepSamples` は `runtime.sampleClockStartTime`（起点の絶対時刻）と
  `loopState.sampleCursorSeconds`（そのループの累積目標オフセット）を持ち、
  毎回 `waitMs = (sampleClockStartTime + targetOffset - nowSeconds()) * 1000` を計算してから
  `setTimeout` に渡している。前の待機がタイマー分解能などで数ms遅延しても、
  次の待機時間がその分だけ自動的に短くなるため誤差が蓄積しない（`nowSeconds()` は
  可能なら `audioContext.currentTime` を使うのでさらに高精度）。
- 一方 Worker側の `sleep(seconds)` は `setTimeout(fn, seconds * 1000)` を都度そのまま呼ぶだけで、
  絶対時刻の起点も累積オフセットも持たない。`sleepSamples` はこれをそのまま呼んでいるだけ。
- VGMエクスポート済みスクリプト（`docs/issues/vgm2javascript_d1.md` 等）は
  `await sleepSamples(8)`〜`sleepSamples(10)` のような1ms未満の極小sleepを
  数百〜数千回連続で呼ぶ形になっており、Worker実行ではタイマーの丸め誤差が呼び出しごとに
  積算されて再生タイミングが目に見えてズレていくおそれがある。
- `docs/issues/vgm2javascript.md` の要件（"Preserve the original VGM timing" /
  "Do not use JavaScript setTimeout() or wall-clock timing... Keep timing in
  VGM/sample units"）に対する実質的な違反であり、Worker機能特有の退行。
- 対処案: メインスレッド版と同じ「絶対時刻の起点＋累積オフセット」方式に直す
  （Worker内なら `performance.now()` を絶対時刻の起点として使えば十分）。

### 2. FX / Noise ハンドルが Stop 時に破棄されない（メモリリーク）
- 場所: `playground_runtime.js:139`（`workerAudioHandles`）, `:759`（`stopLogicWorker`）, `:776-785`（`terminateLogicWorker`）
- `workerAudioHandles` は `fx.create` / `noise.create` のたびに増え続ける（`nextAudioHandle` はWorkerセッション中インクリメントのみ）。
- disposeされるのは `terminateLogicWorker()` のみで、これは `finalize()`（Playground全体の終了）からしか呼ばれない。
- `stop()` / `stopLogicWorker()` では `workerAudioHandles` に一切触れないため、
  「編集→Stop→Run」を繰り返すライブコーディングのワークフローで、過去に作った FX/Noise の
  AudioNode 参照が Worker セッションが続く限り無限に蓄積する。
- メインスレッド実行にはこの種の永続レジストリは存在しないため、Worker機能特有の退行。

### 3. `beginSampleSchedule` / `scheduleWritesSamples` が Worker の globals に無い
- 場所: `playground_logic_worker.js:260-306`（Workerの `globals` 定義） vs `playground_runtime.js:1138-1141`（メインスレッド `pg` の定義）
- メインスレッド実行では `pg.beginSampleSchedule()` / `pg.scheduleWritesSamples()`
  （DACスケジュール書き込み・"Copy Scheduled JavaScript" 系機能で使用）が使えるが、
  Worker側の `AsyncFunction` に渡す globals リストにこの2つが含まれていない。
- Worker実行 (`execution: "worker"`) でこれらを呼ぶスクリプトは `ReferenceError` で即死する。
- `docs/issues/vgm2javascript_todo.md` の「Main thread 実行と execution: "worker" 実行の
  API 差分を一覧化する」というTODO項目が指しているのはまさにこの種の差分。

### 4. `fx.branch()` / `fx.parallel()` が Worker 実行では壊れる【実例あり・トレースで確認済み】
- 場所: `playground_logic_worker.js:146-156`（Worker側 `fx` Proxy）, `playground_runtime.js:829-833`（`fx.create` ハンドラ）
- Worker の `fx` Proxy はすべての `fx.<method>(...)` 呼び出しを
  `factory(options)`（引数1個）として扱い、`postCommand("fx.create", [id, method, options])` で送る。
- しかし `fx.branch(...effects)` / `fx.parallel(...branches)` は本来複数のFXユニットを可変長引数で受け取る設計。
  2個目以降の引数は黙って捨てられ、1個目もハンドルID (`{__playgroundHandle}}`) のまま実オブジェクトに解決されない
  （`fx.setChain` は `args[0].map(handleId)` で解決しているが、`fx.create` 側には同様の変換が無い）。
- 実際にこのパターンを使う例が `docs/playground/playground_examples.js:1704-1768`
  の `"parallel-fx"` サンプルとして既に存在する
  （`livePrepare` 内で `fx.parallel(fx.branch(dryFilter), fx.branch(distorted, flanger, reverb))`）。
- コードを最後まで追跡すると、Worker実行時の壊れ方は「例外で落ちて分かる」のではなく
  **サイレントに壊れる**：
  1. `fx.branch(dryFilter)` → Worker側は `factory(dryFilter)` のつもりで
     `postCommand("fx.create", [id, "branch", dryFilter])` を送るが、`dryFilter` は
     Workerの `fxHandle` Proxy（`{__playgroundHandle: "fx-N"}`）で、postMessageの構造化複製で
     ただのプレーンオブジェクトになる。
  2. メインスレッドの `invokeWorkerCommand` は `globals.fx.branch(options)` を1引数で呼ぶ
     （`megaSynthFx.createFXBranch(...effects)` の `effects` は `[options]` の1要素配列）。
  3. `createFXBranch` 内の `isFXUnit()` チェック（`web/megasynth_fx.js:556-565`、
     `input`/`output`/`connect` を持つか確認）に `{__playgroundHandle:...}` は通らないため
     `throw new Error("branch() expects FX units")`。
  4. このエラーは `postCommand`（`request` ではない）の失敗として `handleWorkerMessage`
     （`playground_runtime.js` 内）の `catch` に落ち、`emitLog(...)` でログパネルに出力されるだけで
     **Worker側のユーザースクリプトには例外として伝播しない**。
  5. そのため `workerAudioHandles.set(id, ...)` は実行されず、`branch`/`parallel` の返り値の
     ハンドルIDは main側で何にも紐付かない。続く `fx.setChain([layeredFx.layered])` は
     `workerAudioHandles.get(bogusId)` が `undefined` を返すため、`megaDrive.setFXChain([undefined])`
     を呼ぶことになり、これも失敗するかFXチェーンが正しく組まれない。
  6. 一方 `liveLoop("bass"/"lead")` は例外を受け取っていないので普通に動き続け、
     ユーザーからは「FXが掛かっていない生音が鳴る」ように見えるだけで、
     ログパネルを見ない限り原因（`branch() expects FX units` エラー）に気付きにくい。
- 結果、`branch`/`parallel` を使うスクリプトはメインスレッドでは動くが、Worker実行では
  ログにエラーが出るだけで音がFXなしに鳴ってしまう（＝気付かれにくいサイレント故障）。
- ブラウザでの実機確認は未実施（Playwright/chromium-cli が未インストールのため）。
  上記はコードを静的に追跡した結果であり、実際のpostMessage構造化複製の挙動
  （Proxyがどう複製されるか）だけは未検証だが、複製結果が何であれ`isFXUnit`を
  通過する見込みはないため結論は変わらないはず。

### 5. Stop が Worker の停止完了を待たずに UI 状態を確定させる（レースコンディション）
- 場所: `playground_runtime.js:1673-1690`（`stop()`）, `:1443`（`playSourceInWorker` の worker 再利用）
- `stop()` は `if (workerMode) void stopLogicWorker();` と fire-and-forget で呼び、
  直後に `playbackState = "stopped"` 等を確定させる。実際のWorker側 `run.stop()`
  （`cleanup.fn()` の await → `postCommand("audio.stopAll")`）は最大100msのフォールバック
  タイムアウトの間、非同期に進行中の場合がある。
- さらに `playSourceInWorker` は既存の `logicWorker` を再利用する際に `stopLogicWorker()` を
  一切呼ばない。そのため「Stop → すぐRun」を素早く行うと、古い `stop` メッセージの処理
  （`await` で中断中）と新しい `run` メッセージの処理がWorker内でインターリーブしうる。
  Worker の `onmessage` は `await` の地点でしか処理が切り替わらないため、新しい `execute()` が
  古い `run.cleanups` の反復処理中に `run.cleanups` / `run.loops` / `run.generation` を
  書き換えてしまう可能性がある。
- 通常のライブコーディング操作（編集→Stop→Run を素早く行う）で再現しうる、地に足のついた懸念。

### 6. （軽微）Worker モードでは `megaDrive.stopRecordingPlayback?.()` が呼ばれない
- 場所: `playground_runtime.js:1689`
- 録音再生機能とWorker実行が同時に成立しうるUIフローなら、Stopで録音再生が止まらない。
  実際に両立するケースがあるか要確認（発生条件が限定的なら優先度は低い）。

## 次のアクション候補

- 最優先: 1（タイミングドリフト）。VGMエクスポート機能の再生精度に直結するため。
- 次点: 2（リーク） と 3（API欠落）。
- 3 は `docs/issues/vgm2javascript_todo.md` の「API 差分の一覧化」タスクと直結するので、
  対応した差分がそのままTODO項目の答えになる。
