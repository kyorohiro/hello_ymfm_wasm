import {
  FM_PRESET_ORDER,
  FM_PRESETS,
} from "../js/megasynth.js";
import {
  createTetoricaSynth,
  normalizeTetoricaChip,
} from "../js/tetorica_synth.js";
import {
  createTfiOperatorObjectText,
  createTfiPresetObjectText,
  parseTfi,
} from "../js/tfi.js";
import {
  createPlaygroundOperatorTab,
} from "./playground_operator_tab.js";
import { EXAMPLES } from "./playground_examples.js";
import { initializePlaygroundMonaco } from "./playground_monaco.js";
import {
  decodeBase64Bytes,
  loadTfiPresetsFromQuery,
  resolveInitialSourceFromQuery,
} from "./playground_query.js";
import {
  loadPlaygroundCassette,
} from "./playground_cassette.js";
import {
  maybeDecodeVgmFile,
} from "../js/vgm_file.js";
import {
  Ym2612VGM,
  exportYm2203FmVgmToPlaygroundJavaScript,
  exportYm2608FmVgmToPlaygroundJavaScript,
} from "../js/ym2612vgm.js";
import { exportYm2203VgmToPlaygroundJavaScript } from "../js/ym2203vgm.js";
import { exportYm2608VgmToPlaygroundJavaScript } from "../js/ym2608vgm.js";
import { exportYm2610BVgmToPlaygroundJavaScript } from "../js/ym2610bvgm.js";
import {
  createPlaygroundRuntime,
} from "../js/playground_runtime.js";
import { createPlaygroundUi } from "./playground_ui.js";
import {
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
const workerExecution =
  document.getElementById("workerExecution");
const importCassetteButton =
  document.getElementById(
    "importCassetteButton"
  );
const importVgmMenu =
  document.getElementById("importVgmMenu");
const cancelVgmImportButton =
  document.getElementById("cancelVgmImportButton");
const convertVgmButton =
  document.getElementById("convertVgmButton");
const includeDacInput =
  document.getElementById("includeDacInput");
const dacBase64Input =
  document.getElementById("dacBase64Input");
const dacBase64Label =
  document.getElementById("dacBase64Label");
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
const status =
  document.getElementById("status");
const runtimeState =
  document.getElementById(
    "runtimeState"
  );
const masterVolumeRange =
  document.getElementById(
    "masterVolumeRange"
  );
const masterVolumeValue =
  document.getElementById(
    "masterVolumeValue"
  );
const consoleOutput =
  document.getElementById(
    "consoleOutput"
  );
const codeTab =
  document.getElementById("codeTab");
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
const codePanel =
  document.getElementById("codePanel");
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
const playgroundSearch = new URLSearchParams(
  window.location.search
);
const selectedChip = normalizeTetoricaChip(
  playgroundSearch.get("chip")
);
const useNukedEngine =
  selectedChip === "ym2612" &&
  playgroundSearch.get("engine") === "nuked";
const selectedWorkletChip =
  selectedChip === "ym2610"
    ? "ym2610b"
    : selectedChip;

const megaDrive =
  createTetoricaSynth({
    chip: selectedChip,
    workletUrl: useNukedEngine
      ? "../js/ym2612-worklet-nuked.js"
      : `../js/${selectedWorkletChip}-worklet.js`,
    ym2612WasmUrl: useNukedEngine
      ? "../generated/nuked_opn2_wasm.wasm"
      : "../generated/ym2612_wasm.wasm",
    wasmUrl:
      selectedChip === "ym2203"
        ? "../generated/ym2203_wasm.wasm"
        : selectedChip === "ym2608"
          ? "../generated/ym2608_wasm.wasm"
          : selectedChip === "ym2610"
            ? "../generated/ym2610b_wasm.wasm"
          : undefined,
    segaPsgWasmUrl:
      selectedChip === "ym2612"
        ? "../generated/segapsg_wasm.wasm"
        : null,
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

if (selectedChip !== "ym2612") {
  document.title = `Tetorica ${selectedChip.toUpperCase()} Playground`;
  const pageTitle = document.getElementById("pageTitle");
  if (pageTitle) pageTitle.firstChild.textContent = `Tetorica ${selectedChip.toUpperCase()} Playground`;
}

let synth = null;
const urlTfiResult =
  loadTfiPresetsFromQuery(
    window.location.search
  );
const playgroundPresets = {
  ...FM_PRESETS,
  ...urlTfiResult.presets,
};
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
const cassetteImportInput =
  document.createElement("input");
cassetteImportInput.type = "file";
cassetteImportInput.accept = ".zip,application/zip";
cassetteImportInput.style.display =
  "none";
document.body.appendChild(
  cassetteImportInput
);
const vgmImportInput =
  document.createElement("input");
vgmImportInput.type = "file";
vgmImportInput.accept = ".vgm,.vgz,audio/vgm,application/octet-stream";
vgmImportInput.style.display = "none";
document.body.appendChild(vgmImportInput);
let pendingVgmImportOptions = {
  mode: "write",
  includeDac: true,
  dacBase64: true,
};
const cassetteExamples = new Map();
const operatorTab =
  createPlaygroundOperatorTab({
    root: operatorTabRoot,
    presets:
      playgroundPresets,
    presetOrder:
      FM_PRESET_ORDER,
    channelCount:
      megaDrive.capabilities.fmChannels,
    onStatus(message) {
      setStatus(message);
    },
  });

function updateMasterVolumeUi() {
  const masterVolume =
    runtime?.getMasterVolume?.() ?? 1;
  if (masterVolumeRange) {
    masterVolumeRange.value =
      String(
        Math.round(masterVolume * 100)
      );
  }

  if (masterVolumeValue) {
    masterVolumeValue.textContent =
      `${Math.round(masterVolume * 100)}%`;
  }
}

function applyMasterVolume() {
  runtime.setMasterVolume(
    runtime.getMasterVolume()
  );
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

function promptCassetteImport() {
  cassetteImportInput.value = "";
  cassetteImportInput.click();
}

function promptVgmImport(options) {
  pendingVgmImportOptions = options;
  if (importVgmMenu) importVgmMenu.open = false;
  vgmImportInput.value = "";
  vgmImportInput.click();
}

async function importVgmFile(file, options) {
  const decoded = await maybeDecodeVgmFile(
    await file.arrayBuffer()
  );
  const vgm = new Ym2612VGM(decoded, { logger: null });
  const isYm2608Only =
    vgm.header.ym2608Clock > 0 &&
    vgm.header.ym2612Clock === 0;
  const isYm2203Only =
    vgm.header.ym2203Clock > 0 &&
    vgm.header.ym2612Clock === 0 &&
    vgm.header.ym2608Clock === 0;
  const isYm2610Only =
    vgm.header.ym2610Clock > 0 &&
    vgm.header.ym2612Clock === 0 &&
    vgm.header.ym2608Clock === 0;
  const useNativeYm2203 = isYm2203Only && selectedChip === "ym2203";
  const useNativeYm2608 = isYm2608Only && selectedChip === "ym2608";
  const useNativeYm2610 = isYm2610Only && selectedChip === "ym2610";
  const source = useNativeYm2203
    ? exportYm2203VgmToPlaygroundJavaScript(vgm, { scheduled: false })
    : useNativeYm2608
    ? exportYm2608VgmToPlaygroundJavaScript(vgm, { scheduled: false })
    : useNativeYm2610
    ? exportYm2610BVgmToPlaygroundJavaScript(vgm, { scheduled: false })
    : isYm2203Only
    ? exportYm2203FmVgmToPlaygroundJavaScript(vgm, {
      scheduled: options.mode === "schedule",
    })
    : isYm2608Only
    ? exportYm2608FmVgmToPlaygroundJavaScript(vgm, {
      scheduled: options.mode === "schedule",
    })
    : vgm.exportPlaygroundJavaScript({
      scheduled: options.mode === "schedule",
      includeDac: options.includeDac,
      dacBase64: options.dacBase64,
    });

  setEditorValue(source);
  setStatus(
    useNativeYm2610
      ? `Imported ${file.name} for native Neo Geo YM2610 FM (Write timing; SSG and ADPCM omitted).`
      : useNativeYm2608
      ? `Imported ${file.name} for native YM2608 FM (Write timing; SSG, Rhythm, and ADPCM-B omitted).`
      : useNativeYm2203
        ? `Imported ${file.name} for native YM2203 FM (Write timing; SSG omitted).`
      : isYm2608Only
      ? `Imported ${file.name} as YM2608 FM only (${options.mode === "schedule" ? "Schedule" : "Write"} timing; SSG, Rhythm, and ADPCM-B omitted).`
      : isYm2203Only
        ? `Imported ${file.name} as YM2203 FM only (${options.mode === "schedule" ? "Schedule" : "Write"} timing; SSG omitted).`
      : `Imported ${file.name} with ${options.mode === "schedule" ? "Schedule" : "Write"} timing.`
  );
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

function setEditorNote(_message) {}

function getEditorValue() {
  return editorAdapter.getValue();
}

function setEditorValue(value) {
  editorAdapter.setValue(value);
}

function replaceEditorValue(value) {
  if (
    typeof editorAdapter.replaceAll ===
    "function"
  ) {
    editorAdapter.replaceAll(value);
    return;
  }

  setEditorValue(value);
  editorAdapter.focus();
}

const ui =
  createPlaygroundUi({
    status,
    runtimeState,
    consoleOutput,
    codeTab,
    consoleTab,
    helpersTab,
    operatorTabButton,
    consolePanel,
    codePanel,
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
const runtime =
  createPlaygroundRuntime({
    megaDrive,
    presets:
      playgroundPresets,
    onStatus(message) {
      setStatus(message);
    },
    onRuntimeState(nextState) {
      setRuntimeState(nextState);
      syncWorkerExecutionLock();
    },
    onLog(line) {
      logLine(line);
    },
    onReady(context) {
      synth = context.synth;
      operatorTab.attachSynth(synth);
      applyMasterVolume();
    },
    onMegaDriveEvent(event) {
      handleMegaSynthEvent(
        event,
        {
          operatorTab,
          presets:
            runtime.presets,
          presetOrder:
            FM_PRESET_ORDER,
        }
      );
    },
  });

function syncWorkerExecutionLock() {
  if (workerExecution) {
    workerExecution.disabled =
      runtime.getState().playback === "running";
  }
}

updateMasterVolumeUi();
masterVolumeRange?.addEventListener(
  "input",
  () => {
    runtime.setMasterVolume(
      Number(masterVolumeRange.value) /
        100
    );
    updateMasterVolumeUi();
  }
);

async function runCode() {
  runButton.disabled = true;
  if (workerExecution) workerExecution.disabled = true;
  clearConsole();

  try {
    runtime.put(
      "__editor__",
      getEditorValue()
    );
    await runtime.play(
      "__editor__",
      {
        execution: workerExecution?.checked
          ? "worker"
          : "main",
      }
    );
  } catch (error) {
    console.error(error);
  } finally {
    runButton.disabled = false;
    syncWorkerExecutionLock();
  }
}

function stopRun() {
  runtime.stop();
  runButton.disabled = false;
  syncWorkerExecutionLock();
}

function loadExample() {
  const exampleName =
    exampleSelect.value;
  const nextCode =
    cassetteExamples.get(exampleName) ??
    EXAMPLES[exampleName] ??
    EXAMPLES.single;
  replaceEditorValue(nextCode);
  setStatus(
    `Loaded example: ${exampleName}`
  );
}

async function loadCassetteSource(
  source,
  name
) {
  const cassette =
    await loadPlaygroundCassette(
      source,
      { name }
    );
  const parsedTimbres = cassette.timbres.map(
    (timbre) => ({
      ...timbre,
      preset: parseTfi(timbre.bytes),
    })
  );
  const exampleEntries = cassette.examples.map(
    (example) => ({
      optionValue:
        `cassette:${cassette.id}/${example.name}`,
      name: example.name,
      source: example.source,
    })
  );

  for (const timbre of parsedTimbres) {
    if (
      Object.prototype.hasOwnProperty.call(
        runtime.presets,
        timbre.name
      )
    ) {
      throw new Error(
        `Cassette timbre "${timbre.name}" conflicts with an existing preset.`
      );
    }
  }

  for (const sampleEntry of cassette.samples) {
    if (
      runtime.sample.isLoaded(sampleEntry.name)
    ) {
      throw new Error(
        `Cassette sample "${sampleEntry.name}" is already loaded.`
      );
    }
  }

  for (const example of exampleEntries) {
    if (cassetteExamples.has(example.optionValue)) {
      throw new Error(
        `Cassette example "${example.name}" is already loaded.`
      );
    }
  }

  for (const timbre of parsedTimbres) {
    playgroundPresets[timbre.name] =
      timbre.preset;
    runtime.presets[timbre.name] =
      timbre.preset;
  }

  if (cassette.samples.length > 0) {
    await runtime.ensureReady();
    for (const sampleEntry of cassette.samples) {
      await runtime.sample.load(
        sampleEntry.name,
        sampleEntry.bytes.buffer
      );
    }
  }

  for (const example of exampleEntries) {
    cassetteExamples.set(
      example.optionValue,
      example.source
    );
  }

  for (const example of exampleEntries) {
    const option = document.createElement(
      "option"
    );
    option.value = example.optionValue;
    option.textContent =
      `${cassette.id}: ${example.name}`;
    exampleSelect.appendChild(option);
  }

  const firstExample = exampleEntries[0];
  if (firstExample) {
    exampleSelect.value =
      firstExample.optionValue;
    loadExample();
  }

  const statusParts = [];
  if (parsedTimbres.length > 0) {
    statusParts.push(
      `${parsedTimbres.length} timbre(s)`
    );
  }
  if (exampleEntries.length > 0) {
    statusParts.push(
      `${exampleEntries.length} example(s)`
    );
  }
  if (cassette.samples.length > 0) {
    statusParts.push(
      `${cassette.samples.length} sample(s)`
    );
  }
  setStatus(
    `Loaded cassette ${cassette.id}${statusParts.length > 0 ? `: ${statusParts.join(", ")}.` : "."}`
  );
}

async function loadCassetteFile(file) {
  await loadCassetteSource(
    await file.arrayBuffer(),
    file.name
  );
}

async function applyCassetteFromQuery() {
  const params = new URLSearchParams(
    window.location.search
  );
  const encodedCassette = params.get(
    "cassette"
  );

  if (!encodedCassette) {
    return;
  }

  const bytes = decodeBase64Bytes(
    encodedCassette
  );
  if (!bytes) {
    setStatus(
      "Failed to decode ?cassette=..."
    );
    return;
  }

  try {
    await loadCassetteSource(
      bytes,
      "cassette.cassette.zip"
    );
  } catch (error) {
    console.error(error);
    setStatus(
      `Failed to load ?cassette=...: ${error.message}`
    );
  }
}

function applyInitialSourceFromQuery() {
  const result =
    resolveInitialSourceFromQuery(
      window.location.search,
      EXAMPLES
    );

  if (result.exampleName) {
    exampleSelect.value =
      result.exampleName;
  }

  setEditorValue(result.source);

  const statusParts = [];
  if (result.status) {
    statusParts.push(
      result.status
    );
  }
  if (
    urlTfiResult.loadedIds.length >
    0
  ) {
    statusParts.push(
      `Loaded ${urlTfiResult.loadedIds.length} URL TFI preset(s): ${urlTfiResult.loadedIds.join(", ")}.`
    );
  }
  if (
    urlTfiResult.errors.length >
    0
  ) {
    for (const errorMessage of urlTfiResult.errors) {
      console.warn(
        errorMessage
      );
    }
    if (
      statusParts.length === 0
    ) {
      statusParts.push(
        "Some URL TFI presets were ignored."
      );
    }
  }
  if (
    statusParts.length > 0
  ) {
    setStatus(
      statusParts.join(" ")
    );
  }
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

exampleSelect.addEventListener(
  "change",
  () => {
    loadExample();
  }
);

importCassetteButton?.addEventListener(
  "click",
  () => {
    promptCassetteImport();
  }
);

convertVgmButton?.addEventListener(
  "click",
  () => {
    const selectedMode = document.querySelector(
      'input[name="vgmImportMode"]:checked'
    );
    promptVgmImport(
      {
        mode: selectedMode?.value ?? "write",
        includeDac: includeDacInput?.checked ?? true,
        dacBase64: dacBase64Input?.checked ?? true,
      }
    );
  }
);

function syncDacBase64Option() {
  const selectedMode = document.querySelector(
    'input[name="vgmImportMode"]:checked'
  );
  const mode = selectedMode?.value ?? "write";
  if (dacBase64Input) {
    dacBase64Input.disabled = false;
  }
  if (dacBase64Label) {
    dacBase64Label.hidden = false;
    dacBase64Label.title = mode === "schedule"
      ? "Preload DAC as a Base64 stream without scheduling every DAC write."
      : "Store DAC data as one Base64 stream.";
  }
}

document.querySelectorAll('input[name="vgmImportMode"]').forEach(
  (input) => input.addEventListener("change", syncDacBase64Option)
);
syncDacBase64Option();

cancelVgmImportButton?.addEventListener(
  "click",
  () => {
    if (importVgmMenu) importVgmMenu.open = false;
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

cassetteImportInput.addEventListener(
  "change",
  () => {
    const file =
      cassetteImportInput.files?.[0];

    if (!file) {
      return;
    }

    void loadCassetteFile(file).catch(
      (error) => {
        console.error(error);
        setStatus(
          `Failed to load cassette: ${error.message}`
        );
      }
    );
  }
);

vgmImportInput.addEventListener(
  "change",
  () => {
    const file = vgmImportInput.files?.[0];

    if (!file) {
      return;
    }

    void importVgmFile(
      file,
      pendingVgmImportOptions
    ).catch((error) => {
      console.error(error);
      setStatus(
        `Failed to import VGM: ${error.message}`
      );
    });
  }
);

applyInitialSourceFromQuery();
void applyCassetteFromQuery();
applySimpleModeFromQuery();
clearConsole();
setBottomTab("code");
setRuntimeState("Audio idle");
ui.installBottomTabHandlers();
installTfiEditorDropTarget();
void initializePlaygroundMonaco({
  chip: selectedChip,
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
