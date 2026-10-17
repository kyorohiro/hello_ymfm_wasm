import {installFileExplorerResize} from './playground_file_resize.js';
import {installFileExplorerMenu} from './playground_file_menu.js?v=file-menu-1';
import {installPlaygroundWorkbench} from './playground_workbench.js?v=keyboard-helper-panel-1';
import {installPlaygroundShell} from './playground_shell.js?v=compact-shell-1';
import {installPlaygroundGit} from './playground_git.js';
import {openDraftStore, createProjectAutosave} from './playground_autosave.js';
let desktopAutosave = null;
let playgroundShell = null;
let fileExplorerMenu = null;
let restoredDesktopProject = false;
let pendingDesktopCassetteAssets = null;
const cassettePresetNames = new Set();
const cassetteSampleNames = new Set();
import {exportYm2608FullVgm} from './ym2608_vgm_import.js?v=loop-async-tasks-1';
import {prepareVgmImport, exportGameboyVgm, exportNesVgm, exportRf5c164Vgm, addVgmSoundChipSetup, exportYm2203FullVgm} from './playground_vgm_import.js?v=loop-async-tasks-1';
import {installPlaygroundPageLifecycle} from "./playground_page_lifecycle.js";
import {createFXMonitor} from './playground_fx_monitor.js?v=vertical-range-1';
import {createAudioMonitor} from './playground_audio_monitor.js?v=vertical-range-1';
import {installMidiImport} from './playground_midi_import.js?v=midi-sections-1';
import {
  FM_PRESET_ORDER,
  FM_PRESETS,
} from "../js/megasynth.js";
import {
  createTetoricaSynth,
  normalizeTetoricaChip,
} from "../js/tetorica_synth.js?v=prepared-fx-rerun-2";
import {
  createTfiOperatorObjectText,
  createTfiPresetObjectText,
  createTfiFromPreset,
  parseTfi,
} from "../js/tfi.js";
import { createVgiFromPreset, parseVgi } from "../js/vgi.js";
import {
  createPlaygroundOperatorTab,
} from "./playground_operator_tab.js";
import { createPlaygroundOperatorKeyboard } from "./playground_operator_keyboard.js?v=keyboard-controls-minimize-1";
import { CHIP_CLOCKS } from "../js/playground_chip_clock.js";
import { DEFAULT_CODE, EXAMPLES, EXAMPLE_FILES } from "./playground_examples.js?v=dx7-soundchip-1";
import { initializePlaygroundMonaco } from "./playground_monaco.js?v=dx7-soundchip-1";
import {
  decodeBase64Bytes,
  loadTfiPresetsFromQuery,
  loadVgiPresetsFromQuery,
  resolveInitialSourceFromQuery,
} from "./playground_query.js";
import {
  createPlaygroundCassetteZip,
  loadPlaygroundCassette,
} from "./playground_cassette.js?v=virtual-files-1";
import {
  createVirtualFileSystem,
  createVirtualFileRuntimeSource,
  normalizeVirtualPath,
  CHECKPOINT_ROOT,
  isCheckpointVirtualPath,
  transferVirtualFiles,
  resolveVirtualDynamicImports,
} from "./playground_virtual_files.js?v=virtual-files-1";
import { unzipSync, zipSync } from "./vendor/fflate.js";
import {
  exportYm2203FmVgmToPlaygroundJavaScript,
  exportYm2608FmVgmToPlaygroundJavaScript,
  exportYm2610FmVgmToPlaygroundJavaScript,
} from "../js/ym2612vgm.js";
import { exportYm2203VgmToPlaygroundJavaScript } from "../js/ym2203vgm.js";
import { exportYm2608VgmToPlaygroundJavaScript } from "../js/ym2608vgm.js";
import { exportYm2610BVgmToPlaygroundJavaScript } from "../js/ym2610bvgm.js";
import {
  createPlaygroundRuntime,
} from "../js/playground_runtime.js?v=worker-lookahead-1";
import { createVgmPresetFiles } from "./playground_vgm_presets.js";
import { createTfiFileEditor, instrumentToEditorPreset } from "./playground_tfi_editor.js?v=audio-preview-monitor-1";
import { renderFileTree } from "./playground_file_tree.js?v=file-menu-1";
import { createPlaygroundUi, applyPlaygroundLayout } from "./playground_ui.js?v=menu-settings-1";
import {
  handleMegaSynthEvent,
} from "./playground_sync.js";

const REFERENCE_MIDI = 62;
window.__playgroundStartup?.stage('Starting Playground… Preparing your project.');
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
const mainMenu =
  document.getElementById("mainMenu");
const toolbar =
  document.querySelector(".toolbar");
const statusBar =
  document.querySelector(".status-bar");
const workerLookaheadInput = document.getElementById("workerLookaheadMs");
const workerLookaheadButton = document.getElementById("workerLookaheadButton");
const workerLookaheadValue = document.getElementById("workerLookaheadValue");
const workerLookaheadDialog = document.getElementById("workerLookaheadDialog");
const workerLookaheadForm = document.getElementById("workerLookaheadForm");
const applyWorkerLookaheadButton = document.getElementById("applyWorkerLookaheadButton");
const workerLookaheadPlaybackHint = document.getElementById("workerLookaheadPlaybackHint");
const workerLookaheadStorageKey = "tetorica.playground.workerLookaheadMs";
function readWorkerLookahead() {
  try {
    const saved = localStorage.getItem(workerLookaheadStorageKey);
    const value = saved === null ? 150 : Number(saved);
    return Number.isFinite(value) && value >= 0 && value <= 2000 ? value : 150;
  } catch { return 150; }
}
if (workerLookaheadInput) workerLookaheadInput.value = String(readWorkerLookahead());
const workerExecution =
  document.getElementById("workerExecution");
const importCassetteButton =
  document.getElementById(
    "importCassetteButton"
  );
const exportCassetteButton = document.getElementById("exportCassetteButton");
const exportTfiButton = document.getElementById("exportTfiButton");
const exportVgiButton = document.getElementById("exportVgiButton");
const fileExplorer = document.getElementById("fileExplorer");
const workbench = installPlaygroundWorkbench(document.getElementById("workPanels"));
installFileExplorerResize(fileExplorer, document.getElementById("fileExplorerDivider"));
const cassetteExportDialog = document.getElementById("cassetteExportDialog");
const cassetteLicenseSelect = document.getElementById("cassetteLicenseSelect");
const cassetteWorkTypeSelect = document.getElementById("cassetteWorkTypeSelect");
const cassetteLicenseCustomName = document.getElementById("cassetteLicenseCustomName");
const cassetteLicenseInherited = document.getElementById("cassetteLicenseInherited");
const confirmCassetteExportButton = document.getElementById("confirmCassetteExportButton");
const importVgmButton = document.getElementById("importVgmButton");
const vgmImportDialog = document.getElementById("vgmImportDialog");
const vgmImportFilename = document.getElementById("vgmImportFilename");
const vgmImportTarget = document.getElementById("vgmImportTarget");
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
let listeningVolume = 1;
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
const codeFileActions = document.getElementById('codeFileActions');
const syncCodeButton = document.getElementById('syncCodeButton');
const revertCodeButton = document.getElementById('revertCodeButton');
const codeSyncAnnouncement = document.getElementById('codeSyncAnnouncement');
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
const keyboardTab = document.getElementById("keyboardTab");
const keyboardPanel = document.getElementById("keyboardPanel");
const operatorKeyboardRoot = document.getElementById("operatorKeyboardRoot");

// Experimental: ?engine=nuked swaps the YM2612 core for Nuked-OPN2
// (https://github.com/nukeykt/Nuked-OPN2) instead of the default ymfm
// backend.
const playgroundSearch = new URLSearchParams(
  window.location.search
);
const selectedChip = normalizeTetoricaChip(
  playgroundSearch.get("chip")
);
const selectedChipClock = CHIP_CLOCKS[selectedChip === 'ym2610b' ? 'ym2610' : selectedChip];
const useNukedEngine =
  selectedChip === "ym2612" &&
  playgroundSearch.get("engine") === "nuked";
const selectedWorkletChip =
  selectedChip === "ym2610"
    ? "ym2610b"
    : selectedChip;

const synthOptions = {
  chip: selectedChip,
  workletUrl: useNukedEngine
    ? "../js/ym2612-worklet-nuked.js?v=perf-queue-1"
    : `../js/${selectedWorkletChip}-worklet.js?v=perf-queue-1`,
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
};
const megaDrive = createTetoricaSynth(synthOptions);

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
const urlVgiResult =
  loadVgiPresetsFromQuery(
    window.location.search
  );
const playgroundPresets = {
  ...FM_PRESETS,
  ...urlTfiResult.presets,
  ...urlVgiResult.presets,
};
let editorAdapter =
  createTextareaEditorAdapter(
    editor
  );
const bundledExampleFiles = EXAMPLE_FILES;
const initialProjectFiles = [
  // A new project starts with the previous Live Loop example as its entry point.
  { path: "/index.js", data: DEFAULT_CODE },
  { path: "/scripts/example.js", data: [
    "const {fs, shell, args, cwd} = await import('tetorica:shell');",
    "console.log('Shell script:', cwd, args);",
    "const source = await fs.readFile('/index.js');",
    "await fs.writeText('/scripts/index-copy.js', source);",
    "const result = await shell.execute(['ls', '/scripts']);",
    "if (result.code) throw new Error(result.stderr);",
    "console.log(result.stdout);",
    "",
  ].join('\n') },
  { path: "/presets/README.md", data: [
    "# Presets",
    "",
    "Store your YM2612 TFI or VGI instruments in this folder.",
    "",
    "1. Use FILES > Import and choose a .tfi or .vgi file. The suggested path is /presets/<filename>.",
    "2. Open the instrument in FILES to edit its Operator parameters and audition it with the keyboard.",
    "3. Download the edited instrument, or use Save Cassette to save the project and its files.",
    "",
    "VGM imports also place extracted TFI instruments under /presets/<track>/.",
    "Drop TFI or VGI files onto the presets folder to add them to the preset list. ZIP contents keep their internal paths beneath the drop folder.",
    "",
    "TFI and VGI contain instrument parameters, not the source chip clock. VGI also stores pan, AMS and PMS. Neither format stores global LFO enable/rate or per-operator AM flags. Keep any source OPM and conversion.json alongside converted instruments for reference.",
    "",
    "This README is a starter file. You can edit or delete it.",
    "",
  ].join("\n") },
  { path: "/lib/README.md", data: [
    "# Libraries",
    "",
    "Store reusable JavaScript modules here. The folder name lib is a convention, not a requirement.",
    "Export values from a module and load them with await import(...). There is no await export syntax.",
    "",
    "Create /lib/notes.js:",
    "```js",
    "export const notes = ['C4', 'E4', 'G4'];",
    "```",
    "",
    "Then use it in /index.js:",
    "```js",
    "const { notes } = await import('./lib/notes.js');",
    "for (const note of notes) {",
    "  await play(note, { channel: CH1, duration: 0.2 });",
    "  await sleep(0.25);",
    "}",
    "```",
    "",
    "Relative import paths are resolved from the importing file. From /examples/demo.js, use ../lib/notes.js.",
    "This README is a starter file. You can edit or delete it.",
    "",
  ].join("\n") },
  { path: "/samples/README.md", data: [
    "# Samples",
    "",
    "Store audio files here, such as /samples/kick.wav. Import or drop your own files into FILES.",
    "",
    "Load and play a file from your project:",
    "```js",
    "await sample.load('kick', '/samples/kick.wav');",
    "await sample.play('kick', { gain: 0.8 });",
    "```",
    "",
    "The file must exist before running this example. Use an absolute project path when loading audio.",
    "Cassette imports classify audio files directly inside samples/ as samples; sample.load can also load other project paths.",
    "Use Save Cassette to save the project together with its audio files.",
    "This README is a starter file. You can edit or delete it.",
    "",
  ].join("\n") },
  { path: "/examples/README.md", data: [
    "# Examples",
    "",
    "Store your runnable JavaScript examples here, such as /examples/demo.js.",
    "Select the JavaScript file in the Run file selector, then press Run.",
    "The default entry point is /index.js. Merely adding a file does not run it.",
    "",
    "Bundled examples are grouped into basic, fm, midi, psg, dac, noise, samples and fx folders.",
    "Open a .js file in FILES to edit it and select it as the Run file.",
    "Ctrl/Cmd+S syncs the displayed text or TFI/VGI file to /.tet.ss. Revert restores that copy. Cassette export includes it.",
    "For shared code, create a module in /lib/ and load it from your example:",
    "```js",
    "const { notes } = await import('../lib/notes.js');",
    "```",
    "See /lib/README.md for the matching module example.",
    "",
    "Cassette imports classify JavaScript files directly inside examples/ as examples.",
    "This README is a starter file. You can edit or delete it.",
    "",
  ].join("\n") },
  ...bundledExampleFiles,
];
const virtualFiles = createVirtualFileSystem(initialProjectFiles);
let activeVirtualPath = "/index.js";
let runVirtualPath = "/index.js";
let codeCheckpointCache = null;
let codeSyncFeedback = null;
let codeSyncFeedbackTimer = null;
const virtualPresetIds = new Map();

function isSystemVirtualPath(path) {
  return path.startsWith("/sys/");
}

// UI policy only: checkpoints remain in snapshots, autosaves and Cassettes.
function isHiddenVirtualPath(path) {
  return isSystemVirtualPath(path) || isCheckpointVirtualPath(path);
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

function restoreBundledExampleFiles() {
  for (const file of bundledExampleFiles) {
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
  ".tfi,.vgi,application/octet-stream"
);
const cassetteImportInput = createImportInput(
  ".zip,application/zip"
);
const vgmImportInput = createImportInput(
  ".vgm,.vgz,.s98,audio/vgm,application/octet-stream"
);
const virtualFileImportInput = createImportInput("*");
let pendingVgmImportFile = null;
let pendingVgmImport = null;
let vgmImportRequest = 0;
const cassetteExamples = new Map();
let currentCassetteMetadata = null;
let currentCassetteHasMetadataFile = false;
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
const operatorKeyboard = createPlaygroundOperatorKeyboard({
  root: operatorKeyboardRoot,
  auditionPriority: true,
  minimizeHost: keyboardPanel,
  onControlsMinimizedChange: minimized => operatorPanel.classList.toggle('keyboard-controls-minimized', minimized),
  // The opened instrument's independent preview owns computer keys while visible.
  // The main Keyboard panel remains available for pointer auditions.
  canHandleComputerKeys: () => !(activeTfiFilePath && !codePanel.hidden),
  getClock: () => (megaDrive.fm?.fm ?? megaDrive.fm)?.clock ?? selectedChipClock,
  clockDivider: selectedChip === 'ym2203' ? 72 : 144,
  getSelectedChannel: () => operatorTab.getSelectedChannel(),
  channelCount: megaDrive.capabilities.fmChannels,
  presets: playgroundPresets,
  presetOrder: FM_PRESET_ORDER,
  ensureAudioReady: () => runtime.prepareAudition(),
  onChannelChange(channel) {
    operatorTab.selectChannel?.(channel);
  },
  onPresetChange(channel, presetName) {
    if (presetName) {
      if (channel === null) {
        const selectedChannel = operatorTab.getSelectedChannel?.() ?? 0;
        for (let target = 0; target < megaDrive.capabilities.fmChannels; target += 1) {
          operatorTab.selectPreset?.(target, presetName);
        }
        operatorTab.selectChannel?.(selectedChannel);
      } else {
        operatorTab.selectPreset?.(channel, presetName);
      }
    }
  },
  onStatus(message) {
    setStatus(message);
  },
});

operatorTabRoot.addEventListener("change", () => operatorKeyboard.syncChannel());

let activeTfiFilePath = null;
const tfiFileEditor = createTfiFileEditor({
  root: document.getElementById("tfiFileEditor"),
  operatorRoot: document.getElementById("tfiFileOperator"),
  keyboardRoot: document.getElementById("tfiFileKeyboard"),
  minimizableKeyboard: true,
  title: document.getElementById("tfiFileTitle"),
  createAudio: () => createTetoricaSynth(synthOptions),
  clock: selectedChipClock,
  clockDivider: selectedChip === 'ym2203' ? 72 : 144,
  onSave(path, bytes) {
    virtualFiles.writeBinary(path, bytes);
    registerVirtualInstrumentPreset(path);
  },
  onStatus: message => setStatus(message),
});
window.addEventListener("pagehide", event => {
  if (!event.persisted) {
    operatorTab.dispose();
    void tfiFileEditor.dispose();
  }
});

function updateMasterVolumeUi() {
  const masterVolume =
    listeningVolume;
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
  megaDrive.audio.setListeningVolume(listeningVolume);
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
      desktopAutosave?.changed();
      refreshCodeFileActions();
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
      desktopAutosave?.changed();
      textarea.focus();
      refreshCodeFileActions();
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
  const bytes = new Uint8Array(await file.arrayBuffer());
  const preset = bytes.length === 43 ? parseVgi(bytes) : parseTfi(bytes);
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

function parseCassetteMetadataModule(source) {
  const match = String(source).match(
    /export\s+default\s+([\s\S]*?)\s*;?\s*$/
  );
  if (!match) {
    throw new Error("cassette.metadata.js must export a default object.");
  }
  return JSON.parse(match[1]);
}

function readCassetteMetadataFromVirtualFiles() {
  const moduleFile = virtualFiles.get("/cassette.metadata.js");
  if (moduleFile?.type === "text") {
    return parseCassetteMetadataModule(moduleFile.data);
  }
  const jsonFile = virtualFiles.get("/metadata.json");
  if (jsonFile?.type === "text") {
    return JSON.parse(jsonFile.data);
  }
  return null;
}

function formatCassetteMetadataModule(metadata) {
  return `/**
 * @typedef {Object} CassetteMetadata
 * @property {number} version
 * @property {"NONE"|"ORIGINAL"|"TRANSCRIPTION"} workType
 * @property {"NONE"|"PRIVATE"|"CC0-1.0"|"CC-BY-4.0"|"CUSTOM"} license
 * @property {string} [licenseName]
 */
/** @type {CassetteMetadata} */
export default ${JSON.stringify(metadata, null, 2)};
`;
}

function promptCassetteExport() {
  try {
    const metadata = readCassetteMetadataFromVirtualFiles();
    if (metadata) {
      currentCassetteMetadata = metadata;
    }
  } catch {
    setStatus("Cassette metadata is not valid; using the previous license metadata.");
  }
  const license = currentCassetteMetadata?.license ?? "NONE";
  cassetteLicenseSelect.value = typeof license === "object" ? license.type : license;
  cassetteWorkTypeSelect.value = currentCassetteMetadata?.workType ?? "NONE";
  cassetteLicenseCustomName.value = currentCassetteMetadata?.licenseName ?? license?.name ?? "";
  cassetteLicenseInherited.textContent = currentCassetteMetadata
    ? `Inherited from the current Cassette metadata: ${currentCassetteMetadata.workType ?? "NONE"} / ${cassetteLicenseSelect.value}${cassetteLicenseCustomName.value ? ` (${cassetteLicenseCustomName.value})` : ""}.`
    : "No existing Cassette metadata. Work Type and License default to None.";
  cassetteLicenseCustomName.disabled = cassetteLicenseSelect.value !== "CUSTOM";
  cassetteLicenseSelect.disabled = false;
  cassetteWorkTypeSelect.disabled = false;
  cassetteLicenseCustomName.disabled = cassetteLicenseSelect.value !== "CUSTOM";
  cassetteExportDialog.showModal();
}

function exportCassette() {
  try {
    saveActiveVirtualFile();
    let existingMetadata = currentCassetteMetadata;
    try {
      const metadata = readCassetteMetadataFromVirtualFiles();
      if (metadata) {
        existingMetadata = metadata;
      }
    } catch {
      throw new Error("Cassette metadata is not valid.");
    }
    const metadataFile = virtualFiles.get("/metadata.json");
    const metadataModuleFile = virtualFiles.get("/cassette.metadata.js");
    const updateLicense = !metadataFile && !metadataModuleFile && !currentCassetteHasMetadataFile;
    const existingLicense = existingMetadata?.license ?? "NONE";
    const existingWorkType = existingMetadata?.workType ?? "NONE";
    const selectedLicense = updateLicense ? cassetteLicenseSelect?.value ?? "NONE" : existingLicense;
    const selectedWorkType = updateLicense ? cassetteWorkTypeSelect?.value ?? "NONE" : existingWorkType;
    const zip = createPlaygroundCassetteZip(
      virtualFiles.list().filter((file) =>
        file.path !== "/metadata.json" &&
        file.path !== "/cassette.metadata.js"
      ),
      {
        directories: virtualFiles.listDirectories(),
        license: selectedLicense,
        licenseName: updateLicense ? cassetteLicenseCustomName?.value ?? "" : existingMetadata?.licenseName ?? "",
        workType: selectedWorkType,
        metadata: existingMetadata,
        metadataFileName: "cassette.metadata.js",
      }
    );
    currentCassetteMetadata = {
      ...(existingMetadata && typeof existingMetadata === "object" ? existingMetadata : {}),
      version: 1,
      workType: selectedWorkType,
      license: selectedLicense,
      ...(selectedLicense === "CUSTOM" && (updateLicense ? cassetteLicenseCustomName?.value : existingMetadata?.licenseName)
        ? { licenseName: (updateLicense ? cassetteLicenseCustomName.value : existingMetadata.licenseName).trim() }
        : {}),
    };
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
    const metadataModuleText = formatCassetteMetadataModule(currentCassetteMetadata);
    virtualFiles.delete("/metadata.json");
    virtualFiles.writeText("/cassette.metadata.js", metadataModuleText);
    currentCassetteHasMetadataFile = true;
    editorAdapter.syncVirtualFiles?.(virtualFiles.list().filter(file => !isCheckpointVirtualPath(file.path)));
    if (activeVirtualPath === "/cassette.metadata.js") {
      editorAdapter.setValue(metadataModuleText);
    }
    renderVirtualFileExplorer();
    const url = URL.createObjectURL(
      new Blob([zip], { type: "application/zip" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${normalizedName}.cassette.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${link.download} (${cassetteWorkTypeSelect?.value ?? "NONE"} / ${cassetteLicenseSelect?.value ?? "NONE"}).`);
  } catch (error) {
    setStatus(`Failed to export cassette: ${error.message}`);
  }
}

function promptVgmImport() {
  vgmImportRequest++;
  pendingVgmImport = null;
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
  const splitChannels = options.splitChannels;
  const timing = options.mode === "high" ? "High" : scheduled ? "Schedule" : "Write";
  const fmOptions = { ...options, scheduled, high: options.mode === "high", splitChannels };

  if (useNativeYm2610) {
    return {
      source: exportYm2610BVgmToPlaygroundJavaScript(vgm, { ...fmOptions, scheduled: false }),
      statusMessage: `for native Neo Geo YM2610 FM (${scheduled ? "Write" : timing}; SSG and ADPCM omitted)`,
    };
  }

  if (useNativeYm2608) {
    return {
      source: exportYm2608VgmToPlaygroundJavaScript(vgm, { ...fmOptions, scheduled: false }),
      statusMessage: `for native YM2608 FM (${scheduled ? "Write" : timing}; SSG, Rhythm, and ADPCM-B omitted)`,
    };
  }

  if (useNativeYm2203) {
    return {
      source: exportYm2203VgmToPlaygroundJavaScript(vgm, { ...fmOptions, scheduled: false }),
      statusMessage: `for native YM2203 FM (${scheduled ? "Write" : timing}; SSG omitted)`,
    };
  }

  if (isYm2610Only) {
    return {
      source: exportYm2610FmVgmToPlaygroundJavaScript(vgm, fmOptions),
      statusMessage: `as Neo Geo FM only (${timing}; SSG and ADPCM omitted)`,
    };
  }

  if (isYm2608Only) {
    return {
      source: exportYm2608FmVgmToPlaygroundJavaScript(vgm, fmOptions),
      statusMessage: `as YM2608 FM only (${timing} timing; SSG, Rhythm, and ADPCM-B omitted)`,
    };
  }

  if (isYm2203Only) {
    return {
      source: exportYm2203FmVgmToPlaygroundJavaScript(vgm, fmOptions),
      statusMessage: `as YM2203 FM only (${timing} timing; SSG omitted)`,
    };
  }

  return {
    source: vgm.exportPlaygroundJavaScript({
      scheduled: options.mode === "schedule",
      high: options.mode === "high",
      noteish: options.noteish,
      splitChannels,
      includeDac: options.includeDac,
      includePsg: options.includePsg,
      dacBase64: options.dacBase64,
      writeDacFile: options.writeDacFile,
    }),
    statusMessage: options.mode === "high" && options.noteish
      ? "as Note-ish High (named pitches; nearest semitone)"
      : options.mode === "high"
      ? "as High (YM2612 frequency/key operations)"
      : `with ${timing} timing`,
  };
}

async function importVgmFile(file, options) {
  const targetPath = normalizeVirtualPath(options.targetPath ?? "/index.js");
  const prepared = options.prepared ?? await prepareVgmImport(file);
  const {buffer, vgm, detection} = prepared;
  if (!detection.supported) throw new Error(detection.message);
  if (((detection.rf5c164 && options.includeRf5c164) || detection.family === 'rf5c164') &&
      selectedChip !== 'ym2612' && (detection.family === 'opn' || (options.includePsg && detection.chips.includes('psg')))) {
    throw new Error('Select the YM2612 Playground chip for mixed RF5C164 + FM/PSG conversion.');
  }
  const fullYm2203 = options.ym2203Target === 'ym2203' && selectedChip === 'ym2612' && detection.chip === 'ym2203';
  const fullYm2608 = options.ym2608Target === 'ym2608' && selectedChip === 'ym2612' && detection.chip === 'ym2608';
  const dacFiles = [];
  const strategy = fullYm2608 ? {source: exportYm2608FullVgm(buffer, {mode: options.ym2608Mode, writeMemoryFile(bytes) {
    let path; do { path = `/ym2608-${crypto.randomUUID()}.dat`; } while (virtualFiles.has(path));
    dacFiles.push({path, bytes}); return path;
  }}), statusMessage: 'for YM2608 FM + SSG + rhythm + ADPCM-B'} : fullYm2203 ? {source: exportYm2203FullVgm(buffer, {mode: options.ym2203Mode}), statusMessage: 'for YM2203 FM + SSG'} : detection.family === 'gameboy' ? {
    source: exportGameboyVgm(buffer, {mode: options.gameboyMode}),
    statusMessage: 'for Game Boy (all four channels; one pass)',
  } : detection.family === 'nes' ? {
    source: exportNesVgm(buffer, {mode: options.nesMode}),
    statusMessage: 'for NES APU' + (detection.fds ? ' + FDS' : '') + ' (including DMC RAM; one pass)',
  } : (detection.rf5c164 && options.includeRf5c164) || detection.family === 'rf5c164' ? {
    source: exportRf5c164Vgm(buffer, {...options, writeDacFile(bytes) {
      let path;
      do { path = `/vgmdat-${crypto.randomUUID()}.dat`; } while (virtualFiles.has(path));
      dacFiles.push({path, bytes}); return path;
    }, writeMemoryFile(bytes) {
      let path;
      do { path = `/rf5c164-${crypto.randomUUID()}.dat`; } while (virtualFiles.has(path));
      dacFiles.push({path, bytes}); return path;
    }}),
    statusMessage: options.mode === 'schedule' ? 'with scheduled FM/DAC/PSG and RF5C164 Write liveLoop' : options.mode === 'high' ? 'with RF5C164 high-level API + raw fallback (liveLoop)' : 'with RF5C164 register/RAM writes (liveLoop)',
  } : resolveVgmImportStrategy(
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

  const presetFiles = detection.family !== 'opn' ? [] : createVgmPresetFiles(buffer, file.name, virtualFiles.list().map(entry => entry.path));
  for (const { path, bytes } of dacFiles) virtualFiles.writeBinary(path, bytes);
  for (const { path, data } of presetFiles) {
    virtualFiles.writeBinary(path, data);
    registerVirtualInstrumentPreset(path);
  }
  saveActiveVirtualFile();
  virtualFiles.writeText(targetPath, (fullYm2203 || fullYm2608) ? strategy.source : addVgmSoundChipSetup(strategy.source, detection, selectedChip));
  currentCassetteMetadata = { version: 1, workType: "TRANSCRIPTION", license: "NONE" };
  activeVirtualPath = targetPath;
  runVirtualPath = targetPath;
  showVirtualFile(virtualFiles.get(targetPath));
  renderVirtualFileExplorer();
  renderRunFileOptions();
  setBottomTab("code");
  setStatus(
    `Imported ${file.name} into ${targetPath} ${strategy.statusMessage}.` +
    (detection.family === 'opn' ? ` Added ${presetFiles.length} TFI preset(s).` : '')
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
              `Failed to import TFI/VGI: ${error.message}`
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
  refreshCodeFileActions();
}

function syncActiveEditorFile() {
  const file = virtualFiles.get(activeVirtualPath);
  if (!activeTfiFilePath && !isSystemVirtualPath(activeVirtualPath) && file?.type === "text" && file.data !== getEditorValue()) saveActiveVirtualFile();
  refreshCodeFileActions();
}

function editableCheckpointPath() {
  const path = activeTfiFilePath ?? activeVirtualPath;
  if (codePanel.hidden || isHiddenVirtualPath(path) || path.split('/').includes('.git')) return null;
  return virtualFiles.get(path)?.type === (activeTfiFilePath ? 'binary' : 'text') ? path : null;
}

function codeCheckpoint(path) {
  const revision = virtualFiles.getRevision(CHECKPOINT_ROOT + path);
  if (codeCheckpointCache?.path !== path || codeCheckpointCache.revision !== revision) {
    codeCheckpointCache = {path, revision, file: virtualFiles.checkpoints.get(path)};
  }
  return codeCheckpointCache.file;
}

function clearCodeSyncFeedback() {
  if (codeSyncFeedbackTimer !== null) window.clearTimeout(codeSyncFeedbackTimer);
  codeSyncFeedbackTimer = null;
  codeSyncFeedback = null;
  if (syncCodeButton) {
    syncCodeButton.textContent = 'Sync';
    delete syncCodeButton.dataset.feedback;
  }
}

function showCodeSyncFeedback(path, sourceRevision) {
  if (!syncCodeButton || editableCheckpointPath() !== path || virtualFiles.getRevision(path) !== sourceRevision) return;
  clearCodeSyncFeedback();
  codeSyncFeedback = {path, sourceRevision, checkpointRevision: virtualFiles.getRevision(CHECKPOINT_ROOT + path)};
  syncCodeButton.textContent = '✓ Synced';
  syncCodeButton.dataset.feedback = 'success';
  if (codeSyncAnnouncement) codeSyncAnnouncement.textContent = `Synced ${path}.`;
  codeSyncFeedbackTimer = window.setTimeout(clearCodeSyncFeedback, 1800);
}

function refreshCodeFileActions() {
  const path = editableCheckpointPath();
  const file = path ? virtualFiles.get(path) : null;
  const saved = path ? codeCheckpoint(path) : null;
  const compatible = Boolean(saved && saved.type === file?.type);
  const modified = compatible && (file.type === 'text'
    ? saved.data !== getEditorValue()
    : virtualFiles.checkpoints.isModified(path));
  if (codeSyncFeedback && (path !== codeSyncFeedback.path || modified ||
      virtualFiles.getRevision(path) !== codeSyncFeedback.sourceRevision ||
      virtualFiles.getRevision(CHECKPOINT_ROOT + path) !== codeSyncFeedback.checkpointRevision)) clearCodeSyncFeedback();
  if (codeFileActions) codeFileActions.hidden = codePanel.hidden;
  if (syncCodeButton) syncCodeButton.disabled = !path;
  if (revertCodeButton) {
    revertCodeButton.disabled = !path || !modified;
    revertCodeButton.title = !path ? 'Open a file to revert' : !saved ? 'Sync this file first' :
      !compatible ? 'The synced copy has a different file type' :
      !modified ? 'No changes since the last sync' : 'Restore the last synced version of this file';
  }
}

async function syncActiveCodeFile() {
  clearCodeSyncFeedback();
  const path = editableCheckpointPath();
  if (!path) {
    setStatus('Open a file to sync.');
    return;
  }
  try {
    syncActiveEditorFile();
    const sourceRevision = virtualFiles.getRevision(path);
    const result = await virtualFiles.sync(path);
    setStatus(`Synced ${path} to ${result.destinationPath}.`);
    showCodeSyncFeedback(path, sourceRevision);
  } catch (error) {
    setStatus(`Could not sync ${path}: ${error.message ?? error}`);
  } finally {
    refreshCodeFileActions();
  }
}

function revertActiveCodeFile() {
  const path = editableCheckpointPath();
  if (!path) return;
  try {
    const saved = virtualFiles.checkpoints.get(path);
    if (!saved) throw Error('No synced copy is available for this file.');
    if (saved.type !== virtualFiles.get(path)?.type) throw Error('The synced copy has a different file type.');
    if (saved.type === 'binary') {
      // Validate before changing the working file. Reload both the controls and
      // their existing audition synth, while keeping the checkpoint intact.
      instrumentToEditorPreset(path, saved.data);
      const restored = virtualFiles.checkpoints.revert(path);
      registerVirtualInstrumentPreset(path);
      tfiFileEditor.open(path, restored.data);
    } else {
      // Apply an editor edit first so Monaco retains Undo. Its content listener
      // writes back to the VFS; explicitly flush as well for the textarea fallback.
      if (editorAdapter.replaceAll) editorAdapter.replaceAll(saved.data);
      else editorAdapter.setValue(saved.data);
      syncActiveEditorFile();
      editorAdapter.focus();
    }
    setStatus(`Reverted ${path} to the last synced version.`);
  } catch (error) {
    setStatus(`Could not revert ${path}: ${error.message ?? error}`);
  } finally {
    refreshCodeFileActions();
  }
}

function saveActiveVirtualFile() {
  if (activeTfiFilePath) return;
  const file=virtualFiles.get(activeVirtualPath);
  if(file?.type!=='text'||isSystemVirtualPath(activeVirtualPath)||activeVirtualPath==='/.git'||activeVirtualPath.startsWith('/.git/'))return;
  virtualFiles.writeText(
    activeVirtualPath,
    getEditorValue()
  );
}

function showVirtualFile(file) {
  activeTfiFilePath = null;
  tfiFileEditor.setVisible(false);
  codePanel.dataset.fileKind = "text";
  editorAdapter.openVirtualFile?.(
    file.path,
    file.data
  );
  editorAdapter.setReadOnly?.(false);
  editorAdapter.setValue(file.data);
  refreshCodeFileActions();
}

function renderRunFileOptions() {
  const previousPath = runVirtualPath;
  runFileSelect.replaceChildren();
  const projectFiles = virtualFiles.list()
    .filter(
      (file) =>
        file.type === "text" &&
        file.path.endsWith(".js") &&
        !isHiddenVirtualPath(file.path)
    )
    .sort(projectFileOrder);
  const groups = new Map();
  for (const file of projectFiles) {
    const folder = file.path.slice(0, file.path.lastIndexOf("/")) || "/";
    if (!groups.has(folder)) {
      const group = document.createElement("optgroup");
      group.label = folder;
      groups.set(folder, group);
      runFileSelect.appendChild(group);
    }
    const option = document.createElement("option");
    option.value = file.path;
    option.textContent = file.path.slice(file.path.lastIndexOf("/") + 1);
    groups.get(folder).appendChild(option);
  }

  runVirtualPath = virtualFiles.has(previousPath) && !isHiddenVirtualPath(previousPath)
    ? previousPath
    : "/index.js";
  runFileSelect.value = runVirtualPath;
}

const expandedFileFolders = new Map();

function renderVirtualFileExplorer() {
  const selectedPath = activeTfiFilePath ?? activeVirtualPath;
  renderFileTree(fileExplorerList,
    [...virtualFiles.list(), ...virtualFiles.listDirectories().filter(path => path !== '/').map(path => ({path,type:'directory'}))].filter(file => !isHiddenVirtualPath(file.path)), {
      selectedPath,
      expanded: expandedFileFolders,
      onOpen: openVirtualFile,
      onTransfer: transferExplorerFiles,
      onImport: (files, directory) => {
        void importDroppedFiles(files, directory).catch((error) => setStatus(`Failed to import dropped files: ${error.message}`));
      },
    });
  renameFileButton.disabled = Boolean(activeTfiFilePath);
  deleteFileButton.disabled = Boolean(activeTfiFilePath);

}

function openVirtualFile(path) {
  if (isCheckpointVirtualPath(path)) {
    setStatus('/.tet.ss is reserved for file checkpoints.');
    return;
  }
  const file = virtualFiles.get(path);
  if (!file) {
    return;
  }
  if (file.type === "binary" && /\.(?:tfi|vgi)$/i.test(path)) {
    try {
      saveActiveVirtualFile();
      tfiFileEditor.open(path, file.data);
      activeTfiFilePath = path;
      codePanel.dataset.fileKind = "tfi";
      refreshCodeFileActions();
      setBottomTab("code");
      renderVirtualFileExplorer();
    } catch (error) { setStatus(`Could not open ${path}: ${error.message}`); }
    return;
  }
  if (file.type !== "text") {
    setStatus(`${path} is a binary file and cannot be edited here.`);
    return;
  }

  saveActiveVirtualFile();
  activeVirtualPath = file.path;
  if (file.path.endsWith(".js")) {
    runVirtualPath = file.path;
    renderRunFileOptions();
  }
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
    if (isCheckpointVirtualPath(normalizedPath)) throw new Error('/.tet.ss is reserved for file checkpoints.');
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
    /\.(?:tfi|vgi)$/i.test(file.name) ? `/presets/${file.name}` : `/${file.name}`
  );
  if (!path) {
    return;
  }
  const normalizedPath = normalizeVirtualPath(path);
  if (isSystemVirtualPath(normalizedPath)) {
    setStatus("/sys is reserved for built-in files.");
    return;
  }
  if (isCheckpointVirtualPath(normalizedPath)) {
    setStatus('/.tet.ss is reserved for file checkpoints.');
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
  registerVirtualInstrumentPreset(normalizedPath);
  renderVirtualFileExplorer();
  renderRunFileOptions();
  setStatus(`Imported binary file: ${normalizedPath}`);
}

async function importDroppedFiles(files, directory = "") {
  const destination = directory && directory !== "/" ? normalizeVirtualPath(directory) : "";
  const pending = new Map();
  for (const file of files) {
    const isZip = file.name.toLowerCase().endsWith(".zip");
    const entries = isZip
      ? unzipSync(new Uint8Array(await file.arrayBuffer()))
      : { [file.name]: new Uint8Array(await file.arrayBuffer()) };
    for (const [name, bytes] of Object.entries(entries)) {
      if (!name || name.endsWith("/") || name === "metadata.json" || name === "cassette.metadata.js") continue;
      if (name.startsWith("/") || name.split("/").includes("..")) throw new Error(`Invalid import path: ${name}`);
      const path = normalizeVirtualPath(`${destination}/${name}`);
      if (path === "/sys" || isSystemVirtualPath(path)) throw new Error("/sys is reserved for built-in files.");
      if (isCheckpointVirtualPath(path)) throw new Error('/.tet.ss is reserved for file checkpoints.');
      if (pending.has(path)) throw new Error(`Duplicate import path: ${path}`);
      pending.set(path, bytes);
    }
  }
  if (!pending.size) throw new Error("The dropped files contain no importable files.");
  const paths = new Set([...virtualFiles.list().map(file => file.path), ...pending.keys()]);
  for (const path of pending.keys()) {
    if ([...paths].some(other => other !== path && (other.startsWith(`${path}/`) || path.startsWith(`${other}/`)))) {
      throw new Error(`Import path conflicts with a file or folder: ${path}`);
    }
  }
  const replacements = [...pending.keys()].filter(path => virtualFiles.has(path));
  if (replacements.length && !window.confirm(`Replace ${replacements.length} existing file(s)?\n${replacements.join("\n")}`)) return;
  for (const [path, bytes] of pending) {
    virtualFiles.writeBinary(path, bytes);
    registerVirtualInstrumentPreset(path);
  }
  if (destination) expandedFileFolders.set(destination, true);
  renderVirtualFileExplorer();
  renderRunFileOptions();
  setStatus(`Imported ${pending.size} file${pending.size === 1 ? "" : "s"} into ${destination || "/"}.`);
}

function installFileExplorerDropTarget() {
  if (!fileExplorer) return;
  fileExplorer.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  fileExplorer.addEventListener("drop", (event) => {
    if (event.defaultPrevented) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    void importDroppedFiles(files).catch((error) => setStatus(`Failed to import dropped files: ${error.message}`));
  });
}

function registerVirtualInstrumentPreset(path) {
  if (!path.startsWith("/presets/") || !/\.(?:tfi|vgi)$/i.test(path)) {
    return;
  }
  const virtualFile = virtualFiles.get(path);
  if (!virtualFile || virtualFile.type !== "binary") {
    return;
  }

  const presetId = `vfs:${path}`;
  const preset = instrumentToEditorPreset(path, virtualFile.data);
  virtualPresetIds.set(path, presetId);
  playgroundPresets[presetId] = preset;
  runtime.presets[presetId] = preset;
  operatorTab.registerPresetOption(
    presetId,
    path.slice("/presets/".length)
  );
}

function registerVirtualInstrumentPresets() {
  for (const file of virtualFiles.list()) {
    registerVirtualInstrumentPreset(file.path);
  }
}

function clearVirtualInstrumentPresets() {
  for (const presetId of virtualPresetIds.values()) {
    delete playgroundPresets[presetId];
    delete runtime.presets[presetId];
    operatorTab.removePresetOption(presetId);
  }
  virtualPresetIds.clear();
}

function transferExplorerFiles(source, destination, copy = false) {
  try {
    if (normalizeVirtualPath(source) === normalizeVirtualPath(destination)) return false;
    saveActiveVirtualFile();
    const moved = transferVirtualFiles(virtualFiles, source, destination, { copy });
    if (!copy) {
      const active = moved.find(entry => entry.from === activeVirtualPath);
      const running = moved.find(entry => entry.from === runVirtualPath);
      const tone = moved.find(entry => entry.from === activeTfiFilePath);
      if (active) activeVirtualPath = active.to;
      if (running) runVirtualPath = running.to;
      if (tone) {
        activeTfiFilePath = tone.to;
        tfiFileEditor.open(tone.to, virtualFiles.get(tone.to).data);
      } else if (active) showVirtualFile(virtualFiles.get(activeVirtualPath));
    }
    editorAdapter.syncVirtualFiles?.(virtualFiles.list().filter(file => !isCheckpointVirtualPath(file.path)));
    clearVirtualInstrumentPresets();
    registerVirtualInstrumentPresets();
    expandedFileFolders.set(normalizeVirtualPath(destination).split('/').slice(0, -1).join('/'), true);
    renderVirtualFileExplorer();
    renderRunFileOptions();
    setStatus(`${copy ? "Copied" : "Moved"} ${source} to ${destination}.`);
    return true;
  } catch (error) {
    setStatus(`Could not ${copy ? "copy" : "move"}: ${error.message}`);
    return false;
  }
}

function refreshExplorerFiles(directory = '/') {
  editorAdapter.syncVirtualFiles?.(virtualFiles.list().filter(file => !isCheckpointVirtualPath(file.path)));
  clearVirtualInstrumentPresets();
  registerVirtualInstrumentPresets();
  expandedFileFolders.set(directory, true);
  renderVirtualFileExplorer();
  renderRunFileOptions();
}

function deleteExplorerPath(path) {
  if (path === '/' || path === '/index.js' || path === '/sys' || isHiddenVirtualPath(path)) {
    setStatus('This project path cannot be deleted.');
    return;
  }
  const contains = value => value === path || value?.startsWith(`${path}/`);
  const directory = virtualFiles.stat(path).type === 'directory';
  if (!window.confirm(`Delete ${path}${directory ? ' and all its contents' : ''}?`)) return;
  saveActiveVirtualFile();
  virtualFiles.remove(path, {recursive: true});
  if (contains(runVirtualPath)) runVirtualPath = '/index.js';
  if (contains(activeVirtualPath) || contains(activeTfiFilePath)) {
    activeVirtualPath = '/index.js';
    showVirtualFile(virtualFiles.get(activeVirtualPath));
  }
  refreshExplorerFiles();
  setStatus(`Deleted ${path}.`);
}

function promptExplorerTransfer(copy) {
  const source = activeTfiFilePath ?? activeVirtualPath;
  const suggested = copy ? source.replace(/(\.[^/.]+)?$/, '-copy$1') : source;
  const destination = window.prompt(`${copy ? "Copy" : "Move"} file to path`, suggested);
  if (destination) transferExplorerFiles(source, destination, copy);
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
    if (isCheckpointVirtualPath(normalizedPath)) throw new Error('/.tet.ss is reserved for file checkpoints.');
    if (virtualFiles.has(normalizedPath)) {
      throw new Error("A file already exists at that path.");
    }
    saveActiveVirtualFile();
    transferVirtualFiles(virtualFiles, activeVirtualPath, normalizedPath);
    const previousPath = activeVirtualPath;
    activeVirtualPath = normalizedPath;
    if (runVirtualPath === previousPath) {
      runVirtualPath = normalizedPath;
    }
    showVirtualFile(virtualFiles.get(normalizedPath));
    editorAdapter.syncVirtualFiles?.(virtualFiles.list().filter(file => !isCheckpointVirtualPath(file.path)));
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

const fxMonitor = createFXMonitor(() => runtime.megaDrive?.audio?.nativeFX);
const inlineAudioMonitor = !workbench && new URLSearchParams(window.location.search).get("monitor") === "1";
const audioMonitorPanel = document.getElementById("audioMonitorPanel");
if (inlineAudioMonitor) {
  document.body.classList.add("has-inline-audio-monitor");
  codePanel.appendChild(audioMonitorPanel);
  audioMonitorPanel.setAttribute("role", "region");
  audioMonitorPanel.removeAttribute("aria-labelledby");
  audioMonitorPanel.setAttribute("aria-label", "Audio monitor");
  document.getElementById("audioMonitorTab").hidden = true;
}
const audioMonitor = createAudioMonitor(() => activeTfiFilePath && !codePanel.hidden
  ? tfiFileEditor.getAudioRuntime()
  : runtime.megaDrive?.audio, {
  getSourceLabel: () => activeTfiFilePath && !codePanel.hidden ? 'File preview' : '',
  panel: audioMonitorPanel,
  envelopeCanvas: document.getElementById("audioMonitorEnvelope"),
  waveCanvas: document.getElementById("audioMonitorWave"),
  spectrumCanvas: document.getElementById("audioMonitorSpectrum"),
  modeSelect: document.getElementById("audioMonitorMode"),
  scaleSelect: document.getElementById("audioMonitorScale"),
  scaleControl: document.getElementById("audioMonitorScaleControl"),
  modePanels: {
    envelope: document.getElementById("audioMonitorEnvelopeView"),
    waveform: document.getElementById("audioMonitorWaveView"),
    spectrum: document.getElementById("audioMonitorSpectrumView"),
  },
  description: document.getElementById("audioMonitorDescription"),
  channel: document.getElementById("audioMonitorChannel"),
  status: document.getElementById("audioMonitorStatus"),
  pauseButton: document.getElementById("audioMonitorPause"),
});

const ui =
  createPlaygroundUi({
    dockedPanels: Boolean(workbench),
    initialBottomTab: workbench?.initialBottomTab,
    initialDockOpen: workbench?.initialDockOpen,
    status,
    runtimeState,
    consoleOutput,
    codeTab,
    fxMonitorTab: document.getElementById("fxMonitorTab"),
    fxMonitorPanel: document.getElementById("fxMonitorPanel"),
    audioMonitorTab: inlineAudioMonitor ? null : document.getElementById("audioMonitorTab"),
    audioMonitorPanel: inlineAudioMonitor ? null : audioMonitorPanel,
    consoleTab,
    shellTab: document.getElementById("shellTab"),
    shellPanel: document.getElementById("shellPanel"),
    helpersTab,
    operatorTabButton,
    keyboardTab,
    consolePanel,
    codePanel,
    helpersPanel,
    operatorPanel,
    keyboardPanel,
    onBottomTabChange(tabName, layout) {
      if (layout) workbench.sync(layout);
      const tool = layout ? (layout.dockOpen ? layout.bottomTab : null) : tabName;
      document.getElementById('shellActions').hidden = tool !== 'shell';
      if (tool !== 'shell') {
        for (const id of ['shellMenu', 'shellHelp']) document.getElementById(id).hidePopover?.();
      }
      const primary = layout?.primaryTab ?? tabName;
      fxMonitor.setVisible(tool === "fxMonitor");
      const showAudio = tool === "audio" || (inlineAudioMonitor && primary === "code");
      if (inlineAudioMonitor) audioMonitorPanel.hidden = !showAudio;
      audioMonitor.setVisible(showAudio);
      operatorTab.setVisible(primary === "operator");
      operatorKeyboard.setView(tool === "keyboard" ? "keyboard" : primary);
      tfiFileEditor.setVisible(primary === "code" && Boolean(activeTfiFilePath));
      refreshCodeFileActions();
    },
  });
workbench?.onVisibilityChange(value => ui.setDockVisible(value));
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
    midiFileSupported: !useNukedEngine,
    workerLookaheadSeconds: readWorkerLookahead() / 1000,
    megaDrive,
    onAuditionReset: () => operatorKeyboard.releaseAll(),
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
      operatorKeyboard.attachSynth(runtime.getAuditionSynth());
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
const pageLifecycle = installPlaygroundPageLifecycle({
  target: window,
  getRuntime: () => runtime,
  onRestored() {
    synth = null;
    operatorKeyboard.attachSynth(null);
    runButton.disabled = false;
    syncWorkerExecutionLock();
    setStatus("Playback stopped after navigation. Press Run to start again.");
    setRuntimeState("Audio idle");
  },
  onError(error) { console.error(error); setStatus("Audio cleanup failed: " + error.message); },
});

function syncWorkerExecutionLock() {
  const running = runtime.getState().playback === "running";
  if (workerLookaheadInput) workerLookaheadInput.disabled = running;
  if (applyWorkerLookaheadButton) applyWorkerLookaheadButton.disabled = running;
  if (workerLookaheadPlaybackHint) workerLookaheadPlaybackHint.hidden = !running;
  updateWorkerLookaheadSummary();
  if (workerExecution) {
    workerExecution.disabled =
      runtime.getState().playback === "running";
  }
}

function updateWorkerLookaheadSummary() {
  if (workerLookaheadValue) workerLookaheadValue.textContent = `${runtime.getTiming().workerLookaheadSeconds * 1000} ms`;
}
updateWorkerLookaheadSummary();
workerLookaheadButton?.addEventListener("click", () => {
  mainMenu.open = false;
  workerLookaheadInput.value = String(runtime.getTiming().workerLookaheadSeconds * 1000);
  workerLookaheadInput.setCustomValidity("");
  syncWorkerExecutionLock();
  document.activeElement?.blur?.();
  workerLookaheadDialog.showModal();
  if (!workerLookaheadInput.disabled) { workerLookaheadInput.focus(); workerLookaheadInput.select(); }
});
workerLookaheadInput?.addEventListener("input", () => workerLookaheadInput.setCustomValidity(""));
document.getElementById("cancelWorkerLookaheadButton")?.addEventListener("click", () => workerLookaheadDialog.close());
workerLookaheadDialog?.addEventListener("close", () => {
  workerLookaheadInput.value = String(runtime.getTiming().workerLookaheadSeconds * 1000);
  mainMenu.querySelector(":scope > summary")?.focus({preventScroll: true});
});
workerLookaheadForm?.addEventListener("submit", event => {
  event.preventDefault();
  if (runtime.getState().playback === "running") { syncWorkerExecutionLock(); return; }
  const ms = workerLookaheadInput.valueAsNumber;
  if (!Number.isFinite(ms) || ms < 0 || ms > 2000 || !Number.isInteger(ms)) {
    workerLookaheadInput.setCustomValidity("Enter a whole number from 0 to 2000 ms.");
    workerLookaheadInput.reportValidity();
    return;
  }
  runtime.setTiming({workerLookaheadSeconds: ms / 1000});
  try { localStorage.setItem(workerLookaheadStorageKey, String(ms)); } catch { /* Storage unavailable. */ }
  updateWorkerLookaheadSummary();
  setStatus(`Worker lookahead: ${ms} ms.`);
  workerLookaheadDialog.close("apply");
});

updateMasterVolumeUi();
masterVolumeRange?.addEventListener(
  "input",
  () => {
    listeningVolume = Number(masterVolumeRange.value) / 100;
    applyMasterVolume();
    tfiFileEditor.setMasterVolume(listeningVolume);
    updateMasterVolumeUi();
  }
);

async function runCode({propagateError = false} = {}) {
  runButton.disabled = true;
  if (workerExecution) workerExecution.disabled = true;
  clearConsole();

  try {
    await pageLifecycle.beforeRun();
    if (pendingDesktopCassetteAssets) {
      await registerCassetteAssets(pendingDesktopCassetteAssets);
      pendingDesktopCassetteAssets = null;
    }
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
    if(propagateError)throw error;
  } finally {
    runButton.disabled = false;
    syncWorkerExecutionLock();
  }
}

async function stopRun() {
  runButton.disabled = true;
  stopButton.disabled = true;
  try { await runtime.stopWithFade(); }
  finally { runButton.disabled = false; stopButton.disabled = false; syncWorkerExecutionLock(); }
}

function parseCassetteAssets(cassette) {
  return {
    cassette,
    timbres: cassette.timbres.map((timbre) => ({
      ...timbre,
      preset: instrumentToEditorPreset(timbre.path, timbre.bytes),
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
      cassetteSampleNames.add(sampleEntry.name);
    }
  }

  for (const timbre of assets.timbres) {
    cassettePresetNames.add(timbre.name);
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
  const license = assets.cassette.metadata?.license ?? "NONE";
  const workType = assets.cassette.metadata?.workType ?? "NONE";
  statusParts.push(`${workType} / license ${typeof license === "object" ? license.type : license}`);
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
  playgroundShell?.invalidate('Project changed');
  fileExplorerMenu?.clear();
  const textExtensions = /\.(?:js|json|md|txt)$/i;
  const previousSource = getEditorValue();
  clearVirtualInstrumentPresets();
  virtualFiles.replace(
    Array.from(cassette.files, ([path, bytes]) => ({
      path: `/${path}`,
      data: !path.startsWith('.git/') && textExtensions.test(path)
        ? new TextDecoder().decode(bytes)
        : bytes,
    })),
    cassette.directories ?? []
  );

  if (!virtualFiles.has("/index.js")) {
    virtualFiles.writeText("/index.js", previousSource);
  }
  restoreBundledExampleFiles();
  editorAdapter.syncVirtualFiles?.(virtualFiles.list().filter(file => !isCheckpointVirtualPath(file.path)));
  registerVirtualInstrumentPresets();
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
  pendingDesktopCassetteAssets = null;
  currentCassetteHasMetadataFile =
    cassette.files.has("metadata.json") ||
    cassette.files.has("cassette.metadata.js");
  currentCassetteMetadata = currentCassetteHasMetadataFile ? cassette.metadata : null;
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
      { "index.js": DEFAULT_CODE },
      "index.js"
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
  if (urlVgiResult.loadedIds.length > 0) {
    statusParts.push(
      `Loaded ${urlVgiResult.loadedIds.length} URL VGI preset(s): ${urlVgiResult.loadedIds.join(", ")}.`
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
  for (const errorMessage of urlVgiResult.errors) {
    console.warn(errorMessage);
    if (statusParts.length === 0) statusParts.push("Some URL VGI presets were ignored.");
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

function installPlaygroundEventHandlers() {
  mainMenu.addEventListener("click", event => {
    if (event.target.closest("button, a")) mainMenu.open = false;
  });
  mainMenu.addEventListener("toggle", () => {
    if (!mainMenu.open) for (const submenu of mainMenu.querySelectorAll("details[open]")) submenu.open = false;
  });
  document.addEventListener("pointerdown", event => {
    if (mainMenu.open && !mainMenu.contains(event.target)) mainMenu.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && mainMenu.open && !document.querySelector("dialog[open]")) {
      mainMenu.open = false;
      mainMenu.querySelector(":scope > summary")?.focus({preventScroll: true});
    }
  });
  const newCassetteDialog = document.getElementById('newCassetteDialog');
  document.body.append(newCassetteDialog);
  document.getElementById('newCassetteButton').addEventListener('click', () => {
    mainMenu.open = false;
    newCassetteDialog.returnValue = '';
    newCassetteDialog.showModal();
  });
  newCassetteDialog.addEventListener('close', async () => {
    if (newCassetteDialog.returnValue !== 'new') return;
    playgroundShell?.invalidate('New Cassette');
    await stopRun();
    pendingDesktopCassetteAssets = null;
    for (const name of cassettePresetNames) {
      delete playgroundPresets[name]; delete runtime.presets[name]; operatorTab.removePresetOption(name);
    }
    cassettePresetNames.clear(); cassetteExamples.clear();
    for (const name of cassetteSampleNames) runtime.sample.unload(name);
    cassetteSampleNames.clear();
    currentCassetteMetadata = null; currentCassetteHasMetadataFile = false;
    restoreVirtualFilesFromCassette({files:new Map(initialProjectFiles.map(file => [
      file.path.replace(/^\//, ''),
      typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data,
    ]))});
    setBottomTab('code');
    desktopAutosave?.changed();
    setStatus('New cassette.');
  });
  document.body.append(vgmImportDialog);
  importVgmButton.addEventListener("click", promptVgmImport);
  vgmImportDialog.addEventListener("close", () => {
    pendingVgmImport = null;
    pendingVgmImportFile = null;
    runButton.focus();
  });
  exportCassetteButton?.addEventListener("click", () => {
    const hasMetadata = currentCassetteHasMetadataFile ||
      Boolean(virtualFiles.get("/metadata.json")) ||
      Boolean(virtualFiles.get("/cassette.metadata.js"));
    if (hasMetadata) {
      exportCassette();
    } else {
      promptCassetteExport();
    }
  });
  const exportCurrentPresets = (format) => {
    const files = {};
    for (let channel = 0; channel < 6; channel += 1) {
      const preset = operatorTab.getChannelPreset?.(channel);
      if (!preset) continue;
      const bytes = format === "vgi"
        ? createVgiFromPreset(preset)
        : createTfiFromPreset(preset);
      files[`ch${channel + 1}.${format}`] = bytes;
    }
    if (Object.keys(files).length === 0) {
      setStatus("No operator states are available to export.");
      return;
    }
    const extension = format === "vgi" ? "vgi" : "tfi";
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([zipSync(files)], { type: "application/zip" }));
    anchor.download = `playground_${extension}_presets.zip`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    setStatus(`Exported CH1-CH6 ${extension.toUpperCase()} presets as ZIP.`);
  };
  exportTfiButton?.addEventListener("click", () => exportCurrentPresets("tfi"));
  exportVgiButton?.addEventListener("click", () => exportCurrentPresets("vgi"));
  cassetteLicenseSelect?.addEventListener("change", () => {
    cassetteLicenseCustomName.disabled = cassetteLicenseSelect.value !== "CUSTOM";
  });
  confirmCassetteExportButton?.addEventListener("click", (event) => {
    event.preventDefault();
    cassetteExportDialog.close();
    exportCassette();
  });
  newFileButton?.addEventListener("click", createVirtualFile);
  importFileButton?.addEventListener("click", promptVirtualFileImport);
  document.getElementById("copyFileButton")?.addEventListener("click", () => promptExplorerTransfer(true));
  renameFileButton?.addEventListener("click", renameActiveVirtualFile);
  deleteFileButton?.addEventListener("click", deleteActiveVirtualFile);
  syncCodeButton?.addEventListener('click', () => {void syncActiveCodeFile();});
  revertCodeButton?.addEventListener('click', revertActiveCodeFile);
  // Capture before Monaco handles the key, and cancel the browser's Save Page
  // command synchronously. One handler also covers the textarea fallback.
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing ||
        (event.code !== 'KeyS' && event.key?.toLowerCase() !== 's') ||
        codePanel.hidden || document.querySelector('dialog[open]')) return;
    const field = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
    if (field && !codePanel.contains(field)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) void syncActiveCodeFile();
  }, true);

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
      if (!file || !pendingVgmImport?.detection.supported) return;
      let targetPath;
      try {
        targetPath = normalizeVirtualPath(vgmImportTarget.value.trim());
        if (!targetPath.endsWith(".js")) throw new Error("Use a .js file path.");
        if (isSystemVirtualPath(targetPath)) throw new Error("/sys is reserved for built-in files.");
        if (isCheckpointVirtualPath(targetPath)) throw new Error('/.tet.ss is reserved for file checkpoints.');
        if (virtualFiles.get(targetPath)?.type === "binary") throw new Error("Choose a text file or a new path.");
        vgmImportTarget.setCustomValidity("");
      } catch (error) {
        vgmImportTarget.setCustomValidity(error.message);
        vgmImportTarget.reportValidity();
        return;
      }
      const options = {
          prepared: pendingVgmImport,
          ym2608Mode: document.querySelector('input[name="ym2608ImportMode"]:checked')?.value ?? 'write',
          ym2608Target: document.getElementById('ym2608TargetOptions').hidden ? undefined : document.getElementById('ym2608TargetInput').value,
          ym2203Target: document.getElementById('ym2203TargetOptions').hidden ? undefined : document.getElementById('ym2203TargetInput').value,
          ym2203Mode: document.querySelector('input[name="ym2203ImportMode"]:checked')?.value ?? 'write',
          nesMode: document.querySelector('input[name="nesImportMode"]:checked')?.value ?? 'raw',
          gameboyMode: document.querySelector('input[name="gameboyImportMode"]:checked')?.value ?? 'raw',
          targetPath,
          noteish: selectedMode?.value === "high" && document.getElementById("noteishVgmInput").checked,
          splitChannels: document.getElementById("splitVgmChannelsInput").checked,
          mode: selectedMode?.value ?? "write",
          includeDac: includeDacInput?.checked ?? true,
          includePsg: document.getElementById("includePsgInput").checked,
          includeRf5c164: !!pendingVgmImport.detection.rf5c164 && document.getElementById("includeRf5c164Input").checked,
          dacBase64: dacBase64Input?.checked ?? true,
      };
      vgmImportDialog.close();
      pendingVgmImportFile = null;
      void importVgmFile(file, options).catch((error) => {
        setStatus(`Failed to import VGM/S98: ${error.message}`);
      });
    }
  );

  function syncYm2203Target() {
    let native = false;
    for (const chip of ['ym2203', 'ym2608']) {
      const available = selectedChip === 'ym2612' && pendingVgmImport?.detection.supported && pendingVgmImport.detection.chip === chip && pendingVgmImport.detection.chips.length === 1;
      const field = document.getElementById(chip + 'TargetOptions');
      field.hidden = !available; field.disabled = !available;
      const selected = available && document.getElementById(chip + 'TargetInput').value === chip;
      document.getElementById(chip + 'TimingOptions').hidden = !selected;
      native ||= selected;
      if (available) document.getElementById('vgmImportNotice').textContent = selected
        ? (chip === 'ym2608' ? 'YM2608 FM + SSG + rhythm + ADPCM-B. Write / Schedule / High; bundled rhythm ROM; one shared chip loop.' : 'YM2203 FM + SSG with the source clock. Write / Schedule / High; one shared chip loop.')
        : pendingVgmImport.detection.message;
    }
    const opn = document.getElementById('opnImportOptions');
    opn.hidden = native || !pendingVgmImport?.detection.supported || !['opn', 'rf5c164'].includes(pendingVgmImport?.detection.family);
    opn.disabled = opn.hidden;
  }
  document.getElementById('ym2203TargetInput').addEventListener('change', syncYm2203Target);
  document.getElementById('ym2608TargetInput').addEventListener('change', syncYm2203Target);
  function syncDacBase64Option() {
    document.querySelectorAll('input[name="vgmImportMode"]').forEach(input => {
      input.disabled = false;
    });
    document.getElementById('splitVgmChannelsInput').disabled = false;

    const selectedMode = document.querySelector(
      'input[name="vgmImportMode"]:checked'
    );
    const mode = selectedMode?.value ?? "write";
    document.getElementById("noteishVgmInput").disabled = mode !== "high";
    if (dacBase64Input) {
      dacBase64Input.disabled = false;
    }
    if (dacBase64Label) {
      dacBase64Label.hidden = false;
      dacBase64Label.title = mode === "schedule"
        ? "Preload DAC from a virtual .dat file without scheduling every DAC write."
        : "Store DAC data in a virtual .dat file loaded with file().";
    }
  }

  document.querySelectorAll('input[name="vgmImportMode"]').forEach(
    (input) => input.addEventListener("change", syncDacBase64Option)
  );
  document.getElementById('includeRf5c164Input').addEventListener('change', syncDacBase64Option);
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
            `Failed to import TFI/VGI: ${error.message}`
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

  vgmImportInput.addEventListener('change', async () => {
    const file = vgmImportInput.files?.[0];
    if (!file) return;
    const request = ++vgmImportRequest;
    pendingVgmImportFile = null;
    pendingVgmImport = null;
    setStatus(`Analyzing ${file.name}…`);
    try {
      const prepared = await prepareVgmImport(file);
      if (request !== vgmImportRequest) return;
      pendingVgmImportFile = file;
      pendingVgmImport = prepared;
      const {detection} = prepared;
      vgmImportFilename.textContent = file.name;
      document.getElementById('vgmImportDetected').textContent = `Detected: ${detection.chips.map(chip => chip === 'gameBoyDmg' ? 'Game Boy DMG' : chip === 'nesApu' ? 'NES APU' + (detection.fds ? ' + FDS' : '') : chip.toUpperCase()).join(' + ') || 'unknown'}`;
      document.getElementById('vgmImportNotice').textContent = detection.message;
      const opnOptions = document.getElementById('opnImportOptions');
      const gbOptions = document.getElementById('gameboyImportOptions');
      const nesOptions = document.getElementById('nesImportOptions');
      nesOptions.hidden = detection.family !== 'nes' || !detection.supported;
      nesOptions.disabled = nesOptions.hidden;
      opnOptions.hidden = !['opn','rf5c164'].includes(detection.family) || !detection.supported;
      gbOptions.hidden = detection.family !== 'gameboy' || !detection.supported;
      opnOptions.disabled = opnOptions.hidden;
      gbOptions.disabled = gbOptions.hidden;
      convertVgmButton.disabled = !detection.supported;
      const rfInput = document.getElementById('includeRf5c164Input');
      rfInput.checked = !!detection.rf5c164;
      rfInput.disabled = !detection.rf5c164 || detection.family === 'rf5c164';
      document.getElementById('includePsgInput').disabled = detection.chip !== 'ym2612' || !detection.chips.includes('psg');
      const outputName = file.name.replace(/\.(?:vgm|vgz|s98)$/i, '').replace(/[\\/]/g, '_') || 'imported';
      vgmImportTarget.value = `/${outputName}.js`;
      vgmImportTarget.setCustomValidity('');
      mainMenu.open = false;
      document.getElementById('noteishVgmInput').checked = false;
      document.getElementById('ym2203TargetInput').value = 'ym2203';
      document.getElementById('ym2608TargetInput').value = 'ym2608';
      syncDacBase64Option();
      syncYm2203Target();
      vgmImportDialog.showModal();
      setStatus(detection.supported ? 'Choose conversion options, then Convert.' : detection.message);
    } catch (error) {
      if (request === vgmImportRequest) setStatus(`Failed to analyze VGM/S98: ${error.message}`);
    }
  });
}

function bootPlayground() {
  if (!restoredDesktopProject) applyInitialSourceFromQuery();
  void applyCassetteFromQuery();
  applySimpleModeFromQuery();
  applyPlaygroundLayout({body: document.body, mainMenu, toolbar, statusBar,
    simpleMode: playgroundSearch.get("mode") === "simple"});
  clearConsole();
  setBottomTab("code");
  setRuntimeState("Audio idle");
  renderVirtualFileExplorer();
  renderRunFileOptions();
  installPlaygroundEventHandlers();
  virtualFiles.onDidChange(refreshCodeFileActions);
  refreshCodeFileActions();
  fileExplorerList.setAttribute('aria-busy', 'false');
  editor.readOnly = false;
  window.__playgroundStartup?.stage('Project ready. Loading the code editor…');
  editor.addEventListener('input', syncActiveEditorFile);
  ui.installBottomTabHandlers();
installTfiEditorDropTarget();
installFileExplorerDropTarget();
  fileExplorerMenu = installFileExplorerMenu({
    root: fileExplorerList,
    fs: virtualFiles,
    sync: saveActiveVirtualFile,
    transfer: transferExplorerFiles,
    onChanged: refreshExplorerFiles,
    onCreated: openVirtualFile,
    onDelete: deleteExplorerPath,
    status: setStatus,
  });
  void initializePlaygroundMonaco({
    chip: selectedChip,
    editor,
    editorHost,
    getEditorValue,
    getActiveVirtualPath: () => activeVirtualPath,
    listVirtualFiles() {
      return virtualFiles.list().filter(file => !isCheckpointVirtualPath(file.path));
    },
    openVirtualFile,
    setEditorNote,
    setEditorAdapter: (nextAdapter) => {
      editorAdapter = nextAdapter;
      refreshCodeFileActions();
    },
    onMonacoEditorReady({
      monacoEditor,
    }) {
      monacoEditor.onDidChangeModelContent(() => {
        if (monacoEditor.getModel()?.uri.path === '/project' + activeVirtualPath) syncActiveEditorFile();
      });
      monacoEditor.onDidChangeModel(() => desktopAutosave?.changed());
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
  }).then(() => window.__playgroundStartup?.ready(), error => window.__playgroundStartup?.fail(error));
}

async function initializeDesktopAutosave() {
  if (!window.__TAURI_INTERNALS__) return;
  const label = document.getElementById('autosaveStatus');
  label.hidden = false;
  const status = text => {label.textContent = text;};
  status('Restoring autosave…');
  try {
    const store = await openDraftStore(window.indexedDB, selectedChip + (useNukedEngine ? ':nuked' : ''));
    const snapshot = await store.load();
    // Explicit shared URLs take precedence over a previous local draft.
    const explicitSource = ['cassette', 'code', 'src', 'source', 'example'].some(key => playgroundSearch.has(key));
    if (snapshot?.version === 1 && !explicitSource) {
      currentCassetteMetadata = snapshot.metadata ?? null;
      currentCassetteHasMetadataFile = Boolean(snapshot.hasMetadataFile);
      restoreVirtualFilesFromCassette({files:new Map(snapshot.files.map(file => [file.path.replace(/^\//, ''), file.type === 'text' ? new TextEncoder().encode(file.data) : file.data]))});
      for (const directory of snapshot.directories ?? []) virtualFiles.mkdir(directory,{recursive:true});
      if (snapshot.activePath && !isCheckpointVirtualPath(snapshot.activePath) && virtualFiles.get(snapshot.activePath)?.type === 'text') openVirtualFile(snapshot.activePath);
      if (snapshot.runPath && !isHiddenVirtualPath(snapshot.runPath) && virtualFiles.get(snapshot.runPath)?.type === 'text') runVirtualPath = snapshot.runPath;
      restoredDesktopProject = true;
      // Recreate imported sample/preset names when Run initializes audio, without playing on startup.
      try {
        const archive = createPlaygroundCassetteZip(snapshot.files.filter(file => !['/metadata.json','/cassette.metadata.js'].includes(file.path)));
        pendingDesktopCassetteAssets = parseCassetteAssets(await loadPlaygroundCassette(archive, {name:'autosave'}));
      } catch (error) {setStatus(`Project restored; cassette assets could not be prepared: ${error.message}`);}
    }
    desktopAutosave = createProjectAutosave({store, onStatus:status, capture:() => ({
      version:1, activePath:activeVirtualPath, runPath:runVirtualPath,
      directories:virtualFiles.listDirectories(),
      metadata:currentCassetteMetadata, hasMetadataFile:currentCassetteHasMetadataFile,
      files:virtualFiles.list().filter(file => !isSystemVirtualPath(file.path)).map(file =>
        file.path === activeVirtualPath && file.type === 'text' ? {...file, data:getEditorValue()} : file),
    })});
    virtualFiles.onDidChange(() => desktopAutosave.changed());
    runFileSelect.addEventListener('change', () => queueMicrotask(() => desktopAutosave.changed()));
    window.addEventListener('pagehide', () => {
      desktopAutosave.changed(); void desktopAutosave.flush().catch(() => {});
    });
    window.__tetoricaAutosaveFlush = () => {
      desktopAutosave.changed(); return desktopAutosave.flush();
    };
    status(restoredDesktopProject ? 'Autosave restored' : 'Autosave enabled');
  } catch (error) {status(`Autosave unavailable: ${error.message ?? error}`);}
}

if (window.__TAURI_INTERNALS__) window.__playgroundStartup?.stage('Starting Playground… Restoring your saved project.');
await initializeDesktopAutosave();
bootPlayground();
let shellPreviousPath = activeVirtualPath;
playgroundShell=installPlaygroundShell({fs:virtualFiles,
  beforeCommand(){
    shellPreviousPath=activeVirtualPath;
    if(!isSystemVirtualPath(activeVirtualPath)&&virtualFiles.get(activeVirtualPath)?.data!==getEditorValue())saveActiveVirtualFile();
  },
  afterCommand(){
    if(!isSystemVirtualPath(activeVirtualPath)){
      if(!virtualFiles.has(activeVirtualPath))activeVirtualPath='/index.js';
      const file=virtualFiles.get(activeVirtualPath);
      if(file?.type==='text'&&(activeVirtualPath!==shellPreviousPath||getEditorValue()!==file.data))showVirtualFile(file);
    }
    editorAdapter.syncVirtualFiles?.(virtualFiles.list().filter(file => !isCheckpointVirtualPath(file.path)));
    renderVirtualFileExplorer();renderRunFileOptions();desktopAutosave?.changed();
  },
  output:document.getElementById('shellOutput'),form:document.getElementById('shellForm'),
  input:document.getElementById('shellInput'),prompt:document.getElementById('shellPrompt'),
  stopButton:document.getElementById('shellStopButton'),state:document.getElementById('shellState'),
  panel:document.getElementById('shellPanel'),terminal:document.getElementById('shellTerminal'),
  clearButton:document.getElementById('shellClearButton'),
  async onPlay(path){
    if(isSystemVirtualPath(path))throw Error('/sys is read-only');
    if(isCheckpointVirtualPath(path))throw Error('/.tet.ss is reserved for file checkpoints.');
    const file=virtualFiles.get(path);if(file?.type!=='text'||!path.endsWith('.js'))throw Error('Choose a project JavaScript file');
    runVirtualPath=path;renderRunFileOptions();await runCode({propagateError:true});
  },
});
if(!window.__TAURI_INTERNALS__)installPlaygroundGit({fs:virtualFiles,shell:playgroundShell.shell,lifecycle:playgroundShell,beforeCommand:saveActiveVirtualFile,afterCommand(){
  editorAdapter.syncVirtualFiles?.(virtualFiles.list().filter(file => !isCheckpointVirtualPath(file.path)));renderVirtualFileExplorer();renderRunFileOptions();
}});
window.addEventListener('pagehide',()=>playgroundShell.invalidate('Page closed'));

installMidiImport({button:document.getElementById('importMidiButton'), presets:playgroundPresets,
  enabled:selectedChip==='ym2612'&&!useNukedEngine,
  onError:error=>setStatus(`MIDI import failed: ${error.message}`),
  importFiles(name,source) {
    saveActiveVirtualFile();
    const directory=`/midi/${crypto.randomUUID()}`;
    const modulePath=`${directory}/song.js`,entry=`${directory}/main.js`;
    virtualFiles.writeText(modulePath,source);
    virtualFiles.writeText(entry,`const song = await import("./song.js");\nawait song.initCh(pg);\nawait song.runAllCh();\n// See song.js for runChN() exports. Combine selected channels with runChannels([1, 3]).\n`);
    activeVirtualPath=entry;runVirtualPath=entry;
    showVirtualFile(virtualFiles.get(entry));renderVirtualFileExplorer();renderRunFileOptions();setBottomTab('code');
    setStatus(`Imported ${name}. Choose Run to play the selected MIDI parts.`);
  },
});
