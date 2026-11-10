import {createSynthProject, isPsgTonePath, isPcmTonePath} from './synth_project.js?v=pcm-editor-1';
import {setupSynthFiles} from './synth_files.js?v=pcm-editor-1';
import {createSynthPcmVoice,createPcmBuiltinPreset,isPcmPreset,normalizePcmPreset,serializePcmPreset,pcmPresetFromAudio} from './synth_pcm.js?v=pcm-editor-1';
import {createSynthPcmAudio} from './synth_pcm_audio.js?v=pcm-editor-1';
import {setupSynthPcmControls} from './synth_pcm_controls.js?v=pcm-editor-1';
import {createPsgPreset, isPsgPreset, normalizePsgPreset, serializePsgPreset} from './synth_psg_preset.js?v=psg-envelope-1';
import {setupSynthSongControls} from './synth_song_controls.js?v=psg-live-1';
import {createSynthPsgSongVoice,describeSynthPsgSongVoice} from './synth_song_psg_voice.js?v=psg-live-1';
import {createSynthLiveHighlighter} from './synth_live_highlight.js';
import {createSynthSongVoice, describeSynthSongVoice} from './synth_song_voice.js?v=vgm-mix-copy-1';
import {createSynthPerformanceTarget} from './synth_performance.js?v=op-gates-1';
import {SynthRecordingManager} from './synth_recording.js?v=op-gates-1';
import {SynthPsgRecordingManager} from './synth_psg_recording.js?v=psg-event-rec-1';
import {SynthLooper,applySynthLooperPatch} from './synth_looper.js?v=op-gates-1';
import {SynthPsgLooper} from './synth_psg_looper.js?v=psg-looper-1';
import {renderSynthPsgLoop} from './synth_psg_loop_render.js?v=psg-looper-1';
import {createSynthPsgVoice} from './synth_psg.js?v=psg-event-rec-1';
import {createSynthPsgAudio} from './synth_psg_audio.js?v=psg-looper-1';
import {setupSynthPsgControls} from './synth_psg_controls.js?v=psg-envelope-1';
import { setupSynthMenu } from './synth_menu.js';
import { createSynthOutputVisualizer } from "./synth_output_visualizer.js";
import { applyModulation, modulationSettings } from "./synth_modulation.js";
import {applyPitchBend} from './synth_pitch_bend.js';
import {
  FM_PRESETS,
  FM_PRESET_ORDER,
  MegaDriveSynth,
} from "../js/megasynth.js";
import { YM2612_CLOCK } from "../js/ym2612.js";
import {
  createTfiFromPreset,
} from "../js/tfi.js";
import { createVgiFromPreset } from "../js/vgi.js";
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
} from "./synth_keyboard.js?v=synth-octave-1";
import {createOperatorEnvelopeView} from './synth_operator_envelope.js?v=synth-adsr-2';
import {
  buildCommonControls as buildCommonControlsView,
  buildHeader,
  createParamControl,
  buildOperatorControls as buildOperatorControlsView,
  displayOperatorToApiOperator,
} from "./synth_controls.js?v=op-gates-1";
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
} from "./synth_input.js?v=vgm-audition-1";

const status = document.getElementById("status");

// Experimental: ?engine=nuked swaps the YM2612 core for Nuked-OPN2
// (https://github.com/nukeykt/Nuked-OPN2) instead of the default ymfm
// backend.
const useNukedEngine =
  new URLSearchParams(
    window.location.search
  ).get("engine") === "nuked";
const activeWorkletUrl = useNukedEngine
  ? "../js/ym2612-worklet-nuked.js"
  : "../js/ym2612-worklet.js";
const activeYm2612WasmUrl = useNukedEngine
  ? "../generated/nuked_opn2_wasm.wasm"
  : "../generated/ym2612_wasm.wasm";
// Keep the chip in its native clock domain; Web Audio resamples for output.
const YM2612_NATIVE_SAMPLE_RATE =
  Math.floor(YM2612_CLOCK / 144);

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
const synthProject = createSynthProject();
let synthFiles = null;
let songControls = null;

const presetSelect =
  document.getElementById("presetSelect");
const psgPresetSelect = document.getElementById('synthPsgPresetSelect');
const exportPsgButton = document.getElementById('exportPsgButton');
const pcmPresetSelect=document.getElementById('synthPcmPresetSelect');
const exportPcmButton=document.getElementById('exportPcmButton');
const tfiFileInput =
  document.getElementById("tfiFile");
const exportTfiButton =
  document.getElementById(
    "exportTfiButton"
  );
const exportVgiButton =
  document.getElementById(
    "exportVgiButton"
  );
const masterVolumeRange =
  document.getElementById(
    "masterVolumeRange"
  );
const masterVolumeValue =
  document.getElementById(
    "masterVolumeValue"
  );
const tfiSummary =
  document.getElementById("tfiSummary");
const paramHelp =
  document.getElementById("paramHelp");
const paramHelpTitle =
  document.getElementById("paramHelpTitle");
const paramHelpText =
  document.getElementById("paramHelpText");
const channel3SpecialMonitor =
  document.getElementById(
    "channel3SpecialMonitor"
  );
const channel3SpecialModePill =
  document.getElementById(
    "channel3SpecialModePill"
  );
const channel3SpecialControlsRoot =
  document.getElementById(
    "channel3SpecialControls"
  );
const envelopeCanvas =
  document.getElementById("envelopeCanvas");
const envelopeContext =
  envelopeCanvas.getContext("2d");
const outputVisualizer = createSynthOutputVisualizer();
let visualMode = 'envelope';
let editorChip = 'ym2612';
// The displayed reference/placeholder tab need not own the editable document.
let activeInstrumentKind = 'fm';
let editorSwitchPending = false;
const editorChipTabs = [...document.querySelectorAll('[data-synth-chip]')];
const editorChipPanels = document.querySelectorAll('.synth-chip-panel');
const visualModeButtons = document.querySelectorAll('[data-visual-mode]');
const visualizerDescription = document.getElementById('visualizerDescription');
const visualDescriptions = {
  envelope: 'Drag OP1–OP4 points · Cyan: live chip-output RMS.',
  waveform: 'Final output waveform · live + looper + VGM · after volume.',
  spectrum: 'Final output spectrum · live + looper + VGM · after volume · dB.',
};
for (const button of visualModeButtons) {
  button.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
  });
  button.addEventListener('click', () => {
    visualMode = button.dataset.visualMode;
    for (const item of visualModeButtons) {
      const selected = item === button;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    }
    refreshVisualizerDescription();
    const editing = visualMode === 'envelope';
    operatorEnvelopeRoot.hidden = !editing;
    operatorEnvelopeRoot.parentElement.classList.toggle('is-editing-envelope', editing);
    envelopeCanvas.hidden = editing;
    operatorEnvelopeView.setVisible(editorChip === 'ym2612' && editing);
    if (editing) operatorEnvelopeView.invalidateOutput();
    megaSynth?.setOutputEnvelopeOptions({enabled: visualMode === 'envelope'});
    drawEnvelopeGuide();
  });
}
const heldKeys = new Set();
const modulationWheels = document.querySelectorAll('[data-modulation-wheel]');
const modulationValues = document.querySelectorAll('[data-modulation-value]');
let modulationWheelValue = 0;
for (const modulationWheel of modulationWheels) {
  let pointerInteraction = false;
  let pointerId = null;
  modulationWheel.addEventListener('pointerdown', event => {
    pointerInteraction = true;
    pointerId = event.pointerId;
    modulationWheel.blur();
  });
  modulationWheel.addEventListener('focus', () => {
    if (pointerInteraction) modulationWheel.blur();
  });
  const releaseWheelPointer = event => {
    if (!pointerInteraction || event.pointerId !== pointerId) return;
    pointerInteraction = false;
    pointerId = null;
    modulationWheel.blur();
  };
  window.addEventListener('pointerup', releaseWheelPointer);
  window.addEventListener('pointercancel', releaseWheelPointer);
  modulationWheel.addEventListener('input', () => {
    modulationWheelValue = Number(modulationWheel.value);
    for (const wheel of modulationWheels) wheel.value = String(modulationWheelValue);
    for (const readout of modulationValues) readout.textContent = `${Math.round(modulationWheelValue / 127 * 100)}%`;
    if (synth && editorChip === 'ym2612' && !songLiveView) applyModulation(synth, commonState, modulationWheelValue, VOICE_COUNT);
  });
  // Keep range-keyboard controls separate from the fretboard's arrow shortcuts.
  modulationWheel.addEventListener('keydown', event => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.stopPropagation();
    }
    // WebKit's native range does not consistently implement Home/End.
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      modulationWheel.value = event.key === 'Home' ? '0' : '127';
      modulationWheel.dispatchEvent(new Event('input', {bubbles: true}));
    }
  });
  modulationWheel.addEventListener('keyup', event => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.stopPropagation();
    }
  });
}
const activePointers = new Map();
const pitchBendWheels = document.querySelectorAll('[data-pitch-bend-wheel]');
const pitchBendValues = document.querySelectorAll('[data-pitch-bend-value]');
let pitchBendSemitones = 0;
function updatePitchBend(value) {
  pitchBendSemitones = value / 1000 * 2;
  for (const wheel of pitchBendWheels) wheel.value = String(value);
  for (const readout of pitchBendValues) readout.textContent = `${pitchBendSemitones > 0 ? '+' : ''}${pitchBendSemitones.toFixed(2)}`;
  if (synth) {
    const target=isSongChannelTarget() ? songAuditionVoice : editorChip === 'pcm' ? pcmVoice : editorChip === 'psg' ? psgVoice : getEditorPlayableSynth();
    if(target)applyPitchBend(target,voices,pitchBendSemitones);
  }
}
for (const wheel of pitchBendWheels) {
  let pointerInteraction = false;
  let pointerId = null;
  wheel.addEventListener('pointerdown', event => {pointerInteraction = true; pointerId = event.pointerId; wheel.blur();});
  wheel.addEventListener('focus', () => {if (pointerInteraction) wheel.blur();});
  const release = event => {
    if (!pointerInteraction || event.pointerId !== pointerId) return;
    pointerInteraction = false;
    pointerId = null;
    wheel.blur();
    updatePitchBend(0);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', () => {pointerInteraction = false; updatePitchBend(0);});
  wheel.addEventListener('input', () => updatePitchBend(Number(wheel.value)));
  wheel.addEventListener('keydown', event => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) {
      event.stopPropagation();
      if (['Home', 'End', 'Escape'].includes(event.key)) {
        event.preventDefault();
        updatePitchBend(event.key === 'Home' ? -1000 : event.key === 'End' ? 1000 : 0);
      }
    }
  });
  wheel.addEventListener('keyup', event => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) {
      event.stopPropagation();
      updatePitchBend(0);
    }
  });
  wheel.addEventListener('blur', () => {if (!pointerInteraction) updatePitchBend(0);});
}

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
  { id: "ssg", label: "SSG", min: 0, max: 15, step: 1, category: "modulation", help: "Special envelope mode." },
];

const COMMON_PARAM_DEFS = [
  { id: "algorithm", label: "ALGO", min: 0, max: 7, step: 1, category: "routing", help: "Operator routing pattern." },
  { id: "feedback", label: "FB", min: 0, max: 7, step: 1, category: "routing", help: "OP1 self-feedback amount." },
  { id: "ams", label: "AMS", min: 0, max: 3, step: 1, category: "modulation", help: "LFO volume depth for AM-enabled operators." },
  { id: "pms", label: "PMS", min: 0, max: 7, step: 1, category: "modulation", help: "LFO pitch depth for the channel." },
  { id: "lfoEnabled", label: "LFO", min: 0, max: 1, step: 1, booleanMode: true, category: "modulation", help: "Enable chip LFO." },
  { id: "lfoFrequency", label: "LFOF", min: 0, max: 7, step: 1, category: "modulation", help: "Chip LFO speed." },
  { id: "dacEnabled", label: "DAC", min: 0, max: 1, step: 1, booleanMode: true, category: "modulation", help: "Enable YM2612 channel 6 DAC / PCM path." },
];

const VOICE_COUNT = 6;

const fretboardState =
  createFretboardState();
let keyboardOctave = 0;
let fretboardLayout =
  createFretboardLayout({
    state: fretboardState,
    getClock: () => synth?.clock ?? YM2612_CLOCK,
  });

const commonState = {
  algorithm: 7,
  feedback: 0,
  ams: 0,
  pms: 0,
  lfoEnabled: false,
  lfoFrequency: 0,
  dacEnabled: false,
};

const channel3SpecialState = {
  enabled: false,
  frequencies: [
    { block: 4, fnum: 553 },
    { block: 4, fnum: 553 },
    { block: 4, fnum: 553 },
    { block: 4, fnum: 553 },
  ],
};

let currentPresetName =
  "one-op-basic";
let currentPsgPresetName = 'psg-default';
let currentPcmPresetName = 'pcm-sine', pcmLoadGeneration=0;
let importedTfiName = "";
let currentPresetPan = {left:true, right:true};
let currentPresetB4 = 0xc0;
let currentPerformanceVoice = null;
let activeHelpId = "";
let masterVolume = 1;
let songLiveView = null;
let songPsgLiveView = null;
let songPsgLiveSignature = '', songObservationMode = 'editor';
let songLiveSignature = '';
let liveHighlighter=null,psgLiveHighlighter=null;
const songHighlightToggle=document.getElementById('synthSongHighlightToggle');
const LIVE_HIGHLIGHT_PREFERENCE='tetorica-fm2612-synth-live-highlight';
try {songHighlightToggle.checked=localStorage.getItem(LIVE_HIGHLIGHT_PREFERENCE)!=='off';} catch {}
songHighlightToggle.addEventListener('change',()=>{
  const enabled=songHighlightToggle.checked;
  try {localStorage.setItem(LIVE_HIGHLIGHT_PREFERENCE,enabled?'on':'off');} catch {}
  liveHighlighter?.setEnabled(enabled);
  liveHighlighter?.update(songLiveView);
  psgLiveHighlighter?.setEnabled(enabled);
  psgLiveHighlighter?.update(songPsgLiveView);
  songHighlightToggle.blur();
});
let songTargetState = {target:'synth', playback:'stopped', view:null};
let songAuditionVoice = null, songAuditionMegaSynth = null, songAuditionReady = null;
let songAuditionBus = null, songAuditionSignature = '', songAuditionGeneration = 0;
let recordingEpoch=0, referenceRecordingStop=null;
const editorPerformanceTarget=createSynthPerformanceTarget({
  getSynth:()=>synth,
  getVoice:getCurrentPerformanceVoice,
  onCapturedCommand:(command,perform)=>megaSynth?.recordingManager?.perform
    ?megaSynth.recordingManager.perform(command,perform):perform(),
});
const loopPerformanceTarget=createSynthPerformanceTarget({getSynth:()=>loopSynth});

const DEFAULT_OPERATOR_STATE = Object.freeze({
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
});
const operatorStates = Object.fromEntries(
  OPERATOR_NUMBERS.map(operator => [operator, {...DEFAULT_OPERATOR_STATE}])
);

const commonControls = new Map();
const operatorControls = new Map();
const operatorGateControls = new Map();
let envelopeSelectionRevision = 0;
const operatorEnvelopeRoot = document.getElementById('synthEnvelopeEditor');
const operatorEnvelopeView = createOperatorEnvelopeView({
  root: operatorEnvelopeRoot,
  getOperators: () => songLiveView?.snapshot.channels[songLiveView.channel].preset.operators ?? operatorStates,
  getSelectionKey: () => envelopeSelectionRevision,
  onEdit: applyOperatorParams,
  getOutputEnvelope: () => songLiveView ? null : ({
    history: outputEnvelopeHistory,
    heldVoicePeak: outputEnvelopeHeldVoicePeak,
    silenceFloor: OUTPUT_ENVELOPE_SILENCE_FLOOR,
    baseScale: OUTPUT_ENVELOPE_SLOW_SCALE,
  }),
});
operatorEnvelopeView.setVisible(true);
operatorEnvelopeRoot.addEventListener('keydown', event => {
  if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
});
window.addEventListener('pagehide', event => {if (!event.persisted) operatorEnvelopeView.dispose();});

// This updates the view only. Files owns durable FM/PSG document transitions.
function selectEditorChip(button) {
  const changed = editorChip !== button.dataset.synthChip;
  if (changed) {
    ++pcmLoadGeneration;
    stopAllNotes();
    void stopRecordingForReference();
  }
  editorChip = button.dataset.synthChip;
  for (const tab of editorChipTabs) {
    const selected = tab === button;
    tab.classList.toggle('is-selected', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of editorChipPanels) panel.hidden = panel.id !== button.getAttribute('aria-controls');
  psgAudio.setEnabled(editorChip === 'psg');
  psgEventAudio.setEnabled(editorChip === 'psg');
  psgLoopAudio.setEnabled(editorChip === 'psg');
  pcmAudio.setEnabled(editorChip === 'pcm');
  operatorEnvelopeView.setVisible(editorChip === 'ym2612' && visualMode === 'envelope');
  operatorEnvelopeView.invalidateOutput();
  if (changed) {buildKeyboard(); updateKeyboardVisuals();}
  refreshChipAvailability();
  drawEnvelopeGuide();
  if ((editorChip === 'psg' && !psgAudio.getPsg() || editorChip === 'pcm' && !pcmVoice.isReady()) && synth) {
    void ensureAudioReady().catch(error => setStatus(`${editorChip==='pcm'?'PCM':'PSG'} audio: ${error.message}`));
  }
}
async function switchEditorChip(button) {
  if (editorSwitchPending||button.disabled) return false;
  const chip = button.dataset.synthChip;
  const kind = chip === 'ym2612' ? 'fm' : chip === 'psg' ? 'psg' : chip === 'pcm' ? 'pcm' : null;
  if(kind==='pcm'&&isSongChannelTarget()) {setStatus('PCM Live view is not available yet. Choose Synth to edit PCM.');return false;}
  if (kind && isSongChannelTarget()) {
    selectEditorChip(button);
    songControls.selectChip(chip);
    return true;
  }
  if (!kind || kind === activeInstrumentKind) {
    selectEditorChip(button);
    if (kind&&kind!=='pcm') songControls?.selectChip(chip);
    return true;
  }
  editorSwitchPending = true;
  stopAllNotes();
  updateKeyboardAvailability();
  try {
    songControls?.selectTarget('synth');
    return await synthFiles.switchEditor(kind);
  } catch (error) {
    setStatus(`Could not switch instrument: ${error.message}`);
    return false;
  } finally {
    editorSwitchPending = false;
    refreshChipAvailability();
  }
}
for (const button of editorChipTabs) {
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', async () => {
    const focusWasInTabs = editorChipTabs.includes(document.activeElement);
    if (await switchEditorChip(button) && focusWasInTabs) button.focus();
  });
  button.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const offsets = {ArrowLeft:-1, ArrowUp:-1, ArrowRight:1, ArrowDown:1};
    if (Object.hasOwn(offsets, event.key) || event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); event.stopPropagation();
      const available=editorChipTabs.filter(tab=>!tab.disabled),index=available.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : (index + offsets[event.key] + available.length) % available.length;
      void switchEditorChip(available[next]).then(changed => {if (changed) available[next].focus();});
    } else if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
  });
  button.addEventListener('keyup', event => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End',' ','Enter'].includes(event.key)) event.stopPropagation();
  });
}
const channel3SpecialControls =
  new Map();
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
const eventIgnorePatchByChip = {ym2612:true,psg:false};
eventRecordIgnoreOperators.addEventListener('change',()=>{
  if(editorChip==='pcm'){eventRecordIgnoreOperators.blur();return;}
  eventIgnorePatchByChip[editorChip==='psg'?'psg':'ym2612']=eventRecordIgnoreOperators.checked;
  eventRecordIgnoreOperators.blur();
});
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
let finalOutputBus = null;
let switchingAudioOutput = false;
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
let psgLooper = null, psgLoopSession = null;
const psgPreparedLoopUnits=new WeakMap();
let eventRecordSessionActive =
  false;

const voices =
  createVoices(8);

const activeKeys = new Map();
let inputController = null;
let psgControls = null;
let pcmControls=null;
let psgEventRecorder = null;
const psgAudio = createSynthPsgAudio({onError:error => {
  stopAllNotes();psgEventRecorder?.stopRecord();eventRecordSessionActive=false;
  updateKeyboardAvailability();updateEventRecordUi();setStatus(`PSG audio: ${error.message}`);
}});
const psgEventAudio=createSynthPsgAudio({onError:error=>{
  psgEventRecorder?.stopRecordingPlayback();
  setStatus(`PSG event playback: ${error.message}`);updateEventRecordUi();
}});
const psgLoopAudio=createSynthPsgAudio({onError:error=>{
  void psgLooper?.stop();setStatus(`PSG loop playback: ${error.message}`);updateLooperUi();
}});
const pcmAudio=createSynthPcmAudio({onError:error=>{
  stopAllNotes();updateKeyboardAvailability();setStatus(`PCM audio: ${error.message}`);
}});
const pcmVoice=createSynthPcmVoice({getPcm:()=>pcmAudio.getPcm(),getPitchClock:()=>synth?.clock??YM2612_CLOCK,
  onState:()=>{pcmControls?.update();updateKeyboardAvailability();}});
const psgVoice = createSynthPsgVoice({
  getPsg:() => psgAudio.getPsg(),
  getPitchClock:() => synth?.clock ?? YM2612_CLOCK,
  onState:() => psgControls?.update(songPsgLiveView?.snapshot.channels[songPsgLiveView.channel].preset),
  onCommand:command=>{
    try {psgEventRecorder?.recordCommand(command);}
    catch(error) {psgEventRecorder?.stopRecord();setStatus(`PSG event recording stopped: ${error.message}`);}
    try {psgLooper?.captureCommand(command);}
    catch(error) {void psgLooper?.undo();setStatus(`PSG loop recording stopped: ${error.message}`);}
  },
});
psgEventRecorder=new SynthPsgRecordingManager({
  now:()=>audioContext?.currentTime??0,
  getSettings:()=>psgVoice.getSettings(),
  getPitchClock:()=>synth?.clock??YM2612_CLOCK,
  onChange:()=>updateEventRecordUi(),
  onPlaybackStopped:()=>updateEventRecordUi(),
  async startPlayback(recording,options) {
    psgVoice.stop();clearInputState();
    const psg=await psgEventAudio.prepare(audioContext,finalOutputBus);
    options.signal.throwIfAborted();
    psgEventAudio.setEnabled(editorChip==='psg');
    psg.playRecording(recording,options);
  },
  stopPlayback:()=>psgEventAudio.getPsg()?.stopRecordingPlayback(),
});
psgControls = setupSynthPsgControls({
  voice:psgVoice,
  onBeforeSourceChange:() => stopAllNotes(),
  onBeforeEnvelopeToggle:() => stopAllNotes(),
  onVisualModeChange:() => drawEnvelopeGuide(),
  onSettingsChange:() => {
    if (activeInstrumentKind === 'psg') synthFiles?.markDirty();
    updateKeyboardAvailability(); drawEnvelopeGuide();
  },
});
pcmControls=setupSynthPcmControls({voice:pcmVoice,onBuiltin:shape=>{
  if(applyPcmEditPreset(createPcmBuiltinPreset(shape)))setStatus(`PCM ${shape} selected.`);
},
  onLoad:loadPcmWav,onVisualModeChange:()=>drawEnvelopeGuide(),onSettingsChange:patch=>{
    if(activeInstrumentKind!=='pcm'||isSongChannelTarget()||document.querySelector('.synth-editor').getAttribute('aria-busy')==='true')return;
    if(patch.loopEnd!==undefined&&patch.loopEnd!==pcmVoice.getSettings().loopEnd)clearInputState();
    pcmVoice.setSettings(patch);synthFiles?.markDirty();pcmControls.update();
    if(audioContext&&!pcmVoice.isReady())void ensureAudioReady({announce:false}).catch(error=>setStatus(`PCM audio: ${error.message}`));
  }});

function editorButtonForKind(kind) {
  return document.getElementById(kind==='pcm'?'synthChipTabPcm':kind==='psg'?'synthChipTabPsg':'synthChipTabYm2612');
}

function applyPcmEditPreset(preset,notice='') {
  if(activeInstrumentKind!=='pcm'||isSongChannelTarget()||document.querySelector('.synth-editor').getAttribute('aria-busy')==='true')return false;
  ++pcmLoadGeneration;stopAllNotes();pcmVoice.setPreset(preset);pcmControls.update();synthFiles?.markDirty();
  const label=document.getElementById('synthPcmLoadStatus');label.textContent=notice;label.hidden=!notice;
  if(audioContext&&editorChip==='pcm')void ensureAudioReady({announce:false}).catch(error=>setStatus(`PCM audio: ${error.message}`));
  return true;
}

async function loadPcmWav(file) {
  if(!file||editorChip!=='pcm')return;
  const generation=++pcmLoadGeneration;
  try {
    if(file.size>64*1024*1024)throw Error('WAV input exceeds 64 MiB. Current sample kept.');
    setStatus(`Loading ${file.name}…`);
    const bytes=await file.arrayBuffer();
    if(generation!==pcmLoadGeneration||editorChip!=='pcm')return;
    const signature=new TextDecoder('ascii').decode(new Uint8Array(bytes,0,Math.min(12,bytes.byteLength)));
    if(!signature.startsWith('RIFF')||signature.slice(8,12)!=='WAVE')throw Error('Choose a RIFF WAV file.');
    const Decoder=window.OfflineAudioContext??window.webkitOfflineAudioContext;
    const decoded=await new Decoder(2,1,44100).decodeAudioData(bytes);
    if(generation!==pcmLoadGeneration||editorChip!=='pcm')return;
    const result=pcmPresetFromAudio({sampleRate:decoded.sampleRate,channels:Array.from({length:decoded.numberOfChannels},(_,ch)=>decoded.getChannelData(ch))},{name:file.name});
    if(!applyPcmEditPreset(result.preset,result.notice||'Software conversion · mono 8-bit PCM.'))return;
    setStatus(`Loaded ${file.name}. ${result.notice||'Software conversion to mono 8-bit PCM.'}`);
  } catch(error) {
    if(generation===pcmLoadGeneration&&editorChip==='pcm')setStatus(`WAV load failed: ${error.message} Current sample kept.`);
  }
}

function refreshChipAvailability() {
  const fm = songPsgLiveView ? false : songLiveView ? true : activeInstrumentKind === 'fm';
  const observing = isSongChannelTarget();
  const pcm=activeInstrumentKind==='pcm'&&!songPsgLiveView&&!songLiveView;
  document.querySelector('.synth-file-editor-heading').hidden = false;
  const note = document.querySelector('.synth-file-format-note');
  note.textContent = fm ? 'TFI / VGI + Synth settings · Format info ⓘ' : pcm?'RF5C164 PCM · JSON / Files / Cassette':'PSG instrument · JSON / Files / Cassette';
  note.title = fm ? fmFormatTitle : pcm?'Self-contained PCM sample and settings. WAV conversion is software.':'Tone / Noise, attenuation and noise clock. Save with Sync or export PSG JSON.';
  exportTfiButton.hidden = exportVgiButton.hidden = !fm;
  exportPsgButton.hidden = fm||pcm;
  exportPcmButton.hidden=!pcm;exportPcmButton.disabled=!pcm||observing||editorSwitchPending;
  exportPsgButton.disabled = fm || pcm || observing || editorSwitchPending;
  exportTfiButton.disabled = exportVgiButton.disabled = !fm || observing;
  for (const wheel of modulationWheels) wheel.disabled = editorChip === 'psg' || editorChip==='pcm' || observing;
  document.getElementById('synthChipTabPcm').disabled=observing;
  document.getElementById('synthChipTabPcm').title=observing?'Choose Synth to edit PCM. PCM Live view is not available yet.':'Edit Mega CD PCM samples';
  eventRecordIgnoreOperators.disabled=editorChip==='pcm';
  eventRecordIgnoreOperators.checked=eventIgnorePatchByChip[editorChip==='psg'?'psg':'ym2612'];
  document.getElementById('eventRecordPatchLabel').textContent=editorChip==='psg'?'Use current sound':'Ignore Op';
  eventRecordIgnoreOperators.parentElement.title=editorChip==='psg'
    ?'Use the current PSG sound instead of recorded settings. The sound is captured when Play starts.'
    :'Ignore recorded operator settings and use the current FM sound.';
  synthFiles?.refresh();
  updateLooperUi(); updateEventRecordUi(); updateKeyboardAvailability();
}
const fmFormatTitle = document.querySelector('.synth-file-format-note').title;

function setStatus(message) {
  status.textContent = message;
}

function updateMasterVolumeUi() {
  if (masterVolumeRange) {
    masterVolumeRange.dataset.boosted = String(masterVolume > 1);
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
  megaSynth?.setMasterVolume(
    masterVolume
  );
  loopMegaSynth?.setMasterVolume(
    masterVolume
  );
  songControls?.setVolume(masterVolume);
  songAuditionMegaSynth?.setMasterVolume(masterVolume);
  psgAudio.setVolume(masterVolume);
  psgEventAudio.setVolume(masterVolume);
  psgLoopAudio.setVolume(masterVolume);
  pcmAudio.setVolume(masterVolume);
}

function isSongChannelTarget() {
  return songTargetState.target !== 'synth' && ['loading','playing','paused','seeking'].includes(songTargetState.playback);
}

function isPerformanceInputEnabled() {
  return !editorSwitchPending && !switchingAudioOutput && !referenceRecordingStop && songTargetState.playback !== 'seeking' && (!isSongChannelTarget() || Boolean(songAuditionVoice));
}

function getCurrentPerformanceVoice() {
  if(!currentPerformanceVoice&&!channel3SpecialState.enabled)return null;
  return {keyMask:currentPerformanceVoice?.keyMask??15,specialMode:channel3SpecialState.enabled,
    specialFrequencies:channel3SpecialState.enabled?channel3SpecialState.frequencies:[]};
}

function recordingBlocked() {
  return eventRecordingBlocked();
}

function eventRecordingBlocked() {
  return editorChip==='pcm'||switchingAudioOutput||Boolean(referenceRecordingStop)||
    ['loading','playing','seeking'].includes(songTargetState.playback)||isSongChannelTarget();
}

function recordingUnavailableReason() {
  return editorChip==='pcm'?'PCM Event Rec and Looper are not available yet.':'Pause or Stop the VGM and choose Synth to record your instrument.';
}

function recordingOperationCurrent(epoch,chip=editorChip) {return epoch===recordingEpoch&&chip===editorChip&&!recordingBlocked();}
function activeLooper() {return editorChip==='pcm'?null:editorChip==='psg'?psgLooper:looper;}
function eventRecordingOperationCurrent(epoch,chip) {return epoch===recordingEpoch&&chip===editorChip&&!eventRecordingBlocked();}
function eventRecordingSource() {return editorChip==='pcm'?null:editorChip==='psg'?psgEventRecorder:megaSynth;}
function canPlayEventRecording(recording) {
  return editorChip==='psg'?recording?.commands?.some(command=>command.type==='noteOn'):Boolean(recording?.commands?.length);
}
function releaseEventTakeKeys() {
  if(editorChip!=='psg'){stopAllNotes();return;}
  for(const channel of psgVoice.getState().heldChannels)psgVoice.noteOff(channel);
  clearInputState();
}

function restoreEditorAfterEventPlayback() {
  stopAllNotes();
  synth?.reset();
  applyPatchToVoices();
  updateEventRecordUi();
}

// Stop asynchronous recording/capture before reference audio may start. The
// epoch also invalidates actions that were still waiting for audio readiness.
function stopRecordingForReference() {
  ++recordingEpoch;
  if(psgEventRecorder?.isRecording()) {psgVoice.stop();psgEventRecorder.stopRecord();}
  psgEventRecorder?.stopRecordingPlayback();
  const stoppingPsg=psgLooper?.stop();
  eventRecordSessionActive=false;
  if(referenceRecordingStop)return referenceRecordingStop;
  stopAllNotes();
  if(megaSynth?.isRecording())megaSynth.stopRecord();
  megaSynth?.stopRecordingPlayback();
  eventRecordSessionActive=false;
  stopLooperAudioPlayback();
  if(loopOutputBus)loopOutputBus.gain.value=0;
  const pending=Promise.all([stoppingPsg,Promise.resolve().then(()=>looper?.stop())]).then(()=>{
    stopLooperAudioPlayback();
    loopSynth?.reset();
    stopAllNotes();
  }).finally(()=>{
    if(referenceRecordingStop!==pending)return;
    stopLooperAudioPlayback();
    loopSynth?.reset();
    synth?.reset();
    applyPatchToVoices();
    referenceRecordingStop=null;
    if(loopOutputBus)loopOutputBus.gain.value=1;
    updateLooperUi();updateEventRecordUi();updateKeyboardAvailability();
  });
  referenceRecordingStop=pending;
  pending.catch(error=>setStatus(`Unable to stop recording: ${error.message}`));
  updateLooperUi();updateEventRecordUi();updateKeyboardAvailability();
  return pending;
}

// A third, lazy keyboard chip keeps audition notes out of the song engine,
// original editor chip, and looper/event recorder. It shares the final output
// and Master level, but has its own mute for release tails at mode changes.
function ensureSongAuditionReady() {
  if (songAuditionReady) return songAuditionReady;
  if (!songAuditionBus) {
    songAuditionBus = audioContext.createGain();
    songAuditionBus.gain.value = 0;
    songAuditionBus.connect(finalOutputBus);
  }
  const candidate = new MegaDriveSynth({audioContext, workletUrl:activeWorkletUrl,
    ym2612WasmUrl:activeYm2612WasmUrl, outputNode:songAuditionBus, masterVolume});
  songAuditionMegaSynth = candidate;
  songAuditionReady = candidate.start().then(() => candidate.fm).catch(error => {
    void candidate.close();
    if (songAuditionMegaSynth === candidate) {
      songAuditionReady = null;
      songAuditionMegaSynth = null;
    }
    throw error;
  });
  return songAuditionReady;
}

function setSongTargetState(next) {
  const wasPlaying=['loading','playing','seeking'].includes(songTargetState.playback);
  const startingSeek=next.playback==='seeking'&&songTargetState.playback!=='seeking';
  const recordingStateChanged=next.playback!==songTargetState.playback||next.target!==songTargetState.target;
  const leavingEditor=songTargetState.target==='synth'&&next.target!=='synth'&&next.playback==='paused';
  const channelTarget = next.target !== 'synth' && ['loading','playing','paused','seeking'].includes(next.playback);
  const audition = channelTarget && next.playback === 'paused' ? next.view : null;
  const signature = JSON.stringify([channelTarget ? next.target : 'synth', channelTarget && next.playback,
    audition?.snapshot.revision, audition?.snapshot.frame]);
  songTargetState = next;
  if(startingSeek||!wasPlaying&&['loading','playing'].includes(next.playback)||leavingEditor)void stopRecordingForReference();
  if(recordingStateChanged){updateLooperUi();updateEventRecordUi();}
  if (signature === songAuditionSignature) return;
  songAuditionSignature = signature;
  const generation = ++songAuditionGeneration;
  stopAllNotes();
  songAuditionVoice = null;
  if (songAuditionBus) songAuditionBus.gain.value = 0;
  songAuditionMegaSynth?.fm?.reset();
  // The wheels are performance state, not part of a captured instrument.
  updatePitchBend(0);
  updateKeyboardAvailability();
  if (!audition) return;
  if (next.chip === 'psg') {
    const description = describeSynthPsgSongVoice(audition.snapshot, audition.channel);
    if (!description.playable) return;
    keyboard.dataset.songAudition = 'loading';
    void psgAudio.prepare(audioContext,finalOutputBus).then(psg => {
      if (generation !== songAuditionGeneration) return;
      songAuditionVoice = createSynthPsgSongVoice(psg,audition.snapshot,audition.channel);
      updateKeyboardAvailability();
    }).catch(error => {
      if (generation !== songAuditionGeneration) return;
      keyboard.dataset.songAudition = 'unavailable';
      setStatus(`PSG audition failed: ${error.message}`);
    });
    return;
  }
  const description = describeSynthSongVoice(audition.snapshot, audition.channel);
  if (!description.playable) return;
  keyboard.dataset.songAudition = 'loading';
  void ensureSongAuditionReady().then(chip => {
    if (generation !== songAuditionGeneration) return;
    const voice = createSynthSongVoice(chip, audition.snapshot, audition.channel);
    songAuditionVoice = {...voice, noteOn(...args) {
      songAuditionBus.gain.value = 1;
      voice.noteOn(...args);
    }};
    updateKeyboardAvailability();
  }).catch(error => {
    if (generation !== songAuditionGeneration) return;
    keyboard.dataset.songAudition = 'unavailable';
    setStatus(`CH${audition.channel + 1} audition failed: ${error.message}`);
  });
}

function refreshVisualizerDescription() {
  visualizerDescription.textContent = visualMode === 'envelope' && songLiveView
    ? `${songLiveView.paused ? 'Paused' : songLiveView.following ? 'Live' : 'Frozen'} CH${songLiveView.channel + 1} · written settings · envelope guides · read-only.`
    : visualDescriptions[visualMode];
}

function setFmSongLiveView(next) {
  const active = Boolean(next);
  const changedMode = active !== Boolean(songLiveView);
  const voice = next?.snapshot.channels[next.channel];
  const signature = next ? JSON.stringify([next.channel, next.paused, voice,
    next.snapshot.lfo, next.snapshot.dacEnabled, next.snapshot.channels[2].specialMode,
    next.snapshot.channels[2].specialFrequencies]) : '';
  songLiveView = next;
  if (changedMode) {
    envelopeSelectionRevision++;
    document.querySelector('.synth-editor').dataset.liveView = String(active);
    operatorEnvelopeRoot.querySelector('.operator-envelope-plot').inert = active;
    exportTfiButton.disabled = exportVgiButton.disabled = active || editorChip === 'psg';
    for (const wheel of modulationWheels) wheel.disabled = active || editorChip === 'psg';
    synthFiles?.refresh();
  }
  if (signature !== songLiveSignature) {
    songLiveSignature = signature;
    // updateVisual changes only the control's displayed/edit basis. The actual
    // instrument state, original files and keyboard synth remain untouched.
    syncControlsFromState();
    renderAlgorithmDiagram();
    renderChannel3SpecialMonitor();
    operatorEnvelopeView.invalidateOutput();
    drawEnvelopeGuide();
  }
  // The helper also sees transport/follow changes when parameter values stay
  // identical, so Pause / Live Off / CH changes cannot leave a stale pulse.
  liveHighlighter?.update(next);
  refreshVisualizerDescription();
}

function setSongLiveView(next) {
  const hadView=Boolean(songLiveView||songPsgLiveView);
  const hadPsgView=Boolean(songPsgLiveView);
  songPsgLiveView=next?.chip==='psg'?next:null;
  setFmSongLiveView(next?.chip==='psg'?null:next);
  const psgPreset=songPsgLiveView?.snapshot.channels[songPsgLiveView.channel].preset;
  const signature=psgPreset?JSON.stringify([songPsgLiveView.channel,psgPreset]):'';
  if(signature!==songPsgLiveSignature||hadPsgView&&!songPsgLiveView) {
    songPsgLiveSignature=signature;
    psgControls?.update(psgPreset);
  }
  psgLiveHighlighter?.update(songPsgLiveView);
  document.querySelector('.synth-editor').dataset.liveView=String(isSongChannelTarget());
  if(!next&&hadView&&!isSongChannelTarget()) {
    selectEditorChip(editorButtonForKind(activeInstrumentKind));
  }
  const mode=isSongChannelTarget()?(songTargetState.chip??'ym2612'):'editor';
  if(mode!==songObservationMode) {songObservationMode=mode;refreshChipAvailability();}
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
    Math.max(0,audioContext.currentTime -
    (state.loopStartedAt ?? 0));
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
  const looper=activeLooper();
  const blocked=recordingBlocked();
  if(looperStartButton) {
    looperStartButton.disabled=blocked;
    looperStartButton.title=blocked?recordingUnavailableReason():'';
  }
  if(looperRecordButton)looperRecordButton.disabled=blocked;
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
        "Record [Space]";
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
  if(looperRecordButton)looperRecordButton.disabled=blocked||Boolean(state.busy);
  const progressText =
    formatLooperProgress(state);

  if (looperStateRoot) {
    if (state.busy) {
      looperStateRoot.textContent='Preparing loop…';
    } else if (state.recording) {
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
        ? "Stop [Space]"
        : "Record [Space]";
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
      !state.recording && !state.rendering);

  looperRecordButton?.classList.toggle(
    "is-selected",
    state.recording
  );
}

function updateEventRecordUi() {
  const recordingSource =
    eventRecordingSource();
  const recording =
    (editorChip==='psg'?null:recordingSource?.exportRecording?.()) ??
    null;
  const isRecording =
    recordingSource?.isRecording?.() ??
    false;
  const isPlaying =
    recordingSource?.isRecordingPlaybackActive?.() ??
    false;
  const commandCount =
    editorChip==='psg'?(recordingSource?.commandCount??0):(recording?.commands?.length??0);

  if (eventRecordStartButton) {
    eventRecordStartButton.disabled=eventRecordingBlocked();
    eventRecordStartButton.title=eventRecordingBlocked()?recordingUnavailableReason():'';
    eventRecordStartButton.textContent =
      eventRecordSessionActive
        ? "Event Rec Stop"
        : "Event Rec Start";
  }

  if (eventRecordStopButton) {
    eventRecordStopButton.hidden =
      !eventRecordSessionActive;
    eventRecordStopButton.disabled =
      !eventRecordSessionActive||eventRecordingBlocked();
    eventRecordStopButton.textContent =
      isRecording
        ? "Stop [Space]"
        : "Record [Space]";
  }

  if (eventRecordPlayButton) {
    eventRecordPlayButton.disabled =
      !recordingSource ||
      eventRecordingBlocked() ||
      isRecording ||
      !(editorChip==='psg'?recordingSource?.hasNotes:canPlayEventRecording(recording));
    eventRecordPlayButton.textContent =
      isPlaying
        ? "Stop Play"
        : "Play";
  }

  if (eventRecordExportButton) {
    eventRecordExportButton.disabled =
      !recordingSource ||
      isRecording ||
      commandCount === 0;
  }
  if(eventRecordImportInput)eventRecordImportInput.disabled=eventRecordingBlocked()||isRecording;

  if (eventRecordStateRoot) {
    if (isRecording) {
      eventRecordStateRoot.textContent =
        `Event: REC ${commandCount}`;
    } else if (isPlaying && editorChip==='psg') {
      eventRecordStateRoot.textContent=`Event: LOOP ${commandCount}`;
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
  if(editorChip==='psg')return {loop:true,ignorePatch:eventRecordIgnoreOperators.checked};
  return {
    loop: true,
    get ignoreOperators() {
      return (
        eventRecordIgnoreOperators?.checked ===
        true
      );
    },
    get ignorePatch() {
      return this.ignoreOperators;
    },
    get reset() {
      return !this.ignoreOperators;
    },
  };
}

async function playEventSource(source,recording=null) {
  const epoch=recordingEpoch,chip=editorChip;
  try {
    const loop=activeLooper();
    if(loop?.running) {
      await loop.stop();
      if(!eventRecordingOperationCurrent(epoch,chip))return null;
      stopAllNotes();
    }
    return await source.playRecording(recording,buildEventPlaybackOptions());
  }
  catch(error) {
    if(error.name!=='AbortError')setStatus(`Event playback failed: ${error.message}`);
    return null;
  } finally {updateEventRecordUi();}
}

async function runLooperAction(action) {
  try {return await action();}
  catch(error) {
    if(error.name!=='AbortError')setStatus(`Looper operation failed: ${error.message}`);
    updateLooperUi();return null;
  }
}

function handleLooperStateChange(
  detail
) {
  updateLooperUi();
  if(detail.reason==='record-error'||detail.reason==='error') {
    setStatus(`Unable to prepare PSG loop: ${detail.error?.message??detail.error??'Unknown error'}`);
    return;
  }

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
  if(eventRecordingBlocked())return;
  const epoch=recordingEpoch,chip=editorChip;
  await ensureAudioReady();
  if(!eventRecordingOperationCurrent(epoch,chip))return;
  const source=eventRecordingSource();

  if (!source) {
    return;
  }

  if (
    !eventRecordSessionActive &&
    activeLooper()?.running
  ) {
    updateLooperUi();
    updateEventRecordUi();
    setStatus(
      "Stopping looper..."
    );
    await activeLooper().stop();
    if(!eventRecordingOperationCurrent(epoch,chip))return;
    stopAllNotes();
  }

  if (eventRecordSessionActive) {
    if (source.isRecording()) {
      releaseEventTakeKeys();
      const recording =
        source.stopRecord();
      if (
        canPlayEventRecording(recording)
      ) {
        await playEventSource(source,recording);
        if(!eventRecordingOperationCurrent(epoch,chip))return;
      }
    }

    eventRecordSessionActive =
      false;
    updateLooperUi();
    updateEventRecordUi();
    setStatus(
      "Event record mode stopped."
    );
    return;
  }

  eventRecordSessionActive = true;
  updateLooperUi();
  updateEventRecordUi();
  setStatus(
    "Event record mode ready. Press Record [Space]."
  );
}

async function toggleEventTakeRecording() {
  if(eventRecordingBlocked())return;
  const epoch=recordingEpoch,chip=editorChip;
  await ensureAudioReady();
  if(!eventRecordingOperationCurrent(epoch,chip))return;
  const source=eventRecordingSource();

  if (
    !source ||
    !eventRecordSessionActive
  ) {
    setStatus(
      "Start Event Rec first."
    );
    return;
  }

  if (source.isRecording()) {
    releaseEventTakeKeys();
    const recording =
      source.stopRecord();
    if (
      canPlayEventRecording(recording)
    ) {
      await playEventSource(source,recording);
      if(!eventRecordingOperationCurrent(epoch,chip))return;
    }
    updateEventRecordUi();
    setStatus(
      canPlayEventRecording(recording)?`Event recording stopped. ${recording.commands.length} commands looping.`:"No notes were played. Empty event take kept silent."
    );
    return;
  }

  stopAllNotes();if(chip!=='psg')applyPatchToVoices();
  source.startRecord();
  updateEventRecordUi();
  setStatus(
    "Event recording started."
  );
}

async function playEventRecording() {
  if(eventRecordingBlocked())return;
  const epoch=recordingEpoch,chip=editorChip;
  await ensureAudioReady();
  if(!eventRecordingOperationCurrent(epoch,chip))return;
  const source=eventRecordingSource();

  if (!source) {
    return;
  }

  if (
    source.isRecordingPlaybackActive()
  ) {
    source.stopRecordingPlayback();
    updateEventRecordUi();
    setStatus(
      "Event playback stopped."
    );
    return;
  }

  const recording =
    await playEventSource(source);
  if(!eventRecordingOperationCurrent(epoch,chip))return;
  if(!recording)return;
  updateEventRecordUi();
  setStatus(
    `Playing recorded event stream (${recording?.commands?.length ?? 0} commands) in a loop.`
  );
}

function exportEventRecording() {
  const source=eventRecordingSource();
  if (!source) {
    return;
  }

  const recording =
    source.exportRecording();

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
    editorChip==='psg'?'tetorica-psg-recording.json':'megasynth-recording.json';
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
  if(eventRecordingBlocked()||eventRecordingSource()?.isRecording())return;
  const epoch=recordingEpoch,chip=editorChip;
  const [file] =
    event.target.files || [];

  if (!file) {
    return;
  }

  try {
    await ensureAudioReady();
    if(!eventRecordingOperationCurrent(epoch,chip))return;
    const source=eventRecordingSource();
    const text =
      await file.text();
    if(!eventRecordingOperationCurrent(epoch,chip))return;
    const recording =
      JSON.parse(text);
    source?.importRecording(
      recording
    );
    source?.stopRecordingPlayback();
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
  const isInitializing = audioInitStarted && !synth || editorChip === 'psg' && psgAudio.isPreparing() || editorChip==='pcm'&&(pcmAudio.isPreparing()||pcmAudio.getPcm()&&!pcmVoice.isReady());

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
  const channel = isSongChannelTarget();
  const enabled = isPerformanceInputEnabled();
  keyboard.dataset.songAudition = !channel ? 'off' : songAuditionVoice ? 'ready' : 'unavailable';
  keyboard.setAttribute('aria-disabled', String(!enabled));
  const targetName = songTargetState.chip === 'psg'
    ? ['Tone 1','Tone 2','Tone 3','Noise'][Number(String(songTargetState.target).split(':')[1])]
    : `CH${songTargetState.target + 1}`;
  keyboard.setAttribute('aria-label', channel
    ? `${targetName} keyboard${songAuditionVoice ? ' audition' : ' unavailable; pause the song to audition this channel'}`
    : editorChip==='pcm'?'Mega CD PCM 8-channel keyboard':editorChip === 'psg' ? `Sega PSG ${psgVoice.getSettings().source} keyboard` : 'Synth keyboard');
  keyboard.classList.toggle('is-song-unavailable', !enabled);
}

function rebuildFretboardLayout() {
  fretboardLayout =
    createFretboardLayout({
      state: fretboardState,
      octave: keyboardOctave,
      getClock: () => synth?.clock ?? YM2612_CLOCK,
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
  operatorEnvelopeView.invalidateOutput();
}

function applyPatchToVoices() {
  if (!synth) {
    return;
  }

  const modulation = modulationSettings(commonState, modulationWheelValue);
  synth.setLfo(modulation.lfoEnabled, modulation.lfoFrequency);
  synth.setDacEnabled(
    commonState.dacEnabled
  );
  synth.setChannel3SpecialMode(
    channel3SpecialState.enabled
  );

  for (
    let operator = 0;
    operator < 4;
    operator += 1
  ) {
    const frequency =
      channel3SpecialState
        .frequencies[operator];
    synth.setChannel3SpecialFrequency(
      operator,
      frequency.block,
      frequency.fnum
    );
  }

  synth.setFrequency(
    2,
    channel3SpecialState
      .frequencies[3].block,
    channel3SpecialState
      .frequencies[3].fnum
  );

  for (
    let channel = 0;
    channel < VOICE_COUNT;
    channel += 1
  ) {
    for (const operator of OPERATOR_NUMBERS) {
      synth.setOperator(
        channel,
        displayOperatorToApiOperator(
          operator
        ),
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
      currentPresetPan.left,
      currentPresetPan.right,
      commonState.ams,
      modulation.pms
    );
  }
  updatePitchBend(pitchBendSemitones * 500);
}

function syncControlsFromState() {
  const preset = songLiveView?.snapshot.channels[songLiveView.channel].preset;
  const common = preset ? {...preset, lfoEnabled:preset.lfo.enabled, lfoFrequency:preset.lfo.frequency,
    dacEnabled:songLiveView.snapshot.dacEnabled} : commonState;
  const operators = preset?.operators ?? operatorStates;
  for (const config of COMMON_PARAM_DEFS) {
    commonControls
      .get(config.id)
      ?.updateVisual(
        common[config.id]
      );
  }

  for (const operator of OPERATOR_NUMBERS) {
    const rowControls =
      operatorControls.get(operator);

    for (const config of OPERATOR_PARAM_DEFS) {
      rowControls
        ?.get(config.id)
        ?.updateVisual(
          operators[operator][
            config.id
          ]
        );
    }
  }

  if (presetSelect) {
    presetSelect.value =
      currentPresetName;
  }

  syncOperatorGates();
  syncChannel3SpecialControls();
}

function updateTfiSummary() {
  if (!tfiSummary) {
    return;
  }

  if (!importedTfiName) {
    tfiSummary.textContent =
      synthProject.listTones().length
        ? `${synthProject.listTones().length} instruments in Cassette`
        : "Drop VGM / VGZ / S98 / TFI / VGI anywhere to load.";
    return;
  }

  tfiSummary.textContent =
    `TFI/VGI: ${importedTfiName}`;
}

function applyPresetState(
  presetName
) {
  const preset = presetName.startsWith('vfs:')
    ? synthProject.readTone(presetName.slice(4)).preset
    : presetName === 'pcm-sine' ? createPcmBuiltinPreset('sine') : presetName === 'psg-default' ? createPsgPreset({}) : FM_PRESETS[presetName];

  if (!preset) {
    return;
  }

  applyPresetData(preset, presetName);
}

function applyPresetData(preset, presetName) {
  const kind = isPcmPreset(preset)?'pcm':isPsgPreset(preset) ? 'psg' : 'fm';
  const psgPreset = kind === 'psg' ? normalizePsgPreset(preset) : null;
  const pcmPreset=kind==='pcm'?normalizePcmPreset(preset):null;
  if (kind !== activeInstrumentKind) stopAllNotes();
  activeInstrumentKind = kind;
  selectEditorChip(editorButtonForKind(kind));
  if(kind==='pcm') {
    ++pcmLoadGeneration;pcmVoice.setPreset(pcmPreset);currentPcmPresetName=presetName;pcmPresetSelect.value=presetName;pcmControls.update();
    if(audioContext)void ensureAudioReady({announce:false}).catch(error=>setStatus(`PCM audio: ${error.message}`));
    return;
  }
  if (kind === 'psg') {
    psgVoice.setSettings(psgPreset.settings);
    currentPsgPresetName = presetName;
    psgPresetSelect.value = presetName;
    psgControls.update();
    return;
  }
  envelopeSelectionRevision++;
  currentPresetName = presetName;
  importedTfiName = presetName.startsWith('vfs:') ? presetName.split('/').pop() : '';
  currentPresetPan = {...(preset.pan ?? {left:true, right:true})};
  currentPresetB4 = preset.b4 ?? 0xc0;
  const hadPerformanceVoice=Boolean(currentPerformanceVoice);
  currentPerformanceVoice=preset.capturedVoice?structuredClone(preset.capturedVoice):null;
  if(currentPerformanceVoice) {
    channel3SpecialState.enabled=currentPerformanceVoice.specialMode;
    if(currentPerformanceVoice.specialMode)channel3SpecialState.frequencies=structuredClone(currentPerformanceVoice.specialFrequencies);
  } else if(hadPerformanceVoice)channel3SpecialState.enabled=false;
  commonState.algorithm =
    preset.algorithm ?? 7;
  commonState.feedback =
    preset.feedback ?? 0;
  commonState.ams =
    preset.ams ?? 0;
  commonState.pms =
    preset.pms ?? 0;
  commonState.lfoEnabled = preset.lfo?.enabled ?? false;
  commonState.lfoFrequency = preset.lfo?.frequency ?? 0;

  // Built-in presets use 0-based arrays; imported TFI/VGI and saved
  // Synth snapshots use logical operator numbers 1..4.
  const operators = preset.operators ?? {};
  const operatorIndexOffset = operators[0] !== undefined ? 0 : 1;
  for (const operator of OPERATOR_NUMBERS) {
    const nextOperator =
      operators[operator - 1 + operatorIndexOffset] ??
      {};

    operatorStates[operator] = {
      ...DEFAULT_OPERATOR_STATE,
      ...nextOperator,
      am: nextOperator.am ?? false,
    };
  }

  syncControlsFromState();
  operatorEnvelopeView.invalidate();
  updateTfiSummary();
  renderAlgorithmDiagram();
  drawEnvelopeGuide();

  if (synth) {
    applyPatchToVoices();
  }
  updateLooperUi();
  updateEventRecordUi();
}

function buildCurrentPresetState() {
  const preset = {
    algorithm:
      commonState.algorithm,
    feedback:
      commonState.feedback,
    ams: commonState.ams,
    pms: commonState.pms,
    pan: {...currentPresetPan},
    b4: (currentPresetB4 & 0x08) | (currentPresetPan.left ? 0x80 : 0) | (currentPresetPan.right ? 0x40 : 0) | (commonState.ams << 4) | commonState.pms,
    lfo: {
      enabled:
        commonState.lfoEnabled,
      frequency:
        commonState.lfoFrequency,
    },
    operators: {},
  };
  if(currentPerformanceVoice)preset.capturedVoice={keyMask:currentPerformanceVoice.keyMask,
    specialMode:channel3SpecialState.enabled,
    specialFrequencies:channel3SpecialState.enabled?structuredClone(channel3SpecialState.frequencies):[]};

  for (const operator of OPERATOR_NUMBERS) {
    // TFI's preset encoder uses logical operator labels 1..4.
    preset.operators[operator] = {
      ...operatorStates[operator],
    };
  }

  return preset;
}

function buildCurrentInstrumentState() {
  return activeInstrumentKind==='pcm'?pcmVoice.getPreset():activeInstrumentKind === 'psg' ? createPsgPreset(psgVoice.getSettings()) : buildCurrentPresetState();
}

function buildLooperPatchSnapshot() {
  const modulation = modulationSettings(commonState, modulationWheelValue);
  return {
    algorithm:
      commonState.algorithm,
    feedback:
      commonState.feedback,
    ams: commonState.ams,
    pms: modulation.pms,
    lfoEnabled:
      modulation.lfoEnabled,
    lfoFrequency:
      modulation.lfoFrequency,
    dacEnabled:
      commonState.dacEnabled,
    pan: {...currentPresetPan},
    capturedVoice:getCurrentPerformanceVoice()?structuredClone(getCurrentPerformanceVoice()):null,
    operators: [
      {
        ...operatorStates[1],
      },
      {
        ...operatorStates[2],
      },
      {
        ...operatorStates[3],
      },
      {
        ...operatorStates[4],
      },
    ],
  };
}

function applyLooperPatchToChannel(
  patch,
  channel
) {
  applySynthLooperPatch(loopSynth,patch,channel);
}

function createTfiExportName() {
  const baseName =
    importedTfiName
      ? importedTfiName.replace(/\.(tfi|vgi)$/i, "")
      : currentPresetName ===
          "custom"
        ? "ym2612-custom"
        : currentPresetName;

  return `${baseName}.tfi`;
}

function createVgiExportName() {
  return createTfiExportName().replace(/\.tfi$/i, ".vgi");
}

function renderAlgorithmDiagram() {
  if (!envelopeDescription) {
    return;
  }

  const view = songLiveView?.snapshot.channels[songLiveView.channel].preset ?? commonState;
  const algorithm = view.algorithm;
  const feedback = view.feedback;
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
  // Envelope redraws only for edits or incoming RMS batches, on one canvas.
  if(editorChip==='pcm') {
    if(pcmControls.getVisualMode()==='sample')pcmControls.drawSample();
    else outputVisualizer.draw(pcmControls.canvas,pcmControls.canvas.getContext('2d'),pcmControls.getVisualMode());
    return;
  }
  if (editorChip === 'psg') {
    outputVisualizer.draw(psgControls.canvas, psgControls.canvas.getContext('2d'), psgControls.getVisualMode());
    return;
  }
  if (editorChip !== 'ym2612' || visualMode === 'envelope') return;
  outputVisualizer.draw(envelopeCanvas, envelopeContext, visualMode);
}

function renderChannel3SpecialMonitor() {
  if (
    !channel3SpecialMonitor ||
    !channel3SpecialModePill
  ) {
    return;
  }

  if (songLiveView) {
    channel3SpecialModePill.textContent = songLiveView.snapshot.channels[2].specialMode ? 'Special On' : 'Special Off';
    syncChannel3SpecialControls();
    return;
  }
  if(currentPerformanceVoice||channel3SpecialState.enabled||megaSynth?.isRecordingPlaybackActive()) {
    channel3SpecialModePill.textContent=channel3SpecialState.enabled?'Special On':'Special Off';
    syncChannel3SpecialControls();
    return;
  }

  if (!synth) {
    channel3SpecialModePill.textContent =
      "Special Off";
    return;
  }

  const state = synth.getState?.();
  const channel =
    state?.channels?.[2];
  const specialFrequencies =
    channel?.specialFrequencies ??
    [];
  const specialMode =
    channel?.specialMode === true;

  channel3SpecialModePill.textContent =
    specialMode
      ? "Special On"
      : "Special Off";

  for (
    let operator = 0;
    operator < 4;
    operator += 1
  ) {
    const entry =
      specialFrequencies[operator] ??
      {
        block: 0,
        fnum: 0,
      };
    channel3SpecialState
      .frequencies[operator] = {
      block: entry.block,
      fnum: entry.fnum,
    };
  }
  syncChannel3SpecialControls();
}

function syncChannel3SpecialControls() {
  const live = songLiveView?.snapshot.channels[2];
  const enabled = live ? live.specialMode : channel3SpecialState.enabled;
  const frequencies = live ? live.specialFrequencies : channel3SpecialState.frequencies;
  channel3SpecialControls
    .get("enabled")
    ?.updateVisual(
      enabled
    );

  for (
    let operator = 0;
    operator < 4;
    operator += 1
  ) {
    const frequency =
      frequencies[operator];
    channel3SpecialControls
      .get(`op${operator}-block`)
      ?.updateVisual(
        frequency.block
      );
    channel3SpecialControls
      .get(`op${operator}-fnum`)
      ?.updateVisual(
        frequency.fnum
      );
  }
}

function buildChannel3SpecialControls() {
  if (!channel3SpecialControlsRoot) {
    return;
  }

  channel3SpecialControlsRoot.innerHTML =
    "";
  channel3SpecialControlsRoot.className =
    "special-control-strip";

  const modeControl =
    createParamControl({
      label: "MODE",
      min: 0,
      max: 1,
      step: 1,
      booleanMode: true,
      category: "modulation",
      value:
        channel3SpecialState.enabled,
      onChange: (nextValue) => {
        if (songLiveView) return;
        if(nextValue&&!channel3SpecialState.frequencies[3].fnum) {
          syncChannel3SpecialControls();
          setStatus('Set an OP4 base frequency above zero before enabling CH3 keyboard mode.');
          return;
        }
        stopAllNotes();
        channel3SpecialState.enabled =
          Boolean(nextValue);
        if (synth) {
          synth.setChannel3SpecialMode(
            channel3SpecialState.enabled
          );
        }
        renderChannel3SpecialMonitor();
        if(currentPerformanceVoice){markPresetEdited();updateLooperUi();updateEventRecordUi();}
      },
    });
  channel3SpecialControls.set(
    "enabled",
    modeControl
  );
  channel3SpecialControlsRoot.appendChild(
    modeControl.element
  );

  for (
    let operator = 0;
    operator < 4;
    operator += 1
  ) {
    const blockControl =
      createParamControl({
        label: `OP${operator + 1}B`,
        min: 0,
        max: 7,
        step: 1,
        category: "pitch",
        value:
          channel3SpecialState
            .frequencies[operator]
            .block,
        onChange: (nextValue) => {
          if (songLiveView) return;
          channel3SpecialState
            .frequencies[operator]
            .block = nextValue;
          if (synth) {
            synth.setChannel3SpecialFrequency(
              operator,
              channel3SpecialState
                .frequencies[operator]
                .block,
              channel3SpecialState
                .frequencies[operator]
                .fnum
            );
            if (operator === 3) {
              synth.setFrequency(
                2,
                channel3SpecialState
                  .frequencies[operator]
                  .block,
                channel3SpecialState
                  .frequencies[operator]
                  .fnum
              );
            }
          }
          renderChannel3SpecialMonitor();
          if(currentPerformanceVoice)markPresetEdited();
        },
      });
    channel3SpecialControls.set(
      `op${operator}-block`,
      blockControl
    );

    const fnumControl =
      createParamControl({
        label: `OP${operator + 1}F`,
        min: 0,
        max: 2047,
        step: 1,
        category: "pitch",
        value:
          channel3SpecialState
            .frequencies[operator]
            .fnum,
        onChange: (nextValue) => {
          if (songLiveView) return;
          if(channel3SpecialState.enabled&&operator===3&&!nextValue) {
            syncChannel3SpecialControls();
            setStatus('CH3 keyboard transposition needs an OP4 base frequency above zero.');
            return;
          }
          channel3SpecialState
            .frequencies[operator]
            .fnum = nextValue;
          if (synth) {
            synth.setChannel3SpecialFrequency(
              operator,
              channel3SpecialState
                .frequencies[operator]
                .block,
              channel3SpecialState
                .frequencies[operator]
                .fnum
            );
            if (operator === 3) {
              synth.setFrequency(
                2,
                channel3SpecialState
                  .frequencies[operator]
                  .block,
                channel3SpecialState
                  .frequencies[operator]
                  .fnum
              );
            }
          }
          renderChannel3SpecialMonitor();
          if(currentPerformanceVoice)markPresetEdited();
        },
      });
    channel3SpecialControls.set(
      `op${operator}-fnum`,
      fnumControl
    );

    channel3SpecialControlsRoot.appendChild(
      blockControl.element
    );
    channel3SpecialControlsRoot.appendChild(
      fnumControl.element
    );
  }
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
  renderChannel3SpecialMonitor();
  if (activeLooper()?.running) {
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
      if (songLiveView) return;
      commonState[id] = nextValue;
      if (id !== 'dacEnabled') markPresetEdited();
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
    gateControls: operatorGateControls,
    getOperatorEnabled: operator => Boolean((currentPerformanceVoice?.keyMask ?? 15) & (1 << (operator - 1))),
    onOperatorGateChange: setOperatorGate,
    onChange: (
      operator,
      id,
      nextValue
    ) => {
      applyOperatorParams(operator, {[id]: nextValue});
    },
  });
}

function syncOperatorGates() {
  // During Live observation show the actual current key bits, including all
  // Off between notes. lastKeyMask is only useful for copying/auditioning.
  const mask = songLiveView
    ? songLiveView.snapshot.channels[songLiveView.channel].keyMask
    : currentPerformanceVoice?.keyMask ?? 15;
  for (const [operator, button] of operatorGateControls) {
    const pressed = String(Boolean(mask & (1 << (operator - 1))));
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    button.disabled = Boolean(songLiveView);
  }
}

function setOperatorGate(operator, enabled) {
  if (songLiveView) return;
  const voice = getCurrentPerformanceVoice() ?? {keyMask:15, specialMode:false, specialFrequencies:[]};
  const bit = 1 << (operator - 1);
  const keyMask = enabled ? voice.keyMask | bit : voice.keyMask & ~bit;
  if (keyMask === voice.keyMask) return;
  // The optional sidecar field also describes authored OP selections. Keeping
  // its existing name preserves saved copied instruments and old Cassettes.
  currentPerformanceVoice = {...voice, keyMask};
  syncOperatorGates();
  markPresetEdited();
  if (!isSongChannelTarget()) {
    const target = getPlayableSynth();
    for (const held of voices) if (held.held) target?.setKeyMask(held.channel);
  }
}

// Numeric and graphical edits share persistence and update only this operator.
// Do not reset envelopes, re-key held notes, or rewrite channel frequencies.
function applyOperatorParams(operator, patch) {
  if (songLiveView) return;
  Object.assign(operatorStates[operator], patch);
  for (const [id, value] of Object.entries(patch)) operatorControls.get(operator)?.get(id)?.updateVisual(value);
  markPresetEdited();
  operatorEnvelopeView.invalidate();
  drawEnvelopeGuide();
  if (synth) {
    const apiOperator = displayOperatorToApiOperator(operator);
    for (let channel = 0; channel < VOICE_COUNT; channel++) synth.setOperator(channel, apiOperator, patch);
  }
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
  document.getElementById('octaveValue').textContent = `${keyboardOctave > 0 ? '+' : ''}${keyboardOctave}`;
  document.getElementById('octaveDown').disabled = keyboardOctave <= -2;
  document.getElementById('octaveUp').disabled = keyboardOctave >= 2;
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
  pcmVoice.stop();
  psgVoice.stop();
  if(looper?.recording)for(const voice of voices)if(voice.channel<6&&voice.held)looper.noteOff(voice.channel);
  songAuditionVoice?.noteOff(songAuditionVoice.channel);
  if (songAuditionBus) songAuditionBus.gain.value = 0;
  stopAllRuntimeNotes({
    synth,
    voices:voices.slice(0,VOICE_COUNT),
    heldKeys,
    activePointers,
    activeKeys,
    updateKeyboardVisuals,
    onCleared: () => {
      outputEnvelopeHeldVoicePeak = 1;
    },
  });
  clearInputState();
}

function getPlayableSynth() {
  if (isSongChannelTarget()) return songAuditionVoice;
  if(editorChip==='pcm')return pcmVoice.isReady()?pcmVoice:null;
  if (editorChip === 'psg') return psgAudio.getPsg() ? psgVoice : null;
  if (looper?.running) {
    return looper;
  }

  return getEditorPlayableSynth();
}

// OP gates and CH3 pitch ratios share the keyboard and recording path.
// The existing parameter controls still program the chip directly.
function getEditorPlayableSynth() {
  return synth?editorPerformanceTarget:null;
}

async function ensureLooper() {
  const chip=editorChip;
  await ensureAudioReady();

  if(chip==='psg') {
    await psgLoopAudio.prepare(audioContext,finalOutputBus);
    if(!psgLooper)psgLooper=new SynthPsgLooper({
      now:()=>audioContext.currentTime,
      getSettings:()=>psgVoice.getSettings(),
      getPitchClock:()=>synth?.clock??YM2612_CLOCK,
      releaseLiveNotes() {
        for(const channel of psgVoice.getState().heldChannels)psgVoice.noteOff(channel);
        if(editorChip==='psg')clearInputState();
      },
      renderRecording:(recording,{signal})=>renderSynthPsgLoop(recording,{sampleRate:audioContext.sampleRate,signal}),
      async preparePlaybackUnit(unit,{loopLength,signal}) {
        const {id,left,right,offsetSeconds}=unit;
        const prepared=await psgLoopAudio.getPsg().prepareLooperUnit({id,left,right,offsetSeconds},{loopLength,signal});
        signal.throwIfAborted();psgPreparedLoopUnits.set(unit,prepared);
      },
      startPlayback(configuration,units) {
        configuration.signal?.throwIfAborted();
        const api=psgLoopAudio.getPsg();
        psgLoopAudio.setEnabled(editorChip==='psg');
        psgLoopSession=api.startLooper({loopLength:configuration.loopLength,startTime:configuration.startTime});
        for(const unit of units)api.addPreparedLooperUnit(psgLoopSession,psgPreparedLoopUnits.get(unit));
      },
      addPlaybackUnit:(unit,{signal}={})=>{
        signal?.throwIfAborted();
        return psgLoopAudio.getPsg()?.addPreparedLooperUnit(psgLoopSession,psgPreparedLoopUnits.get(unit));
      },
      removePlaybackUnit:unit=>psgLoopSession===null?undefined:psgLoopAudio.getPsg()?.removeLooperUnit(psgLoopSession,unit.id),
      stopPlayback() {psgLoopAudio.getPsg()?.stopLooperPlayback();psgLoopSession=null;},
      onStateChange:handleLooperStateChange,
    });
    updateLooperUi();return psgLooper;
  }

  if (!megaSynth || !loopMegaSynth) {
    return null;
  }

  if (!looper) {
    looper = new SynthLooper({
      synth: loopMegaSynth,
      now: () =>
        audioContext.currentTime,
      liveTarget: editorPerformanceTarget,
      playbackTarget: loopPerformanceTarget,
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
  if(recordingBlocked())return;
  const epoch=recordingEpoch,chip=editorChip;
  if (!activeLooper()?.running) {
    const source=eventRecordingSource();
    if (source?.isRecording()) {
      stopAllNotes();
      source.stopRecord();
    }
    source?.stopRecordingPlayback();
    eventRecordSessionActive = false;
    updateEventRecordUi();
  }

  const currentLooper =
    await ensureLooper();
  if(!recordingOperationCurrent(epoch,chip))return;

  if (!currentLooper) {
    return;
  }

  if (currentLooper.running) {
    updateLooperUi();
    updateEventRecordUi();
    setStatus("Stopping looper...");
    await currentLooper.stop();
    updateLooperUi();
    updateEventRecordUi();
    stopAllNotes();
    setStatus("Looper stopped.");
    return;
  }

  const starting=currentLooper.start();
  updateLooperUi();await starting;
  if(!recordingOperationCurrent(epoch,chip)){await currentLooper.stop();return;}
  if(!currentLooper.running)return;
  updateLooperUi();
  updateEventRecordUi();
  setStatus(
    "Looper started. Press Record [Space] to capture a unit."
  );
}

async function toggleLooperRecord() {
  if(recordingBlocked())return;
  const epoch=recordingEpoch,chip=editorChip;
  const currentLooper =
    await ensureLooper();
  if(!recordingOperationCurrent(epoch,chip))return;

  if (!currentLooper) {
    return;
  }

  if (!currentLooper.running) {
    setStatus(
      "Start the looper first."
    );
    return;
  }
  if(currentLooper.getState().busy)return;

  const wasRecording =
    currentLooper.recording;
  if(wasRecording)releaseEventTakeKeys();
  const pendingToggle =
    currentLooper.toggleRecord();
  updateLooperUi();
  if(chip!=='psg'||currentLooper.getState().busy||currentLooper.recording)setStatus(
    wasRecording ? "Finalizing take..." : "Recording started. Press Space again to stop."
  );
  const completedUnit =
    await pendingToggle;
  if(!recordingOperationCurrent(epoch,chip))return;
  updateLooperUi();
  if(chip==='psg'&&!completedUnit&&!currentLooper.recording)return;

  if (wasRecording) {
    if (completedUnit) {
      setStatus(
        `Recorded ${completedUnit.id}.`
      );
    } else if(chip!=='psg') {
      setStatus(
        "Recording finished."
      );
    }
  } else {
    setStatus(
      "Recording started. Press Space again to stop."
    );
  }
}

async function undoLooper() {
  const looper=activeLooper(),epoch=recordingEpoch,chip=editorChip;
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
  if(!recordingOperationCurrent(epoch,chip))return;
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
  const looper=activeLooper(),epoch=recordingEpoch,chip=editorChip;
  if (!looper) {
    return;
  }

  void looper.clear().then(() => {
    if(!recordingOperationCurrent(epoch,chip))return;
    updateLooperUi();
    stopAllNotes();
    setStatus("Looper cleared.");
  }).catch(error=>setStatus(`Unable to clear loop: ${error.message}`));
}

function togglePrimaryRecordAction() {
  if (eventRecordSessionActive) {
    if(eventRecordingBlocked()) {setStatus('Pause or Stop the VGM and choose Synth to record your instrument.');return;}
    void toggleEventTakeRecording();
    return;
  }
  if(recordingBlocked()) {
    setStatus(recordingUnavailableReason());
    return;
  }
  void runLooperAction(toggleLooperRecord);
}

async function initializeDirectAudio() {
  updateKeyboardAvailability();

  if (!finalOutputBus) {
    finalOutputBus = audioContext.createGain();
    finalOutputBus.connect(audioContext.destination);
  }

  liveOutputBus =
    audioContext.createGain();
  liveOutputBus.connect(
    finalOutputBus
  );

  const runtime =
    await initializeDirectAudioRuntime({
      audioContext,
      workletUrl: activeWorkletUrl,
      ym2612WasmUrl:
        activeYm2612WasmUrl,
      outputNode:
        liveOutputBus,
      setStatus,
    });

  megaSynth = runtime.megaSynth;
  synth = runtime.synth;
  megaSynth.recordingManager=new SynthRecordingManager({synth,now:()=>audioContext.currentTime,
    onPlaybackStopped:restoreEditorAfterEventPlayback});
  applyMasterVolume();
  setupLooperCaptureTap();
  loopOutputBus =
    audioContext.createGain();
  loopOutputBus.connect(
    finalOutputBus
  );
  const loopRuntime =
    await initializeDirectAudioRuntime({
      audioContext,
      workletUrl: activeWorkletUrl,
      ym2612WasmUrl:
        activeYm2612WasmUrl,
      outputNode:
        loopOutputBus,
      setStatus,
    });

  loopMegaSynth =
    loopRuntime.megaSynth;
  loopSynth =
    loopRuntime.synth;
  applyMasterVolume();
  looper = new SynthLooper({
    synth: loopMegaSynth,
    now: () =>
      audioContext.currentTime,
    liveTarget: editorPerformanceTarget,
    playbackTarget: loopPerformanceTarget,
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
  megaSynth.setOutputEnvelopeOptions({enabled: visualMode === 'envelope'});
  outputVisualizer.connect(audioContext, [finalOutputBus]);

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

async function ensureAudioReady({announce=true}={}) {
  if (!audioContext) {
    audioContext =
      new AudioContext({
        sampleRate:
          YM2612_NATIVE_SAMPLE_RATE,
      });
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
  if (editorChip === 'psg') {
    const pending = psgAudio.prepare(audioContext, finalOutputBus);
    updateKeyboardAvailability();
    try {
      await pending;
      if (announce && editorChip === 'psg') setStatus('Audio ready. Sega PSG · Tone / Noise.');
    } finally {updateKeyboardAvailability();}
  }
  if(editorChip==='pcm') {
    const pcm=await pcmAudio.prepare(audioContext,finalOutputBus);
    updateKeyboardAvailability();
    try {
      while(editorChip==='pcm'&&!pcmVoice.isReady()) {
        if(pcmAudio.getPcm()!==pcm)return;
        await pcmVoice.install(pcm);
      }
      if(announce&&editorChip==='pcm'&&pcmVoice.isReady())setStatus('Audio ready. Mega CD PCM · RF5C164.');
    } finally {updateKeyboardAvailability();}
  }

}

function buildKeyboard() {
  buildKeyboardView({
    root: keyboard,
    rowDefs:
      fretboardLayout.rowDefs,
    layoutEntries:
      fretboardLayout.entries,
    showPitch:editorChip !== 'psg',
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

  for (const presetName of FM_PRESET_ORDER) {
    const preset =
      FM_PRESETS[
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
      const next = presetSelect.value;
      if (synthFiles) {
        void synthFiles.selectPreset(next).then(() => {presetSelect.value=currentPresetName; presetSelect.blur();});
      } else if (next !== 'custom') {
        stopAllNotes(); applyPresetState(next); presetSelect.blur();
      }
    }
  );

  presetSelect.value =
    currentPresetName;
}

function markPresetEdited() {
  if (!synthFiles?.activeTonePath) currentPresetName = 'custom';
  if (presetSelect) presetSelect.value = currentPresetName;
  synthFiles?.markDirty();
}

function syncFilePresetOptions() {
  for (const [select, kind] of [[presetSelect,'fm'], [psgPresetSelect,'psg'], [pcmPresetSelect,'pcm']]) {
    for (const group of select.querySelectorAll('[data-file-presets]')) group.remove();
    const groups = new Map();
    for (const file of synthProject.listTones()) {
      if ((isPcmTonePath(file.path)?'pcm':isPsgTonePath(file.path)?'psg':'fm')!==kind) continue;
      const directory = file.path.slice(0, file.path.lastIndexOf('/'));
      if (!groups.has(directory)) {
        const group = document.createElement('optgroup');
        group.label = directory.slice(1);
        group.dataset.filePresets = '';
        groups.set(directory, group);
      }
      const option = document.createElement('option');
      option.value = 'vfs:' + file.path;
      option.textContent = file.path.split('/').pop();
      groups.get(directory).append(option);
    }
    const first = select.firstChild;
    for (const group of groups.values()) select.insertBefore(group, first);
    select.value = kind==='pcm'?currentPcmPresetName:kind==='psg'?currentPsgPresetName:currentPresetName;
  }
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

function buildVgiExporter() {
  if (!exportVgiButton) return;
  exportVgiButton.addEventListener("click", () => {
    try {
      const preset = buildCurrentPresetState();
      const bytes = createVgiFromPreset(preset);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = createVgiExportName();
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${anchor.download}.`);
    } catch (error) {
      setStatus(`Failed to export VGI: ${error.message}`);
    }
  });
}

for (const [id, delta] of [['octaveDown', -1], ['octaveUp', 1]]) {
  document.getElementById(id).addEventListener('click', () => {
    stopAllNotes();
    keyboardOctave = Math.max(-2, Math.min(2, keyboardOctave + delta));
    rebuildFretboardLayout();
    buildKeyboard();
    updateKeyboardVisuals();
    renderFretboardUi();
  });
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
      () => editorChip==='pcm'?pcmAudio.isPreparing():editorChip === 'psg' ? psgAudio.isPreparing() : audioReadyPromise,
    getPitchBend: () => pitchBendSemitones,
    isInputEnabled: isPerformanceInputEnabled,
    getSynth: () =>
      getPlayableSynth(),
    ensureAudioReady,
    chooseVoice: available => isSongChannelTarget() ? available[songAuditionVoice?.channel]
      : editorChip==='pcm'?chooseVoice(available)
      : editorChip === 'psg' ? chooseVoice(available.filter(voice => psgVoice.getChannels().includes(voice.channel)))
      : channel3SpecialState.enabled?available[2]:chooseVoice(available.filter(voice=>voice.channel<VOICE_COUNT)),
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
setupSynthMenu({document, window});

buildCommonHeader();
buildCommonControls();
buildOperatorHeader();
buildOperatorControls();
buildChannel3SpecialControls();
// Resolve value nodes once. Live updates read the already-decoded snapshot;
// they do not query the DOM, scan text, or measure layout to find differences.
const highlightBindings=[];
const bindHighlight=(control,read)=>{
  const element=control?.element.querySelector('.param-value');
  if(element)highlightBindings.push({element,read});
};
for(const {id} of COMMON_PARAM_DEFS)bindHighlight(commonControls.get(id),view=>{
  if(id==='lfoEnabled')return view.snapshot.lfo.enabled;
  if(id==='lfoFrequency')return view.snapshot.lfo.frequency;
  if(id==='dacEnabled')return view.snapshot.dacEnabled;
  return view.snapshot.channels[view.channel].preset[id];
});
for(const operator of OPERATOR_NUMBERS)for(const {id} of OPERATOR_PARAM_DEFS) {
  bindHighlight(operatorControls.get(operator)?.get(id),view=>view.snapshot.channels[view.channel].preset.operators[operator][id]);
}
bindHighlight(channel3SpecialControls.get('enabled'),view=>view.snapshot.channels[2].specialMode);
for(let operator=0;operator<4;operator++)for(const field of ['block','fnum']) {
  bindHighlight(channel3SpecialControls.get(`op${operator}-${field}`),view=>view.snapshot.channels[2].specialFrequencies[operator][field]);
}
liveHighlighter=createSynthLiveHighlighter({controls:highlightBindings,enabled:songHighlightToggle.checked});
psgLiveHighlighter=createSynthLiveHighlighter({enabled:songHighlightToggle.checked,controls:[
  ['source',document.querySelector('[data-psg-source]').parentElement],
  ['attenuation',document.getElementById('synthPsgAttenuation')],
  ['noiseType',document.querySelector('[data-psg-noise-type]').parentElement],
  ['noiseRate',document.querySelector('[data-psg-noise-rate]').parentElement],
].map(([field,element])=>({element,read:view=>view.snapshot.channels[view.channel].preset[field]}))});
buildPresetSelect();
buildTfiExporter();
buildVgiExporter();
psgPresetSelect.addEventListener('change', () => {
  void synthFiles.selectPreset(psgPresetSelect.value).finally(() => {
    psgPresetSelect.value = currentPsgPresetName;
    psgPresetSelect.blur();
  });
});
pcmPresetSelect.addEventListener('change',()=>{
  void synthFiles.selectPreset(pcmPresetSelect.value).finally(()=>{pcmPresetSelect.value=currentPcmPresetName;pcmPresetSelect.blur();});
});
exportPcmButton.addEventListener('click',()=>{
  if(activeInstrumentKind!=='pcm'||isSongChannelTarget())return;
  const url=URL.createObjectURL(new Blob([serializePcmPreset(pcmVoice.getPreset())],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;
  anchor.download=currentPcmPresetName.startsWith('vfs:')?currentPcmPresetName.split('/').pop():'instrument.pcm.json';
  document.body.append(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);setStatus('Exported PCM instrument.');
});
exportPsgButton.addEventListener('click', () => {
  if (activeInstrumentKind !== 'psg' || isSongChannelTarget()) return;
  const text = serializePsgPreset(createPsgPreset(psgVoice.getSettings()));
  const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = currentPsgPresetName.startsWith('vfs:') ? currentPsgPresetName.split('/').pop() : 'instrument.psg.json';
  document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  setStatus('Exported PSG instrument.');
});
looperStartButton?.addEventListener(
  "click",
  () => {
    void runLooperAction(toggleLooperStart);
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
    void runLooperAction(undoLooper);
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
synthFiles = setupSynthFiles({
  project:synthProject,
  getPreset:buildCurrentInstrumentState,
  getPresetId:()=>activeInstrumentKind==='pcm'?currentPcmPresetName:activeInstrumentKind === 'psg' ? currentPsgPresetName : currentPresetName,
  getEditorKind:()=>activeInstrumentKind,
  setEditorKind(kind) {
    activeInstrumentKind = kind;
    selectEditorChip(editorButtonForKind(kind));
    if(kind!=='pcm')songControls?.selectChip(kind === 'psg' ? 'psg' : 'ym2612');
  },
  getDefaultPresetId:kind=>kind==='pcm'?'pcm-sine':kind === 'psg' ? 'psg-default' : 'one-op-basic',
  applyPreset:applyPresetState,
  applySnapshot:applyPresetData,
  onSaved(path) {
    if(isPcmTonePath(path)) {
      currentPcmPresetName='vfs:'+path;pcmPresetSelect.value=currentPcmPresetName;
    } else if (isPsgTonePath(path)) {
      currentPsgPresetName = 'vfs:' + path;
      psgPresetSelect.value = currentPsgPresetName;
    } else {
      currentPresetName='vfs:'+path;
      importedTfiName=path.split('/').pop();
      presetSelect.value=currentPresetName;
    }
    updateTfiSummary();
  },
  onListChanged:syncFilePresetOptions,
  onWorkspaceReplaced:()=>songControls?.reset(),
  isObserving:isSongChannelTarget,
  stopAllNotes,
  setStatus,
});
songControls = setupSynthSongControls({
  project:synthProject,
  getAudio:async()=>{
    await ensureAudioReady();
    await referenceRecordingStop;
    return {context:audioContext, output:finalOutputBus};
  },
  beforeResume:stopRecordingForReference,
  getVolume:()=>masterVolume,
  onFileSelected:path=>synthFiles.selectFile(path),
  onLiveView:setSongLiveView,
  onTargetState:state => {
    if (state.target !== 'synth' && ['loading','playing','paused','seeking'].includes(state.playback)) {
      const chip = state.chip === 'psg' ? 'psg' : 'ym2612';
      if (editorChip !== chip) selectEditorChip(document.getElementById(chip==='psg'?'synthChipTabPsg':'synthChipTabYm2612'));
    }
    setSongTargetState(state);
  },
  async onCopyToSynth(preset,name) {
    const copied = await synthFiles.createFromPreset(preset,name);
    // Copy auditions an FM instrument. OP metadata on an ordinary saved tone
    // must not otherwise change the chip-wide DAC switch when it is opened.
    if (copied && !isPsgPreset(preset) && !isPcmPreset(preset)) {
      commonState.dacEnabled = false;
      synth?.setDacEnabled(false);
      loopSynth?.setDacEnabled(false);
      syncControlsFromState();
    }
    return copied;
  },
  onStatus:setStatus,
});
window.addEventListener('pagehide',event=>{
  stopAllNotes();
  void stopRecordingForReference();
  if(event.persisted)songControls.stop();
  else {
    songControls.dispose();
    liveHighlighter.dispose();
    psgLiveHighlighter.dispose();
    psgControls.dispose();
    pcmControls.dispose();pcmAudio.dispose();
    psgAudio.dispose();
    psgEventAudio.dispose();
    psgLoopAudio.dispose();
    ++songAuditionGeneration;
    if (songAuditionBus) songAuditionBus.gain.value = 0;
    void songAuditionMegaSynth?.close();
    songAuditionBus?.disconnect();
  }
});
updateKeyboardAvailability();
updateMasterVolumeUi();

// A desktop output adapter observes/reroutes this final bus. Chip rendering,
// analyser branches and the looper's live capture remain in the Web Audio graph.
if (window.__TAURI_INTERNALS__) {
  Object.defineProperty(window, 'tetoricaSynthAudio', {
    value: Object.freeze({
      setSwitching(value) {
        switchingAudioOutput = value === true;
        if(switchingAudioOutput)void stopRecordingForReference();
        updateKeyboardAvailability();updateLooperUi();updateEventRecordUi();
      },
      async ensureReady() {
        await ensureAudioReady();
        return {context: audioContext, output: finalOutputBus};
      },
      async stopPlayback() {
        songControls?.stop();
        await stopRecordingForReference();
        stopAllNotes();
        // Key-off alone can leave a long release tail playing after switching.
        synth?.reset();
        loopSynth?.reset();
        applyPatchToVoices();
        updateLooperUi();
        updateEventRecordUi();
      },
    }),
  });
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
masterVolumeRange?.addEventListener(
  "input",
  () => {
    masterVolume =
      Number(masterVolumeRange.value) /
      100;
    updateMasterVolumeUi();
    applyMasterVolume();
  }
);
updateLooperUi();
updateEventRecordUi();
