import {updateNoteishHtml, updateNoteishGraph} from './noteish_dom.js';
import {mountCommandEditor} from './command_editor.js';
import {createMsxNoteMonitor, describeMsxNotes, observeMsxNotes} from './msx_notes.js';
import {createHuc6280Monitor,applyHuc6280Write,describeHuc6280Notes,extractHuc6280Notes} from './huc6280_notes.js';
import {isOpl,createOplMonitor,applyOplWrite,describeOplNotes} from './opl_notes.js';
import {mountOplMonitor} from './opl_monitor.js';
import {mountScoreGroups,getScoreGroups} from './score_group_ui.js';
import {createOpl3Monitor,applyOpl3Write,describeOpl3Notes} from './ymf262_notes.js';
import {createNesMonitor,applyNesWrite,describeNesNotes} from './nes_notes.js';
import {createDefaultTfiPreset, findOperatorFromSlotOffset, cloneTfiPreset, presetSignature, decodeKeyOnChannel, extractTfiPatchesFromVgm} from './tfi_extract.js';
import {createStoredZipBytes} from './stored_zip.js';
import { createPlaybackEngine, selectPlaybackConfiguration, detectPlaybackChipKindFromVgm, detectPlaybackChipKind } from './playback_core.js?v=scc-plus-1';
import { mountMusicSheet } from "./music_sheet.js?v=tab-1";
import { renderVgmToWav } from "./vgm_wav.js";
import { createExportTempoSettings } from "./export_tempo.js";
import { analyzeLilyPondSource as analyzeScoreSource, exportLilyPondAnalysis } from "./analyzer_core.js?v=scc-plus-1";
import {createOpmTfiFiles,OPM_TFI_NOTICE} from './opm_tfi.js';
import {mountOpmInfo} from './opm_info.js?v=keyboard-layout-2';
import {exportMxdrvMml} from './opm_mml.js';
import {exportOpm, extractOpmPatches} from './opm_export.js?v=clock-1';
import {createOpmNoteTracker} from './opm_notes.js';
import {mountOpmMonitor, observeOpmEngine} from './opm_monitor.js?v=export-2';
import { msxMuteControls, applyMsxMute } from './msx_mutes.js';
import {mountAy8910Monitor} from './ay8910_monitor.js?v=common-mutes-1';
import {mountYm2413Monitor} from './ym2413_monitor.js';
import { mountTfiInfo } from "./tfi_info.js?v=concurrent-audition-1";
import { mountSampleExplorer } from './sample_explorer.js?v=pwm-capture-1';
import { renderAllFretboard } from './fretboard_all.js';
import { createNoteTimeline } from './note_timeline_view.js?v=opm-notes-1';
import { seekPlayback } from './seek_playback.js';
import { timelinePlaybackPosition } from './note_timeline.js';
import { describeToneNotes } from './tone_notes.js?v=ym2610-vgm-2';
import { createGameboyMonitor, applyGameboyWrite, describeGameboyNotes } from './gameboy_notes.js';
import { midiChipKind } from "./vgm_notes.js?v=ym2610-vgm-2";
import { renderFretboard, FRET_TRAIL_MS, createFretboardTracker } from "./fretboard.js?v=hand-position-2";
import { exportAnalysisMidi } from "./analyzer_core.js?v=scc-plus-1";
import { createRf5c164Monitor, describeRf5c164Monitor, observeRf5c164Engine } from "./rf5c164_monitor.js";
import { sourcesForChip, applySourceMutes, allSourcesMuted } from "./source_mutes.js?v=msx-mix-1";
import { createPsgMonitor, describePsgMonitor, observePsgEngine, applySsgWrite } from "./psg_monitor.js?v=ym2610-vgm-2";
import { exportMucomMml, exportOpnavoidMml } from "./vgm_mml.js?v=mml-formats-1";
import { exportMgsdrvMml } from "./mgsdrv_mml.js";
import {
  Ym2612VGM,
} from "../js/ym2612vgm.js?v=dac-warning-1";
import { createTfiFromPreset } from "../js/tfi.js";
import { createVgiFromPreset } from "../js/vgi.js";
import ym2612ModuleFactory from "../generated/ym2612_wasm.js";
import nukedOpn2ModuleFactory from "../generated/nuked_opn2_wasm.js";
import segaPsgModuleFactory from "../generated/segapsg_wasm.js";
import { VgmPlayer } from "../js/vgmplayer.js?v=dac-warning-1";
import { looksLikeS98, convertS98ToVgm } from "../js/s98_file.js";
import { maybeDecodeVgmFile, parseVgmMetadata, VGM_METADATA_FIELDS } from "../js/vgm_file.js";

// Experimental: ?engine=nuked swaps the YM2612 core for Nuked-OPN2
// (https://github.com/nukeykt/Nuked-OPN2) instead of the default ymfm
// backend. Same web/ym2612.js and web/ym2612synth.js code either way.
const useNukedEngine =
  new URLSearchParams(window.location.search).get("engine") ===
  "nuked";
const activeYm2612ModuleFactory = useNukedEngine
  ? nukedOpn2ModuleFactory
  : ym2612ModuleFactory;

if (useNukedEngine) {
  const pageTitle = document.getElementById("pageTitle");
  const badge = document.createElement("span");
  badge.className = "engine-badge";
  badge.textContent = "Nuked-OPN2 engine";
  pageTitle?.appendChild(badge);
}

const fileInput = document.getElementById("fileInput");
const playlistList = document.getElementById("playlistList");
const playlistSummary = document.getElementById("playlistSummary");
const detectedChipsOutput = document.getElementById("detectedChips");
const romFileStatus = document.getElementById("romFileStatus");
const playButton = document.getElementById("playButton");
const playbackSeek = document.getElementById("playbackSeek");
const playbackSeekTime = document.getElementById("playbackSeekTime");
const inlinePlaybackSeek = document.getElementById("inlinePlaybackSeek");
const inlinePlaybackSeekTime = document.getElementById("inlinePlaybackSeekTime");
let seekSelection = null;
let seekDragging = false;

function renderSeekPosition(sample) {
  const duration = Number(playbackSeek.max);
  const position = Math.max(0, Math.min(duration, sample || 0));
  playbackSeek.value = String(position);
  const time = value => {
    const seconds = Math.floor(value / 44100);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  playbackSeekTime.textContent = `${time(position)} / ${time(duration)}`;
  playbackSeek.setAttribute("aria-valuetext", playbackSeekTime.textContent);
  inlinePlaybackSeek.max = playbackSeek.max;
  inlinePlaybackSeek.value = playbackSeek.value;
  inlinePlaybackSeekTime.textContent = playbackSeekTime.textContent;
  inlinePlaybackSeek.setAttribute("aria-valuetext", playbackSeekTime.textContent);
}

function updateSeekPosition() {
  if (seekDragging || timelineSeekController) return;
  if (timelineSelectionPending) {
    renderSeekPosition(seekSelection ?? songTimeline.selected());
  } else if (player) {
    const queued = player.queuedFrames + (activeStream?.workletQueuedFrames ?? 0);
    const sample = Math.max(0, player.processedWaitSamples - queued * 44100 / player.sampleRate());
    renderSeekPosition(timelinePlaybackPosition(sample, Number(playbackSeek.max), noteishHeader?.loopSamples || 0, loopCheckbox.checked));
  }
}
const pauseButton = document.getElementById("pauseButton");
const replayButton = document.getElementById("replayButton");
const stopButton = document.getElementById("stopButton");
const loopCheckbox = document.getElementById("loopCheckbox");
const playlistLoopCheckbox = document.getElementById("playlistLoopCheckbox");
const playlistLoopControl = document.getElementById("playlistLoopControl");
const monitorToggles = document.getElementById("monitorToggles");
const inlineMonitorToggles = document.getElementById("inlineMonitorToggles");
const dockPlayTab = document.getElementById("dockPlayTab");
const dockEffectTab = document.getElementById("dockEffectTab");
const dockPlayPane = document.getElementById("dockPlayPane");
const dockEffectPane = document.getElementById("dockEffectPane");
const effectEnabled = document.getElementById("effectEnabled");
const effectControls = document.getElementById("effectControls");
const effectGain = document.getElementById("effectGain");
const effectBass = document.getElementById("effectBass");
const effectMiddle = document.getElementById("effectMiddle");
const effectTreble = document.getElementById("effectTreble");
const effectReverb = document.getElementById("effectReverb");
const effectCompressor = document.getElementById("effectCompressor");
const effectNoiseGate = document.getElementById("effectNoiseGate");

// Mirror controls share the existing playback handlers, including their error paths.
for (const [primary, mirror] of [
  [playButton, document.getElementById("inlinePlayButton")],
  [pauseButton, document.getElementById("inlinePauseButton")],
  [stopButton, document.getElementById("inlineStopButton")],
]) {
  const sync = () => { mirror.disabled = primary.disabled; mirror.textContent = primary.textContent; };
  new MutationObserver(sync).observe(primary, { attributes: true, attributeFilter: ["disabled"], childList: true, characterData: true, subtree: true });
  mirror.addEventListener("click", () => primary.click());
  sync();
}
new MutationObserver(() => {
  inlinePlaybackSeek.disabled = playbackSeek.disabled;
  inlinePlaybackSeek.max = playbackSeek.max;
}).observe(playbackSeek, { attributes: true, attributeFilter: ["disabled", "max"] });
for (const type of ["input", "change"]) {
  inlinePlaybackSeek.addEventListener(type, () => {
    playbackSeek.value = inlinePlaybackSeek.value;
    playbackSeek.dispatchEvent(new Event(type));
  });
}
const prefetchFactorSelect = document.getElementById("prefetchFactorSelect");
const workletQueueSelect = document.getElementById("workletQueueSelect");
const masterVolumeRange = document.getElementById("masterVolumeRange");
const masterVolumeValue = document.getElementById("masterVolumeValue");
const exportAllTfiButton = document.getElementById("exportAllTfiButton");
const exportAllVgiButton = document.getElementById("exportAllVgiButton");
let midiExportAvailable = false;
const exportAllOpmButton = document.getElementById('exportAllOpmButton');
const exportOpmButton = document.getElementById('exportOpmButton');
const exportLilyPondButton = document.getElementById("exportLilyPondButton");
const lilyPondExportDialog = document.getElementById("lilyPondExportDialog");
const lilyPondBpmInput = document.getElementById("lilyPondBpmInput");
const exportMidiButton = document.getElementById("exportMidiButton");
const exportMmlButton = document.getElementById("exportMmlButton");
const mmlBpmInput = document.getElementById("mmlBpmInput");
const mmlFormatDialog = document.getElementById("mmlFormatDialog");
const midiBpmInput = document.getElementById("midiBpmInput");
const midiExportDialog = document.getElementById("midiExportDialog");
const exportWavButton = document.getElementById("exportWavButton");
const wavExportDialog = document.getElementById("wavExportDialog");
const wavMaxSecondsInput = document.getElementById("wavMaxSecondsInput");
const wavExportStatus = document.getElementById("wavExportStatus");
const exportParseInfoButton = document.getElementById("exportParseInfoButton");
const exportSnapshotTfiButton = document.getElementById("exportSnapshotTfiButton");
const exportSnapshotVgiButton = document.getElementById("exportSnapshotVgiButton");
const exportSnapshotButton = document.getElementById("exportSnapshotButton");
const status = document.getElementById("status");
const channelGrid = document.getElementById("channelGrid");
const headerOutput = document.getElementById("headerOutput");
const metadataOutput = document.getElementById("metadataOutput");

function renderMetadata(metadata) {
  metadataOutput.replaceChildren();
  for (const [key, label] of VGM_METADATA_FIELDS) {
    if (!metadata?.[key]?.trim()) continue;
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = label;
    value.textContent = metadata[key];
    metadataOutput.append(term, value);
  }
  if (!metadataOutput.childElementCount) {
    metadataOutput.textContent = "No GD3 metadata available.";
  }
}
const commandUsageOutput = document.getElementById("commandUsageOutput");
const dataBlocksOutput = document.getElementById("dataBlocksOutput");
const specialCommandsOutput = document.getElementById("specialCommandsOutput");
const pcmRamWriteOutput = document.getElementById("pcmRamWriteOutput");
const command92ContextOutput = document.getElementById("command92ContextOutput");
const operatorInfoTab = document.getElementById("operatorInfoTab");
const parsedOutputTab = document.getElementById("parsedOutputTab");
const noteishTab = document.getElementById("noteishTab");
const operatorInfoPanel = document.getElementById("operatorInfoPanel");
const parsedOutputPanel = document.getElementById("parsedOutputPanel");
let musicSheet;
const sheetMusicTab = document.getElementById("sheetMusicTab");
const sheetMusicPanel = document.getElementById("sheetMusicPanel");
const noteishPanel = document.getElementById("noteishPanel");
const noteishOverview = document.getElementById("noteishOverview");
const noteishGrid = document.getElementById("noteishGrid");
const noteishMode = document.getElementById("noteishMode");
let noteishViewMode = "live";
const noteishInstrument = document.getElementById("noteishInstrument");
const fretboardStrings = document.getElementById("fretboardStrings");
const noteishDetailHelp = document.getElementById("noteishDetailHelp");
const notesDialog = document.getElementById("notesDialog");
const notesDialogTitle = document.getElementById("notesDialogTitle");
const notesDialogOutput = document.getElementById("notesDialogOutput");
const notesDialogCloseButton = document.getElementById("notesDialogCloseButton");

let currentBuffer = null;
const sampleTab = document.getElementById('sampleExplorerTab');
const samplePanel = document.getElementById('sampleExplorerPanel');
const sampleExplorer = mountSampleExplorer(samplePanel, () => currentBuffer);
sampleTab.addEventListener('click', () => setOutputTab('samples'));
let audioContext = null;
let engine = null;
let player = null;
let activeStream = null;
const effectSettings = { enabled: false, gain: 100, bass: 0, middle: 0, treble: 0, reverb: 0, compressor: 0, noiseGate: 0 };
let effectsChain = null;

// A short burst of white noise with an exponential decay makes a plausible
// synthetic room impulse response, so ConvolverNode-based reverb needs no
// external audio asset.
function createReverbImpulse(context, duration = 2, decay = 3) {
  const length = Math.max(1, Math.round(context.sampleRate * duration));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function setDockView(mode) {
  if (!['play', 'effect'].includes(mode)) return;
  dockPlayPane.hidden = mode !== 'play';
  dockEffectPane.hidden = mode !== 'effect';
  dockPlayTab.setAttribute('aria-pressed', String(mode === 'play'));
  dockEffectTab.setAttribute('aria-pressed', String(mode === 'effect'));
}
dockPlayTab.addEventListener('click', () => setDockView('play'));
dockEffectTab.addEventListener('click', () => setDockView('effect'));

// Textbook chain order: EQ -> Noise Gate -> Compressor -> time-based effects
// (Reverb) -> final output Gain. Gate ahead of Compressor keeps the noise
// floor from being lifted before it's gated; Reverb stays after the dynamics
// stage so the compressor reacts to the dry signal, not the reverb tail;
// Gain sits last as an overall output-level trim rather than an input drive.
function ensureEffectsChain(context) {
  if (effectsChain && effectsChain.context === context) return effectsChain;
  const bassNode = context.createBiquadFilter();
  bassNode.type = 'lowshelf';
  bassNode.frequency.value = 200;
  const middleNode = context.createBiquadFilter();
  middleNode.type = 'peaking';
  middleNode.frequency.value = 1000;
  middleNode.Q.value = 0.7;
  const trebleNode = context.createBiquadFilter();
  trebleNode.type = 'highshelf';
  trebleNode.frequency.value = 3000;

  const gateNode = context.createScriptProcessor(1024, 2, 2);
  const gateState = { envelope: 0, threshold: 0 };
  gateNode.onaudioprocess = (event) => {
    const inL = event.inputBuffer.getChannelData(0);
    const inR = event.inputBuffer.getChannelData(1);
    const outL = event.outputBuffer.getChannelData(0);
    const outR = event.outputBuffer.getChannelData(1);
    const attack = 0.3, release = 0.02;
    for (let i = 0; i < inL.length; i++) {
      const level = Math.max(Math.abs(inL[i]), Math.abs(inR[i]));
      gateState.envelope += (level - gateState.envelope) * (level > gateState.envelope ? attack : release);
      const gain = gateState.threshold <= 0 || gateState.envelope >= gateState.threshold
        ? 1 : gateState.envelope / gateState.threshold;
      outL[i] = inL[i] * gain;
      outR[i] = inR[i] * gain;
    }
  };

  const compressorNode = context.createDynamicsCompressor();

  const dryGain = context.createGain();
  const wetGain = context.createGain();
  const convolver = context.createConvolver();
  convolver.normalize = true;
  convolver.buffer = createReverbImpulse(context);
  const reverbOutput = context.createGain();

  const gainNode = context.createGain();
  const output = context.createGain();

  bassNode.connect(middleNode);
  middleNode.connect(trebleNode);
  trebleNode.connect(gateNode);
  gateNode.connect(compressorNode);
  compressorNode.connect(dryGain);
  compressorNode.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(reverbOutput);
  wetGain.connect(reverbOutput);
  reverbOutput.connect(gainNode);
  gainNode.connect(output);

  effectsChain = {
    context, input: bassNode, output, gainNode, bassNode, middleNode, trebleNode,
    dryGain, wetGain, compressorNode, gateState, gateNode, gateConnected: true,
  };
  applyEffectSettings();
  return effectsChain;
}

function applyEffectSettings() {
  if (!effectsChain) return;
  effectsChain.gainNode.gain.value = effectSettings.gain / 100;
  effectsChain.bassNode.gain.value = effectSettings.bass;
  effectsChain.middleNode.gain.value = effectSettings.middle;
  effectsChain.trebleNode.gain.value = effectSettings.treble;
  const reverb = effectSettings.reverb / 100;
  effectsChain.dryGain.gain.value = 1 - reverb * 0.3;
  effectsChain.wetGain.gain.value = reverb * 2.0;

  const compressorAmount = effectSettings.compressor / 100;
  effectsChain.compressorNode.threshold.value = -compressorAmount * 40;
  effectsChain.compressorNode.ratio.value = 1 + compressorAmount * 11;
  effectsChain.compressorNode.knee.value = 30;
  effectsChain.compressorNode.attack.value = 0.003;
  effectsChain.compressorNode.release.value = 0.25;

  effectsChain.gateState.threshold = (effectSettings.noiseGate / 100) * 0.1;
  const gateNeeded = effectSettings.noiseGate > 0;
  if (effectsChain.gateConnected !== gateNeeded) {
    effectsChain.trebleNode.disconnect();
    effectsChain.gateNode.disconnect();
    if (gateNeeded) {
      effectsChain.gateState.envelope = 0;
      effectsChain.trebleNode.connect(effectsChain.gateNode);
      effectsChain.gateNode.connect(effectsChain.compressorNode);
    } else {
      // A zero-strength gate must not route audio through the main thread.
      effectsChain.trebleNode.connect(effectsChain.compressorNode);
    }
    effectsChain.gateConnected = gateNeeded;
  }
}

// Rewires the currently active stream node between the effects chain and the
// destination. Effect stays off the graph entirely when disabled, so it never
// costs CPU or colors the signal for analysis-focused listening.
function rewireAudioGraph() {
  if (!activeStream || !audioContext) return;
  const node = activeStream.node;
  node.disconnect();
  if (effectSettings.enabled) {
    const chain = ensureEffectsChain(audioContext);
    chain.output.disconnect();
    node.connect(chain.input);
    chain.output.connect(audioContext.destination);
  } else {
    node.connect(audioContext.destination);
  }
}

function updateEffectValueOutputs() {
  document.getElementById('effectGainValue').textContent = `${effectSettings.gain}%`;
  document.getElementById('effectBassValue').textContent = `${effectSettings.bass} dB`;
  document.getElementById('effectMiddleValue').textContent = `${effectSettings.middle} dB`;
  document.getElementById('effectTrebleValue').textContent = `${effectSettings.treble} dB`;
  document.getElementById('effectReverbValue').textContent = `${effectSettings.reverb}%`;
  document.getElementById('effectCompressorValue').textContent = `${effectSettings.compressor}%`;
  document.getElementById('effectNoiseGateValue').textContent = `${effectSettings.noiseGate}%`;
}

function updateEffectEnabledUi() {
  effectEnabled.textContent = effectSettings.enabled ? 'Effect On' : 'Effect Off';
  effectEnabled.classList.toggle('is-muted', !effectSettings.enabled);
  effectEnabled.setAttribute('aria-pressed', String(effectSettings.enabled));
  // Keep the sliders visible (not hidden) but disabled while off, so the
  // saved settings stay legible without looking like they're being applied.
  for (const input of effectControls.querySelectorAll('input[type="range"]')) {
    input.disabled = !effectSettings.enabled;
  }
}
effectEnabled.addEventListener('click', () => {
  effectSettings.enabled = !effectSettings.enabled;
  updateEffectEnabledUi();
  rewireAudioGraph();
});
for (const [input, key] of [[effectGain, 'gain'], [effectBass, 'bass'], [effectMiddle, 'middle'], [effectTreble, 'treble'], [effectReverb, 'reverb'], [effectCompressor, 'compressor'], [effectNoiseGate, 'noiseGate']]) {
  input.addEventListener('input', () => {
    effectSettings[key] = Number(input.value);
    updateEffectValueOutputs();
    applyEffectSettings();
  });
}
updateEffectValueOutputs();
updateEffectEnabledUi();
let workletModuleReady = false;
let wavExportBusy = false;
let extractedTfiPatches = [];
let channelMuteStates = [false, false, false, false, false, false];
let currentChipKind = "ym2612";
let currentHasPcm = false;
let currentPcmClock = 0;
let pcmMonitor = createRf5c164Monitor();
let engineClockKey = null;
const sourceChipKind = () => noteishHeader?.pwmClock && currentChipKind === "ym2612" ? "32x" : currentHasPcm && currentChipKind === "ym2612" ? "megacd" : currentChipKind;
const hasOkiSource = () => Boolean(noteishHeader?.okim6258Clock);
let channelMonitor = createChannelMonitorState();
let monitorFrequencyHigh = [0, 0];
let psgMonitor = createPsgMonitor(currentChipKind);
let noteishHeader = {};
let toneChannels = [];
let apuNoteMonitor = createGameboyMonitor();
let apuNoteChannels = [];
let ym2413NoteChannels = [];
let psgHighlightActive = false;
let baseEngineWriteYm2612 = null;
let baseEngineWriteYm2203 = null;
let baseEngineWriteYm2608 = null;
let baseEngineWriteYm2610 = null;
let channelMonitorRenderTimer = null;
let noteishRenderTimer = null;
let channelMonitorDirty = false;
let noteishDirty = false;
let lastNoteishSignature = "";
let lastLoadedFileName = "snapshot";
const msxMutes = new Map();
const opllChannelMutes = Array(9).fill(false);
const opl3ChannelMutes = Array(18).fill(false);
let opmNoteTracker;
let opmNoteChannels = [];
const opmChannelMutes = Array(8).fill(false);
const ym3526ChannelMutes = Array(9).fill(false);
const ym3812ChannelMutes = Array(9).fill(false);
const ymf278bFmChannelMutes = Array(18).fill(false);
const ymf278bPcmChannelMutes = Array(24).fill(false);
const gameboyChannelMutes = Array(4).fill(false);
const huc6280ChannelMutes = Array(6).fill(false);
const nesChannelMutes = Array(6).fill(false);
const sourceMutes = { psg: false, ssg: false, rhythm: false, adpcmB: false, pcm: false, pwm: false, oki: false, segapcm: false };
// Without the rhythm ROM, decoding its all-zero sample stream is audible
// noise, not silence (see YM2608_RHYTHM_ROM_WARNING) - force the source
// mute so the chip stays quiet there regardless of the user's toggle,
// without touching sourceMutes.rhythm itself (the toggle still reflects
// what the user actually chose, for when the ROM does get imported).
function effectiveSourceMutes() {
  if (currentChipKind === 'ym2608' && ym2608NeedsRhythmRom && !ym2608AdpcmARomBytes) {
    return { ...sourceMutes, rhythm: true };
  }
  return sourceMutes;
}
const CHANNEL_MUTE_CHIPS = ['huc6280', 'ym2151', 'ymf262', 'ym2413', 'ym3526', 'ym3812', 'gameboy', 'nes'];
function channelMutesForChip(chipKind) {
  return chipKind === 'ym2413' ? opllChannelMutes
    : chipKind === 'ymf262' ? opl3ChannelMutes
    : chipKind === 'ym3526' ? ym3526ChannelMutes
    : chipKind === 'ym3812' ? ym3812ChannelMutes
    : chipKind === 'huc6280' ? huc6280ChannelMutes
    : chipKind === 'nes' ? nesChannelMutes
    : chipKind === 'gameboy' ? gameboyChannelMutes
    : chipKind === 'ym2151' ? opmChannelMutes
    : null;
}
let lastYm2612DacEnable = 0x00;
let monitorToggleHandlerBound = false;
let workletQueueMultiplier = 2;
let workletPumpScheduled = false;
let playbackUiDirty = false;
let playbackUiRenderScheduled = false;
let lastStreamingStatusSuffix = "";
let lastStreamingStatusAt = 0;
let lastParseInfo = null;
let masterVolume = 1;
let playbackPreparePromise = null;
let activeYm2203ModuleFactoryPromise = null;
let activeYm2608ModuleFactoryPromise = null;
let ymf278bWaveRomBytes = null;
let ymf278bWaveRomName = "";
let ymf278bNeedsWaveRom = false;
const YMF278B_ROM_WARNING = 'This YMF278B track needs yrw801.rom (2 MiB). Import it using the file selector or drag and drop, then press Play.';
let ym2608AdpcmARomBytes = null;
let ym2608AdpcmARomName = "";
let ym2608NeedsRhythmRom = false;
const YM2608_RHYTHM_ROM_WARNING = 'This YM2608 track uses rhythm samples. Without ym2608_adpcm_rom.bin the rhythm channel decodes silence as noise. Import it using the file selector or drag and drop.';

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTEISH_REFERENCE_MIDI = 62;
const NOTEISH_REFERENCE_BLOCK = 4;
const NOTEISH_REFERENCE_FNUM = 553;
const NOTEISH_GRAPH_MIN_MIDI = 24;
const NOTEISH_GRAPH_MAX_MIDI = 96;
const NOTEISH_HISTORY_WINDOW_MS = 8000;

const playbackWarnings = new Set();
function setPlaybackError(message = '') {
  for (const id of ['playbackError', 'inlinePlaybackError']) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    panel.textContent = message;
    panel.hidden = !message;
  }
}
function reportPlaybackError(error) {
  const message = error?.message || String(error);
  setPlaybackError(`Playback could not start: ${message}`);
  setStatus(`Error: ${message}`);
}

function renderPlaybackWarnings() {
  for (const id of ['playbackWarnings', 'inlinePlaybackWarnings']) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    panel.textContent = [...playbackWarnings].join('\n');
    panel.hidden = playbackWarnings.size === 0;
  }
}
function reportPlaybackWarning(message) {
  const block = /^Skipping unsupported VGM data block (0x[0-9a-f]+) \(size=\d+\)$/i.exec(message);
  if (block) {
    message = `Unsupported VGM data block ${block[1].toLowerCase()} was skipped. Playback may be incomplete.`;
  } else if (!message.startsWith('Unsupported DAC stream skipped:') && !message.includes('OKIM6258') &&
      !message.startsWith('Sega PCM mixed with YM2151')) { console.warn(message); return; }
  if (playbackWarnings.has(message) || playbackWarnings.size >= 100) return;
  playbackWarnings.add(message);
  renderPlaybackWarnings();
}
function clearPlaybackWarnings() {
  playbackWarnings.clear();
  renderPlaybackWarnings();
}

function setStatus(message) {
  status.textContent = message;
  status.hidden = !message;
}

function currentStatusSuffix() {
  if (currentChipKind === 'ymf278b') {
    if (ymf278bWaveRomBytes) return ` Wave ROM: ${ymf278bWaveRomName}.`;
    if (ymf278bNeedsWaveRom) return ' Sample data is not embedded. Import yrw801.rom (2 MiB) to play this track.';
  }
  return ym2608AdpcmARomBytes
    ? ` YM2608 ADPCM-A ROM: ${ym2608AdpcmARomName || `${ym2608AdpcmARomBytes.length} bytes`}.`
    : "";
}

function updateMasterVolumeUi() {
  if (masterVolumeRange) {
    masterVolumeRange.value =
      String(Math.round(masterVolume * 100));
  }

  if (masterVolumeValue) {
    masterVolumeValue.textContent =
      `${Math.round(masterVolume * 100)}%`;
  }
}

function applyMasterVolume() {
  engine?.setMasterVolume?.(masterVolume);
  player?.setMasterVolume?.(masterVolume);
}

function requestPlaybackUiRender(extra = "") {
  lastStreamingStatusSuffix = extra;
  playbackUiDirty = true;
  if (playbackUiRenderScheduled) {
    return;
  }
  playbackUiRenderScheduled = true;
  window.requestAnimationFrame(() => {
    playbackUiRenderScheduled = false;
    if (!playbackUiDirty) {
      return;
    }
    playbackUiDirty = false;
    const stats = player ? player.stats() : {};
    updatePlaybackButtons(stats);

    // Refresh streaming counters at most once per second; transport controls
    // and seek-position updates retain their existing cadence.
    const now = performance.now();
    const activePlayback = Boolean(stats.playing || stats.paused || stats.queuedFrames > 0);
    if (
      !activePlayback ||
      (now - lastStreamingStatusAt) >= 1000
    ) {
      updateStreamingStatus(lastStreamingStatusSuffix);
      lastStreamingStatusAt = now;
    }
  });
}

function renderMonitorToggles() {
  ensureMonitorToggleHandler();
  monitorToggles.innerHTML = "";

  if (['msx', 'y8950'].includes(currentChipKind)) {
    for (const control of msxMuteControls(currentChipKind, noteishHeader)) {
      const muted = msxMutes.get(control.key) ?? false;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `channel-toggle${muted ? ' is-muted' : ''}`;
      button.textContent = `${control.label} ${muted ? 'Off' : 'On'}`;
      if (control.chip !== 'ay8910' && control.channel >= 6) button.title = 'Rhythm: CH7 bass drum, CH8 hi-hat/snare, CH9 tom/cymbal.';
      button.setAttribute('aria-pressed', String(!muted));
      button.setAttribute('data-monitor-toggle-kind', 'msx-control');
      button.setAttribute('data-msx-control', control.key);
      monitorToggles.append(button);
    }
    inlineMonitorToggles.replaceChildren(...Array.from(monitorToggles.children, button => button.cloneNode(true)));
    return;
  }
  if (currentChipKind === 'ay8910') {
    for (const control of ayMonitor.controls()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `channel-toggle${control.muted ? ' is-muted' : ''}`;
      button.textContent = `${control.label} ${control.muted ? 'Off' : 'On'}`;
      button.setAttribute('aria-pressed', String(!control.muted));
      button.setAttribute('data-monitor-toggle-kind', 'ay-control');
      button.setAttribute('data-ay-control', control.key);
      monitorToggles.append(button);
    }
    inlineMonitorToggles.replaceChildren(...Array.from(monitorToggles.children, button => button.cloneNode(true)));
    return;
  }
  for (const source of sourcesForChip(sourceChipKind(), hasOkiSource())) {
    const button = document.createElement("button");
    const muted = sourceMutes[source.key];
    button.type = "button";
    button.className = `channel-toggle${muted ? " is-muted" : ""}`;
    button.textContent = `${source.label} ${muted ? "Off" : "On"}`;
    button.setAttribute("aria-pressed", String(!muted));
    button.setAttribute("data-monitor-toggle-kind", source.key);
    monitorToggles.append(button);
  }

  if (CHANNEL_MUTE_CHIPS.includes(currentChipKind)) {
    channelMutesForChip(currentChipKind).forEach((muted, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `channel-toggle${muted ? ' is-muted' : ''}`;
      button.textContent = `CH${index + 1} ${muted ? 'Off' : 'On'}`;
      button.setAttribute('aria-pressed', String(!muted));
      button.setAttribute('data-monitor-toggle-kind', 'opm-channel');
      if (currentChipKind === 'ym2413') button.title = 'Rhythm: CH7 bass drum, CH8 hi-hat/snare, CH9 tom/cymbal.';
      if (currentChipKind === 'ymf262') button.title = '4-op: either channel mutes the pair. Rhythm: CH7 bass drum, CH8 hi-hat/snare, CH9 tom/cymbal.';
      if (['gameboy','nes'].includes(currentChipKind)) button.title = currentChipKind==='nes'?'CH1/CH2 pulse, CH3 triangle, CH4 noise, CH5 DMC, CH6 FDS (when present).':'CH1/CH2 square, CH3 wave, CH4 noise.';
      button.setAttribute('data-channel-index', String(index));
      monitorToggles.append(button);
    });
  }
  if (currentChipKind === 'ymf278b') {
    const groups = [['FM', ymf278bFmChannelMutes, 'ymf278b-fm-channel'], ['PCM', ymf278bPcmChannelMutes, 'ymf278b-pcm-channel']];
    for (const [label, mutes, kind] of groups) {
      mutes.forEach((muted, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `channel-toggle${muted ? ' is-muted' : ''}`;
        button.textContent = `${label} CH${index + 1} ${muted ? 'Off' : 'On'}`;
        button.setAttribute('aria-pressed', String(!muted));
        button.setAttribute('data-monitor-toggle-kind', kind);
        button.setAttribute('data-channel-index', String(index));
        monitorToggles.append(button);
      });
    }
  }
  channelMonitor.forEach((channel) => {
    if (channel.unavailable) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `channel-toggle${channel.muted ? " is-muted" : ""}`;
    button.textContent = channel.muted
      ? `CH${channel.channel + 1} Off`
      : `CH${channel.channel + 1} On`;
    button.setAttribute("data-monitor-toggle-kind", "channel");
    button.setAttribute("data-channel-index", String(channel.channel));
    monitorToggles.append(button);
  });
  inlineMonitorToggles.replaceChildren(...Array.from(monitorToggles.children, button => button.cloneNode(true)));
}

function ensureMonitorToggleHandler() {
  if (monitorToggleHandlerBound) {
    return;
  }
  monitorToggleHandlerBound = true;
  const handleToggle = (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("[data-monitor-toggle-kind]")
      : null;
    if (!target) {
      return;
    }
    event.preventDefault();
    const kind = target.getAttribute("data-monitor-toggle-kind");
    if (kind === 'msx-control' && ['msx', 'y8950'].includes(currentChipKind)) {
      const control = msxMuteControls(currentChipKind, noteishHeader).find(c => c.key === target.getAttribute('data-msx-control'));
      if (!control) return;
      const muted = !(msxMutes.get(control.key) ?? false);
      applyMsxMute(engine, currentChipKind, control, muted);
      msxMutes.set(control.key, muted);
      renderMonitorToggles();
      flushPendingAudio();
      return;
    }
    if (kind === 'ay-control' && currentChipKind === 'ay8910') {
      ayMonitor.toggle(target.getAttribute('data-ay-control'));
      return;
    }
    if (sourcesForChip(sourceChipKind(), hasOkiSource()).some((source) => source.key === kind)) {
      toggleSourceMute(kind);
      return;
    }
    if (kind === 'opm-channel' && CHANNEL_MUTE_CHIPS.includes(currentChipKind)) {
      toggleOpmChannelMute(Number(target.getAttribute('data-channel-index')));
      return;
    }
    if ((kind === 'ymf278b-fm-channel' || kind === 'ymf278b-pcm-channel') && currentChipKind === 'ymf278b') {
      toggleYmf278bChannelMute(kind === 'ymf278b-pcm-channel', Number(target.getAttribute('data-channel-index')));
      return;
    }
    if (kind === "channel") {
      const channelIndex = Number(target.getAttribute("data-channel-index"));
      toggleChannelMute(channelIndex);
    }
  };
  monitorToggles.addEventListener("pointerdown", handleToggle);
  inlineMonitorToggles.addEventListener("pointerdown", handleToggle);
}

function createChannelMonitorState() {
  if (["huc6280", "okim6258", "msx", "y8950", "ymf278b", "ym3526", "ym3812", "ymf262", "segapcm", "nes", "gameboy", "ym2151", "ym2413", "ay8910"].includes(currentChipKind)) return [];
  const channelCount = currentChipKind === "ym2203" ? 3 : 6;
  return Array.from({ length: channelCount }, (_, index) => buildMonitorChannel(index));
}

function buildMonitorChannel(index) {
  return {
    channel: index,
    keyOn: false,
    panLeft: false,
    panRight: false,
    algorithm: 7,
    feedback: 0,
    block: 0,
    fnum: 0,
    noteMinMidi: null,
    noteMaxMidi: null,
    noteHistory: [],
    noteSequence: [],
    noteSequenceOpen: false,
    lastSequenceNote: null,
    muted: channelMuteStates[index] || (currentChipKind === "ym2610" && !(noteishHeader.ym2610Clock & 0x80000000) && [0,3].includes(index)),
    unavailable: currentChipKind === "ym2610" && !(noteishHeader.ym2610Clock & 0x80000000) && [0,3].includes(index),
    b4Value: 0xc0,
    specialMode: false,
    specialFrequencies: {
      1: createFrequencyChangeState(),
      2: createFrequencyChangeState(),
      3: createFrequencyChangeState(),
      4: createFrequencyChangeState(),
    },
    dacEnabled: false,
    dacValue: 0,
    changedAt: {
      keyOn: 0,
      pan: 0,
      algorithm: 0,
      feedback: 0,
      block: 0,
      fnum: 0,
      specialMode: 0,
      dacEnabled: 0,
      dacValue: 0,
    },
    operators: {
      1: { dt: 0, multi: 1, tl: 127, rs: 0, ar: 0, am: 0, d1r: 0, d2r: 0, sl: 0, rr: 15, ssg: 0, changedAt: createOperatorChangeState() },
      2: { dt: 0, multi: 1, tl: 127, rs: 0, ar: 0, am: 0, d1r: 0, d2r: 0, sl: 0, rr: 15, ssg: 0, changedAt: createOperatorChangeState() },
      3: { dt: 0, multi: 1, tl: 127, rs: 0, ar: 0, am: 0, d1r: 0, d2r: 0, sl: 0, rr: 15, ssg: 0, changedAt: createOperatorChangeState() },
      4: { dt: 0, multi: 1, tl: 127, rs: 0, ar: 0, am: 0, d1r: 0, d2r: 0, sl: 0, rr: 15, ssg: 0, changedAt: createOperatorChangeState() },
    },
  };
}

function createFrequencyChangeState() {
  return {
    block: 0,
    fnum: 0,
    changedAt: {
      block: 0,
      fnum: 0,
    },
  };
}

function createOperatorChangeState() {
  return {
    dt: 0,
    multi: 0,
    tl: 0,
    rs: 0,
    ar: 0,
    am: 0,
    d1r: 0,
    d2r: 0,
    sl: 0,
    rr: 0,
    ssg: 0,
  };
}

function changeAgeOpacity(changedAt) {
  if (!changedAt) {
    return 0;
  }
  const age = performance.now() - changedAt;
  if (age >= 1800) {
    return 0;
  }
  return 1 - (age / 1800);
}

function renderParamToken(label, value, changedAt, hue = "255 184 92") {
  const opacity = changeAgeOpacity(changedAt);
  const background = opacity > 0
    ? `background: color-mix(in srgb, rgba(${hue} / ${Math.max(0.22, opacity * 0.78)}) 75%, rgba(43, 36, 29, 0.06) 25%);`
    : "";
  return `<span class="param-token" style="${background}">${label} ${value}</span>`;
}

function hasRecentChannelChanges() {
  for (const channel of channelMonitor) {
    if (channel.unavailable) continue;
    for (const value of Object.values(channel.changedAt)) {
      if (changeAgeOpacity(value) > 0) {
        return true;
      }
    }
    for (const frequency of Object.values(channel.specialFrequencies || {})) {
      if (changeAgeOpacity(frequency.changedAt?.block) > 0 || changeAgeOpacity(frequency.changedAt?.fnum) > 0) {
        return true;
      }
    }
    for (const operator of Object.values(channel.operators)) {
      for (const value of Object.values(operator.changedAt)) {
        if (changeAgeOpacity(value) > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

function ensureChannelMonitorRenderTimer() {
  if (channelMonitorRenderTimer) {
    return;
  }
  channelMonitorRenderTimer = window.setInterval(() => {
    if (operatorInfoPanel.hidden) return;
    const psgRecent = (currentChipKind === 'ym2151' && opmMonitor.hasRecentChanges()) || psgMonitor.changedAt.some((time) => changeAgeOpacity(time) > 0) ||
      changeAgeOpacity(pcmMonitor.changedAt) > 0 || pcmMonitor.channels.some((channel) => changeAgeOpacity(channel.changedAt) > 0);
    if (!channelMonitorDirty && !hasRecentChannelChanges() && !psgRecent && !psgHighlightActive) {
      return;
    }
    renderChannelMonitor();
    psgHighlightActive = psgRecent;
    channelMonitorDirty = false;
  }, 120);
}

// Note-ish/fretboard history timestamps use song time (the VGM's own sample
// position), not wall-clock time: it freezes while paused and jumps correctly
// on seek, so the ghost trail does not keep aging/fading while nothing plays.
function songTimeMs() {
  return (player?.processedWaitSamples ?? 0) / 44.1;
}

function hasRecentFretboardHistory() {
  return noteishInstrument.value === "fretboard" && noteishChannels().some(channel => {
    const last = channel.noteHistory.at(-1);
    return last && songTimeMs() - last.time <= FRET_TRAIL_MS + 200;
  });
}

function ensureNoteishRenderTimer() {
  if (noteishRenderTimer) {
    return;
  }
  noteishRenderTimer = window.setInterval(() => {
    if (noteishPanel.hidden) {
      return;
    }
    if (!noteishDirty && !player?.isPlaying?.() && !hasRecentChannelChanges() && !hasRecentFretboardHistory()) {
      return;
    }
    renderNoteishGrid();
    noteishDirty = false;
  }, 90);
}

function requestChannelMonitorRender() {
  channelMonitorDirty = true;
}

function requestNoteishRender() {
  noteishDirty = true;
}

function renderPsgMonitor() {
  const state = describePsgMonitor(psgMonitor, psgMonitor.kind === "ssg" ? sourceMutes.ssg : sourceMutes.psg);
  const title = document.getElementById("psgMonitorTitle");
  title.textContent = state.kind === "ssg" ? `${(currentChipKind === "ym2610" && (noteishHeader.ym2610Clock & 0x80000000) ? "YM2610B" : currentChipKind.toUpperCase())} SSG${sourceMutes.ssg ? " · Muted" : ""}` : `Sega PSG${sourceMutes.psg ? " · Muted" : ""}`;
  const token = (label, value, ...registers) => renderChannelChip(label, value,
    Math.max(0, ...registers.map((r) => psgMonitor.changedAt[r])), "166 214 148");
  const card = (name, content) => `<section class="channel-card"><div class="channel-head"><span class="channel-title">${name}</span></div><div class="channel-row">${content}</div></section>`;
  let cards = state.channels.map((channel, i) => card(channel.name,
    token("PERIOD", channel.period, i * 2, ...(state.kind === "ssg" ? [i * 2 + 1] : [])) +
    (state.kind === "ssg" ?
      token("TONE", channel.toneEnabled ? "ON" : "OFF", 7) +
      token("NOISE", channel.noiseEnabled ? "ON" : "OFF", 7) +
      token("VOLUME", channel.envelope ? "ENV" : channel.volume, 8 + i) :
      token("ATTENUATION", channel.attenuation === 15 ? "15 · MUTE" : channel.attenuation, i * 2 + 1))
  )).join("");
  if (state.kind === "ssg") {
    cards += card("Shared Noise / Envelope", token("NOISE PERIOD", state.noisePeriod, 6) +
      token("ENV PERIOD", state.envelope.period, 11, 12) + token("SHAPE", state.envelope.shape, 13) +
      ["continue", "attack", "alternate", "hold"].map((key) => token(key.toUpperCase(), state.envelope[key] ? "ON" : "OFF", 13)).join(""));
  } else {
    cards += card("Noise", token("MODE", state.noise.mode, 6) +
      token("RATE", state.noise.tone3Linked ? `Tone 3 · period ${state.channels[2].period}` : [16, 32, 64][state.noise.rate], 6, ...(state.noise.tone3Linked ? [4] : [])) +
      token("ATTENUATION", state.noise.attenuation === 15 ? "15 · MUTE" : state.noise.attenuation, 7));
  }
  document.getElementById("psgMonitorGrid").innerHTML = cards;
  document.getElementById("psgMonitorRegisters").innerHTML = state.registers.map((value, r) => token(`R${r.toString(16).toUpperCase().padStart(2, "0")}`, `0x${value.toString(16).toUpperCase().padStart(2, "0")}`, r)).join("");
}

function renderPcmMonitor() {
  const state = describeRf5c164Monitor(pcmMonitor, currentHasPcm, currentPcmClock, sourceMutes.pcm);
  document.getElementById("pcmMonitorTitle").textContent = `RF5C164 PCM${state.used ? (state.muted ? " · Muted" : " · Used") : " · Not used"}`;
  document.getElementById("pcmMonitorStatus").textContent = !currentBuffer ? "No file loaded." : !state.used
    ? "RF5C164 is not used by this file (VGM header)."
    : `Clock: ${state.clock.toLocaleString()} Hz · Chip: ${state.enabled ? "ON" : "OFF"} · Channels enabled: ${state.channels.filter((c) => c.enabled).length} / 8 · Register writes: ${state.writes} · RAM transfers: ${state.memoryWrites} (${state.transferredBytes.toLocaleString()} bytes)`;
  const grid = document.getElementById("pcmMonitorGrid");
  grid.hidden = !state.used;
  document.getElementById("pcmMonitorHelp").hidden = !state.used;
  if (!state.used) { grid.innerHTML = ""; return; }
  const token = (label, value, time) => renderChannelChip(label, value, time, "166 214 148");
  grid.innerHTML = `<section class="channel-card"><div class="channel-head"><span class="channel-title">Shared control</span></div><div class="channel-row">${token("CHIP", state.enabled ? "ON" : "OFF", pcmMonitor.changedAt)}${token("SELECTED", state.selectedChannel, pcmMonitor.changedAt)}${token("RAM BANK", state.ramBank, pcmMonitor.changedAt)}</div></section>` +
    state.channels.map((channel, i) => {
      const t = pcmMonitor.channels[i].changedAt;
      return `<section class="channel-card"><div class="channel-head"><span class="channel-title">${channel.name}</span></div><div class="channel-row">${
        token("CHANNEL", channel.enabled ? "ON" : "OFF", t) + token("VOLUME", channel.volume, t) +
        token("PAN L / R", `${channel.panLeft} / ${channel.panRight}`, t) + token("STEP", channel.step, t) +
        token("START", formatHex(channel.startAddress, 4), t) + token("LOOP", formatHex(channel.loopAddress, 4), t)
      }</div></section>`;
    }).join("");
}

function resetOpmNotes(clock) {
  opmNoteChannels = Array.from({length:8},(_,channel)=>({opm:true,channel,label:`YM2151 CH${channel+1}`,keyOn:false,noteMidi:null,noteHistory:[],noteMinMidi:null,noteMaxMidi:null,reason:null,kc:0,kf:0}));
  opmNoteTracker = createOpmNoteTracker(clock,(index,state,sample)=>{
    const ch=opmNoteChannels[index],now=songTimeMs();
    Object.assign(ch,{keyOn:state.keyOn,noteMidi:state.midi,reason:state.reason,kc:state.kc,kf:state.kf});
    ch.noteHistory.push({time:now,sample,midiFloat:state.midi});
    if(state.midi!==null){ch.noteMinMidi=ch.noteMinMidi===null?state.midi:Math.min(ch.noteMinMidi,state.midi);ch.noteMaxMidi=ch.noteMaxMidi===null?state.midi:Math.max(ch.noteMaxMidi,state.midi);}
    pruneChannelNoteHistory(ch,now);requestNoteishRender();
  });
  requestNoteishRender();
}

function noteishChannels() {
  if (currentChipKind === "ym2151") return opmNoteChannels;
  if (currentChipKind === "ym2413") return ym2413NoteChannels;
  if (["msx","y8950","huc6280","gameboy","nes","ymf278b","ymf262","ym3526","ym3812"].includes(currentChipKind)) return apuNoteChannels;
  const fm = noteishHeader.psgClock && !noteishHeader[`${currentChipKind}Clock`] ? [] : channelMonitor;
  const opllExtra = currentChipKind === "ay8910" && (noteishHeader.ym2413Clock & 0x3fffffff) ? ym2413NoteChannels : [];
  return [...fm.filter(ch=>!ch.unavailable), ...toneChannels, ...opllExtra];
}

function updateToneMonitor() {
  if (["huc6280", "okim6258", "msx", "y8950", "ymf278b", "ym3526", "ym3812", "ymf262", "segapcm", "nes", "gameboy", "ym2151", "ym2413"].includes(currentChipKind)) { toneChannels = []; return; }
  const clock = (psgMonitor.kind === 'ssg' ? noteishHeader[`${currentChipKind}Clock`] : noteishHeader.psgClock) & 0x3fffffff;
  if (!clock) { toneChannels = []; return; }
  if (!toneChannels.length) toneChannels = Array.from({length:3}, (_,index)=>({...buildMonitorChannel(index), tone:true, toneMidi:null}));
  const now = songTimeMs();
  describeToneNotes(psgMonitor, clock).forEach((note,i)=>{
    const ch = toneChannels[i];
    ch.unavailable = false;
    const midi = note.keyOn ? note.midi : null;
    if (ch.keyOn !== note.keyOn || ch.toneMidi !== note.midi) {
      ch.noteHistory.push({time:now,midiFloat:midi});
      if (note.keyOn && midi !== null) {
        ch.noteMinMidi = ch.noteMinMidi === null ? midi : Math.min(ch.noteMinMidi,midi);
        ch.noteMaxMidi = ch.noteMaxMidi === null ? midi : Math.max(ch.noteMaxMidi,midi);
      }
    }
    ch.keyOn=note.keyOn; ch.toneMidi=note.midi; ch.label=note.name; ch.period=note.period;
    ch.envelope=note.envelope; ch.noise=note.noise;
    pruneChannelNoteHistory(ch,now);
  });
  requestNoteishRender();
}

function updateYm2413ToneMonitor() {
  if (!ym2413NoteChannels.length) ym2413NoteChannels = Array.from({length:9}, (_,index)=>({...buildMonitorChannel(index), opll:true, toneMidi:null, label:`OPLL CH${index+1}`}));
  const now = songTimeMs();
  ym2413Monitor.describe().channels.forEach((state,i)=>{
    const ch = ym2413NoteChannels[i];
    ch.unavailable = false;
    const midi = state.midi;
    if (ch.keyOn !== state.keyOn || ch.toneMidi !== midi) {
      ch.noteHistory.push({time:now,midiFloat:midi});
      if (state.keyOn) {
        ch.noteMinMidi = ch.noteMinMidi === null ? midi : Math.min(ch.noteMinMidi,midi);
        ch.noteMaxMidi = ch.noteMaxMidi === null ? midi : Math.max(ch.noteMaxMidi,midi);
      }
    }
    ch.keyOn=state.keyOn; ch.toneMidi=midi; ch.fnum=state.fnum; ch.block=state.block;
    ch.instrument=state.instrument; ch.volume=state.volume; ch.isRhythmChannel=state.isRhythmChannel;
    pruneChannelNoteHistory(ch,now);
  });
  requestNoteishRender();
}

function resetYm2413NoteChannels() {
  ym2413NoteChannels = [];
  updateYm2413ToneMonitor();
  requestChannelMonitorRender();
}

function updateApuNoteMonitor() {
  if (!apuNoteChannels.length) apuNoteChannels = Array.from({length:currentChipKind==='msx'?describeMsxNotes(apuNoteMonitor).length:currentChipKind==='huc6280'?6:isOpl(currentChipKind)?9:['ymf262','ymf278b'].includes(currentChipKind)?18:currentChipKind==='nes'&&(noteishHeader.nesApuClock&0x80000000)?4:3}, (_,index)=>({...buildMonitorChannel(index), apu:true, toneMidi:null, label:`${isOpl(currentChipKind)?currentChipKind.toUpperCase():['ymf262','ymf278b'].includes(currentChipKind)?`${currentChipKind.toUpperCase()}${currentChipKind==='ymf278b'?' FM':''}`:currentChipKind==='nes'?'NES':'GB'} CH${index+1}`, apuType: index===2?(currentChipKind==='nes'?'Triangle':'Wave'):(currentChipKind==='nes'?'Pulse':'Square')}));
  const now = songTimeMs();
  (currentChipKind==='msx'?describeMsxNotes(apuNoteMonitor):currentChipKind==='huc6280'?describeHuc6280Notes(apuNoteMonitor,noteishHeader.huc6280Clock & 0x3fffffff):isOpl(currentChipKind)?describeOplNotes(apuNoteMonitor,noteishHeader[`${currentChipKind}Clock`]&0x3fffffff):['ymf262','ymf278b'].includes(currentChipKind)?describeOpl3Notes(apuNoteMonitor,noteishHeader[`${currentChipKind}Clock`] & 0x3fffffff,currentChipKind):currentChipKind==='nes'?describeNesNotes(apuNoteMonitor,noteishHeader.nesApuClock & 0x3fffffff):describeGameboyNotes(apuNoteMonitor)).forEach((note,i)=>{
    const ch = apuNoteChannels[i];
    if(currentChipKind==='nes'||currentChipKind==='msx'){ch.label=note.name;ch.apuType=note.type;}
    const modeChanged = currentChipKind === "huc6280" && ch.apuType !== note.type;
    if (currentChipKind === "huc6280") {
      ch.huc6280=true; ch.label=note.name; ch.apuType=note.type; ch.reason=note.reason; ch.audible=note.audible;
    }
    ch.unavailable = !!(note.slave || note.percussion || note.csm);
    if(isOpl(currentChipKind)||['ymf262','ymf278b'].includes(currentChipKind))ch.apuType=note.csm?'CSM (omitted)':note.slave?'4op partner':note.percussion?'Rhythm (omitted)':note.paired?'4op':'2op';
    const midi = ch.unavailable || !note.keyOn ? null : note.midi;
    if (modeChanged || ch.keyOn !== note.keyOn || ch.toneMidi !== midi || ch.trigger !== note.trigger) {
      ch.noteHistory.push({time:now,midiFloat:midi});
      if (note.keyOn && midi !== null) {
        ch.noteMinMidi = ch.noteMinMidi === null ? midi : Math.min(ch.noteMinMidi,midi);
        ch.noteMaxMidi = ch.noteMaxMidi === null ? midi : Math.max(ch.noteMaxMidi,midi);
      }
    }
    ch.keyOn=note.keyOn; ch.toneMidi=midi; ch.freq=note.freq; ch.trigger=note.trigger;
    pruneChannelNoteHistory(ch,now);
  });
  requestNoteishRender();
}

function resetApuNoteChannels() {
  if(currentChipKind==='nes'){nesChannelMutes.length=(noteishHeader.nesApuClock&0x80000000)?6:5;if(nesChannelMutes.length===6)nesChannelMutes[5]??=false;}
  apuNoteMonitor = currentChipKind==='msx'?createMsxNoteMonitor(noteishHeader):currentChipKind==='huc6280'?createHuc6280Monitor():isOpl(currentChipKind)?createOplMonitor():['ymf262','ymf278b'].includes(currentChipKind)?createOpl3Monitor():currentChipKind==='nes'?createNesMonitor(!!(noteishHeader.nesApuClock & 0x80000000)):createGameboyMonitor();
  apuNoteChannels = [];
  updateApuNoteMonitor();
  requestNoteishRender();
}

function resetPsgMonitor() {
  pcmMonitor = createRf5c164Monitor();
  psgMonitor = createPsgMonitor(currentChipKind);
  toneChannels = [];
  updateToneMonitor();
  requestChannelMonitorRender();
}

function observePsgPlaybackEngine() {
  observePsgEngine(engine, () => psgMonitor, () => { updateToneMonitor(); requestChannelMonitorRender(); }, resetPsgMonitor);
  observeRf5c164Engine(engine, () => pcmMonitor, requestChannelMonitorRender);
}

function renderChannelMonitor() {
  if (currentChipKind === "ym2151") opmMonitor.render();
  if (currentChipKind === "ay8910") { renderMonitorToggles(); ayMonitor.render(); if (noteishHeader.ym2413Clock & 0x3fffffff) ym2413Monitor.render(); return; }
  if (currentChipKind === "ym2413") { renderMonitorToggles(); ym2413Monitor.render(); return; }
  if (isOpl(currentChipKind)) { renderMonitorToggles(); oplMonitor.render(); return; }
  if (["msx","huc6280","gameboy","nes","ymf278b","ymf262"].includes(currentChipKind)) { renderMonitorToggles(); return; }
  renderPsgMonitor();
  renderPcmMonitor();
  channelGrid.innerHTML = "";
  renderMonitorToggles();
  for (const channel of channelMonitor) {
    if (channel.unavailable) continue;
    const card = document.createElement("section");
    card.className = `channel-card${channel.keyOn ? " is-key-on" : ""}`;
    const pan = `${channel.panLeft ? "L" : "-"}${channel.panRight ? "R" : "-"}`;
    const panChip = currentChipKind === "ym2612"
      ? renderChannelChip("PAN", pan, channel.changedAt.pan, "166 214 148")
      : "";
    const dacChips = currentChipKind === "ym2612" && channel.channel === 5
      ? [
        renderChannelChip("DAC", channel.dacEnabled ? "ON" : "OFF", channel.changedAt.dacEnabled, "166 214 148"),
        renderChannelChip("BYTE", channel.dacValue, channel.changedAt.dacValue, "255 184 92"),
      ].join("")
      : "";
    card.innerHTML = `
      <div class="channel-head">
        <span class="channel-title">CH${channel.channel + 1}</span>
        <span class="channel-meta">${channel.keyOn ? "key on" : "key off"}</span>
      </div>
      <div class="channel-row">
        ${renderChannelChip("ALG", channel.algorithm, channel.changedAt.algorithm, "255 184 92")}
        ${renderChannelChip("FB", channel.feedback, channel.changedAt.feedback, "255 184 92")}
        ${panChip}
        ${renderChannelChip("B", channel.block, channel.changedAt.block, "125 176 255")}
        ${renderChannelChip("F", channel.fnum, channel.changedAt.fnum, "125 176 255")}
        ${dacChips}
      </div>
      <div class="operators">
        <div class="operator-box"><strong>OP1</strong> ${renderOperatorTokens(channel.operators[1])}</div>
        <div class="operator-box"><strong>OP2</strong> ${renderOperatorTokens(channel.operators[2])}</div>
        <div class="operator-box"><strong>OP3</strong> ${renderOperatorTokens(channel.operators[3])}</div>
        <div class="operator-box"><strong>OP4</strong> ${renderOperatorTokens(channel.operators[4])}</div>
      </div>
    `;
    channelGrid.append(card);
  }

  if (["ym2612", "ym2608", "ym2610"].includes(currentChipKind)) {
    const specialCard = document.createElement("section");
    const ch3 = channelMonitor[2];
    specialCard.className = `channel-card${ch3?.keyOn ? " is-key-on" : ""}`;
    specialCard.innerHTML = `
      <div class="channel-head">
        <span class="channel-title">CH3SP</span>
        <span class="channel-meta">${ch3?.specialMode ? "special on" : "special off"}</span>
      </div>
      <div class="channel-row">
        ${renderChannelChip("MODE", ch3?.specialMode ? "ON" : "OFF", ch3?.changedAt.specialMode, "166 214 148")}
      </div>
      <div class="operators">
        ${renderSpecialFrequencyBox("OP1", ch3?.specialFrequencies?.[1])}
        ${renderSpecialFrequencyBox("OP2", ch3?.specialFrequencies?.[2])}
        ${renderSpecialFrequencyBox("OP3", ch3?.specialFrequencies?.[3])}
        ${renderSpecialFrequencyBox("OP4", {
          block: ch3?.block ?? 0,
          fnum: ch3?.fnum ?? 0,
          changedAt: {
            block: ch3?.changedAt.block ?? 0,
            fnum: ch3?.changedAt.fnum ?? 0,
          },
        })}
      </div>
    `;
    channelGrid.append(specialCard);
  }
}

function midiToNoteName(midi) {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

function estimateChannelNoteish(channel) {
  if (channel.opm) { const midi = channel.noteMidi;return {midiFloat:midi,note:midi===null ? (channel.reason || "No pitch") : `~${midiToNoteName(Math.round(midi))}`,cents:midi===null ? null : Math.round((midi-Math.round(midi))*100)}; }
  if (channel.opll) {
    const midi = channel.toneMidi;
    return { midiFloat:midi, note:midi === null ? (channel.isRhythmChannel ? 'Rhythm' : 'No pitch') : `~${midiToNoteName(Math.round(midi))}`,
      cents:midi === null ? null : Math.round((midi-Math.round(midi))*100) };
  }
  if (channel.tone || channel.apu) {
    const midi = channel.toneMidi;
    return { midiFloat:midi, note:midi === null ? (channel.huc6280 ? channel.reason || 'No pitch' : 'No pitch') : `~${midiToNoteName(Math.round(midi))}`,
      cents:midi === null ? null : Math.round((midi-Math.round(midi))*100) };
  }
  if (channel.fnum <= 0) {
    return {
      note: "No pitch",
      midiFloat: null,
      cents: null,
    };
  }

  if (currentChipKind === 'ym2610') {
    const hz = channel.fnum * (noteishHeader.ym2610Clock & 0x3fffffff) * 2**(channel.block-1) / (144 * 2**20);
    const midi = 69 + 12*Math.log2(hz/440);
    return {midiFloat:midi,note:`~${midiToNoteName(Math.round(midi))}`,cents:Math.round((midi-Math.round(midi))*100)};
  }
  const ratio =
    (channel.fnum / NOTEISH_REFERENCE_FNUM) *
    Math.pow(2, channel.block - NOTEISH_REFERENCE_BLOCK);
  const midiFloat =
    NOTEISH_REFERENCE_MIDI +
    (12 * Math.log2(ratio));
  const roundedMidi = Math.round(midiFloat);
  return {
    note: `~${midiToNoteName(roundedMidi)}`,
    midiFloat,
    cents: Math.round((midiFloat - roundedMidi) * 100),
  };
}

function updateChannelObservedRange(channelIndex) {
  const channel = channelMonitor[channelIndex];
  if (!channel || !channel.keyOn) {
    return;
  }
  const estimated = estimateChannelNoteish(channel);
  if (estimated.midiFloat === null) {
    return;
  }
  if (channel.noteMinMidi === null || estimated.midiFloat < channel.noteMinMidi) {
    channel.noteMinMidi = estimated.midiFloat;
  }
  if (channel.noteMaxMidi === null || estimated.midiFloat > channel.noteMaxMidi) {
    channel.noteMaxMidi = estimated.midiFloat;
  }
}

function pruneChannelNoteHistory(channel, now = songTimeMs()) {
  const cutoff = now - NOTEISH_HISTORY_WINDOW_MS;
  const history = channel.noteHistory;
  // A single splice instead of repeated shift() calls: shifting one at a time
  // is O(n) per call, so dropping k stale entries from a dense history was
  // O(n*k) here specifically (pruning runs on every note/pitch push).
  let dropCount = 0;
  while (dropCount < history.length && history[dropCount].time < cutoff) dropCount++;
  if (dropCount > 0) history.splice(0, dropCount);
}

// The fretboard tracker's update() does several full passes over whatever
// history it's given, and only ever renders points within FRET_TRAIL_MS
// anyway. Passing the full 8s noteHistory window made it redo that work
// for entries it would discard, so windowing here keeps dense pitch
// modulation (e.g. vibrato) from making the fretboard view slow.
function recentNoteHistory(history, windowMs, now) {
  const cutoff = now - windowMs;
  let start = history.length;
  while (start > 0 && history[start - 1].time >= cutoff) start--;
  return start === 0 ? history : history.slice(start);
}

// Display-only onset cleanup: at most 8 VGM samples (~0.18 ms), and
// only the first low write after a fresh full KEY ON. Audio/MIDI stay exact.
function beginNoteishOnset(channel, wasKeyOn, mask) {
  channel.noteishOnset = null;
  if (wasKeyOn || mask !== 15 || !player) return;
  // Keep the actual points: pruning can shrink the live array while this
  // onset is pending. Restoring an old length would create sparse entries.
  const history = channel.noteHistory.slice();
  if (history.length) history[history.length - 1] = { ...history.at(-1) };
  channel.noteishOnset = {
    sample: player.processedWaitSamples,
    history,
    sequenceLength: channel.noteSequence.length,
    lastSequenceNote: channel.lastSequenceNote,
    min: channel.noteMinMidi, max: channel.noteMaxMidi,
  };
}

function settleNoteishOnset(channel) {
  const onset = channel.noteishOnset;
  channel.noteishOnset = null;
  if (!onset || !player) return;
  const elapsed = player.processedWaitSamples - onset.sample;
  if (elapsed < 0 || elapsed > 8) return;
  // Remove only the provisional KEY ON point; keep every later pitch commit.
  const cutoff = songTimeMs() - NOTEISH_HISTORY_WINDOW_MS;
  channel.noteHistory = onset.history.filter(point => point.time >= cutoff);
  channel.noteSequence.length = onset.sequenceLength;
  channel.lastSequenceNote = onset.lastSequenceNote;
  channel.noteMinMidi = onset.min;
  channel.noteMaxMidi = onset.max;
}

function recordChannelNoteHistory(channelIndex, midiFloat) {
  if (typeof timelineSeekController !== "undefined" && timelineSeekController) return;
  const channel = channelMonitor[channelIndex];
  if (!channel) {
    return;
  }
  const now = songTimeMs();
  const lastPoint = channel.noteHistory[channel.noteHistory.length - 1] ?? null;
  if (
    lastPoint &&
    lastPoint.midiFloat === midiFloat &&
    (now - lastPoint.time) < 45
  ) {
    lastPoint.time = now;
    pruneChannelNoteHistory(channel, now);
    return;
  }
  channel.noteHistory.push({
    time: now,
    midiFloat,
  });
  pruneChannelNoteHistory(channel, now);
}

function noteNameFromMidiFloat(midiFloat) {
  if (midiFloat === null || !Number.isFinite(midiFloat)) {
    return null;
  }
  return midiToNoteName(Math.round(midiFloat));
}

function appendChannelNoteSequence(channelIndex, midiFloat, force = false) {
  if (typeof timelineSeekController !== "undefined" && timelineSeekController) return;
  const channel = channelMonitor[channelIndex];
  if (!channel) {
    return;
  }
  const noteName = noteNameFromMidiFloat(midiFloat);
  if (!noteName) {
    return;
  }
  if (!force && channel.lastSequenceNote === noteName) {
    return;
  }
  channel.noteSequence.push(noteName);
  channel.lastSequenceNote = noteName;
}

function formatChannelCompactNotes(channelIndex) {
  const channel = channelMonitor[channelIndex];
  if (!channel || channel.noteSequence.length === 0) {
    return `CH${channelIndex + 1}\n(no notes yet)`;
  }
  return `CH${channelIndex + 1}\n${channel.noteSequence.join(" ")}`;
}

function showChannelCompactNotes(channelIndex) {
  notesDialogTitle.textContent = `CH${channelIndex + 1} Notes`;
  notesDialogOutput.textContent = formatChannelCompactNotes(channelIndex);
  if (typeof notesDialog.showModal === "function") {
    notesDialog.showModal();
    return;
  }
  notesDialog.setAttribute("open", "open");
}

function buildNoteishSignature() {
  return JSON.stringify(noteishChannels().map((channel) => [
    channel.keyOn,
    channel.toneMidi,
    channel.apuType,
    channel.reason,
    channel.block,
    channel.fnum,
    channel.algorithm,
    channel.feedback,
    channel.noteMinMidi,
    channel.noteMaxMidi,
    channel.noteHistory.length,
    channel.noteHistory[channel.noteHistory.length - 1]?.time ?? 0,
    channel.noteHistory[channel.noteHistory.length - 1]?.midiFloat ?? null,
    (player?.isPlaying?.() || hasRecentFretboardHistory()) ? Math.floor(performance.now() / 90) : 0,
  ]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function noteishGraphX(midiFloat) {
  const normalized =
    (clamp(midiFloat, NOTEISH_GRAPH_MIN_MIDI, NOTEISH_GRAPH_MAX_MIDI) - NOTEISH_GRAPH_MIN_MIDI) /
    (NOTEISH_GRAPH_MAX_MIDI - NOTEISH_GRAPH_MIN_MIDI);
  return 16 + (normalized * 188);
}

const fretboardTrackers = new WeakMap();

function renderNoteishGraph(channel, estimated, dynamicOnly = false) {
  if (noteishInstrument.value === "fretboard") {
    const strings = Number(fretboardStrings.value);
    let entry = fretboardTrackers.get(channel);
    if (!entry || entry.strings !== strings) {
      entry = { strings, tracker: createFretboardTracker(strings) };
      fretboardTrackers.set(channel, entry);
    }
    const now = songTimeMs();
    return renderFretboard([estimated.midiFloat], entry.tracker.update(
      recentNoteHistory(channel.noteHistory, FRET_TRAIL_MS + 200, now), estimated.midiFloat, channel.keyOn, now
    ));
  }
  if (noteishMode.value === "detail") return renderNoteishKeyboard(channel, estimated, dynamicOnly);
  const axisY = 26;
  const ticks = [24, 36, 48, 60, 72, 84, 96];
  const tickLabels = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"];
  const now = songTimeMs();
  pruneChannelNoteHistory(channel, now);
  const tickSvg = dynamicOnly ? "" : ticks.map((tick, index) => {
    const x = noteishGraphX(tick);
    return `
      <line x1="${x}" y1="16" x2="${x}" y2="32" stroke="rgba(91,74,51,0.22)" stroke-width="1" />
      <text x="${x}" y="46" text-anchor="middle" font-size="9" fill="#7a6547">${tickLabels[index]}</text>
    `;
  }).join("");

  let rangeSvg = "";
  if (channel.noteMinMidi !== null && channel.noteMaxMidi !== null) {
    const minX = noteishGraphX(channel.noteMinMidi);
    const maxX = noteishGraphX(channel.noteMaxMidi);
    rangeSvg = `
      <line x1="${minX}" y1="${axisY}" x2="${maxX}" y2="${axisY}" stroke="#ef8f6b" stroke-width="8" stroke-linecap="round" />
      <circle cx="${minX}" cy="${axisY}" r="4" fill="#ef8f6b" />
      <circle cx="${maxX}" cy="${axisY}" r="4" fill="#ef8f6b" />
    `;
  }

  let currentSvg = "";
  if (estimated.midiFloat !== null) {
    const currentX = noteishGraphX(estimated.midiFloat);
    currentSvg = `
      <line x1="${currentX}" y1="10" x2="${currentX}" y2="36" stroke="#62d7dd" stroke-width="3" />
      <circle cx="${currentX}" cy="${axisY}" r="5" fill="#62d7dd" />
    `;
  }

  let historySvg = "";
  let lastPoint = null;
  let lastRenderedColumn = null;
  const historyLength = channel.noteHistory.length;
  for (let index = 0; index < historyLength; index++) {
    const point = channel.noteHistory[index];
    if (point.midiFloat === null) {
      lastPoint = null;
      lastRenderedColumn = null;
      continue;
    }
    const age = now - point.time;
    const x = 16 + (188 * (1 - clamp(age / NOTEISH_HISTORY_WINDOW_MS, 0, 1)));
    // The graph is 188px wide, so points landing on the same half-pixel column
    // are visually identical; a dense pitch-modulation history can otherwise
    // reach thousands of points, and building an SVG element per point every
    // render tick becomes the actual bottleneck. Always keep the newest point.
    const column = Math.round(x * 2);
    if (lastRenderedColumn === column && index !== historyLength - 1) continue;
    lastRenderedColumn = column;
    const y =
      36 - (
        ((clamp(point.midiFloat, NOTEISH_GRAPH_MIN_MIDI, NOTEISH_GRAPH_MAX_MIDI) - NOTEISH_GRAPH_MIN_MIDI) /
          (NOTEISH_GRAPH_MAX_MIDI - NOTEISH_GRAPH_MIN_MIDI)) * 20
      );
    historySvg += `${lastPoint ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    if (!lastPoint) historySvg += 'l0,0';
    lastPoint = { x, y };
  }

  if (dynamicOnly) return {range:rangeSvg, current:currentSvg, history:historySvg};
  return `
    <svg viewBox="0 0 220 54" aria-hidden="true">
      <line x1="16" y1="${axisY}" x2="204" y2="${axisY}" stroke="rgba(91,74,51,0.24)" stroke-width="2" />
      ${tickSvg}
      <g data-noteish-range>${rangeSvg}</g>
      <path data-noteish-history d="${historySvg}" fill="none" stroke="#62d7dd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <g data-noteish-current>${currentSvg}</g>
    </svg>
  `;
}

function renderNoteishKeyboard(channel, estimated, dynamicOnly = false) {
  const x = midi => 34 + (midi - NOTEISH_GRAPH_MIN_MIDI) * 36;
  const keys = dynamicOnly ? "" : Array.from({ length: 73 }, (_, index) => {
    const midi = NOTEISH_GRAPH_MIN_MIDI + index;
    const black = [1, 3, 6, 8, 10].includes(midi % 12);
    return `<rect x="${x(midi) - 18}" y="34" width="36" height="64" fill="${black ? '#383838' : '#fffdf7'}" stroke="#b9a38e" />
      <text x="${x(midi)}" y="88" text-anchor="middle" font-size="12" fill="${black ? '#fffdf7' : '#42382e'}">${midiToNoteName(midi)}</text>`;
  }).join("");
  let range = "";
  if (channel.noteMinMidi !== null && channel.noteMaxMidi !== null &&
      channel.noteMaxMidi >= NOTEISH_GRAPH_MIN_MIDI && channel.noteMinMidi <= NOTEISH_GRAPH_MAX_MIDI) {
    range = `<line x1="${x(clamp(channel.noteMinMidi, 24, 96))}" x2="${x(clamp(channel.noteMaxMidi, 24, 96))}" y1="56" y2="56" stroke="#ef8f6b" stroke-width="8" stroke-linecap="round" />`;
  }
  let marker = "";
  const midi = estimated.midiFloat;
  if (midi !== null && midi >= NOTEISH_GRAPH_MIN_MIDI && midi <= NOTEISH_GRAPH_MAX_MIDI) {
    const color = channel.keyOn ? '#007c91' : '#777';
    marker = `<line x1="${x(midi)}" x2="${x(midi)}" y1="30" y2="73" stroke="${color}" stroke-width="3" />
      <circle cx="${x(midi)}" cy="56" r="6" fill="${color}" />
      <text x="${x(midi)}" y="21" text-anchor="middle" font-size="14" font-weight="bold" fill="${color}">${estimated.note}</text>`;
  }
  if (dynamicOnly) return {range, current:marker};
  return `<svg viewBox="0 0 2660 112" aria-hidden="true">${keys}<g data-noteish-range>${range}</g><g data-noteish-current>${marker}</g></svg>`;
}

function noteishOverviewY(midiFloat) {
  const normalized =
    (clamp(midiFloat, NOTEISH_GRAPH_MIN_MIDI, NOTEISH_GRAPH_MAX_MIDI) - NOTEISH_GRAPH_MIN_MIDI) /
    (NOTEISH_GRAPH_MAX_MIDI - NOTEISH_GRAPH_MIN_MIDI);
  return noteishMode.value === "detail"
    ? 36 + (NOTEISH_GRAPH_MAX_MIDI - clamp(midiFloat, NOTEISH_GRAPH_MIN_MIDI, NOTEISH_GRAPH_MAX_MIDI)) * 24
    : 176 - normalized * 144;
}

function renderNoteishOverviewGraph() {
  if (typeof songTimeline !== 'undefined' && document.getElementById('noteTimelineMode').value === 'score') {
    songTimeline.mode(noteishMode.value);
    if (player?.isPlaying() && !timelineSelectionPending && !timelineSeekController) {
      const queued = player.queuedFrames + (activeStream?.workletQueuedFrames ?? 0);
      songTimeline.cursor(Math.max(0, player.processedWaitSamples - queued * 44100 / player.sampleRate()), true, loopCheckbox.checked);
    }
    return;
  }
  const detailed = noteishMode.value === "detail";
  const bottom = detailed ? 1776 : 176;
  const height = detailed ? 1810 : 210;
  const now = songTimeMs();
  const ticks = [24, 36, 48, 60, 72, 84, 96];
  const tickLabels = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"];
  const channelColors = [
    "#e77f67",
    "#f2b15c",
    "#7fdc86",
    "#72a8ff",
    "#bd86ff",
    "#62d7dd", "#25794b", "#a85520", "#506fbd",
  ];

  const pitchTicks = detailed ? Array.from({ length: 73 }, (_, i) => 24 + i) : ticks;
  const horizontalTicks = pitchTicks.map((tick, index) => {
    const y = noteishOverviewY(tick);
    const black = [1, 3, 6, 8, 10].includes(tick % 12);
    const band = detailed ? `<rect x="0" y="${y - 12}" width="736" height="24" fill="${black ? "#e4dcd1" : "#fffdf7"}" />` : "";
    return `
      ${band}
      <line x1="42" y1="${y}" x2="736" y2="${y}" stroke="rgba(91,74,51,0.12)" stroke-width="1" />
      <text x="36" y="${y + 4}" text-anchor="end" font-size="11" fill="#7a6547">${detailed ? midiToNoteName(tick) : tickLabels[index]}</text>
    `;
  }).join("");

  const verticalTicks = [0, 2, 4, 6, 8].map((seconds) => {
    const x = 42 + ((seconds / 8) * 694);
    const label = seconds === 8 ? "now" : `-${8 - seconds}s`;
    return `
      <line x1="${x}" y1="24" x2="${x}" y2="${bottom}" stroke="rgba(91,74,51,0.12)" stroke-width="1" />
      <text x="${x}" y="${bottom + 20}" text-anchor="middle" font-size="11" fill="#7a6547">${label}</text>
    `;
  }).join("");

  let channelSvg = "";
  noteishChannels().forEach((channel, index) => {
    pruneChannelNoteHistory(channel, now);
    let lastPoint = null;
    let path = "";

    for (const point of channel.noteHistory) {
      if (point.midiFloat === null) {
        lastPoint = null;
        continue;
      }
      const age = now - point.time;
      const x = 42 + (694 * (1 - clamp(age / NOTEISH_HISTORY_WINDOW_MS, 0, 1)));
      const y = noteishOverviewY(point.midiFloat);
      // One SVG path per channel, rather than two DOM nodes per history point.
      // Keep every pitch and key-off break; only the drawing representation changes.
      path += `${lastPoint ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
      if (!lastPoint) path += 'l0,0';
      lastPoint = { x, y };
    }

    const latest = channel.noteHistory[channel.noteHistory.length - 1];
    let marker = "";
    if (latest && latest.midiFloat !== null) {
      const age = now - latest.time;
      const x = 42 + (694 * (1 - clamp(age / NOTEISH_HISTORY_WINDOW_MS, 0, 1)));
      const y = noteishOverviewY(latest.midiFloat);
      marker = `<circle cx="${x}" cy="${y}" r="4.5" fill="${channelColors[index % channelColors.length]}" />`;
    }

    channelSvg += `
      <path d="${path}" fill="none" stroke="${channelColors[index % channelColors.length]}" stroke-width="${detailed ? 4 : 2.5}" stroke-opacity="0.65" stroke-linecap="round" stroke-linejoin="round" />
      ${marker}
      <text x="${675 + (index % 2) * 45}" y="${34 + Math.floor(index / 2) * 18}" font-size="11" fill="${channelColors[index % channelColors.length]}">${channel.label ?? `CH${channel.channel + 1}`}</text>
    `;
  });

  noteishOverview.innerHTML = `
    <svg viewBox="0 0 760 ${height}" ${detailed ? 'preserveAspectRatio="none"' : ""} aria-hidden="true">
      <rect x="42" y="24" width="694" height="${bottom - 24}" rx="10" fill="rgba(255,255,255,0.35)" stroke="rgba(91,74,51,0.18)" />
      ${horizontalTicks}
      ${verticalTicks}
      ${channelSvg}
    </svg>
  `;
}

function renderAllChannelFretboard() {
  const strings = Number(fretboardStrings.value), now = songTimeMs();
  const layers = noteishChannels().map(channel => {
    pruneChannelNoteHistory(channel, now);
    const note = estimateChannelNoteish(channel).midiFloat;
    let entry = fretboardTrackers.get(channel);
    if (!entry || entry.strings !== strings) {
      entry = { strings, tracker: createFretboardTracker(strings) };
      fretboardTrackers.set(channel, entry);
    }
    return { ...entry.tracker.update(recentNoteHistory(channel.noteHistory, FRET_TRAIL_MS + 200, now), note, channel.keyOn, now),
      note, label: channel.label ?? `CH${channel.channel + 1}` };
  });
  document.getElementById('allFretboardGraph').innerHTML = renderAllFretboard(layers, strings);
}

function renderNoteishGrid() {
  if (typeof noteishViewMode !== 'undefined') {
    if (noteishPanel.hidden) return;
    if (noteishViewMode === 'fretboard-all') { renderAllChannelFretboard(); return; }
    if (noteishViewMode === 'live' || noteishViewMode === 'song') {
      renderNoteishOverviewGraph();
      return;
    }
  }
  const signature = buildNoteishSignature();
  if (signature === lastNoteishSignature && !noteishDirty) {
    return;
  }
  lastNoteishSignature = signature;
  if (typeof noteishViewMode === 'undefined') renderNoteishOverviewGraph();
  // Retain scroll containers across live updates, including their keyboard focus.
  const existingCards = Array.from(noteishGrid.children);

  for (const [cardIndex, channel] of noteishChannels().entries()) {
    const estimated = estimateChannelNoteish(channel);
    const rangeText =
      channel.noteMinMidi === null || channel.noteMaxMidi === null
        ? "no observed range yet"
        : `${midiToNoteName(Math.round(channel.noteMinMidi))} .. ${midiToNoteName(Math.round(channel.noteMaxMidi))}`;
    const centsText =
      estimated.cents === null
        ? "no base note"
        : `${estimated.cents >= 0 ? "+" : ""}${estimated.cents} cents`;
    const card = existingCards[cardIndex] ?? document.createElement("section");
    if (!card.querySelector('.noteish-graph')) {
      card.innerHTML = `<div class="noteish-head"><span class="noteish-title"></span><span class="noteish-state"></span></div>
        <div class="noteish-row"><span class="noteish-note"></span><span class="noteish-cents"></span></div>
        <div class="noteish-graph"></div><div class="noteish-meta"></div>
        <div class="noteish-actions"><button class="noteish-button" type="button">Show Notes</button></div>`;
    }
    const className = `noteish-card${channel.keyOn ? " is-key-on" : ""}`;
    if (card.className !== className) card.className = className;
    const text = (selector, value) => {
      const node = card.querySelector(selector);
      if (node.textContent !== value) node.textContent = value;
    };
    text('.noteish-title', channel.label ?? `CH${channel.channel + 1}`);
    text('.noteish-state', channel.huc6280 ? (channel.audible ? channel.apuType : channel.reason) : channel.keyOn ? 'key on' : 'key off');
    text('.noteish-note', estimated.note);
    text('.noteish-cents', centsText);
    updateNoteishHtml(card.querySelector('.noteish-meta'), `
        RANGE ${rangeText}<br>
        ${channel.opm ? `KC ${channel.kc} / KF ${channel.kf}<br>Base pitch; LFO/DT/MUL and audible release are not reconstructed.` : channel.opll ? `FNUM ${channel.fnum} / BLOCK ${channel.block}<br>Instrument ${channel.instrument === 0 ? "Custom" : channel.instrument} / Volume ${channel.volume}${channel.isRhythmChannel ? "<br>Repurposed for rhythm; base pitch not shown." : ""}` : channel.tone ? `PERIOD ${channel.period}<br>Envelope ${channel.envelope ? "on (estimated)" : "off"} / Noise ${channel.noise ? "mixed" : "off"}` : channel.apu ? `${channel.apuType} · FREQ ${channel.freq}<br>${channel.huc6280 ? "Base pitch only; PCM/DDA, noise and LFO intervals have no note." : (currentChipKind === "msx" || isOpl(currentChipKind) || ["ymf262","ymf278b"].includes(currentChipKind)) ? "Base pitch only; rhythm, timbre, modulation and release omitted." : "Length counter and channel 1 sweep are time-based and not reconstructed."}` : `BLOCK ${channel.block}<br>
        FNUM ${channel.fnum}<br>
        ALG ${channel.algorithm} / FB ${channel.feedback}`}
    `);
    card.querySelector('.noteish-actions').hidden = !!(channel.tone || channel.opm || channel.opll || channel.apu);
    const button = card.querySelector('.noteish-button');
    if (button.getAttribute('data-show-notes') !== String(channel.channel)) button.setAttribute('data-show-notes', String(channel.channel));
    const viewport = card.querySelector('.noteish-graph');
    const mode = noteishInstrument.value === 'fretboard' ? 'fretboard' : noteishMode.value === 'detail' ? 'keyboard' : 'pitch';
    updateNoteishGraph(viewport, mode, dynamicOnly => renderNoteishGraph(channel, estimated, dynamicOnly));
    viewport.tabIndex = noteishMode.value === "detail" && noteishInstrument.value !== "fretboard" ? 0 : -1;
    viewport.setAttribute("role", "region");
    viewport.setAttribute("aria-label", `CH${channel.channel + 1} pitch display: ${channel.keyOn ? estimated.note : 'key off'}`);
    if (!card.isConnected) noteishGrid.append(card);
  }
  existingCards.slice(noteishChannels().length).forEach(card => card.remove());
}

function renderOperatorTokens(operator) {
  return [
    renderParamToken("DT", operator.dt, operator.changedAt.dt, "125 176 255"),
    renderParamToken("M", operator.multi, operator.changedAt.multi, "125 176 255"),
    renderParamToken("TL", operator.tl, operator.changedAt.tl, "255 224 138"),
    renderParamToken("RS", operator.rs, operator.changedAt.rs, "255 186 150"),
    renderParamToken("AR", operator.ar, operator.changedAt.ar, "255 186 150"),
    renderParamToken("AM", operator.am, operator.changedAt.am, "166 214 148"),
    renderParamToken("D1R", operator.d1r, operator.changedAt.d1r, "255 186 150"),
    renderParamToken("D2R", operator.d2r, operator.changedAt.d2r, "255 186 150"),
    renderParamToken("SL", operator.sl, operator.changedAt.sl, "255 186 150"),
    renderParamToken("RR", operator.rr, operator.changedAt.rr, "255 186 150"),
    renderParamToken("SSG-EG", operator.ssg, operator.changedAt.ssg, "166 214 148"),
  ].join("");
}

function renderSpecialFrequencyBox(label, frequency) {
  return `<div class="operator-box"><strong>${label}</strong> ${
    [
      renderParamToken("B", frequency?.block ?? 0, frequency?.changedAt?.block ?? 0, "125 176 255"),
      renderParamToken("F", frequency?.fnum ?? 0, frequency?.changedAt?.fnum ?? 0, "125 176 255"),
    ].join("")
  }</div>`;
}

function renderChannelChip(label, value, changedAt, hue) {
  const opacity = changeAgeOpacity(changedAt);
  const background = opacity > 0
    ? `background: color-mix(in srgb, rgba(${hue} / ${Math.max(0.18, opacity * 0.72)}) 78%, rgba(43, 36, 29, 0.08) 22%);`
    : "";
  return `<span class="channel-chip" style="${background}">${label} ${value}</span>`;
}

function effectivePanValue(channel) {
  return channel.muted ? (channel.b4Value & 0x3f) : channel.b4Value;
}

function toggleOpmChannelMute(index) {
  const states = channelMutesForChip(currentChipKind);
  if (!Number.isInteger(index) || index < 0 || index >= states.length) return;
  const muted = !states[index];
  engine?.setChannelMuted(index, muted);
  states[index] = muted;
  renderMonitorToggles();
  flushPendingAudio();
}

function toggleYmf278bChannelMute(isPcm, index) {
  const states = isPcm ? ymf278bPcmChannelMutes : ymf278bFmChannelMutes;
  if (!Number.isInteger(index) || index < 0 || index >= states.length) return;
  const muted = !states[index];
  if (isPcm) engine?.setPcmChannelMuted(index, muted);
  else engine?.setChannelMuted(index, muted);
  states[index] = muted;
  renderMonitorToggles();
  flushPendingAudio();
}

function toggleChannelMute(channelIndex) {
  const channel = channelMonitor[channelIndex];
  if (!channel) {
    return;
  }

  channel.muted = !channel.muted;
  channelMuteStates[channelIndex] = channel.muted;
  channel.changedAt.pan = performance.now();
  requestChannelMonitorRender();

  if (!engine) {
    return;
  }

  if ((["ym2612", "ym2608", "ym2610"].includes(currentChipKind))) {
    const port = channelIndex < 3 ? 0 : 1;
    const register = 0xb4 + (channelIndex % 3);
    const writePort = currentChipKind === "ym2612"
      ? baseEngineWriteYm2612
      : currentChipKind === "ym2610" ? baseEngineWriteYm2610 : baseEngineWriteYm2608;
    if (typeof writePort === "function") {
      writePort(port, register, effectivePanValue(channel));
    }

    if (
      currentChipKind === "ym2612" &&
      channelIndex === 5 &&
      channel.muted &&
      (lastYm2612DacEnable & 0x80) !== 0
    ) {
      baseEngineWriteYm2612(0, 0x2a, 0x80);
    }
  } else if (currentChipKind === "ym2203") {
    engine.setChannelMuted(channelIndex, channel.muted);
  }

  flushPendingAudio();
}

function flushPendingAudio() {
  if (player) {
    player.clearQueuedAudio();
  }
  if (activeStream && activeStream.mode === "worklet") {
    activeStream.workletQueuedFrames = 0;
    activeStream.endSent = false;
    activeStream.node.port.postMessage({ type: "flush", startupFrames: currentWorkletTargetFrames() });
    scheduleWorkletPump();
  }
}

function toggleSourceMute(kind) {
  sourceMutes[kind] = !sourceMutes[kind];
  try {
    if (engine) applySourceMutes(engine, sourceChipKind(), effectiveSourceMutes(), hasOkiSource());
  } catch (error) {
    sourceMutes[kind] = !sourceMutes[kind];
    setStatus(`Error: ${error.message}`);
  }
  requestChannelMonitorRender();
  renderMonitorToggles();
  flushPendingAudio();
}

function allAudibleSourcesMuted() {
  // ym2151/ym2413/ymf262/ym3526/ym3812 track channel mutes in their own arrays,
  // not channelMonitor (which is empty for these chip kinds); okim6258 standalone
  // has no channels at all; ymf278b has two independent arrays (FM + PCM).
  if (currentChipKind === 'okim6258') return sourcesForChip('okim6258', hasOkiSource()).every((source) => sourceMutes[source.key]);
  if (currentChipKind === 'ymf278b') {
    return ymf278bFmChannelMutes.every(Boolean) && ymf278bPcmChannelMutes.every(Boolean) &&
      sourcesForChip(sourceChipKind(), hasOkiSource()).every((source) => sourceMutes[source.key]);
  }
  const perChannelMutes = channelMutesForChip(currentChipKind);
  const channels = perChannelMutes === null ? channelMonitor : perChannelMutes.map((muted) => ({ muted }));
  return allSourcesMuted(sourceChipKind(), channels, effectiveSourceMutes(), hasOkiSource());
}

function applyAnalyzerMuteToBuffer(left, right, frames) {
  if (!allAudibleSourcesMuted()) {
    return;
  }
  left.fill(0, 0, frames);
  right.fill(0, 0, frames);
}

function formatHex(value, width = 2) {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function renderHeader(header) {
  return [
    `ident: ${header.ident}`,
    `version: ${formatHex(header.version, 8)}`,
    `rf5c164Clock: ${header.rf5c164Clock}`,
    `pwmClock: ${header.pwmClock} (approximate PWM playback)`,
    `ym2612Clock: ${header.ym2612Clock}`,
    `ym2203Clock: ${header.ym2203Clock}`,
    `y8950Clock: ${header.y8950Clock}`,
    `ymf278bClock: ${header.ymf278bClock}`,
    `ym3526Clock: ${header.ym3526Clock}`,
    `ym3812Clock: ${header.ym3812Clock}`,
    `ymf262Clock: ${header.ymf262Clock}`,
    `ym2151Clock: ${header.ym2151Clock}`,
    `segaPcmClock: ${header.segaPcmClock}, bankShift: ${header.segaPcmBankShift}, bankMask: ${formatHex(header.segaPcmBankMask)}`,
    `gameBoyDmgClock: ${header.gameBoyDmgClock}`,
    `huc6280Clock: ${header.huc6280Clock}`,
    `nesApuClock: ${header.nesApuClock}`,
    `okim6258Clock: ${header.okim6258Clock}`,
    `okim6258Flags: ${header.okim6258Flags}`,
    `ym2413Clock: ${header.ym2413Clock}`,
    `ay8910Clock: ${header.ay8910Clock}, type: ${header.ay8910Type}, flags: ${header.ay8910Flags}`,
    `k051649Clock: ${header.k051649Clock}`,
    `ym2608Clock: ${header.ym2608Clock}`,
    `ym2610Clock: ${header.ym2610Clock}`,
    `totalSamples: ${header.totalSamples}`,
    `loopOffset: ${formatHex(header.loopOffset, 8)}`,
    `loopSamples: ${header.loopSamples}`,
    `dataOffset: ${formatHex(header.dataOffset, 8)}`,
  ].join("\n");
}

function formatClockHz(hz) {
  if (hz >= 1000000) return `${(Math.round(hz / 10000) / 100).toString()} MHz`;
  return `${Math.round(hz / 1000)} kHz`;
}

// Lists every chip the VGM header declares a clock for, independent of
// whether this analyzer can currently play or mix that combination — this
// is what a track *asks for*, not a guarantee of support (see the "Sound
// chip support" dialog for that).
const HEADER_CHIP_FIELDS = [
  ['ym2612Clock', 'YM2612'],
  ['ym2203Clock', 'YM2203'],
  ['ym2608Clock', 'YM2608'],
  ['ym2610Clock', 'YM2610 / YM2610B'],
  ['ym2151Clock', 'YM2151'],
  ['psgClock', 'Sega PSG'],
  ['rf5c164Clock', 'RF5C164'],
  ['pwmClock', '32X PWM'],
  ['ym2413Clock', 'YM2413'],
  ['ay8910Clock', 'AY-3-8910 / YM2149'],
  ['y8950Clock', 'Y8950'],
  ['ymf278bClock', 'YMF278B'],
  ['ym3526Clock', 'YM3526'],
  ['ym3812Clock', 'YM3812'],
  ['ymf262Clock', 'YMF262'],
  ['okim6258Clock', 'OKIM6258'],
  ['k051649Clock', 'K051649 (SCC)'],
  ['segaPcmClock', 'Sega PCM'],
  ['gameBoyDmgClock', 'Game Boy DMG'],
  ['huc6280Clock', 'HuC6280'],
  ['nesApuClock', 'NES APU'],
];
function detectHeaderChips(header) {
  return HEADER_CHIP_FIELDS
    .map(([key, label]) => [key === 'nesApuClock' && (header[key] & 0x80000000) ? 'NES APU + FDS' : key === 'k051649Clock' && (header[key] & 0x80000000) ? 'K052539 (SCC+)' : label, header[key] & 0x3fffffff])
    .filter(([, hz]) => hz > 0)
    .map(([label, hz]) => `${label} (${formatClockHz(hz)})`);
}
function renderDetectedChips(header) {
  const chips = detectHeaderChips(header);
  detectedChipsOutput.textContent = chips.length ? `Uses: ${chips.join(", ")}` : "";
  detectedChipsOutput.hidden = chips.length === 0;
}

function applyYm2203WriteToMonitor(register, value) {
  // OPN high writes only latch; low writes commit the pitch. Both ports
  // share the normal latch, with a separate latch for CH3 special mode.
  if ((register & 0xf0) === 0xa0 && (register & 3) < 3 && (register & 4)) {
    monitorFrequencyHigh[(register & 8) ? 1 : 0] = value & 0x3f;
    return;
  }

  let changed = false;
  const now = performance.now();

  if (register === 0x28) {
    const channel = value & 0x03;
    if (channel <= 2) {
      const wasKeyOn = channelMonitor[channel].keyOn;
      beginNoteishOnset(channelMonitor[channel], wasKeyOn, (value >> 4) & 15);
      channelMonitor[channel].keyOn = ((value >> 4) & 0x0f) !== 0;
      channelMonitor[channel].changedAt.keyOn = now;
      if (channelMonitor[channel].keyOn) {
        updateChannelObservedRange(channel);
        const estimated = estimateChannelNoteish(channelMonitor[channel]);
        recordChannelNoteHistory(channel, estimated.midiFloat);
        channelMonitor[channel].noteSequenceOpen = true;
        appendChannelNoteSequence(channel, estimated.midiFloat, !wasKeyOn);
      } else {
        recordChannelNoteHistory(channel, null);
        channelMonitor[channel].noteSequenceOpen = false;
        channelMonitor[channel].lastSequenceNote = null;
      }
      changed = true;
    }
    if (changed) {
      requestChannelMonitorRender();
      requestNoteishRender();
    }
    return;
  }

  if (register >= 0xa0 && register <= 0xa2) {
    const channel = register - 0xa0;
    const state = channelMonitor[channel];
    if (!state) {
      return;
    }
    settleNoteishOnset(state);
    state.block = monitorFrequencyHigh[0] >> 3;
    state.fnum = ((monitorFrequencyHigh[0] & 7) << 8) | value;
    state.changedAt.block = now;
    state.changedAt.fnum = now;
    updateChannelObservedRange(channel);
    if (state.keyOn) {
      const estimated = estimateChannelNoteish(state);
      recordChannelNoteHistory(channel, estimated.midiFloat);
      appendChannelNoteSequence(channel, estimated.midiFloat, false);
    }
    requestChannelMonitorRender();
    requestNoteishRender();
    return;
  }

  if (register >= 0xb0 && register <= 0xb2) {
    const channel = register - 0xb0;
    const state = channelMonitor[channel];
    if (!state) {
      return;
    }
    state.feedback = (value >> 3) & 0x07;
    state.algorithm = value & 0x07;
    state.changedAt.feedback = now;
    state.changedAt.algorithm = now;
    requestChannelMonitorRender();
    requestNoteishRender();
    return;
  }

  const lowNibble = register & 0x0f;
  const channelOffset = lowNibble & 0x03;
  if (channelOffset > 2) {
    return;
  }

  const slotOffset = lowNibble - channelOffset;
  const operator = findOperatorFromSlotOffset(slotOffset);
  if (!operator) {
    return;
  }

  const state = channelMonitor[channelOffset]?.operators[operator];
  if (!state) {
    return;
  }
  const registerBase = register & 0xf0;

  if (registerBase === 0x30) {
    state.dt = (value >> 4) & 0x07;
    state.multi = value & 0x0f;
    state.changedAt.dt = now;
    state.changedAt.multi = now;
    changed = true;
  } else if (registerBase === 0x40) {
    state.tl = value & 0x7f;
    state.changedAt.tl = now;
    changed = true;
  } else if (registerBase === 0x50) {
    state.rs = (value >> 6) & 0x03;
    state.ar = value & 0x1f;
    state.changedAt.rs = now;
    state.changedAt.ar = now;
    changed = true;
  } else if (registerBase === 0x60) {
    state.am = (value >> 7) & 0x01;
    state.d1r = value & 0x1f;
    state.changedAt.am = now;
    state.changedAt.d1r = now;
    changed = true;
  } else if (registerBase === 0x70) {
    state.d2r = value & 0x1f;
    state.changedAt.d2r = now;
    changed = true;
  } else if (registerBase === 0x80) {
    state.sl = (value >> 4) & 0x0f;
    state.rr = value & 0x0f;
    state.changedAt.sl = now;
    state.changedAt.rr = now;
    changed = true;
  } else if (registerBase === 0x90) {
    state.ssg = value & 0x0f;
    state.changedAt.ssg = now;
    changed = true;
  }

  if (changed) {
    requestChannelMonitorRender();
  }
}

async function loadYm2203ModuleFactory() {
  if (!activeYm2203ModuleFactoryPromise) {
    activeYm2203ModuleFactoryPromise = import("../generated/ym2203_wasm.js")
      .then((module) => module.default);
  }
  return await activeYm2203ModuleFactoryPromise;
}

async function loadYm2608ModuleFactory() {
  if (!activeYm2608ModuleFactoryPromise) {
    activeYm2608ModuleFactoryPromise = import("../generated/ym2608_wasm.js")
      .then((module) => module.default);
  }
  return await activeYm2608ModuleFactoryPromise;
}

function renderCommandUsage(counts) {
  return Array.from(counts.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([command, count]) => `${command}: ${count}`)
    .join("\n");
}

function renderDataBlocks(blocks) {
  if (blocks.length === 0) {
    return "No stored data blocks were found.";
  }
  return blocks.map((block) => {
    const preview = block.preview === "" ? "(empty)" : block.preview;
    return `block ${block.index}: offset=0x${block.offset.toString(16).padStart(8, "0")} type=${formatHex(block.type)} size=${block.size} preview=${preview}`;
  }).join("\n");
}

function renderPcmRamWrites(entries) {
  if (entries.length === 0) {
    return "No 0x68 PCM RAM write commands were found.";
  }
  return entries.map((entry, index) => {
    return [
      `entry ${index}:`,
      `  commandOffset=${formatHex(entry.commandOffset, 8)}`,
      `  type=${formatHex(entry.type)}`,
      `  readOffset=${formatHex(entry.readOffset, 6)}`,
      `  writeOffset=${formatHex(entry.writeOffset, 6)}`,
      `  size=${entry.size}`,
    ].join("\n");
  }).join("\n");
}

function applyYm2612WriteToMonitor(port, register, value) {
  // OPN high writes only latch; low writes commit the pitch. Both ports
  // share the normal latch, with a separate latch for CH3 special mode.
  if ((register & 0xf0) === 0xa0 && (register & 3) < 3 && (register & 4)) {
    monitorFrequencyHigh[(register & 8) ? 1 : 0] = value & 0x3f;
    return;
  }

  if (currentChipKind === 'ym2610') {
    if (port === 0 && register < 0x20 || port === 1 && register < 0x30) return;
    if (!(noteishHeader.ym2610Clock & 0x80000000)) {
      const index = register === 0x28 && port === 0 ? decodeKeyOnChannel(value) : port*3 + (register&3);
      if ((register === 0x28 || register >= 0x30) && [0,3].includes(index)) return;
    }
  }
  let changed = false;
  const now = performance.now();
  const channelBase = port === 0 ? 0 : 3;

  if (port === 0 && register === 0x27) {
    const ch3 = channelMonitor[2];
    ch3.specialMode = (value & 0x40) !== 0;
    ch3.changedAt.specialMode = now;
    requestChannelMonitorRender();
    return;
  }

  if (port === 0 && register === 0x28) {
    const channel = decodeKeyOnChannel(value);
    if (channel !== null) {
      const wasKeyOn = channelMonitor[channel].keyOn;
      beginNoteishOnset(channelMonitor[channel], wasKeyOn, (value >> 4) & 15);
      channelMonitor[channel].keyOn = ((value >> 4) & 0x0f) !== 0;
      channelMonitor[channel].changedAt.keyOn = now;
      if (channelMonitor[channel].keyOn) {
        updateChannelObservedRange(channel);
        const estimated = estimateChannelNoteish(channelMonitor[channel]);
        recordChannelNoteHistory(channel, estimated.midiFloat);
        channelMonitor[channel].noteSequenceOpen = true;
        appendChannelNoteSequence(channel, estimated.midiFloat, !wasKeyOn);
      } else {
        recordChannelNoteHistory(channel, null);
        channelMonitor[channel].noteSequenceOpen = false;
        channelMonitor[channel].lastSequenceNote = null;
      }
      changed = true;
    }
    if (changed) {
      requestChannelMonitorRender();
      requestNoteishRender();
    }
    return;
  }

  if (register >= 0xa0 && register <= 0xa2) {
    const channel = channelBase + (register - 0xa0);
    const state = channelMonitor[channel];
    settleNoteishOnset(state);
    state.block = monitorFrequencyHigh[0] >> 3;
    state.fnum = ((monitorFrequencyHigh[0] & 7) << 8) | value;
    state.changedAt.block = now;
    channelMonitor[channel].changedAt.fnum = now;
    updateChannelObservedRange(channel);
    if (state.keyOn) {
      const estimated = estimateChannelNoteish(state);
      recordChannelNoteHistory(channel, estimated.midiFloat);
      appendChannelNoteSequence(channel, estimated.midiFloat, false);
    }
    changed = true;
    requestChannelMonitorRender();
    requestNoteishRender();
    return;
  }

  if (port === 0 && register >= 0xa8 && register <= 0xaa) {
    const operator = register === 0xa8 ? 3 : register === 0xa9 ? 1 : 2;
    const state = channelMonitor[2].specialFrequencies[operator];
    state.block = monitorFrequencyHigh[1] >> 3;
    state.fnum = ((monitorFrequencyHigh[1] & 7) << 8) | value;
    state.changedAt.block = now;
    state.changedAt.fnum = now;
    requestChannelMonitorRender();
    return;
  }

  if (register >= 0xb0 && register <= 0xb2) {
    const channel = channelBase + (register - 0xb0);
    const state = channelMonitor[channel];
    state.feedback = (value >> 3) & 0x07;
    state.algorithm = value & 0x07;
    channelMonitor[channel].changedAt.feedback = now;
    channelMonitor[channel].changedAt.algorithm = now;
    changed = true;
    requestChannelMonitorRender();
    requestNoteishRender();
    return;
  }

  if (register >= 0xb4 && register <= 0xb6) {
    const channel = channelBase + (register - 0xb4);
    const state = channelMonitor[channel];
    state.b4Value = value;
    state.panLeft = (value & 0x80) !== 0;
    state.panRight = (value & 0x40) !== 0;
    channelMonitor[channel].changedAt.pan = now;
    changed = true;
    requestChannelMonitorRender();
    return;
  }

  if (port === 0 && register === 0x2b && channelMonitor[5]) {
    channelMonitor[5].dacEnabled = (value & 0x80) !== 0;
    channelMonitor[5].changedAt.dacEnabled = now;
    requestChannelMonitorRender();
    return;
  }

  if (port === 0 && register === 0x2a && channelMonitor[5]) {
    channelMonitor[5].dacValue = value;
    channelMonitor[5].changedAt.dacValue = now;
    requestChannelMonitorRender();
    return;
  }

  const lowNibble = register & 0x0f;
  const channelOffset = lowNibble & 0x03;
  if (channelOffset > 2) {
    return;
  }

  const slotOffset = lowNibble - channelOffset;
  const operator = findOperatorFromSlotOffset(slotOffset);
  if (!operator) {
    return;
  }

  const channel = channelBase + channelOffset;
  const state = channelMonitor[channel].operators[operator];
  const registerBase = register & 0xf0;

  if (registerBase === 0x30) {
    state.dt = (value >> 4) & 0x07;
    state.multi = value & 0x0f;
    state.changedAt.dt = now;
    state.changedAt.multi = now;
    changed = true;
  } else if (registerBase === 0x40) {
    state.tl = value & 0x7f;
    state.changedAt.tl = now;
    changed = true;
  } else if (registerBase === 0x50) {
    state.rs = (value >> 6) & 0x03;
    state.ar = value & 0x1f;
    state.changedAt.rs = now;
    state.changedAt.ar = now;
    changed = true;
  } else if (registerBase === 0x60) {
    state.am = (value >> 7) & 0x01;
    state.d1r = value & 0x1f;
    state.changedAt.am = now;
    state.changedAt.d1r = now;
    changed = true;
  } else if (registerBase === 0x70) {
    state.d2r = value & 0x1f;
    state.changedAt.d2r = now;
    changed = true;
  } else if (registerBase === 0x80) {
    state.sl = (value >> 4) & 0x0f;
    state.rr = value & 0x0f;
    state.changedAt.sl = now;
    state.changedAt.rr = now;
    changed = true;
  } else if (registerBase === 0x90) {
    state.ssg = value & 0x0f;
    state.changedAt.ssg = now;
    changed = true;
  }

  if (changed) {
    requestChannelMonitorRender();
  }
}

function createStoredZip(files) { return new Blob([createStoredZipBytes(files, new Date())], {type:"application/zip"}); }

function downloadOpmTfiZip(snapshot) {
  if (!currentBuffer) return;
  try {
    const result = createOpmTfiFiles({buffer:currentBuffer,
      snapshot:snapshot ? opmMonitor.snapshot() : undefined,
      clock:noteishHeader.ym2151Clock & 0x3fffffff,fileName:lastLoadedFileName,
      sample:player?.processedWaitSamples ?? null});
    if (!result.count) {setStatus('No keyed YM2151 tones found to export.');return;}
    const url=URL.createObjectURL(createStoredZip(result.files));
    const anchor=document.createElement('a');anchor.href=url;
    const stem=(lastLoadedFileName || 'YM2151').replace(/\.[^.]+$/, '').replace(/[\/\\:*?"<>|\x00-\x1f]/g,'_');
    anchor.download=snapshot ? `${stem}_snapshot_tfi.zip` : 'all_tfi_patches.zip';
    anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus(`Exported ${result.count} converted YM2151 tones. ${OPM_TFI_NOTICE}`);
  } catch(error) {setStatus(`YM2151 TFI export failed: ${error.message}`);}
}

function downloadAllTfiZip() {
  if (currentChipKind === "ym2151") { downloadOpmTfiZip(false); return; }
  if (extractedTfiPatches.length === 0) {
    return;
  }

  const files = extractedTfiPatches.map((patch) => ({
    name: `${patch.label}.tfi`,
    data: createTfiFromPreset(patch.preset),
  }));
  const blob = createStoredZip(files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "all_tfi_patches.zip";
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${extractedTfiPatches.length} TFI patches as ZIP.`);
}

function downloadAllVgiZip() {
  if (extractedTfiPatches.length === 0) return;
  const files = extractedTfiPatches.map((patch) => ({
    name: `${patch.label}.vgi`,
    data: createVgiFromPreset(patch.preset),
  }));
  const blob = createStoredZip(files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "all_vgi_patches.zip";
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${extractedTfiPatches.length} VGI patches as ZIP.`);
}

function buildSnapshotData(reason = "manual") {
  const stats = player ? player.stats() : null;
  return {
    type: "ym2612-vgm-snapshot",
    reason,
    createdAt: new Date().toISOString(),
    sourceFile: lastLoadedFileName,
    playback: stats ? {
      playing: stats.playing,
      paused: stats.paused,
      queuedFrames: stats.queuedFrames,
      processedEvents: stats.processedEvents,
      processedWaitSamples: stats.processedWaitSamples,
      totalSamples: stats.totalSamples,
      audioProgress: stats.audioProgress,
    } : null,
    rf5c164: describeRf5c164Monitor(pcmMonitor, currentHasPcm, currentPcmClock, sourceMutes.pcm),
    chip: sourceChipKind(),
    sourceMutes: { ...sourceMutes },
    psgSsg: describePsgMonitor(psgMonitor, psgMonitor.kind === "ssg" ? sourceMutes.ssg : sourceMutes.psg),
    channels: channelMonitor.map((channel) => ({
      channel: channel.channel,
      keyOn: channel.keyOn,
      panLeft: channel.panLeft,
      panRight: channel.panRight,
      algorithm: channel.algorithm,
      feedback: channel.feedback,
      block: channel.block,
      fnum: channel.fnum,
      operators: {
        1: { ...channel.operators[1], changedAt: undefined },
        2: { ...channel.operators[2], changedAt: undefined },
        3: { ...channel.operators[3], changedAt: undefined },
        4: { ...channel.operators[4], changedAt: undefined },
      },
    })),
  };
}

function downloadSnapshot(reason = "manual") {
  const snapshot = buildSnapshotData(reason);
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const stem = lastLoadedFileName.replace(/\.[^.]+$/, "") || "snapshot";
  anchor.download = `${stem}_${reason}_snapshot.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${reason} snapshot.`);
}

function createTfiPresetFromChannelSnapshot(channel) {
  return {
    algorithm: channel.algorithm & 0x07,
    feedback: channel.feedback & 0x07,
    b4: channel.b4Value & 0xff,
    operators: {
      1: {
        multi: channel.operators[1].multi & 0x0f,
        dt: channel.operators[1].dt & 0x07,
        tl: channel.operators[1].tl & 0x7f,
        rs: channel.operators[1].rs & 0x03,
        ar: channel.operators[1].ar & 0x1f,
        d1r: channel.operators[1].d1r & 0x1f,
        d2r: channel.operators[1].d2r & 0x1f,
        rr: channel.operators[1].rr & 0x0f,
        sl: channel.operators[1].sl & 0x0f,
        ssg: channel.operators[1].ssg & 0x0f,
      },
      2: {
        multi: channel.operators[2].multi & 0x0f,
        dt: channel.operators[2].dt & 0x07,
        tl: channel.operators[2].tl & 0x7f,
        rs: channel.operators[2].rs & 0x03,
        ar: channel.operators[2].ar & 0x1f,
        d1r: channel.operators[2].d1r & 0x1f,
        d2r: channel.operators[2].d2r & 0x1f,
        rr: channel.operators[2].rr & 0x0f,
        sl: channel.operators[2].sl & 0x0f,
        ssg: channel.operators[2].ssg & 0x0f,
      },
      3: {
        multi: channel.operators[3].multi & 0x0f,
        dt: channel.operators[3].dt & 0x07,
        tl: channel.operators[3].tl & 0x7f,
        rs: channel.operators[3].rs & 0x03,
        ar: channel.operators[3].ar & 0x1f,
        d1r: channel.operators[3].d1r & 0x1f,
        d2r: channel.operators[3].d2r & 0x1f,
        rr: channel.operators[3].rr & 0x0f,
        sl: channel.operators[3].sl & 0x0f,
        ssg: channel.operators[3].ssg & 0x0f,
      },
      4: {
        multi: channel.operators[4].multi & 0x0f,
        dt: channel.operators[4].dt & 0x07,
        tl: channel.operators[4].tl & 0x7f,
        rs: channel.operators[4].rs & 0x03,
        ar: channel.operators[4].ar & 0x1f,
        d1r: channel.operators[4].d1r & 0x1f,
        d2r: channel.operators[4].d2r & 0x1f,
        rr: channel.operators[4].rr & 0x0f,
        sl: channel.operators[4].sl & 0x0f,
        ssg: channel.operators[4].ssg & 0x0f,
      },
    },
  };
}

function downloadSnapshotTfiZip() {
  if (currentChipKind === "ym2151") { downloadOpmTfiZip(true); return; }
  if (!currentBuffer) {
    return;
  }

  const files = channelMonitor.map((channel) => ({
    name: `snapshot_ch${channel.channel + 1}.tfi`,
    data: createTfiFromPreset(createTfiPresetFromChannelSnapshot(channel)),
  }));
  const blob = createStoredZip(files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const stem = lastLoadedFileName.replace(/\.[^.]+$/, "") || "snapshot";
  anchor.download = `${stem}_snapshot_tfi.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("Exported snapshot TFI ZIP.");
}

function downloadSnapshotVgiZip() {
  if (!currentBuffer) return;
  const files = channelMonitor.map((channel) => ({
    name: `snapshot_ch${channel.channel + 1}.vgi`,
    data: createVgiFromPreset(createTfiPresetFromChannelSnapshot(channel)),
  }));
  const blob = createStoredZip(files);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const stem = lastLoadedFileName.replace(/\.[^.]+$/, "") || "snapshot";
  anchor.download = `${stem}_snapshot_vgi.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("Exported snapshot VGI ZIP.");
}

async function ensurePlaybackReady(vgm) {
  const nextChipKind = selectPlaybackConfiguration(vgm).kind;
  const nextClockKey = JSON.stringify([nextChipKind, vgm.header.huc6280Clock, vgm.header.okim6258Clock, vgm.header.okim6258Flags, vgm.header.ym2612Clock, vgm.header.psgClock,
    vgm.header.ymf278bClock, vgm.header.ym3526Clock, vgm.header.ym3812Clock, vgm.header.ymf262Clock, vgm.header.segaPcmClock, vgm.header.segaPcmBankShift, vgm.header.segaPcmBankMask, vgm.header.nesApuClock, vgm.header.gameBoyDmgClock, vgm.header.ym2151Clock, vgm.header.ay8910Clock, vgm.header.ay8910Type, vgm.header.ay8910Flags, vgm.header.y8950Clock, vgm.header.k051649Clock, vgm.header.ym2413Clock, vgm.header.rf5c164Clock, vgm.header.ym2203Clock, vgm.header.ym2608Clock, vgm.header.ym2610Clock]);

  if (engine && (currentChipKind !== nextChipKind || engineClockKey !== nextClockKey)) {
    stopActiveStream();
    if (typeof engine.dispose === "function") {
      engine.dispose();
    }
    engine = null;
    player = null;
    baseEngineWriteYm2612 = null;
    baseEngineWriteYm2203 = null;
    baseEngineWriteYm2608 = null;
    baseEngineWriteYm2610 = null;
    workletModuleReady = false;
  }

  currentChipKind = nextChipKind;
  noteishHeader = vgm.header;

  currentHasPcm = Boolean(vgm.header.rf5c164Clock);
  currentPcmClock = vgm.header.rf5c164Clock & 0x3fffffff;

  if (!engine) {
    engine = await createPlaybackEngine(vgm, {getFactory: getBrowserPlaybackFactory, masterVolume,
      roms: {ym2608AdpcmA:ym2608AdpcmARomBytes, ymf278bWave:ymf278bWaveRomBytes}});
    if (["msx", "huc6280", "y8950", "ymf278b", "ym3526", "ym3812", "ymf262", "segapcm", "nes", "gameboy"].includes(currentChipKind)) {
      const chip = currentChipKind;

      if (chip === 'msx') observeMsxNotes(engine, () => apuNoteMonitor, updateApuNoteMonitor, resetApuNoteChannels);
      if (isOpl(chip)) {
        const method=chip==='y8950'?'writeY8950':chip==='ym3526'?'writeYm3526':'writeYm3812';
        const write=engine[method].bind(engine), reset=engine.reset.bind(engine);
        engine[method]=(r,v)=>{write(r,v);applyOplWrite(apuNoteMonitor,r,v);updateApuNoteMonitor();requestChannelMonitorRender();};
        engine.reset=()=>{reset();resetApuNoteChannels();requestChannelMonitorRender();};
      }
      if (chip === 'ymf262' || chip === 'ymf278b') {
        const method=chip === 'ymf278b' ? 'writeYmf278b' : 'writeYmf262';
        const write=engine[method].bind(engine), reset=engine.reset.bind(engine);
        engine[method]=(p,r,v)=>{write(p,r,v);if(p===0||p===1){applyOpl3Write(apuNoteMonitor,r,v,p);updateApuNoteMonitor();}};
        engine.reset=()=>{reset();resetApuNoteChannels();};
      }
      if (chip === 'huc6280') {
        const write=engine.writeHuc6280.bind(engine), reset=engine.reset.bind(engine);
        // Stream writes call this method too, including select/restore writes.
        engine.writeHuc6280=(r,v)=>{write(r,v);if(applyHuc6280Write(apuNoteMonitor,r,v))updateApuNoteMonitor();};
        engine.reset=()=>{reset();resetApuNoteChannels();};
      }
      if (chip === 'nes') {
        const write=engine.writeNesApu.bind(engine), reset=engine.reset.bind(engine);
        engine.writeNesApu=(r,v)=>{write(r,v);if(applyNesWrite(apuNoteMonitor,r,v))updateApuNoteMonitor();};
        engine.reset=()=>{reset();resetApuNoteChannels();};
      }
      if (chip === 'gameboy') {
        const gbWrite = engine.writeGameboyApu.bind(engine), gbReset = engine.reset.bind(engine);
        engine.writeGameboyApu = (r, v) => { gbWrite(r, v); if (applyGameboyWrite(apuNoteMonitor, r, v)) updateApuNoteMonitor(); };
        engine.reset = () => { gbReset(); resetApuNoteChannels(); };
      }
      observePsgPlaybackEngine();
    } else if (currentChipKind === "ym2151") {
      observeOpmEngine(engine, opmMonitor, requestChannelMonitorRender);
      const opmWrite = engine.writeYm2151.bind(engine), opmReset = engine.reset.bind(engine);
      engine.writeYm2151 = (r,v) => {opmWrite(r,v);opmNoteTracker?.write(r,v,player?.processedWaitSamples ?? 0);};
      engine.reset = () => {opmReset();resetOpmNotes(vgm.header.ym2151Clock & 0x3fffffff);};
      observePsgPlaybackEngine();
    } else if (currentChipKind === "ay8910") {
      const reset = engine.reset.bind(engine);
      const ayTarget = engine.getVgmTarget?.('ay8910', 0);
      const onAyWrite = (r,v) => {
        ayMonitor.write(r,v);
        if (applySsgWrite(psgMonitor, 0, r, v, performance.now())) updateToneMonitor();
        requestChannelMonitorRender();
      };
      if (ayTarget) {
        const write = ayTarget.writeRegister;
        ayTarget.writeRegister = (r,v) => {write(r,v);onAyWrite(r,v);};
      } else {
        const write = engine.writeAy8910.bind(engine);
        engine.writeAy8910 = (r,v) => {write(r,v);onAyWrite(r,v);};
      }
      if (vgm.header.ym2413Clock & 0x3fffffff) {
        const onOpllWrite = (r,v) => { ym2413Monitor.write(r,v); updateYm2413ToneMonitor(); requestChannelMonitorRender(); };
        const opllTarget = engine.getVgmTarget?.('ym2413', 0);
        if (opllTarget) {
          const write = opllTarget.writeRegister;
          opllTarget.writeRegister = (r,v) => {write(r,v);onOpllWrite(r,v);};
        } else {
          const write = engine.writeYm2413.bind(engine);
          engine.writeYm2413 = (r,v) => {write(r,v);onOpllWrite(r,v);};
        }
        ym2413Monitor.load(vgm.header);
        resetYm2413NoteChannels();
      }
      engine.reset = () => {reset();ayMonitor.reset();if (vgm.header.ym2413Clock & 0x3fffffff) {ym2413Monitor.reset();resetYm2413NoteChannels();}resetPsgMonitor();};
    } else if (currentChipKind === "ym2413") {
      const opllReset = engine.reset.bind(engine);
      const opllWrite = engine.writeYm2413.bind(engine);
      engine.writeYm2413 = (r,v) => {opllWrite(r,v);ym2413Monitor.write(r,v);updateYm2413ToneMonitor();requestChannelMonitorRender();};
      engine.reset = () => {opllReset();ym2413Monitor.reset();resetYm2413NoteChannels();};
      observePsgPlaybackEngine();
    } else if (currentChipKind === "ym2610") {
      observePsgPlaybackEngine();
      baseEngineWriteYm2610 = engine.writeYm2610B.bind(engine);
    } else if (currentChipKind === "ym2203") {
      observePsgPlaybackEngine();
      baseEngineWriteYm2203 = engine.writeYm2203.bind(engine);
    } else if (currentChipKind === "ym2608") {
      observePsgPlaybackEngine();
      baseEngineWriteYm2608 = engine.writeYm2608.bind(engine);
    } else if (currentChipKind === "ym2612") {
      observePsgPlaybackEngine();
      baseEngineWriteYm2612 = engine.writeYm2612.bind(engine);
    }
  }
  engineClockKey = nextClockKey;
  if (currentChipKind === "ym2203") channelMonitor.forEach((channel, index) => engine.setChannelMuted(index, channel.muted));
  if (CHANNEL_MUTE_CHIPS.includes(currentChipKind)) channelMutesForChip(currentChipKind).forEach((muted, index) => engine.setChannelMuted(index, muted));
  if (currentChipKind === 'ymf278b') {
    ymf278bFmChannelMutes.forEach((muted, index) => engine.setChannelMuted(index, muted));
    ymf278bPcmChannelMutes.forEach((muted, index) => engine.setPcmChannelMuted(index, muted));
  }
  if (currentChipKind === "ay8910") ayMonitor.applyMutes(engine);
  else if (['msx', 'y8950'].includes(currentChipKind)) {
    for (const control of msxMuteControls(currentChipKind, noteishHeader)) applyMsxMute(engine, currentChipKind, control, msxMutes.get(control.key) ?? false);
  }
  else applySourceMutes(engine, sourceChipKind(), effectiveSourceMutes(), hasOkiSource());
  if (!player) {
    player = new VgmPlayer(engine);
  }
  applyMasterVolume();
  if (typeof player.setPrefetchFactor === "function") {
    player.setPrefetchFactor(Number(prefetchFactorSelect.value));
  }

  const sampleRate = engine.sampleRate();

  if (!audioContext || audioContext.sampleRate !== sampleRate) {
    if (audioContext) {
      await audioContext.close();
    }
    audioContext = new AudioContext({ sampleRate });
  }
  if (audioContext.state !== "running") {
    await audioContext.resume();
  }

  player.setLoopEnabled(loopCheckbox.checked);
  if (currentChipKind === 'ymf278b' && ymf278bWaveRomBytes) engine.loadWaveRom(ymf278bWaveRomBytes);
  player.load(currentBuffer, {logger:{warn:reportPlaybackWarning}});
  return { sampleRate };
}

function isPlaybackReady() {
  return Boolean(
    currentBuffer &&
    engine &&
    player &&
    audioContext &&
    audioContext.state === "running"
  );
}

function beginPreparePlayback(vgm) {
  if (playbackPreparePromise || isPlaybackReady()) {
    return playbackPreparePromise;
  }

  setStatus(
    "Preparing audio..."
  );
  playbackPreparePromise =
    ensurePlaybackReady(vgm)
      .then(() => {
        setPlaybackError();
        setStatus(`Audio ready.${currentStatusSuffix()}`);
      })
      .catch((error) => {
        reportPlaybackError(error);
      })
      .finally(() => {
        playbackPreparePromise = null;
      });

  return playbackPreparePromise;
}

function stopActiveStream() {
  if (!activeStream) {
    return;
  }
  if (activeStream.mode === "script") {
    activeStream.node.onaudioprocess = null;
  } else if (activeStream.mode === "worklet") {
    activeStream.node.port.onmessage = null;
  }
  activeStream.node.disconnect();
  activeStream = null;
}

function updatePlaybackButtons(state = {}) {
  const hasBuffer = Boolean(currentBuffer);
  playbackSeek.disabled = !hasBuffer || Number(playbackSeek.max) <= 0 || Boolean(timelineSeekController);
  updateSeekPosition();
  exportMmlButton.disabled = !hasBuffer || !(currentChipKind === "ym2151" || currentChipKind === "ay8910" || currentChipKind === "ym2413" || ["ym2612", "ym2203", "ym2608", "ym2610"].includes(midiChipKind(noteishHeader)));
  exportMidiButton.disabled = !hasBuffer || !midiExportAvailable;
  const playing = Boolean(state.playing);
  const paused = Boolean(state.paused);
  playButton.disabled = !hasBuffer || playing || wavExportBusy;
  playButton.textContent = paused ? "Resume" : "Play";
  replayButton.disabled = !hasBuffer || wavExportBusy;
  pauseButton.disabled = !playing || wavExportBusy;
  stopButton.disabled = !hasBuffer || (!playing && !paused) || wavExportBusy;
  exportWavButton.disabled = !hasBuffer || wavExportBusy;
  exportParseInfoButton.disabled = !hasBuffer || !lastParseInfo;
  exportSnapshotTfiButton.disabled = !hasBuffer;
  exportSnapshotVgiButton.disabled = !hasBuffer;
  exportSnapshotButton.disabled = !hasBuffer;
  updateChipSupport();
}

// Keep the first playback-only chip boundary local until more features are implemented.
function updateChipSupport() {
  sheetMusicTab.disabled = !currentBuffer || !(midiExportAvailable || (currentChipKind === 'ymf262' && !(noteishHeader.ymf262Clock & 0xc0000000)));
  document.getElementById('showSheetMusicButton').disabled = sheetMusicTab.disabled;
  musicSheet?.updateTrack();
  document.getElementById("exportMusicSheetButton").disabled = !currentBuffer || !(midiExportAvailable || (currentChipKind === 'ymf262' && !(noteishHeader.ymf262Clock & 0xc0000000)));
  exportLilyPondButton.disabled = !currentBuffer || !(midiExportAvailable || (currentChipKind === 'ymf262' && !(noteishHeader.ymf262Clock & 0xc0000000)));
  exportAllOpmButton.hidden = exportOpmButton.hidden = currentChipKind !== 'ym2151';
  exportAllOpmButton.disabled = exportOpmButton.disabled = currentChipKind !== 'ym2151' || !currentBuffer;
  tfiInfoTab.textContent = currentChipKind === 'ym2151' ? 'OPM Info' : 'Tfi info';
  const ay = currentChipKind === 'ay8910';
  const opll = currentChipKind === 'ym2413';
  const opl = isOpl(currentChipKind);
  const ayWithOpll = ay && Boolean(noteishHeader.ym2413Clock & 0x3fffffff);
  const playbackOnly = ['huc6280', 'okim6258', 'msx', 'y8950', 'ymf278b', 'ym3526', 'ym3812', 'ymf262', 'segapcm', 'ym2151', 'ym2413', 'nes', 'gameboy'].includes(currentChipKind) || ay;
  for (const tab of [operatorInfoTab, noteishTab, tfiInfoTab, sampleTab]) {
    tab.disabled = playbackOnly && !((ay || opll || opl || currentChipKind === 'ym2151') && tab === operatorInfoTab) && !((currentChipKind === 'ym2151' && (tab === noteishTab || tab === tfiInfoTab)) || ((ay || opll || opl || ['msx','huc6280','gameboy','nes','ymf278b','ymf262'].includes(currentChipKind)) && tab === noteishTab));
    tab.title = tab.disabled ? 'Support coming soon.' : '';
  }
  for (const button of [exportMidiButton, exportMmlButton, exportSnapshotTfiButton,
    exportSnapshotVgiButton, exportSnapshotButton, exportAllTfiButton, exportAllVgiButton]) {
    if (currentChipKind === 'ym2151' && (button === exportAllTfiButton || button === exportSnapshotTfiButton)) {
      button.disabled = !currentBuffer;
      button.title = OPM_TFI_NOTICE;
      continue;
    }
    if (currentChipKind === 'ym2151' && (button === exportMidiButton || button === exportMmlButton)) {
      button.disabled = !currentBuffer || (button === exportMidiButton && !midiExportAvailable);
      button.title = button === exportMidiButton ? 'Export base-pitch notes; original YM2151 timbres are not reproduced.' : 'MXDRV MML: FM 8CH and sampled voices on a sixteenth-note grid.';
      continue;
    }
    if (ay && (button === exportMidiButton || button === exportMmlButton)) {
      button.disabled = !currentBuffer || (button === exportMidiButton && !midiExportAvailable);
      button.title = button === exportMidiButton ? 'Export base-pitch tone notes; SSG envelope/noise are not reproduced.' : 'MGSDRV MML: PSG tone on a sixteenth-note grid.';
      continue;
    }
    if (opll && (button === exportMidiButton || button === exportMmlButton)) {
      button.disabled = !currentBuffer || (button === exportMidiButton && !midiExportAvailable);
      button.title = button === exportMidiButton ? 'Export base-pitch FM notes; rhythm channels other than Bass Drum are omitted.' : 'MGSDRV MML: FM base pitch on a sixteenth-note grid; rhythm channels other than Bass Drum are omitted.';
      continue;
    }
    if ((opl || currentChipKind === 'ymf278b' || currentChipKind === 'msx') && button === exportMidiButton) {
      button.disabled = !currentBuffer || !midiExportAvailable;
      button.title = currentChipKind === 'msx' ? 'MSX base pitches; ADPCM, noise and original timbres omitted. More than 15 channels require multi-port MIDI support.' : currentChipKind === 'ymf278b' ? 'FM base pitches; PCM and rhythm omitted. MIDI playback requires multi-port support.' : 'OPL base pitches; rhythm, CSM and original timbres are omitted.';
      continue;
    }
    if (['huc6280','gameboy','nes'].includes(currentChipKind) && button === exportMidiButton) {
      button.disabled = !currentBuffer || !midiExportAvailable;
      button.title = currentChipKind === 'huc6280' ? 'Export six-channel wavetable base pitches; PCM/DDA, noise and LFO intervals are omitted.' : 'Export base-pitch CH1/CH2 (square) and CH3 (wave) notes; CH4 noise, length counter and channel 1 sweep are not reproduced.';
      continue;
    }
    if (playbackOnly) button.disabled = true;
    button.title = playbackOnly ? 'Support coming soon.' : '';
  }
  const notice = document.getElementById('chipSupportNotice');
  notice.hidden = !playbackOnly;
  notice.textContent = currentChipKind === 'msx' ? 'MSX AY / OPLL / Y8950 / SCC / SCC+: Live and Song Note-ish, Sheet Music, MIDI / MusicXML / LilyPond use base pitches. ADPCM, noise, timbre and modulation are omitted. SCC waveform harmonics and rewriting are not transcribed. More than 15 channels require multi-port MIDI playback.' : currentChipKind === 'ymf278b' ? 'YMF278B FM Note-ish: 18-channel 2op/4op base pitches; pairs use the leading CH. PCM voices, rhythm, timbre, modulation and release are omitted. FM Sheet Music / MIDI / MusicXML / LilyPond export available. PCM Sample Explorer support is planned.' : currentChipKind === 'huc6280' ? 'HuC6280 Note-ish: 6-channel wavetable base pitches. PCM/DDA, noise and LFO CH1/CH2 intervals are omitted from notes. MIDI / MusicXML / LilyPond and WAV export available. Original timbres and PCM pitch are not reconstructed; instrument editing: Support coming soon.' : opl ? 'OPL / OPL2 / Y8950: 9-channel base-pitch Note-ish, MIDI, MusicXML and LilyPond. Rhythm CH7–9, CSM and Y8950 ADPCM are omitted. Voice / Operator Info includes a register-state JSON snapshot export; no TFI/VGI conversion or instrument editing.' : currentChipKind === 'ymf262' ? 'YMF262 Note-ish / Sheet Music / MusicXML / LilyPond: 2op and 4op base pitches; pairs use the leading CH. Rhythm, timbre, modulation and release are omitted. MIDI export is not supported.' : currentChipKind === 'ym2151' ? 'YM2151 register monitor available. Base-pitch Note-ish available; noise/partial keys/CSM are omitted. MIDI base-pitch export available. OPM snapshots are available in the Export group. MXDRV MML export available. Instrument editing: Support coming soon.' : ay ? 'AY / YM2149 register monitor and base-pitch Note-ish available; noise/envelope shape are omitted. MIDI and LilyPond/Music Sheet base-pitch export available. Instrument editing and MML export: Support coming soon.' : opll ? 'YM2413 register monitor and base-pitch Note-ish available: FNUM/BLOCK base pitch, instrument number, volume and rhythm mode state; rhythm channels other than Bass Drum have no single pitch. MIDI and LilyPond/Music Sheet base-pitch export available. Instrument editing and MML export: Support coming soon.' : ['gameboy','nes','ymf278b','ymf262'].includes(currentChipKind) ? (currentChipKind==='nes'?'NES APU / FDS: pulse, triangle and optional FDS base-pitch notes, MIDI and Music Sheet. FDS modulation and envelope timing are not transcribed. Noise/DMC are omitted from scores; time-based modulation is approximate.': 'Game Boy DMG base-pitch Note-ish available for CH1/CH2 (square) and CH3 (wave); CH4 (noise) has no pitch, and length counter/CH1 sweep are not reconstructed. MIDI and LilyPond/Music Sheet base-pitch export available. Register monitor, instrument editing and MML export: Support coming soon.') : `${currentChipKind.toUpperCase()} analysis and instrument editing: Support coming soon.`;
  oplMonitorRoot.hidden = !opl;
  opnMonitorRoot.hidden = opl || ay || opll || currentChipKind === 'ym2151';
  opmMonitorRoot.hidden = currentChipKind !== 'ym2151';
  ayMonitorRoot.hidden = !ay;
  ym2413MonitorRoot.hidden = !(opll || ayWithOpll);
  if (sheetMusicTab.getAttribute('aria-selected') === 'true' && !sheetMusicTab.disabled) return;
  if (['okim6258', 'segapcm'].includes(currentChipKind)) setOutputTab('parsed-output');
  else if (['msx','huc6280','gameboy','nes','ymf278b','ymf262'].includes(currentChipKind) && noteishTab.getAttribute('aria-selected') !== 'true' && parsedOutputTab.getAttribute('aria-selected') !== 'true') setOutputTab('noteish');
  else if (((ay || opll || opl || currentChipKind === 'ym2151') && noteishTab.getAttribute('aria-selected') !== 'true' && (tfiInfoTab.disabled || tfiInfoTab.getAttribute('aria-selected') !== 'true')) && operatorInfoTab.getAttribute('aria-selected') !== 'true' && parsedOutputTab.getAttribute('aria-selected') !== 'true') setOutputTab('operator-info');
}

function buildParseInfo(buffer, fileName, vgm) {
  const commandUsage = Array.from(vgm.analyzeCommandUsage().entries()).map(([command, count]) => ({
    command,
    count,
  }));
  const dataBlocks = vgm.dataBlockSummary();
  const specialCommands = vgm.analyzeSpecialCommands();
  const pcmRamWrites = vgm.pcmRamWriteSummary();
  const command92Context = vgm.analyzeCommandContext(0x92);
  const previewParser = new Ym2612VGM(buffer, { logger: null });
  const allCommands = [];
  let timeSamples = 0;
  try {
    for (let index = 0; ; index += 1) {
      const event = previewParser.step();
      allCommands.push({
        index,
        timeSamples,
        timeSeconds: timeSamples / 44100,
        ...event,
      });
      if (event.type === "wait") {
        timeSamples += event.samples;
      }
      if (event.type === "end") {
        break;
      }
    }
  } catch (error) {
    allCommands.push({
      index: allCommands.length,
      timeSamples,
      timeSeconds: timeSamples / 44100,
      type: "error",
      message: error.message,
    });
  }

  return {
    type: "tetorica-fm2612-parse-info",
    createdAt: new Date().toISOString(),
    sourceFile: fileName,
    metadata: parseVgmMetadata(buffer),
    header: { ...vgm.header },
    allCommands,
    commandUsage,
    dataBlocks,
    specialCommands,
    pcmRamWrites,
    command92Context,
  };
}

function downloadParseInfo() {
  if (!lastParseInfo) {
    return;
  }
  const json = JSON.stringify(lastParseInfo, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const stem = lastLoadedFileName.replace(/\.[^.]+$/, "") || "parse_info";
  anchor.download = `${stem}_parse_info.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("Exported parse info JSON.");
}

async function playCurrentVgm(startSample = 0) {
  const revision = playlistRevision;
  if (timelineSeekController) return;
  if (!currentBuffer) {
    return;
  }

  const parser = new Ym2612VGM(currentBuffer);
  const wasReady = isPlaybackReady();
  // Give instant feedback before the (possibly slow, first-time WASM) prep
  // await below, so the button doesn't look frozen while nothing is playing yet.
  playButton.disabled = true;
  if (!wasReady) playButton.textContent = "Preparing...";
  try {
    if (!wasReady) {
      await beginPreparePlayback(parser);
      if (revision !== playlistRevision) return;
      if (!isPlaybackReady()) {
        return;
      }
    }

    stopActiveStream();

    const { sampleRate } = await ensurePlaybackReady(parser);
    setPlaybackError();
    if (revision !== playlistRevision) return;
    channelMonitor = createChannelMonitorState();
    monitorFrequencyHigh = [0, 0];
    resetPsgMonitor();
    renderChannelMonitor();
    requestNoteishRender();
    renderNoteishGrid();
    engine.reset();
    lastYm2612DacEnable = 0x00;
    if ((["ym2612", "ym2608", "ym2610"].includes(currentChipKind))) {
      const baseWriteFm = currentChipKind === "ym2612"
        ? baseEngineWriteYm2612
        : currentChipKind === "ym2610" ? baseEngineWriteYm2610 : baseEngineWriteYm2608;
      if (typeof baseWriteFm === "function") {
        if (currentChipKind === "ym2612") {
          engine.writeYm2612 = (port, register, value) => {
            applyYm2612WriteToMonitor(port, register, value);
            if (port === 0 && register === 0x2b) {
              lastYm2612DacEnable = value;
            }
            if (port === 0 && register === 0x2a && channelMonitor[5].muted) {
              // CH6 mute should suppress DAC sample writes too.
              baseEngineWriteYm2612(port, register, 0x80);
              return;
            }
            if (register >= 0xb4 && register <= 0xb6) {
              const channelIndex = (port === 0 ? 0 : 3) + (register - 0xb4);
              baseEngineWriteYm2612(port, register, effectivePanValue(channelMonitor[channelIndex]));
              return;
            }
            baseEngineWriteYm2612(port, register, value);
          };
        } else {
          engine[currentChipKind === "ym2610" ? "writeYm2610B" : "writeYm2608"] = (port, register, value) => {
            applyYm2612WriteToMonitor(port, register, value);
            if (register >= 0xb4 && register <= 0xb6) {
              const channelIndex = (port === 0 ? 0 : 3) + (register - 0xb4);
              baseWriteFm(port, register, effectivePanValue(channelMonitor[channelIndex]));
              return;
            }
            baseWriteFm(port, register, value);
          };
        }
      }
    } else if (currentChipKind === "ym2203" && baseEngineWriteYm2203) {
      engine.writeYm2203 = (register, value) => {
        applyYm2203WriteToMonitor(register, value);
        baseEngineWriteYm2203(register, value);
      };
    }
    player.reset();
    player.setLoopEnabled(loopCheckbox.checked);
    if (startSample > 0) {
      timelineSeekController = new AbortController();
      playbackSeek.disabled = true;
      songTimeline.busy(true, 'Moving to cursor…');
      try {
        await seekPlayback(player, startSample, {
          signal: timelineSeekController.signal,
          onProgress: p => songTimeline.busy(true, `Moving to cursor… ${Math.round(p * 100)}%`),
        });
      } finally {
        timelineSeekController = null;
        songTimeline.busy(false);
      }
    }
    timelineSelectionPending = false;
    seekSelection = null;
    player.play();
    const started = await startWorkletStream(sampleRate) || startScriptProcessorStream();
    if (revision !== playlistRevision) {
      stopActiveStream();
      player?.stop();
      return;
    }
    if (!started) {
      throw new Error("Failed to create an audio output stream");
    }

    updatePlaybackButtons(player.stats());
      setStatus(`Streaming VGM at ${sampleRate} Hz...${currentStatusSuffix()}`);
  } catch (error) {
    stopActiveStream();
    player?.stop();
    timelineSelectionPending = true;
    if (error.name === 'AbortError') setStatus('Seek cancelled. Cursor retained.');
    else { reportPlaybackError(error); }
  } finally {
    updatePlaybackButtons(player ? player.stats() : {});
  }
}

function updateStreamingStatus(extra = "") {
  if (!player) {
    return;
  }
  const stats = player.stats();
  const suffix = extra === "" ? "" : ` ${extra}`;
  setStatus(
    `Streaming VGM... commands=${stats.processedEvents} queued=${stats.queuedFrames} audio=${stats.audioProgress.toFixed(1)}% loop=${loopCheckbox.checked ? "on" : "off"}${suffix}`,
  );
}

function currentWorkletTargetFrames() {
  if (!activeStream || activeStream.mode !== "worklet") {
    return 4096;
  }
  return Math.max(
    activeStream.chunkFrames,
    Math.floor(activeStream.chunkFrames * workletQueueMultiplier),
  );
}

function scheduleWorkletPump() {
  if (!activeStream || activeStream.mode !== "worklet" || workletPumpScheduled) {
    return;
  }
  workletPumpScheduled = true;
  window.setTimeout(() => {
    workletPumpScheduled = false;
    pumpWorkletChunks();
  }, 0);
}

function pumpWorkletChunks(targetFrames = currentWorkletTargetFrames()) {
  if (player?.isPaused()) return;
  if (!activeStream || activeStream.mode !== "worklet") {
    return;
  }

  let chunksQueued = 0;
  while (activeStream.workletQueuedFrames < targetFrames && chunksQueued < 1) {
    const statsBefore = player.stats();
    if (!statsBefore.playing && !statsBefore.paused && statsBefore.queuedFrames === 0) {
      if (!activeStream.endSent) {
        activeStream.node.port.postMessage({ type: "end" });
        activeStream.endSent = true;
      }
      break;
    }

    const frames = activeStream.chunkFrames;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    player.process(left, right, frames);
    applyAnalyzerMuteToBuffer(left, right, frames);
    activeStream.workletQueuedFrames += frames;
    activeStream.node.port.postMessage(
      { type: "enqueue", left: left.buffer, right: right.buffer },
      [left.buffer, right.buffer],
    );
    chunksQueued += 1;
  }

  // Send the end marker immediately: the startup buffer of a short track
  // may never reach the target, so waiting for consumption would deadlock.
  const completed = player.stats();
  if (!completed.playing && !completed.paused && completed.queuedFrames === 0 && !activeStream.endSent) {
    activeStream.node.port.postMessage({ type: "end" });
    activeStream.endSent = true;
  }
  requestPlaybackUiRender("(AudioWorklet)");

  if (activeStream.workletQueuedFrames < targetFrames) {
    const statsAfter = player.stats();
    if (statsAfter.playing || statsAfter.paused || statsAfter.queuedFrames > 0) {
      scheduleWorkletPump();
    }
  }
}

async function startWorkletStream(sampleRate) {
  if (!audioContext.audioWorklet) {
    return false;
  }
  if (!workletModuleReady) {
    try {
      await audioContext.audioWorklet.addModule("../js/vgm-output-worklet.js?v=buffered-start-1");
      workletModuleReady = true;
    } catch (error) {
      console.warn("AudioWorklet module load failed; falling back to ScriptProcessorNode.", error);
      return false;
    }
  }

  const chunkFrames = 2048;
  const node = new AudioWorkletNode(audioContext, "vgm-output-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {startupFrames: Math.max(chunkFrames, Math.floor(chunkFrames * workletQueueMultiplier))},
  });
  const stream = {
    mode: "worklet",
    node,
    chunkFrames,
    workletQueuedFrames: 0,
    endSent: false,
  };
  activeStream = stream;
  node.port.onmessage = (event) => {
    if (activeStream !== stream) {
      return;
    }
    const data = event.data || {};
    if (typeof data.queuedFrames === "number") {
      stream.workletQueuedFrames = data.queuedFrames;
    }
    if (data.ended) {
      if (activeStream === stream) {
        stopActiveStream();
      }
      resetTimelineToStart();
      requestPlaybackUiRender("");
      setStatus(`Ready.${currentStatusSuffix()}`);
      advancePlaylist();
      return;
    }
    scheduleWorkletPump();
  };
  rewireAudioGraph();
  pumpWorkletChunks();
  return true;
}

function startScriptProcessorStream() {
  const bufferSize = 2048;
  const node = audioContext.createScriptProcessor(bufferSize, 0, 2);
  activeStream = { mode: "script", node };
  node.onaudioprocess = (event) => {
    const left = event.outputBuffer.getChannelData(0);
    const right = event.outputBuffer.getChannelData(1);
    if (player.isPaused()) { left.fill(0); right.fill(0); return; }
    player.process(left, right, bufferSize);
    applyAnalyzerMuteToBuffer(left, right, bufferSize);
    const stats = player.stats();
    requestPlaybackUiRender("(ScriptProcessor)");

    if (!stats.playing && !stats.paused && stats.queuedFrames === 0) {
      stopActiveStream();
      resetTimelineToStart();
      requestPlaybackUiRender("");
      setStatus(`Ready.${currentStatusSuffix()}`);
      advancePlaylist();
    }
  };
  rewireAudioGraph();
  return true;
}

async function handleFile(file, preserveEditor = false) {
  if (!preserveEditor) commandEditor.load(null);
  msxMutes.clear();
  exportAllOpmButton.disabled = exportOpmButton.disabled = true;
  opmMonitor.reset();
  opmMonitor.render();
  setPlaybackError();
  clearPlaybackWarnings();
  currentBuffer = null;
  playButton.disabled = true;
  seekSelection = null;
  seekDragging = false;
  playbackSeek.max = "0";
  playbackSeek.disabled = true;
  renderSeekPosition(0);
  metadataOutput.textContent = "Loading metadata…";
  sampleExplorer.reset();
  timelineSeekController?.abort();
  songTimeline.clear();
  timelineSelectionPending = true;
  stopActiveStream();
  player?.pause();
  setStatus(`Loading ${file.name}...`);
  lastLoadedFileName = file.name;
  const rawBuffer = await file.arrayBuffer();
  currentBuffer = null;
  exportMmlButton.disabled = true;
  exportMidiButton.disabled = true;
  document.getElementById("exportMusicSheetButton").disabled = true;
  exportLilyPondButton.disabled = true;
  midiExportAvailable = false;
  lastParseInfo = null;
  playButton.disabled = true;
  channelMonitor = createChannelMonitorState();
  monitorFrequencyHigh = [0, 0];
  resetPsgMonitor();
  renderChannelMonitor();
  requestNoteishRender();
  renderNoteishGrid();

  let buffer;
  let sourceHeader = null;
  try {
    buffer = await maybeDecodeVgmFile(rawBuffer);
    if (looksLikeS98(buffer)) {
      ({ buffer, sourceHeader } = convertS98ToVgm(buffer));
    }
  } catch (error) {
    console.error(error);
    headerOutput.textContent = "Failed to decode VGM/VGZ/S98 file.";
    metadataOutput.textContent = "Metadata unavailable: file could not be decoded.";
    pauseButton.disabled = true;
    replayButton.disabled = true;
    stopButton.disabled = true;
    setStatus(`Error: ${error.message}`);
    detectedChipsOutput.hidden = true;
    return;
  }

  let vgm;
  try {
    vgm = new Ym2612VGM(buffer, {logger:{warn:reportPlaybackWarning}});
  } catch (error) {
    console.error(error);
    headerOutput.textContent = "Failed to parse VGM header.";
    metadataOutput.textContent = "Metadata unavailable: file could not be parsed.";
    pauseButton.disabled = true;
    replayButton.disabled = true;
    stopButton.disabled = true;
    setStatus(`Error: ${error.message}`);
    detectedChipsOutput.hidden = true;
    return;
  }
  renderDetectedChips(vgm.header);

  const nextChipKind = detectPlaybackChipKindFromVgm(vgm);
  if (engine && currentChipKind !== nextChipKind) {
    stopActiveStream();
    if (typeof engine.dispose === "function") {
      engine.dispose();
    }
    engine = null;
    player = null;
    baseEngineWriteYm2612 = null;
    baseEngineWriteYm2203 = null;
    baseEngineWriteYm2608 = null;
    baseEngineWriteYm2610 = null;
    workletModuleReady = false;
  }
  currentChipKind = nextChipKind;
  noteishHeader = vgm.header;
  if (currentChipKind === "ym2151") resetOpmNotes(vgm.header.ym2151Clock & 0x3fffffff);
  if (currentChipKind === "ay8910") ayMonitor.load(vgm.header);
  if (currentChipKind === "ym2413") { ym2413Monitor.load(vgm.header); resetYm2413NoteChannels(); }
  if (["msx","y8950","huc6280","gameboy","nes","ymf278b","ymf262","ym3526","ym3812"].includes(currentChipKind)) resetApuNoteChannels();
  currentHasPcm = Boolean(vgm.header.rf5c164Clock);
  currentPcmClock = vgm.header.rf5c164Clock & 0x3fffffff;
  channelMonitor = createChannelMonitorState();
  monitorFrequencyHigh = [0, 0];
  resetPsgMonitor();
  renderChannelMonitor();
  requestNoteishRender();
  renderNoteishGrid();
  headerOutput.textContent = sourceHeader
    ? `${JSON.stringify(sourceHeader, null, 2)}\n\nNormalized VGM header (command offsets below refer to VGM):\n${renderHeader(vgm.header)}`
    : renderHeader(vgm.header);
  renderMetadata(parseVgmMetadata(buffer));
  commandUsageOutput.textContent = renderCommandUsage(vgm.analyzeCommandUsage());
  commandUsageOutput.textContent += "\n";
  dataBlocksOutput.textContent = renderDataBlocks(vgm.dataBlockSummary());
  specialCommandsOutput.textContent = vgm.analyzeSpecialCommands().join("\n");
  pcmRamWriteOutput.textContent = renderPcmRamWrites(vgm.pcmRamWriteSummary());
  command92ContextOutput.textContent = vgm.analyzeCommandContext(0x92).join("\n");

  ymf278bNeedsWaveRom = vgm.requiresYmf278bWaveRom();
  ym2608NeedsRhythmRom = vgm.requiresYm2608RhythmRom();
  if (ym2608NeedsRhythmRom && !ym2608AdpcmARomBytes) {
    playbackWarnings.add(YM2608_RHYTHM_ROM_WARNING);
    renderPlaybackWarnings();
  }
  if (ymf278bNeedsWaveRom && !ymf278bWaveRomBytes) {
    playbackWarnings.add(YMF278B_ROM_WARNING);
    renderPlaybackWarnings();
  }
  currentBuffer = buffer;
  if (!["okim6258", "segapcm"].includes(currentChipKind)) songTimeline.load(buffer);
  playbackSeek.max = String(Math.max(0, vgm.header.totalSamples));
  renderSeekPosition(0);
  midiExportAvailable = Boolean(midiChipKind(vgm.header) || ((vgm.header.ym2151Clock & 0x3fffffff) && !(vgm.header.ym2151Clock & 0xc0000000)));
  if ((isOpl(currentChipKind) || currentChipKind === 'ymf278b') && (vgm.header[`${currentChipKind}Clock`]&0xc0000000)) midiExportAvailable = false;
  lastParseInfo = buildParseInfo(buffer, file.name, vgm);
  if (sourceHeader) {
    lastParseInfo.sourceHeader = sourceHeader;
    lastParseInfo.commandFormat = "VGM (normalized from S98)";
  }
  extractedTfiPatches = ["huc6280", "okim6258", "msx", "y8950", "ymf278b", "ym3526", "ym3812", "ymf262", "segapcm", "nes", "gameboy", "ym2151", "ym2413", "ay8910"].includes(currentChipKind) ? [] : extractTfiPatchesFromVgm(buffer);
  tfiInfo.loadVgm(buffer, file.name);
  opmInfo.loadVgm(currentChipKind === 'ym2151' ? buffer : null);
  if (tfiInfoTab.getAttribute('aria-selected') === 'true') setOutputTab('tfi-info');
  exportAllTfiButton.disabled = extractedTfiPatches.length === 0;
  exportAllVgiButton.disabled = extractedTfiPatches.length === 0;
  updatePlaybackButtons({});
  if (!preserveEditor) commandEditor.load(buffer, file.name);
  setOutputTab("parsed-output");
  setStatus(`Parsed ${file.name} (${currentHasPcm ? "MEGA-CD" : (currentChipKind === "ym2610" && (noteishHeader.ym2610Clock & 0x80000000) ? "YM2610B" : currentChipKind.toUpperCase())}).${currentStatusSuffix()}`);
}

async function handleYmf278bRomFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length !== 0x200000) throw new Error('yrw801.rom must be exactly 2097152 bytes (2 MiB).');
  stopActiveStream();
  player?.stop();
  ymf278bWaveRomBytes = data;
  ymf278bWaveRomName = file.name;
  if (currentChipKind === 'ymf278b' && engine) engine.loadWaveRom(data);
  playbackWarnings.delete(YMF278B_ROM_WARNING);
  renderPlaybackWarnings();
  setPlaybackError();
  romFileStatus.textContent = `YMF278B wave ROM: ${file.name} (2 MiB)`;
  updatePlaybackButtons({});
  setStatus(`Loaded YMF278B wave ROM: ${file.name}. Press Play to start from the beginning.`);
}

async function handleYm2608RomFile(file) {
  setStatus(`Loading ${file.name}...`);
  const buffer = await file.arrayBuffer();
  ym2608AdpcmARomBytes = new Uint8Array(buffer);
  ym2608AdpcmARomName = file.name;

  if (currentChipKind === "ym2608" && engine && typeof engine.loadAdpcmARom === "function") {
    engine.loadAdpcmARom(ym2608AdpcmARomBytes);
    // The rhythm source was force-muted while the ROM was missing; now that
    // it's loaded, reapply mutes so rhythm follows the user's actual toggle.
    applySourceMutes(engine, sourceChipKind(), effectiveSourceMutes(), hasOkiSource());
  }
  playbackWarnings.delete(YM2608_RHYTHM_ROM_WARNING);
  renderPlaybackWarnings();

  romFileStatus.textContent = `YM2608 ADPCM-A ROM: ${file.name} (${ym2608AdpcmARomBytes.length} bytes)`;
  setStatus(`Loaded YM2608 ADPCM-A ROM: ${file.name} (${ym2608AdpcmARomBytes.length} bytes).`);
}

// Playlist operations share a queue so imports and track changes finish in order.
const playlistFiles = [];
const playlistNameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
let playlistIndex = -1;
let playlistRevision = 0;
let fileLoadQueue = Promise.resolve();
function queuePlaylistTask(task) {
  fileLoadQueue = fileLoadQueue.then(task).catch((error) => {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  });
  return fileLoadQueue;
}

function renderPlaylist() {
  playlistLoopControl.hidden = playlistFiles.length < 2;
  playlistSummary.textContent = playlistFiles.length
    ? `Playlist — ${playlistFiles.length} tracks · ${playlistIndex + 1} selected`
    : "Playlist — no tracks imported";
  playlistList.replaceChildren();
  playlistFiles.forEach((file, index) => {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = file.name;
    button.title = `Play ${file.name}`;
    button.setAttribute("aria-current", index === playlistIndex ? "true" : "false");
    button.addEventListener("click", () => selectPlaylistTrack(index, true));
    row.appendChild(button);
    playlistList.appendChild(row);
  });
}

async function loadPlaylistTrack(index, autoplay, revision) {
  if (revision !== playlistRevision || !playlistFiles[index]) return;
  playlistIndex = index;
  renderPlaylist();
  await handleFile(playlistFiles[index]);
  if (autoplay && currentBuffer && revision === playlistRevision) await playCurrentVgm();
}

function selectPlaylistTrack(index, autoplay) {
  const file = playlistFiles[index];
  if (!file) return;
  const revision = ++playlistRevision;
  stopActiveStream();
  player?.pause();
  timelineSeekController?.abort();
  return queuePlaylistTask(() => loadPlaylistTrack(playlistFiles.indexOf(file), autoplay, revision));
}

function advancePlaylist() {
  if (playlistIndex < 0) return;
  const nextIndex = playlistIndex + 1;
  if (nextIndex < playlistFiles.length) return selectPlaylistTrack(nextIndex, true);
  if (playlistLoopCheckbox.checked && playlistFiles.length > 1) {
    return selectPlaylistTrack(0, true);
  }
}

function importPlaylistFiles(files) {
  const tracks = Array.from(files).filter(file => /\.(vgm|vgz|s98)$/i.test(file.name));
  const revision = tracks.length ? ++playlistRevision : playlistRevision;
  if (tracks.length) {
    stopActiveStream();
    player?.pause();
    timelineSeekController?.abort();
    // A selection is a new playlist. Stable sorting preserves equal-name order.
    tracks.sort((a, b) => playlistNameOrder.compare(a.name, b.name));
    playlistFiles.splice(0, playlistFiles.length, ...tracks);
    playlistIndex = -1;
    renderPlaylist();
  }
  return queuePlaylistTask(async () => {
    const rejected = [];
    for (const file of files) {
      if (/^yrw801\.(rom|bin)$/i.test(file.name)) {
        await handleYmf278bRomFile(file);
      } else if (/\.bin$/i.test(file.name)) {
        await handleYm2608RomFile(file);
      } else if (!/\.(vgm|vgz|s98)$/i.test(file.name)) {
        rejected.push(file.name);
      }
    }
    if (tracks.length) await loadPlaylistTrack(0, false, revision);
    if (rejected.length) setStatus(`Unsupported files: ${rejected.join(", ")}. Import VGM, VGZ, S98 yrw801.rom or a YM2608 ROM .bin file.`);
  });
}

fileInput.addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  void importPlaylistFiles(files);
});
renderPlaylist();

let fileDragDepth = 0;
const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
function clearFileDrag() {
  fileDragDepth = 0;
  document.body.classList.remove("file-drag-active");
}
document.addEventListener("dragenter", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  document.body.classList.add("file-drag-active");
});
document.addEventListener("dragover", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", () => {
  if (fileDragDepth > 0 && --fileDragDepth === 0) clearFileDrag();
});
document.addEventListener("dragend", clearFileDrag);
window.addEventListener("blur", clearFileDrag);
document.addEventListener("drop", (event) => {
  clearFileDrag();
  const files = Array.from(event.dataTransfer?.files || []);
  if (!isFileDrag(event) && !files.length) return;
  // Prevent the browser from navigating to the dropped local file.
  event.preventDefault();
  void importPlaylistFiles(files);
});

let timelineSelectionPending = false;
let timelineSeekController = null;
function resetTimelineToStart() {
  seekSelection = null;
  seekDragging = false;
  renderSeekPosition(0);
  // Un-stick the timeline's busy flag first: it may still be true from an
  // in-flight cursor seek whose own cleanup hasn't run yet, which would
  // otherwise make the cursor(0) reset below a silent no-op.
  songTimeline.busy(false);
  songTimeline.cursor(0, false);
  timelineSelectionPending = false;
}
async function resumeTimelinePlayback() {
  if (!player || timelineSeekController) return;
  if (timelineSelectionPending) { await playCurrentVgm(seekSelection ?? songTimeline.selected()); return; }
  player.resume();
  await audioContext?.resume();
  scheduleWorkletPump();
  updatePlaybackButtons(player.stats());
  setStatus("Resumed.");
}
var songTimeline = createNoteTimeline(document.getElementById('noteTimeline'), {
  onSelect() {
    seekSelection = null;
    timelineSelectionPending = true;
    updateSeekPosition();
    if (player?.isPlaying()) pauseButton.click();
  },
  onPlay: async sample => {
    if (player?.isPaused() && !timelineSelectionPending) await resumeTimelinePlayback();
    else await playCurrentVgm(sample);
  },
  onPause: () => pauseButton.click(),
  onCancel: () => timelineSeekController?.abort(),
});


playbackSeek.addEventListener("input", () => {
  seekDragging = true;
  renderSeekPosition(Number(playbackSeek.value));
});
playbackSeek.addEventListener("change", async () => {
  const sample = Number(playbackSeek.value);
  const wasPlaying = player?.isPlaying();
  seekDragging = false;
  seekSelection = sample;
  timelineSelectionPending = true;
  songTimeline.cursor(sample, false);
  if (wasPlaying) await playCurrentVgm(sample);
  else updatePlaybackButtons(player?.stats() || {});
});

playButton.addEventListener("click", async () => {
  if (player?.isPaused() && !timelineSelectionPending) {
    await resumeTimelinePlayback();
    return;
  }
  await playCurrentVgm(seekSelection ?? songTimeline.selected());
});

pauseButton.addEventListener("click", async () => {
  if (!player) {
    return;
  }
  player.pause();
  await audioContext?.suspend();
  updatePlaybackButtons(player.stats());
  setStatus("Paused.");
});


replayButton.addEventListener("click", async () => {
  if (!currentBuffer) {
    return;
  }
  await playCurrentVgm();
});

stopButton.addEventListener("click", () => {
  playlistRevision += 1;
  timelineSeekController?.abort();
  resetTimelineToStart();
  stopActiveStream();
  if (player) {
    player.stop();
    updatePlaybackButtons(player.stats());
  }
  setStatus("Stopped.");
});

loopCheckbox.addEventListener("change", () => {
  if (player) {
    player.setLoopEnabled(loopCheckbox.checked);
  }
});

prefetchFactorSelect.addEventListener("change", () => {
  if (player && typeof player.setPrefetchFactor === "function") {
    player.setPrefetchFactor(Number(prefetchFactorSelect.value));
  }
  flushPendingAudio();
});

workletQueueSelect.addEventListener("change", () => {
  workletQueueMultiplier = Number(workletQueueSelect.value) || 2;
  flushPendingAudio();
});

updateMasterVolumeUi();
masterVolumeRange?.addEventListener("input", () => {
  masterVolume =
    Number(masterVolumeRange.value) /
    100;
  updateMasterVolumeUi();
  applyMasterVolume();
});

exportAllTfiButton.addEventListener("click", () => {
  downloadAllTfiZip();
});

exportAllVgiButton.addEventListener("click", () => {
  downloadAllVgiZip();
});

exportParseInfoButton.addEventListener("click", () => {
  downloadParseInfo();
});

exportSnapshotTfiButton.addEventListener("click", () => {
  downloadSnapshotTfiZip();
});

exportSnapshotVgiButton.addEventListener("click", () => {
  downloadSnapshotVgiZip();
});

exportSnapshotButton.addEventListener("click", () => {
  downloadSnapshot("manual");
});

const opnMonitorRoot = document.createElement('div');
while (operatorInfoPanel.firstChild) opnMonitorRoot.append(operatorInfoPanel.firstChild);
operatorInfoPanel.append(opnMonitorRoot);
const opmMonitorRoot = document.createElement('section');
operatorInfoPanel.prepend(opmMonitorRoot);
opmMonitorRoot.hidden = true;
const opmMonitor = mountOpmMonitor(opmMonitorRoot);
exportAllOpmButton.addEventListener('click', () => {
  if (currentChipKind !== 'ym2151' || !currentBuffer) return;
  try {
    const patches = extractOpmPatches(currentBuffer);
    if (!patches.length) { setStatus('No keyed YM2151 tones found to export.'); return; }
    const files = patches.map(p => ({name:p.name, data:new TextEncoder().encode(p.text)}));
    const url = URL.createObjectURL(createStoredZip(files));
    const anchor = document.createElement('a');anchor.href = url;anchor.download = 'all_opm_patches.zip';
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported All OPM ZIP: ${patches.length} distinct tones across the track, including changes while keys are on.`);
  } catch (error) { setStatus(`OPM export failed: ${error.message}`); }
});
exportOpmButton.addEventListener('click', () => {
  if (currentChipKind !== 'ym2151' || !currentBuffer) return;
  const snapshot = opmMonitor.snapshot();
  const stem = (lastLoadedFileName || 'YM2151').replace(/\.[^.]+$/, '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_');
  const files = Array.from({length:8}, (_, channel) => ({
    name: `CH${channel+1}.opm`,
    data: new TextEncoder().encode(exportOpm(snapshot, channel, `${stem} CH${channel+1}`, {clock:noteishHeader.ym2151Clock & 0x3fffffff})),
  }));
  const url = URL.createObjectURL(createStoredZip(files));
  const anchor = document.createElement('a');anchor.href = url;anchor.download = `${stem}_snapshot_opm.zip`;
  document.body.append(anchor);anchor.click();anchor.remove();setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus('Exported Snapshot OPM: current tones from all 8 channels. Importer support for LFO/noise varies.');
});
const ayMonitorRoot = document.createElement('section');
operatorInfoPanel.prepend(ayMonitorRoot);
ayMonitorRoot.hidden = true;
const ayMonitor = mountAy8910Monitor(ayMonitorRoot, (channel, muted) => {
  if (currentChipKind !== 'ay8910') return;
  if (channel === 'ay') engine?.setAyMuted(muted);
  else if (channel === 'opll') engine?.setOpllMuted?.(muted);
  else engine?.setAyChannelMuted(channel, muted);
  renderMonitorToggles();
  flushPendingAudio();
});
const tfiInfoTab = document.getElementById('tfiInfoTab');
const oplMonitorRoot = document.createElement('section');
operatorInfoPanel.prepend(oplMonitorRoot);
oplMonitorRoot.hidden = true;
const oplMonitor = mountOplMonitor(oplMonitorRoot, () => ({registers:apuNoteMonitor, kind:currentChipKind,
  clock:noteishHeader[`${currentChipKind}Clock`]&0x3fffffff, rawClock:noteishHeader[`${currentChipKind}Clock`]}));
const ym2413MonitorRoot = document.createElement('section');
operatorInfoPanel.prepend(ym2413MonitorRoot);
ym2413MonitorRoot.hidden = true;
const ym2413Monitor = mountYm2413Monitor(ym2413MonitorRoot);
const opmInfo = mountOpmInfo({root:document.getElementById('opmInfoPanel'),onStatus:setStatus});
const tfiInfo = mountTfiInfo({ root: document.getElementById('tfiInfoPanel'), onStatus: setStatus,
});
tfiInfoTab.addEventListener('click', () => setOutputTab('tfi-info'));
window.addEventListener('pagehide', event => { if (!event.persisted) { void tfiInfo.dispose(); void opmInfo.dispose(); } });

function setOutputTab(tabName) {
  if (!(tabName === "sheet-music" && currentBuffer && (midiExportAvailable || (currentChipKind === 'ymf262' && !(noteishHeader.ymf262Clock & 0xc0000000)))) && ((["okim6258", "segapcm"].includes(currentChipKind) && tabName !== "parsed-output") || (["msx","huc6280","gameboy","nes","ymf278b","ymf262"].includes(currentChipKind) && !["parsed-output", "noteish"].includes(tabName)) || (currentChipKind === "ay8910" && !["operator-info", "parsed-output", "noteish"].includes(tabName)) || ((currentChipKind === "ym2413" || isOpl(currentChipKind)) && !["operator-info", "parsed-output", "noteish"].includes(tabName)) || (currentChipKind === "ym2151" && !["operator-info", "parsed-output", "noteish", "tfi-info"].includes(tabName)))) {
    setStatus('Analysis and instrument editing: Support coming soon.');
    tabName = "parsed-output";
  }
  sheetMusicPanel.hidden = tabName !== 'sheet-music';
  musicSheet?.setVisible(tabName === 'sheet-music');
  sheetMusicTab.setAttribute('aria-selected', String(tabName === 'sheet-music'));
  sheetMusicTab.tabIndex = tabName === 'sheet-music' ? 0 : -1;
  tfiInfo.setVisible(tabName === "tfi-info" && currentChipKind !== "ym2151");
  opmInfo.setVisible(tabName === "tfi-info" && currentChipKind === "ym2151");
  tfiInfoTab.setAttribute("aria-controls", currentChipKind === "ym2151" ? "opmInfoPanel" : "tfiInfoPanel");
  tfiInfoTab.setAttribute("aria-selected", String(tabName === "tfi-info"));
  tfiInfoTab.tabIndex = tabName === "tfi-info" ? 0 : -1;
  samplePanel.hidden = tabName !== 'samples';
  sampleTab.setAttribute('aria-selected', String(tabName === 'samples'));
  sampleTab.tabIndex = tabName === 'samples' ? 0 : -1;
  if (tabName !== 'samples') sampleExplorer.stop();
  const isOperatorInfo = tabName === "operator-info";

  operatorInfoTab.setAttribute(
    "aria-selected",
    String(isOperatorInfo)
  );
  operatorInfoTab.tabIndex = isOperatorInfo ? 0 : -1;
  parsedOutputTab.setAttribute(
    "aria-selected",
    String(tabName === "parsed-output")
  );
  parsedOutputTab.tabIndex = tabName === "parsed-output" ? 0 : -1;
  noteishTab.setAttribute(
    "aria-selected",
    String(tabName === "noteish")
  );
  noteishTab.tabIndex = tabName === "noteish" ? 0 : -1;
  operatorInfoPanel.hidden = !isOperatorInfo;
  if (isOperatorInfo) requestChannelMonitorRender();
  parsedOutputPanel.hidden = tabName !== "parsed-output";
  noteishPanel.hidden = tabName !== "noteish";
  songTimeline.active(tabName === "noteish" && noteishViewMode === "song");
  if (tabName === "noteish") {
    requestNoteishRender();
    renderNoteishGrid();
  }
}

sheetMusicTab.addEventListener('click', () => setOutputTab('sheet-music'));

operatorInfoTab.addEventListener("click", () => {
  setOutputTab("operator-info");
});

parsedOutputTab.addEventListener("click", () => {
  setOutputTab("parsed-output");
});

noteishTab.addEventListener("click", () => {
  setOutputTab("noteish");
});

function setNoteishView(mode) {
  if (!['live', 'pitch', 'song', 'fretboard', 'fretboard-all', 'keyboard'].includes(mode)) return;
  noteishViewMode = mode;
  const paneIds = { live: 'noteLivePane', pitch: 'notePitchPane', song: 'noteSongPane', fretboard: 'noteFretPane', 'fretboard-all': 'noteAllFretPane', keyboard: 'noteKeyboardPane' };
  for (const button of document.querySelectorAll('[data-noteish-view]')) {
    const selected = button.dataset.noteishView === mode;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const [key,id] of Object.entries(paneIds)) document.getElementById(id).hidden = key !== mode;
  const fretboard = mode === 'fretboard' || mode === 'fretboard-all';
  noteishMode.value = mode === 'live' || mode === 'pitch' || fretboard ? 'normal' : 'detail';
  noteishInstrument.value = fretboard ? 'fretboard' : 'keyboard';
  document.getElementById('noteTimelineMode').value = mode === 'song' ? 'score' : 'live';
  noteishPanel.classList.toggle('is-detailed', mode === 'song' || mode === 'keyboard');
  noteishPanel.classList.toggle('is-fretboard', fretboard);
  const fretOptions = document.getElementById('fretboardOptions');
  fretOptions.hidden = !fretboard;
  if (fretboard) document.getElementById(paneIds[mode]).prepend(fretOptions);
  noteishGrid.hidden = mode === 'live' || mode === 'song' || mode === 'fretboard-all';
  if (!noteishGrid.hidden) document.getElementById(paneIds[mode]).append(noteishGrid);
  songTimeline.mode('detail');
  songTimeline.active(!noteishPanel.hidden && mode === 'song');
  lastNoteishSignature = null;
  requestNoteishRender();
  renderNoteishGrid();
}
const viewTabs = Array.from(document.querySelectorAll('[data-noteish-view]'));
for (const button of viewTabs) {
  button.addEventListener('click', () => setNoteishView(button.dataset.noteishView));
  button.addEventListener('keydown', event => {
    const index = viewTabs.indexOf(button);
    const next = event.key === 'ArrowRight' ? (index + 1) % viewTabs.length
      : event.key === 'ArrowLeft' ? (index + viewTabs.length - 1) % viewTabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? viewTabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setNoteishView(viewTabs[next].dataset.noteishView);
    viewTabs[next].focus();
  });
}
function updateNoteishInstrument() {
  requestNoteishRender();
  renderNoteishGrid();
}
fretboardStrings.addEventListener("change", updateNoteishInstrument);

noteishGrid.addEventListener("pointerdown", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest("[data-show-notes]")
    : null;
  if (!target) {
    return;
  }
  event.preventDefault();
  const channelIndex = Number(target.getAttribute("data-show-notes"));
  if (!Number.isInteger(channelIndex)) {
    return;
  }
  showChannelCompactNotes(channelIndex);
});

notesDialogCloseButton.addEventListener("click", () => {
  notesDialog.close();
});

exportAllTfiButton.disabled = extractedTfiPatches.length === 0;
exportAllVgiButton.disabled = extractedTfiPatches.length === 0;
ensureChannelMonitorRenderTimer();
ensureNoteishRenderTimer();
renderChannelMonitor();
renderNoteishGrid();

const exportTempo = createExportTempoSettings(analyzeScoreSource);
const analyzeLilyPondSource = buffer => exportTempo.getAnalysis(buffer);
const commandEditor = mountCommandEditor(document.getElementById('commandEditor'), {
  setStatus,
  async onApply(bytes, name) {
    await handleFile({name, arrayBuffer:async()=>bytes.buffer}, true);
    if (!currentBuffer) throw new Error('Edited VGM could not be loaded');
    setOutputTab('parsed-output');
  },
});

mountScoreGroups({getTrack:()=>({buffer:currentBuffer}), getAnalysis:buffer=>currentChipKind === 'huc6280' ? extractHuc6280Notes(buffer) : exportTempo.getAnalysis(buffer),
  onChange:()=>{if(currentBuffer)songTimeline.load(currentBuffer);setStatus('Groups updated. Regenerate the sheet to apply changes.');},setStatus});
musicSheet = mountMusicSheet({getTrack: () => ({buffer:currentBuffer, available:(midiExportAvailable || (currentChipKind === 'ymf262' && !(noteishHeader.ymf262Clock & 0xc0000000))), fileName:lastLoadedFileName}), tempoSettings:exportTempo, setStatus});

function downloadMml(format) {
  if (!currentBuffer || !mmlBpmInput.reportValidity()) return;
  const mgsdrv = currentChipKind === 'ay8910' || currentChipKind === 'ym2413';
  if (mgsdrv ? format !== 'mgsdrv' : currentChipKind === 'ym2151' ? format !== 'mxdrv' : !['mucom88','opnavoid'].includes(format)) return;
  try {
    const options = { bpm: Number(mmlBpmInput.value), fileName: lastLoadedFileName };
    const text = format === "mxdrv" ? exportMxdrvMml(currentBuffer, options) : format === "mucom88" ? exportMucomMml(currentBuffer, options) : format === "mgsdrv" ? exportMgsdrvMml(currentBuffer, options) : exportOpnavoidMml(currentBuffer, options);
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${lastLoadedFileName.replace(/\.[^.]+$/, "") || "analysis"}.mml`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported ${format === "mxdrv" ? "MXDRV (MDX)" : format === "mucom88" ? "MUCOM88" : format === "mgsdrv" ? "MGSDRV" : "OPNAVOID"} FM MML on a sixteenth-note grid.`);
  } catch (error) {
    setStatus(`MML export failed: ${error.message}`);
  }
}

exportMmlButton.addEventListener("click", () => {
  if (!currentBuffer) return;
  const mgsdrv = currentChipKind === 'ay8910' || currentChipKind === 'ym2413';
  for (const button of mmlFormatDialog.querySelectorAll('button[value]')) {
    if (button.value === 'cancel') continue;
    button.hidden = button.disabled = mgsdrv ? button.value !== 'mgsdrv'
      : currentChipKind === 'ym2151' ? button.value !== 'mxdrv' : button.value === 'mxdrv' || button.value === 'mgsdrv';
  }
  try {
    exportTempo.prepare(currentBuffer, mmlBpmInput, document.getElementById('mmlBpmHelp'), '34–999 BPM; used for sixteenth-note quantization.');
    mmlFormatDialog.showModal();
  } catch (error) { setStatus(`Tempo analysis failed: ${error.message}`); }
});
mmlFormatDialog.querySelector("form").addEventListener("submit", (event) => {
  const format = event.submitter?.value;
  if (["mucom88", "opnavoid", "mxdrv", "mgsdrv"].includes(format)) downloadMml(format);
});

exportMidiButton.addEventListener("click", () => {
  if (!currentBuffer) return;
  try {
    exportTempo.prepare(currentBuffer, midiBpmInput, document.getElementById('midiBpmHelp'), 'Original note timing is preserved; BPM sets the beat grid.');
    midiExportDialog.showModal();
  } catch (error) { setStatus(`Tempo analysis failed: ${error.message}`); }
});

midiExportDialog.querySelector("form").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "export" || !currentBuffer || !midiBpmInput.reportValidity()) return;
  try {
    const result = exportAnalysisMidi(currentBuffer, { bpm: Number(midiBpmInput.value), fileName: lastLoadedFileName });
    const url = URL.createObjectURL(new Blob([result.bytes], { type: "audio/midi" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${lastLoadedFileName.replace(/\.[^.]+$/, "") || "analysis"}.mid`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported MIDI: ${result.noteCount} notes, ${result.bendCount} pitch bends, ${result.skippedNotes} omitted intervals. ${result.chipName} base-pitch notes; no grid quantization. Noise, PCM and original timbres are omitted. Details are in MIDI text events.`);
  } catch (error) { setStatus(`MIDI export failed: ${error.message}`); }
});

exportWavButton.addEventListener("click", () => {
  if (!currentBuffer) return;
  wavExportStatus.textContent = "";
  try {
    const totalSamples = new Ym2612VGM(currentBuffer).header.totalSamples;
    if (totalSamples > 0) {
      // VGM sample counts are always in 44100Hz-reference units regardless of
      // the engine's actual output rate. Add slack for release tails / a
      // margin beyond one loop pass rather than guessing a fixed number.
      const seconds = Math.ceil(totalSamples / 44100) + 30;
      wavMaxSecondsInput.max = String(Math.max(600, seconds));
      wavMaxSecondsInput.value = String(seconds);
    }
  } catch { /* keep the field's previous value */ }
  wavExportDialog.showModal();
});

wavExportDialog.querySelector("form").addEventListener("submit", async (event) => {
  if (event.submitter?.value !== "export") return;
  event.preventDefault();
  if (wavExportBusy || !currentBuffer || !wavMaxSecondsInput.reportValidity()) return;
  const maxSeconds = Number(wavMaxSecondsInput.value);
  wavExportBusy = true;
  const dialogButtons = wavExportDialog.querySelectorAll("button");
  dialogButtons.forEach(b => b.disabled = true);
  wavMaxSecondsInput.disabled = true;
  wavExportStatus.textContent = "Preparing...";
  playlistRevision += 1;
  timelineSeekController?.abort();
  resetTimelineToStart();
  stopActiveStream();
  updatePlaybackButtons(player ? player.stats() : {});
  try {
    if (!isPlaybackReady()) {
      await beginPreparePlayback(new Ym2612VGM(currentBuffer));
      if (!isPlaybackReady()) {
        wavExportStatus.textContent = "Playback could not be prepared for this track.";
        return; // ensurePlaybackReady already reported the reason elsewhere too.
      }
    }
    player.stop();
    player.setLoopEnabled(loopCheckbox.checked);
    player.play();
    let lastReported = -1;
    const result = await renderVgmToWav(player, {
      maxSeconds,
      onProgress: (fraction) => {
        const percent = Math.round(fraction * 100);
        if (percent !== lastReported) { lastReported = percent; wavExportStatus.textContent = `Rendering... ${percent}%`; }
      },
    });
    player.stop();
    if (result.seconds <= 0) throw new Error("Nothing to render for this track.");
    const summary = `Exported ${result.seconds.toFixed(1)}s at ${player.sampleRate()} Hz.${result.truncated ? ` Stopped at the ${maxSeconds}s limit; raise Max length to capture more.` : ""}`;
    wavExportStatus.textContent = summary;
    const url = URL.createObjectURL(new Blob([result.bytes], { type: "audio/wav" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${lastLoadedFileName.replace(/\.[^.]+$/, "") || "analysis"}.wav`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported WAV: ${summary}`);
    wavExportDialog.close();
  } catch (error) {
    player?.stop();
    wavExportStatus.textContent = `WAV export failed: ${error.message}`;
    setStatus(`WAV export failed: ${error.message}`);
  } finally {
    wavExportBusy = false;
    dialogButtons.forEach(b => b.disabled = false);
    wavMaxSecondsInput.disabled = false;
    updatePlaybackButtons(player ? player.stats() : {});
  }
});

// A native dialog keeps keyboard focus inside the support table and supports Escape.
document.getElementById('chipSupportButton').addEventListener('click', () => {
  document.getElementById('chipSupportDialog').showModal();
});

let lilyPondPrepared = null;
let lilyPondSource = null;
exportLilyPondButton.addEventListener("click", () => {
  if (!currentBuffer || !(midiExportAvailable || (currentChipKind === 'ymf262' && !(noteishHeader.ymf262Clock & 0xc0000000)))) return;
  try {
    if (lilyPondSource !== currentBuffer) {
      lilyPondPrepared = analyzeLilyPondSource(currentBuffer);
      lilyPondSource = currentBuffer;
      lilyPondBpmInput.value = lilyPondPrepared.tempo.bpm;
      const help = document.getElementById('lilyPondTempoHelp');
      help.textContent = lilyPondPrepared.tempo.estimated
        ? `Suggested: ${lilyPondPrepared.tempo.bpm} BPM. Candidates: ${lilyPondPrepared.tempo.candidates.join(', ')}. Estimated from key-on intervals; half/double tempo may also fit. You can change this value.`
        : 'No reliable tempo estimate. Default: 120 BPM. You can change this value.';
      const list = document.getElementById('lilyPondChannels');
      list.replaceChildren();
      lilyPondPrepared.channels.forEach((channel, index) => {
        const count = channel.notes.filter(n => n.midi !== null && Number.isFinite(n.midi) && n.end > n.start).length;
        const label = document.createElement('label');
        label.style.display = 'block';
        const input = document.createElement('input');
        input.type = 'checkbox'; input.value = String(index); input.checked = count > 0;
        label.append(input, document.createTextNode(` ${channel.name} (${count} pitch intervals)`));
        list.append(label);
      });
    }
    lilyPondExportDialog.showModal();
  } catch (error) { lilyPondSource = null; setStatus(`LilyPond analysis failed: ${error.message}`); }
});
lilyPondExportDialog.querySelector("form").addEventListener("submit", event => {
  if (event.submitter?.value !== "export" || !currentBuffer || !lilyPondBpmInput.reportValidity()) return;
  try {
    if (lilyPondSource !== currentBuffer || !lilyPondPrepared) throw new Error('Reopen LilyPond export for the current track');
    const channelIndices = Array.from(document.getElementById('lilyPondChannels').querySelectorAll('input:checked'), input => Number(input.value));
    if (!channelIndices.length) { event.preventDefault(); setStatus('Select at least one channel for LilyPond export.'); return; }
    const result = exportLilyPondAnalysis(lilyPondPrepared, { bpm: Number(lilyPondBpmInput.value), fileName: lastLoadedFileName, channelIndices, groups:getScoreGroups(currentBuffer) });
    const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${lastLoadedFileName.replace(/\.[^.]+$/, "") || "analysis"}.ly`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported LilyPond: ${result.noteCount} notes, ${result.skippedNotes} omitted intervals. 1/16 grid, assumed 4/4. PCM/noise/modulation omitted; see comments in the .ly file.`);
  } catch (error) { setStatus(`LilyPond export failed: ${error.message}`); }
});

async function getBrowserPlaybackFactory(name) {
  const loaders = {
    huc6280: async () => (await import('../generated/huc6280_wasm.js')).default,
    okim6258: async () => (await import('../generated/okim6258_wasm.js')).default,
    ay8910: async () => (await import('../generated/ay8910_wasm.js')).default,
    ym2413: async () => (await import('../generated/ym2413_wasm.js')).default,
    y8950: async () => (await import('../generated/y8950_wasm.js')).default,
    k051649: async () => (await import('../generated/k051649_wasm.js')).default,
    ymf278b: async () => (await import('../generated/ymf278b_wasm.js')).default,
    ym3526: async () => (await import('../generated/ym3526_wasm.js')).default,
    ym3812: async () => (await import('../generated/ym3812_wasm.js')).default,
    ymf262: async () => (await import('../generated/ymf262_wasm.js')).default,
    segapcm: async () => (await import('../generated/segapcm_wasm.js')).default,
    gameboy_apu: async () => (await import('../generated/gameboy_apu_wasm.js')).default,
    ym2151: async () => (await import('../generated/ym2151_wasm.js')).default,
    ym2610b: async () => (await import('../generated/ym2610b_wasm.js')).default,
    rf5c164: async () => (await import('../generated/rf5c164_wasm.js')).default,
    ym2612: async () => activeYm2612ModuleFactory,
    segapsg: async () => segaPsgModuleFactory,
    ym2203: loadYm2203ModuleFactory,
    ym2608: loadYm2608ModuleFactory,
  };
  return loaders[name]?.();
}
