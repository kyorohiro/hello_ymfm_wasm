/** One deadline timer, with a separate task per continuation so microtasks drain
 * before another loop's context is restored. No per-loop deadline timers. */
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

    await new Promise((resolve) => {
      scheduler.wait(nowSeconds() + waitMs / 1000, () => {
        resolveWithLoopContext(
          resolve,
          undefined,
          loopState
        );
      }, loopState);
    });

    if (
      loopState?.stopped ||
      effectiveToken !==
        (loopState?.runToken ??
          getCurrentRunToken())
    ) {
      throw new Error("Run stopped");
    }
  }

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

    await new Promise((resolve) => {
      scheduler.wait(runtime.sampleClockStartTime + targetOffset, () => {
        resolveWithLoopContext(
          resolve,
          undefined,
          loopState
        );
      }, loopState);
    });

    if (
      loopState.stopped ||
      effectiveToken !== loopState.runToken
    ) {
      throw new Error("Run stopped");
    }
  }

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

    await new Promise((resolve) => {
      scheduler.wait(targetTime, () => {
        resolveWithLoopContext(
          resolve,
          undefined,
          loopState
        );
      }, loopState);
    });

    if (
      loopState?.stopped ||
      effectiveToken !==
        (loopState?.runToken ??
          getCurrentRunToken())
    ) {
      throw new Error("Run stopped");
    }
  }

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
