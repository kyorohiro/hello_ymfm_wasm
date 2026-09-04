let currentRun = null;
let nextRequestId = 1;
const pendingRequests = new Map();

const NETWORK_DISABLED_MESSAGE =
  "Network access is disabled in Tetorica FM2612 Playground.";

let activeWorkerGuardState = null;

function installWorkerExecutionGuards(realm = self) {
  if (activeWorkerGuardState?.realm === realm) {
    activeWorkerGuardState.count += 1;
    return createWorkerGuardRelease(
      activeWorkerGuardState
    );
  }

  const restoreSteps = [];
  const blocked = () => {
    throw new Error(NETWORK_DISABLED_MESSAGE);
  };

  for (const property of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
  ]) {
    patchWorkerProperty(
      realm,
      property,
      property === "fetch"
        ? blocked
        : function BlockedNetworkApi() {
            blocked();
          },
      restoreSteps
    );
  }

  if (realm.navigator) {
    patchWorkerProperty(
      realm.navigator,
      "sendBeacon",
      blocked,
      restoreSteps
    );
  }

  activeWorkerGuardState = {
    realm,
    count: 1,
    restoreSteps,
  };
  return createWorkerGuardRelease(
    activeWorkerGuardState
  );
}

function createWorkerGuardRelease(state) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count -= 1;
    if (state.count > 0) return;
    for (let index = state.restoreSteps.length - 1; index >= 0; index -= 1) {
      state.restoreSteps[index]();
    }
    if (activeWorkerGuardState === state) {
      activeWorkerGuardState = null;
    }
  };
}

async function executeWithWorkerGuards(callback) {
  const restore = installWorkerExecutionGuards();
  try {
    return await callback();
  } finally {
    restore();
  }
}

function patchWorkerProperty(target, property, replacement, restoreSteps) {
  if (!target) return;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, property);
  const original = target[property];
  try {
    target[property] = replacement;
  } catch (_error) {
    return;
  }
  if (target[property] !== replacement) return;
  restoreSteps.push(() => {
    if (hadOwn) {
      target[property] = original;
    } else if (original === undefined) {
      delete target[property];
    } else {
      target[property] = original;
    }
  });
}

function postCommand(command, args = []) {
  postMessage({ type: "command", command, args });
}

function request(command, args = [], loopContext = null) {
  const id = nextRequestId;
  nextRequestId += 1;
  postMessage({ type: "request", id, command, args });
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject, loopContext });
  });
}

function createClock(run) {
  let bpm = 120;
  let clockStart = performance.now() / 1000;
  let sampleClockStart = null;
  let dacLookaheadSeconds = 0.25;

  function secondsPerBeat() {
    return 60 / bpm;
  }

  function currentBeat() {
    return (performance.now() / 1000 - clockStart) / secondsPerBeat();
  }

  async function sleep(seconds) {
    const token = run.token;
    const loopContext = run.currentLoop;
    await new Promise((resolve) => setTimeout(() => {
      run.currentLoop = loopContext;
      resolve();
    }, Math.max(0, Number(seconds) || 0) * 1000));
    if (run.stopped || token !== run.token) {
      throw new Error("Run stopped");
    }
  }

  async function sleepUntil(targetSeconds, loopContext) {
    const token = run.token;
    await new Promise((resolve) => setTimeout(() => {
      run.currentLoop = loopContext;
      resolve();
    }, Math.max(0, targetSeconds - performance.now() / 1000) * 1000));
    if (run.stopped || token !== run.token) {
      throw new Error("Run stopped");
    }
  }

  return {
    currentBeat,
    sleep,
    async sleepSamples(samples, sampleRate = 44100) {
      const duration = Math.max(0, Number(samples) || 0) / Math.max(1, Number(sampleRate) || 44100);
      const loopContext = run.currentLoop;
      if (!loopContext) {
        await sleep(duration);
        return;
      }
      if (sampleClockStart === null) {
        sampleClockStart = performance.now() / 1000 + dacLookaheadSeconds;
      }
      loopContext.sampleCursorSeconds = (loopContext.sampleCursorSeconds ?? 0) + duration;
      await sleepUntil(sampleClockStart + loopContext.sampleCursorSeconds, loopContext);
    },
    async beat(beats = 1) {
      const context = run.currentLoop;
      if (!context) {
        await sleep((Number(beats) || 0) * secondsPerBeat());
        return;
      }
      context.cursorBeat = Math.max(context.cursorBeat, currentBeat()) + (Number(beats) || 0);
      await sleep(Math.max(0, context.cursorBeat - currentBeat()) * secondsPerBeat());
    },
    async nextBeat() {
      const context = run.currentLoop;
      const next = Math.floor(Math.max(context?.cursorBeat ?? 0, currentBeat()) + 0.000001) + 1;
      if (context) context.cursorBeat = next;
      await sleep(Math.max(0, next - currentBeat()) * secondsPerBeat());
    },
    setBpm(value) {
      const next = Number(value);
      if (!Number.isFinite(next) || next <= 0) throw new Error(`Invalid BPM: ${value}`);
      const position = currentBeat();
      bpm = next;
      clockStart = performance.now() / 1000 - position * secondsPerBeat();
    },
    beginSampleSchedule() {
      if (sampleClockStart === null) {
        sampleClockStart = performance.now() / 1000 + dacLookaheadSeconds;
      }
      return Math.round((run.currentLoop?.sampleCursorSeconds ?? 0) * 44100);
    },
    setDacLookahead(value) {
      dacLookaheadSeconds = Math.max(0, Number(value) || 0);
    },
    resetSampleClock() {
      sampleClockStart = null;
    },
  };
}

function createRun(sourceCode, presets, scaleIntervals, capabilities = {}) {
  const run = {
    token: 1,
    generation: 1,
    stopped: false,
    context: {},
    loops: new Map(),
    runningLoops: new Set(),
    collectingLoops: null,
    prepared: new Map(),
    keyboard: new Map(),
    cleanups: [],
    collectingCleanups: null,
    currentLoop: null,
    audioHandles: new Set(),
  };
  const clock = createClock(run);
  run.resetSampleClock = () => clock.resetSampleClock();
  const commandProxy = (command) => (...args) => postCommand(command, args);
  const requestProxy = (command) => (...args) => request(command, args, run.currentLoop);
  const fm = new Proxy({}, {
    get(_target, property) {
      if (property === "read" || property === "readStatus" || property === "getIrq") {
        return requestProxy(`fm.${String(property)}`);
      }
      return commandProxy(`fm.${String(property)}`);
    },
  });
  const sample = new Proxy({}, { get: (_target, property) => requestProxy(`sample.${String(property)}`) });
  const stream = new Proxy({}, { get: (_target, property) => requestProxy(`stream.${String(property)}`) });
  const unavailable = (name) => () => { throw new Error(`${name} is not available for ${capabilities.chip ?? "this chip"}`); };
  const psg = capabilities.psg ? new Proxy({}, {
    get(_target, property) {
      return commandProxy(`psg.${String(property)}`);
    },
  }) : new Proxy({}, { get: () => unavailable("Mega Drive PSG") });
  const dac = capabilities.dac ? {
    loadBase64: (...args) => request("dac.loadBase64", args, run.currentLoop),
    playStream: (...args) => postCommand("dac.playStream", args),
    schedule: (...args) => postCommand("dac.schedule", args),
    scheduleBase64: (...args) => postCommand("dac.scheduleBase64", args),
  } : new Proxy({}, { get: () => unavailable("YM2612 DAC") });
  let nextAudioHandle = 1;
  const createHandle = (kind) => {
    const id = `${kind}-${nextAudioHandle++}`;
    run.audioHandles.add(id);
    return id;
  };
  const handleId = (value) => value?.__playgroundHandle ?? value;
  const control = (id, path) => ({
    get: () => request("audio.get", [id, path], run.currentLoop),
    set: (value) => postCommand("audio.call", [id, path, "set", [value]]),
    rampTo: (value, seconds) => postCommand("audio.call", [id, path, "rampTo", [value, seconds]]),
  });
  const noiseHandle = (id) => ({
    __playgroundHandle: id,
    start: () => postCommand("audio.call", [id, [], "start", []]),
    stop: () => postCommand("audio.call", [id, [], "stop", []]),
    dispose: () => postCommand("audio.call", [id, [], "dispose", []]),
    attack: control(id, ["attack"]),
    release: control(id, ["release"]),
    gain: control(id, ["gain"]),
    pan: control(id, ["pan"]),
    filter: {
      set: (...args) => postCommand("audio.call", [id, ["filter"], "set", args]),
      cutoff: control(id, ["filter", "cutoff"]),
      q: control(id, ["filter", "q"]),
    },
  });
  const fxHandle = (id) => new Proxy(
    { __playgroundHandle: id },
    {
      get(target, property) {
        if (property === "__playgroundHandle") return target.__playgroundHandle;
        return control(id, [String(property)]);
      },
    }
  );
  const fx = new Proxy({}, {
    get(_target, method) {
      if (method === "setChain") return (effects) => postCommand("fx.setChain", [effects.map(handleId)]);
      if (method === "clear") return () => postCommand("fx.clear");
      if (method === "branch" || method === "parallel") return (...effects) => {
        const id = createHandle("fx");
        postCommand("fx.compose", [id, String(method), effects.map(handleId)]);
        return fxHandle(id);
      };
      return (options = {}) => {
        const id = createHandle("fx");
        postCommand("fx.create", [id, String(method), options]);
        return fxHandle(id);
      };
    },
  });
  const noise = {
    create(options = {}) {
      const id = createHandle("noise");
      postCommand("noise.create", [id, options]);
      return { ...noiseHandle(id), type: options.type ?? "white" };
    },
    stopAll: () => postCommand("noise.stopAll"),
  };

  const livePrepare = async (name, fn) => {
    if (run.prepared.has(name)) return run.prepared.get(name);
    const value = await fn({ fm, fx, psg, sample, stream, dac, noise, control: (voice, options) => postCommand("noise.control", [handleId(voice), options]), context: run.context, log: (...args) => postCommand("log", args) });
    run.prepared.set(name, value);
    return value;
  };
  const liveLoop = (name, fn) => {
    if (typeof name !== "string" || !name) throw new Error("liveLoop(name, fn) requires a non-empty name");
    if (typeof fn !== "function") throw new Error("liveLoop(name, fn) requires a callback");
    (run.collectingLoops ?? run.loops).set(name, fn);
  };
  const liveCleanup = (names, fn) => {
    if (!Array.isArray(names) || names.length === 0 || typeof fn !== "function") {
      throw new Error("liveCleanup(names, fn) requires loop names and a callback");
    }
    (run.collectingCleanups ?? run.cleanups).push({ names, fn });
  };
  run.stop = async () => {
    if (run.stopped) return;
    run.stopped = true;
    run.token += 1;
    run.generation += 1;
    for (const cleanup of run.cleanups) {
      await cleanup.fn();
    }
    run.resetSampleClock();
    // In Worker mode this is the sole source of audio-control commands.
    postCommand("audio.stopAll");
    postCommand("fx.detach");
    postCommand("audio.disposeHandles", [[...run.audioHandles]]);
    run.audioHandles.clear();
    run.prepared.clear();
    run.cleanups = [];
    run.keyboard.clear();
    run.loops.clear();
    for (const key of Object.keys(run.context)) delete run.context[key];
  };
  const registerKeyboard = (eventType, name, fn) => {
    if (typeof name !== "string" || !name || typeof fn !== "function") throw new Error("Keyboard handler requires a name and callback");
    const id = `${eventType}:${name}`;
    run.keyboard.set(id, fn);
    postCommand("keyboard.register", [id, eventType]);
  };
  const choose = (values) => values[Math.floor(Math.random() * values.length)];
  const cycle = (values, index = 0) => values[Math.abs(Number(index) || 0) % values.length];
  const noteToMidi = (noteName) => {
    const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(String(noteName).trim());
    const semitones = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
    if (!match || semitones[match[1]] === undefined) throw new Error(`Unsupported note name: ${noteName}`);
    return (Number(match[2]) + 1) * 12 + semitones[match[1]];
  };
  const midiToNote = (midi) => {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  };
  const scale = (root, name, octaves = 1) => {
    const intervals = scaleIntervals[name];
    if (!intervals) throw new Error(`Unknown scale: ${name}`);
    const rootMidi = noteToMidi(root);
    return Array.from({ length: Math.max(0, Number(octaves) || 0) }, (_, octave) => intervals.map((interval) => midiToNote(rootMidi + octave * 12 + interval))).flat();
  };
  const chordIntervals = {
    major: [0, 4, 7], minor: [0, 3, 7], major7: [0, 4, 7, 11],
    minor7: [0, 3, 7, 10], dominant7: [0, 4, 7, 10],
  };
  const chord = (root, name) => {
    const intervals = chordIntervals[name];
    if (!intervals) throw new Error(`Unsupported chord: ${name}`);
    const rootMidi = noteToMidi(root);
    return intervals.map((interval) => midiToNote(rootMidi + interval));
  };
  const pitchFromMidi = (midi) => {
    let block = 4;
    let fnum = 553 * Math.pow(2, (midi - 62) / 12);
    while (fnum >= 1024 && block < 7) {
      fnum /= 2;
      block += 1;
    }
    while (fnum < 512 && block > 0) {
      fnum *= 2;
      block -= 1;
    }
    return { block, fnum: Math.max(0, Math.min(0x7ff, Math.round(fnum))) };
  };
  const noteToBlockFnum = (note) => pitchFromMidi(typeof note === "number" ? note : noteToMidi(note));
  const noteLerp = (from, to, amount) => pitchFromMidi(
    noteToMidi(from) + (noteToMidi(to) - noteToMidi(from)) * Number(amount)
  );
  const tween = async (seconds, fn) => {
    if (typeof fn !== "function") throw new Error("tween(seconds, fn) requires a callback");
    const duration = Math.max(0, Number(seconds) || 0);
    if (duration === 0) return fn(1);
    const startedAt = performance.now();
    await fn(0);
    while (true) {
      const progress = Math.min(1, (performance.now() - startedAt) / (duration * 1000));
      if (progress >= 1) break;
      await clock.sleep(Math.min(1 / 60, duration / 16));
      await fn(Math.min(1, (performance.now() - startedAt) / (duration * 1000)));
    }
    await fn(1);
  };
  const globals = {
    console: {
      log: (...args) => postCommand("log", args),
      warn: (...args) => postCommand("warn", args),
      error: (...args) => postCommand("error", args),
    },
    log: (...args) => postCommand("log", args),
    fm, fx, psg, dac, sample, stream, noise,
    context: run.context,
    FM_PRESETS: presets,
    CH1: 0, CH2: 1, CH3: 2, CH4: 3, CH5: 4, CH6: 5,
    PSG1: 0, PSG2: 1, PSG3: 2,
    OP1: 0, OP2: 1, OP3: 2, OP4: 3,
    write: (...args) => postCommand("write", args),
    play: (...args) => request("play", args, run.currentLoop),
    psgTone: capabilities.psg ? (...args) => postCommand("psgTone", args) : unavailable("Mega Drive PSG"),
    psgNoise: capabilities.psg ? (...args) => postCommand("psgNoise", args) : unavailable("Mega Drive PSG"),
    setMasterVolume: (...args) => request("setMasterVolume", args, run.currentLoop),
    getMasterVolume: () => request("getMasterVolume", [], run.currentLoop),
    setDacLookahead: async (...args) => {
      const value = await request("setDacLookahead", args, run.currentLoop);
      clock.setDacLookahead(value);
      return value;
    },
    getDacLookahead: () => request("getDacLookahead"),
    beginSampleSchedule: () => clock.beginSampleSchedule(),
    scheduleWritesSamples: (start, entries) => postCommand("scheduleWritesSamples", [start, entries]),
    control: (voice, options) => postCommand("noise.control", [handleId(voice), options]),
    sleep: clock.sleep,
    sleepSamples: clock.sleepSamples,
    beat: clock.beat,
    nextBeat: clock.nextBeat,
    setBpm: clock.setBpm,
    livePrepare,
    liveLoop,
    liveCleanup,
    stopLoop: (name) => run.loops.delete(name),
    stopAllLoops: () => run.loops.clear(),
    onKeyboardPressKey: (name, fn) => registerKeyboard("keydown", name, fn),
    onKeyboardReleaseKey: (name, fn) => registerKeyboard("keyup", name, fn),
    stopAll: () => postCommand("stopAll"),
    choose,
    cycle,
    rand: Math.random,
    rrange: (min, max) => Number(min) + Math.random() * (Number(max) - Number(min)),
    randInt: (min, max) => Math.floor(Number(min) + Math.random() * (Number(max) - Number(min) + 1)),
    lerp: (a, b, amount) => Number(a) + (Number(b) - Number(a)) * Number(amount),
    scale,
    chord,
    tween,
    noteToBlockFnum,
    noteLerp,
    presets,
  };
  globals.pg = { ...globals };

  run.handleKeyboard = (id, event) => {
    const handler = run.keyboard.get(id);
    if (!handler) return;
    void executeWithWorkerGuards(
      () => handler(event)
    ).catch((error) => {
      postMessage({
        type: "log",
        level: "error",
        message: `[keyboard:${id}] ${error?.stack ?? String(error)}`,
      });
    });
  };
  run.execute = async (nextSourceCode = sourceCode) => {
    run.collectingLoops = new Map();
    run.collectingCleanups = [];
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const userFunction = new AsyncFunction(...Object.keys(globals), `"use strict";\n${nextSourceCode}`);
    await executeWithWorkerGuards(
      () => userFunction(...Object.values(globals))
    );
    const definitions = run.collectingLoops;
    const cleanupDefinitions = run.collectingCleanups;
    run.collectingLoops = null;
    run.collectingCleanups = null;
    for (const name of run.loops.keys()) {
      if (!definitions.has(name)) run.loops.delete(name);
    }
    for (const [name, fn] of definitions) run.loops.set(name, fn);
    for (const cleanup of run.cleanups) {
      if (!cleanup.names.some((name) => run.loops.has(name))) {
        await executeWithWorkerGuards(
          () => cleanup.fn()
        );
      }
    }
    run.cleanups = cleanupDefinitions;
    for (const name of definitions.keys()) {
      if (run.runningLoops.has(name)) continue;
      run.runningLoops.add(name);
      const generation = run.generation;
      void (async () => {
        while (!run.stopped && generation === run.generation && run.loops.has(name)) {
          try {
            run.currentLoop = { name, cursorBeat: clock.currentBeat?.() ?? 0 };
            await executeWithWorkerGuards(
              () => run.loops.get(name)()
            );
          } catch (error) {
            if (!run.stopped) postMessage({ type: "log", level: "error", message: `[liveLoop:${name}] ${error?.stack ?? String(error)}` });
            await new Promise((resolve) => setTimeout(resolve, 16));
          } finally {
            run.currentLoop = null;
          }
        }
        if (generation === run.generation) run.runningLoops.delete(name);
      })();
    }
  };
  return run;
}

let lifecycleQueue = Promise.resolve();

async function handleLifecycleMessage(message) {
  if (message.type === "run") {
    const previousRun = currentRun;
    currentRun = previousRun ?? createRun(message.sourceCode, message.presets ?? {}, message.scaleIntervals ?? {}, message.capabilities ?? {});
    if (currentRun.stopped) {
      currentRun.stopped = false;
      currentRun.generation += 1;
      currentRun.runningLoops.clear();
      currentRun.resetSampleClock();
    }
    try {
      await currentRun.execute(message.sourceCode);
      postMessage({ type: "complete", loopCount: currentRun.loops.size, keyboardHandlerCount: currentRun.keyboard.size });
    } catch (error) {
      postMessage({ type: "execution-error", message: error?.message ?? String(error), stack: error?.stack });
    }
    return;
  }
  if (message.type === "stop" && currentRun) {
    await currentRun.stop();
    postMessage({ type: "stopped" });
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "response") {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    if (pending.loopContext && currentRun) currentRun.currentLoop = pending.loopContext;
    message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value);
    return;
  }
  if (message.type === "keyboard") {
    currentRun?.handleKeyboard(message.id, message.event);
    return;
  }
  lifecycleQueue = lifecycleQueue
    .catch(() => undefined)
    .then(() => handleLifecycleMessage(message));
};
