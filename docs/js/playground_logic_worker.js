let currentRun = null;
let nextRequestId = 1;
const pendingRequests = new Map();

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

  return {
    currentBeat,
    sleep,
    async sleepSamples(samples, sampleRate = 44100) {
      await sleep((Math.max(0, Number(samples) || 0)) / Math.max(1, Number(sampleRate) || 44100));
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
  };
}

function createRun(sourceCode, presets, scaleIntervals) {
  const run = {
    token: 1,
    stopped: false,
    context: {},
    loops: new Map(),
    runningLoops: new Set(),
    collectingLoops: null,
    prepared: new Map(),
    keyboard: new Map(),
    cleanups: [],
    currentLoop: null,
  };
  const clock = createClock(run);
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
  const psg = { write: commandProxy("psg.write") };
  const dac = {
    loadBase64: (...args) => request("dac.loadBase64", args, run.currentLoop),
    playStream: (...args) => postCommand("dac.playStream", args),
    schedule: (...args) => postCommand("dac.schedule", args),
    scheduleBase64: (...args) => postCommand("dac.scheduleBase64", args),
  };
  let nextAudioHandle = 1;
  const createHandle = (kind) => `${kind}-${nextAudioHandle++}`;
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
      return noiseHandle(id);
    },
    stopAll: () => postCommand("noise.stopAll"),
  };

  const livePrepare = async (name, fn) => {
    if (run.prepared.has(name)) return run.prepared.get(name);
    const value = await fn({ fm, fx, psg, sample, stream, dac, noise, control: (voice, options) => postCommand("noise.control", [handleId(voice), options]), context: run.context });
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
    run.cleanups.push({ names, fn });
  };
  run.stop = async () => {
    if (run.stopped) return;
    run.stopped = true;
    run.token += 1;
    for (const cleanup of run.cleanups) {
      await cleanup.fn();
    }
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
  const globals = {
    console: {
      log: (...args) => postCommand("log", args),
      warn: (...args) => postCommand("warn", args),
      error: (...args) => postCommand("error", args),
    },
    fm, fx, psg, dac, sample, stream, noise,
    context: run.context,
    FM_PRESETS: presets,
    CH1: 0, CH2: 1, CH3: 2, CH4: 3, CH5: 4, CH6: 5,
    OP1: 0, OP2: 1, OP3: 2, OP4: 3,
    write: (...args) => postCommand("write", args),
    play: (...args) => request("play", args, run.currentLoop),
    psgTone: (...args) => postCommand("psgTone", args),
    psgNoise: (...args) => postCommand("psgNoise", args),
    setMasterVolume: (...args) => request("setMasterVolume", args, run.currentLoop),
    getMasterVolume: () => request("getMasterVolume", [], run.currentLoop),
    setDacLookahead: (...args) => request("setDacLookahead", args),
    getDacLookahead: () => request("getDacLookahead"),
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
  };
  globals.pg = { ...globals };

  run.handleKeyboard = (id, event) => {
    const handler = run.keyboard.get(id);
    if (handler) handler(event);
  };
  run.execute = async (nextSourceCode = sourceCode) => {
    run.collectingLoops = new Map();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const userFunction = new AsyncFunction(...Object.keys(globals), `"use strict";\n${nextSourceCode}`);
    await userFunction(...Object.values(globals));
    const definitions = run.collectingLoops;
    run.collectingLoops = null;
    for (const name of run.loops.keys()) {
      if (!definitions.has(name)) run.loops.delete(name);
    }
    for (const [name, fn] of definitions) run.loops.set(name, fn);
    for (const name of definitions.keys()) {
      if (run.runningLoops.has(name)) continue;
      run.runningLoops.add(name);
      void (async () => {
        while (!run.stopped && run.loops.has(name)) {
          try {
            run.currentLoop = { name, cursorBeat: clock.currentBeat?.() ?? 0 };
            await run.loops.get(name)();
          } catch (error) {
            if (!run.stopped) postMessage({ type: "log", level: "error", message: `[liveLoop:${name}] ${error?.stack ?? String(error)}` });
            await new Promise((resolve) => setTimeout(resolve, 16));
          } finally {
            run.currentLoop = null;
          }
        }
        run.runningLoops.delete(name);
      })();
    }
  };
  return run;
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "run") {
    const previousRun = currentRun;
    currentRun = previousRun ?? createRun(message.sourceCode, message.presets ?? {}, message.scaleIntervals ?? {});
    currentRun.stopped = false;
    try {
      await currentRun.execute(message.sourceCode);
      postMessage({ type: "complete", loopCount: currentRun.loops.size, keyboardHandlerCount: currentRun.keyboard.size });
    } catch (error) {
      postMessage({ type: "execution-error", message: error?.message ?? String(error), stack: error?.stack });
    }
    return;
  }
  if (message.type === "response") {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    if (pending.loopContext && currentRun) currentRun.currentLoop = pending.loopContext;
    message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value);
    return;
  }
  if (message.type === "keyboard") currentRun?.handleKeyboard(message.id, message.event);
  if (message.type === "stop" && currentRun) {
    await currentRun.stop();
    postMessage({ type: "stopped" });
  }
};
