// SPDX-License-Identifier: BSD-3-Clause
import { FM_PRESETS, readFmPreset } from '../synth-fm2608/preset.js';
import { buildHeader, buildOperatorControls, createParamControl } from '../synth/synth_controls.js';
import {
  buildKeyboard, createFretboardLayout, createFretboardState, renderFretboardControls,
  setFretPosition, setInstrument, setStringWindowIndex,
} from '../synth/synth_keyboard.js';
import { createOperatorEnvelopeView } from '../synth/synth_operator_envelope.js';
import { createSynthOutputVisualizer } from '../synth/synth_output_visualizer.js';
import { modulationSettings } from '../synth/synth_modulation.js';
import { bendPitch } from '../synth/synth_pitch_bend.js';
import { transposeChannel3Pitches } from '../synth/synth_song_voice.js';
import { midiToOpnPitch } from '../js/soundchip_pitch.js';
import { YM2610BSynth } from '../js/ym2610bsynth.js';
import { createVsuVoicePool } from '../synth-vsu/voice-pool.js';
import { createFm2610Audio } from './audio.js';
import { setupFm2610Code } from './code.js';
import { setupFm2610CodeEditor } from './code_editor.js';
import { setupFm2610Files } from './files.js';
import { isFm2610Channel3Special, readFm2610Patch, readFm2610SnapshotPatches } from './fm_patch.js';
import { ADPCM_A_KEYS, setupFm2610Sections } from './sections.js';
import { setupFm2610SongControls } from './song_controls.js';
import { setupFm2610Workspace } from './workspace.js';

const byId = id => document.getElementById(id);
const modeButtons = [...byId('chipModes').querySelectorAll('button')];
const status = byId('status');
const keyboard = byId('keyboard');
const drumKeyboard = byId('adpcmAKeyboard');
const keyboardToolbar = byId('keyboardPanel').querySelector('.keyboard-toolbar');
const keyboardWheels = byId('fmKeyboardWheels');
const pitchWheel = byId('pitchBendWheel'), modWheel = byId('modulationWheel');
const scope = byId('scope');
const envelopeRoot = byId('fmEnvelope');
const workspace = byId('workspace');
const audio = createFm2610Audio();
const visualizer = createSynthOutputVisualizer({
  background: '#18150f', grid: '#4b3b26', labels: '#bfaf91', trace: '#ffcc78',
  waveformMinRange: 1 / 64, spectrumFloor: -110,
});
const voicePools = { fm: createVsuVoicePool(), ssg: createVsuVoicePool(), 'adpcm-b': createVsuVoicePool() };
const fmPitchAnchors = new Map();
const drumKeys = new Map(Array.from(ADPCM_A_KEYS, (key, drumChannel) => [key, {
  key, drumChannel, label: key.toUpperCase(), noteName: `A${drumChannel + 1}`, stringNumber: 0, fret: drumChannel,
}]));
const drumKeysDown = new Map();
const fretboard = createFretboardState();
const physicalSlots = { ym2610b: [0, 1, 2, 3, 4, 5], ym2610: [1, 2, 4, 5] };
const channels = physicalSlots.ym2610b.map(() => readFmPreset(FM_PRESETS['one-op-basic']));
const CH3 = 2;
const operators = [1, 2, 3, 4];
const defaultCh3Pitch = midiToOpnPitch(60, 8000000);
const defaultCh3Pitches = operators.map(() => ({block: defaultCh3Pitch.block, fnum: defaultCh3Pitch.fnum}));
const operatorDefinitions = [
  ['dt', 'DT', 7], ['multi', 'MULT', 15], ['tl', 'TL', 127], ['rs', 'RS', 3], ['ar', 'AR', 31],
  ['am', 'AM', 1], ['d1r', 'D1R', 31], ['d2r', 'D2R', 31], ['sl', 'SL', 15], ['rr', 'RR', 15], ['ssg', 'SSG-EG', 15],
].map(([id, label, max]) => ({ id, label, min: 0, max, step: 1, booleanMode: id === 'am' }));
const algorithmDescriptions = [
  'OP1 → OP2 → OP3 → OP4 → OUT',
  '(OP1 + OP2) → OP3 → OP4 → OUT',
  '(OP1 + (OP2 → OP3)) → OP4 → OUT',
  '((OP1 → OP2) + OP3) → OP4 → OUT',
  '((OP1 → OP2) + (OP3 → OP4)) → OUT',
  '((OP1 → OP2) + (OP1 → OP3) + (OP1 → OP4)) → OUT',
  '((OP1 → OP2) + OP3 + OP4) → OUT',
  '(OP1 + OP2 + OP3 + OP4) → OUT',
];
const commonControls = new Map(), operatorControls = new Map();
const operatorGates = new Map();
const lfoControls = new Map();
const ch3Controls = {pitches: []};
const lfo = { enabled: false, frequency: 0 };
const gateMethods = new Set(['keyOn', 'keyOff', 'noteOn', 'noteOnRaw', 'noteOff']);
const ssgGateMethods = new Set([...gateMethods, 'tone', 'noise', 'off']);
const codeEndpoints = new WeakMap();
const textEntry = 'input:not([type="range"], [type="checkbox"], [type="radio"]), textarea, select, [contenteditable], .monaco-editor, #codeEditorHost, dialog[open]';
let variant = 'ym2610b', switching = false, chip = null, source = 'fm';
let keyboardSource = 'fm';
let fmSelection = null, ssgChannel = null, octave = 0, keys = new Map();
let pitchBendSemitones = 0, modulationWheelValue = 0;
let scopeMode = 'waveform', scopeFrame = null;
let songState = {playback: 'stopped'}, fmView = null, fmPlayback = null, fmEditorReference = null;
let channelProfile = '';
const adoptedFmSnapshots = new WeakSet();
const envelope = createOperatorEnvelopeView({
  root: envelopeRoot,
  getOperators: () => [null, ...(fmView?.voice.preset ?? selectedFmPreset()).operators],
  getSelectionKey: () => (fmView?.snapshot.variant ?? variant) + ':' + (fmView?.voice.physicalChannel ?? fmSelection),
  onEdit(operator, patch) {
    editOperator(operator, patch);
  },
});

function announce(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function report(error) {
  if (error?.name !== 'AbortError') announce(error?.message ?? String(error), true);
}

function drawScope() {
  const { width, height } = scope.getBoundingClientRect();
  if (!width || !height) return;
  const scale = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
  if (scope.width !== pixelWidth) scope.width = pixelWidth;
  if (scope.height !== pixelHeight) scope.height = pixelHeight;
  const context = scope.getContext('2d');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  visualizer.draw({ width, height }, context, scopeMode);
}

function monitorOutput() {
  if (!chip || document.hidden || scopeFrame !== null) return;
  scopeFrame = requestAnimationFrame(() => {
    scopeFrame = null;
    drawScope();
    if (songState.playback !== 'playing' && code.getState().running) refreshPerformanceView();
    monitorOutput();
  });
}

function presetFor(channel) { return channels[physicalSlots[variant][channel]]; }
function selectedFmPreset() {
  const slots = physicalSlots[variant];
  return channels[slots.includes(fmSelection) ? fmSelection : slots[0]];
}
function fmTargets() {
  const slots = physicalSlots[variant];
  const channel = slots.indexOf(fmSelection);
  return channel < 0 ? slots.map((_, index) => index) : [channel];
}

function fmModulation(pms, wheelValue) {
  return modulationSettings({pms, lfoEnabled: lfo.enabled, lfoFrequency: lfo.frequency}, wheelValue);
}

function writeFmLfo(fm, wheelValue) {
  const settings = fmModulation(0, wheelValue);
  fm.setLfo(settings.lfoEnabled, settings.lfoFrequency);
}

function writeFmPan(fm, channel, preset, wheelValue) {
  fm.setPan(channel, preset.pan.left, preset.pan.right, preset.ams, fmModulation(preset.pms, wheelValue).pms);
}

function applyFmModulation(fm, wheelValue) {
  writeFmLfo(fm, wheelValue);
  physicalSlots[variant].forEach((_, channel) => writeFmPan(fm, channel, presetFor(channel), wheelValue));
}

function applyFmChannel(fm, channel, preset, wheelValue = modulationWheelValue) {
  fm.setPreset(channel, {...preset, pms: fmModulation(preset.pms, wheelValue).pms});
  if (physicalSlots[variant][channel] === CH3) applyFmChannel3(fm, channel, preset);
}

function setFmVoicePitch(fm, channel, midi) {
  const preset = presetFor(channel);
  const pitch = midiToOpnPitch(midi, fm.clock);
  const special = physicalSlots[variant][channel] === CH3 && isFm2610Channel3Special(preset)
    ? transposeChannel3Pitches(pitch, preset.specialFrequencies) : null;
  const anchor = {pitch, special};
  fmPitchAnchors.set(channel, anchor);
  writeFmPitch(fm, channel, anchor);
}

function writeFmSpecialPitch(fm, operator, pitch) {
  const {block, fnum} = pitch.fnum ? bendPitch(pitch, pitchBendSemitones) : pitch;
  fm.setChannel3SpecialFrequency(operator, block, fnum);
}

function writeFmPitch(fm, channel, {pitch, special}) {
  if (special) {
    special.forEach((base, operator) => writeFmSpecialPitch(fm, operator, base));
    return;
  }
  const {block, fnum} = bendPitch(pitch, pitchBendSemitones);
  fm.setFrequency(channel, block, fnum);
}

function setPitchBend(value) {
  pitchWheel.value = String(value);
  const semitones = value / 500;
  const readout = (semitones > 0 ? '+' : '') + semitones.toFixed(2);
  byId('pitchBendValue').value = readout;
  pitchWheel.setAttribute('aria-valuetext', readout + ' semitones');
  if (semitones === pitchBendSemitones) return;
  pitchBendSemitones = semitones;
  if (chip && !fmPlayback) {
    // Released channels retain their base pitch until the next note so their tails also return to center.
    for (const [channel, anchor] of fmPitchAnchors) writeFmPitch(chip.fm, channel, anchor);
  }
}

function suspendFmKeyboardPerformance() {
  setPitchBend(0);
  fmPitchAnchors.clear();
  if (chip && modulationWheelValue) applyFmModulation(chip.fm, 0);
}

function applyFmChannel3(fm, channel, preset) {
  const enabled = isFm2610Channel3Special(preset);
  fm.setChannel3SpecialMode(enabled);
  const held = voicePools.fm.voiceOn(channel);
  if (held?.started) setFmVoicePitch(fm, channel, held.entry.midi);
  else {
    const anchor = fmPitchAnchors.get(channel);
    fmPitchAnchors.delete(channel);
    if (enabled) {
      preset.specialFrequencies.forEach(({block, fnum}, operator) => fm.setChannel3SpecialFrequency(operator, block, fnum));
    } else if (anchor && pitchBendSemitones) {
      const {block, fnum} = anchor.special?.[3] ?? anchor.pitch;
      fm.setFrequency(channel, block, fnum);
    }
  }
}

function applyFmSettings(fm, wheelValue = modulationWheelValue) {
  physicalSlots[variant].forEach((_, channel) => applyFmChannel(fm, channel, presetFor(channel), wheelValue));
  writeFmLfo(fm, wheelValue);
}

async function sound({forCode = false} = {}) {
  const selected = variant;
  if (switching) throw new DOMException('Chip change in progress.', 'AbortError');
  const next = await audio.start(selected);
  if (switching || selected !== variant) throw new DOMException('Chip changed.', 'AbortError');
  if (next !== chip) {
    fmPitchAnchors.clear();
    applyFmSettings(next.fm, forCode || getFmPlayback() ? 0 : modulationWheelValue);
    visualizer.connect(next.context, [next.analyser]);
    chip = next;
    announce('Audio ready.');
    monitorOutput();
  }
  return next;
}

function guardKeyboardGates(section, instrument) {
  const methods = section === 'ssg' ? ssgGateMethods : gateMethods;
  return new Proxy(instrument, {
    get(target, property) {
      const method = Reflect.get(target, property, target);
      if (typeof method !== 'function') return method;
      if (!methods.has(property)) return method.bind(target);
      return (channel, ...args) => {
        if (!voicePools[section].voiceOn(channel)) return method.call(target, channel, ...args);
      };
    },
  });
}

async function codeSound() {
  const endpoint = await sound({forCode: true});
  if (!codeEndpoints.has(endpoint)) {
    codeEndpoints.set(endpoint, {
      ...endpoint, fm: guardKeyboardGates('fm', endpoint.fm), ssg: guardKeyboardGates('ssg', endpoint.ssg),
    });
  }
  return codeEndpoints.get(endpoint);
}

function stopCodeSound(endpoint) {
  if (endpoint.context !== chip?.context) return;
  for (let channel = 0; channel < endpoint.fm.channelCount; channel++) endpoint.fm.noteOff(channel);
  for (let channel = 0; channel < 3; channel++) endpoint.ssg.keyOff(channel);
  releaseAdpcmAKeyboard();
  releaseAdpcmBKeyboard();
  sections.stopAdpcm({invalidateB: true});
  endpoint.adpcmA.keyOff([0, 1, 2, 3, 4, 5]);
  endpoint.adpcmB.keyOff();
  applyFmSettings(endpoint.fm, 0);
}

const sections = setupFm2610Sections({
  ssgPanel: byId('ssgPanel'), adpcmAPanel: byId('adpcmAPanel'), adpcmBPanel: byId('adpcmBPanel'), sound, report,
  getMode: () => variant,
  releaseAdpcmAKeyboard, releaseAdpcmBKeyboard,
  onInstrumentEdited: kind => files.markInstrumentEdited(kind),
  onInstrumentAdopted: kind => files.detachInstrument(kind),
  saveSsgPreset: preset => files.saveSsgPreset(preset),
  async saveAdpcmAKit(kit) {
    await files.ready;
    return files.saveAdpcmAKit(kit);
  },
  async saveAdpcmBSample(sample) {
    await files.ready;
    return files.saveAdpcmBSample(sample);
  },
});
const code = setupFm2610Code({
  textarea: byId('code'), runButton: byId('runCode'), applyButton: byId('applyCode'), stopButton: byId('stopCode'),
  status: byId('codeStatus'), output: byId('codeOutput'), sound: codeSound,
  getMode: () => variant, stopSound: stopCodeSound,
  beforeRun() {
    // Clearing a VGM can restore the keyboard Mod overlay before Code reads the chip.
    songs.clearPlayback();
    if (!getFmPlayback()) suspendFmKeyboardPerformance();
    releaseKeyboard();
    sections.stop();
  },
  onState: () => queueMicrotask(refreshPerformanceView),
  prepareSource: (...args) => files.prepareSource(...args),
  readFile: (...args) => files.readFile(...args),
  getEntryPath: () => files.getEntryPath(),
});
const songs = setupFm2610SongControls({
  getFiles: () => files,
  sound,
  async beforePlay() {
    releaseKeyboard();
    sections.stop();
    await code.stop();
    code.clearSnapshot();
  },
  onPlayback(state) {
    if (state.retained && !songState.retained) {
      releaseKeyboard();
      sections.stopAdpcmB();
    }
    songState = state;
    refreshPerformanceView();
  },
  announce,
  report,
});

function currentPlaybackReference() {
  if (songState.snapshot) {
    const {snapshot, playback, retained} = songState;
    return {kind: 'vgm', snapshot, retained, frozen: retained || playback === 'paused', reader: songs};
  }
  const snapshot = code.getSnapshot();
  if (!snapshot) return null;
  const retained = code.hasRetainedSnapshot();
  return {kind: 'code', snapshot, retained, frozen: retained, reader: code};
}

function refreshPerformanceView() {
  const reference = currentPlaybackReference();
  refreshFmView(false, reference);
  refreshReferencePanels(reference);
}

function refreshReferencePanels(reference = currentPlaybackReference()) {
  const following = sections.isFollowingAdpcm(source);
  const ssgFollowing = sections.isFollowingSsg();
  const panel = {ssg: 'ssgPanel', 'adpcm-a': 'adpcmAPanel', 'adpcm-b': 'adpcmBPanel'}[source];
  const visible = panel && !byId(panel).closest('[hidden]') ? source : undefined;
  sections.setPerformanceReference(reference, visible);
  const nowFollowingSsg = sections.isFollowingSsg();
  if (!ssgFollowing && nowFollowingSsg) {
    for (const voice of voicePools.ssg.clear()) stopVoice('ssg', voice);
  }
  if (following !== sections.isFollowingAdpcm(source) || ssgFollowing !== nowFollowingSsg) renderKeys();
}

function autoLiveVoice(kind, voices) {
  if (kind === 'code') {
    const active = voices.reduce((best, voice) => voice.codeGate &&
      (!best || voice.codeKeyOnOrder > best.codeKeyOnOrder) ? voice : best, null);
    if (active) return active;
    const recent = voices.reduce((best, voice) => voice.codeKeyOnOrder > (best?.codeKeyOnOrder ?? 0) ? voice : best, null);
    if (recent) return recent;
  }
  return voices.find(voice => voice.gate) ?? voices.find(voice => voice.lastKeyMask) ?? voices[0];
}

function getFmPlayback() {
  if (['loading', 'playing', 'pausing'].includes(songState.playback)) return 'vgm';
  const {running, busy} = code.getState();
  return running || busy ? 'code' : null;
}

function currentFmView(reference) {
  if (!fmPlayback || reference?.kind !== fmPlayback || !reference.snapshot.channels.length) return null;
  const {kind, snapshot} = reference;
  const selection = snapshot.channels.find(voice => voice.physicalChannel === fmSelection);
  return {kind, snapshot, voice: selection ?? autoLiveVoice(kind, snapshot.channels)};
}

function liveFmSnapshot() {
  if (fmPlayback === 'vgm') return songs.getFmEditSnapshot();
  if (fmPlayback === 'code' && code.getState().running && !code.getState().busy) return code.getSnapshot();
  return null;
}

function editLiveFm(edit) {
  const snapshot = liveFmSnapshot();
  const physical = fmView?.voice.physicalChannel;
  const voice = snapshot?.channels.find(entry => entry.physicalChannel === physical);
  if (!voice) return;
  const writes = [];
  const fm = new YM2610BSynth({clock: snapshot.clockHz, transport: {
    write(port, register, value) { writes.push({port, register, value}); },
  }});
  const preset = readFm2610Patch(voice.preset);
  fm.setPreset(physical, preset);
  // Timer overflow clear strobes must not be repeated when the editor changes bit 6.
  fm._modeRegister = snapshot.modeRegister & ~0x30;
  writes.length = 0;
  edit(fm, physical, preset, snapshot, voice);
  if (!writes.length) return;
  if (fmPlayback === 'vgm') songs.writeFm(writes);
  else if (chip) {
    chip.applyManualFmWrites(writes);
    refreshFmView();
  }
}

function adoptFmSnapshot({kind, snapshot, frozen}) {
  if (!frozen || !snapshot.channels.length || adoptedFmSnapshots.has(snapshot)) return false;
  const {channels: observed, lfo: observedLfo, channel3Notice} = readFm2610SnapshotPatches(snapshot);
  adoptedFmSnapshots.add(snapshot);
  releaseFmKeyboard();
  fmPitchAnchors.clear();
  for (const {physicalChannel, patch} of observed) channels[physicalChannel] = patch;
  Object.assign(lfo, observedLfo);
  const available = snapshot.channels.filter(voice => physicalSlots[variant].includes(voice.physicalChannel));
  if (!available.some(voice => voice.physicalChannel === fmSelection)) {
    const recent = autoLiveVoice(kind, available);
    fmSelection = recent && (recent.gate || recent.lastKeyMask || recent.codeKeyOnOrder) ? recent.physicalChannel : null;
  }
  fmEditorReference = {kind, channel3Notice};
  if (chip) applyFmSettings(chip.fm);
  files.detachFmPatch();
  return true;
}

function refreshFmView(force = false, reference = currentPlaybackReference()) {
  const previous = fmView, previousPlayback = fmPlayback;
  const playback = getFmPlayback();
  if (playback === 'vgm' && !previousPlayback) suspendFmKeyboardPerformance();
  fmPlayback = playback;
  const next = fmView = currentFmView(reference);
  if (fmPlayback && !previousPlayback) releaseFmKeyboard();
  let adopted = false;
  if (!fmPlayback && reference) {
    try { adopted = adoptFmSnapshot(reference); }
    catch (error) { report(error); }
  }
  if (!playback && previousPlayback && !adopted && chip && modulationWheelValue) {
    applyFmModulation(chip.fm, modulationWheelValue);
  }
  const readOnly = Boolean(playback && (!next?.voice || !liveFmSnapshot()));
  if (force || adopted || previousPlayback !== fmPlayback || previous?.snapshot.variant !== next?.snapshot.variant ||
      previous?.snapshot.revision !== next?.snapshot.revision || previous?.voice.physicalChannel !== next?.voice.physicalChannel ||
      byId('fmParameters').disabled !== readOnly) {
    renderFmChannels();
    renderFm();
    renderKeys();
  }
}

function renderFm() {
  const voice = fmView?.voice;
  const preset = voice?.preset ?? selectedFmPreset();
  const routing = byId('fmAlgorithm');
  const description = `ALGO ${preset.algorithm} · ${algorithmDescriptions[preset.algorithm]}`;
  if (routing.textContent !== description) {
    routing.innerHTML = description.replace(/OP([1-4])/g, '<span class="op-color-$1">OP$1</span>');
  }
  for (const [key, control] of commonControls) control.updateVisual(preset[key] ?? preset.pan[key]);
  for (const [key, control] of lfoControls) control.updateVisual((fmView?.snapshot.lfo ?? lfo)[key]);
  for (const [operator, controls] of operatorControls) {
    for (const [key, control] of controls) control.updateVisual(preset.operators[operator - 1][key]);
  }
  const liveEditable = Boolean(voice && liveFmSnapshot());
  const readOnly = Boolean(fmPlayback && !liveEditable);
  for (const [operator, button] of operatorGates) {
    button.setAttribute('aria-pressed', String(Boolean((voice?.keyMask ?? preset.keyMask) & (1 << (operator - 1)))));
    button.disabled = Boolean(fmPlayback);
  }
  envelopeRoot.toggleAttribute('data-live', readOnly);
  envelopeRoot.querySelector('.operator-envelope-plot').inert = readOnly;
  byId('fmParameters').disabled = readOnly;
  for (const button of byId('fmPresets').children) button.disabled = Boolean(fmPlayback);
  const physical = voice?.physicalChannel ?? fmSelection;
  const channelName = physical === null ? 'AUTO' : 'CH' + (physical + 1);
  const kind = fmPlayback ?? fmEditorReference?.kind;
  const origin = kind === 'vgm' ? 'VGM' : kind === 'code' ? 'Code' : '';
  const phase = voice?.gate ? 'Key on · OP ' + operators.filter(op => voice.keyMask & (1 << (op - 1))).join('/') : 'Key off';
  const details = fmPlayback ? [origin, liveEditable ? 'Live edit' : 'Playback', fmView?.snapshot.variant.toUpperCase(),
    voice && channelName, voice && phase, voice?.specialMode && 'CH3 Special'] :
    [origin, 'Editing', channelName, isFm2610Channel3Special(preset) && 'CH3 Special', fmEditorReference?.channel3Notice];
  byId('fmChannelState').textContent = details.filter(Boolean).join(' · ');
  renderFmChannel3(physical === CH3, voice, readOnly);
  envelope.invalidate();
}

function renderFmChannel3(visible, observed, readOnly = false) {
  const panel = byId('fmChannel3Special');
  panel.hidden = !visible;
  if (!visible || readOnly) {
    for (const pitch of ch3Controls.pitches) {
      pitch.block.cancelDrag();
      pitch.fnum.cancelDrag();
    }
  }
  if (!visible) return;
  const preset = channels[CH3];
  const enabled = observed?.specialMode ?? isFm2610Channel3Special(preset);
  const frequencies = observed?.specialFrequencies ?? preset.specialFrequencies ?? defaultCh3Pitches;
  ch3Controls.enabled.setAttribute('aria-pressed', String(enabled));
  ch3Controls.enabled.textContent = enabled ? 'Special: On' : 'Special: Off';
  for (const [operator, {block, fnum}] of frequencies.entries()) {
    ch3Controls.pitches[operator].block.updateVisual(block);
    ch3Controls.pitches[operator].fnum.updateVisual(fnum);
  }
  const csm = fmView?.snapshot.modeRegister & 0x80;
  byId('fmChannel3SpecialState').textContent = csm ? 'Timer A (CSM)' :
    !frequencies[3].fnum ? 'Set OP4 F-NUM above zero for keyboard transposition.' : '';
}

function editFmChannel3({enabled, operator, field, value}) {
  if (fmPlayback) {
    editLiveFm((fm, physical, _preset, snapshot, voice) => {
      if (physical !== CH3) return;
      if (operator === undefined) fm.setChannel3SpecialMode(!(snapshot.modeRegister & 0x40));
      else {
        const pitch = {...voice.specialFrequencies[operator], [field]: value};
        fm.setChannel3SpecialFrequency(operator, pitch.block, pitch.fnum);
      }
    });
    return;
  }
  if (fmSelection !== CH3) return;
  const preset = channels[CH3];
  enabled ??= isFm2610Channel3Special(preset);
  const pitches = preset.specialFrequencies ?? defaultCh3Pitches.map(pitch => ({...pitch}));
  const base = operator === 3 && field === 'fnum' ? value : pitches[3].fnum;
  if (enabled && !base) {
    renderFmChannel3(true);
    announce('Set OP4 F-NUM above zero for keyboard transposition.');
    return;
  }
  preset.specialFrequencies = pitches;
  if (enabled) delete preset.specialMode;
  else preset.specialMode = false;
  if (operator === undefined) {
    if (chip) applyFmChannel3(chip.fm, physicalSlots[variant].indexOf(CH3), preset);
  } else {
    const pitch = pitches[operator];
    pitch[field] = value;
    if (enabled && chip) {
      const channel = physicalSlots[variant].indexOf(CH3);
      const special = fmPitchAnchors.get(channel)?.special;
      if (special) {
        special[operator] = {...pitch};
        writeFmSpecialPitch(chip.fm, operator, pitch);
      } else {
        chip.fm.setChannel3SpecialFrequency(operator, pitch.block, pitch.fnum);
      }
    }
  }
  if (fmEditorReference && enabled) fmEditorReference.channel3Notice = '';
  renderFm();
  files.markInstrumentEdited('fm');
}

function buildFmChannel3Controls() {
  const root = byId('fmChannel3SpecialControls');
  ch3Controls.enabled = makeButton('Special: Off', () => editFmChannel3({enabled: !isFm2610Channel3Special(channels[CH3])}));
  ch3Controls.enabled.setAttribute('aria-label', 'CH3 Special mode');
  ch3Controls.enabled.setAttribute('aria-pressed', 'false');
  root.append(ch3Controls.enabled);
  for (const [index, operator] of operators.entries()) {
    const row = document.createElement('div');
    row.className = 'fm-ch3-op';
    const pitch = {};
    for (const [field, label, max] of [['block', 'Block', 7], ['fnum', 'F-NUM', 2047]]) {
      const control = createParamControl({label: `OP${operator} ${label}`, min: 0, max, step: 1,
        value: defaultCh3Pitches[index][field], wheelAdjust: false,
        onChange: value => editFmChannel3({operator: index, field, value})});
      pitch[field] = control;
      row.append(control.element);
    }
    ch3Controls.pitches.push(pitch);
    root.append(row);
  }
}

function editPreset(update, write, {track = true, allowLive = true} = {}) {
  if (fmPlayback) {
    if (allowLive) editLiveFm((fm, channel, preset) => {
      update(preset);
      write(fm, channel, preset);
    });
    return;
  }
  for (const channel of fmTargets()) {
    const preset = presetFor(channel);
    update(preset);
    if (chip) write(chip.fm, channel, preset);
  }
  renderFm();
  if (track) files.markInstrumentEdited('fm');
}

function writeKeyMask(fm, channel, mask) {
  if (mask) {
    fm.keyOn(channel, [0, 1, 2, 3].filter(operator => mask & (1 << operator)));
  } else {
    fm.keyOff(channel);
  }
}

function updateHeldMask(fm, channel, preset) {
  if (voicePools.fm.voiceOn(channel)?.started) writeKeyMask(fm, channel, preset.keyMask);
}

function toggleOperator(operator, enabled) {
  const bit = 1 << (operator - 1);
  editPreset(preset => {
    preset.keyMask = enabled ? preset.keyMask | bit : preset.keyMask & ~bit;
  }, updateHeldMask, {allowLive: false});
}

function editOperator(operator, patch) {
  const index = operator - 1;
  editPreset(preset => {
    Object.assign(preset.operators[index], patch);
  }, (fm, channel) => fm.setOperator(channel, index, patch));
}

function applyFmPreset(preset) {
  const {lfo: patchLfo, ...patch} = readFm2610Patch(preset);
  fmEditorReference = null;
  if (patch.specialFrequencies) {
    releaseFmKeyboard();
    fmSelection = CH3;
  }
  if (patchLfo) {
    Object.assign(lfo, patchLfo);
    if (chip) writeFmLfo(chip.fm, modulationWheelValue);
  }
  editPreset(target => {
    delete target.specialFrequencies;
    delete target.specialMode;
    Object.assign(target, readFm2610Patch(patch));
  }, (fm, channel, next) => {
    applyFmChannel(fm, channel, next);
    updateHeldMask(fm, channel, next);
  }, {track: false, allowLive: false});
  renderFmChannels();
}

function editCommon(key, value) {
  if (key === 'left' || key === 'right') {
    editPreset(preset => { preset.pan[key] = value; }, (fm, channel, preset) =>
      writeFmPan(fm, channel, preset, fmPlayback ? 0 : modulationWheelValue));
  } else if (key === 'ams' || key === 'pms') {
    editPreset(preset => { preset[key] = value; }, (fm, channel, preset) =>
      writeFmPan(fm, channel, preset, fmPlayback ? 0 : modulationWheelValue));
  } else {
    editPreset(preset => { preset[key] = value; }, (fm, channel, preset) => fm.setAlgo(channel, preset.algorithm, preset.feedback));
  }
}

function makeButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function buildFmControls() {
  const common = byId('fmCommon');
  for (const [key, label, max] of [['algorithm', 'ALGO', 7], ['feedback', 'FB', 7], ['ams', 'AMS', 3],
    ['pms', 'PMS', 7], ['left', 'Left', 1], ['right', 'Right', 1]]) {
    const control = createParamControl({ label, min: 0, max, step: 1, value: 0, wheelAdjust: false,
      booleanMode: key === 'left' || key === 'right', onChange: value => editCommon(key, value) });
    commonControls.set(key, control);
    common.append(control.element);
  }
  for (const [key, label, max] of [['enabled', 'LFO', 1], ['frequency', 'LFO rate', 7]]) {
    const control = createParamControl({ label, min: 0, max, step: 1, value: lfo[key], wheelAdjust: false,
      booleanMode: key === 'enabled', onChange(value) {
        if (fmPlayback) {
          editLiveFm((fm, _channel, _preset, snapshot) => {
            const settings = {...snapshot.lfo, [key]: value};
            fm.setLfo(settings.enabled, settings.frequency);
          });
          return;
        }
        lfo[key] = value;
        if (chip) writeFmLfo(chip.fm, modulationWheelValue);
        files.markInstrumentEdited('fm');
      } });
    lfoControls.set(key, control);
    common.append(control.element);
  }
  buildHeader(byId('operatorHeader'), operatorDefinitions);
  buildOperatorControls({ root: byId('operatorControls'), operatorNumbers: operators, defs: operatorDefinitions,
    operatorStates: Object.fromEntries(operators.map(operator => [operator, channels[0].operators[operator - 1]])),
    controlsMap: operatorControls, gateControls: operatorGates,
    getOperatorEnabled: operator => Boolean(selectedFmPreset().keyMask & (1 << (operator - 1))),
    onOperatorGateChange: toggleOperator,
    onChange: (operator, key, value) => editOperator(operator, {[key]: value}),
  });
  for (const id of ['sine', 'two-op-bell', 'fm-bass', 'four-op-brass', 'fm-electric-piano', 'four-op-pad']) {
    const voice = FM_PRESETS[id];
    byId('fmPresets').append(makeButton(voice.label, () => {
      applyFmPreset(voice);
      files.markInstrumentEdited('fm');
    }));
  }
  buildFmChannel3Controls();
  renderFm();
}

function renderChannels(root, labels, current, onSelect) {
  root.replaceChildren(...['AUTO', ...labels].map((label, index) => {
    const channel = index === 0 ? null : index - 1;
    const button = makeButton(label, () => {
      onSelect(channel);
      for (const [position, control] of [...root.children].entries()) control.setAttribute('aria-pressed', String(position === index));
    });
    button.setAttribute('aria-pressed', String(current === channel));
    return button;
  }));
}

function renderFmChannels() {
  const observed = fmView?.snapshot;
  const profile = observed?.variant ?? variant;
  const slots = physicalSlots[profile];
  const root = byId('fmChannels');
  if (channelProfile !== profile) {
    channelProfile = profile;
    root.replaceChildren(...['AUTO', ...slots.map(slot => 'CH' + (slot + 1))].map((label, index) =>
      makeButton(label, () => {
        const next = slots[index - 1] ?? null;
        if (!fmPlayback && fmSelection !== next) files.detachInstrument('fm');
        fmSelection = next;
        refreshFmView(true);
      })));
  }
  const selection = slots.includes(fmSelection) ? fmSelection : null;
  for (const [index, button] of [...root.children].entries()) {
    const physical = slots[index - 1] ?? null;
    const keyed = observed?.channels.find(voice => voice.physicalChannel === physical)?.gate;
    button.setAttribute('aria-pressed', String(selection === physical));
    button.dataset.keyed = String(Boolean(keyed));
  }
}

function stopVoice(section, voice) {
  if (!voice) return;
  if (section === 'ssg') sections.noteOffSSG(voice.channel);
  else if (section === 'adpcm-b') sections.noteOffAdpcmB(voice);
  else if (voice.started) chip?.fm.noteOff(voice.channel);
}

function renderKeys() {
  keyboardWheels.hidden = source !== 'fm';
  pitchWheel.disabled = modWheel.disabled = Boolean(fmPlayback);
  const voices = Object.values(voicePools).flatMap(pool => pool.voices());
  const down = new Set(voices.map(voice => voice.entry.key));
  for (const button of keyboard.querySelectorAll('.key')) button.setAttribute('aria-pressed', String(down.has(button.dataset.key)));
  const drumHits = new Set([...drumKeysDown.values()].map(hit => hit.entry));
  for (const button of drumKeyboard.querySelectorAll('.key')) {
    button.setAttribute('aria-pressed', String(drumHits.has(drumKeys.get(button.dataset.key))));
  }
  if (sections.isFollowingAdpcm(source)) {
    const reference = currentPlaybackReference();
    byId('keyboardStatus').textContent = `${reference?.kind === 'code' ? 'Stop Code' : 'Pause VGM'} to play these samples.`;
    return;
  }
  if (source === 'adpcm-a') {
    byId('keyboardStatus').textContent = [...drumHits].map(entry => entry.noteName).join(' · ') ||
      'Hold a key to play an ADPCM-A sample.';
    return;
  }
  if (source === 'ssg' && sections.isFollowingSsg()) {
    const reference = currentPlaybackReference();
    byId('keyboardStatus').textContent = `${reference?.kind === 'code' ? 'Stop Code' : 'Pause VGM'} to play the SSG voices.`;
    return;
  }
  const guidance = source === 'fm' && fmPlayback ? `${fmPlayback === 'code' ? 'Stop Code' : 'Pause VGM'} to edit or play the FM voices.` :
    ({fm: 'Play the FM channels with the keys below.', ssg: ssgChannel === null ? 'Play the SSG voices with the keys below.' : `Play SSG CH${ssgChannel + 1} with the keys below.`,
      'adpcm-b': 'Play the ADPCM-B sample with the keys below.'})[source];
  byId('keyboardStatus').textContent = !voicePools[source] ? 'Use the sample controls above.' :
    voices.filter(voice => voice.started).map(voice => voice.entry.noteName).join(' · ') || guidance;
}

function releaseDrumKey(owner) {
  const hit = drumKeysDown.get(owner);
  if (!hit) return;
  drumKeysDown.delete(owner);
  sections.stopAdpcmAKey(hit.entry.drumChannel, hit);
}

function releaseKey(owner) {
  releaseDrumKey(owner);
  for (const [section, pool] of Object.entries(voicePools)) stopVoice(section, pool.release(owner));
  renderKeys();
}

function releaseFmKeyboard() {
  for (const voice of voicePools.fm.clear()) stopVoice('fm', voice);
}

function releaseKeyboard() {
  setPitchBend(0);
  releaseAdpcmAKeyboard();
  for (const [section, pool] of Object.entries(voicePools)) {
    for (const voice of pool.clear()) stopVoice(section, voice);
  }
  renderKeys();
}

function releaseAdpcmAKeyboard() {
  if (!drumKeysDown.size) return;
  for (const owner of drumKeysDown.keys()) releaseDrumKey(owner);
  renderKeys();
}

function releaseAdpcmBKeyboard() {
  for (const voice of voicePools['adpcm-b'].clear()) stopVoice('adpcm-b', voice);
  renderKeys();
}

async function playKey(owner, entry) {
  const section = source, pool = voicePools[section];
  const followingSsg = section === 'ssg' && sections.isFollowingSsg();
  if (switching || sections.isFollowingAdpcm(section) || followingSsg || drumKeysDown.has(owner) ||
      Object.values(voicePools).some(voices => voices.voices().some(voice => voice.owner === owner))) return;
  if (section === 'adpcm-a') {
    if (entry.drumChannel === undefined) return;
    const hit = {entry};
    drumKeysDown.set(owner, hit);
    renderKeys();
    try { await sections.playAdpcmAKey(entry.drumChannel, hit); }
    catch (error) {
      if (drumKeysDown.get(owner) === hit) releaseKey(owner);
      report(error);
    }
    return;
  }
  if (!pool || entry.drumChannel !== undefined) return;
  if (section === 'fm' && fmPlayback) return;
  const choices = section === 'fm' ? fmTargets() : section === 'adpcm-b' ? [0] :
    ssgChannel === null ? [0, 1, 2] : [ssgChannel];
  const { voice, displaced } = pool.acquire(choices, {owner, entry});
  stopVoice(section, displaced);
  renderKeys();
  try {
    if (section === 'adpcm-b') {
      voice.started = await sections.noteOnAdpcmB(entry.midi, voice);
      if (!voice.started) pool.releaseVoice(voice);
    } else {
      const ready = await sound();
      if (!pool.isCurrent(voice)) return;
      if (section === 'fm') {
        const preset = presetFor(voice.channel);
        setFmVoicePitch(ready.fm, voice.channel, entry.midi);
        writeKeyMask(ready.fm, voice.channel, preset.keyMask);
      } else {
        await sections.noteOnSSG(voice.channel, entry.midi);
      }
      if (pool.isCurrent(voice)) voice.started = true;
    }
  } catch (error) {
    stopVoice(section, pool.releaseVoice(voice));
    report(error);
  }
  renderKeys();
}

function bindKeyboard(root, rowDefs, entries) {
  buildKeyboard({ root, rowDefs, layoutEntries: [...entries.values()], showPitch: false,
    onPointerDown(event, entry) { if (event.button === 0) void playKey('pointer:' + event.pointerId, entry); },
    onPointerUp(event) { releaseKey('pointer:' + event.pointerId); },
    onPointerCancel(event) { releaseKey('pointer:' + event.pointerId); },
  });
  for (const button of root.querySelectorAll('.key')) {
    const entry = entries.get(button.dataset.key);
    const owner = 'button:' + root.id + ':' + entry.key;
    button.addEventListener('keydown', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (!event.repeat) void playKey(owner, entry);
    });
    button.addEventListener('keyup', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      releaseKey(owner);
    });
    button.addEventListener('blur', () => releaseKey(owner));
    if (entry.drumChannel !== undefined) {
      button.addEventListener('click', async event => {
        if (event.detail !== 0 || switching || source !== 'adpcm-a') return;
        try { await sections.playAdpcmAKey(entry.drumChannel); }
        catch (error) { report(error); }
      });
    }
  }
}

function redrawKeyboard() {
  releaseKeyboard();
  const { rowDefs, entries } = createFretboardLayout({ state: fretboard, octave, clock: 8000000 });
  keys = new Map(entries.map(entry => [entry.key, entry]));
  bindKeyboard(keyboard, rowDefs, keys);
  renderFretboardControls({ instrumentRoot: byId('instruments'), positionRoot: byId('positions'),
    stringWindowRoot: byId('strings'), state: fretboard,
    onInstrumentChange(value) { setInstrument(fretboard, value); redrawKeyboard(); },
    onPositionPresetSelect(value) { setFretPosition(fretboard, value); redrawKeyboard(); },
    onStringWindowChange(index) { setStringWindowIndex(fretboard, index); redrawKeyboard(); },
  });
  byId('octave').value = octave > 0 ? '+' + octave : octave;
  byId('octaveDown').disabled = octave <= -2;
  byId('octaveUp').disabled = octave >= 2;
  renderKeys();
}

async function selectVariant(next) {
  if (switching || next === variant) return;
  switching = true;
  modeButtons.forEach(button => { button.disabled = true; });
  try {
    songs.clearPlayback();
    releaseKeyboard();
    sections.stop({invalidateB: true});
    await code.stop();
    code.clearSnapshot();
    await audio.close();
    chip = null;
    fmPitchAnchors.clear();
    visualizer.disconnect();
    drawScope();
    variant = next;
    if (!physicalSlots[variant].includes(fmSelection)) fmSelection = null;
    if (code.setMode()) {
      codeEditor.setSource(editor.value, files.getEntryPath());
      files.markCodeEdited();
    }
    refreshFmView(true);
    refreshReferencePanels();
    byId('chipSummary').textContent = next === 'ym2610b' ? 'YM2610B · 6 FM channels · 8 MHz' : 'Neo Geo · YM2610 · 4 FM channels · 8 MHz';
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.variant === variant)));
    announce('Play a key or trigger a sample to start audio.');
  } catch (error) {
    report(error);
  } finally {
    switching = false;
    modeButtons.forEach(button => { button.disabled = false; });
  }
}

function setModWheel(value) {
  if (modWheel.disabled) return;
  modWheel.value = String(value);
  const readout = Math.round(value * 100 / 127) + '%';
  byId('modulationValue').value = readout;
  modWheel.setAttribute('aria-valuetext', readout);
  if (value === modulationWheelValue) return;
  modulationWheelValue = value;
  if (chip) applyFmModulation(chip.fm, value);
}

function bindKeyboardWheels() {
  const navigationKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
  for (const [wheel, setValue] of [[pitchWheel, setPitchBend], [modWheel, setModWheel]]) {
    const spring = wheel === pitchWheel;
    let pointer = null;
    wheel.addEventListener('input', () => {
      if (!wheel.disabled) setValue(Number(wheel.value));
    });
    wheel.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      pointer = event.pointerId;
      wheel.blur();
    });
    wheel.addEventListener('focus', () => {
      if (pointer !== null) wheel.blur();
    });
    const releasePointer = event => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      if (spring) setValue(0);
    };
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    wheel.addEventListener('lostpointercapture', releasePointer);
    window.addEventListener('blur', () => { pointer = null; });
    wheel.addEventListener('keydown', event => {
      if (wheel.disabled) return;
      if (spring && event.key === 'Escape') {
        event.preventDefault();
        setValue(0);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        setValue(Number(event.key === 'Home' ? wheel.min : wheel.max));
      }
    });
    if (spring) {
      wheel.addEventListener('keyup', event => {
        if (navigationKeys.has(event.key)) setValue(0);
      });
      wheel.addEventListener('blur', () => {
        if (pointer === null) setValue(0);
      });
    }
  }
}

bindKeyboardWheels();

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof Element && event.target.closest(textEntry)) return;
  const drums = source === 'adpcm-a';
  const entry = (drums ? drumKeys : keys).get(event.key.toLowerCase());
  if (!entry || (!drums && !voicePools[source])) return;
  event.preventDefault();
  if (!event.repeat) void playKey('key:' + event.code, entry);
});
window.addEventListener('keyup', event => releaseKey('key:' + event.code));
window.addEventListener('blur', releaseKeyboard);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseKeyboard();
  else monitorOutput();
});
modeButtons.forEach(button => button.addEventListener('click', () => void selectVariant(button.dataset.variant)));
byId('silence').addEventListener('click', () => {
  songs.stop();
  releaseKeyboard();
  sections.stop({invalidateB: true});
  const endpoint = chip;
  void code.stop().then(() => {
    if (!endpoint || chip !== endpoint || code.getState().running) return;
    endpoint.fm.reset();
    fmPitchAnchors.clear();
    applyFmSettings(endpoint.fm);
  }).catch(report);
});
for (const [id, delta] of [['octaveDown', -1], ['octaveUp', 1]]) {
  byId(id).addEventListener('click', () => { octave += delta; redrawKeyboard(); });
}
const master = byId('masterLevel');
const setMaster = () => {
  audio.setMasterVolume(Number(master.value) / 100);
  byId('masterValue').value = master.value + '%';
};
master.addEventListener('input', setMaster);
setMaster();
byId('muteOutput').addEventListener('click', event => {
  const button = event.currentTarget;
  const muted = button.getAttribute('aria-pressed') !== 'true';
  audio.setMuted('chip', muted);
  button.setAttribute('aria-pressed', String(muted));
});

function setupOutputMixer() {
  const mixer = byId('mixerSources');
  const sources = [['fm', 'FM'], ['ssg', 'SSG'], ['adpcm-a', 'ADPCM-A'], ['adpcm-b', 'ADPCM-B']];
  const levels = sources.map(() => ({gain: 1, muted: false}));
  function apply() {
    const gains = levels.map(level => level.muted ? 0 : level.gain);
    try {
      audio.setSourceGains(gains);
      sections.setAdpcmBSourceGains(gains);
      songs.setSourceGains(gains);
    } catch (error) { report(error); }
  }
  for (const [index, [sourceId, name]] of sources.entries()) {
    const row = document.createElement('div');
    row.className = 'mixer-source';
    row.dataset.mixerSource = sourceId;
    const label = document.createElement('label');
    label.textContent = name;
    const input = document.createElement('input');
    Object.assign(input, {type: 'range', min: '0', max: '3.8', step: '0.01', value: '1'});
    input.id = 'mixer-' + sourceId + '-gain';
    label.htmlFor = input.id;
    input.setAttribute('aria-label', name + ' volume');
    const value = document.createElement('output');
    value.value = '100%';
    value.setAttribute('for', input.id);
    const level = levels[index];
    input.addEventListener('input', () => {
      level.gain = Number(input.value);
      value.value = Math.round(level.gain * 100) + '%';
      apply();
    });
    const mute = makeButton('Mute', () => {
      level.muted = !level.muted;
      mute.setAttribute('aria-pressed', String(level.muted));
      apply();
    });
    mute.setAttribute('aria-label', 'Mute ' + name);
    mute.setAttribute('aria-pressed', 'false');
    row.append(label, input, value, mute);
    mixer.append(row);
  }
}
setupOutputMixer();

const scopeButtons = [...byId('scopeModes').querySelectorAll('button')];
for (const button of scopeButtons) button.addEventListener('click', () => {
  scopeMode = button.dataset.scope;
  scopeButtons.forEach(control => control.setAttribute('aria-pressed', String(control === button)));
  scope.setAttribute('aria-label', 'Output ' + scopeMode);
  drawScope();
});
new ResizeObserver(drawScope).observe(scope);

window.addEventListener('pagehide', event => {
  releaseKeyboard();
  sections.stop({invalidateB: !event.persisted});
  if (!event.persisted) {
    envelope.dispose();
    codeEditor.dispose();
  }
});
const ssgChannels = document.createElement('div');
ssgChannels.className = 'inline-controls ssg-channels';
ssgChannels.setAttribute('role', 'group');
ssgChannels.setAttribute('aria-label', 'SSG channel');
byId('ssgPanel').querySelector('.section-heading').after(ssgChannels);
renderChannels(ssgChannels, ['CH1', 'CH2', 'CH3'], ssgChannel, channel => {
  ssgChannel = channel;
  sections.showSSGChannel(channel);
  renderKeys();
});
buildFmControls();
renderFmChannels();
bindKeyboard(drumKeyboard, [{keys: ADPCM_A_KEYS, rowIndex: 0, stringNumber: 0}], drumKeys);
redrawKeyboard();
drawScope();

const editor = byId('code');
const runCode = byId('runCode');
const applyCode = byId('applyCode');
editor.readOnly = true;
runCode.disabled = true;

const codeEditor = setupFm2610CodeEditor({
  textarea: editor, editorHost: byId('codeEditorHost'), editorNote: byId('codeEditorNote'),
  whenReady: () => files.ready,
  getPath: () => files.getEntryPath(),
  listFiles: () => files.listCodeFiles(),
  openFile: path => files.openCodeFile(path),
  onEdit: () => files.markCodeEdited(),
  run(apply = false) { (apply ? applyCode : runCode).click(); },
  visible: () => !byId('codePanel').hidden,
});

const files = setupFm2610Files({
  panel: byId('filesPanel'),
  toggle: byId('filesToggle'),
  menuMount: {new: byId('projectNew'), import: byId('projectImport'), export: byId('projectExport')},
  getPatch() {
    if (fmPlayback) throw new Error(`${fmPlayback === 'code' ? 'Stop Code' : 'Pause VGM'} to save the FM patch.`);
    return {...selectedFmPreset(), lfo};
  },
  applyPatch(preset, {show}) {
    if (fmPlayback) throw new Error(`${fmPlayback === 'code' ? 'Stop Code' : 'Pause VGM'} to open the FM patch.`);
    applyFmPreset(preset);
    workspaceView.select('fmTab', {focus: show, reveal: show});
    if (workspace.dataset.mode === 'synth') workspaceView.select('keyboardTab');
  },
  getSsgPreset: sections.getSsgPreset,
  applySsgPreset(preset, {show}) {
    sections.applySsgPreset(preset);
    if (show) {
      workspaceView.select('ssgTab', {focus: true});
      if (workspace.dataset.mode === 'synth') workspaceView.select('keyboardTab');
    }
  },
  getAdpcmAKit: sections.getAdpcmAKit,
  applyAdpcmAKit(kit, {show}) {
    sections.applyAdpcmAKit(kit);
    if (show) {
      workspaceView.select('adpcmATab', {focus: true});
      if (workspace.dataset.mode === 'synth') workspaceView.select('keyboardTab');
    }
  },
  getAdpcmBSample: sections.getAdpcmBSample,
  applyAdpcmBSample(sample, {show}) {
    sections.applyAdpcmBSample(sample);
    if (show) {
      workspaceView.select('adpcmBTab', {focus: true});
      if (workspace.dataset.mode === 'synth') workspaceView.select('keyboardTab');
    }
  },
  getCode: () => editor.value,
  async setCode(source, path, {show}) {
    if (show) await code.stop();
    codeEditor.setSource(source, path);
    if (show) {
      workspaceView.select('codeTab');
      codeEditor.focus();
    }
  },
  starterCode: code.getStarter,
  setStatus: announce,
  async beforeReplace() {
    songs.clear();
    await code.stop();
    code.clearSnapshot();
  },
  onVgmChange: () => queueMicrotask(() => songs.refresh()),
  openVgm: path => songs.selectFile(path),
  importVgm: file => songs.importFile(file),
});
const workspaceView = setupFm2610Workspace({
  showFiles: () => files.show(true),
  focusCode: codeEditor.focus,
  onViewChange({sourceTab, expanded, inputTab}) {
    const section = sourceTab.dataset.source;
    if (voicePools[section]) keyboardSource = section;
    const drums = section === 'adpcm-a';
    const useKeyboardSource = section === 'mixer' || (drums && expanded && inputTab?.id === 'codeTab');
    const leavingDrums = source === 'adpcm-a' && (!drums || useKeyboardSource);
    source = useKeyboardSource ? keyboardSource : section;
    if (source !== 'fm' || inputTab?.id !== 'keyboardTab') setPitchBend(0);
    if (leavingDrums) releaseAdpcmAKeyboard();
    keyboardToolbar.hidden = byId('keyboardWithWheels').hidden = source === 'adpcm-a';
    drumKeyboard.hidden = source !== 'adpcm-a';
    const showFm = section === 'fm' && !byId('fmPanel').closest('[hidden]');
    envelope.setVisible(showFm);
    if (showFm) refreshFmView(true);
    refreshReferencePanels();
    renderKeys();
    drawScope();
    if (inputTab?.id === 'codeTab') {
      codeEditor.layout();
      void codeEditor.load().catch(report);
    }
  },
});
void files.ready.then(() => {
  editor.readOnly = false;
  runCode.disabled = code.getState().busy;
});
const menu = byId('synthMenu');
menu.addEventListener('click', event => {
  if (event.target instanceof Element && event.target.closest('[data-close-synth-menu]')) menu.open = false;
});
document.addEventListener('pointerdown', event => {
  if (!menu.contains(event.target)) menu.open = false;
});
menu.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});
