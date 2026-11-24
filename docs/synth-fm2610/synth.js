// SPDX-License-Identifier: BSD-3-Clause
import { FM_PRESETS, readFmPreset } from '../synth-fm2608/preset.js';
import { buildHeader, buildOperatorControls, createParamControl } from '../synth/synth_controls.js';
import {
  buildKeyboard, createFretboardLayout, createFretboardState, renderFretboardControls,
  setFretPosition, setInstrument, setStringWindowIndex,
} from '../synth/synth_keyboard.js';
import { createOperatorEnvelopeView } from '../synth/synth_operator_envelope.js';
import { createSynthOutputVisualizer } from '../synth/synth_output_visualizer.js';
import { createVsuVoicePool } from '../synth-vsu/voice-pool.js';
import { createFm2610Audio } from './audio.js';
import { setupFm2610Code } from './code.js';
import { setupFm2610Files } from './files.js';
import { setupFm2610Sections } from './sections.js';
import { setupFm2610SongControls } from './song_controls.js';

const byId = id => document.getElementById(id);
const modeButtons = [...byId('chipModes').querySelectorAll('button')];
const status = byId('status');
const keyboard = byId('keyboard');
const scope = byId('scope');
const audio = createFm2610Audio();
const visualizer = createSynthOutputVisualizer({
  background: '#18150f', grid: '#4b3b26', labels: '#bfaf91', trace: '#ffcc78',
});
const voicePools = { fm: createVsuVoicePool(), ssg: createVsuVoicePool() };
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
const lfo = { enabled: false, frequency: 0 };
const gateMethods = new Set(['keyOn', 'keyOff', 'noteOn', 'noteOnRaw', 'noteOff']);
const ssgGateMethods = new Set([...gateMethods, 'tone', 'noise', 'off']);
const codeEndpoints = new WeakMap();
const textEntry = 'input:not([type="range"], [type="checkbox"], [type="radio"]), textarea, select, [contenteditable]';
let variant = 'ym2610b', switching = false, chip = null, source = 'fm';
let fmChannel = null, ssgChannel = null, octave = 0, keys = new Map();
let scopeMode = 'waveform', scopeFrame = null;
const envelope = createOperatorEnvelopeView({
  root: byId('fmEnvelope'),
  getOperators: () => [null, ...presetFor(fmChannel ?? 0).operators],
  getSelectionKey: () => variant + ':' + fmChannel,
  onEdit: editOperator,
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
    monitorOutput();
  });
}

function presetFor(channel) { return channels[physicalSlots[variant][channel]]; }
function fmTargets() {
  return fmChannel === null ? physicalSlots[variant].map((_, channel) => channel) : [fmChannel];
}

function applyFmSettings(fm) {
  physicalSlots[variant].forEach((_, channel) => fm.setPreset(channel, presetFor(channel)));
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
  sections.stopAdpcm();
  endpoint.adpcmA.keyOff([0, 1, 2, 3, 4, 5]);
  endpoint.adpcmB.keyOff();
  applyFmSettings(endpoint.fm);
}

const sections = setupFm2610Sections({
  ssgPanel: byId('ssgPanel'), adpcmAPanel: byId('adpcmAPanel'), adpcmBPanel: byId('adpcmBPanel'), sound, report,
});
const code = setupFm2610Code({
  textarea: byId('code'), runButton: byId('runCode'), stopButton: byId('stopCode'),
  status: byId('codeStatus'), output: byId('codeOutput'), sound: codeSound,
  getMode: () => variant, stopSound: stopCodeSound,
  beforeRun: () => songs.stop(),
  prepareSource: (...args) => files.prepareSource(...args),
  readFile: (...args) => files.readFile(...args),
  getEntryPath: () => files.getEntryPath(),
});
const songs = setupFm2610SongControls({
  getFiles: () => files,
  sound,
  beforePlay: () => code.stop(),
  announce,
  report,
});

function renderFm() {
  const preset = presetFor(fmChannel ?? 0);
  for (const [key, control] of commonControls) control.updateVisual(preset[key] ?? preset.pan[key]);
  for (const [operator, controls] of operatorControls) {
    for (const [key, control] of controls) control.updateVisual(preset.operators[operator - 1][key]);
  }
  for (const [operator, button] of operatorGates) {
    button.setAttribute('aria-pressed', String(Boolean(preset.keyMask & (1 << (operator - 1)))));
  }
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
  editPreset(target => Object.assign(target, readFmPreset(preset)), (fm, channel, next) => {
    fm.setPreset(channel, next);
    updateHeldMask(fm, channel, next);
  });
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
    common.append(createParamControl({ label, min: 0, max, step: 1, value: lfo[key], wheelAdjust: false,
      booleanMode: key === 'enabled', onChange(value) {
        lfo[key] = value;
        chip?.fm.setLfo(lfo.enabled, lfo.frequency);
      } }).element);
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
  renderChannels(byId('fmChannels'), physicalSlots[variant].map(slot => 'CH' + (slot + 1)), fmChannel, channel => {
    fmChannel = channel;
    renderFm();
  });
}

function stopVoice(section, voice) {
  if (!voice) return;
  if (section === 'ssg') sections.noteOffSSG(voice.channel);
  else if (voice.started) chip?.fm.noteOff(voice.channel);
}

function renderKeys() {
  const voices = [...voicePools.fm.voices(), ...voicePools.ssg.voices()];
  const down = new Set(voices.map(voice => voice.entry.key));
  for (const button of keyboard.querySelectorAll('.key')) button.setAttribute('aria-pressed', String(down.has(button.dataset.key)));
  byId('keyboardStatus').textContent = !voicePools[source]
    ? 'Use the sample controls above.'
    : voices.filter(voice => voice.started).map(voice => voice.entry.noteName).join(' · ') ||
      (source === 'fm' ? 'Play the FM channels with the keys below.' : 'Play the SSG voices with the keys below.');
}

function releaseKey(owner) {
  for (const [section, pool] of Object.entries(voicePools)) stopVoice(section, pool.release(owner));
  renderKeys();
}

function releaseKeyboard() {
  for (const [section, pool] of Object.entries(voicePools)) {
    for (const voice of pool.clear()) stopVoice(section, voice);
  }
  renderKeys();
}

async function playKey(owner, entry) {
  const section = source, pool = voicePools[section];
  if (!pool || switching || Object.values(voicePools).some(voices => voices.voices().some(voice => voice.owner === owner))) return;
  const choices = section === 'fm' ? fmTargets() : ssgChannel === null ? [0, 1, 2] : [ssgChannel];
  const { voice, displaced } = pool.acquire(choices, { owner, entry });
  stopVoice(section, displaced);
  renderKeys();
  try {
    const ready = await sound();
    if (!pool.isCurrent(voice)) return;
    if (section === 'fm') {
      ready.fm.setNote(voice.channel, entry.midi);
      writeKeyMask(ready.fm, voice.channel, presetFor(voice.channel).keyMask);
    } else {
      await sections.noteOnSSG(voice.channel, entry.midi);
    }
    if (pool.isCurrent(voice)) voice.started = true;
  } catch (error) {
    stopVoice(section, pool.releaseVoice(voice));
    report(error);
  }
  renderKeys();
}

function redrawKeyboard() {
  releaseKeyboard();
  const { rowDefs, entries } = createFretboardLayout({ state: fretboard, octave, clock: 8000000 });
  keys = new Map(entries.map(entry => [entry.key, entry]));
  buildKeyboard({ root: keyboard, rowDefs, layoutEntries: entries, showPitch: false,
    onPointerDown(event, entry) { if (event.button === 0) void playKey('pointer:' + event.pointerId, entry); },
    onPointerUp(event) { releaseKey('pointer:' + event.pointerId); },
    onPointerCancel(event) { releaseKey('pointer:' + event.pointerId); },
  });
  for (const button of keyboard.querySelectorAll('.key')) {
    const owner = 'button:' + button.dataset.key;
    button.addEventListener('keydown', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (!event.repeat) void playKey(owner, keys.get(button.dataset.key));
    });
    button.addEventListener('keyup', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      releaseKey(owner);
    });
    button.addEventListener('blur', () => releaseKey(owner));
  }
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

function setupTabs(id, onSelect = () => {}) {
  const tabs = [...byId(id).querySelectorAll('[role="tab"]')];
  function select(selected) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      byId(tab.getAttribute('aria-controls')).hidden = !active;
    }
    onSelect(selected);
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const last = tabs.length - 1;
      const next = { ArrowLeft: (index + last) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: last }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(tabs[next]);
      tabs[next].focus();
    });
  }
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
    renderFmChannels();
    renderFm();
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
  const entry = keys.get(event.key.toLowerCase());
  if (!entry || !voicePools[source]) return;
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
  sections.stop();
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
const scopeButtons = [...byId('scopeModes').querySelectorAll('button')];
for (const button of scopeButtons) button.addEventListener('click', () => {
  scopeMode = button.dataset.scope;
  scopeButtons.forEach(control => control.setAttribute('aria-pressed', String(control === button)));
  scope.setAttribute('aria-label', 'Output ' + scopeMode);
  drawScope();
});
new ResizeObserver(drawScope).observe(scope);

setupTabs('sourceTabs', tab => {
  source = tab.dataset.source;
  envelope.setVisible(source === 'fm');
  renderKeys();
});
setupTabs('performanceTabs');
envelope.setVisible(true);
window.addEventListener('pagehide', event => { if (!event.persisted) envelope.dispose(); });
const ssgChannels = document.createElement('div');
ssgChannels.className = 'inline-controls ssg-channels';
ssgChannels.setAttribute('role', 'group');
ssgChannels.setAttribute('aria-label', 'SSG keyboard channel');
byId('ssgPanel').querySelector('.section-heading').after(ssgChannels);
renderChannels(ssgChannels, ['CH1', 'CH2', 'CH3'], null, channel => { ssgChannel = channel; });
buildFmControls();
renderFmChannels();
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
  getPatch: () => presetFor(fmChannel ?? 0),
  applyPatch(preset) {
    applyFmPreset(preset);
    byId('fmTab').click();
    byId('keyboardTab').click();
  },
  getCode: () => editor.value,
  async setCode(source, path, {show}) {
    if (show) await code.stop();
    editor.value = source;
    if (show) byId('codeTab').click();
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
editor.addEventListener('input', () => files.markCodeEdited());
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
