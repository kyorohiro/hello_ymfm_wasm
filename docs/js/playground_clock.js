/**
 * @file playground_clock.js
 * 実行環境: Browser / Web Worker / Node.js（使用 API に条件あり）
 * 依存: performance、タイマー、利用可能なら MessageChannel。
 * createDeadlineScheduler は共用。createPlaygroundClock の既定タイマーは window を使うため、
 * Worker / Node.js では setTimer を注入する。音声時計と実行コンテキストも呼び出し側から渡す。
 */
/**
 * @typedef {{runToken: number, stopped: boolean, cursorBeat: number,
 *   sampleCursorSeconds?: number, interruptError?: Error}} PlaygroundClockLoop
 * @typedef {{bpm: number, clockStartTime: number | null,
 *   sampleClockStartTime: number | null}} PlaygroundClockState
 * @typedef {{now: () => number, setTimer?: typeof globalThis.setTimeout,
 *   clearTimer?: typeof globalThis.clearTimeout,
 *   createTaskChannel?: () => MessageChannel | null}} DeadlineSchedulerOptions
 * @typedef {{wait: (at: number, resume: () => void, owner?: unknown) => void,
 *   cancel: (owner?: unknown | ((owner: unknown) => boolean)) => void}} DeadlineScheduler
 * @typedef {Object} PlaygroundClockOptions
 * @property {PlaygroundClockState} runtime Mutable tempo and clock origins (seconds).
 * @property {() => Pick<BaseAudioContext, 'currentTime'> | null | undefined} [getAudioContext] Audio clock; falls back to performance.now().
 * @property {() => number} getCurrentRunToken Generation identifying the current Run.
 * @property {() => PlaygroundClockLoop | null} getCurrentLoopContext Current liveLoop state.
 * @property {(loop: PlaygroundClockLoop | null) => void} [setCurrentLoopContext] Restore the loop before resuming an await.
 * @property {typeof globalThis.setTimeout} [setTimer] Required outside a browser window; delay is milliseconds.
 * @property {typeof globalThis.clearTimeout} [clearTimer] Cancels a handle returned by setTimer.
 * @property {() => MessageChannel | null} [createTaskChannel] Optional task dispatch hook.
 */
/**
 * Share one deadline timer, dispatching each continuation in a separate task.
 * @param {DeadlineSchedulerOptions} options Clock in seconds and optional timer hooks.
 * @returns {DeadlineScheduler} Queue waits and wake cancelled owners; callers check cancellation themselves.
 */
export function createDeadlineScheduler({
  now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  createTaskChannel = () => typeof MessageChannel === "function" ? new MessageChannel() : null,
}) {
  const pending = [];
  let timer = null;
  let deadline = Infinity;
  let channel = null;
  let taskQueued = false;
  let serial = 0;

  function closeChannel() {
    channel?.port1.close();
    channel?.port2.close();
    channel = null;
  }

  function arm() {
    pending.sort((a, b) => a.at - b.at || a.serial - b.serial);
    if (taskQueued) return;
    const next = pending[0]?.at ?? Infinity;
    if (next === Infinity) closeChannel();
    if (next === deadline) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    deadline = next;
    if (next === Infinity) { closeChannel(); return; }
    // A late continuation must not pay the browser's nested-timer minimum
    // again. VGM often has tens of thousands of 1–2 sample waits.
    // Keep a separate task (not a microtask) so loop contexts cannot overlap.
    if (next <= now()) {
      channel ??= createTaskChannel();
      if (channel) {
        deadline = Infinity;
        taskQueued = true;
        channel.port1.onmessage = dispatch;
        channel.port2.postMessage(null);
        return;
      }
    }
    timer = setTimer(() => {
      timer = null;
      deadline = Infinity;
      dispatch();
    }, Math.max(0, (next - now()) * 1000));
  }

  function dispatch() {
    taskQueued = false;
    const entry = pending[0];
    if (!entry || entry.at > now()) { arm(); return; }
    pending.shift();
    entry.resume();
    // Do not resolve another loop in this task: await chains must finish first.
    if (pending[0]?.at <= now()) {
      channel ??= createTaskChannel();
      if (channel) {
        taskQueued = true;
        channel.port1.onmessage = dispatch;
        channel.port2.postMessage(null);
        return;
      }
    }
    arm();
  }

  return {
    wait(at, resume, owner) {
      pending.push({ at, resume, owner, serial: serial++ });
      arm();
    },
    cancel(owner) {
      // Wake cancelled waits promptly; callers check their captured generation.
      for (const entry of pending) {
        if (owner === undefined || entry.owner === owner ||
            (typeof owner === "function" && owner(entry.owner))) entry.at = -Infinity;
      }
      arm();
    },
  };
}

/**
 * Create beat/sample waits and tempo helpers against the runtime's audio clock.
 * Waits reject when their Run or liveLoop stops. Timers resume JavaScript;
 * they do not schedule sample-accurate audio rendering.
 * @param {PlaygroundClockOptions} options Runtime state, loop context and clock hooks.
 * @returns {{cancelWaits: DeadlineScheduler['cancel'], nowSeconds: () => number,
 *   ensureMusicClock: () => void, beatsToSeconds: (beats: number) => number,
 *   currentBeat: () => number, sleep: (seconds: number, runToken?: number) => Promise<void>,
 *   sleepSamples: (samples: number, sampleRate?: number, runToken?: number) => Promise<void>,
 *   waitForBeat: (targetBeat: number, runToken?: number, loopState?: PlaygroundClockLoop | null) => Promise<void>,
 *   beat: (beats?: number) => Promise<void>, nextBeat: () => Promise<void>,
 *   setBpm: (bpm: number) => void,
 *   tween: (seconds: number, fn: (progress: number) => void | Promise<void>, runToken?: number) => Promise<void>}}
 */
export function createPlaygroundClock(
  options
) {
  const {
    runtime,
    getAudioContext,
    getCurrentRunToken,
    getCurrentLoopContext,
    setCurrentLoopContext,
    setTimer = (fn, delayMs) =>
      window.setTimeout(fn, delayMs),
  } = options;

  const scheduler = createDeadlineScheduler({
    now: nowSeconds,
    setTimer,
    clearTimer: options.clearTimer,
    createTaskChannel: options.createTaskChannel,
  });

  function nowSeconds() {
    const audioContext =
      getAudioContext?.();

    if (audioContext) {
      return audioContext.currentTime;
    }

    return performance.now() / 1000;
  }

  function ensureMusicClock() {
    if (
      runtime.clockStartTime ===
      null
    ) {
      runtime.clockStartTime =
        nowSeconds();
    }
  }

  function beatsToSeconds(beats) {
    return (
      beats * 60 / runtime.bpm
    );
  }

  function currentBeat() {
    ensureMusicClock();
    return (
      (nowSeconds() -
        runtime.clockStartTime) /
      beatsToSeconds(1)
    );
  }

  function resolveWithLoopContext(
    resolve,
    value,
    loopState = null
  ) {
    setCurrentLoopContext?.(
      loopState
    );
    resolve(value);
  }

  /**
   * Wait for a relative duration, restoring the captured loop on resume.
   * @param {number} seconds Duration in seconds; negative values are clamped to zero.
   * @param {number} [runToken] Current Run generation.
   * @returns {Promise<void>}
   * @throws {Error} When the Run/loop stops or a loop-owned asynchronous task fails.
   */
  async function sleep(
    seconds,
    runToken = getCurrentRunToken()
  ) {
    const loopState =
      getCurrentLoopContext();
    const effectiveToken =
      loopState?.runToken ??
      runToken;
    const waitMs = Math.max(
      0,
      seconds * 1000
    );

    if (loopState?.interruptError) throw loopState.interruptError;
    await new Promise((resolve) => {
      scheduler.wait(nowSeconds() + waitMs / 1000, () => {
        resolveWithLoopContext(
          resolve,
          undefined,
          loopState
        );
      }, loopState);
    });

    if (loopState?.interruptError && !loopState.stopped) throw loopState.interruptError;
    if (
      loopState?.stopped ||
      effectiveToken !==
        (loopState?.runToken ??
          getCurrentRunToken())
    ) {
      throw new Error("Run stopped");
    }
  }

  /**
   * Advance the loop's cumulative sample cursor, avoiding per-wait timer drift.
   * @param {number} samples Number of samples to wait.
   * @param {number} [sampleRate=44100] Samples per second, independent of the chip clock.
   * @param {number} [runToken] Current Run generation.
   * @returns {Promise<void>}
   */
  async function sleepSamples(
    samples,
    sampleRate = 44100,
    runToken = getCurrentRunToken()
  ) {
    const duration = Math.max(
      0,
      Number(samples) || 0
    ) / Math.max(
      1,
      Number(sampleRate) || 44100
    );
    const loopState =
      getCurrentLoopContext();

    if (!loopState) {
      await sleep(duration, runToken);
      return;
    }

    if (
      runtime.sampleClockStartTime ===
      null
    ) {
      runtime.sampleClockStartTime =
        nowSeconds();
    }

    const effectiveToken = loopState.runToken;
    const targetOffset =
      (loopState.sampleCursorSeconds ?? 0) +
      duration;
    loopState.sampleCursorSeconds =
      targetOffset;

    if (loopState?.interruptError) throw loopState.interruptError;
    await new Promise((resolve) => {
      scheduler.wait(runtime.sampleClockStartTime + targetOffset, () => {
        resolveWithLoopContext(
          resolve,
          undefined,
          loopState
        );
      }, loopState);
    });

    if (loopState?.interruptError && !loopState.stopped) throw loopState.interruptError;
    if (
      loopState.stopped ||
      effectiveToken !== loopState.runToken
    ) {
      throw new Error("Run stopped");
    }
  }

  /**
   * Wait until an absolute beat position on the current music clock.
   * @param {number} targetBeat Absolute beat position.
   * @param {number} [runToken] Current Run generation.
   * @param {PlaygroundClockLoop | null} [loopState] Loop whose context is restored on resume.
   * @returns {Promise<void>}
   */
  async function waitForBeat(
    targetBeat,
    runToken = getCurrentRunToken(),
    loopState = getCurrentLoopContext()
  ) {
    ensureMusicClock();
    const effectiveToken =
      loopState?.runToken ??
      runToken;
    const targetTime =
      runtime.clockStartTime +
      beatsToSeconds(targetBeat);

    if (loopState?.interruptError) throw loopState.interruptError;
    await new Promise((resolve) => {
      scheduler.wait(targetTime, () => {
        resolveWithLoopContext(
          resolve,
          undefined,
          loopState
        );
      }, loopState);
    });

    if (loopState?.interruptError && !loopState.stopped) throw loopState.interruptError;
    if (
      loopState?.stopped ||
      effectiveToken !==
        (loopState?.runToken ??
          getCurrentRunToken())
    ) {
      throw new Error("Run stopped");
    }
  }

  /** @param {number} [beats=1] Advance this loop's beat cursor by this amount.
   * @returns {Promise<void>} Resolves at the new beat position. */
  async function beat(beats = 1) {
    const loopState =
      getCurrentLoopContext();

    if (!loopState) {
      await sleep(
        beatsToSeconds(beats)
      );
      return;
    }

    const baseBeat = Math.max(
      loopState.cursorBeat,
      currentBeat()
    );
    loopState.cursorBeat =
      baseBeat + beats;
    await waitForBeat(
      loopState.cursorBeat,
      getCurrentRunToken(),
      loopState
    );
  }

  /** @returns {Promise<void>} Wait for the next integer beat after the current loop cursor/audio time. */
  async function nextBeat() {
    const loopState =
      getCurrentLoopContext();

    if (!loopState) {
      const next =
        Math.floor(
          currentBeat() + 0.000001
        ) + 1;
      await waitForBeat(next);
      return;
    }

    const baseBeat = Math.max(
      loopState.cursorBeat,
      currentBeat()
    );
    loopState.cursorBeat =
      Math.floor(baseBeat + 0.000001) +
      1;
    await waitForBeat(
      loopState.cursorBeat,
      getCurrentRunToken(),
      loopState
    );
  }

  /**
   * Change tempo while preserving the current beat position.
   * @param {number} bpm Positive finite beats per minute.
   * @returns {void}
   * @throws {Error} When BPM is invalid.
   */
  function setBpm(bpm) {
    const nextBpm = Number(bpm);

    if (
      !Number.isFinite(nextBpm) ||
      nextBpm <= 0
    ) {
      throw new Error(
        `Invalid BPM: ${bpm}`
      );
    }

    const beatPosition =
      currentBeat();
    runtime.bpm = nextBpm;
    runtime.clockStartTime =
      nowSeconds() -
      beatsToSeconds(beatPosition);
  }

  /**
   * Call a progress callback from 0 to 1 over a duration (zero duration calls only 1).
   * @param {number} seconds Duration in seconds.
   * @param {(progress: number) => void | Promise<void>} fn Callback; asynchronous callbacks are awaited.
   * @param {number} [runToken] Current Run generation.
   * @returns {Promise<void>}
   */
  async function tween(
    seconds,
    fn,
    runToken = getCurrentRunToken()
  ) {
    if (typeof fn !== "function") {
      throw new Error(
        "tween(seconds, fn) requires a callback"
      );
    }

    const loopState =
      getCurrentLoopContext();
    const effectiveToken =
      loopState?.runToken ??
      runToken;
    const duration =
      Math.max(
        0,
        Number(seconds) || 0
      );
    const startedAt =
      nowSeconds();

    if (duration === 0) {
      await fn(1);
      return;
    }

    await fn(0);

    while (true) {
      const elapsed =
        nowSeconds() - startedAt;
      const progress = Math.min(
        1,
        elapsed / duration
      );

      if (progress >= 1) {
        break;
      }

      await sleep(
        Math.min(1 / 60, duration / 16),
        runToken
      );

      if (
        loopState?.stopped ||
        effectiveToken !==
          (loopState?.runToken ??
            getCurrentRunToken())
      ) {
        throw new Error(
          "Run stopped"
        );
      }

      const steppedElapsed =
        nowSeconds() - startedAt;
      const steppedProgress =
        Math.min(
          1,
          steppedElapsed / duration
        );
      await fn(steppedProgress);
    }

    await fn(1);
  }

  return {
    cancelWaits: scheduler.cancel,
    nowSeconds,
    ensureMusicClock,
    beatsToSeconds,
    currentBeat,
    sleep,
    sleepSamples,
    waitForBeat,
    beat,
    nextBeat,
    setBpm,
    tween,
  };
}
