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
 * @typedef {{at:number, resume:()=>void, owner:unknown, serial:number, cancelled?:boolean}} DeadlineEntry
 * @typedef {{wait: (at: number, resume: () => void, owner?: unknown) => DeadlineEntry,
 *   retime: (entry:DeadlineEntry, at:number) => void,
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
      const entry = { at, resume, owner, serial: serial++, cancelled:false };
      pending.push(entry);
      arm();
      return entry;
    },
    retime(entry, at) {
      if (entry.cancelled || !pending.includes(entry)) return;
      entry.at = at;
      arm();
    },
    cancel(owner) {
      // Wake cancelled waits promptly; callers check their captured generation.
      for (const entry of pending) {
        if (owner === undefined || entry.owner === owner ||
            (typeof owner === "function" && owner(entry.owner))) {
          entry.cancelled = true;
          entry.at = -Infinity;
        }
      }
      arm();
    },
  };
}

/** Shared beat clock: BPM changes preserve phase and retime outstanding beat waits.
 * State belongs to one active runtime, not to individual liveLoops.
 * @param {{now:()=>number, scheduler:DeadlineScheduler, state:{bpm:number,clockStartTime:number|null}}} options
 */
export function createBeatClock({now, scheduler, state}) {
  const waits = new Map();
  const ensure = () => { if (state.clockStartTime === null) state.clockStartTime = now(); };
  const beatsToSeconds = beats => beats * (60 / state.bpm);
  const currentBeat = () => { ensure(); return (now() - state.clockStartTime) / (60 / state.bpm); };
  const timeAtBeat = beat => state.clockStartTime + beatsToSeconds(beat);
  return {
    ensure, currentBeat, beatsToSeconds,
    wait(targetBeat, resume, owner) {
      if (!Number.isFinite(targetBeat) || targetBeat < 0) throw new RangeError('Beat position must be finite and nonnegative');
      ensure();
      const at = timeAtBeat(targetBeat);
      if (!Number.isFinite(at)) throw new RangeError('Beat position is too large');
      const entry = scheduler.wait(at, () => { waits.delete(entry); resume(); }, owner);
      waits.set(entry, targetBeat);
    },
    setBpm(bpm) {
      if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(60 / bpm) || 60 / bpm === 0) throw new RangeError(`Invalid BPM: ${bpm}`);
      // A host may set tempo before AudioContext exists. Do not anchor the beat
      // clock to performance.now() until musical timing is actually used.
      if (state.clockStartTime === null && waits.size === 0) { state.bpm = bpm; return; }
      const position = currentBeat();
      const origin = now() - position * (60 / bpm);
      if (!Number.isFinite(origin) || [...waits.values()].some(beat => !Number.isFinite(origin + beat * (60 / bpm)))) throw new RangeError('BPM creates an unrepresentable beat time');
      state.bpm = bpm;
      state.clockStartTime = origin;
      for (const [entry, beat] of waits) scheduler.retime(entry, timeAtBeat(beat));
    },
  };
}

/** Animate on the selected clock. Numeric duration is a legacy seconds shorthand.
 * Positive durations call 0 and then increasing progress, ending with 1 exactly once.
 * Zero duration calls only 1. Cancellation/error never forces a final callback.
 * @param {number | {seconds:number,beats?:never} | {beats:number,seconds?:never}} duration
 * @param {(progress:number)=>void|Promise<void>} onUpdate
 * @param {{seconds:()=>number,beats:()=>number,sleep:(seconds:number)=>Promise<void>,check:()=>void,getBpm:()=>number}} clock
 */
export async function runTween(duration, onUpdate, clock) {
  if (typeof onUpdate !== 'function') throw new TypeError('tween(duration, onUpdate) requires a callback');
  let unit='seconds', length;
  if (typeof duration === 'number') length=duration;
  else {
    if (!duration || typeof duration !== 'object' || Array.isArray(duration) ||
        Object.keys(duration).some(key => key !== 'seconds' && key !== 'beats') ||
        (duration.seconds !== undefined) === (duration.beats !== undefined)) throw new TypeError('Specify exactly one of seconds or beats');
    unit=duration.beats === undefined ? 'seconds' : 'beats';
    length=duration[unit];
  }
  if (!Number.isFinite(length) || length < 0) throw new RangeError('Tween duration must be finite and nonnegative');
  const now=unit === 'beats' ? clock.beats : clock.seconds;
  const start=now();
  if (!Number.isFinite(start+length)) throw new RangeError('Tween duration is too large');
  clock.check();
  if (length === 0) { await onUpdate(1); clock.check(); return; }
  await onUpdate(0);
  let previous=0;
  while (previous < 1) {
    clock.check();
    const remaining=Math.max(0, length-(now()-start));
    const seconds=unit === 'beats' ? remaining * (60/clock.getBpm()) : remaining;
    await clock.sleep(Math.min(1/60, seconds));
    clock.check();
    const progress=Math.max(previous, Math.min(1, (now()-start)/length));
    if (progress > previous) { await onUpdate(progress); previous=progress; }
  }
  clock.check();
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
 *   tween: (duration: number | {seconds:number,beats?:never} | {beats:number,seconds?:never}, fn: (progress: number) => void | Promise<void>, runToken?: number) => Promise<void>}}
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
  const beatClock = createBeatClock({now:nowSeconds, scheduler, state:runtime});

  function nowSeconds() {
    const audioContext =
      getAudioContext?.();

    if (audioContext) {
      return audioContext.currentTime;
    }

    return performance.now() / 1000;
  }

  function ensureMusicClock() {
    beatClock.ensure();
  }

  function beatsToSeconds(beats) {
    return beatClock.beatsToSeconds(beats);
  }

  function currentBeat() {
    return beatClock.currentBeat();
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
    if (loopState?.interruptError) throw loopState.interruptError;
    await new Promise((resolve) => {
      beatClock.wait(targetBeat, () => {
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
    if (!Number.isFinite(beats) || beats < 0) throw new RangeError('Beats must be finite and nonnegative');
    const loopState =
      getCurrentLoopContext();

    if (!loopState) {
      await waitForBeat(currentBeat() + beats);
      return;
    }

    const baseBeat = Math.max(
      loopState.cursorBeat ?? currentBeat(),
      currentBeat()
    );
    loopState.cursorBeat =
      baseBeat + beats;
    await waitForBeat(
      loopState.cursorBeat ?? currentBeat(),
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
    beatClock.setBpm(bpm);
  }

  /**
   * Animate using elapsed seconds or beats; beat progress follows shared BPM changes.
   * @param {number | {seconds:number,beats?:never} | {beats:number,seconds?:never}} duration
   * @param {(progress:number)=>void|Promise<void>} onUpdate
   * @param {number} [runToken]
   */
  async function tween(duration, onUpdate, runToken = getCurrentRunToken()) {
    const loop = getCurrentLoopContext();
    const token = loop?.runToken ?? runToken;
    const check = () => {
      if (loop?.interruptError && !loop.stopped) throw loop.interruptError;
      if (loop?.stopped || token !== (loop?.runToken ?? getCurrentRunToken())) throw new Error('Run stopped');
    };
    return runTween(duration, onUpdate, {
      seconds: nowSeconds, beats: currentBeat, getBpm: () => runtime.bpm,
      sleep: seconds => sleep(seconds, runToken), check,
    });
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
