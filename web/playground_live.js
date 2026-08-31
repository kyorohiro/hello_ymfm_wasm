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
      if (preparedFxUnits.has(effect)) {
        continue;
      }

      if (
        containsPreparedFxUnit(effect)
      ) {
        effect?.disconnect?.();
      } else {
        effect?.dispose?.();
      }
    }
  }

  function containsPreparedFxUnit(
    value,
    visited = new Set()
  ) {
    if (
      !value ||
      typeof value !== "object"
    ) {
      return false;
    }

    if (visited.has(value)) {
      return false;
    }
    visited.add(value);

    if (
      preparedFxUnits.has(value)
    ) {
      return true;
    }

    if (Array.isArray(value)) {
      return value.some((item) =>
        containsPreparedFxUnit(
          item,
          visited
        )
      );
    }

    return Object.values(value).some(
      (nestedValue) =>
        containsPreparedFxUnit(
          nestedValue,
          visited
        )
    );
  }

  function collectPreparedFxUnits(
    value,
    collected,
    visited = new Set()
  ) {
    if (
      !value ||
      typeof value !== "object"
    ) {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (value.input && value.output) {
      collected.add(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectPreparedFxUnits(
          item,
          collected,
          visited
        );
      }
      return;
    }

    for (const nestedValue of Object.values(
      value
    )) {
      collectPreparedFxUnits(
        nestedValue,
        collected,
        visited
      );
    }
  }

  function clearPrepared() {
    const preparedUnits =
      new Set();

    for (const prepared of runtime.livePrepared.values()) {
      collectPreparedFxUnits(
        prepared,
        preparedUnits
      );
    }

    for (const effect of preparedUnits) {
      effect?.dispose?.();
    }

    runtime.livePrepared.clear();
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

  function isRunStoppedError(error) {
    return (
      error instanceof Error &&
      error.message === "Run stopped"
    );
  }

  function waitForLoopRetry() {
    return new Promise((resolve) => {
      setTimeout(resolve, 16);
    });
  }

  async function runLiveLoop(state) {
    try {
      while (!state.stopped) {
        state.cursorBeat = Math.max(
          state.cursorBeat,
          currentBeat()
        );
        state.cycleCallIndex = 0;

        // Apply a newly committed callback at loop boundaries.
        // If that callback throws, we can roll back to the last
        // stable version instead of killing the loop.
        if (
          state.currentFn !==
          state.nextFn
        ) {
          state.currentFn =
            state.nextFn;
        }

        try {
          setCurrentLoopContext(state);
          await state.currentFn();
          state.stableFn =
            state.currentFn;
          state.hasStableRun = true;
        } catch (error) {
          if (
            isRunStoppedError(error)
          ) {
            throw error;
          }

          console.error(error);
          logLine(
            `[liveLoop:${state.name}] ${error?.stack ?? String(error)}`
          );

          if (
            state.hasStableRun &&
            state.currentFn !==
              state.stableFn
          ) {
            state.currentFn =
              state.stableFn;
            state.nextFn =
              state.stableFn;
            setStatus(
              `Loop error: ${state.name} (rolled back)`
            );
          } else {
            setStatus(
              `Loop error: ${state.name} (retrying)`
            );
          }

          await waitForLoopRetry();
        }
      }
    } catch (error) {
      if (isRunStoppedError(error)) {
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
        if (existing.stopped) {
          runtime.liveLoops.delete(
            name
          );
        } else {
        existing.nextFn = fn;
        continue;
        }
      }

      const state = {
        name,
        currentFn: fn,
        nextFn: fn,
        stableFn: fn,
        hasStableRun: false,
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
    clearPrepared,
    livePrepare,
    liveLoop,
    stopLoop,
    stopAllLoops,
    commitLiveLoops,
  };
}
