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
      setTimer(() => {
        resolveWithLoopContext(
          resolve,
          undefined,
          loopState
        );
      }, waitMs);
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
    const waitMs = Math.max(
      0,
      (targetTime - nowSeconds()) *
        1000
    );

    await new Promise((resolve) => {
      setTimer(() => {
        resolveWithLoopContext(
          resolve,
          undefined,
          loopState
        );
      }, waitMs);
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

  return {
    nowSeconds,
    ensureMusicClock,
    beatsToSeconds,
    currentBeat,
    sleep,
    waitForBeat,
    beat,
    nextBeat,
    setBpm,
  };
}
