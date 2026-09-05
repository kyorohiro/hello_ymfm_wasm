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
  createPlaygroundCassetteZip,
  loadPlaygroundCassette,
} from "./playground_cassette.js";
import {
  createVirtualFileSystem,
  createVirtualFileRuntimeSource,
  normalizeVirtualPath,
  resolveVirtualDynamicImports,
} from "./playground_virtual_files.js";
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
const expandButton =
  document.getElementById("expandButton");
const mainMenu =
  document.getElementById("mainMenu");
const mainMenuHome =
  document.getElementById("mainMenuHome");
const toolbar =
  document.querySelector(".toolbar");
const statusBar =
  document.querySelector(".status-bar");
const workerExecution =
  document.getElementById("workerExecution");
const importCassetteButton =
  document.getElementById(
    "importCassetteButton"
  );
const exportCassetteButton = document.getElementById("exportCassetteButton");
const importVgmButton = document.getElementById("importVgmButton");
const vgmImportDialog = document.getElementById("vgmImportDialog");
const vgmImportFilename = document.getElementById("vgmImportFilename");
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
const runFileSelect =
  document.getElementById(
    "runFileSelect"
  );
const editor =
  document.getElementById("editor");
const editorHost =
  document.getElementById(
    "editorHost"
  );
const fileExplorerList = document.getElementById("fileExplorerList");
const newFileButton = document.getElementById("newFileButton");
const importFileButton = document.getElementById("importFileButton");
const renameFileButton = document.getElementById("renameFileButton");
const deleteFileButton = document.getElementById("deleteFileButton");
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
const SYSTEM_EXAMPLE_PREFIX = "/sys/examples/";
const SYSTEM_EXAMPLE_ORDER = [
  "single",
  "8-bit-arcade-sweep",
  "live-loop",
  "fx-loop-minor",
  "fx-loop-major",
  "guitar-fx-chain",
  "ambient-choir-sample",
  "noise-ocean",
  "wind-noise",
  "just-intonation-chorus",
  "slicer-sweep",
  "fx-motion",
  "parallel-fx",
  "sonic-pi-sample-choir",
  "fm-direct",
  "fm-api-beep",
  "pg-context-init",
  "fm-low-level-note",
  "raw-write-beep",
  "channel3-special-mode",
  "dac-byte-stream",
  "psg-scale",
  "psg-noise",
  "psg-ocean",
];
const systemExampleFiles = Object.entries(EXAMPLES).map(
  ([name, source]) => ({
    path: `${SYSTEM_EXAMPLE_PREFIX}${name}.js`,
    data: source,
  })
);
const virtualFiles = createVirtualFileSystem([
  // A new project starts with the previous Live Loop example as its entry point.
  { path: "/index.js", data: EXAMPLES["live-loop"] },
  ...systemExampleFiles,
]);
let activeVirtualPath = "/index.js";
let runVirtualPath = "/index.js";
const virtualPresetIds = new Map();

function isSystemVirtualPath(path) {
  return path.startsWith("/sys/");
}

function formatSystemExampleLabel(path) {
  return path
    .slice(SYSTEM_EXAMPLE_PREFIX.length, -3)
    .split("-")
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
    .join(" ");
}

function projectFileOrder(left, right) {
  const rank = (path) => {
    if (path === "/index.js") return 0;
    if (path.startsWith("/examples/")) return 1;
    return 2;
  };
  return rank(left.path) - rank(right.path) ||
    left.path.localeCompare(right.path);
}

function restoreSystemExampleFiles() {
  for (const file of systemExampleFiles) {
    if (!virtualFiles.has(file.path)) {
      virtualFiles.writeText(file.path, file.data);
    }
  }
}

function createImportInput(accept) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.style.display = "none";
  document.body.appendChild(input);
  return input;
}

function createJavaScriptDataUrl(source) {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }

  return `data:text/javascript;base64,${btoa(binary)}`;
}

const tfiImportInput = createImportInput(
  ".tfi,application/octet-stream"
);
const cassetteImportInput = createImportInput(
  ".zip,application/zip"
);
const vgmImportInput = createImportInput(
  ".vgm,.vgz,audio/vgm,application/octet-stream"
);
const virtualFileImportInput = createImportInput("*");
let pendingVgmImportFile = null;
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
    setReadOnly(readOnly) {
      textarea.readOnly = readOnly;
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

function exportCassette() {
  try {
    saveActiveVirtualFile();
    const zip = createPlaygroundCassetteZip(
      virtualFiles.list().filter(
        (file) => !isSystemVirtualPath(file.path) ||
          file.data !== systemExampleFiles.find(
            (example) => example.path === file.path
          )?.data
      )
    );
    const name = window.prompt(
      "Cassette name",
      "my-project"
    );
    if (!name) {
      return;
    }
    const normalizedName = name
      .trim()
      .replace(/\.cassette\.zip$/i, "")
      .replace(/[^A-Za-z0-9_-]/g, "-") || "cassette";
    const url = URL.createObjectURL(
      new Blob([zip], { type: "application/zip" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${normalizedName}.cassette.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${link.download}.`);
  } catch (error) {
    setStatus(`Failed to export cassette: ${error.message}`);
  }
}

function promptVgmImport() {
  pendingVgmImportFile = null;
  vgmImportInput.value = "";
  vgmImportInput.click();
}

function resolveVgmImportStrategy(
  vgm,
  selectedChip,
  options
) {
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
  const scheduled = options.mode === "schedule";
  const timing = scheduled ? "Schedule" : "Write";

  if (useNativeYm2610) {
    return {
      source: exportYm2610BVgmToPlaygroundJavaScript(vgm, { scheduled: false }),
      statusMessage: "for native Neo Geo YM2610 FM (Write timing; SSG and ADPCM omitted)",
    };
  }

  if (useNativeYm2608) {
    return {
      source: exportYm2608VgmToPlaygroundJavaScript(vgm, { scheduled: false }),
      statusMessage: "for native YM2608 FM (Write timing; SSG, Rhythm, and ADPCM-B omitted)",
    };
  }

  if (useNativeYm2203) {
    return {
      source: exportYm2203VgmToPlaygroundJavaScript(vgm, { scheduled: false }),
      statusMessage: "for native YM2203 FM (Write timing; SSG omitted)",
    };
  }

  if (isYm2608Only) {
    return {
      source: exportYm2608FmVgmToPlaygroundJavaScript(vgm, { scheduled }),
      statusMessage: `as YM2608 FM only (${timing} timing; SSG, Rhythm, and ADPCM-B omitted)`,
    };
  }

  if (isYm2203Only) {
    return {
      source: exportYm2203FmVgmToPlaygroundJavaScript(vgm, { scheduled }),
      statusMessage: `as YM2203 FM only (${timing} timing; SSG omitted)`,
    };
  }

  return {
    source: vgm.exportPlaygroundJavaScript({
      scheduled: options.mode === "schedule",
      high: options.mode === "high",
      includeDac: options.includeDac,
      dacBase64: options.dacBase64,
      writeDacFile: options.writeDacFile,
    }),
    statusMessage: options.mode === "high"
      ? "as High (YM2612 frequency/key operations; raw DAC writes)"
      : `with ${timing} timing`,
  };
}

async function importVgmFile(file, options) {
  const decoded = await maybeDecodeVgmFile(
    await file.arrayBuffer()
  );
  const vgm = new Ym2612VGM(decoded, { logger: null });
  const dacFiles = [];
  const strategy = resolveVgmImportStrategy(
    vgm,
    selectedChip,
    {
      ...options,
      writeDacFile(bytes) {
        let path;
        do {
          path = `/vgmdat-${crypto.randomUUID()}.dat`;
        } while (virtualFiles.has(path));
        dacFiles.push({ path, bytes });
        return path;
      },
    }
  );

  for (const { path, bytes } of dacFiles) virtualFiles.writeBinary(path, bytes);
  setEditorValue(strategy.source);
  renderVirtualFileExplorer();
  setStatus(
    `Imported ${file.name} ${strategy.statusMessage}.`
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
  const text = String(value);
  virtualFiles.writeText(activeVirtualPath, text);
  editorAdapter.setValue(text);
}

function saveActiveVirtualFile() {
  virtualFiles.writeText(
    activeVirtualPath,
    getEditorValue()
  );
}

function showVirtualFile(file) {
  editorAdapter.openVirtualFile?.(
    file.path,
    file.data
  );
  editorAdapter.setReadOnly?.(false);
  editorAdapter.setValue(file.data);
}

function renderRunFileOptions() {
  const previousPath = runVirtualPath;
  runFileSelect.replaceChildren();
  const projectFiles = virtualFiles.list()
    .filter(
      (file) =>
        file.type === "text" &&
        file.path.endsWith(".js") &&
        !isSystemVirtualPath(file.path)
    )
    .sort(projectFileOrder);
  const projectGroup = document.createElement("optgroup");
  projectGroup.label = "Project files";

  for (const file of projectFiles) {
    const option = document.createElement("option");
    option.value = file.path;
    option.textContent = file.path;
    projectGroup.appendChild(option);
  }
  runFileSelect.appendChild(projectGroup);

  const exampleGroup = document.createElement("optgroup");
  exampleGroup.label = "Built-in examples";
  const systemFilesByName = new Map(
    systemExampleFiles.map((file) => [
      file.path.slice(SYSTEM_EXAMPLE_PREFIX.length, -3),
      file,
    ])
  );
  const orderedSystemFiles = [
    ...SYSTEM_EXAMPLE_ORDER.map((name) => systemFilesByName.get(name)),
    ...systemExampleFiles.filter(
      (file) => !SYSTEM_EXAMPLE_ORDER.includes(
        file.path.slice(SYSTEM_EXAMPLE_PREFIX.length, -3)
      )
    ),
  ].filter(Boolean);
  for (const file of orderedSystemFiles) {
    const option = document.createElement("option");
    option.value = file.path;
    option.textContent = formatSystemExampleLabel(file.path);
    exampleGroup.appendChild(option);
  }
  runFileSelect.appendChild(exampleGroup);

  runVirtualPath = virtualFiles.has(previousPath)
    ? previousPath
    : "/index.js";
  runFileSelect.value = runVirtualPath;
}

function renderVirtualFileExplorer() {
  fileExplorerList.replaceChildren();
  const files = virtualFiles.list()
    .filter((file) => !isSystemVirtualPath(file.path))
    .sort(projectFileOrder);

  for (const file of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-entry";
    button.textContent = file.path.slice(1);
    button.setAttribute(
      "aria-current",
      file.path === activeVirtualPath ? "true" : "false"
    );
    button.addEventListener("click", () => {
      openVirtualFile(file.path);
    });
    fileExplorerList.appendChild(button);
  }
}

function openVirtualFile(path) {
  const file = virtualFiles.get(path);
  if (!file) {
    return;
  }
  if (file.type !== "text") {
    setStatus(`${path} is a binary file and cannot be edited here.`);
    return;
  }

  saveActiveVirtualFile();
  activeVirtualPath = file.path;
  showVirtualFile(file);
  editorAdapter.focus();
  renderVirtualFileExplorer();
}

function createVirtualFile() {
  const path = window.prompt("New file path", "/lib/new-file.js");
  if (!path) {
    return;
  }
  try {
    const normalizedPath = normalizeVirtualPath(path);
    if (isSystemVirtualPath(normalizedPath)) {
      throw new Error("/sys is reserved for built-in files.");
    }
    if (virtualFiles.has(normalizedPath)) {
      throw new Error("A file already exists at that path.");
    }
    virtualFiles.writeText(normalizedPath, "");
    renderRunFileOptions();
    openVirtualFile(normalizedPath);
  } catch (error) {
    setStatus(`Could not create file: ${error.message}`);
  }
}

function promptVirtualFileImport() {
  virtualFileImportInput.value = "";
  virtualFileImportInput.click();
}

async function importVirtualFile(file) {
  const path = window.prompt(
    "Import file path",
    `/${file.name}`
  );
  if (!path) {
    return;
  }
  const normalizedPath = normalizeVirtualPath(path);
  if (isSystemVirtualPath(normalizedPath)) {
    setStatus("/sys is reserved for built-in files.");
    return;
  }
  if (
    virtualFiles.has(normalizedPath) &&
    !window.confirm(`Replace ${normalizedPath}?`)
  ) {
    return;
  }

  virtualFiles.writeBinary(
    normalizedPath,
    new Uint8Array(await file.arrayBuffer())
  );
  registerVirtualTfiPreset(normalizedPath);
  renderVirtualFileExplorer();
  renderRunFileOptions();
  setStatus(`Imported binary file: ${normalizedPath}`);
}

function registerVirtualTfiPreset(path) {
  if (!path.startsWith("/presets/") || !path.endsWith(".tfi")) {
    return;
  }
  const virtualFile = virtualFiles.get(path);
  if (!virtualFile || virtualFile.type !== "binary") {
    return;
  }

  const presetId = `vfs:${path}`;
  const preset = parseTfi(virtualFile.data);
  virtualPresetIds.set(path, presetId);
  playgroundPresets[presetId] = preset;
  runtime.presets[presetId] = preset;
  operatorTab.registerPresetOption(
    presetId,
    path.slice("/presets/".length)
  );
}

function registerVirtualTfiPresets() {
  for (const file of virtualFiles.list()) {
    registerVirtualTfiPreset(file.path);
  }
}

function clearVirtualTfiPresets() {
  for (const presetId of virtualPresetIds.values()) {
    delete playgroundPresets[presetId];
    delete runtime.presets[presetId];
    operatorTab.removePresetOption(presetId);
  }
  virtualPresetIds.clear();
}

function renameActiveVirtualFile() {
  if (isSystemVirtualPath(activeVirtualPath)) {
    setStatus("Built-in example files cannot be renamed.");
    return;
  }
  const path = window.prompt("Rename file", activeVirtualPath);
  if (!path || path === activeVirtualPath) {
    return;
  }
  try {
    const normalizedPath = normalizeVirtualPath(path);
    if (isSystemVirtualPath(normalizedPath)) {
      throw new Error("/sys is reserved for built-in files.");
    }
    if (virtualFiles.has(normalizedPath)) {
      throw new Error("A file already exists at that path.");
    }
    saveActiveVirtualFile();
    const currentFile = virtualFiles.get(activeVirtualPath);
    virtualFiles.writeText(normalizedPath, currentFile.data);
    virtualFiles.delete(activeVirtualPath);
    const previousPath = activeVirtualPath;
    activeVirtualPath = normalizedPath;
    if (runVirtualPath === previousPath) {
      runVirtualPath = normalizedPath;
    }
    renderVirtualFileExplorer();
    renderRunFileOptions();
  } catch (error) {
    setStatus(`Could not rename file: ${error.message}`);
  }
}

function deleteActiveVirtualFile() {
  if (isSystemVirtualPath(activeVirtualPath)) {
    setStatus("Built-in example files cannot be deleted.");
    return;
  }
  if (activeVirtualPath === "/index.js") {
    setStatus("/index.js is the project entry point and cannot be deleted.");
    return;
  }
  if (!window.confirm(`Delete ${activeVirtualPath}?`)) {
    return;
  }
  saveActiveVirtualFile();
  if (runVirtualPath === activeVirtualPath) {
    runVirtualPath = "/index.js";
  }
  virtualFiles.delete(activeVirtualPath);
  activeVirtualPath = "/index.js";
  showVirtualFile(virtualFiles.get(activeVirtualPath));
  renderVirtualFileExplorer();
  renderRunFileOptions();
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
function createRuntime() {
  return createPlaygroundRuntime({
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
}

const runtime = createRuntime();

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
    saveActiveVirtualFile();
    const entryFile = virtualFiles.get(runVirtualPath);
    if (!entryFile || entryFile.type !== "text") {
      throw new Error(`Run file ${runVirtualPath} is missing.`);
    }
    const source = resolveVirtualDynamicImports(
      virtualFiles,
      entryFile.data,
      runVirtualPath,
      (moduleSource, modulePath) => createJavaScriptDataUrl(
        `${createVirtualFileRuntimeSource(virtualFiles, modulePath)}\n${moduleSource}`
      )
    );
    runtime.put(
      "__editor__",
      `${createVirtualFileRuntimeSource(virtualFiles, runVirtualPath, { install: true })}\n${source}`
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

function parseCassetteAssets(cassette) {
  return {
    cassette,
    timbres: cassette.timbres.map((timbre) => ({
      ...timbre,
      preset: parseTfi(timbre.bytes),
    })),
    examples: cassette.examples.map((example) => ({
      optionValue: `cassette:${cassette.id}/${example.name}`,
      name: example.name,
      source: example.source,
    })),
    samples: cassette.samples,
  };
}

function validateCassetteConflicts(assets) {
  for (const timbre of assets.timbres) {
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

  for (const sampleEntry of assets.samples) {
    if (runtime.sample.isLoaded(sampleEntry.name)) {
      throw new Error(
        `Cassette sample "${sampleEntry.name}" is already loaded.`
      );
    }
  }

  for (const example of assets.examples) {
    if (cassetteExamples.has(example.optionValue)) {
      throw new Error(
        `Cassette example "${example.name}" is already loaded.`
      );
    }
  }
}

async function registerCassetteAssets(assets) {
  if (assets.samples.length > 0) {
    await runtime.ensureReady();
    for (const sampleEntry of assets.samples) {
      await runtime.sample.load(
        sampleEntry.name,
        sampleEntry.bytes.buffer
      );
    }
  }

  for (const timbre of assets.timbres) {
    playgroundPresets[timbre.name] = timbre.preset;
    runtime.presets[timbre.name] = timbre.preset;
    operatorTab.registerPresetOption(timbre.name);
  }

  for (const example of assets.examples) {
    cassetteExamples.set(
      example.optionValue,
      example.source
    );
  }
}

function appendCassetteExamplesToUi(assets) {
  renderRunFileOptions();
}

function formatCassetteStatus(assets) {
  const statusParts = [];
  if (assets.timbres.length > 0) {
    statusParts.push(`${assets.timbres.length} timbre(s)`);
  }
  if (assets.examples.length > 0) {
    statusParts.push(`${assets.examples.length} example(s)`);
  }
  if (assets.samples.length > 0) {
    statusParts.push(`${assets.samples.length} sample(s)`);
  }

  return `Loaded cassette ${assets.cassette.id}${statusParts.length > 0 ? `: ${statusParts.join(", ")}.` : "."}`;
}

function restoreVirtualFilesFromCassette(cassette) {
  const textExtensions = /\.(?:js|json|md|txt)$/i;
  const previousSource = getEditorValue();
  clearVirtualTfiPresets();
  virtualFiles.replace(
    Array.from(cassette.files, ([path, bytes]) => ({
      path: `/${path}`,
      data: textExtensions.test(path)
        ? new TextDecoder().decode(bytes)
        : bytes,
    }))
  );

  if (!virtualFiles.has("/index.js")) {
    virtualFiles.writeText("/index.js", previousSource);
  }
  restoreSystemExampleFiles();
  editorAdapter.syncVirtualFiles?.(virtualFiles.list());
  registerVirtualTfiPresets();
  activeVirtualPath = "/index.js";
  showVirtualFile(virtualFiles.get(activeVirtualPath));
  renderVirtualFileExplorer();
  runVirtualPath = "/index.js";
  renderRunFileOptions();
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
  restoreVirtualFilesFromCassette(cassette);
  const assets = parseCassetteAssets(cassette);
  validateCassetteConflicts(assets);
  await registerCassetteAssets(assets);
  appendCassetteExamplesToUi(assets);
  setStatus(formatCassetteStatus(assets));
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

function setExpandedMode(expanded) {
  document.body.classList.toggle(
    "mode-expanded",
    expanded
  );
  expandButton?.setAttribute(
    "aria-pressed",
    expanded ? "true" : "false"
  );
  expandButton?.setAttribute(
    "aria-label",
    expanded ? "Collapse editor" : "Expand editor"
  );
  if (expandButton) {
    expandButton.title =
      expanded ? "Collapse editor" : "Expand editor";
  }

  if (expanded) {
    runButton.before(mainMenu);
    toolbar?.after(statusBar);
    return;
  }

  mainMenu.open = false;
  mainMenuHome?.before(mainMenu);
  document.body.append(statusBar);
}

function installPlaygroundEventHandlers() {
  document.body.append(vgmImportDialog);
  importVgmButton.addEventListener("click", promptVgmImport);
  vgmImportDialog.addEventListener("close", () => {
    pendingVgmImportFile = null;
    runButton.focus();
  });
  exportCassetteButton?.addEventListener("click", exportCassette);
  newFileButton?.addEventListener("click", createVirtualFile);
  importFileButton?.addEventListener("click", promptVirtualFileImport);
  renameFileButton?.addEventListener("click", renameActiveVirtualFile);
  deleteFileButton?.addEventListener("click", deleteActiveVirtualFile);
  expandButton?.addEventListener(
    "click",
    () => {
      setExpandedMode(
        !document.body.classList.contains("mode-expanded")
      );
    }
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        document.body.classList.contains("mode-expanded")
      ) {
        setExpandedMode(false);
        expandButton?.focus();
      }
    }
  );

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

  runFileSelect.addEventListener(
    "change",
    () => {
      runVirtualPath = runFileSelect.value;
      openVirtualFile(runVirtualPath);
      setStatus(`Run file: ${runVirtualPath}`);
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
      const file = pendingVgmImportFile;
      if (!file) return;
      const options = {
          mode: selectedMode?.value ?? "write",
          includeDac: includeDacInput?.checked ?? true,
          dacBase64: dacBase64Input?.checked ?? true,
      };
      vgmImportDialog.close();
      pendingVgmImportFile = null;
      void importVgmFile(file, options).catch((error) => {
        setStatus(`Failed to import VGM: ${error.message}`);
      });
    }
  );

  function syncDacBase64Option() {
    const selectedMode = document.querySelector(
      'input[name="vgmImportMode"]:checked'
    );
    const mode = selectedMode?.value ?? "write";
    if (dacBase64Input) {
      dacBase64Input.disabled = mode === "high";
    }
    if (dacBase64Label) {
      dacBase64Label.hidden = false;
      dacBase64Label.title = mode === "high"
        ? "High keeps DAC writes in their original order."
        : mode === "schedule"
        ? "Preload DAC from a virtual .dat file without scheduling every DAC write."
        : "Store DAC data in a virtual .dat file loaded with file().";
    }
  }

  document.querySelectorAll('input[name="vgmImportMode"]').forEach(
    (input) => input.addEventListener("change", syncDacBase64Option)
  );
  syncDacBase64Option();

  cancelVgmImportButton?.addEventListener(
    "click",
    () => {
      vgmImportDialog.close();
      pendingVgmImportFile = null;
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

  virtualFileImportInput.addEventListener(
    "change",
    () => {
      const file = virtualFileImportInput.files?.[0];
      if (!file) {
        return;
      }
      void importVirtualFile(file).catch((error) => {
        setStatus(`Failed to import file: ${error.message}`);
      });
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

      pendingVgmImportFile = file;
      vgmImportFilename.textContent = file.name;
      mainMenu.open = false;
      vgmImportDialog.showModal();
    }
  );
}

function bootPlayground() {
  applyInitialSourceFromQuery();
  void applyCassetteFromQuery();
  applySimpleModeFromQuery();
  clearConsole();
  setBottomTab("code");
  setRuntimeState("Audio idle");
  renderVirtualFileExplorer();
  renderRunFileOptions();
  installPlaygroundEventHandlers();
  ui.installBottomTabHandlers();
  installTfiEditorDropTarget();
  void initializePlaygroundMonaco({
    chip: selectedChip,
    editor,
    editorHost,
    getEditorValue,
    listVirtualFiles() {
      return virtualFiles.list();
    },
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
}

bootPlayground();
