import {
  MEGADRIVE_FM_PRESETS,
  MEGADRIVE_FM_PRESET_ORDER,
  MegaSynthLooper,
} from "../js/megasynth.js";
import {
  createTfiFromPreset,
  parseTfi,
} from "../js/tfi.js";
import {
  buildKeyboard as buildKeyboardView,
  createFretboardLayout,
  createFretboardState,
  findLayoutEntry,
  hasLayoutKey,
  renderFretboardControls,
  setFretPosition,
  setInstrument,
  shiftStringWindowIndex,
  setStringWindowIndex,
  shiftFretPosition,
} from "./synth_keyboard.js";
import {
  drawEnvelopeGuide as drawEnvelopeGuideView,
} from "./synth_envelope.js";
import {
  buildCommonControls as buildCommonControlsView,
  buildHeader,
  buildOperatorControls as buildOperatorControlsView,
} from "./synth_controls.js";
import {
  attachOutputEnvelopeTap,
  chooseVoice,
  clearInputState as clearRuntimeInputState,
  createVoices,
  initializeDirectAudio as initializeDirectAudioRuntime,
  stopAllNotes as stopAllRuntimeNotes,
} from "./synth_runtime.js";
import {
  createSynthInputController,
} from "./synth_input.js";

const status = document.getElementById("status");
const keyboard = document.getElementById("keyboard");
const instrumentControlsRoot =
  document.getElementById(
    "instrumentControls"
  );
const positionControlsRoot =
  document.getElementById(
    "positionControls"
  );
const fretDisplayRoot =
  document.getElementById(
    "fretDisplay"
  );
const stringDisplayRoot =
  document.getElementById(
    "stringDisplay"
  );
const stringWindowControlsRoot =
  document.getElementById(
    "stringWindowControls"
  );
const prepareOverlay =
  document.getElementById(
    "prepareOverlay"
  );
const commonControlsRoot =
  document.getElementById("commonControls");
const commonHeaderRoot =
  document.getElementById("commonHeader");
const operatorControlsRoot =
  document.getElementById("operatorControls");
const operatorHeaderRoot =
  document.getElementById("operatorHeader");
const presetSelect =
  document.getElementById("presetSelect");
const tfiFileInput =
  document.getElementById("tfiFile");
const exportTfiButton =
  document.getElementById(
    "exportTfiButton"
  );
const tfiSummary =
  document.getElementById("tfiSummary");
const paramHelp =
  document.getElementById("paramHelp");
const paramHelpTitle =
  document.getElementById("paramHelpTitle");
const paramHelpText =
  document.getElementById("paramHelpText");
const envelopeCanvas =
  document.getElementById("envelopeCanvas");
const envelopeContext =
  envelopeCanvas.getContext("2d");
const heldKeys = new Set();
const activePointers = new Map();

const OPERATOR_NUMBERS = [
  1,
  2,
  3,
  4,
];

const OPERATOR_PARAM_DEFS = [
  { id: "dt", label: "DT", min: 0, max: 7, step: 1, category: "pitch", help: "Small pitch offset." },
  { id: "multi", label: "MULTI", min: 0, max: 15, step: 1, category: "pitch", help: "Frequency multiplier." },
  { id: "tl", label: "TL", min: 0, max: 127, step: 1, category: "level", help: "Output level. Lower is louder." },
  { id: "rs", label: "RS", min: 0, max: 3, step: 1, category: "envelope", help: "Higher notes use faster envelope rates." },
  { id: "ar", label: "AR", min: 0, max: 31, step: 1, category: "envelope", help: "Attack speed after key on." },
  { id: "am", label: "AM", min: 0, max: 1, step: 1, booleanMode: true, category: "modulation", help: "Enable LFO volume wobble." },
  { id: "d1r", label: "D1R", min: 0, max: 31, step: 1, category: "envelope", help: "First decay speed." },
  { id: "d2r", label: "D2R", min: 0, max: 31, step: 1, category: "envelope", help: "Later decay speed while held." },
  { id: "sl", label: "SL", min: 0, max: 15, step: 1, category: "envelope", help: "Later sustain target level." },
  { id: "rr", label: "RR", min: 0, max: 15, step: 1, category: "envelope", help: "Fade speed after key off." },
];

const COMMON_PARAM_DEFS = [
  { id: "algorithm", label: "ALGO", min: 0, max: 7, step: 1, category: "routing", help: "Operator routing pattern." },
  { id: "feedback", label: "FB", min: 0, max: 7, step: 1, category: "routing", help: "OP1 self-feedback amount." },
  { id: "ams", label: "AMS", min: 0, max: 3, step: 1, category: "modulation", help: "LFO volume depth for AM-enabled operators." },
  { id: "lfoEnabled", label: "LFO", min: 0, max: 1, step: 1, booleanMode: true, category: "modulation", help: "Enable chip LFO." },
  { id: "lfoFrequency", label: "LFOF", min: 0, max: 7, step: 1, category: "modulation", help: "Chip LFO speed." },
];

const VOICE_COUNT = 6;

const REFERENCE_MIDI = 62;
const REFERENCE_BLOCK = 4;
const REFERENCE_FNUM = 553;

const fretboardState =
  createFretboardState();
let fretboardLayout =
  createFretboardLayout({
    state: fretboardState,
    referenceMidi:
      REFERENCE_MIDI,
    referenceBlock:
      REFERENCE_BLOCK,
    referenceFnum:
      REFERENCE_FNUM,
  });

const commonState = {
  algorithm: 7,
  feedback: 0,
  ams: 0,
  lfoEnabled: false,
  lfoFrequency: 0,
};

let currentPresetName =
  "one-op-basic";
let importedTfiName = "";
let activeHelpId = "";

const operatorStates = {
  1: {
    dt: 0,
    multi: 1,
    tl: 127,
    rs: 0,
    ar: 31,
    am: false,
    d1r: 0,
    d2r: 0,
    sl: 0,
    rr: 15,
    ssg: 0,
  },
  2: {
    dt: 0,
    multi: 1,
    tl: 127,
    rs: 0,
    ar: 31,
    am: false,
    d1r: 0,
    d2r: 0,
    sl: 0,
    rr: 15,
    ssg: 0,
  },
  3: {
    dt: 0,
    multi: 1,
    tl: 127,
    rs: 0,
    ar: 31,
    am: false,
    d1r: 0,
    d2r: 0,
    sl: 0,
    rr: 15,
    ssg: 0,
  },
  4: {
    dt: 0,
    multi: 1,
    tl: 8,
    rs: 0,
    ar: 22,
    am: false,
    d1r: 6,
    d2r: 3,
    sl: 3,
    rr: 8,
    ssg: 0,
  },
};

const commonControls = new Map();
const operatorControls = new Map();
const envelopeDescription =
  document.getElementById(
    "envelopeDescription"
  );
const looperStartButton =
  document.getElementById(
    "looperStartButton"
  );
const looperRecordButton =
  document.getElementById(
    "looperRecordButton"
  );
const looperStopButton =
  document.getElementById(
    "looperStopButton"
  );
const looperClearButton =
  document.getElementById(
    "looperClearButton"
  );
const looperStateRoot =
  document.getElementById(
    "looperState"
  );
const eventRecordStartButton =
  document.getElementById(
    "eventRecordStartButton"
  );
const eventRecordStopButton =
  document.getElementById(
    "eventRecordStopButton"
  );
const eventRecordPlayButton =
  document.getElementById(
    "eventRecordPlayButton"
  );
const eventRecordExportButton =
  document.getElementById(
    "eventRecordExportButton"
  );
const eventRecordImportInput =
  document.getElementById(
    "eventRecordImportInput"
  );
const eventRecordIgnoreOperators =
  document.getElementById(
    "eventRecordIgnoreOperators"
  );
const eventRecordStateRoot =
  document.getElementById(
    "eventRecordState"
  );

const ALGORITHM_DESCRIPTIONS = [
  'ALGO 0 <span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span> -> <span class="op-color-3">OP3</span> -> <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 1 (<span class="op-color-1">OP1</span> + <span class="op-color-2">OP2</span>) -> <span class="op-color-3">OP3</span> -> <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 2 (<span class="op-color-1">OP1</span> + (<span class="op-color-2">OP2</span> -> <span class="op-color-3">OP3</span>)) -> <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 3 ((<span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span>) + <span class="op-color-3">OP3</span>) -> <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 4 (<span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span>) + (<span class="op-color-3">OP3</span> -> <span class="op-color-4">OP4</span>) -> OUT',
  'ALGO 5 (<span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span>) + (<span class="op-color-1">OP1</span> -> <span class="op-color-3">OP3</span>) + (<span class="op-color-1">OP1</span> -> <span class="op-color-4">OP4</span>) -> OUT',
  'ALGO 6 (<span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span>) + <span class="op-color-3">OP3</span> + <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 7 <span class="op-color-1">OP1</span> + <span class="op-color-2">OP2</span> + <span class="op-color-3">OP3</span> + <span class="op-color-4">OP4</span> -> OUT',
];

let audioContext = null;
let audioReadyPromise = null;
let megaSynth = null;
let synth = null;
let loopMegaSynth = null;
let loopSynth = null;
let liveOutputBus = null;
let loopOutputBus = null;
let looperCaptureTapNode = null;
let looperCaptureSilentGain = null;
let currentLooperCapture = null;
let nextLooperCaptureId = 1;
const activeLoopAudioSources =
  new Map();
let visualFrame = 0;
let outputEnvelopeHistory = [];
let outputEnvelopeHeldVoicePeak = 1;
const OUTPUT_ENVELOPE_HISTORY_SIZE =
  640;
const OUTPUT_ENVELOPE_SILENCE_FLOOR =
  0.002;
const OUTPUT_ENVELOPE_SLOW_SCALE =
  0.12;
let audioInitStarted = false;
let looper = null;
let eventRecordSessionActive =
  false;

const voices =
  createVoices(VOICE_COUNT);

const activeKeys = new Map();
let inputController = null;

function setStatus(message) {
  status.textContent = message;
}

function formatLooperProgress(
  state
) {
  if (
    !state.running ||
    state.loopLength === null ||
    !audioContext
  ) {
    return null;
  }

  const elapsed =
    audioContext.currentTime -
    (state.loopStartedAt ?? 0);
  const wrapped =
    ((elapsed % state.loopLength) +
      state.loopLength) %
    state.loopLength;
  const percent =
    Math.floor(
      (wrapped / state.loopLength) * 100
    );
  const unitLabel =
    `Loop(${state.unitCount})`;

  return `${unitLabel} ${state.loopLength.toFixed(2)}s ${percent}%`;
}

function updateLooperUi() {
  if (!looper) {
    if (looperStateRoot) {
      looperStateRoot.textContent =
        "Looper idle.";
    }
    if (looperStartButton) {
      looperStartButton.textContent =
        "Looper Start";
    }
    if (looperRecordButton) {
      looperRecordButton.hidden =
        true;
      looperRecordButton.textContent =
        "Record";
    }
    if (looperStopButton) {
      looperStopButton.textContent =
        "Undo";
      looperStopButton.disabled =
        true;
    }
    looperClearButton &&
      (looperClearButton.disabled =
        true);
    looperRecordButton?.classList.remove(
      "is-selected"
    );
    return;
  }

  const state = looper.getState();
  const progressText =
    formatLooperProgress(state);

  if (looperStateRoot) {
    if (state.recording) {
      looperStateRoot.textContent =
        progressText
          ? `${progressText} REC`
          : state.loopLength === null
            ? "Recording first loop..."
            : "Recording...";
    } else if (progressText) {
      looperStateRoot.textContent =
        progressText;
    } else if (state.running) {
      looperStateRoot.textContent =
        state.loopLength === null
          ? "Loop pending..."
          : `Loop ${state.loopLength.toFixed(2)}s`;
    } else {
      looperStateRoot.textContent =
        state.unitCount > 0
          ? `Loop ${state.loopLength?.toFixed(2) ?? "0.00"}s`
          : "Looper idle.";
    }
  }

  if (looperStartButton) {
    looperStartButton.textContent =
      state.running
        ? "Looper Stop"
        : "Looper Start";
  }
  if (looperRecordButton) {
    looperRecordButton.hidden =
      !state.running;
    looperRecordButton.textContent =
      state.recording
        ? "Stop"
        : "Record";
  }
  if (looperStopButton) {
    looperStopButton.textContent =
      "Undo";
    looperStopButton.disabled =
      !state.canUndo &&
      !state.recording;
  }
  looperClearButton &&
    (looperClearButton.disabled =
      state.unitCount === 0 &&
      !state.recording);

  looperRecordButton?.classList.toggle(
    "is-selected",
    state.recording
  );
}

function updateEventRecordUi() {
  const recordingSource =
    megaSynth;
  const recording =
    recordingSource?.exportRecording?.() ??
    null;
  const isRecording =
    recordingSource?.isRecording?.() ??
    false;
  const isPlaying =
    recordingSource?.isRecordingPlaybackActive?.() ??
    false;
  const commandCount =
    recording?.commands?.length ?? 0;

  if (eventRecordStartButton) {
    eventRecordStartButton.disabled =
      false;
    eventRecordStartButton.textContent =
      eventRecordSessionActive
        ? "Event Rec Stop"
        : "Event Rec Start";
  }

  if (eventRecordStopButton) {
    eventRecordStopButton.hidden =
      !eventRecordSessionActive;
    eventRecordStopButton.disabled =
      !eventRecordSessionActive;
    eventRecordStopButton.textContent =
      isRecording
        ? "Stop"
        : "Record";
  }

  if (eventRecordPlayButton) {
    eventRecordPlayButton.disabled =
      !megaSynth ||
      isRecording ||
      commandCount === 0;
    eventRecordPlayButton.textContent =
      isPlaying
        ? "Stop Play"
        : "Play";
  }

  if (eventRecordExportButton) {
    eventRecordExportButton.disabled =
      !megaSynth ||
      isRecording ||
      commandCount === 0;
  }

  if (eventRecordStateRoot) {
    if (isRecording) {
      eventRecordStateRoot.textContent =
        `Event: REC ${commandCount}`;
    } else if (
      eventRecordSessionActive
    ) {
      eventRecordStateRoot.textContent =
        commandCount > 0
          ? `Event: ready ${commandCount}`
          : "Event: ready";
    } else if (commandCount > 0) {
      eventRecordStateRoot.textContent =
        isPlaying
          ? `Event: LOOP ${commandCount}`
          : `Event: ${commandCount} cmds`;
    } else {
      eventRecordStateRoot.textContent =
        "Event: none";
    }
  }
}

function buildEventPlaybackOptions() {
  const ignoreOperators =
    eventRecordIgnoreOperators?.checked ===
    true;

  return {
    loop: true,
    ignoreOperators,
    ignorePatch: ignoreOperators,
    reset: !ignoreOperators,
  };
}

function handleLooperStateChange(
  detail
) {
  updateLooperUi();

  if (
    detail.reason ===
      "record-finish" &&
    detail.auto
  ) {
    setStatus(
      `${detail.unit?.id ?? "Unit"} reached the loop end and stopped automatically.`
    );
    return;
  }

  if (
    detail.reason ===
    "record-empty"
  ) {
    setStatus(
      "No notes were played. Empty loop unit was discarded."
    );
    return;
  }

  if (
    detail.reason ===
    "record-carry"
  ) {
    setStatus(
      "No notes yet. Recording continues into the next loop."
    );
    return;
  }

  if (
    detail.reason ===
    "record-cancel"
  ) {
    setStatus(
      "Recording canceled."
    );
  }
}

async function toggleEventRecordSession() {
  await ensureAudioReady();

  if (!megaSynth) {
    return;
  }

  if (eventRecordSessionActive) {
    if (megaSynth.isRecording()) {
      const recording =
        megaSynth.stopRecord();
      if (
        recording?.commands?.length
      ) {
        megaSynth.playRecording(
          recording,
          buildEventPlaybackOptions()
        );
      }
    }

    eventRecordSessionActive =
      false;
    updateEventRecordUi();
    setStatus(
      "Event record mode stopped."
    );
    return;
  }

  eventRecordSessionActive = true;
  updateEventRecordUi();
  setStatus(
    "Event record mode ready. Press Record or Space."
  );
}

async function toggleEventTakeRecording() {
  await ensureAudioReady();

  if (
    !megaSynth ||
    !eventRecordSessionActive
  ) {
    setStatus(
      "Start Event Rec first."
    );
    return;
  }

  if (megaSynth.isRecording()) {
    const recording =
      megaSynth.stopRecord();
    if (
      recording?.commands?.length
    ) {
      megaSynth.playRecording(
        recording,
        buildEventPlaybackOptions()
      );
    }
    updateEventRecordUi();
    setStatus(
      `Event recording stopped. ${recording?.commands?.length ?? 0} commands looping.`
    );
    return;
  }

  megaSynth.startRecord();
  updateEventRecordUi();
  setStatus(
    "Event recording started."
  );
}

async function playEventRecording() {
  await ensureAudioReady();

  if (!megaSynth) {
    return;
  }

  if (
    megaSynth.isRecordingPlaybackActive()
  ) {
    megaSynth.stopRecordingPlayback();
    updateEventRecordUi();
    setStatus(
      "Event playback stopped."
    );
    return;
  }

  const recording =
    megaSynth.playRecording(
      null,
      buildEventPlaybackOptions()
    );
  updateEventRecordUi();
  setStatus(
    `Playing recorded event stream (${recording?.commands?.length ?? 0} commands) in a loop.`
  );
}

function exportEventRecording() {
  if (!megaSynth) {
    return;
  }

  const recording =
    megaSynth.exportRecording();

  if (!recording) {
    setStatus(
      "No event recording to export."
    );
    return;
  }

  const blob =
    new Blob(
      [
        JSON.stringify(
          recording,
          null,
          2
        ),
      ],
      {
        type: "application/json",
      }
    );
  const url =
    URL.createObjectURL(blob);
  const anchor =
    document.createElement("a");
  anchor.href = url;
  anchor.download =
    "megasynth-recording.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus(
    `Exported ${recording.commands?.length ?? 0} event commands.`
  );
}

async function importEventRecording(
  event
) {
  const [file] =
    event.target.files || [];

  if (!file) {
    return;
  }

  try {
    await ensureAudioReady();
    const text =
      await file.text();
    const recording =
      JSON.parse(text);
    megaSynth?.importRecording(
      recording
    );
    updateEventRecordUi();
    setStatus(
      `Imported event recording: ${file.name}.`
    );
  } catch (error) {
    setStatus(
      `Failed to import event recording: ${error.message}`
    );
  } finally {
    if (eventRecordImportInput) {
      eventRecordImportInput.value =
        "";
    }
  }
}

async function startLooperAudioCapture() {
  if (!audioContext) {
    return;
  }

  if (currentLooperCapture) {
    return;
  }

  const captureId =
    `capture-${nextLooperCaptureId}`;
  nextLooperCaptureId += 1;
  const capture = {
    captureId,
    leftChunks: [],
    rightChunks: [],
    frameCount: 0,
  };
  currentLooperCapture = capture;
}

function copyLooperCaptureChunk(
  capture,
  inputBuffer
) {
  if (!capture) {
    return;
  }

  const channelCount =
    Math.min(
      2,
      inputBuffer.numberOfChannels
    );

  if (channelCount <= 0) {
    return;
  }

  const left =
    new Float32Array(
      inputBuffer.getChannelData(0)
    );
  const right =
    channelCount >= 2
      ? new Float32Array(
          inputBuffer.getChannelData(1)
        )
      : new Float32Array(left);

  capture.leftChunks.push(left);
  capture.rightChunks.push(right);
  capture.frameCount +=
    Math.min(
      left.length,
      right.length
    );
}

function buildLooperCaptureAudioResult(
  capture
) {
  if (
    !audioContext ||
    !capture ||
    capture.frameCount <= 0
  ) {
    return null;
  }

  const audio =
    audioContext.createBuffer(
      2,
      capture.frameCount,
      audioContext.sampleRate
    );
  const leftData =
    audio.getChannelData(0);
  const rightData =
    audio.getChannelData(1);

  let writeOffset = 0;
  for (const chunk of capture.leftChunks) {
    leftData.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  writeOffset = 0;
  for (const chunk of capture.rightChunks) {
    rightData.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return {
    audio,
    audioDuration:
      audio.duration,
  };
}

async function stopLooperAudioCapture() {
  if (!currentLooperCapture) {
    return null;
  }

  const capture =
    currentLooperCapture;
  currentLooperCapture = null;
  return buildLooperCaptureAudioResult(
    capture
  );
}

function scheduleLooperAudioPlayback(
  unit,
  startTime
) {
  if (
    !audioContext ||
    !loopOutputBus ||
    !unit.audio
  ) {
    return;
  }

  const source =
    audioContext.createBufferSource();
  source.buffer = unit.audio;
  source.connect(loopOutputBus);
  const unitId =
    unit.id ?? "__unknown__";
  const unitSources =
    activeLoopAudioSources.get(
      unitId
    ) ?? new Set();

  source.addEventListener(
    "ended",
    () => {
      unitSources.delete(source);
      if (unitSources.size === 0) {
        activeLoopAudioSources.delete(
          unitId
        );
      }
      source.disconnect();
    }
  );

  unitSources.add(source);
  activeLoopAudioSources.set(
    unitId,
    unitSources
  );
  const scheduledTime =
    Math.max(
      audioContext.currentTime +
        0.01,
      startTime
    );
  source.start(scheduledTime);
}

function stopLooperAudioPlayback(
  unit = null
) {
  const unitId =
    typeof unit === "string"
      ? unit
      : unit?.id ?? null;

  if (unitId !== null) {
    const unitSources =
      activeLoopAudioSources.get(
        unitId
      );

    if (!unitSources) {
      return;
    }

    for (const source of unitSources) {
      try {
        source.stop();
      } catch (_error) {
        // no-op
      }
      source.disconnect();
    }

    activeLoopAudioSources.delete(
      unitId
    );
    return;
  }

  for (const unitSources of activeLoopAudioSources.values()) {
    for (const source of unitSources) {
      try {
        source.stop();
      } catch (_error) {
        // no-op
      }
      source.disconnect();
    }
  }

  activeLoopAudioSources.clear();
}

function setupLooperCaptureTap() {
  if (
    !audioContext ||
    !liveOutputBus ||
    looperCaptureTapNode
  ) {
    return;
  }

  looperCaptureTapNode =
    audioContext.createScriptProcessor(
      2048,
      2,
      2
    );
  looperCaptureSilentGain =
    audioContext.createGain();
  looperCaptureSilentGain.gain.value =
    0;

  looperCaptureTapNode.onaudioprocess =
    (event) => {
      if (!currentLooperCapture) {
        return;
      }

      copyLooperCaptureChunk(
        currentLooperCapture,
        event.inputBuffer
      );
    };

  liveOutputBus.connect(
    looperCaptureTapNode
  );
  looperCaptureTapNode.connect(
    looperCaptureSilentGain
  );
  looperCaptureSilentGain.connect(
    audioContext.destination
  );
}

function updateKeyboardAvailability() {
  const isInitializing =
    audioInitStarted &&
    !synth;

  keyboard.classList.toggle(
    "is-loading",
    isInitializing
  );

  prepareOverlay?.classList.toggle(
    "is-visible",
    isInitializing
  );
  prepareOverlay?.setAttribute(
    "aria-hidden",
    String(!isInitializing)
  );
}

function rebuildFretboardLayout() {
  fretboardLayout =
    createFretboardLayout({
      state: fretboardState,
      referenceMidi:
        REFERENCE_MIDI,
      referenceBlock:
        REFERENCE_BLOCK,
      referenceFnum:
        REFERENCE_FNUM,
    });
}

function appendOutputEnvelopePoints(
  rmsValues
) {
  const heldVoiceCount = voices.filter(
    (voice) => voice.held
  ).length;
  const anyVoiceHeld =
    heldVoiceCount > 0;
  let chunkPeak = 0;

  if (
    heldVoiceCount >
    outputEnvelopeHeldVoicePeak
  ) {
    outputEnvelopeHeldVoicePeak =
      heldVoiceCount;
  }

  for (const value of rmsValues) {
    if (value > chunkPeak) {
      chunkPeak = value;
    }
  }

  const treatAsSilentTail =
    !anyVoiceHeld &&
    chunkPeak <
      OUTPUT_ENVELOPE_SILENCE_FLOOR * 2;

  for (const value of rmsValues) {
    const nextValue =
      treatAsSilentTail ? 0 : value;
    outputEnvelopeHistory.push(nextValue);
  }

  while (
    outputEnvelopeHistory.length >
    OUTPUT_ENVELOPE_HISTORY_SIZE
  ) {
    outputEnvelopeHistory.shift();
  }
}

function applyPatchToVoices() {
  if (!synth) {
    return;
  }

  synth.setLfo(
    commonState.lfoEnabled,
    commonState.lfoFrequency
  );

  for (
    let channel = 0;
    channel < VOICE_COUNT;
    channel += 1
  ) {
    for (const operator of OPERATOR_NUMBERS) {
      synth.setOperator(
        channel,
        operator,
        {
          ...operatorStates[operator],
          am:
            operatorStates[operator].am ===
            true,
        }
      );
    }

    synth.setAlgo(
      channel,
      commonState.algorithm,
      commonState.feedback
    );

    synth.setPan(
      channel,
      true,
      true,
      commonState.ams
    );
  }
}

function syncControlsFromState() {
  for (const config of COMMON_PARAM_DEFS) {
    commonControls
      .get(config.id)
      ?.updateVisual(
        commonState[config.id]
      );
  }

  for (const operator of OPERATOR_NUMBERS) {
    const rowControls =
      operatorControls.get(operator);

    for (const config of OPERATOR_PARAM_DEFS) {
      rowControls
        ?.get(config.id)
        ?.updateVisual(
          operatorStates[operator][
            config.id
          ]
        );
    }
  }

  if (presetSelect) {
    presetSelect.value =
      currentPresetName;
  }
}

function updateTfiSummary() {
  if (!tfiSummary) {
    return;
  }

  if (!importedTfiName) {
    tfiSummary.textContent =
      "TFI: none";
    return;
  }

  tfiSummary.textContent =
    `TFI: ${importedTfiName} -> Custom`;
}

function applyPresetState(
  presetName
) {
  const preset =
    MEGADRIVE_FM_PRESETS[
      presetName
    ];

  if (!preset) {
    return;
  }

  currentPresetName =
    presetName;
  importedTfiName = "";
  commonState.algorithm =
    preset.algorithm ?? 7;
  commonState.feedback =
    preset.feedback ?? 0;
  commonState.ams =
    preset.ams ?? 0;

  for (const operator of OPERATOR_NUMBERS) {
    const nextOperator =
      preset.operators?.[operator] ||
      {};

    operatorStates[operator] = {
      ...operatorStates[operator],
      ...nextOperator,
    };
  }

  syncControlsFromState();
  updateTfiSummary();
  renderAlgorithmDiagram();
  drawEnvelopeGuide();

  if (synth) {
    applyPatchToVoices();
  }
}

function applyImportedTfiPreset(
  fileName,
  preset
) {
  currentPresetName =
    "custom";
  importedTfiName = fileName;
  commonState.algorithm =
    preset.algorithm ?? 7;
  commonState.feedback =
    preset.feedback ?? 0;
  commonState.ams =
    preset.ams ?? 0;

  for (const operator of OPERATOR_NUMBERS) {
    const nextOperator =
      preset.operators?.[operator] ||
      {};

    operatorStates[operator] = {
      ...operatorStates[operator],
      ...nextOperator,
    };
  }

  syncControlsFromState();
  updateTfiSummary();
  renderAlgorithmDiagram();
  drawEnvelopeGuide();

  if (synth) {
    applyPatchToVoices();
  }
}

function buildCurrentPresetState() {
  const preset = {
    algorithm:
      commonState.algorithm,
    feedback:
      commonState.feedback,
    ams: commonState.ams,
    lfo: {
      enabled:
        commonState.lfoEnabled,
      frequency:
        commonState.lfoFrequency,
    },
    operators: {},
  };

  for (const operator of OPERATOR_NUMBERS) {
    preset.operators[operator] = {
      ...operatorStates[operator],
    };
  }

  return preset;
}

function buildLooperPatchSnapshot() {
  return {
    algorithm:
      commonState.algorithm,
    feedback:
      commonState.feedback,
    ams: commonState.ams,
    lfoEnabled:
      commonState.lfoEnabled,
    lfoFrequency:
      commonState.lfoFrequency,
    left: true,
    right: true,
    operators: {
      1: {
        ...operatorStates[1],
      },
      2: {
        ...operatorStates[2],
      },
      3: {
        ...operatorStates[3],
      },
      4: {
        ...operatorStates[4],
      },
    },
  };
}

function applyLooperPatchToChannel(
  patch,
  channel
) {
  if (!loopSynth || !patch) {
    return;
  }

  loopSynth.setLfo(
    patch.lfoEnabled ?? false,
    patch.lfoFrequency ?? 0
  );

  for (const operator of OPERATOR_NUMBERS) {
    const operatorPatch =
      patch.operators?.[operator];

    if (!operatorPatch) {
      continue;
    }

    loopSynth.setOperator(
      channel,
      operator,
      {
        ...operatorPatch,
        am:
          operatorPatch.am === true,
      }
    );
  }

  loopSynth.setAlgo(
    channel,
    patch.algorithm ?? 7,
    patch.feedback ?? 0
  );

  loopSynth.setPan(
    channel,
    patch.left ?? true,
    patch.right ?? true,
    patch.ams ?? 0
  );
}

function createTfiExportName() {
  const baseName =
    importedTfiName
      ? importedTfiName.replace(/\.tfi$/i, "")
      : currentPresetName ===
          "custom"
        ? "ym2612-custom"
        : currentPresetName;

  return `${baseName}.tfi`;
}

function renderAlgorithmDiagram() {
  if (!envelopeDescription) {
    return;
  }

  const algorithm =
    commonState.algorithm;
  const feedback =
    commonState.feedback;
  const description =
    ALGORITHM_DESCRIPTIONS[
      algorithm
    ] || `ALGO ${algorithm}`;

  const feedbackText =
    feedback === 0
      ? "FB off"
      : `OP1 feedback ${feedback}.`;

  envelopeDescription.className =
    "algo-inline";
  envelopeDescription.innerHTML =
    `${description} ${feedbackText}`;
}

function drawEnvelopeGuide() {
  drawEnvelopeGuideView({
    canvas: envelopeCanvas,
    context: envelopeContext,
    operatorNumbers:
      OPERATOR_NUMBERS,
    operatorStates,
    outputEnvelopeHistory,
    outputEnvelopeHeldVoicePeak,
    outputEnvelopeSilenceFloor:
      OUTPUT_ENVELOPE_SILENCE_FLOOR,
    outputEnvelopeBaseScale:
      OUTPUT_ENVELOPE_SLOW_SCALE,
  });
}

function toggleParamHelp(config) {
  if (
    !paramHelp ||
    !paramHelpTitle ||
    !paramHelpText ||
    !config?.help
  ) {
    return;
  }

  if (activeHelpId === config.id) {
    activeHelpId = "";
    paramHelp.hidden = true;
    paramHelpTitle.textContent = "";
    paramHelpText.textContent = "";
    return;
  }

  activeHelpId = config.id;
  paramHelpTitle.textContent = config.label;
  paramHelpText.textContent = config.help;
  paramHelp.hidden = false;
}

function updateVisuals() {
  drawEnvelopeGuide();
  if (looper?.running) {
    updateLooperUi();
  }
  visualFrame =
    requestAnimationFrame(
      updateVisuals
    );
}

function ensureVisualLoop() {
  if (!visualFrame) {
    visualFrame =
      requestAnimationFrame(
        updateVisuals
      );
  }
}

function buildCommonControls() {
  buildCommonControlsView({
    root: commonControlsRoot,
    defs: COMMON_PARAM_DEFS,
    state: commonState,
    controlsMap: commonControls,
    stackedLabels: true,
    referenceColumnCount:
      OPERATOR_PARAM_DEFS.length,
    gapPx: 4,
    onHelpToggle: toggleParamHelp,
    onChange: (id, nextValue) => {
      commonState[id] = nextValue;
      currentPresetName =
        "custom";
      if (presetSelect) {
        presetSelect.value =
          "custom";
      }
      renderAlgorithmDiagram();
      drawEnvelopeGuide();
      if (synth) {
        applyPatchToVoices();
      }
    },
  });
}

function buildCommonHeader() {
  if (
    commonHeaderRoot?.parentElement
  ) {
    commonHeaderRoot.parentElement.style.display =
      "none";
  }
}

function buildOperatorHeader() {
  buildHeader(
    operatorHeaderRoot,
    OPERATOR_PARAM_DEFS,
    { onHelpToggle: toggleParamHelp }
  );
}

function buildOperatorControls() {
  buildOperatorControlsView({
    root: operatorControlsRoot,
    operatorNumbers:
      OPERATOR_NUMBERS,
    defs: OPERATOR_PARAM_DEFS,
    operatorStates,
    controlsMap: operatorControls,
    onChange: (
      operator,
      id,
      nextValue
    ) => {
      operatorStates[operator][id] =
        nextValue;
      currentPresetName =
        "custom";
      if (presetSelect) {
        presetSelect.value =
          "custom";
      }
      drawEnvelopeGuide();
      if (synth) {
        applyPatchToVoices();
      }
    },
  });
}

function updateKeyboardVisuals() {
  for (const button of keyboard.querySelectorAll(".key")) {
    button.classList.toggle(
      "is-active",
      activeKeys.has(button.dataset.key)
    );
  }
}

function clearInputState() {
  clearRuntimeInputState({
    heldKeys,
    activePointers,
    voices,
    activeKeys,
    updateKeyboardVisuals,
    onCleared: () => {
      outputEnvelopeHeldVoicePeak = 1;
    },
  });
}

function renderFretboardUi() {
  renderFretboardControls({
    instrumentRoot:
      instrumentControlsRoot,
    positionRoot:
      positionControlsRoot,
    fretDisplayRoot,
    stringDisplayRoot,
    stringWindowRoot:
      stringWindowControlsRoot,
    state: fretboardState,
    onInstrumentChange: (
      instrument
    ) => {
      stopAllNotes();
      setInstrument(
        fretboardState,
        instrument
      );
      rebuildFretboardLayout();
      buildKeyboard();
      updateKeyboardVisuals();
      renderFretboardUi();
    },
    onPositionPresetSelect: (
      fret
    ) => {
      stopAllNotes();
      setFretPosition(
        fretboardState,
        fret
      );
      rebuildFretboardLayout();
      buildKeyboard();
      updateKeyboardVisuals();
      renderFretboardUi();
    },
    onStringWindowChange: (
      index
    ) => {
      stopAllNotes();
      setStringWindowIndex(
        fretboardState,
        index
      );
      rebuildFretboardLayout();
      buildKeyboard();
      updateKeyboardVisuals();
      renderFretboardUi();
    },
  });
}

function stopAllNotes() {
  stopAllRuntimeNotes({
    synth,
    voices,
    heldKeys,
    activePointers,
    activeKeys,
    updateKeyboardVisuals,
    onCleared: () => {
      outputEnvelopeHeldVoicePeak = 1;
    },
  });
}

function getPlayableSynth() {
  if (looper?.running) {
    return looper;
  }

  return synth;
}

async function ensureLooper() {
  await ensureAudioReady();

  if (!megaSynth || !loopMegaSynth) {
    return null;
  }

  if (!looper) {
    looper = new MegaSynthLooper({
      synth: loopMegaSynth,
      now: () =>
        audioContext.currentTime,
      liveTarget: synth,
      playbackTarget: loopSynth,
      getPatch:
        buildLooperPatchSnapshot,
      applyPatch: (
        patch,
        channel
      ) => {
        applyLooperPatchToChannel(
          patch,
          channel
        );
      },
      startAudioCapture:
        startLooperAudioCapture,
      stopAudioCapture:
        stopLooperAudioCapture,
      scheduleAudioPlayback:
        scheduleLooperAudioPlayback,
      stopAudioPlayback:
        stopLooperAudioPlayback,
      onStateChange:
        handleLooperStateChange,
    });
  }

  updateLooperUi();
  return looper;
}

async function toggleLooperStart() {
  const currentLooper =
    await ensureLooper();

  if (!currentLooper) {
    return;
  }

  if (currentLooper.running) {
    updateLooperUi();
    setStatus("Stopping looper...");
    await currentLooper.stop();
    updateLooperUi();
    stopAllNotes();
    setStatus("Looper stopped.");
    return;
  }

  await currentLooper.start();
  updateLooperUi();
  setStatus(
    "Looper started. Press Space or Record to capture a unit."
  );
}

async function toggleLooperRecord() {
  const currentLooper =
    await ensureLooper();

  if (!currentLooper) {
    return;
  }

  if (!currentLooper.running) {
    setStatus(
      "Start the looper first."
    );
    return;
  }

  const wasRecording =
    currentLooper.recording;
  const pendingToggle =
    currentLooper.toggleRecord();
  updateLooperUi();
  setStatus(
    wasRecording
      ? "Finalizing take..."
      : "Recording started."
  );
  const completedUnit =
    await pendingToggle;
  updateLooperUi();

  if (wasRecording) {
    if (completedUnit) {
      setStatus(
        `Recorded ${completedUnit.id}.`
      );
    } else {
      setStatus(
        "Recording finished."
      );
    }
  } else {
    setStatus(
      "Recording started."
    );
  }
}

async function undoLooper() {
  if (!looper) {
    return;
  }

  updateLooperUi();
  setStatus(
    looper.recording
      ? "Canceling recording..."
      : "Undoing last unit..."
  );
  const undoneUnit =
    await looper.undo();
  updateLooperUi();

  if (!undoneUnit) {
    setStatus(
      "Nothing to undo."
    );
    return;
  }

  setStatus(
    undoneUnit.type ===
      "record-cancel"
      ? "Recording canceled."
      : `Undid ${undoneUnit.id}.`
  );
}

function clearLooper() {
  if (!looper) {
    return;
  }

  void looper.clear().then(() => {
    updateLooperUi();
    stopAllNotes();
    setStatus("Looper cleared.");
  });
}

function togglePrimaryRecordAction() {
  if (eventRecordSessionActive) {
    void toggleEventTakeRecording();
    return;
  }

  void toggleLooperRecord();
}

async function initializeDirectAudio() {
  updateKeyboardAvailability();

  liveOutputBus =
    audioContext.createGain();
  liveOutputBus.connect(
    audioContext.destination
  );

  const runtime =
    await initializeDirectAudioRuntime({
      audioContext,
      workletUrl:
        "../js/ym2612-worklet.js",
      ym2612WasmUrl:
        "../generated/ym2612_wasm.wasm",
      outputNode:
        liveOutputBus,
      setStatus,
    });

  megaSynth = runtime.megaSynth;
  synth = runtime.synth;
  setupLooperCaptureTap();
  loopOutputBus =
    audioContext.createGain();
  loopOutputBus.connect(
    audioContext.destination
  );
  const loopRuntime =
    await initializeDirectAudioRuntime({
      audioContext,
      workletUrl:
        "../js/ym2612-worklet.js",
      ym2612WasmUrl:
        "../generated/ym2612_wasm.wasm",
      outputNode:
        loopOutputBus,
      setStatus,
    });

  loopMegaSynth =
    loopRuntime.megaSynth;
  loopSynth =
    loopRuntime.synth;
  looper = new MegaSynthLooper({
    synth: loopMegaSynth,
    now: () =>
      audioContext.currentTime,
    liveTarget: synth,
    playbackTarget: loopSynth,
    getPatch:
      buildLooperPatchSnapshot,
    applyPatch: (
      patch,
      channel
    ) => {
      applyLooperPatchToChannel(
        patch,
        channel
      );
    },
    startAudioCapture:
      startLooperAudioCapture,
    stopAudioCapture:
      stopLooperAudioCapture,
    scheduleAudioPlayback:
      scheduleLooperAudioPlayback,
    stopAudioPlayback:
      stopLooperAudioPlayback,
    onStateChange:
      handleLooperStateChange,
  });

  attachOutputEnvelopeTap({
    megaSynth,
    onEnvelope:
      appendOutputEnvelopePoints,
  });

  applyPatchToVoices();
  stopAllNotes();
  ensureVisualLoop();
  updateKeyboardAvailability();

  setStatus(
    `Audio ready. YM2612 via MegaDriveSynth at ${audioContext.sampleRate} Hz.`
  );
  updateLooperUi();
  updateEventRecordUi();
}

async function ensureAudioReady() {
  if (!audioContext) {
    audioContext =
      new AudioContext();
  }

  if (
    audioContext.state !== "running"
  ) {
    await audioContext.resume();
  }

  if (!audioReadyPromise) {
    audioInitStarted = true;
    updateKeyboardAvailability();
    audioReadyPromise =
      initializeDirectAudio();
  }

  try {
    await audioReadyPromise;
  } catch (error) {
    audioReadyPromise = null;
    audioInitStarted = false;
    updateKeyboardAvailability();
    throw error;
  }

}

function buildKeyboard() {
  buildKeyboardView({
    root: keyboard,
    rowDefs:
      fretboardLayout.rowDefs,
    layoutEntries:
      fretboardLayout.entries,
    onPointerDown: (
      event,
      entry,
      button
    ) =>
      inputController
        ?.handlePointerDown(
          event,
          entry,
          button
        ),
    onPointerUp: (
      event,
      entry,
      button
    ) =>
      inputController?.handlePointerUp(
        event,
        entry,
        button
      ),
    onPointerCancel: (
      event,
      entry,
      button
    ) =>
      inputController?.handlePointerCancel(
        event,
        entry,
        button
      ),
  });
}

function buildPresetSelect() {
  if (!presetSelect) {
    return;
  }

  presetSelect.innerHTML = "";

  const customOption =
    document.createElement("option");
  customOption.value = "custom";
  customOption.textContent =
    "Custom";
  presetSelect.appendChild(
    customOption
  );

  for (const presetName of MEGADRIVE_FM_PRESET_ORDER) {
    const preset =
      MEGADRIVE_FM_PRESETS[
        presetName
      ];

    const option =
      document.createElement("option");
    option.value = presetName;
    option.textContent =
      preset?.label || presetName;
    presetSelect.appendChild(option);
  }

  presetSelect.addEventListener(
    "change",
    () => {
      if (
        presetSelect.value ===
        "custom"
      ) {
        currentPresetName =
          "custom";
        return;
      }

      applyPresetState(
        presetSelect.value
      );
    }
  );

  presetSelect.value =
    currentPresetName;
}

function buildTfiLoader() {
  if (!tfiFileInput) {
    return;
  }

  tfiFileInput.addEventListener(
    "change",
    async (event) => {
      const [file] =
        event.target.files || [];

      if (!file) {
        return;
      }

      try {
        const arrayBuffer =
          await file.arrayBuffer();
        const preset =
          parseTfi(
            new Uint8Array(
              arrayBuffer
            )
          );

        stopAllNotes();
        applyImportedTfiPreset(
          file.name,
          preset
        );
        setStatus(
          `Loaded TFI ${file.name}.`
        );
      } catch (error) {
        importedTfiName = "";
        updateTfiSummary();
        setStatus(
          `Failed to load TFI: ${error.message}`
        );
      } finally {
        tfiFileInput.value = "";
      }
    }
  );

  updateTfiSummary();
}

function buildTfiExporter() {
  if (!exportTfiButton) {
    return;
  }

  exportTfiButton.addEventListener(
    "click",
    () => {
      try {
        const preset =
          buildCurrentPresetState();
        const bytes =
          createTfiFromPreset(
            preset
          );
        const blob =
          new Blob([bytes], {
            type: "application/octet-stream",
          });
        const url =
          URL.createObjectURL(
            blob
          );
        const anchor =
          document.createElement(
            "a"
          );
        anchor.href = url;
        anchor.download =
          createTfiExportName();
        document.body.appendChild(
          anchor
        );
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(
          url
        );
        setStatus(
          `Exported ${anchor.download}.`
        );
      } catch (error) {
        setStatus(
          `Failed to export TFI: ${error.message}`
        );
      }
    }
  );
}

inputController =
  createSynthInputController({
    getKeyLayout: () =>
      fretboardLayout.entries,
    findLayoutEntry,
    hasLayoutKey,
    heldKeys,
    activePointers,
    activeKeys,
    voices,
    getAudioReadyPromise:
      () => audioReadyPromise,
    getSynth: () =>
      getPlayableSynth(),
    ensureAudioReady,
    chooseVoice,
    updateKeyboardVisuals,
    setStatus,
    stopAllNotes,
    onShiftFret: (delta) => {
      stopAllNotes();
      shiftFretPosition(
        fretboardState,
        delta
      );
      rebuildFretboardLayout();
      buildKeyboard();
      updateKeyboardVisuals();
      renderFretboardUi();
    },
    onShiftStringWindow: (
      delta
    ) => {
      stopAllNotes();
      shiftStringWindowIndex(
        fretboardState,
        delta
      );
      rebuildFretboardLayout();
      buildKeyboard();
      updateKeyboardVisuals();
      renderFretboardUi();
    },
    onToggleRecord: () => {
      togglePrimaryRecordAction();
    },
  });

inputController.attachWindowInput();

buildCommonHeader();
buildCommonControls();
buildOperatorHeader();
buildOperatorControls();
buildPresetSelect();
buildTfiLoader();
buildTfiExporter();
looperStartButton?.addEventListener(
  "click",
  () => {
    void toggleLooperStart();
  }
);
looperRecordButton?.addEventListener(
  "click",
  () => {
    togglePrimaryRecordAction();
  }
);
looperStopButton?.addEventListener(
  "click",
  () => {
    void undoLooper();
  }
);
looperClearButton?.addEventListener(
  "click",
  () => {
    clearLooper();
  }
);
eventRecordStartButton?.addEventListener(
  "click",
  () => {
    void toggleEventRecordSession();
  }
);
eventRecordStopButton?.addEventListener(
  "click",
  () => {
    void toggleEventTakeRecording();
  }
);
eventRecordPlayButton?.addEventListener(
  "click",
  () => {
    void playEventRecording();
  }
);
eventRecordExportButton?.addEventListener(
  "click",
  () => {
    exportEventRecording();
  }
);
eventRecordImportInput?.addEventListener(
  "change",
  (event) => {
    void importEventRecording(
      event
    );
  }
);
renderFretboardUi();
buildKeyboard();
applyPresetState(currentPresetName);
updateKeyboardAvailability();
updateLooperUi();
updateEventRecordUi();
