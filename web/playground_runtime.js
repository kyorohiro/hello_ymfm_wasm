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
  const sourceMap =
    new Map();
  const runtime = {
    bpm: 120,
    clockStartTime: null,
    liveLoops: new Map(),
    livePrepared: new Map(),
    context: {},
  };
  const preparedFxUnits =
    new WeakSet();
  const activeNotes =
    new Set();
  const guardExecution =
    options.guardExecution !== false;

  let synth = null;
  let prepareAudioPromise = null;
  let currentRunToken = 0;
  let currentLoopContext = null;
  let removeMegaDriveListener =
    null;
  let currentSourceName = null;
  let playbackState = "stopped";

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
    stopAllNotes();
    megaDrive.sample.stopAll();
    megaDrive.stream.stop();
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

  function createExecutionGlobals(
    runToken
  ) {
    const evaluationState = {
      loopDefinitions: new Map(),
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
      fx,
      psg,
      context: runtime.context,
      sample: sampleApi,
      stream: streamApi,
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
      sleep: (seconds) =>
        clockApi.sleep(
          seconds,
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
        fx,
        psg,
        sample: pg.sample,
        stream: pg.stream,
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
        sleep: (seconds) =>
          pg.sleep(seconds),
        beat: pg.beat,
        nextBeat: pg.nextBeat,
        setBpm: pg.setBpm,
        tween: pg.tween,
        liveLoop: (name, fn) =>
          pg.liveLoop(name, fn),
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
        log: pg.log,
      },
    };
  }

  async function playSource(sourceCode) {
    currentRunToken += 1;
    const runToken =
      currentRunToken;

    await ensureReady();
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

      if (runToken === currentRunToken) {
        emitStatus(
          evaluationState.loopDefinitions.size >
            0
            ? `Running ${evaluationState.loopDefinitions.size} live loop(s).`
            : "Done."
        );
        if (
          evaluationState.loopDefinitions.size ===
          0
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

  async function play(name) {
    const sourceCode =
      sourceMap.get(name);

    if (sourceCode === undefined) {
      throw new Error(
        `Unknown source: ${name}`
      );
    }

    currentSourceName = name;
    await playSource(sourceCode);
  }

  function stop() {
    currentRunToken += 1;
    liveApi.stopAllLoops();
    stopAllAudio();
    liveApi.clearRunFxChain();
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
    logicWorkerUrl:
      options.logicWorkerUrl ?? null,
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
