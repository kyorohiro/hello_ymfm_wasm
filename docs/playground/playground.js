import {
  MegaDriveSynth,
  createDelayFX,
  createEqFX,
  createFilterFX,
  createGainFX,
  createReverbFX,
  MEGADRIVE_FM_PRESETS,
} from "../js/megasynth.js";
import {
  createPitchFromMidi,
} from "../synth/synth_keyboard.js";

const REFERENCE_MIDI = 62;
const REFERENCE_BLOCK = 4;
const REFERENCE_FNUM = 553;
const NOTE_TO_SEMITONE = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};
const SCALE_INTERVALS = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const EXAMPLES = {
  single: `fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"]);
await play("C4", { channel: 0, duration: 0.35 });
await sleep(0.12);
await play("E4", { channel: 0, duration: 0.35 });
await sleep(0.12);
await play("G4", { channel: 0, duration: 0.5 });
`,
  random: `fm.setPreset(0, MEGADRIVE_FM_PRESETS["two-op-bell"]);
const notes = scale("Eb2", "majorPentatonic", 2);

for (let step = 0; step < 16; step += 1) {
  await play(choose(notes), {
    channel: 0,
    duration: 0.12 + rand() * 0.15,
  });
  await sleep(0.08);
}
`,
  "live-loop": `setBpm(120);

fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setPreset(1, MEGADRIVE_FM_PRESETS["two-op-bell"]);

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", { channel: 0, duration: 0.14 });
  await beat(1);
  await play("E2", { channel: 0, duration: 0.14 });
  await beat(1);
  await play("G2", { channel: 0, duration: 0.14 });
  await beat(1);
  await play("A2", { channel: 0, duration: 0.14 });
  await beat(1);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  //await nextBeat();
  await play(choose(notes), {
    channel: 1,
    duration: 0.08,
  });
  await beat(0.125);
});
`,
  "fm-direct": `fm.reset();
fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setOperator(0, 4, {
  multi: 3,
  tl: 10,
  ar: 24,
  d1r: 8,
  d2r: 5,
  sl: 5,
  rr: 8,
});
fm.setAlgo(0, 7, 0);
fm.setPan(0, true, true);

for (const note of ["C3", "G3", "Bb3", "C4"]) {
  await play(note, { channel: 0, duration: 0.22 });
  await sleep(0.06);
}
`,
  "fx-loop": `setBpm(120);

fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setPreset(1, MEGADRIVE_FM_PRESETS["two-op-bell"]);

const mainFx = await livePrepare("fx-loop-chain", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 2200,
    q: 1.4,
  });
  const delay = fx.delay({
    time: 0.18,
    feedback: 0.32,
    mix: 0.18,
  });
  const reverb = fx.reverb({
    mix: 0.12,
    tone: 6200,
  });

  return {
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  mainFx.filter,
  mainFx.delay,
  mainFx.reverb,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", { channel: 0, duration: 0.12 });
  await beat(1);
  await play("G2", { channel: 0, duration: 0.12 });
  await beat(1);
  await play("A2", { channel: 0, duration: 0.12 });
  await beat(1);
  await play("B2", { channel: 0, duration: 0.12 });
  await beat(1);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  mainFx.filter.cutoff.set(choose([900, 1400, 2200, 3600, 5200]));
  mainFx.delay.mix.set(choose([0.1, 0.16, 0.22]));
  await play(choose(notes), {
    channel: 1,
    duration: 0.08,
  });
  await beat(0.125);
});
`,
  "fx-motion": `setBpm(120);

fm.setPreset(0, MEGADRIVE_FM_PRESETS["four-op-pad"]);
fm.setPreset(1, MEGADRIVE_FM_PRESETS["two-op-bell"]);

const mainFx = await livePrepare("fx-motion-chain", async ({ fx }) => {
  const gain = fx.gain({
    gain: 0.9,
  });
  const eq = fx.eq({
    bass: 0,
    mid: 0,
    treble: 0,
  });
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 1200,
    q: 1.1,
  });
  const delay = fx.delay({
    time: 0.24,
    feedback: 0.28,
    mix: 0.16,
  });
  const reverb = fx.reverb({
    mix: 0.18,
    tone: 5400,
  });

  return {
    gain,
    eq,
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  mainFx.gain,
  mainFx.eq,
  mainFx.filter,
  mainFx.delay,
  mainFx.reverb,
]);

liveLoop("pad", async () => {
  await nextBeat();
  await play("E3", { channel: 0, duration: 0.45 });
  await beat(2);
  await play("G3", { channel: 0, duration: 0.45 });
  await beat(2);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  await play(choose(notes), {
    channel: 1,
    duration: 0.08,
  });
  await beat(0.25);
});

liveLoop("fx-motion", async () => {
  mainFx.eq.bass.rampTo(
    choose([-6, -3, 0, 3, 6]),
    0.18
  );
  mainFx.eq.mid.rampTo(
    choose([-5, -2, 0, 2, 5]),
    0.18
  );
  mainFx.eq.treble.rampTo(
    choose([-6, -2, 0, 3, 7]),
    0.18
  );
  mainFx.filter.cutoff.rampTo(
    choose([800, 1200, 1800, 2600, 4200, 6400]),
    0.18
  );
  mainFx.delay.mix.rampTo(
    choose([0.08, 0.12, 0.18, 0.24]),
    0.12
  );
  mainFx.reverb.mix.set(
    choose([0.1, 0.16, 0.22])
  );
  await beat(0.5);
});
`,
};

const runButton =
  document.getElementById("runButton");
const stopButton =
  document.getElementById("stopButton");
const loadExampleButton =
  document.getElementById(
    "loadExampleButton"
  );
const exampleSelect =
  document.getElementById(
    "exampleSelect"
  );
const editor =
  document.getElementById("editor");
const status =
  document.getElementById("status");
const runtimeState =
  document.getElementById(
    "runtimeState"
  );
const consoleOutput =
  document.getElementById(
    "consoleOutput"
  );

const megaDrive =
  new MegaDriveSynth({
    workletUrl:
      "../js/ym2612-worklet.js",
    ym2612WasmUrl:
      "../generated/ym2612_wasm.wasm",
  });

let synth = null;
let currentRunToken = 0;
let activeNotes = new Set();
let currentLoopContext = null;
const playgroundRuntime = {
  bpm: 120,
  clockStartTime: null,
  liveLoops: new Map(),
  livePrepared: new Map(),
};
const preparedFxUnits =
  new WeakSet();

function createFxApi() {
  if (!megaDrive.audioContext) {
    throw new Error(
      "Audio is not ready yet"
    );
  }

  return {
    gain(options = {}) {
      return createGainFX(
        megaDrive.audioContext,
        options
      );
    },

    eq(options = {}) {
      return createEqFX(
        megaDrive.audioContext,
        options
      );
    },

    filter(options = {}) {
      return createFilterFX(
        megaDrive.audioContext,
        options
      );
    },

    delay(options = {}) {
      return createDelayFX(
        megaDrive.audioContext,
        options
      );
    },

    reverb(options = {}) {
      return createReverbFX(
        megaDrive.audioContext,
        options
      );
    },

    setChain(effects = []) {
      megaDrive.setFXChain(
        effects
      );
      return effects;
    },

    clear(options = {}) {
      return megaDrive.clearFXChain(
        options
      );
    },
  };
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

  if (value.input && value.output) {
    preparedFxUnits.add(value);
  }

  for (const nestedValue of Object.values(value)) {
    markPreparedFxUnits(nestedValue);
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
    playgroundRuntime.livePrepared.has(
      name
    )
  ) {
    return playgroundRuntime.livePrepared.get(
      name
    );
  }

  const result =
    await fn(api);
  playgroundRuntime.livePrepared.set(
    name,
    result
  );
  markPreparedFxUnits(result);
  return result;
}

function setStatus(message) {
  status.textContent = message;
}

function setRuntimeState(message) {
  runtimeState.textContent = message;
}

function logLine(message) {
  consoleOutput.textContent += `${message}\n`;
  consoleOutput.scrollTop =
    consoleOutput.scrollHeight;
}

function clearConsole() {
  consoleOutput.textContent = "";
}

function nowSeconds() {
  if (megaDrive.audioContext) {
    return megaDrive.audioContext.currentTime;
  }

  return performance.now() / 1000;
}

function ensureMusicClock() {
  if (
    playgroundRuntime.clockStartTime ===
    null
  ) {
    playgroundRuntime.clockStartTime =
      nowSeconds();
  }
}

function beatsToSeconds(beats) {
  return (
    beats * 60 /
    playgroundRuntime.bpm
  );
}

function currentBeat() {
  ensureMusicClock();
  return (
    (nowSeconds() -
      playgroundRuntime.clockStartTime) /
    beatsToSeconds(1)
  );
}

function resolveWithLoopContext(
  resolve,
  value,
  loopState = null
) {
  currentLoopContext = loopState;
  resolve(value);
}

async function ensureReady() {
  if (synth) {
    await megaDrive.resume();
    setRuntimeState("Audio ready");
    return;
  }

  setStatus(
    "Loading Mega Drive audio..."
  );
  setRuntimeState("Preparing...");
  await megaDrive.start();
  synth = megaDrive.fm;
  synth.setPreset(
    0,
    MEGADRIVE_FM_PRESETS[
      "one-op-basic"
    ]
  );
  setRuntimeState("Audio ready");
  setStatus("Audio ready.");
}

function stopAll() {
  if (!synth) {
    return;
  }

  for (let channel = 0; channel < 6; channel += 1) {
    synth.noteOff(channel);
  }
  activeNotes.clear();
}

function parseNoteName(noteName) {
  const match =
    /^([A-G](?:#|b)?)(-?\d+)$/.exec(
      String(noteName).trim()
    );

  if (!match) {
    throw new Error(
      `Unsupported note name: ${noteName}`
    );
  }

  const [, note, octaveText] =
    match;
  const semitone =
    NOTE_TO_SEMITONE[note];

  if (semitone === undefined) {
    throw new Error(
      `Unsupported note: ${note}`
    );
  }

  const octave =
    Number(octaveText);
  return (octave + 1) * 12 + semitone;
}

function toPitch(noteOrMidi) {
  const midi =
    typeof noteOrMidi === "number"
      ? noteOrMidi
      : parseNoteName(noteOrMidi);

  return createPitchFromMidi(midi, {
    referenceMidi:
      REFERENCE_MIDI,
    referenceBlock:
      REFERENCE_BLOCK,
    referenceFnum:
      REFERENCE_FNUM,
  });
}

async function sleep(seconds, runToken = currentRunToken) {
  const loopState =
    currentLoopContext;
  const effectiveToken =
    loopState?.runToken ?? runToken;
  const waitMs =
    Math.max(0, seconds * 1000);

  await new Promise((resolve) => {
    window.setTimeout(() => {
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
        currentRunToken)
  ) {
    throw new Error("Run stopped");
  }
}

async function waitForBeat(
  targetBeat,
  runToken = currentRunToken,
  loopState = currentLoopContext
) {
  ensureMusicClock();
  const effectiveToken =
    loopState?.runToken ?? runToken;
  const targetTime =
    playgroundRuntime.clockStartTime +
    beatsToSeconds(targetBeat);
  const waitMs =
    Math.max(
      0,
      (targetTime - nowSeconds()) *
        1000
    );

  await new Promise((resolve) => {
    window.setTimeout(() => {
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
        currentRunToken)
  ) {
    throw new Error("Run stopped");
  }
}

async function beat(
  beats = 1
) {
  const loopState =
    currentLoopContext;

  if (!loopState) {
    await sleep(
      beatsToSeconds(beats)
    );
    return;
  }

  const baseBeat =
    Math.max(
      loopState.cursorBeat,
      currentBeat()
    );
  loopState.cursorBeat =
    baseBeat + beats;
  await waitForBeat(
    loopState.cursorBeat,
    currentRunToken,
    loopState
  );
}

async function nextBeat() {
  const loopState =
    currentLoopContext;

  if (!loopState) {
    const next =
      Math.floor(
        currentBeat() + 0.000001
      ) + 1;
    await waitForBeat(next);
    return;
  }

  const baseBeat =
    Math.max(
      loopState.cursorBeat,
      currentBeat()
    );
  loopState.cursorBeat =
    Math.floor(baseBeat + 0.000001) +
    1;
  await waitForBeat(
    loopState.cursorBeat,
    currentRunToken,
    loopState
  );
}

function setBpm(bpm) {
  const nextBpm =
    Number(bpm);

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
  playgroundRuntime.bpm = nextBpm;
  playgroundRuntime.clockStartTime =
    nowSeconds() -
    beatsToSeconds(beatPosition);
}

async function play(
  note,
  options = {}
) {
  if (!synth) {
    throw new Error(
      "Audio is not ready yet"
    );
  }

  const channel =
    options.channel ?? 0;
  const duration =
    options.duration ?? 0.2;
  const presetName =
    options.preset ?? null;

  if (presetName) {
    const preset =
      MEGADRIVE_FM_PRESETS[
        presetName
      ];
    if (!preset) {
      throw new Error(
        `Unknown preset: ${presetName}`
      );
    }
    synth.setPreset(
      channel,
      preset
    );
  }

  const pitch = toPitch(note);
  synth.noteOn(
    channel,
    pitch.block,
    pitch.fnum
  );
  activeNotes.add(channel);
  logLine(
    `play ${String(note)} ch=${channel + 1}`
  );

  await sleep(duration);

  synth.noteOff(channel);
  activeNotes.delete(channel);
}

function liveLoop(name, fn, evaluationState) {
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
    playgroundRuntime.liveLoops.get(
      name
    );

  if (!state) {
    return;
  }

  state.stopped = true;
  state.runToken += 1;
}

function stopAllLoops() {
  for (const state of playgroundRuntime.liveLoops.values()) {
    state.stopped = true;
    state.runToken += 1;
  }
}

async function runLiveLoop(state) {
  try {
    while (!state.stopped) {
      state.currentFn = state.nextFn;
      state.cursorBeat = Math.max(
        state.cursorBeat,
        currentBeat()
      );
      currentLoopContext = state;
      await state.currentFn();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Run stopped"
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
      playgroundRuntime.liveLoops.get(
        state.name
      ) === state
    ) {
      playgroundRuntime.liveLoops.delete(
        state.name
      );
    }

    currentLoopContext = null;
  }
}

function commitLiveLoops(
  loopDefinitions
) {
  const activeNames = new Set(
    loopDefinitions.keys()
  );

  for (const [name, state] of playgroundRuntime.liveLoops.entries()) {
    if (!activeNames.has(name)) {
      stopLoop(name);
    }
  }

  for (const [name, fn] of loopDefinitions.entries()) {
    const existing =
      playgroundRuntime.liveLoops.get(
        name
      );

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
    };
    playgroundRuntime.liveLoops.set(
      name,
      state
    );
    void runLiveLoop(state);
  }
}

function scale(
  root,
  name,
  octaves = 1
) {
  const intervals =
    SCALE_INTERVALS[name];

  if (!intervals) {
    throw new Error(
      `Unknown scale: ${name}`
    );
  }

  const rootMidi =
    parseNoteName(root);
  const notes = [];

  for (
    let octave = 0;
    octave < octaves;
    octave += 1
  ) {
    for (const interval of intervals) {
      notes.push(
        midiToNoteName(
          rootMidi +
            octave * 12 +
            interval
        )
      );
    }
  }

  return notes;
}

function choose(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      "choose() requires a non-empty array"
    );
  }

  return values[
    Math.floor(Math.random() * values.length)
  ];
}

function rand() {
  return Math.random();
}

function randInt(min, max) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return (
    Math.floor(
      Math.random() *
        (high - low + 1)
    ) + low
  );
}

function midiToNoteName(midi) {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const note =
    names[
      ((midi % 12) + 12) % 12
    ];
  const octave =
    Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

async function runCode() {
  currentRunToken += 1;
  const runToken =
    currentRunToken;
  runButton.disabled = true;
  clearConsole();

  try {
    await ensureReady();
    clearRunFxChain();
    setStatus("Running...");
    setRuntimeState("Running");
    const evaluationState = {
      loopDefinitions: new Map(),
    };
    const fx = createFxApi();

    const api = {
      fm: synth,
      fx,
      livePrepare: (name, fn) =>
        livePrepare(name, fn, {
          fm: synth,
          fx,
          log: (...args) => {
            logLine(
              args
                .map((value) =>
                  typeof value === "string"
                    ? value
                    : JSON.stringify(value)
                )
                .join(" ")
            );
          },
        }),
      play: (note, options) =>
        play(note, options),
      sleep: (seconds) =>
        sleep(seconds, runToken),
      beat,
      nextBeat,
      setBpm,
      liveLoop: (name, fn) =>
        liveLoop(
          name,
          fn,
          evaluationState
        ),
      stopLoop,
      stopAllLoops,
      stopAll,
      choose,
      rand,
      randInt,
      scale,
      MEGADRIVE_FM_PRESETS,
      log: (...args) => {
        logLine(
          args
            .map((value) =>
              typeof value === "string"
                ? value
                : JSON.stringify(value)
            )
            .join(" ")
        );
      },
    };

    const AsyncFunction =
      Object.getPrototypeOf(
        async function () {}
      ).constructor;
    const userFunction =
      new AsyncFunction(
        ...Object.keys(api),
        `"use strict";\n${editor.value}`
      );

    await userFunction(
      ...Object.values(api)
    );
    commitLiveLoops(
      evaluationState.loopDefinitions
    );

    if (runToken === currentRunToken) {
      setStatus(
        evaluationState.loopDefinitions.size > 0
          ? `Running ${evaluationState.loopDefinitions.size} live loop(s).`
          : "Done."
      );
      setRuntimeState("Audio ready");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Run stopped"
    ) {
      setStatus("Stopped.");
      setRuntimeState("Audio ready");
    } else {
      console.error(error);
      setStatus(
        `Error: ${error.message}`
      );
      setRuntimeState("Error");
      logLine(
        error?.stack ?? String(error)
      );
    }
  } finally {
    if (runToken === currentRunToken) {
      runButton.disabled = false;
    }
  }
}

function stopRun() {
  currentRunToken += 1;
  stopAllLoops();
  stopAll();
  clearRunFxChain();
  megaDrive.stopRecordingPlayback?.();
  setStatus("Stopped.");
  setRuntimeState("Audio ready");
  runButton.disabled = false;
}

function loadExample() {
  const nextCode =
    EXAMPLES[
      exampleSelect.value
    ] ?? EXAMPLES.single;
  editor.value = nextCode;
  setStatus(
    `Loaded example: ${exampleSelect.value}`
  );
}

runButton.addEventListener(
  "click",
  () => {
    void runCode();
  }
);

stopButton.addEventListener(
  "click",
  () => {
    stopRun();
  }
);

loadExampleButton.addEventListener(
  "click",
  () => {
    loadExample();
  }
);

exampleSelect.value = "live-loop";
editor.value = EXAMPLES["live-loop"];
clearConsole();
setRuntimeState("Audio idle");
