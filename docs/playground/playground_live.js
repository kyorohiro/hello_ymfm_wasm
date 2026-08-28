export function createPlaygroundLive(
  options
) {
  const {
    runtime,
    megaDrive,
    preparedFxUnits,
    currentBeat,
    getCurrentLoopContext,
    setCurrentLoopContext,
    logLine,
    setStatus,
  } = options;

  function markPreparedFxUnits(value) {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        markPreparedFxUnits(item);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    if (value.input && value.output) {
      preparedFxUnits.add(value);
    }

    for (const nestedValue of Object.values(
      value
    )) {
      markPreparedFxUnits(
        nestedValue
      );
    }
  }

  function clearRunFxChain() {
    const previousChain =
      megaDrive.clearFXChain();

    for (const effect of previousChain) {
      if (
        !preparedFxUnits.has(effect)
      ) {
        effect?.dispose?.();
      }
    }
  }

  async function livePrepare(
    name,
    fn,
    api
  ) {
    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "livePrepare(name, fn) requires a non-empty string name"
      );
    }

    if (typeof fn !== "function") {
      throw new Error(
        "livePrepare(name, fn) requires a callback"
      );
    }

    if (
      runtime.livePrepared.has(name)
    ) {
      return runtime.livePrepared.get(
        name
      );
    }

    const result = await fn(api);
    runtime.livePrepared.set(
      name,
      result
    );
    markPreparedFxUnits(result);
    return result;
  }

  function liveLoop(
    name,
    fn,
    evaluationState
  ) {
    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "liveLoop(name, fn) requires a non-empty string name"
      );
    }

    if (typeof fn !== "function") {
      throw new Error(
        "liveLoop(name, fn) requires a callback"
      );
    }

    evaluationState.loopDefinitions.set(
      name,
      fn
    );
  }

  function stopLoop(name) {
    const state =
      runtime.liveLoops.get(name);

    if (!state) {
      return;
    }

    state.stopped = true;
    state.runToken += 1;
  }

  function stopAllLoops() {
    for (const state of runtime.liveLoops.values()) {
      state.stopped = true;
      state.runToken += 1;
    }
  }

  async function runLiveLoop(state) {
    try {
      while (!state.stopped) {
        state.currentFn =
          state.nextFn;
        state.cursorBeat = Math.max(
          state.cursorBeat,
          currentBeat()
        );
        state.cycleCallIndex = 0;
        setCurrentLoopContext(state);
        await state.currentFn();
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "Run stopped"
      ) {
        // no-op
      } else {
        console.error(error);
        logLine(
          `[liveLoop:${state.name}] ${error?.stack ?? String(error)}`
        );
        setStatus(
          `Loop error: ${state.name}`
        );
      }
    } finally {
      if (
        runtime.liveLoops.get(
          state.name
        ) === state
      ) {
        runtime.liveLoops.delete(
          state.name
        );
      }

      if (
        getCurrentLoopContext() ===
        state
      ) {
        setCurrentLoopContext(null);
      }
    }
  }

  function commitLiveLoops(
    loopDefinitions
  ) {
    const activeNames = new Set(
      loopDefinitions.keys()
    );

    for (const [name] of runtime.liveLoops.entries()) {
      if (!activeNames.has(name)) {
        stopLoop(name);
      }
    }

    for (const [name, fn] of loopDefinitions.entries()) {
      const existing =
        runtime.liveLoops.get(name);

      if (existing) {
        existing.nextFn = fn;
        continue;
      }

      const state = {
        name,
        currentFn: fn,
        nextFn: fn,
        stopped: false,
        runToken: 1,
        cursorBeat: currentBeat(),
        cycleCallIndex: 0,
        cycleState: new Map(),
      };
      runtime.liveLoops.set(
        name,
        state
      );
      void runLiveLoop(state);
    }
  }

  return {
    clearRunFxChain,
    livePrepare,
    liveLoop,
    stopLoop,
    stopAllLoops,
    commitLiveLoops,
  };
}
