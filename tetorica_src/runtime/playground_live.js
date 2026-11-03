import {formatLogArgs} from './playground_log.js';
/**
 * @file playground_live.js
 * 実行環境: Browser / Node.js
 * 依存: 注入された runtime・音声操作・時計・UI コールバック。ブラウザー API を直接生成しない。
 */
/**
 * Manage liveLoop definitions, prepared resources and cleanup hooks across evaluations.
 * @param {object} options Runtime state and lifecycle callbacks.
 * @param {{livePrepared: Map<string, unknown>, liveLoops: Map<string, object>, liveCleanupHooks: Map<string, object>}} options.runtime Per-runtime lifecycle maps.
 * @param {{clearFXChain: () => object[]}} options.megaDrive Audio owner used to detach effects.
 * @param {Set<object>} options.preparedFxUnits Effect units retained across evaluations.
 * @param {() => number} options.currentBeat Current beat position.
 * @param {() => number} [options.currentSampleCursor] Current position in seconds on the shared sample timeline.
 * @param {() => object | null} options.getCurrentLoopContext Current loop.
 * @param {(loop: object | null) => void} options.setCurrentLoopContext Restore a loop context.
 * @param {(loop: object) => void} [options.cancelWaits] Wake a stopped loop's waits.
 * @param {(loop: object) => Promise<void>} [options.finishTasks] Await loop-owned asynchronous tasks.
 * @param {(loop: object) => void} [options.releaseTasks] Release completed loop task state.
 * @param {() => string[]} [options.getKeyboardNames] Registered keyboard resources retained by liveCleanup.
 * @param {(line: string) => void} options.logLine Error/log sink.
 * @param {(message: string) => void} options.setStatus Status sink.
 * @param {(callback: () => unknown) => unknown | Promise<unknown>} [options.executeCallback] Optional execution guard wrapper.
 * @returns Preparation, loop registration/commit, stop and cleanup operations.
 */
export function createPlaygroundLive(
  options
) {
  const {
    runtime,
    megaDrive,
    preparedFxUnits,
    currentBeat,
    currentSampleCursor = () => 0,
    getCurrentLoopContext,
    setCurrentLoopContext,
    cancelWaits = () => {},
    finishTasks = async () => {},
    releaseTasks = () => {},
    getKeyboardNames = () => [],
    logLine,
    setStatus,
    executeCallback = (callback) =>
      callback(),
  } = options;

  let preparedGeneration = 0;
  const pendingCleanups = new Set();
  let executingCleanups = 0;
  const hasPendingCleanups = () => executingCleanups > 0 || pendingCleanups.size > 0;
  async function settled() {
    // The first yield also lets a currently executing callback register its
    // returned promise before a nested stopAll() asks for the retirement fence.
    do { await Promise.all([...pendingCleanups]); } while (hasPendingCleanups());
  }

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

    if (value.owner && value.params) { preparedFxUnits.add(value); return; }

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

  function clearRunFxChain({preservePrepared = false} = {}) {
    const currentChain = megaDrive.getFXChain?.();
    // Prepared effects and their tails belong to the live session. Clearing
    // a native rack also stops its samples, so leave a reusable chain intact.
    if (preservePrepared && currentChain && currentChain.every(effect =>
      preparedFxUnits.has(effect) || containsPreparedFxUnit(effect))) return;
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

    if (value.owner && value.params) { collected.add(value); return; }

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
    preparedGeneration += 1;
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

    const generation = preparedGeneration;
    const result = await fn(api);
    if (generation !== preparedGeneration) throw new Error("Run stopped");
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

  function liveCleanup(
    names,
    fn,
    evaluationState
  ) {
    if (
      !Array.isArray(names) ||
      names.length === 0
    ) {
      throw new Error(
        "liveCleanup(names, fn) requires a non-empty string array"
      );
    }

    if (typeof fn !== "function") {
      throw new Error(
        "liveCleanup(names, fn) requires a callback"
      );
    }

    const normalizedNames =
      names.map((name) => {
        if (
          typeof name !== "string" ||
          name.length === 0
        ) {
          throw new Error(
            "liveCleanup(names, fn) requires non-empty string names"
          );
        }
        return name;
      });

    const id = `${evaluationState.cleanupScope}:${evaluationState.cleanupCallIndex}`;
    evaluationState.cleanupCallIndex +=
      1;
    evaluationState.cleanupDefinitions.push(
      {
        id,
        cleanupScope:
          evaluationState.cleanupScope,
        names: normalizedNames,
        fn,
      }
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
    cancelWaits(state);
    flushLiveCleanups();
  }

  function stopAllLoops() {
    for (const state of runtime.liveLoops.values()) {
      state.stopped = true;
      state.runToken += 1;
      cancelWaits(state);
    }
    flushLiveCleanups();
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
          await executeCallback(
            () => state.currentFn()
          );
          await finishTasks(state);
          if (state.interruptError) throw state.interruptError;
          state.stableFn =
            state.currentFn;
          state.hasStableRun = true;
        } catch (error) {
          if (
            state.interruptError || isRunStoppedError(error)
          ) {
            throw error;
          }

          console.error(error);
          logLine(
            `[liveLoop:${state.name}] ${formatLogArgs([error])}`
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
          `[liveLoop:${state.name}] ${formatLogArgs([error])}`
        );
        setStatus(
          `Loop error: ${state.name}`
        );
      }
    } finally {
      releaseTasks(state);
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
      flushLiveCleanups();
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

    const sampleCursorSeconds = currentSampleCursor();
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
        sampleCursorSeconds,
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

  function getActiveLoopNames() {
    return Array.from(
      runtime.liveLoops.values()
    )
      .filter(
        (state) => !state.stopped
      )
      .map((state) => state.name);
  }

  function flushLiveCleanups(
    activeNames = new Set(
      [...getActiveLoopNames(), ...getKeyboardNames()]
    )
  ) {
    for (const [
      id,
      definition,
    ] of runtime.liveCleanupHooks.entries()) {
      if (
        definition.names.some((name) =>
          activeNames.has(name)
        )
      ) {
        continue;
      }

      runLiveCleanup(id, definition);
    }
  }

  function runLiveCleanup(id, definition) {
    runtime.liveCleanupHooks.delete(id);
    executingCleanups++;
    try {
      const result = executeCallback(
        () => definition.fn()
      );
      const pending = Promise.resolve(result).catch(
        (error) => {
          console.error(error);
          logLine(
            `[liveCleanup:${definition.names.join(",")}] ${formatLogArgs([error])}`
          );
          setStatus("Cleanup error");
        }
      ).finally(() => pendingCleanups.delete(pending));
      pendingCleanups.add(pending);
    } catch (error) {
      console.error(error);
      logLine(
        `[liveCleanup:${definition.names.join(",")}] ${formatLogArgs([error])}`
      );
      setStatus("Cleanup error");
    } finally { executingCleanups--; }
  }

  function commitLiveCleanups(
    cleanupDefinitions,
    cleanupScope
  ) {
    const activeDefinitionIds =
      new Set(
        cleanupDefinitions.map(
          (definition) =>
            definition.id
        )
      );

    for (const [
      id,
      definition,
    ] of runtime.liveCleanupHooks.entries()) {
      if (
        definition.cleanupScope ===
        cleanupScope &&
        (!activeDefinitionIds.has(id) || definition.keyboardScoped)
      ) {
        // Replacing a source removes its old definition. Run it before
        // discarding it so persistent voices and effects are released.
        runLiveCleanup(id, definition);
      }
    }

    for (const definition of cleanupDefinitions) {
      definition.keyboardScoped = definition.names.some(name => getKeyboardNames().includes(name));
      runtime.liveCleanupHooks.set(
        definition.id,
        definition
      );
    }

    flushLiveCleanups(
      new Set(
        [...getActiveLoopNames(), ...getKeyboardNames()]
      )
    );
  }

  return {
    clearRunFxChain,
    clearPrepared,
    livePrepare,
    liveLoop,
    liveCleanup,
    stopLoop,
    stopAllLoops,
    commitLiveLoops,
    commitLiveCleanups,
    flushLiveCleanups,
    settled,
    hasPendingCleanups,
    getActiveLoopNames,
  };
}
