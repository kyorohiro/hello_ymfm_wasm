let currentRun = null;
let nextRequestId = 1;
const pendingRequests = new Map();

function postCommand(command, args = []) {
  postMessage({ type: "command", command, args });
}

function request(command, args = []) {
  const id = nextRequestId;
  nextRequestId += 1;
  postMessage({ type: "request", id, command, args });
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
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
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(seconds) || 0) * 1000));
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

function createRun(sourceCode, presets) {
  const run = {
    token: 1,
    stopped: false,
    context: {},
    loops: new Map(),
    prepared: new Map(),
    keyboard: new Map(),
    currentLoop: null,
  };
  const clock = createClock(run);
  const commandProxy = (command) => (...args) => postCommand(command, args);
  const requestProxy = (command) => (...args) => request(command, args);
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
    loadBase64: (...args) => request("dac.loadBase64", args),
    playStream: (...args) => postCommand("dac.playStream", args),
    schedule: (...args) => postCommand("dac.schedule", args),
    scheduleBase64: (...args) => postCommand("dac.scheduleBase64", args),
  };

  const livePrepare = async (name, fn) => {
    if (run.prepared.has(name)) return run.prepared.get(name);
    const value = await fn({ fm, psg, sample, stream, dac, context: run.context });
    run.prepared.set(name, value);
    return value;
  };
  const liveLoop = (name, fn) => {
    if (typeof name !== "string" || !name) throw new Error("liveLoop(name, fn) requires a non-empty name");
    if (typeof fn !== "function") throw new Error("liveLoop(name, fn) requires a callback");
    run.loops.set(name, fn);
  };
  const registerKeyboard = (eventType, name, fn) => {
    if (typeof name !== "string" || !name || typeof fn !== "function") throw new Error("Keyboard handler requires a name and callback");
    const id = `${eventType}:${name}`;
    run.keyboard.set(id, fn);
    postCommand("keyboard.register", [id, eventType]);
  };
  const choose = (values) => values[Math.floor(Math.random() * values.length)];
  const cycle = (values, index = 0) => values[Math.abs(Number(index) || 0) % values.length];
  const globals = {
    console: {
      log: (...args) => postCommand("log", args),
      warn: (...args) => postCommand("warn", args),
      error: (...args) => postCommand("error", args),
    },
    fm, psg, dac, sample, stream,
    context: run.context,
    FM_PRESETS: presets,
    CH1: 0, CH2: 1, CH3: 2, CH4: 3, CH5: 4, CH6: 5,
    OP1: 0, OP2: 1, OP3: 2, OP4: 3,
    write: (...args) => postCommand("write", args),
    play: (...args) => request("play", args),
    psgTone: (...args) => postCommand("psgTone", args),
    psgNoise: (...args) => postCommand("psgNoise", args),
    setMasterVolume: (...args) => request("setMasterVolume", args),
    getMasterVolume: () => request("getMasterVolume"),
    setDacLookahead: (...args) => request("setDacLookahead", args),
    getDacLookahead: () => request("getDacLookahead"),
    sleep: clock.sleep,
    sleepSamples: clock.sleepSamples,
    beat: clock.beat,
    nextBeat: clock.nextBeat,
    setBpm: clock.setBpm,
    livePrepare,
    liveLoop,
    onKeyboardPressKey: (name, fn) => registerKeyboard("keydown", name, fn),
    onKeyboardReleaseKey: (name, fn) => registerKeyboard("keyup", name, fn),
    stopAll: () => postCommand("stopAll"),
    choose,
    cycle,
    rand: Math.random,
    rrange: (min, max) => Number(min) + Math.random() * (Number(max) - Number(min)),
    randInt: (min, max) => Math.floor(Number(min) + Math.random() * (Number(max) - Number(min) + 1)),
    lerp: (a, b, amount) => Number(a) + (Number(b) - Number(a)) * Number(amount),
  };
  globals.pg = { ...globals };

  run.handleKeyboard = (id, event) => {
    const handler = run.keyboard.get(id);
    if (handler) handler(event);
  };
  run.execute = async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const userFunction = new AsyncFunction(...Object.keys(globals), `"use strict";\n${sourceCode}`);
    await userFunction(...Object.values(globals));
    for (const [name, fn] of run.loops) {
      void (async () => {
        while (!run.stopped) {
          try {
            run.currentLoop = { name, cursorBeat: clock.currentBeat?.() ?? 0 };
            await fn();
          } catch (error) {
            if (!run.stopped) postMessage({ type: "log", level: "error", message: `[liveLoop:${name}] ${error?.stack ?? String(error)}` });
            await new Promise((resolve) => setTimeout(resolve, 16));
          } finally {
            run.currentLoop = null;
          }
        }
      })();
    }
  };
  return run;
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "run") {
    currentRun?.stop?.();
    currentRun = createRun(message.sourceCode, message.presets ?? {});
    try {
      await currentRun.execute();
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
    message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value);
    return;
  }
  if (message.type === "keyboard") currentRun?.handleKeyboard(message.id, message.event);
  if (message.type === "stop" && currentRun) {
    currentRun.stopped = true;
    currentRun.token += 1;
  }
};
