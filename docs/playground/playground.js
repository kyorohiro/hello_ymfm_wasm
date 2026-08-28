import {
  MegaDriveSynth,
  MEGADRIVE_FM_PRESET_ORDER,
  MEGADRIVE_FM_PRESETS,
} from "../js/megasynth.js";
import * as megaSynthFx from "../js/megasynth_fx.js";
import {
  createTfiOperatorObjectText,
  createTfiPresetObjectText,
  parseTfi,
} from "../js/tfi.js";
import {
  createPitchFromMidi,
} from "../synth/synth_keyboard.js";
import {
  createPlaygroundOperatorTab,
} from "./playground_operator_tab.js";
import { EXAMPLES } from "./playground_examples.js";
import { createPlaygroundClock } from "./playground_clock.js";
import { createPlaygroundMusic } from "./playground_music.js";
import { createPlaygroundLive } from "./playground_live.js";
import { initializePlaygroundMonaco } from "./playground_monaco.js";
import { createPlaygroundUi } from "./playground_ui.js";
import {
  createFmProxy,
  handleMegaSynthEvent,
} from "./playground_sync.js";

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
const editorHost =
  document.getElementById(
    "editorHost"
  );
const editorNote =
  document.getElementById(
    "editorNote"
  );
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
const consoleTab =
  document.getElementById(
    "consoleTab"
  );
const helpersTab =
  document.getElementById(
    "helpersTab"
  );
const operatorTabButton =
  document.getElementById(
    "operatorTabButton"
  );
const consolePanel =
  document.getElementById(
    "consolePanel"
  );
const helpersPanel =
  document.getElementById(
    "helpersPanel"
  );
const operatorPanel =
  document.getElementById(
    "operatorPanel"
  );
const operatorTabRoot =
  document.getElementById(
    "operatorTabRoot"
  );

// Experimental: ?engine=nuked swaps the YM2612 core for Nuked-OPN2
// (https://github.com/nukeykt/Nuked-OPN2) instead of the default ymfm
// backend.
const useNukedEngine =
  new URLSearchParams(
    window.location.search
  ).get("engine") === "nuked";

const megaDrive =
  new MegaDriveSynth({
    workletUrl: useNukedEngine
      ? "../js/ym2612-worklet-nuked.js"
      : "../js/ym2612-worklet.js",
    ym2612WasmUrl: useNukedEngine
      ? "../generated/nuked_opn2_wasm.wasm"
      : "../generated/ym2612_wasm.wasm",
    segaPsgWasmUrl:
      "../generated/segapsg_wasm.wasm",
  });

if (useNukedEngine) {
  const pageTitle =
    document.getElementById(
      "pageTitle"
    );
  const badge =
    document.createElement("span");
  badge.className = "engine-badge";
  badge.textContent =
    "Nuked-OPN2 engine";
  pageTitle?.appendChild(badge);
}

let synth = null;
let removeMegaDriveListener =
  null;
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
let editorAdapter =
  createTextareaEditorAdapter(
    editor
  );
const tfiImportInput =
  document.createElement("input");
tfiImportInput.type = "file";
tfiImportInput.accept = ".tfi,application/octet-stream";
tfiImportInput.style.display =
  "none";
document.body.appendChild(
  tfiImportInput
);
const operatorTab =
  createPlaygroundOperatorTab({
    root: operatorTabRoot,
    presets:
      MEGADRIVE_FM_PRESETS,
    presetOrder:
      MEGADRIVE_FM_PRESET_ORDER,
    onStatus(message) {
      setStatus(message);
    },
  });

function psgTone(channel, period, attenuation = 0) {
  const normalizedChannel = Number(channel);
  const normalizedPeriod = Number(period);
  const normalizedAttenuation = Number(attenuation);

  if (!Number.isInteger(normalizedChannel) || normalizedChannel < 0 || normalizedChannel > 2) {
    throw new Error("psgTone channel must be 0..2");
  }
  if (!Number.isInteger(normalizedPeriod) || normalizedPeriod < 0 || normalizedPeriod > 0x3ff) {
    throw new Error("psgTone period must be an integer in range 0..1023");
  }
  if (!Number.isInteger(normalizedAttenuation) || normalizedAttenuation < 0 || normalizedAttenuation > 15) {
    throw new Error("psgTone attenuation must be 0..15");
  }
  if (!megaDrive.psg) {
    throw new Error("PSG is not available");
  }

  const latchBase = 0x80 | (normalizedChannel << 5);
  megaDrive.psg.write(latchBase | (normalizedPeriod & 0x0f));
  megaDrive.psg.write((normalizedPeriod >> 4) & 0x3f);
  megaDrive.psg.write(0x90 | (normalizedChannel << 5) | normalizedAttenuation);
}

function psgNoise(mode, attenuation = 0) {
  const normalizedMode = Number(mode);
  const normalizedAttenuation = Number(attenuation);

  if (!Number.isInteger(normalizedMode) || normalizedMode < 0 || normalizedMode > 7) {
    throw new Error("psgNoise mode must be 0..7");
  }
  if (!Number.isInteger(normalizedAttenuation) || normalizedAttenuation < 0 || normalizedAttenuation > 15) {
    throw new Error("psgNoise attenuation must be 0..15");
  }
  if (!megaDrive.psg) {
    throw new Error("PSG is not available");
  }

  megaDrive.psg.write(0xe0 | normalizedMode);
  megaDrive.psg.write(0xf0 | normalizedAttenuation);
}

function createTextareaEditorAdapter(
  textarea
) {
  return {
    kind: "textarea",
    getValue() {
      return textarea.value;
    },
    setValue(value) {
      textarea.value = value;
    },
    getCursorOffset() {
      return textarea.selectionStart ??
        textarea.value.length;
    },
    insertText(text) {
      const start =
        textarea.selectionStart ??
        textarea.value.length;
      const end =
        textarea.selectionEnd ?? start;
      textarea.setRangeText(
        text,
        start,
        end,
        "end"
      );
      textarea.focus();
    },
    focus() {
      textarea.focus();
    },
  };
}

function findNearestSetOperatorContext(
  source,
  cursorOffset
) {
  const lookBehind =
    source.slice(
      Math.max(0, cursorOffset - 320),
      cursorOffset
    );
  const startIndex =
    lookBehind.lastIndexOf(
      "setOperator("
    );

  if (startIndex < 0) {
    return null;
  }

  const callTail =
    lookBehind.slice(startIndex);

  if (
    callTail.includes(");")
  ) {
    return null;
  }

  const match =
    callTail.match(
      /setOperator\s*\(\s*[^,]+,\s*(?:pg\.)?(OP([1-4])|([0-3]))\s*,[\s\S]*$/m
    );

  if (!match) {
    return null;
  }

  if (match[2]) {
    return Number(match[2]);
  }

  if (match[3]) {
    return Number(match[3]) + 1;
  }

  return null;
}

function createTfiInsertTextForCursor(
  preset
) {
  const source =
    editorAdapter.getValue();
  const cursorOffset =
    editorAdapter.getCursorOffset?.() ??
    source.length;
  const logicalOperator =
    findNearestSetOperatorContext(
      source,
      cursorOffset
    );

  if (
    logicalOperator !== null
  ) {
    return createTfiOperatorObjectText(
      preset.operators?.[
        logicalOperator
      ]
    );
  }

  return createTfiPresetObjectText(
    preset
  );
}

function insertParsedTfiPreset(
  preset,
  label
) {
  const text =
    createTfiInsertTextForCursor(
      preset
    );
  const before =
    getEditorValue();

  if (
    typeof editorAdapter.insertText ===
    "function"
  ) {
    editorAdapter.insertText(text);
  } else {
    setEditorValue(
      appendTextAtEnd(
        before,
        text
      )
    );
  }

  const after =
    getEditorValue();

  if (after === before) {
    setEditorValue(
      appendTextAtEnd(
        before,
        text
      )
    );
  }

  editorAdapter.focus();
  setStatus(
    `Inserted TFI object from ${label}.`
  );
}

function appendTextAtEnd(
  source,
  text
) {
  if (!source) {
    return text;
  }

  if (source.endsWith("\n")) {
    return `${source}${text}`;
  }

  return `${source}\n${text}`;
}

async function insertTfiFile(
  file
) {
  const preset = parseTfi(
    await file.arrayBuffer()
  );
  insertParsedTfiPreset(
    preset,
    file.name
  );
}

function promptTfiInsert() {
  tfiImportInput.value = "";
  tfiImportInput.click();
}

function installTfiEditorDropTarget() {
  const targets = [
    editor,
    editorHost,
  ];

  for (const target of targets) {
    target?.addEventListener(
      "dragover",
      (event) => {
        const hasFile =
          Array.from(
            event.dataTransfer?.items ??
              []
          ).some(
            (item) =>
              item.kind === "file"
          );

        if (!hasFile) {
          return;
        }

        event.preventDefault();
        if (
          event.dataTransfer
        ) {
          event.dataTransfer.dropEffect =
            "copy";
        }
      }
    );

    target?.addEventListener(
      "drop",
      (event) => {
        const file =
          event.dataTransfer?.files?.[0];

        if (!file) {
          return;
        }

        event.preventDefault();
        void insertTfiFile(file).catch(
          (error) => {
            setStatus(
              `Failed to import TFI: ${error.message}`
            );
          }
        );
      }
    );
  }
}

function setEditorNote(message) {
  if (editorNote) {
    editorNote.textContent =
      message;
  }
}

function getEditorValue() {
  return editorAdapter.getValue();
}

function setEditorValue(value) {
  editorAdapter.setValue(value);
}

function createFxApi() {
  if (!megaDrive.audioContext) {
    throw new Error(
      "Audio is not ready yet"
    );
  }

  return {
    gain(options = {}) {
      return megaSynthFx.createGainFX(
        megaDrive.audioContext,
        options
      );
    },

    eq(options = {}) {
      return megaSynthFx.createEqFX(
        megaDrive.audioContext,
        options
      );
    },

    filter(options = {}) {
      return megaSynthFx.createFilterFX(
        megaDrive.audioContext,
        options
      );
    },

    delay(options = {}) {
      return megaSynthFx.createDelayFX(
        megaDrive.audioContext,
        options
      );
    },

    reverb(options = {}) {
      return megaSynthFx.createReverbFX(
        megaDrive.audioContext,
        options
      );
    },

    slicer(options = {}) {
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
          ...options,
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

    clear(options = {}) {
      return megaDrive.clearFXChain(
        options
      );
    },
  };
}

const ui =
  createPlaygroundUi({
    status,
    runtimeState,
    consoleOutput,
    consoleTab,
    helpersTab,
    operatorTabButton,
    consolePanel,
    helpersPanel,
    operatorPanel,
  });
const {
  setStatus,
  setRuntimeState,
  logLine,
  clearConsole,
  formatLogArgs,
  setBottomTab,
} = ui;

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
    operatorTab.attachSynth(synth);
    installMegaDriveListener();
    synth.setPreset(
      0,
      MEGADRIVE_FM_PRESETS[
      "one-op-basic"
    ]
  );
  setRuntimeState("Audio ready");
  setStatus("Audio ready.");
}

function installMegaDriveListener() {
  if (removeMegaDriveListener) {
    return;
  }

  removeMegaDriveListener =
    megaDrive.addListener(
      (event) =>
        handleMegaSynthEvent(
          event,
          {
            operatorTab,
            presets:
              MEGADRIVE_FM_PRESETS,
            presetOrder:
              MEGADRIVE_FM_PRESET_ORDER,
          }
        )
    );
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

const clockApi =
  createPlaygroundClock({
    runtime: playgroundRuntime,
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
    runtime: playgroundRuntime,
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
    logLine,
    setStatus,
  });

async function runCode() {
  currentRunToken += 1;
  const runToken =
    currentRunToken;
  runButton.disabled = true;
  clearConsole();

  try {
    await ensureReady();
    liveApi.clearRunFxChain();
    setStatus("Running...");
    setRuntimeState("Running");
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
        presets:
          MEGADRIVE_FM_PRESETS,
        activeNotes,
        sleep: (seconds) =>
          clockApi.sleep(
            seconds,
            runToken
          ),
        getCurrentLoopContext: () =>
          currentLoopContext,
      });
    const livePrepareApi = {
      fm,
      fx,
      psg,
      log: (...args) => {
        logLine(
          formatLogArgs(args)
        );
      },
    };
    const playgroundConsole = {
      log: (...args) => {
        logLine(
          formatLogArgs(args)
        );
      },
      warn: (...args) => {
        logLine(
          `[warn] ${formatLogArgs(args)}`
        );
      },
      error: (...args) => {
        logLine(
          `[error] ${formatLogArgs(args)}`
        );
      },
    };
    const pg = {
      fm,
      fx,
      psg,
      psgTone,
      psgNoise,
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
      presets:
        MEGADRIVE_FM_PRESETS,
      livePrepare: (name, fn) =>
        liveApi.livePrepare(
          name,
          fn,
          livePrepareApi
        ),
      play: (note, options) =>
        musicApi.play(
          note,
          options
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
      stopAll,
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
        logLine(
          formatLogArgs(args)
        );
      },
    };

    const api = {
      console:
        playgroundConsole,
      pg,
      fm,
      fx,
      psg,
      psgTone,
      psgNoise,
      livePrepare: (name, fn) =>
        pg.livePrepare(name, fn),
      play: (note, options) =>
        pg.play(note, options),
      sleep: (seconds) =>
        pg.sleep(seconds),
      beat: pg.beat,
      nextBeat: pg.nextBeat,
      setBpm: pg.setBpm,
      tween: pg.tween,
      liveLoop: (name, fn) =>
        pg.liveLoop(name, fn),
      stopLoop: pg.stopLoop,
      stopAllLoops: pg.stopAllLoops,
      stopAll: pg.stopAll,
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
      MEGADRIVE_FM_PRESETS,
      log: pg.log,
    };

    const AsyncFunction =
      Object.getPrototypeOf(
        async function () {}
      ).constructor;
    const userFunction =
      new AsyncFunction(
        ...Object.keys(api),
        `"use strict";\n${getEditorValue()}`
      );

    await userFunction(
      ...Object.values(api)
    );
    liveApi.commitLiveLoops(
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
  liveApi.stopAllLoops();
  stopAll();
  liveApi.clearRunFxChain();
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
  setEditorValue(nextCode);
  setStatus(
    `Loaded example: ${exampleSelect.value}`
  );
}

function decodeBase64Source(
  encodedSource
) {
  if (!encodedSource) {
    return null;
  }

  try {
    const normalized =
      String(encodedSource)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padding =
      normalized.length % 4 === 0
        ? ""
        : "=".repeat(
            4 -
              (normalized.length %
                4)
          );
    const binary = atob(
      normalized + padding
    );
    const bytes =
      Uint8Array.from(
        binary,
        (char) =>
          char.charCodeAt(0)
      );

    return new TextDecoder().decode(
      bytes
    );
  } catch (error) {
    console.warn(error);
    setStatus(
      "Failed to decode ?src=..."
    );
    return null;
  }
}

function applyInitialSourceFromQuery() {
  const params =
    new URLSearchParams(
      window.location.search
    );
  const encodedSource =
    params.get("src");

  if (encodedSource) {
    const decodedSource =
      decodeBase64Source(
        encodedSource
      );

    if (decodedSource !== null) {
      setEditorValue(
        decodedSource
      );
      setStatus(
        "Loaded code from ?src=..."
      );
      return;
    }
  }

  const exampleName =
    params.get("ex");

  if (
    exampleName &&
    EXAMPLES[exampleName]
  ) {
    exampleSelect.value =
      exampleName;
    setEditorValue(
      EXAMPLES[exampleName]
    );
    setStatus(
      `Loaded example from ?ex=${exampleName}`
    );
    return;
  }

  exampleSelect.value =
    "live-loop";
  setEditorValue(
    EXAMPLES["live-loop"]
  );
}

function applySimpleModeFromQuery() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  if (
    params.get("mode") !==
    "simple"
  ) {
    return;
  }

  document.body.classList.add(
    "mode-simple"
  );

  const runOverlay =
    document.getElementById(
      "runOverlay"
    );

  if (runOverlay) {
    runOverlay.appendChild(
      runButton
    );
    runOverlay.appendChild(
      stopButton
    );
  }
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

tfiImportInput.addEventListener(
  "change",
  () => {
    const file =
      tfiImportInput.files?.[0];

    if (!file) {
      return;
    }

    void insertTfiFile(file).catch(
      (error) => {
        setStatus(
          `Failed to import TFI: ${error.message}`
        );
      }
    );
  }
);

applyInitialSourceFromQuery();
applySimpleModeFromQuery();
clearConsole();
setBottomTab("console");
setRuntimeState("Audio idle");
ui.installBottomTabHandlers();
installTfiEditorDropTarget();
void initializePlaygroundMonaco({
  editor,
  editorHost,
  getEditorValue,
  setEditorNote,
  setEditorAdapter: (nextAdapter) => {
    editorAdapter = nextAdapter;
  },
  onMonacoEditorReady({
    monacoEditor,
  }) {
    monacoEditor.addAction({
      id: "tetorica-insert-tfi-object",
      label:
        "File (TFI) Import...",
      contextMenuGroupId:
        "navigation",
      contextMenuOrder: 1.5,
      run() {
        promptTfiInsert();
      },
    });
  },
});
