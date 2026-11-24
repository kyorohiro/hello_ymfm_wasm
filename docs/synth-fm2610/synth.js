// SPDX-License-Identifier: BSD-3-Clause
import { FM_PRESETS, readFmPreset } from '../synth-fm2608/preset.js';
import { buildHeader, buildOperatorControls, createParamControl } from '../synth/synth_controls.js';
import {
  buildKeyboard, createFretboardLayout, createFretboardState, renderFretboardControls,
  setFretPosition, setInstrument, setStringWindowIndex,
} from '../synth/synth_keyboard.js';
import { createOperatorEnvelopeView } from '../synth/synth_operator_envelope.js';
import { createSynthOutputVisualizer } from '../synth/synth_output_visualizer.js';
import { setSynthSongVoiceFrequency } from '../synth/synth_song_voice.js';
import { midiToOpnPitch } from '../js/soundchip_pitch.js';
import { createVsuVoicePool } from '../synth-vsu/voice-pool.js';
import { createFm2610Audio } from './audio.js';
import { setupFm2610Code } from './code.js';
import { setupFm2610Files } from './files.js';
import { captureFm2610Patch, fmCaptureReason, readFm2610Patch } from './fm_patch.js';
import { ADPCM_A_KEYS, setupFm2610Sections } from './sections.js';
import { createFm2610SongAdpcmAAudition } from './song_adpcm_a_audition.js';
import { createFm2610SongAdpcmBAudition } from './song_adpcm_b_audition.js';
import { createFm2610SongAudition } from './song_audition.js';
import { setupFm2610SongControls } from './song_controls.js';
import { setupFm2610Workspace } from './workspace.js';

const byId = id => document.getElementById(id);
const modeButtons = [...byId('chipModes').querySelectorAll('button')];
const status = byId('status');
const keyboard = byId('keyboard');
const drumKeyboard = byId('adpcmAKeyboard');
const keyboardToolbar = byId('keyboardPanel').querySelector('.keyboard-toolbar');
const scope = byId('scope');
const liveToggle = byId('fmLive');
const captureButton = byId('fmCapture');
const envelopeRoot = byId('fmEnvelope');
const workspace = byId('workspace');
const audio = createFm2610Audio();
const audition = createFm2610SongAudition();
const adpcmAuditions = {
  a: {voice: createFm2610SongAdpcmAAudition(), revision: 0},
  b: {voice: createFm2610SongAdpcmBAudition(), revision: 0},
};
const visualizer = createSynthOutputVisualizer({
  background: '#18150f', grid: '#4b3b26', labels: '#bfaf91', trace: '#ffcc78',
});
const voicePools = { fm: createVsuVoicePool(), ssg: createVsuVoicePool(), 'adpcm-b': createVsuVoicePool() };
const drumKeys = new Map(Array.from(ADPCM_A_KEYS, (key, drumChannel) => [key, {
  key, drumChannel, label: key.toUpperCase(), noteName: `A${drumChannel + 1}`, stringNumber: 0, fret: drumChannel,
}]));
const drumKeysDown = new Map();
const fretboard = createFretboardState();
const physicalSlots = { ym2610b: [0, 1, 2, 3, 4, 5], ym2610: [1, 2, 4, 5] };
const channels = physicalSlots.ym2610b.map(() => readFmPreset(FM_PRESETS['one-op-basic']));
const operators = [1, 2, 3, 4];
const operatorDefinitions = [
  ['dt', 'DT', 7], ['multi', 'MULT', 15], ['tl', 'TL', 127], ['rs', 'RS', 3], ['ar', 'AR', 31],
  ['am', 'AM', 1], ['d1r', 'D1R', 31], ['d2r', 'D2R', 31], ['sl', 'SL', 15], ['rr', 'RR', 15], ['ssg', 'SSG-EG', 15],
].map(([id, label, max]) => ({ id, label, min: 0, max, step: 1, booleanMode: id === 'am' }));
const commonControls = new Map(), operatorControls = new Map();
const operatorGates = new Map();
const lfoControls = new Map();
const lfo = { enabled: false, frequency: 0 };
const gateMethods = new Set(['keyOn', 'keyOff', 'noteOn', 'noteOnRaw', 'noteOff']);
const ssgGateMethods = new Set([...gateMethods, 'tone', 'noise', 'off']);
const codeEndpoints = new WeakMap();
const textEntry = 'input:not([type="range"], [type="checkbox"], [type="radio"]), textarea, select, [contenteditable]';
let variant = 'ym2610b', switching = false, chip = null, source = 'fm';
let keyboardSource = 'fm';
let fmChannel = null, ssgChannel = null, octave = 0, keys = new Map();
let scopeMode = 'waveform', scopeFrame = null;
let songState = {playback: 'stopped'}, fmView = null, auditionVoice = null;
let channelProfile = '';
const liveChannels = {};
const envelope = createOperatorEnvelopeView({
  root: envelopeRoot,
  getOperators: () => [null, ...(fmView?.voice.preset ?? presetFor(fmChannel ?? 0)).operators],
  getSelectionKey: () => fmView ? fmView.kind + ':' + fmView.voice.physicalChannel : variant + ':' + fmChannel,
  onEdit(operator, patch) {
    if (!fmView) editOperator(operator, patch);
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
    if (source === 'fm' && songState.playback !== 'playing') refreshFmView();
    monitorOutput();
  });
}

function presetFor(channel) { return channels[physicalSlots[variant][channel]]; }
function fmTargets() {
  return fmChannel === null ? physicalSlots[variant].map((_, channel) => channel) : [fmChannel];
}

function applyFmChannel(fm, channel, preset) {
  fm.setPreset(channel, preset);
  if (physicalSlots[variant][channel] === 2) fm.setChannel3SpecialMode(Boolean(preset.specialFrequencies));
}

function applyFmSettings(fm) {
  physicalSlots[variant].forEach((_, channel) => applyFmChannel(fm, channel, presetFor(channel)));
  fm.setLfo(lfo.enabled, lfo.frequency);
}

async function sound() {
  const selected = variant;
  if (switching) throw new DOMException('Chip change in progress.', 'AbortError');
  const next = await audio.start(selected);
  if (switching || selected !== variant) throw new DOMException('Chip changed.', 'AbortError');
  if (next !== chip) {
    applyFmSettings(next.fm);
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
  const endpoint = await sound();
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
  releaseAdpcmBKeyboard();
  sections.stopAdpcm({invalidateB: true});
  endpoint.adpcmA.keyOff([0, 1, 2, 3, 4, 5]);
  endpoint.adpcmB.keyOff();
  applyFmSettings(endpoint.fm);
}

const sections = setupFm2610Sections({
  ssgPanel: byId('ssgPanel'), adpcmAPanel: byId('adpcmAPanel'), adpcmBPanel: byId('adpcmBPanel'), sound, report,
  releaseAdpcmBKeyboard,
  onAdpcmLiveChange: renderKeys,
  playSongAdpcmA: (snapshot, channel, bytes, readSettings) =>
    playPausedAdpcm('a', snapshot, () => [channel, bytes, readSettings()]),
  stopSongAdpcmA: () => stopPausedAdpcm('a'),
  setSongAdpcmAVoice: adpcmAuditions.a.voice.setVoice,
  setSongAdpcmALevel: adpcmAuditions.a.voice.setVolume,
  playSongAdpcmB: (snapshot, bytes, options) => playPausedAdpcm('b', snapshot, () => [bytes, options]),
  stopSongAdpcmB: () => stopPausedAdpcm('b'),
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
  textarea: byId('code'), runButton: byId('runCode'), stopButton: byId('stopCode'),
  status: byId('codeStatus'), output: byId('codeOutput'), sound: codeSound,
  getMode: () => variant, stopSound: stopCodeSound,
  beforeRun: () => songs.stop(),
  onState: () => queueMicrotask(() => refreshFmView()),
  prepareSource: (...args) => files.prepareSource(...args),
  readFile: (...args) => files.readFile(...args),
  getEntryPath: () => files.getEntryPath(),
});
const songs = setupFm2610SongControls({
  getFiles: () => files,
  sound,
  beforePlay() {
    releaseKeyboard();
    return code.stop();
  },
  onPlayback(state) {
    songState = state;
    refreshFmView();
    refreshAdpcmView();
  },
  announce,
  report,
});

function refreshAdpcmView() {
  const following = sections.isFollowingAdpcm(source);
  const auditioning = canAuditionAdpcm(source);
  const panel = {'adpcm-a': 'adpcmAPanel', 'adpcm-b': 'adpcmBPanel'}[source];
  const visible = panel && !byId(panel).closest('[hidden]') ? source : undefined;
  sections.setSongAdpcm(songState.snapshot, {getAdpcmAWindow: songs.getAdpcmAWindow,
    readAdpcmA: songs.readAdpcmABytes, readAdpcmB: songs.readAdpcmBBytes,
    visible, paused: songState.playback === 'paused'});
  if (following !== sections.isFollowingAdpcm(source) || auditioning !== canAuditionAdpcm(source)) renderKeys();
}

function canAuditionAdpcm(section) {
  if (section === 'adpcm-a') return sections.canAuditionAdpcmA();
  return section === 'adpcm-b' && sections.canAuditionAdpcmB();
}

async function playPausedAdpcm(kind, snapshot, readArgs) {
  const player = adpcmAuditions[kind];
  const {revision} = player;
  const endpoint = await sound();
  if (revision !== player.revision || songState.snapshot !== snapshot || songState.playback !== 'paused') return;
  return player.voice.audition(endpoint, snapshot, ...readArgs());
}

function stopPausedAdpcm(kind) {
  const player = adpcmAuditions[kind];
  player.revision++;
  void player.voice.close()?.catch(report);
}

function autoLiveVoice(kind, voices) {
  if (kind === 'code') {
    const active = voices.reduce((best, voice) => voice.codeGate &&
      (!best || voice.codeKeyOnOrder > best.codeKeyOnOrder) ? voice : best, null);
    if (active) return active;
    const recent = voices.reduce((best, voice) => voice.codeKeyOnOrder > best.codeKeyOnOrder ? voice : best);
    if (recent.codeKeyOnOrder) return recent;
  }
  return voices.find(voice => voice.gate) ?? voices.find(voice => voice.lastKeyMask) ?? voices[0];
}

function currentFmView() {
  if (!liveToggle.checked) return null;
  const kind = songState.snapshot ? 'vgm' : 'code';
  const snapshot = songState.snapshot ?? code.getFmSnapshot();
  if (!snapshot?.channels?.length) return null;
  const selection = Object.hasOwn(liveChannels, kind) ?
    liveChannels[kind] : physicalSlots[variant][fmChannel];
  const selected = snapshot.channels.find(voice => voice.physicalChannel === selection);
  const voice = selected ?? autoLiveVoice(kind, snapshot.channels);
  const paused = kind === 'vgm' && songState.playback === 'paused';
  return {kind, snapshot, selection: selected?.physicalChannel ?? null, voice, paused};
}

function refreshFmView(force = false) {
  const previous = fmView, next = currentFmView();
  if (previous?.paused && (!next?.paused || next.voice.physicalChannel !== previous.voice.physicalChannel ||
      next.snapshot.revision !== previous.snapshot.revision)) stopAudition();
  fmView = next;
  if (force || previous?.kind !== next?.kind || previous?.snapshot.variant !== next?.snapshot.variant ||
      previous?.snapshot.revision !== next?.snapshot.revision || previous?.voice.physicalChannel !== next?.voice.physicalChannel ||
      previous?.paused !== next?.paused) {
    renderFmChannels();
    renderFm();
    renderKeys();
  }
}

function renderFm() {
  const voice = fmView?.voice;
  const preset = voice?.preset ?? presetFor(fmChannel ?? 0);
  for (const [key, control] of commonControls) control.updateVisual(preset[key] ?? preset.pan[key]);
  for (const [key, control] of lfoControls) control.updateVisual((fmView?.snapshot.lfo ?? lfo)[key]);
  for (const [operator, controls] of operatorControls) {
    for (const [key, control] of controls) control.updateVisual(preset.operators[operator - 1][key]);
  }
  for (const [operator, button] of operatorGates) {
    button.setAttribute('aria-pressed', String(Boolean((voice?.keyMask ?? preset.keyMask) & (1 << (operator - 1)))));
  }
  envelopeRoot.toggleAttribute('data-live', Boolean(voice));
  envelopeRoot.querySelector('.operator-envelope-plot').inert = Boolean(voice);
  byId('fmParameters').disabled = Boolean(voice);
  captureButton.hidden = fmView?.kind !== 'vgm';
  const reason = fmView?.paused ? fmCaptureReason(fmView.snapshot, voice) : '';
  captureButton.disabled = !fmView?.paused || Boolean(reason);
  captureButton.title = reason || (fmView?.paused ? '' : 'Pause VGM to capture the current sound.');
  const physical = voice?.physicalChannel ?? physicalSlots[variant][fmChannel];
  const channelName = physical === undefined ? 'AUTO' : 'CH' + (physical + 1);
  const phase = voice?.gate ? 'Key on · OP ' + operators.filter(op => voice.keyMask & (1 << (op - 1))).join('/') : 'Key off';
  byId('fmChannelState').textContent = voice ?
    [fmView.kind === 'vgm' ? 'VGM' : 'Code', fmView.snapshot.variant.toUpperCase(), channelName,
      phase, voice.specialMode ? 'CH3 Special' : '', reason].filter(Boolean).join(' · ') :
    'Synth · ' + channelName + (preset.specialFrequencies ? ' · CH3 Special' : '');
  envelope.invalidate();
}

function editPreset(update, write) {
  for (const channel of fmTargets()) {
    const preset = presetFor(channel);
    update(preset);
    if (chip) write(chip.fm, channel, preset);
  }
  renderFm();
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
  }, updateHeldMask);
}

function editOperator(operator, patch) {
  const index = operator - 1;
  editPreset(preset => {
    Object.assign(preset.operators[index], patch);
  }, (fm, channel) => fm.setOperator(channel, index, patch));
}

function applyFmPreset(preset) {
  const {lfo: patchLfo, ...patch} = readFm2610Patch(preset);
  if (patch.specialFrequencies) {
    releaseKeyboard();
    fmChannel = physicalSlots[variant].indexOf(2);
  }
  if (patchLfo) {
    Object.assign(lfo, patchLfo);
    chip?.fm.setLfo(lfo.enabled, lfo.frequency);
  }
  editPreset(target => {
    delete target.specialFrequencies;
    Object.assign(target, readFm2610Patch(patch));
  }, (fm, channel, next) => {
    applyFmChannel(fm, channel, next);
    updateHeldMask(fm, channel, next);
  });
  renderFmChannels();
}

function editCommon(key, value) {
  if (key === 'left' || key === 'right') {
    editPreset(preset => { preset.pan[key] = value; }, (fm, channel, preset) => {
      fm.setPan(channel, preset.pan.left, preset.pan.right, preset.ams, preset.pms);
    });
  } else if (key === 'ams' || key === 'pms') {
    editPreset(preset => { preset[key] = value; }, (fm, channel, preset) => fm.setModulation(channel, preset.ams, preset.pms));
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
        lfo[key] = value;
        chip?.fm.setLfo(lfo.enabled, lfo.frequency);
      } });
    lfoControls.set(key, control);
    common.append(control.element);
  }
  buildHeader(byId('operatorHeader'), operatorDefinitions);
  buildOperatorControls({ root: byId('operatorControls'), operatorNumbers: operators, defs: operatorDefinitions,
    operatorStates: Object.fromEntries(operators.map(operator => [operator, channels[0].operators[operator - 1]])),
    controlsMap: operatorControls, gateControls: operatorGates,
    getOperatorEnabled: operator => Boolean(presetFor(fmChannel ?? 0).keyMask & (1 << (operator - 1))),
    onOperatorGateChange: toggleOperator,
    onChange: (operator, key, value) => editOperator(operator, {[key]: value}),
  });
  for (const id of ['sine', 'two-op-bell', 'fm-bass', 'four-op-brass', 'fm-electric-piano', 'four-op-pad']) {
    const voice = FM_PRESETS[id];
    byId('fmPresets').append(makeButton(voice.label, () => applyFmPreset(voice)));
  }
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
  const slots = physicalSlots[observed?.variant ?? variant];
  const profile = (fmView?.kind ?? 'synth') + ':' + (observed?.variant ?? variant);
  const root = byId('fmChannels');
  if (channelProfile !== profile) {
    channelProfile = profile;
    root.replaceChildren(...['AUTO', ...slots.map(slot => 'CH' + (slot + 1))].map((label, index) =>
      makeButton(label, () => {
        if (fmView) liveChannels[fmView.kind] = slots[index - 1] ?? null;
        else fmChannel = index ? index - 1 : null;
        refreshFmView(true);
      })));
  }
  const selection = fmView ? fmView.selection : slots[fmChannel] ?? null;
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
  else if (section === 'adpcm-b') {
    if (voice.songSample) sections.noteOffSongAdpcmB(voice);
    else sections.noteOffAdpcmB(voice);
  }
  else if (voice.started) chip?.fm.noteOff(voice.channel);
}

function renderKeys() {
  const voices = Object.values(voicePools).flatMap(pool => pool.voices());
  if (auditionVoice) voices.push(auditionVoice);
  const down = new Set(voices.map(voice => voice.entry.key));
  for (const button of keyboard.querySelectorAll('.key')) button.setAttribute('aria-pressed', String(down.has(button.dataset.key)));
  const drumHits = new Set(drumKeysDown.values());
  for (const button of drumKeyboard.querySelectorAll('.key')) {
    button.setAttribute('aria-pressed', String(drumHits.has(drumKeys.get(button.dataset.key))));
  }
  const auditioningAdpcm = canAuditionAdpcm(source);
  if (sections.isFollowingAdpcm(source) && !auditioningAdpcm) {
    byId('keyboardStatus').textContent = songState.playback === 'paused' ? 'The selected VGM sample is unavailable for audition.' :
      'Pause VGM to audition, or turn off Live to play the Synth samples.';
    return;
  }
  if (source === 'adpcm-a') {
    byId('keyboardStatus').textContent = [...drumHits].map(entry => entry.noteName).join(' · ') ||
      (auditioningAdpcm ? 'Audition the paused VGM pads with these keys.' : 'Trigger the ADPCM-A pads with the six keys below.');
    return;
  }
  const liveSong = source === 'fm' && fmView?.kind === 'vgm';
  const guidance = liveSong ? (fmView.paused ? 'Play the paused VGM channel with the keys below.' : 'Pause VGM to play the selected channel.') :
    ({fm: 'Play the FM channels with the keys below.', ssg: ssgChannel === null ? 'Play the SSG voices with the keys below.' : `Play SSG CH${ssgChannel + 1} with the keys below.`,
      'adpcm-b': auditioningAdpcm ? 'Play the paused VGM sample. Reference note uses the recorded playback rate.' :
        'Play the ADPCM-B sample with the keys below.'})[source];
  byId('keyboardStatus').textContent = !voicePools[source] ? 'Use the sample controls above.' :
    voices.filter(voice => voice.started).map(voice => voice.entry.noteName).join(' · ') || guidance;
}

function releaseKey(owner) {
  drumKeysDown.delete(owner);
  if (auditionVoice?.owner === owner) {
    auditionVoice.player?.stop();
    auditionVoice = null;
  }
  for (const [section, pool] of Object.entries(voicePools)) stopVoice(section, pool.release(owner));
  renderKeys();
}

function stopAudition() {
  auditionVoice = null;
  void audition.close()?.catch(report);
}

function releaseKeyboard() {
  drumKeysDown.clear();
  stopAudition();
  for (const [section, pool] of Object.entries(voicePools)) {
    for (const voice of pool.clear()) stopVoice(section, voice);
  }
  renderKeys();
}

function releaseAdpcmBKeyboard() {
  for (const voice of voicePools['adpcm-b'].clear()) stopVoice('adpcm-b', voice);
  renderKeys();
}

async function playAudition(owner, entry) {
  const {snapshot, voice} = fmView;
  if (auditionVoice?.owner === owner || fmCaptureReason(snapshot, voice)) return;
  auditionVoice?.player?.stop();
  const current = {owner, entry};
  auditionVoice = current;
  try {
    const endpoint = await sound();
    if (auditionVoice !== current) return;
    const player = await audition.prepare(endpoint, snapshot, voice, captureFm2610Patch(snapshot, voice));
    if (auditionVoice !== current) return;
    current.player = player;
    player.play(entry.midi);
    current.started = true;
  } catch (error) {
    if (auditionVoice !== current) return;
    auditionVoice = null;
    report(error);
  }
  renderKeys();
}

async function playKey(owner, entry) {
  const section = source, pool = voicePools[section];
  const followingAdpcm = sections.isFollowingAdpcm(section);
  const blockedByAdpcmLive = followingAdpcm && !canAuditionAdpcm(section);
  if (switching || blockedByAdpcmLive || drumKeysDown.has(owner) ||
      Object.values(voicePools).some(voices => voices.voices().some(voice => voice.owner === owner))) return;
  if (section === 'adpcm-a') {
    if (entry.drumChannel === undefined) return;
    drumKeysDown.set(owner, entry);
    renderKeys();
    try { await sections.playAdpcmAKey(entry.drumChannel); }
    catch (error) { report(error); }
    return;
  }
  if (!pool || entry.drumChannel !== undefined) return;
  if (section === 'fm' && liveToggle.checked && ['playing', 'paused', 'pausing', 'loading'].includes(songState.playback)) {
    if (fmView?.paused) await playAudition(owner, entry);
    return;
  }
  const choices = section === 'fm' ? fmTargets() : section === 'adpcm-b' ? [0] :
    ssgChannel === null ? [0, 1, 2] : [ssgChannel];
  const { voice, displaced } = pool.acquire(choices, { owner, entry, songSample: section === 'adpcm-b' && followingAdpcm });
  stopVoice(section, displaced);
  renderKeys();
  try {
    if (section === 'adpcm-b') {
      voice.started = voice.songSample ? await sections.noteOnSongAdpcmB(entry.midi, voice) : await sections.noteOnAdpcmB(entry.midi, voice);
      if (!voice.started) pool.releaseVoice(voice);
    } else {
      const ready = await sound();
      if (!pool.isCurrent(voice)) return;
      if (section === 'fm') {
        const preset = presetFor(voice.channel);
        if (preset.specialFrequencies) {
          const {block, fnum} = midiToOpnPitch(entry.midi, ready.fm.clock);
          setSynthSongVoiceFrequency(ready.fm, voice.channel, block, fnum, preset.specialFrequencies);
        } else ready.fm.setNote(voice.channel, entry.midi);
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
      button.addEventListener('click', event => {
        if (event.detail !== 0) return;
        void playKey(owner, entry);
        releaseKey(owner);
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
    songs.stop();
    releaseKeyboard();
    sections.stop();
    await code.stop();
    await audio.close();
    chip = null;
    visualizer.disconnect();
    drawScope();
    variant = next;
    fmChannel = null;
    if (code.setMode()) files.markCodeEdited();
    refreshFmView(true);
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
  void code.stop().catch(report);
  if (chip) {
    chip.fm.reset();
    applyFmSettings(chip.fm);
  }
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
      audition.setSourceGains(gains);
      for (const {voice} of Object.values(adpcmAuditions)) voice.setSourceGains(gains);
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
  stopAudition();
  stopPausedAdpcm('a');
  stopPausedAdpcm('b');
  if (!event.persisted) envelope.dispose();
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
editor.readOnly = true;
runCode.disabled = true;

const files = setupFm2610Files({
  panel: byId('filesPanel'),
  toggle: byId('filesToggle'),
  menuMount: {new: byId('projectNew'), import: byId('projectImport'), export: byId('projectExport')},
  getPatch() {
    if (fmView) throw new Error('Switch to Synth or capture the paused VGM channel before saving.');
    return {...presetFor(fmChannel ?? 0), lfo};
  },
  applyPatch(preset, {show}) {
    if (fmView) {
      liveToggle.checked = false;
      refreshFmView(true);
    }
    applyFmPreset(preset);
    workspaceView.select('fmTab', {focus: show, reveal: show});
    if (workspace.dataset.mode === 'synth') workspaceView.select('keyboardTab');
  },
  getAdpcmAKit: sections.getAdpcmAKit,
  applyAdpcmAKit(kit, {show}) {
    sections.applyAdpcmAKit(kit);
    if (show) {
      sections.showAdpcmEditor('adpcm-a');
      workspaceView.select('adpcmATab', {focus: true});
      if (workspace.dataset.mode === 'synth') workspaceView.select('keyboardTab');
    }
  },
  getAdpcmBSample: sections.getAdpcmBSample,
  applyAdpcmBSample(sample, {show}) {
    sections.applyAdpcmBSample(sample);
    if (show) {
      sections.showAdpcmEditor('adpcm-b');
      workspaceView.select('adpcmBTab', {focus: true});
      if (workspace.dataset.mode === 'synth') workspaceView.select('keyboardTab');
    }
  },
  getCode: () => editor.value,
  async setCode(source, path, {show}) {
    if (show) await code.stop();
    editor.value = source;
    if (show) {
      workspaceView.select('codeTab');
      editor.focus({preventScroll: true});
    }
  },
  starterCode: code.getStarter,
  setStatus: announce,
  async beforeReplace() {
    songs.clear();
    await code.stop();
  },
  onVgmChange: () => queueMicrotask(() => songs.refresh()),
  openVgm: path => songs.selectFile(path),
  importVgm: file => songs.importFile(file),
});
const workspaceView = setupFm2610Workspace({
  showFiles: () => files.show(true),
  onViewChange({sourceTab, expanded, inputTab}) {
    const section = sourceTab.dataset.source;
    if (voicePools[section]) keyboardSource = section;
    const drums = section === 'adpcm-a';
    const useKeyboardSource = section === 'mixer' || (drums && expanded && inputTab?.id === 'codeTab');
    source = useKeyboardSource ? keyboardSource : section;
    keyboardToolbar.hidden = keyboard.hidden = source === 'adpcm-a';
    drumKeyboard.hidden = !keyboard.hidden;
    const showFm = section === 'fm' && !byId('fmPanel').closest('[hidden]');
    envelope.setVisible(showFm);
    if (source !== 'fm') stopAudition();
    if (showFm) refreshFmView(true);
    refreshAdpcmView();
    renderKeys();
    drawScope();
  },
});
editor.addEventListener('input', () => files.markCodeEdited());
liveToggle.addEventListener('change', () => refreshFmView(true));
captureButton.addEventListener('click', () => {
  if (!fmView?.paused || captureButton.disabled) return;
  try {
    const {snapshot, voice} = fmView;
    const preset = captureFm2610Patch(snapshot, voice);
    releaseKeyboard();
    fmChannel = null;
    liveToggle.checked = false;
    refreshFmView(true);
    applyFmPreset(preset);
    files.detachFmPatch();
    files.show(true);
    if (workspace.dataset.mode === 'synth') workspaceView.select('keyboardTab');
    announce('Captured ' + snapshot.variant.toUpperCase() + ' CH' + (voice.physicalChannel + 1) + ' to Synth.');
  } catch (error) { report(error); }
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
