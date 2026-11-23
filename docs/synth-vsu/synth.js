// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { buildKeyboard, createFretboardLayout, createFretboardState } from '../synth/synth_keyboard.js';
import { createSynthOutputVisualizer } from '../synth/synth_output_visualizer.js';
import { createVsuAudio } from './audio.js';
import { captureVsuVoice } from './capture.js';
import {
  CH5, CH5_MODULATION_MAX, CH5_MODULATION_MIN,
  decodeCh5Settings, createCh5DemoSettings, ch5ControlWrites, ch5ModulationWrites, ch5StepMs,
} from './ch5.js';
import { createVsuEnvelope, decodeVsuEnvelope, vsuEnvelopeRegisterValues } from './envelope.js';
import { setupEnvelopeMonitor } from './envelope-view.js';
import { setupVsuFiles } from './files.js';
import { setupAuthorMixer } from './mixer-view.js';
import { createDefaultVsuPatch, validateVsuPatch, VSU_PATCH_FORMAT } from './patch.js';
import { createVsuClient, createVsuWave, vsuChannelRegister, vsuNoteOnWrites, VSU_REGISTERS } from './vsu.js';
import { createVsuVoicePool } from './voice-pool.js';
import { loadVsuVgm } from './vgm.js';
import { setupVgmPlayer } from './vgm-player.js';

const byId = id => document.getElementById(id);
const status = byId('status'), code = byId('code'), codeOutput = byId('codeOutput');
const run = byId('run'), apply = byId('apply'), stop = byId('stop');
const keyboard = byId('keyboard'), playingNote = byId('playingNote');
const channelSelect = byId('channel'), channelWave = byId('channelWave');
const noiseTap = byId('noiseTap');
const editBank = byId('editBank'), sampleIndex = byId('sampleIndex'), sampleValue = byId('sampleValue');
const liveEnabled = byId('vsuLiveEnabled'), channelStatus = byId('vsuChannelStatus');
const liveRegisters = byId('vsuLiveRegisters');
const envelopeFields = {
  initial: ['EV0', 0xf0], rate: ['EV0', 0x07], direction: ['EV0', 0x08],
  enabled: ['EV1', 0x01], repeat: ['EV1', 0x02],
};
const outputCanvas = byId('outputCanvas'), waveCanvas = byId('waveCanvas');
const compare = byId('ch5Compare'), compareStop = byId('ch5CompareStop'), compareStatus = byId('ch5CompareStatus');
const ch5Controls = {
  mode: byId('ch5Mode'), clock: byId('ch5Clock'), rate: byId('ch5Rate'),
  direction: byId('ch5Direction'), shift: byId('ch5Shift'), repeat: byId('ch5Repeat'),
};
const visualizer = createSynthOutputVisualizer({
  background: '#18090f', grid: '#5c293b', labels: '#e9b3be', trace: '#ff6978',
});
const audio = createVsuAudio({
  onError(error) {
    reference.interrupt(error);
    stopComparison();
    releaseKeyboard();
    void stopCode();
    status.textContent = error.message;
  },
  onVgmState(update) {
    reference.onAudioState(update);
    if (update.id === referenceState.id) {
      vgmActivity = update.channels;
      drawChannelActivity();
    }
  },
  onLiveState: acceptLiveState,
});
const chip = createVsuClient(audio);
const factoryPatch = createDefaultVsuPatch();
const banks = factoryPatch.banks.map(wave => Uint8Array.from(wave));
const channels = factoryPatch.channels;
const noiseChannel = channels.length - 1;
const waveChannels = [...channels.keys()].slice(0, noiseChannel);
const voicePool = createVsuVoicePool();
let selectedNoiseTap = factoryPatch.noiseTap;
let ch5Settings = factoryPatch.ch5;
let autoChannel = 0, selectedChannel = null, authorBank = 0;
let codeRunning = false, referenceState = { state: 'empty', id: null }, editorReady = false;
let vgmActivity = [];
let liveTarget = null, liveVoice = null, lastLiveVoice = null, liveSettingsKey = '';
let comparison = null;
let soundContext = null, scopeMode = 'waveform', scopeFrame = null;
let codeHandoff = Promise.resolve(), keys = new Map();
const fretboard = createFretboardState();
const editingTarget = 'input, textarea, select, [contenteditable]';
const canWrite = () => soundContext !== null && soundContext === audio.context;

const starterCode = `const vsu = await useSoundChip("vsu");
vsu.setVolume(CH1, 12, 5);
vsu.setVolume(CH2, 5, 11);
setBpm(128);

liveLoop("stereo", async () => {
  for (const [low, high] of [["A3", "E5"], ["C4", "G5"], ["D4", "A5"], ["E4", "C6"]]) {
    vsu.noteOn(CH1, low);
    vsu.noteOn(CH2, high);
    await beat(0.75);
    vsu.noteOff(CH1);
    vsu.noteOff(CH2);
    await beat(0.25);
  }
});`;
code.value = starterCode;

function fitCanvas(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  context.setTransform(scale, 0, 0, scale, 0, 0);
  return { width, height, context };
}

function drawOutput() {
  if (scopeMode === 'envelope') {
    envelopeMonitor.draw();
    return;
  }
  const { width, height, context } = fitCanvas(outputCanvas);
  if (width > 60 && height > 40) visualizer.draw({ width, height }, context, scopeMode);
}

function scheduleScope() {
  if (scopeFrame !== null || scopeMode === 'envelope' ||
      audio.context?.state !== 'running' || document.hidden || !outputCanvas.getClientRects().length) return;
  scopeFrame = requestAnimationFrame(() => {
    scopeFrame = null;
    drawOutput();
    scheduleScope();
  });
}

function drawWaveRam() {
  const { width, height, context } = fitCanvas(waveCanvas);
  const samples = displayedWave();
  context.fillStyle = '#18090f';
  context.fillRect(0, 0, width, height);
  if (!samples?.length) return;
  const column = width / samples.length;
  context.strokeStyle = '#5c293b';
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  samples.forEach((sample, index) => {
    context.fillStyle = index === sampleIndex.valueAsNumber ? '#ffd0d2' : '#ff5264';
    const barHeight = 3 + (height - 6) * sample / 63;
    context.fillRect(index * column + 1, height - barHeight, column - 2, barHeight);
  });
}

function displayedWave() {
  return liveTarget ? liveVoice?.wave : banks[authorBank];
}

function showSample() {
  const wave = displayedWave(), index = sampleIndex.valueAsNumber;
  sampleValue.value = wave?.[index] ?? '';
  drawWaveRam();
}

function channelSettings(index = Number(channelSelect.value)) {
  const observing = Boolean(liveTarget);
  const voice = liveVoice;
  const editingLive = observing && Boolean(voice) && referenceState.state !== 'seeking';
  const settings = channels[index];
  const wave = observing ? voice?.waveBank ?? '' : settings.wave;
  const noise = index === noiseChannel;
  const effect = observing && voice?.modulation ? decodeCh5Settings(voice.ev1, voice.swp, voice.modulation) : ch5Settings;

  byId('vsuWavePanel').hidden = noise;
  byId('vsuVoiceTitle').textContent = noise ? 'Noise' : index === CH5 ? 'Wave + Sweep / Modulation' : 'Wave';
  byId('channelWaveGroup').hidden = noise;
  byId('noiseTapGroup').hidden = !noise;
  byId('ch5Panel').hidden = index !== CH5 || (observing && !voice);
  channelWave.value = noise ? '' : wave;
  noiseTap.value = observing ? (voice ? (voice.ev1 >> 4) & 7 : '') : selectedNoiseTap;
  editBank.value = observing ? wave ?? '' : authorBank;
  for (const side of ['left', 'right']) {
    const level = observing ? voice?.[side] : settings[side];
    byId(side + 'Level').value = level ?? 0;
    byId(side + 'Value').value = level ?? '—';
  }
  const envelope = observing ? voice ? decodeVsuEnvelope(voice.ev0, voice.ev1) : createVsuEnvelope() : settings.envelope;
  envelopeMonitor.setSettings(envelope);
  refreshCh5Controls(effect);
  for (const field of [channelWave, noiseTap, editBank, sampleValue, byId('waveShape'), byId('loadShape'),
    ...Object.values(ch5Controls), ...ch5ModInputs]) {
    field.disabled = observing;
  }
  for (const field of [byId('leftLevel'), byId('rightLevel'), byId('vsuEnvelopeControls')])
    field.disabled = observing && !editingLive;
  compare.disabled = observing || Boolean(comparison);
  liveEnabled.closest('label').hidden = !observing;
  sampleIndex.disabled = observing && !voice?.wave;
  waveCanvas.dataset.live = String(observing);
  byId('vsuWaveEditHint').hidden = observing;
  channelStatus.value = observing
    ? (liveTarget.source === 'vgm' ? 'VGM' : 'Code') + ' · CH' + (index + 1) +
      (voice ? liveEnabled.checked ? ' · Live' : ' · Frozen' : ' · Waiting for channel settings…')
    : selectedChannel === null ? autoChannelLabel() : 'Synth · CH' + (index + 1);
  syncWorkspaceControls();
  showSample();
}

function drawLiveRegisters(voice) {
  drawChannelActivity();
  liveRegisters.hidden = !voice;
  if (!voice) return;
  const hex = value => '0x' + value.toString(16).toUpperCase().padStart(3, '0');
  liveRegisters.value = (voice.active ? 'Active' : 'Idle') + ' · FQ ' + hex(voice.frequency) +
    (voice.workingFrequency === undefined ? '' : ' · Current ' + hex(voice.workingFrequency)) +
    (voice.currentEnvelope === undefined ? '' : ' · Envelope ' + voice.currentEnvelope);
}

function syncLiveTarget() {
  if (!editorReady) return false;
  const vgm = ['playing', 'paused', 'seeking'].includes(referenceState.state);
  const source = selectedChannel !== null && (vgm ? 'vgm' : codeRunning ? 'synth' : null);
  const key = source ? [source, selectedChannel, vgm ? referenceState.id : '', vgm ? referenceState.state : ''].join(':') : '';
  if ((liveTarget?.key ?? '') === key) return false;
  liveTarget = source ? { key, source, channel: selectedChannel, id: vgm ? referenceState.id : null } : null;
  liveVoice = lastLiveVoice = null;
  liveSettingsKey = '';
  audio.setLiveChannel(liveTarget?.channel ?? null);
  drawLiveRegisters(null);
  channelSettings();
  return true;
}

function showLiveVoice(voice) {
  liveVoice = voice;
  const key = JSON.stringify([voice.waveBank, voice.wave, voice.left, voice.right, voice.ev0, voice.ev1, voice.swp, voice.modulation]);
  if (key !== liveSettingsKey) {
    liveSettingsKey = key;
    channelSettings();
  }
  drawLiveRegisters(voice);
}

function acceptLiveState({ source, channel, voice, playbackId, edit }) {
  if (!liveTarget || source !== liveTarget.source || channel !== liveTarget.channel ||
      playbackId !== liveTarget.id || referenceState.state === 'seeking') return;
  lastLiveVoice = voice;
  if (liveEnabled.checked || !liveVoice) showLiveVoice(voice);
  else if (edit) showLiveVoice(mergeLiveRegister(liveVoice, edit.register, edit.mask, edit.value));
}

function mergeLiveRegister(voice, register, mask, value) {
  const next = { ...voice };
  if (register === 'LRV') {
    const byte = (((voice.left << 4) | voice.right) & ~mask) | (value & mask);
    next.left = byte >> 4;
    next.right = byte & 15;
  } else {
    const key = register.toLowerCase();
    next[key] = (voice[key] & ~mask) | (value & mask);
  }
  return next;
}

function updateLiveRegister(register, mask, value) {
  if (!liveVoice || !audio.writeLiveChannel({
    source: liveTarget.source, channel: liveTarget.channel, playbackId: liveTarget.id,
    register, mask, value,
  })) {
    channelSettings();
    return;
  }
  showLiveVoice(mergeLiveRegister(liveVoice, register, mask, value));
}

function authoredOutputs(instrument) {
  const active = voicePool.voices().filter(voice => voice.started);
  const outputs = active.filter(voice => voice.instrument === instrument).map(voice => voice.channel);
  if (!active.some(voice => voice.channel === instrument)) outputs.push(instrument);
  return outputs;
}

function sendChannelLevels(index) {
  if (!canWrite()) return;
  const { left, right } = channels[index];
  audio.writeBatch(authoredOutputs(index).map(channel => [
    vsuChannelRegister(channel, VSU_REGISTERS.LRV), (left << 4) | right,
  ]));
}

function envelopeWrites(index, settings = channels[index].envelope, effect = ch5Settings) {
  const { ev0, ev1 } = vsuEnvelopeRegisterValues(settings);
  const initial = [vsuChannelRegister(index, VSU_REGISTERS.EV0), ev0];
  if (index === CH5) return [initial, ...ch5ControlWrites(effect, ev1)];
  const tap = index === noiseChannel ? selectedNoiseTap << 4 : 0;
  return [initial, [vsuChannelRegister(index, VSU_REGISTERS.EV1), ev1 | tap]];
}

function keyboardEnvelopeWrites(channel, instrument) {
  const settings = channels[instrument].envelope;
  if (channel !== CH5 || instrument === CH5) return envelopeWrites(channel, settings);
  // A plain wave instrument can use CH5 with its extra effect disabled.
  const { ev0, ev1 } = vsuEnvelopeRegisterValues(settings);
  return [[vsuChannelRegister(channel, VSU_REGISTERS.EV0), ev0], [vsuChannelRegister(channel, VSU_REGISTERS.EV1), ev1]];
}

function applyEnvelopeEdit(envelope, field) {
  const [register, mask] = envelopeFields[field];
  if (liveTarget) {
    const value = vsuEnvelopeRegisterValues(envelope)[register.toLowerCase()];
    updateLiveRegister(register, mask, value & mask);
    return;
  }
  const index = Number(channelSelect.value);
  channels[index].envelope = envelope;
  const { running, stopping } = runtime.getState();
  if (!canWrite() || running || stopping) return;
  stopComparison();
  audio.writeBatch(authoredOutputs(index).map(channel => {
    const writes = keyboardEnvelopeWrites(channel, index);
    return register === 'EV0' ? writes[0] : writes.at(-1);
  }));
}

function writePatchToChip() {
  audio.reset();
  banks.forEach((wave, bank) => chip.setWave(bank, wave));
  channels.forEach(({ wave, left, right }, channel) => {
    chip.setVolume(channel, left, right);
    if (wave !== null) chip.setWaveBank(channel, wave);
  });
  audio.writeBatch([...ch5ModulationWrites(ch5Settings.modulation), ...channels.flatMap((_, index) => envelopeWrites(index))]);
}

async function ensureVsu() {
  await audio.ensureReady();
  if (!canWrite()) {
    writePatchToChip();
    visualizer.connect(audio.context, [audio.output]);
    audio.context.addEventListener('statechange', scheduleScope);
    soundContext = audio.context;
  }
  scheduleScope();
}

const runtime = createPlaygroundCodeRuntime({
  ensureReady: ensureVsu,
  now: () => audio.context?.currentTime ?? 0,
  supportedSoundChips: ['vsu'],
  useSoundChip: () => chip,
  readFile: (...args) => files.readFile(...args),
  prepareSource: (...args) => files.prepareSource(...args),
  onLog(line) { codeOutput.textContent = (codeOutput.textContent + line + '\n').slice(-12000); },
  onState(state) {
    status.textContent = state.status;
    run.disabled = state.busy;
    apply.disabled = !state.running || state.busy;
    stop.disabled = !state.running || state.stopping;
    if (codeRunning !== state.running) {
      codeRunning = state.running;
      syncLiveTarget();
    }
  },
  stopSoundChips() { if (canWrite()) writePatchToChip(); },
});

function stopCode() {
  codeHandoff = runtime.stop();
  return codeHandoff;
}

function waitForCodeStop() {
  return runtime.getState().running ? stopCode() : codeHandoff;
}

function getPatch() {
  return validateVsuPatch({
    format: VSU_PATCH_FORMAT, version: 1, banks: banks.map(wave => Array.from(wave)),
    channels, noiseTap: selectedNoiseTap, ch5: ch5Settings,
    preferredChannel: liveTarget ? autoChannel : selectedChannel ?? autoChannel,
  });
}

async function applyPatch(patch) {
  const next = validateVsuPatch(patch);
  stopComparison();
  releaseKeyboard();
  await waitForCodeStop();
  stopComparison();
  releaseKeyboard();
  next.banks.forEach((wave, bank) => banks[bank].set(wave));
  next.channels.forEach((settings, channel) => Object.assign(channels[channel], settings));
  channels.forEach((settings, channel) => authorMixer.drawLevels(channel, settings));
  selectedNoiseTap = next.noiseTap;
  ch5Settings = next.ch5;
  autoChannel = next.preferredChannel ?? autoChannel;
  authorBank = channels[autoChannel].wave ?? authorBank;
  selectChannel(null);
  if (canWrite()) writePatchToChip();
}

async function copyReferenceVoice(snapshot) {
  const result = captureVsuVoice(getPatch(), snapshot);
  await applyPatch({ ...result.patch, preferredChannel: result.channel });
  selectChipPanel(false);
  setWorkspaceMode(false);
}

const ch5Gate = vsuChannelRegister(CH5, VSU_REGISTERS.INT);
const ch5ModInputs = [];

function startCh5Note(note, settings, envelope = channels[CH5].envelope) {
  const writes = [[ch5Gate, 0]];
  if (settings.mode === 'modulation') writes.push(...ch5ModulationWrites(settings.modulation));
  // Off, Sweep and Modulation all restart at the same base note.
  writes.push(...envelopeWrites(CH5, envelope, settings), ...vsuNoteOnWrites(CH5, note));
  audio.writeBatch(writes);
}

function selectedCh5ControlWrites() {
  const { ev1 } = vsuEnvelopeRegisterValues(channels[CH5].envelope);
  return ch5ControlWrites(ch5Settings, ev1);
}

function refreshCh5Controls(settings = ch5Settings) {
  for (const [key, input] of Object.entries(ch5Controls)) {
    if (key === 'repeat') input.checked = settings[key];
    else input.value = settings[key];
  }
  byId('ch5Timing').hidden = settings.mode === 'off';
  byId('ch5Sweep').hidden = settings.mode !== 'sweep';
  byId('ch5Modulation').hidden = settings.mode !== 'modulation';
  const interval = ch5StepMs(settings);
  byId('ch5Step').value = interval ? `${interval.toFixed(2)} ms / step` : 'Off';
  ch5ModInputs.forEach((input, index) => { input.value = settings.modulation[index]; });
}

function updateCh5Audio({ restart = false, table = false } = {}) {
  stopComparison();
  const { running, stopping } = runtime.getState();
  if (!canWrite() || running || stopping) return;
  const note = voicePool.voiceOn(CH5);
  if (note?.started) {
    if (note.instrument !== CH5) return;
    if (restart || table) startCh5Note(note.note, ch5Settings);
    else audio.writeBatch(selectedCh5ControlWrites());
    return;
  }
  // The modulation RAM remains writable whenever CH5 is stopped.
  const writes = table ? ch5ModulationWrites(ch5Settings.modulation) : [];
  audio.writeBatch([...writes, ...selectedCh5ControlWrites()]);
}

function setupCh5Controls() {
  for (const [key, input] of Object.entries(ch5Controls)) input.addEventListener('change', () => {
    if (liveTarget) return;
    const previous = ch5Settings[key];
    ch5Settings[key] = key === 'repeat' ? input.checked
      : key === 'rate' || key === 'shift' ? Number(input.value) : input.value;
    // Changing mode or switching the interval off/on begins again at base pitch.
    const rateToggled = key === 'rate' && (previous === 0 || ch5Settings.rate === 0);
    updateCh5Audio({ restart: key === 'mode' || rateToggled });
    channelSettings();
  });

  const grid = byId('ch5ModGrid');
  for (const [index, value] of ch5Settings.modulation.entries()) {
    const label = document.createElement('label'), input = document.createElement('input');
    label.textContent = String(index).padStart(2, '0');
    input.type = 'number';
    input.min = CH5_MODULATION_MIN;
    input.max = CH5_MODULATION_MAX;
    input.step = 1;
    input.value = value;
    input.setAttribute('aria-label', 'Modulation step ' + index);
    input.addEventListener('change', () => {
      if (liveTarget) return;
      const sample = input.valueAsNumber;
      if (!Number.isInteger(sample) || !input.validity.valid) {
        input.value = ch5Settings.modulation[index];
        return;
      }
      if (sample !== ch5Settings.modulation[index]) {
        ch5Settings.modulation[index] = sample;
        updateCh5Audio({ table: true });
      }
    });
    label.append(input);
    grid.append(label);
    ch5ModInputs.push(input);
  }
  refreshCh5Controls();
}

const comparisonNote = 'A4';
const comparisonStages = [['off', 'Normal'], ['sweep', 'Sweep'], ['modulation', 'Modulation']];

function comparisonWait(ms, signal) {
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function stopComparison(message = 'Comparison stopped.') {
  if (!comparison) return;
  const active = comparison;
  comparison = null;
  active.controller.abort();
  if (active.started && canWrite()) {
    // Leave the instrument settings available to a following Code run as well
    // as to Keyboard. CH5 must be stopped before restoring its RAM.
    audio.writeBatch([[ch5Gate, 0], ...ch5ModulationWrites(ch5Settings.modulation), ...envelopeWrites(CH5)]);
  }
  compare.disabled = false;
  compareStop.disabled = true;
  compareStatus.value = message;
}

async function playComparison() {
  if (comparison) return;
  reference.interrupt();
  releaseKeyboard();
  const active = { controller: new AbortController(), started: false };
  comparison = active;
  compare.disabled = true;
  compareStop.disabled = false;
  compareStatus.value = 'Preparing comparison…';
  try {
    await waitForCodeStop();
    if (comparison !== active) return;
    await ensureVsu();
    if (comparison !== active) return;
    const { wave, left, right } = channels[CH5];
    chip.setWaveBank(CH5, wave);
    chip.setVolume(CH5, left, right);
    const comparisonEnvelope = createVsuEnvelope();
    for (const [mode, name] of comparisonStages) {
      startCh5Note(comparisonNote, createCh5DemoSettings(mode), comparisonEnvelope);
      active.started = true;
      compareStatus.value = name + ' · ' + comparisonNote;
      await comparisonWait(700, active.controller.signal);
      if (comparison !== active) return;
      chip.noteOff(CH5);
      await comparisonWait(180, active.controller.signal);
      if (comparison !== active) return;
    }
    stopComparison('Comparison complete.');
  } catch (error) {
    if (comparison === active) stopComparison(error.message);
  }
}

compare.addEventListener('click', () => void playComparison());
compareStop.addEventListener('click', () => stopComparison());

function keyboardChannels(instrument = selectedChannel ?? autoChannel) {
  if (selectedChannel !== null || instrument === noiseChannel ||
      (instrument === CH5 && ch5Settings.mode !== 'off' && ch5Settings.rate > 0)) return [instrument];
  return waveChannels;
}

function autoChannelLabel() {
  const pool = keyboardChannels(autoChannel);
  if (pool.length > 1) return 'AUTO · Wave · ' + pool.length + ' voices round robin';
  const voice = autoChannel === noiseChannel ? 'Noise' : ch5Settings.mode === 'sweep' ? 'Sweep' : 'Modulation';
  return 'AUTO · ' + voice + ' · CH' + (autoChannel + 1);
}

function keyboardVoiceRegisters(channel, instrument) {
  const { wave, left, right } = channels[instrument];
  const writes = [[vsuChannelRegister(channel, VSU_REGISTERS.LRV), (left << 4) | right]];
  if (wave !== null) writes.push([vsuChannelRegister(channel, VSU_REGISTERS.RAM), wave]);
  return [...writes, ...keyboardEnvelopeWrites(channel, instrument)];
}

function stopKeyboardVoice(voice) {
  if (!voice.started || !canWrite()) return;
  const { channel, instrument } = voice;
  const writes = [[vsuChannelRegister(channel, VSU_REGISTERS.INT), 0]];
  if (channel !== instrument) writes.push(...keyboardVoiceRegisters(channel, channel));
  audio.writeBatch(writes);
}

function syncKeyboardVoices() {
  const voices = voicePool.voices();
  const buttons = new Set(voices.map(voice => voice.button));
  for (const button of keyboard.querySelectorAll('.key')) {
    const pressed = buttons.has(button);
    button.classList.toggle('is-held', pressed);
    button.setAttribute('aria-pressed', String(pressed));
  }
  playingNote.value = voices.filter(voice => voice.started).map(voice => voice.noteName).join(' + ');
  drawChannelActivity();
}

function releaseKeyboard() {
  const voices = voicePool.clear();
  if (!voices.length) return;
  voices.forEach(stopKeyboardVoice);
  syncKeyboardVoices();
}

async function playKeyboard(owner, entry, button) {
  const instrument = selectedChannel ?? autoChannel;
  const allocation = voicePool.acquire(keyboardChannels(instrument), {
    owner, button, instrument, note: entry.midi, noteName: entry.noteName,
  });
  if (!allocation) return;
  reference.interrupt();
  stopComparison();
  const { voice, displaced } = allocation;
  if (displaced) stopKeyboardVoice(displaced);
  syncKeyboardVoices();
  try {
    await waitForCodeStop();
    await ensureVsu();
    if (!voicePool.isCurrent(voice)) return;
    const { channel } = voice;
    const writes = [[vsuChannelRegister(channel, VSU_REGISTERS.INT), 0], ...keyboardVoiceRegisters(channel, instrument)];
    if (channel === CH5 && instrument === CH5 && ch5Settings.mode === 'modulation')
      writes.push(...ch5ModulationWrites(ch5Settings.modulation));
    audio.writeBatch([...writes, ...vsuNoteOnWrites(channel, voice.note)]);
    voice.started = true;
    syncKeyboardVoices();
    status.textContent = 'Ready';
  } catch (error) {
    if (voicePool.releaseVoice(voice)) syncKeyboardVoices();
    status.textContent = error.message;
  }
}

function releaseKey(owner) {
  const voice = voicePool.release(owner);
  if (!voice) return;
  stopKeyboardVoice(voice);
  syncKeyboardVoices();
}

function redrawKeyboard() {
  releaseKeyboard();
  const { rowDefs, entries } = createFretboardLayout({ state: fretboard, octave: Number(byId('octave').value) });
  buildKeyboard({
    root: keyboard, rowDefs, layoutEntries: entries, showPitch: false,
    onPointerDown(event, entry, button) {
      if (event.button === 0) return playKeyboard('pointer:' + event.pointerId, entry, button);
    },
    onPointerUp: event => releaseKey('pointer:' + event.pointerId),
    onPointerCancel: event => releaseKey('pointer:' + event.pointerId),
  });
  keys = new Map(entries.map(entry => [entry.key, entry]));
  for (const button of keyboard.querySelectorAll('.key')) {
    const entry = keys.get(button.dataset.key);
    button.setAttribute('aria-label', entry.label + ' · ' + entry.noteName);
    button.setAttribute('aria-pressed', 'false');
    function isActivate(event) { return event.key === 'Enter' || event.key === ' '; }
    const owner = 'button:' + entry.key;
    button.addEventListener('keydown', event => {
      if (!isActivate(event)) return;
      event.preventDefault();
      if (!event.repeat) void playKeyboard(owner, entry, button);
    });
    button.addEventListener('keyup', event => {
      if (!isActivate(event)) return;
      event.preventDefault();
      releaseKey(owner);
    });
    button.addEventListener('blur', () => releaseKey(owner));
  }
}

function writeEditedBank() {
  if (liveTarget) return;
  stopComparison();
  if (!canWrite()) return;
  releaseKeyboard();
  chip.allNotesOff();
  chip.setWave(authorBank, banks[authorBank]);
}

function setSample(index, value) {
  if (liveTarget || !Number.isInteger(index) || index < 0 || index > 31 || !Number.isInteger(value) || value < 0 || value > 63) return false;
  banks[authorBank][index] = value;
  if (sampleIndex.valueAsNumber !== index) sampleIndex.value = index;
  if (sampleValue.valueAsNumber !== value) sampleValue.value = value;
  drawWaveRam();
  return true;
}

let drawPointer = null;
function drawAtPointer(event) {
  const rect = waveCanvas.getBoundingClientRect();
  const index = Math.min(31, Math.max(0, Math.floor((event.clientX - rect.left) * 32 / rect.width)));
  const value = Math.min(63, Math.max(0, Math.round((rect.bottom - event.clientY) * 63 / rect.height)));
  setSample(index, value);
}
waveCanvas.addEventListener('pointerdown', event => {
  if (liveTarget || event.button !== 0 || drawPointer !== null) return;
  drawPointer = event.pointerId;
  waveCanvas.setPointerCapture(event.pointerId);
  drawAtPointer(event);
});
waveCanvas.addEventListener('pointermove', event => {
  if (drawPointer === event.pointerId) drawAtPointer(event);
});
waveCanvas.addEventListener('lostpointercapture', event => {
  if (drawPointer !== event.pointerId) return;
  drawPointer = null;
  writeEditedBank();
});
editBank.addEventListener('change', () => {
  if (liveTarget) return;
  authorBank = Number(editBank.value);
  showSample();
});
sampleIndex.addEventListener('change', showSample);
sampleValue.addEventListener('change', () => {
  if (setSample(sampleIndex.valueAsNumber, sampleValue.valueAsNumber)) writeEditedBank();
});
byId('loadShape').addEventListener('click', () => {
  if (liveTarget) return;
  banks[authorBank] = createVsuWave(byId('waveShape').value);
  showSample();
  writeEditedBank();
});

for (const [index, settings] of channels.entries()) {
  const option = document.createElement('option');
  option.value = index;
  const mode = settings.wave === null ? 'Noise' : index === CH5 ? 'Wave / Sweep / Modulation' : 'Wave';
  option.textContent = 'CH' + (index + 1) + ' · ' + mode;
  channelSelect.append(option);
}
const channelChoices = [null, ...channels.keys()];
const channelTabs = channelChoices.map((index, position) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.channel = index ?? 'auto';
  button.textContent = index === null ? 'AUTO' : 'CH' + (index + 1);
  if (index !== null) button.title = channelSelect.options[index].textContent;
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-controls', 'vsuSynthControls');
  button.addEventListener('click', () => selectChannel(index));
  button.addEventListener('keydown', event => {
    const count = channelChoices.length;
    const next = { Home: 0, End: count - 1, ArrowLeft: (position + count - 1) % count, ArrowRight: (position + 1) % count }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectChannel(channelChoices[next]);
    channelTabs[next].focus();
  });
  byId('vsuChannelTabs').append(button);
  return button;
});
function updateChannelTabs() {
  channelTabs.forEach((button, position) => {
    const active = channelChoices[position] === selectedChannel;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function drawChannelActivity() {
  if (!editorReady) return;
  const vgm = ['playing', 'paused'].includes(referenceState.state);
  for (const [index, button] of channelTabs.slice(1).entries()) {
    const active = vgm ? vgmActivity[index]?.active : codeRunning
      ? liveTarget?.channel === index && liveVoice?.active : voicePool.voiceOn(index)?.started;
    const value = String(Boolean(active));
    if (button.dataset.active !== value) button.dataset.active = value;
  }
}

function selectChannel(index) {
  stopComparison();
  releaseKeyboard();
  selectedChannel = index;
  const physical = index ?? autoChannel;
  channelSelect.value = physical;
  updateChannelTabs();
  reference.setChannel(index);
  const refreshed = syncLiveTarget();
  if (!liveTarget) {
    authorBank = channels[physical].wave ?? authorBank;
    channelSettings(physical);
  } else if (!refreshed) channelSettings(physical);
}

liveEnabled.addEventListener('change', () => {
  if (liveEnabled.checked && lastLiveVoice) showLiveVoice(lastLiveVoice);
  channelSettings();
});

for (let tap = 0; tap < 8; tap += 1) noiseTap.add(new Option(String(tap), String(tap)));
noiseTap.addEventListener('change', () => {
  if (liveTarget) return;
  selectedNoiseTap = Number(noiseTap.value);
  if (canWrite()) {
    const [address, value] = envelopeWrites(noiseChannel).at(-1);
    chip.write(address, value);
  }
});
channelSelect.addEventListener('change', () => selectChannel(Number(channelSelect.value)));
channelWave.addEventListener('change', () => {
  if (liveTarget) return;
  stopComparison();
  const index = Number(channelSelect.value), wave = Number(channelWave.value);
  channels[index].wave = wave;
  if (canWrite()) audio.writeBatch(authoredOutputs(index).map(channel => [
    vsuChannelRegister(channel, VSU_REGISTERS.RAM), wave,
  ]));
});
for (const side of ['left', 'right']) {
  const control = byId(side + 'Level');
  control.addEventListener('input', () => {
    const value = control.valueAsNumber;
    if (liveTarget) {
      if (side === 'left') updateLiveRegister('LRV', 0xf0, value << 4);
      else updateLiveRegister('LRV', 0x0f, value);
    } else setChannelLevel(Number(channelSelect.value), side, value);
  });
}
function setChannelLevel(index, side, value) {
  if (index === CH5) stopComparison();
  channels[index][side] = value;
  if (!liveTarget && Number(channelSelect.value) === index) byId(side + 'Level').value = byId(side + 'Value').value = value;
  authorMixer.drawLevels(index, channels[index]);
  sendChannelLevels(index);
}
byId('master').addEventListener('input', event => {
  const volume = event.currentTarget.valueAsNumber;
  byId('masterValue').value = volume + '%';
  audio.setVolume(volume / 100);
});

function showMode(buttons, id) {
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.id === id));
}
const envelopeCanvas = byId('envelopeCanvas');
const envelopeMonitor = setupEnvelopeMonitor(envelopeCanvas, fitCanvas, applyEnvelopeEdit);
const authorMixer = setupAuthorMixer(byId('vsuAuthorChannels'), setChannelLevel);
const scopeModes = { showEnvelope: 'envelope', showWaveform: 'waveform', showSpectrum: 'spectrum' };
const scopes = Object.keys(scopeModes).map(byId);
for (const button of scopes) button.addEventListener('click', () => {
  showMode(scopes, button.id);
  scopeMode = scopeModes[button.id];
  outputCanvas.hidden = scopeMode === 'envelope';
  envelopeCanvas.hidden = !outputCanvas.hidden;
  outputCanvas.setAttribute('aria-label', 'Output ' + scopeMode);
  drawOutput();
  scheduleScope();
});
const inputs = [byId('showKeyboard'), byId('showCode')];
function showInput(showCode) {
  showMode(inputs, inputs[showCode ? 1 : 0].id);
  byId('codePanel').hidden = !showCode;
  byId('keyboardPanel').hidden = showCode;
  if (showCode) releaseKeyboard();
}
inputs[0].addEventListener('click', () => showInput(false));
inputs[1].addEventListener('click', () => showInput(true));

const chipTabs = [byId('vsuChipTab'), byId('vsuMixerTab')];
function selectChipPanel(showMixer) {
  for (const [index, button] of chipTabs.entries()) {
    const active = index === Number(showMixer);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    byId(button.getAttribute('aria-controls')).hidden = !active;
  }
  drawOutput();
  scheduleScope();
}
for (const [index, button] of chipTabs.entries()) {
  button.addEventListener('click', () => selectChipPanel(index === 1));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
    selectChipPanel(next === 1);
    chipTabs[next].focus();
  });
}

const workspaceModes = [byId('workspaceSynth'), byId('workspaceCode')];
function syncWorkspaceControls() {
  const expanded = workspaceModes[1].getAttribute('aria-pressed') === 'true';
  byId('vsuSynthControls').hidden = expanded && !liveTarget;
}
function setWorkspaceMode(showCode) {
  showMode(workspaceModes, workspaceModes[Number(showCode)].id);
  syncWorkspaceControls();
  showInput(showCode);
  drawOutput();
  scheduleScope();
}
workspaceModes[0].addEventListener('click', () => setWorkspaceMode(false));
workspaceModes[1].addEventListener('click', () => setWorkspaceMode(true));

const reference = setupVgmPlayer({
  root: byId('vgmReference'), audio,
  async preparePlayback() {
    stopComparison();
    releaseKeyboard();
    await waitForCodeStop();
    await ensureVsu();
  },
  importSongs: () => files.requestVgmImport(),
  openSong: path => files.openVgm(path),
  copyVoice: copyReferenceVoice,
  onPlaybackChange(next) {
    referenceState = next;
    if (next.state !== 'playing' && next.state !== 'paused') vgmActivity = [];
    syncLiveTarget();
    drawChannelActivity();
  },
});
const files = setupVsuFiles({
  panel: byId('filesPanel'), toggle: byId('filesToggle'), starterCode,
  getPatch, applyPatch, validatePatch: validateVsuPatch,
  getCode: () => code.value,
  async openVgm(bytes, path, { show, plan } = {}) {
    reference.setSong(path, path ? plan ?? await loadVsuVgm(bytes) : null, { show });
  },
  onVgmFilesChanged: reference.setFiles,
  onVgmError: reference.showError,
  onVgmAvailability: reference.setAvailability,
  async setCode(source, _path, { show = false, stop: stopPlayback = show } = {}) {
    if (stopPlayback) await waitForCodeStop();
    code.value = source;
    if (show) showInput(true);
  },
  setStatus(message) { status.textContent = message; },
});
code.addEventListener('input', () => files.markCodeEdited());

async function execute(isApply) {
  reference.interrupt();
  stopComparison();
  releaseKeyboard();
  if (!isApply) codeOutput.textContent = '';
  try {
    await files.ready;
    const options = { path: files.codePath };
    await (isApply ? runtime.apply(code.value, options) : runtime.run(code.value, options));
  } catch (error) {
    if (error.name !== 'AbortError' && runtime.getState().state !== 'error') status.textContent = error.message;
  }
}
run.addEventListener('click', () => void execute(false));
apply.addEventListener('click', () => void execute(true));
stop.addEventListener('click', () => void stopCode());

byId('octave').addEventListener('change', redrawKeyboard);
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey ||
      byId('keyboardPanel').hidden || event.target.closest(editingTarget)) return;
  const entry = keys.get(event.key.toLowerCase());
  if (!entry) return;
  event.preventDefault();
  if (!event.repeat) void playKeyboard('key:' + event.code, entry, keyboard.querySelector('[data-key="' + entry.key + '"]'));
});
window.addEventListener('keyup', event => releaseKey('key:' + event.code));
window.addEventListener('blur', releaseKeyboard);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopComparison();
    releaseKeyboard();
  } else scheduleScope();
});
new ResizeObserver(drawOutput).observe(outputCanvas);
new ResizeObserver(drawWaveRam).observe(waveCanvas);

setupCh5Controls();
editorReady = true;
selectChannel(null);
channels.forEach((settings, channel) => authorMixer.drawLevels(channel, settings));
redrawKeyboard();
drawOutput();
