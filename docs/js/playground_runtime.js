import {
  MegaDriveSynth,
  FM_PRESETS,
} from "./megasynth.js";
import * as megaSynthFx from "./megasynth_fx.js";
import {
  createPitchFromMidi,
} from "./pitch.js";
import { createPlaygroundClock } from "./playground_clock.js";
import { executeWithPlaygroundGuards } from "./playground_execution.js";
import { createPlaygroundLive } from "./playground_live.js";
import { createPlaygroundMusic } from "./playground_music.js";
import { createPlaygroundNoiseApi } from "./playground_noise.js";
import { createFmProxy } from "./playground_sync.js";

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

/**
 * @param {{
 *   megaDrive?: MegaDriveSynth | null,
 *   workletUrl?: string,
 *   audioWorkletUrl?: string,
 *   ym2612WasmUrl?: string,
 *   segaPsgWasmUrl?: string,
 *   presets?: Record<string, object>,
 *   logicWorkerUrl?: string | null,
 *   execution?: "main" | "worker",
 *   guardExecution?: boolean,
 *   onStatus?: ((message: string) => void) | null,
 *   onRuntimeState?: ((state: string) => void) | null,
 *   onLog?: ((line: string) => void) | null,
 *   onReady?: ((context: { synth: object, megaDrive: MegaDriveSynth }) => void) | null,
 *   onMegaDriveEvent?: ((event: object) => void) | null,
 * }} [options]
 */
export function createPlaygroundRuntime(
  options = {}
) {
  const megaDrive =
    options.megaDrive ??
    new MegaDriveSynth({
      workletUrl:
        options.audioWorkletUrl ??
        options.workletUrl ??
        "./ym2612-worklet.js",
      ym2612WasmUrl:
        options.ym2612WasmUrl ??
        "./generated/ym2612_wasm.wasm",
      segaPsgWasmUrl:
        options.segaPsgWasmUrl ??
        "./generated/segapsg_wasm.wasm",
    });
  const presets = {
    ...FM_PRESETS,
    ...(options.presets ?? {}),
  };
  const noiseApi =
    createPlaygroundNoiseApi(
      megaDrive
    );
  const sourceMap =
    new Map();
  const dacBanks = new Map();
  const runtime = {
    bpm: 120,
    clockStartTime: null,
    liveLoops: new Map(),
    liveCleanupHooks:
      new Map(),
    livePrepared: new Map(),
    context: {},
    sampleClockStartTime: null,
  };
  const preparedFxUnits =
    new WeakSet();
  const activeNotes =
    new Set();
  const guardExecution =
    options.guardExecution !== false;
  const defaultExecution =
    options.execution ?? "main";
  const logicWorkerUrl =
    options.logicWorkerUrl ??
    new URL(
      "./playground_logic_worker.js",
      import.meta.url
    ).href;

  let synth = null;
  let prepareAudioPromise = null;
  let currentRunToken = 0;
  let currentLoopContext = null;
  const keyboardHandlers = new Map();
  let removeMegaDriveListener =
    null;
  let currentSourceName = null;
  let playbackState = "stopped";
  let logicWorker = null;
  let workerGlobals = null;
  const workerKeyboardHandlers =
    new Map();

  function emitStatus(message) {
    options.onStatus?.(message);
  }

  function emitRuntimeState(state) {
    options.onRuntimeState?.(state);
  }

  function emitLog(line) {
    options.onLog?.(line);
  }

  function setPlaybackState(state) {
    playbackState = state;
  }

  function installMegaDriveListener() {
    if (
      removeMegaDriveListener ||
      typeof options.onMegaDriveEvent !==
        "function"
    ) {
      return;
    }

    removeMegaDriveListener =
      megaDrive.addListener(
        (event) => {
          options.onMegaDriveEvent?.(
            event
          );
        }
      );
  }

  function setMasterVolume(volume) {
    megaDrive.setMasterVolume(
      Number(volume)
    );
    return megaDrive.getMasterVolume();
  }

  function getMasterVolume() {
    return megaDrive.getMasterVolume();
  }

  function controlNoiseVoice(
    voice,
    options = {}
  ) {
    if (
      !voice ||
      typeof voice !== "object" ||
      typeof voice.gain?.set !==
        "function" ||
      typeof voice.gain?.rampTo !==
        "function" ||
      typeof voice.pan?.set !==
        "function" ||
      typeof voice.pan?.rampTo !==
        "function" ||
      typeof voice.filter?.cutoff?.set !==
        "function" ||
      typeof voice.filter?.cutoff
        ?.rampTo !== "function" ||
      typeof voice.filter?.q?.set !==
        "function" ||
      typeof voice.filter?.q?.rampTo !==
        "function"
    ) {
      throw new Error(
        "control(voice, options) currently supports noise voices only"
      );
    }

    const slide =
      Math.max(
        0,
        Number(options.slide) || 0
      );
    const apply = (
      controlParam,
      value
    ) => {
      if (value == null) {
        return;
      }
      if (slide > 0) {
        controlParam.rampTo(
          value,
          slide
        );
        return;
      }
      controlParam.set(value);
    };

    apply(voice.gain, options.gain);
    apply(voice.pan, options.pan);
    apply(
      voice.filter.cutoff,
      options.cutoff
    );
    apply(voice.filter.q, options.q);
  }

  async function loadSample(
    name,
    source
  ) {
    await ensureReady();
    return megaDrive.sample.load(
      name,
      source
    );
  }

  async function playSample(
    name,
    sampleOptions = {}
  ) {
    await ensureReady();
    return megaDrive.sample.play(
      name,
      sampleOptions
    );
  }

  function stopSample(name) {
    megaDrive.sample.stop(name);
  }

  function unloadSample(name) {
    return megaDrive.sample.unload(name);
  }

  async function loadStream(
    name,
    url
  ) {
    await ensureReady();
    return megaDrive.stream.load(
      name,
      url
    );
  }

  async function playStream(
    name,
    streamOptions = {}
  ) {
    await ensureReady();
    return megaDrive.stream.play(
      name,
      streamOptions
    );
  }

  function pauseStream(name) {
    megaDrive.stream.pause(name);
  }

  function stopStream(name) {
    megaDrive.stream.stop(name);
  }

  function unloadStream(name) {
    return megaDrive.stream.unload(name);
  }

  function stopAllNotes() {
    if (!synth) {
      return;
    }

    for (
      let channel = 0;
      channel < 6;
      channel += 1
    ) {
      synth.noteOff(channel);
    }

    activeNotes.clear();
  }

  function stopAllAudio() {
    synth?.clearScheduledWrites?.();
    synth?.write?.(0, 0x2b, 0x00);
    stopAllNotes();
    megaDrive.sample.stopAll();
    megaDrive.stream.stop();
    noiseApi.stopAll();
  }

  const clockApi =
    createPlaygroundClock({
      runtime,
      getAudioContext: () =>
        megaDrive.audioContext,
      getCurrentRunToken: () =>
        currentRunToken,
      getCurrentLoopContext: () =>
        currentLoopContext,
      setCurrentLoopContext: (
        value
      ) => {
        currentLoopContext = value;
      },
    });

  const liveApi =
    createPlaygroundLive({
      runtime,
      megaDrive,
      preparedFxUnits,
      currentBeat:
        clockApi.currentBeat,
      getCurrentLoopContext: () =>
        currentLoopContext,
      setCurrentLoopContext: (
        value
      ) => {
        currentLoopContext = value;
      },
      logLine: emitLog,
      setStatus: emitStatus,
    });

  function psgTone(
    channel,
    period,
    attenuation = 0
  ) {
    const normalizedChannel =
      Number(channel);
    const normalizedPeriod =
      Number(period);
    const normalizedAttenuation =
      Number(attenuation);

    if (
      !Number.isInteger(
        normalizedChannel
      ) ||
      normalizedChannel < 0 ||
      normalizedChannel > 2
    ) {
      throw new Error(
        "psgTone channel must be 0..2"
      );
    }
    if (
      !Number.isInteger(
        normalizedPeriod
      ) ||
      normalizedPeriod < 0 ||
      normalizedPeriod > 0x3ff
    ) {
      throw new Error(
        "psgTone period must be an integer in range 0..1023"
      );
    }
    if (
      !Number.isInteger(
        normalizedAttenuation
      ) ||
      normalizedAttenuation < 0 ||
      normalizedAttenuation > 15
    ) {
      throw new Error(
        "psgTone attenuation must be 0..15"
      );
    }
    if (!megaDrive.psg) {
      throw new Error(
        "PSG is not available"
      );
    }

    const latchBase =
      0x80 |
      (normalizedChannel << 5);
    megaDrive.psg.write(
      latchBase |
        (normalizedPeriod & 0x0f)
    );
    megaDrive.psg.write(
      (normalizedPeriod >> 4) &
        0x3f
    );
    megaDrive.psg.write(
      0x90 |
        (normalizedChannel << 5) |
        normalizedAttenuation
    );
  }

  function psgNoise(
    mode,
    attenuation = 0
  ) {
    const normalizedMode =
      Number(mode);
    const normalizedAttenuation =
      Number(attenuation);

    if (
      !Number.isInteger(
        normalizedMode
      ) ||
      normalizedMode < 0 ||
      normalizedMode > 7
    ) {
      throw new Error(
        "psgNoise mode must be 0..7"
      );
    }
    if (
      !Number.isInteger(
        normalizedAttenuation
      ) ||
      normalizedAttenuation < 0 ||
      normalizedAttenuation > 15
    ) {
      throw new Error(
        "psgNoise attenuation must be 0..15"
      );
    }
    if (!megaDrive.psg) {
      throw new Error(
        "PSG is not available"
      );
    }

    megaDrive.psg.write(
      0xe0 | normalizedMode
    );
    megaDrive.psg.write(
      0xf0 | normalizedAttenuation
    );
  }

  function createFxApi() {
    if (!megaDrive.audioContext) {
      throw new Error(
        "Audio is not ready yet"
      );
    }

    return {
      gain(fxOptions = {}) {
        return megaSynthFx.createGainFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      eq(fxOptions = {}) {
        return megaSynthFx.createEqFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      radioTone(fxOptions = {}) {
        return megaSynthFx.createRadioToneFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      lofi(fxOptions = {}) {
        return megaSynthFx.createLofiFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      stereoWidth(fxOptions = {}) {
        return megaSynthFx.createStereoWidthFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      bitcrusher(fxOptions = {}) {
        return megaSynthFx.createBitcrusherFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      filter(fxOptions = {}) {
        return megaSynthFx.createFilterFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      delay(fxOptions = {}) {
        return megaSynthFx.createDelayFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      distortion(fxOptions = {}) {
        return megaSynthFx.createDistortionFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      compressor(fxOptions = {}) {
        return megaSynthFx.createCompressorFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      gate(fxOptions = {}) {
        return megaSynthFx.createGateFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      wobble(fxOptions = {}) {
        return megaSynthFx.createWobbleFX(
          megaDrive.audioContext,
          {
            ...fxOptions,
            getBeatSeconds: () =>
              clockApi.beatsToSeconds(1),
          }
        );
      },
      flanger(fxOptions = {}) {
        return megaSynthFx.createFlangerFX(
          megaDrive.audioContext,
          {
            ...fxOptions,
            getBeatSeconds: () =>
              clockApi.beatsToSeconds(1),
          }
        );
      },
      chorus(fxOptions = {}) {
        return megaSynthFx.createChorusFX(
          megaDrive.audioContext,
          {
            ...fxOptions,
            getBeatSeconds: () =>
              clockApi.beatsToSeconds(1),
          }
        );
      },
      tapeSaturation(fxOptions = {}) {
        return megaSynthFx.createTapeSaturationFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      reverb(fxOptions = {}) {
        return megaSynthFx.createReverbFX(
          megaDrive.audioContext,
          fxOptions
        );
      },
      branch(...effects) {
        return megaSynthFx.createFXBranch(
          ...effects
        );
      },
      parallel(...branches) {
        return megaSynthFx.createFXParallel(
          megaDrive.audioContext,
          ...branches
        );
      },
      slicer(fxOptions = {}) {
        if (
          typeof megaSynthFx.createSlicerFX !==
            "function"
        ) {
          throw new Error(
            "fx.slicer() is not available in the current megasynth_fx.js build"
          );
        }

        return megaSynthFx.createSlicerFX(
          megaDrive.audioContext,
          {
            ...fxOptions,
            getBeatSeconds: () =>
              clockApi.beatsToSeconds(1),
          }
        );
      },
      setChain(effects = []) {
        megaDrive.setFXChain(
          effects
        );
        return effects;
      },
      clear(fxOptions = {}) {
        return megaDrive.clearFXChain(
          fxOptions
        );
      },
    };
  }

  async function ensureReady() {
    if (prepareAudioPromise) {
      await prepareAudioPromise;
      return synth;
    }

    if (synth) {
      await megaDrive.resume();
      emitRuntimeState(
        "Audio ready"
      );
      return synth;
    }

    emitStatus(
      "Loading Mega Drive audio..."
    );
    emitRuntimeState(
      "Preparing..."
    );

    prepareAudioPromise =
      (async () => {
        await megaDrive.start();
        synth = megaDrive.fm;
        installMegaDriveListener();
        synth.setPreset(
          0,
          presets["one-op-basic"]
        );
        emitRuntimeState(
          "Audio ready"
        );
        emitStatus("Audio ready.");
        options.onReady?.({
          synth,
          megaDrive,
        });
      })();

    try {
      await prepareAudioPromise;
    } finally {
      prepareAudioPromise = null;
    }

    return synth;
  }

  async function initialize() {
    await ensureReady();
  }

  function registerKeyboardHandler(
    eventType,
    name,
    fn,
    evaluationState
  ) {
    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "Keyboard handler name must be a non-empty string"
      );
    }

    if (typeof fn !== "function") {
      throw new Error(
        "Keyboard handler callback must be a function"
      );
    }

    evaluationState.keyboardDefinitions.set(
      `${eventType}:${name}`,
      { eventType, name, fn }
    );
  }

  function clearKeyboardHandlers() {
    for (const handler of keyboardHandlers.values()) {
      window.removeEventListener(
        handler.eventType,
        handler.listener
      );
    }
    keyboardHandlers.clear();
    for (const handler of workerKeyboardHandlers.values()) {
      window.removeEventListener(
        handler.eventType,
        handler.listener
      );
    }
    workerKeyboardHandlers.clear();
  }

  function stopLogicWorker() {
    if (!logicWorker) {
      return;
    }
    logicWorker.postMessage({ type: "stop" });
    logicWorker.terminate();
    logicWorker = null;
    workerGlobals = null;
  }

  function serializeKeyboardEvent(event) {
    return {
      type: event.type,
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
  }

  function registerWorkerKeyboardHandler(
    id,
    eventType
  ) {
    const listener = (event) => {
      logicWorker?.postMessage({
        type: "keyboard",
        id,
        event: serializeKeyboardEvent(event),
      });
    };
    workerKeyboardHandlers.set(id, {
      eventType,
      listener,
    });
    window.addEventListener(eventType, listener);
  }

  async function invokeWorkerCommand(
    command,
    args
  ) {
    const globals = workerGlobals;
    if (!globals) {
      throw new Error("Playground Worker is not running");
    }

    if (command.startsWith("fm.")) {
      const method = command.slice(3);
      if (typeof globals.fm[method] !== "function") {
        throw new Error(`Unsupported fm method: ${method}`);
      }
      return globals.fm[method](...args);
    }
    if (command.startsWith("sample.")) {
      const method = command.slice(7);
      if (typeof globals.sample[method] !== "function") {
        throw new Error(`Unsupported sample method: ${method}`);
      }
      return globals.sample[method](...args);
    }
    if (command.startsWith("stream.")) {
      const method = command.slice(7);
      if (typeof globals.stream[method] !== "function") {
        throw new Error(`Unsupported stream method: ${method}`);
      }
      return globals.stream[method](...args);
    }
    if (command.startsWith("dac.")) {
      const method = command.slice(4);
      if (typeof globals.dac[method] !== "function") {
        throw new Error(`Unsupported dac method: ${method}`);
      }
      return globals.dac[method](...args);
    }

    switch (command) {
      case "write":
      case "play":
      case "psgTone":
      case "psgNoise":
      case "setMasterVolume":
      case "getMasterVolume":
        return globals[command](...args);
      case "psg.write":
        return globals.psg.write(...args);
      case "stopAll":
        return globals.stopAll();
      default:
        throw new Error(`Unsupported Worker command: ${command}`);
    }
  }

  function handleWorkerMessage(event) {
    const message = event.data ?? {};
    if (message.type === "command" || message.type === "request") {
      if (message.command === "keyboard.register") {
        registerWorkerKeyboardHandler(
          message.args[0],
          message.args[1]
        );
        return;
      }
      if (message.command === "log" || message.command === "warn" || message.command === "error") {
        const prefix = message.command === "log" ? "" : `[${message.command}] `;
        emitLog(`${prefix}${formatLogArgs(message.args)}`);
        return;
      }
      void Promise.resolve(
        invokeWorkerCommand(
          message.command,
          message.args ?? []
        )
      ).then(
        (value) => {
          if (message.type === "request") {
            logicWorker?.postMessage({ type: "response", id: message.id, value });
          }
        },
        (error) => {
          if (message.type === "request") {
            logicWorker?.postMessage({ type: "response", id: message.id, error: error?.message ?? String(error) });
          } else {
            emitLog(error?.stack ?? String(error));
          }
        }
      );
    }
  }

  function commitKeyboardHandlers(definitions) {
    clearKeyboardHandlers();

    for (const [id, definition] of definitions) {
      const listener = (event) => {
        definition.fn(event);
      };
      keyboardHandlers.set(
        id,
        {
          eventType: definition.eventType,
          listener,
        }
      );
      window.addEventListener(
        definition.eventType,
        listener
      );
    }
  }

  function createExecutionGlobals(
    runToken
  ) {
    const evaluationState = {
      loopDefinitions: new Map(),
      cleanupDefinitions: [],
      cleanupCallIndex: 0,
      keyboardDefinitions: new Map(),
      cleanupScope:
        currentSourceName ??
        "__anonymous__",
    };
    const fx = createFxApi();
    const fm = createFmProxy(synth);
    const psg = megaDrive.psg;
    const musicApi =
      createPlaygroundMusic({
        noteToSemitone:
          NOTE_TO_SEMITONE,
        scaleIntervals:
          SCALE_INTERVALS,
        createPitchFromMidi,
        pitchReference: {
          referenceMidi:
            REFERENCE_MIDI,
          referenceBlock:
            REFERENCE_BLOCK,
          referenceFnum:
            REFERENCE_FNUM,
        },
        synth: () => synth,
        presets,
        activeNotes,
        sleep: (seconds) =>
          clockApi.sleep(
            seconds,
            runToken
          ),
        getCurrentLoopContext: () =>
          currentLoopContext,
      });
    const sampleApi = {
      load: loadSample,
      play: playSample,
      stop: stopSample,
      stopAll: () =>
        megaDrive.sample.stopAll(),
      unload: unloadSample,
      isLoaded: (name) =>
        megaDrive.sample.isLoaded(name),
      get: (name) =>
        megaDrive.sample.get(name),
      list: () =>
        megaDrive.sample.list(),
    };
    const streamApi = {
      load: loadStream,
      play: playStream,
      pause: pauseStream,
      stop: stopStream,
      unload: unloadStream,
      isLoaded: (name) =>
        megaDrive.stream.isLoaded(name),
      get: (name) =>
        megaDrive.stream.get(name),
      list: () =>
        megaDrive.stream.list(),
    };
    const livePrepareApi = {
      fm,
      fx,
      psg,
      sample: sampleApi,
      stream: streamApi,
      noise: noiseApi,
      control: controlNoiseVoice,
      log: (...args) => {
        emitLog(
          formatLogArgs(args)
        );
      },
    };
    const playgroundConsole = {
      log: (...args) => {
        emitLog(
          formatLogArgs(args)
        );
      },
      warn: (...args) => {
        emitLog(
          `[warn] ${formatLogArgs(args)}`
        );
      },
      error: (...args) => {
        emitLog(
          `[error] ${formatLogArgs(args)}`
        );
      },
    };
    const pg = {
      fm,
      dac: {
        loadBase64: async (name, encoded) => {
          dacBanks.set(name, decodeDacBase64(encoded));
        },
        playStream: (name, { atSamples = 0 } = {}) => {
          const entries = dacBanks.get(name);
          if (!entries) throw new Error(`Unknown DAC bank: ${name}`);
          scheduleWritesSamples(fm, atSamples, entries);
        },
        schedule: (start, entries) => scheduleWritesSamples(fm, start, entries.map(([offset, value]) => [offset, 0, 0x2a, value])),
        scheduleBase64: (start, encoded) => scheduleDacBase64(fm, start, encoded),
      },
      fx,
      psg,
      context: runtime.context,
      sample: sampleApi,
      stream: streamApi,
      noise: noiseApi,
      control: controlNoiseVoice,
      psgTone,
      psgNoise,
      setMasterVolume,
      getMasterVolume,
      CH1: 0,
      CH2: 1,
      CH3: 2,
      CH4: 3,
      CH5: 4,
      CH6: 5,
      OP1: 0,
      OP2: 1,
      OP3: 2,
      OP4: 3,
      presets,
      livePrepare: (name, fn) =>
        liveApi.livePrepare(
          name,
          fn,
          livePrepareApi
        ),
      play: (note, playOptions) =>
        musicApi.play(
          note,
          playOptions
        ),
      write: (...args) =>
        writeYm2612(
          fm,
          ...args
        ),
      beginSampleSchedule: () =>
        beginSampleSchedule(),
      scheduleWritesSamples: (start, entries) =>
        scheduleWritesSamples(fm, start, entries),
      sleep: (seconds) =>
        clockApi.sleep(
          seconds,
          runToken
        ),
      sleepSamples: (
        samples,
        sampleRate = 44100
      ) =>
        sleepSamples(
          samples,
          sampleRate,
          runToken
        ),
      beat: clockApi.beat,
      nextBeat:
        clockApi.nextBeat,
      setBpm:
        clockApi.setBpm,
      tween:
        clockApi.tween,
      liveLoop: (name, fn) =>
        liveApi.liveLoop(
          name,
          fn,
          evaluationState
        ),
      liveCleanup: (
        names,
        fn
      ) =>
        liveApi.liveCleanup(
          names,
          fn,
          evaluationState
        ),
      onKeyboardPressKey: (name, fn) =>
        registerKeyboardHandler(
          "keydown",
          name,
          fn,
          evaluationState
        ),
      onKeyboardReleaseKey: (name, fn) =>
        registerKeyboardHandler(
          "keyup",
          name,
          fn,
          evaluationState
        ),
      stopLoop:
        liveApi.stopLoop,
      stopAllLoops:
        liveApi.stopAllLoops,
      stopAll: stopAllAudio,
      choose:
        musicApi.choose,
      cycle:
        musicApi.cycle,
      rand: musicApi.rand,
      rrange:
        musicApi.rrange,
      randInt:
        musicApi.randInt,
      lerp: musicApi.lerp,
      scale:
        musicApi.scale,
      chord:
        musicApi.chord,
      noteToBlockFnum:
        musicApi.noteToBlockFnum,
      noteLerp:
        musicApi.noteLerp,
      log: (...args) => {
        emitLog(
          formatLogArgs(args)
        );
      },
    };

    return {
      evaluationState,
      globals: {
        console:
          playgroundConsole,
        pg,
        fm,
        dac: pg.dac,
        fx,
        psg,
        sample: pg.sample,
        stream: pg.stream,
        noise: pg.noise,
        control: pg.control,
        psgTone,
        psgNoise,
        setMasterVolume:
          pg.setMasterVolume,
        getMasterVolume:
          pg.getMasterVolume,
        livePrepare: (name, fn) =>
          pg.livePrepare(name, fn),
        play: (note, playOptions) =>
          pg.play(
            note,
            playOptions
          ),
        write: (...args) =>
          pg.write(...args),
        beginSampleSchedule: () =>
          pg.beginSampleSchedule(),
        scheduleWritesSamples: (start, entries) =>
          pg.scheduleWritesSamples(start, entries),
        sleep: (seconds) =>
          pg.sleep(seconds),
        sleepSamples: (
          samples,
          sampleRate
        ) =>
          pg.sleepSamples(
            samples,
            sampleRate
          ),
        beat: pg.beat,
        nextBeat: pg.nextBeat,
        setBpm: pg.setBpm,
        tween: pg.tween,
        context:
          pg.context,
        liveLoop: (name, fn) =>
          pg.liveLoop(name, fn),
        liveCleanup: (
          names,
          fn
        ) =>
          pg.liveCleanup(
            names,
            fn
          ),
        onKeyboardPressKey: (name, fn) =>
          pg.onKeyboardPressKey(name, fn),
        onKeyboardReleaseKey: (name, fn) =>
          pg.onKeyboardReleaseKey(name, fn),
        stopLoop:
          pg.stopLoop,
        stopAllLoops:
          pg.stopAllLoops,
        stopAll:
          pg.stopAll,
        choose: pg.choose,
        cycle: pg.cycle,
        rand: pg.rand,
        rrange: pg.rrange,
        randInt: pg.randInt,
        lerp: pg.lerp,
        scale: pg.scale,
        chord: pg.chord,
        noteToBlockFnum:
          pg.noteToBlockFnum,
        noteLerp:
          pg.noteLerp,
        CH1: pg.CH1,
        CH2: pg.CH2,
        CH3: pg.CH3,
        CH4: pg.CH4,
        CH5: pg.CH5,
        CH6: pg.CH6,
        OP1: pg.OP1,
        OP2: pg.OP2,
        OP3: pg.OP3,
        OP4: pg.OP4,
        FM_PRESETS: presets,
        sample: pg.sample,
        stream: pg.stream,
        control: pg.control,
        log: pg.log,
      },
    };
  }

  function writeYm2612(
    fm,
    ...args
  ) {
    if (args.length === 2) {
      fm.write(
        0,
        Number(args[0]),
        Number(args[1])
      );
      return;
    }
    if (args.length === 3) {
      fm.write(
        Number(args[0]),
        Number(args[1]),
        Number(args[2])
      );
      return;
    }
    throw new Error(
      "write(register, value) or write(port, register, value) is required"
    );
  }

  function beginSampleSchedule() {
    if (runtime.sampleClockStartTime === null) {
      runtime.sampleClockStartTime =
        megaDrive.audioContext.currentTime + 0.25;
    }
    return Math.round(
      (currentLoopContext?.sampleCursorSeconds ?? 0) * 44100
    );
  }

  function scheduleWritesSamples(fm, startSamples, entries) {
    const start = Math.max(0, Number(startSamples) || 0);
    const origin = runtime.sampleClockStartTime ??
      (megaDrive.audioContext.currentTime + 0.25);
    runtime.sampleClockStartTime = origin;
    fm.scheduleWrites(entries.map(([offset, port, register, value]) => ({
      time: origin + (start + Number(offset)) / 44100,
      port: Number(port),
      register: Number(register),
      value: Number(value),
    })));
  }

  function scheduleDacBase64(fm, startSamples, encoded) {
    scheduleWritesSamples(fm, startSamples, decodeDacBase64(encoded));
  }

  function decodeDacBase64(encoded) {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const entries = [];
    for (let offset = 0; offset < bytes.length; offset += 5) {
      entries.push([view.getUint32(offset, true), 0, 0x2a, bytes[offset + 4]]);
    }
    return entries;
  }


  function sleepSamples(
    samples,
    sampleRate = 44100,
    runToken
  ) {
    const validSamples = Math.max(
      0,
      Number(samples) || 0
    );
    const validRate = Math.max(
      1,
      Number(sampleRate) || 44100
    );
    return clockApi.sleepSamples(
      validSamples,
      validRate,
      runToken
    );
  }

  async function playSourceInWorker(sourceCode) {
    if (typeof Worker !== "function") {
      throw new Error(
        "Worker execution is not available in this environment"
      );
    }

    currentRunToken += 1;
    const runToken = currentRunToken;
    await ensureReady();
    stopLogicWorker();
    clearKeyboardHandlers();
    liveApi.stopAllLoops();
    liveApi.clearRunFxChain();
    setPlaybackState("running");
    emitStatus("Starting Playground Worker...");
    emitRuntimeState("Running");

    const { globals } =
      createExecutionGlobals(runToken);
    workerGlobals = globals;
    const worker = new Worker(logicWorkerUrl, {
      type: "module",
    });
    logicWorker = worker;

    await new Promise((resolve, reject) => {
      const fail = (error) => {
        if (logicWorker === worker) {
          stopLogicWorker();
        }
        reject(error);
      };
      worker.onmessage = (event) => {
        const message = event.data ?? {};
        if (message.type === "complete") {
          const loopCount = message.loopCount ?? 0;
          const keyboardHandlerCount =
            message.keyboardHandlerCount ?? 0;
          emitStatus(
            loopCount > 0
              ? `Running ${loopCount} live loop(s) in Worker.`
              : keyboardHandlerCount > 0
                ? `Running ${keyboardHandlerCount} keyboard handler(s) in Worker.`
                : "Done."
          );
          if (loopCount === 0 && keyboardHandlerCount === 0) {
            setPlaybackState("stopped");
          }
          emitRuntimeState("Audio ready");
          resolve();
          return;
        }
        if (message.type === "execution-error") {
          const error = new Error(message.message);
          error.stack = message.stack ?? error.stack;
          fail(error);
          return;
        }
        if (message.type === "log") {
          emitLog(message.message);
          return;
        }
        handleWorkerMessage(event);
      };
      worker.onerror = (event) => {
        fail(new Error(event.message || "Playground Worker failed"));
      };
      worker.postMessage({
        type: "run",
        sourceCode,
        presets,
      });
    });
  }

  async function playSource(
    sourceCode,
    playOptions = {}
  ) {
    const execution =
      playOptions.execution ??
      defaultExecution;
    if (execution === "worker") {
      try {
        return await playSourceInWorker(sourceCode);
      } catch (error) {
        setPlaybackState("stopped");
        emitStatus(`Error: ${error.message}`);
        emitRuntimeState("Error");
        emitLog(error?.stack ?? String(error));
        throw error;
      }
    }
    if (execution !== "main") {
      throw new Error(
        `Unknown execution mode: ${execution}`
      );
    }
    stopLogicWorker();
    currentRunToken += 1;
    const runToken =
      currentRunToken;

    await ensureReady();
    clearKeyboardHandlers();
    liveApi.clearRunFxChain();
    setPlaybackState("running");
    emitStatus("Running...");
    emitRuntimeState("Running");

    const {
      evaluationState,
      globals,
    } =
      createExecutionGlobals(
        runToken
      );
    const AsyncFunction =
      Object.getPrototypeOf(
        async function () {}
      ).constructor;
    const userFunction =
      new AsyncFunction(
        ...Object.keys(globals),
        `"use strict";\n${sourceCode}`
      );

    try {
      await executeWithPlaygroundGuards(
        () =>
          userFunction(
            ...Object.values(
              globals
            )
          ),
        window,
        {
          enabled: guardExecution,
        }
      );

      liveApi.commitLiveLoops(
        evaluationState.loopDefinitions
      );
      liveApi.commitLiveCleanups(
        evaluationState.cleanupDefinitions,
        evaluationState.cleanupScope
      );
      commitKeyboardHandlers(
        evaluationState.keyboardDefinitions
      );

      if (runToken === currentRunToken) {
        const loopCount =
          evaluationState.loopDefinitions.size;
        const keyboardHandlerCount =
          evaluationState.keyboardDefinitions.size;
        emitStatus(
          loopCount > 0
            ? `Running ${loopCount} live loop(s).`
            : keyboardHandlerCount > 0
              ? `Running ${keyboardHandlerCount} keyboard handler(s).`
              : "Done."
        );
        if (
          loopCount === 0 &&
          keyboardHandlerCount === 0
        ) {
          setPlaybackState(
            "stopped"
          );
        }
        emitRuntimeState(
          "Audio ready"
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message ===
          "Run stopped"
      ) {
        setPlaybackState(
          "stopped"
        );
        emitStatus("Stopped.");
        emitRuntimeState(
          "Audio ready"
        );
        return;
      }

      emitStatus(
        `Error: ${error.message}`
      );
      emitRuntimeState("Error");
      emitLog(
        error?.stack ??
          String(error)
      );
      throw error;
    }
  }

  function put(name, sourceCode) {
    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "put(name, sourceCode) requires a non-empty name"
      );
    }

    sourceMap.set(
      name,
      String(sourceCode ?? "")
    );
  }

  function load(name, sourceCode) {
    put(name, sourceCode);
  }

  function get(name) {
    return sourceMap.get(name) ?? null;
  }

  async function play(
    name,
    playOptions = {}
  ) {
    const sourceCode =
      sourceMap.get(name);

    if (sourceCode === undefined) {
      throw new Error(
        `Unknown source: ${name}`
      );
    }

    currentSourceName = name;
    await playSource(sourceCode, playOptions);
  }

  function stop() {
    currentRunToken += 1;
    runtime.sampleClockStartTime = null;
    stopLogicWorker();
    clearKeyboardHandlers();
    liveApi.stopAllLoops();
    stopAllAudio();
    liveApi.flushLiveCleanups(
      new Set()
    );
    liveApi.clearRunFxChain();
    liveApi.clearPrepared();
    runtime.context = {};
    megaDrive.stopRecordingPlayback?.();
    setPlaybackState("stopped");
    emitStatus("Stopped.");
    emitRuntimeState(
      "Audio ready"
    );
  }

  function clear() {
    stop();
    sourceMap.clear();
    currentSourceName = null;
  }

  async function finalize() {
    stop();
    sourceMap.clear();
    currentSourceName = null;
    synth = null;
    removeMegaDriveListener?.();
    removeMegaDriveListener =
      null;
    await megaDrive.close();
    emitStatus("Finalized.");
    emitRuntimeState("Audio idle");
  }

  function getState() {
    let audio = "idle";

    if (prepareAudioPromise) {
      audio = "preparing";
    } else if (megaDrive.state === "error") {
      audio = "error";
    } else if (
      megaDrive.state === "ready" &&
      synth
    ) {
      audio = "ready";
    } else if (
      megaDrive.state === "starting"
    ) {
      audio = "preparing";
    }

    return {
      audio,
      playback: playbackState,
      currentSourceName,
      loadedSourceNames:
        Array.from(
          sourceMap.keys()
        ),
    };
  }

  return {
    logicWorkerUrl,
    initialize,
    ensureReady,
    load,
    put,
    get,
    play,
    playSource,
    stop,
    clear,
    finalize,
    getState,
    setMasterVolume,
    getMasterVolume,
    get presets() {
      return presets;
    },
    get megaDrive() {
      return megaDrive;
    },
    get fm() {
      return synth;
    },
    get psg() {
      return megaDrive.psg;
    },
    get sample() {
      return megaDrive.sample;
    },
    get stream() {
      return megaDrive.stream;
    },
    get noise() {
      return noiseApi;
    },
    get context() {
      return runtime.context;
    },
  };
}

/**
 * @param {Parameters<typeof createPlaygroundRuntime>[0]} [options]
 */
export function Playground(
  options = {}
) {
  return createPlaygroundRuntime(
    options
  );
}

function formatLogArgs(args) {
  return args
    .map((value) =>
      typeof value === "string"
        ? value
        : safeStringify(value)
    )
    .join(" ");
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
