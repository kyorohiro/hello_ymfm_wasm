// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import {
  buildKeyboard, createFretboardLayout, createFretboardState, renderFretboardControls,
  setFretPosition, setInstrument, setStringWindowIndex,
} from '../synth/synth_keyboard.js';
import { createSynthOutputVisualizer } from '../synth/synth_output_visualizer.js';
import { createVsuAudio } from './audio.js?v=vsu-live-wave';
import { VSU_AUTO_SOURCES, vsuAutoChannel, vsuAutoSourceForChannel, vsuAutoVoiceChannels } from './auto-source.js';
import { captureVsuVoice } from './capture.js?v=vsu-noise';
import {
  CH5, CH5_MODULATION_MAX, CH5_MODULATION_MIN,
  decodeCh5Settings, createCh5DemoSettings, ch5ControlWrites, ch5ModulationWrites, ch5StepMs,
} from './ch5.js';
import { createVsuEnvelope, decodeVsuEnvelope, vsuEnvelopeRegisterValues } from './envelope.js';
import { setupEnvelopeMonitor } from './envelope-view.js?v=vsu-wave-controls';
import { setupVsuFiles } from './files.js?v=vsu-timed';
import { setupOutputMixer } from './mixer-view.js?v=vsu-mixer';
import { createDefaultVsuPatch, createLegacyVsuNoiseSettings, validateVsuPatch, VSU_PATCH_FORMAT } from './patch.js?v=vsu-noise';
import { attachVsuTimedClient } from './timed-client.js';
import {
  createVsuClient, createVsuWave, vsuChannelRegister, vsuFrequencyRegister, vsuFrequencyWrites,
  vsuNoiseShiftRate, vsuNoteOnWrites, vsuStartWrites, vsuWaveOffset, VSU_INTERVAL_STEP_MS, VSU_NOISE_PATTERN_LENGTHS, VSU_REGISTERS,
} from './vsu.js?v=vsu-noise';
import { createVsuVoicePool } from './voice-pool.js';
import { loadVsuVgm } from './vgm.js';
import { setupVgmPlayer } from './vgm-player.js';

const byId = id => document.getElementById(id);
const status = byId('status'), code = byId('code'), codeOutput = byId('codeOutput');
const codePanel = byId('codePanel'), codeTransport = byId('codeTransport'), performancePanel = byId('performance');
const run = byId('run'), apply = byId('apply'), stop = byId('stop');
const keyboard = byId('keyboard'), playingNote = byId('playingNote');
const channelSelect = byId('channel'), channelWave = byId('channelWave'), waveShape = byId('waveShape');
const waveEditHint = byId('vsuWaveEditHint'), waveWriteStatus = byId('vsuWaveWriteStatus');
const noiseTap = byId('noiseTap'), noiseTapValue = byId('noiseTapValue');
const noiseFrequency = byId('noiseFrequency'), noiseRateValue = byId('noiseRateValue');
const noiseInterval = byId('noiseInterval'), noiseIntervalValue = byId('noiseIntervalValue');
const noiseKeyTracking = byId('noiseKeyTracking'), noisePattern = byId('noisePattern');
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
  onCodeWaveState: acceptCodeWaveState,
  onTimedError({ message }) { if (codeRunning) appendCodeLog('[VSU schedule] ' + message); },
});
const chip = attachVsuTimedClient(createVsuClient(audio), audio.requestTimed);
const factoryPatch = createDefaultVsuPatch();
const banks = factoryPatch.banks.map(wave => Uint8Array.from(wave));
const channels = factoryPatch.channels;
const noiseChannel = channels.length - 1;
const voicePool = createVsuVoicePool();
let selectedNoiseTap = factoryPatch.noiseTap;
let noiseSettings = factoryPatch.noise;
let ch5Settings = factoryPatch.ch5;
let autoSource = 'wave', autoWaveChannel = 0, autoChannel = 0, selectedChannel = null, waveSample = 0;
let codeRunning = false, referenceState = { state: 'empty', id: null }, editorReady = false;
let vgmActivity = [];
let liveTarget = null, liveVoice = null, lastLiveVoice = null, liveSettingsKey = '';
let drawPointer = null, pendingWaveWrites = new Map();
const submittedWaveWrites = new Map();
let comparison = null;
let soundContext = null, scopeMode = 'waveform', scopeFrame = null;
let codeHandoff = Promise.resolve(), keys = new Map(), nextLiveKey = 0;
const fretboard = createFretboardState();
const fretboardTools = {
  instrumentRoot: byId('instrumentControls'), positionRoot: byId('positionControls'),
  fretDisplayRoot: byId('fretDisplay'), stringDisplayRoot: byId('stringDisplay'), stringWindowRoot: byId('stringWindowControls'),
};
let keyboardOctave = 0;
const editingTarget = 'input:not([type="range"], [type="checkbox"], [type="radio"]), textarea, select, [contenteditable]';
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
  const { width, height, context } = fitCanvas(outputCanvas);
  if (width > 60 && height > 40) visualizer.draw({ width, height }, context, scopeMode);
}

function scheduleScope() {
  if (scopeFrame !== null || audio.context?.state !== 'running' || document.hidden || !outputCanvas.getClientRects().length) return;
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
    context.fillStyle = index === waveSample ? '#ffd0d2' : '#ff5264';
    const barHeight = 3 + (height - 6) * sample / 63;
    context.fillRect(index * column + 1, height - barHeight, column - 2, barHeight);
  });
}

function displayedWave() {
  const bank = displayedWaveBank();
  if (bank === null) return;
  const base = liveTarget ? liveVoice?.wave : banks[bank];
  if (!base) return;
  const drag = drawPointer?.bank === bank && drawPointer.target === liveTarget ? drawPointer.edits : null;
  if (!drag && liveTarget?.source !== 'synth') return base;
  return Array.from(base, (value, index) => drag?.get(index) ??
    (liveTarget?.source === 'synth' ? pendingWaveValue(vsuWaveOffset(bank, index)) ?? value : value));
}

function displayedWaveBank() {
  const bank = liveTarget ? liveVoice?.waveBank : channels[Number(channelSelect.value)].wave;
  return Number.isInteger(bank) && bank >= 0 && bank < banks.length ? bank : null;
}

function pendingWaveValue(offset) {
  return submittedWaveWrites.get(offset)?.value ?? pendingWaveWrites.get(offset);
}

function canEditWave() {
  return displayedWaveBank() !== null && (!liveTarget || liveTarget.source === 'synth');
}

function acceptCodeWaveState({ editId, pendingWrites, appliedWrites }) {
  for (const [offset, write] of submittedWaveWrites) if (write.id <= editId) submittedWaveWrites.delete(offset);
  pendingWaveWrites = new Map(pendingWrites);
  if (liveTarget?.source === 'synth' && appliedWrites.length) {
    const applied = new Map(appliedWrites);
    const merge = voice => !voice?.wave ? voice : {
      ...voice, wave: voice.wave.map((value, index) => applied.get(vsuWaveOffset(voice.waveBank, index)) ?? value),
    };
    lastLiveVoice = merge(lastLiveVoice);
    if (liveVoice?.wave) showLiveVoice(merge(liveVoice));
  }
  refreshWave();
}

function refreshWave() {
  const value = displayedWave()?.[waveSample];
  waveCanvas.tabIndex = value === undefined ? -1 : 0;
  if (value === undefined) {
    waveCanvas.removeAttribute('aria-valuenow');
    waveCanvas.removeAttribute('aria-valuetext');
  } else {
    waveCanvas.setAttribute('aria-valuenow', value);
    waveCanvas.setAttribute('aria-valuetext', 'Sample ' + (waveSample + 1) + ' of 32, level ' + value);
  }
  const bank = displayedWaveBank();
  waveWriteStatus.hidden = !codeRunning || bank === null || !banks[bank].some((_, index) =>
    pendingWaveValue(vsuWaveOffset(bank, index)) !== undefined);
  drawWaveRam();
}

function noiseRegisterFor(note) {
  return noiseSettings.keyTracking && note !== undefined ? vsuFrequencyRegister(noiseChannel, note) : noiseSettings.frequency;
}

function drawNoiseTiming() {
  const note = voicePool.voiceOn(noiseChannel);
  const trackedNote = note?.started ? note.note : undefined;
  const tracking = !liveTarget && noiseSettings.keyTracking;
  const register = liveTarget ? liveVoice?.frequency : tracking && trackedNote === undefined ? undefined : noiseRegisterFor(trackedNote);
  const interval = liveTarget ? liveVoice?.interval : noiseSettings.interval;
  const rate = register === undefined ? null : vsuNoiseShiftRate(register);
  noiseFrequency.value = register ?? noiseSettings.frequency;
  noiseRateValue.value = rate === null ? (tracking ? 'By key' : '—') : rate >= 1000
    ? (rate / 1000).toFixed(2) + ' kHz' : rate.toFixed(2) + ' Hz';
  noiseFrequency.setAttribute('aria-valuetext', noiseRateValue.value);
  noiseFrequency.title = register === undefined ? '' : 'S6FQ 0x' + register.toString(16).toUpperCase().padStart(3, '0');
  noiseInterval.value = interval == null ? 0 : interval + 1;
  noiseIntervalValue.value = interval === undefined ? '—' : interval === null ? 'Hold'
    : ((interval + 1) * VSU_INTERVAL_STEP_MS).toFixed(2) + ' ms';
  noiseInterval.setAttribute('aria-valuetext', noiseIntervalValue.value);
  noiseKeyTracking.checked = tracking;
}

function drawNoiseTap(tap) {
  noiseTap.value = tap ?? 0;
  noiseTapValue.value = tap ?? '—';
  noisePattern.textContent = tap === null ? '' : VSU_NOISE_PATTERN_LENGTHS[tap].toLocaleString('en-US') + ' bits per cycle';
}

function markRadioChoice(group, value) {
  const selected = String(value);
  for (const radio of group.querySelectorAll('input[type="radio"]')) radio.checked = radio.value === selected;
}

function channelSettings(index = Number(channelSelect.value)) {
  const observing = Boolean(liveTarget);
  const voice = liveVoice;
  const editingLive = observing && Boolean(voice) && referenceState.state !== 'seeking';
  const settings = channels[index];
  const wave = observing ? voice?.waveBank ?? '' : settings.wave;
  const noise = index === noiseChannel;
  const canUseEffect = index === CH5 && (selectedChannel !== null || autoSource === 'effect');
  const effect = observing && voice?.modulation ? decodeCh5Settings(voice.ev1, voice.swp, voice.modulation) : ch5Settings;

  byId('vsuWavePanel').hidden = noise;
  byId('vsuVoiceTitle').textContent = noise ? 'Noise' : canUseEffect ? 'Wave + Sweep / Modulation' : 'Wave';
  channelWave.hidden = noise;
  byId('noiseTapGroup').hidden = !noise;
  byId('ch5Panel').hidden = !canUseEffect || (observing && !voice);
  markRadioChoice(channelWave, wave);
  if (noise) {
    drawNoiseTap(observing ? (voice ? (voice.ev1 >> 4) & 7 : null) : selectedNoiseTap);
    drawNoiseTiming();
  }
  for (const side of ['left', 'right']) {
    const level = observing ? voice?.[side] : settings[side];
    byId(side + 'Level').value = level ?? 0;
    byId(side + 'Value').value = level ?? '—';
  }
  const envelope = observing ? voice ? decodeVsuEnvelope(voice.ev0, voice.ev1) : createVsuEnvelope() : settings.envelope;
  envelopeMonitor.setSettings(envelope);
  refreshCh5Controls(effect);
  for (const field of [noiseTap, noiseFrequency, noiseInterval, noiseKeyTracking,
    ...Object.values(ch5Controls), ...ch5ModInputs]) {
    field.disabled = observing;
  }
  channelWave.disabled = observing && !(editingLive && liveTarget.source === 'synth');
  const editingWave = canEditWave();
  waveShape.disabled = byId('loadShape').disabled = !editingWave;
  for (const field of [byId('leftLevel'), byId('rightLevel'), byId('vsuEnvelopeControls')])
    field.disabled = observing && !editingLive;
  compare.disabled = observing || Boolean(comparison);
  liveEnabled.closest('label').hidden = !observing;
  waveCanvas.setAttribute('aria-readonly', String(!editingWave));
  waveCanvas.dataset.live = String(!editingWave);
  waveEditHint.hidden = !editingWave;
  waveEditHint.textContent = codeRunning ? 'Drag to draw. Wave RAM writes wait until all channels are idle.'
    : 'Drag to draw a waveform. Editing Wave RAM stops the active voices.';
  channelStatus.value = observing
    ? (liveTarget.source === 'vgm' ? 'VGM' : 'Code') + ' · CH' + (index + 1) +
      (voice ? liveEnabled.checked ? ' · Live' : ' · Frozen' : ' · Waiting for channel settings…')
    : selectedChannel === null ? autoChannelLabel() : 'Synth · CH' + (index + 1);
  refreshWave();
}

function drawLiveRegisters(voice) {
  drawChannelActivity();
  liveRegisters.hidden = !voice;
  if (!voice) return;
  if (liveTarget?.channel === noiseChannel) drawNoiseTiming();
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
  const staleNotes = voicePool.voices().filter(voice => voice.live && !matchesLiveKeyboardTarget(voice.live));
  for (const voice of staleNotes) {
    voicePool.releaseVoice(voice);
    stopKeyboardVoice(voice);
  }
  if (staleNotes.length) syncKeyboardVoices();
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
  else if (edit?.register === 'RAM') showLiveVoice({ ...liveVoice, waveBank: voice.waveBank, wave: voice.wave });
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
  if (register !== 'RAM') showLiveVoice(mergeLiveRegister(liveVoice, register, mask, value));
}

function authoredOutputs(instrument) {
  const active = voicePool.voices().filter(voice => voice.started);
  const outputs = active.filter(voice => voice.instrument === instrument).map(voice => voice.channel);
  if (!active.some(voice => voice.channel === instrument)) outputs.push(instrument);
  return outputs;
}

function sendAuthoredParameter(index, writeForChannel) {
  const { running, stopping } = runtime.getState();
  if (!canWrite() || stopping) return;
  if (running) {
    for (const note of voicePool.voices()) {
      if (note.started && note.sharedCode && note.instrument === index)
        audio.editSynthKey({ ...note.sharedCode, writes: [writeForChannel(note.channel)] });
    }
    return;
  }
  audio.writeBatch(authoredOutputs(index).map(writeForChannel));
}

function sendChannelLevels(index) {
  if (!canWrite() || codeRunning) return;
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

function keyboardEnvelopeWrites(channel, instrument, useCh5Effect = instrument === CH5) {
  const settings = channels[instrument].envelope;
  if (channel !== CH5 || useCh5Effect) return envelopeWrites(channel, settings);
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
  stopComparison();
  sendAuthoredParameter(index, channel => {
    const note = voicePool.voiceOn(channel);
    const writes = keyboardEnvelopeWrites(channel, index, note?.started ? note.useCh5Effect : index === CH5);
    return register === 'EV0' ? writes[0] : writes.at(-1);
  });
}

function writePatchToChip() {
  audio.reset();
  banks.forEach((wave, bank) => chip.setWave(bank, wave));
  channels.forEach(({ wave, left, right }, channel) => {
    chip.setVolume(channel, left, right);
    if (wave !== null) chip.setWaveBank(channel, wave);
  });
  if (!noiseSettings.keyTracking) audio.writeBatch(vsuFrequencyWrites(noiseChannel, noiseSettings.frequency));
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

function appendCodeLog(line) {
  codeOutput.textContent = (codeOutput.textContent + line + '\n').slice(-12000);
}

const runtime = createPlaygroundCodeRuntime({
  ensureReady: ensureVsu,
  now: () => audio.context?.currentTime ?? 0,
  supportedSoundChips: ['vsu'],
  useSoundChip: () => chip,
  readFile: (...args) => files.readFile(...args),
  prepareSource: (...args) => files.prepareSource(...args),
  onLog: appendCodeLog,
  onState(state) {
    status.textContent = state.status;
    run.disabled = state.busy;
    apply.disabled = !state.running || state.busy;
    stop.disabled = !state.running || state.stopping;
    if (codeRunning !== state.running) {
      codeRunning = state.running;
      if (!codeRunning) {
        pendingWaveWrites.clear();
        submittedWaveWrites.clear();
        for (const voice of voicePool.voices()) if (voice.sharedCode) releaseKey(voice.owner);
      }
      if (editorReady && !syncLiveTarget()) channelSettings();
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
  const useAuto = liveTarget || selectedChannel === null;
  return validateVsuPatch({
    format: VSU_PATCH_FORMAT, version: 1, banks: banks.map(wave => Array.from(wave)),
    channels, noiseTap: selectedNoiseTap, noise: noiseSettings, ch5: ch5Settings,
    preferredChannel: useAuto ? autoChannel : selectedChannel,
    preferredSource: useAuto ? autoSource : vsuAutoSourceForChannel(selectedChannel, ch5Settings),
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
  selectedNoiseTap = next.noiseTap;
  noiseSettings = next.noise ?? createLegacyVsuNoiseSettings();
  ch5Settings = next.ch5;
  const source = next.preferredChannel === undefined ? autoSource
    : next.preferredSource ?? vsuAutoSourceForChannel(next.preferredChannel, ch5Settings);
  selectAutoSource(source, next.preferredChannel);
  if (canWrite()) writePatchToChip();
}

async function copyReferenceVoice(snapshot) {
  const result = captureVsuVoice(getPatch(), snapshot);
  await applyPatch({
    ...result.patch, preferredChannel: result.channel,
    preferredSource: vsuAutoSourceForChannel(result.channel, result.patch.ch5),
  });
  selectWorkspaceTab(chipTabs[0]);
}

const ch5Gate = vsuChannelRegister(CH5, VSU_REGISTERS.INT);
const ch5ModInputs = [];

function ch5NoteWrites(note, settings, envelope) {
  const writes = [[ch5Gate, 0]];
  if (settings.mode === 'modulation') writes.push(...ch5ModulationWrites(settings.modulation));
  // Off, Sweep and Modulation all restart at the same base note.
  writes.push(...envelopeWrites(CH5, envelope, settings), ...vsuNoteOnWrites(CH5, note));
  return writes;
}

function startCh5Note(note, settings, envelope = channels[CH5].envelope) {
  audio.writeBatch(ch5NoteWrites(note, settings, envelope));
}

function selectedCh5ControlWrites() {
  const { ev1 } = vsuEnvelopeRegisterValues(channels[CH5].envelope);
  return ch5ControlWrites(ch5Settings, ev1);
}

function refreshCh5Controls(settings = ch5Settings) {
  for (const [key, input] of Object.entries(ch5Controls)) {
    if (key === 'repeat') input.checked = settings[key];
    else if (input.type === 'fieldset') markRadioChoice(input, settings[key]);
    else input.value = settings[key];
  }
  const multiplier = settings.rate || 'Off';
  byId('ch5RateValue').value = multiplier;
  ch5Controls.rate.setAttribute('aria-valuetext', multiplier);
  byId('ch5ShiftValue').value = settings.shift;
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
  if (!canWrite() || stopping) return;
  const note = voicePool.voiceOn(CH5);
  if (note?.started) {
    if (!note.useCh5Effect) return;
    const writes = restart || table ? ch5NoteWrites(note.note, ch5Settings, channels[CH5].envelope) : selectedCh5ControlWrites();
    if (note.sharedCode) audio.editSynthKey({ ...note.sharedCode, writes });
    else if (!running) audio.writeBatch(writes);
    return;
  }
  if (running) return;
  // The modulation RAM remains writable whenever CH5 is stopped.
  const writes = table ? ch5ModulationWrites(ch5Settings.modulation) : [];
  audio.writeBatch([...writes, ...selectedCh5ControlWrites()]);
}

function setupCh5Controls() {
  for (const [key, input] of Object.entries(ch5Controls)) input.addEventListener(input.type === 'range' ? 'input' : 'change', event => {
    if (liveTarget || (input.type === 'fieldset' && !event.target.checked)) return;
    const previous = ch5Settings[key];
    const value = input.type === 'checkbox' ? input.checked : input.type === 'range' ? input.valueAsNumber
      : event.target.value;
    if (value === previous) return;
    ch5Settings[key] = value;
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

function keyboardChannels() {
  return selectedChannel === null ? vsuAutoVoiceChannels(autoSource) : [selectedChannel];
}

function autoChannelLabel() {
  const pool = vsuAutoVoiceChannels(autoSource);
  if (pool.length > 1) return 'AUTO · Wave · ' + pool.length + ' voices round robin';
  const voice = autoSource === 'noise' ? 'Noise' : ({
    off: 'Sweep / Modulation', sweep: 'Sweep', modulation: 'Modulation',
  })[ch5Settings.mode];
  return 'AUTO · ' + voice + ' · CH' + (autoChannel + 1);
}

function keyboardVoiceRegisters(channel, instrument, useCh5Effect) {
  const { wave, left, right } = channels[instrument];
  const writes = [[vsuChannelRegister(channel, VSU_REGISTERS.LRV), (left << 4) | right]];
  if (wave !== null) writes.push([vsuChannelRegister(channel, VSU_REGISTERS.RAM), wave]);
  return [...writes, ...keyboardEnvelopeWrites(channel, instrument, useCh5Effect)];
}

function stopKeyboardVoice(voice) {
  if (!voice.started) return;
  const owner = voice.live ?? voice.sharedCode;
  if (owner) {
    audio.liveNoteOff(owner);
    return;
  }
  if (!canWrite()) return;
  const { channel, instrument } = voice;
  const writes = [[vsuChannelRegister(channel, VSU_REGISTERS.INT), 0]];
  if (channel !== instrument || (channel === CH5 && !voice.useCh5Effect))
    writes.push(...keyboardVoiceRegisters(channel, channel));
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
  if (!liveTarget && Number(channelSelect.value) === noiseChannel) drawNoiseTiming();
  drawChannelActivity();
}

function releaseKeyboard() {
  const voices = voicePool.clear();
  if (!voices.length) return;
  voices.forEach(stopKeyboardVoice);
  syncKeyboardVoices();
}

function matchesLiveKeyboardTarget(target) {
  return target.source === liveTarget?.source && target.channel === liveTarget.channel && target.playbackId === liveTarget.id &&
    (target.source === 'vgm' ? referenceState.state === 'playing' : codeRunning);
}

async function playKeyboard(owner, entry, button) {
  const instrument = selectedChannel ?? autoChannel;
  if (selectedChannel !== null && ['preparing', 'seeking'].includes(referenceState.state)) return;
  const target = liveTarget && { source: liveTarget.source, channel: liveTarget.channel, playbackId: liveTarget.id };
  const live = target && matchesLiveKeyboardTarget(target) ? { ...target, owner: ++nextLiveKey } : null;
  const sharedCode = expandedTab && codeRunning && selectedChannel === null
    ? { source: 'synth', playbackId: null, owner: ++nextLiveKey } : null;
  const useCh5Effect = instrument === CH5 && (selectedChannel !== null || autoSource === 'effect');
  const allocation = voicePool.acquire(keyboardChannels(), {
    owner, button, instrument, note: entry.midi, noteName: entry.noteName, live, sharedCode, useCh5Effect,
  });
  if (!allocation) return;
  const { voice, displaced } = allocation;
  if (voice.sharedCode) voice.sharedCode.channel = voice.channel;
  if (displaced) stopKeyboardVoice(displaced);
  if (live) {
    voice.started = audio.liveNoteOn({ ...live, note: voice.note });
    if (!voice.started) voicePool.releaseVoice(voice);
    syncKeyboardVoices();
    return;
  }
  if (!sharedCode) {
    reference.interrupt();
    stopComparison();
  }
  syncKeyboardVoices();
  try {
    if (!sharedCode) await waitForCodeStop();
    await ensureVsu();
    if (!voicePool.isCurrent(voice)) return;
    const { channel } = voice;
    const writes = [[vsuChannelRegister(channel, VSU_REGISTERS.INT), 0], ...keyboardVoiceRegisters(channel, instrument, useCh5Effect)];
    if (useCh5Effect && ch5Settings.mode === 'modulation')
      writes.push(...ch5ModulationWrites(ch5Settings.modulation));
    const trigger = channel === noiseChannel ? vsuStartWrites(channel, noiseRegisterFor(voice.note), noiseSettings.interval)
      : vsuNoteOnWrites(channel, voice.note);
    if (sharedCode) {
      voice.started = audio.synthKeyOn({ ...sharedCode, writes: [...writes, ...trigger] });
      if (!voice.started) voicePool.releaseVoice(voice);
    } else {
      audio.writeBatch([...writes, ...trigger]);
      voice.started = true;
      status.textContent = 'Ready';
    }
    syncKeyboardVoices();
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
  const { rowDefs, entries } = createFretboardLayout({ state: fretboard, octave: keyboardOctave });
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
  renderKeyboardControls();
}

function renderKeyboardControls() {
  const { instrumentRoot, positionRoot, stringWindowRoot } = fretboardTools;
  const groups = [instrumentRoot, positionRoot, stringWindowRoot];
  const focusedGroup = groups.find(group => group.contains(document.activeElement));
  renderFretboardControls({
    ...fretboardTools, state: fretboard,
    onInstrumentChange(instrument) { setInstrument(fretboard, instrument); redrawKeyboard(); },
    onPositionPresetSelect(fret) { setFretPosition(fretboard, fret); redrawKeyboard(); },
    onStringWindowChange(index) { setStringWindowIndex(fretboard, index); redrawKeyboard(); },
  });
  for (const group of groups) {
    for (const button of group.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.classList.contains('is-selected')));
    }
  }
  focusedGroup?.querySelector('.is-selected')?.focus();
  byId('octaveValue').value = keyboardOctave > 0 ? '+' + keyboardOctave : keyboardOctave;
  byId('octaveDown').disabled = keyboardOctave <= -2;
  byId('octaveUp').disabled = keyboardOctave >= 2;
}

function editWaveSamples(bank, edits) {
  if (!canEditWave() || bank !== displayedWaveBank()) return;
  const samples = Array.from(edits);
  if (!samples.length) return;
  if (!liveTarget) {
    for (const [index, value] of samples) banks[bank][index] = value;
  }
  stopComparison();
  if (canWrite()) {
    if (codeRunning) {
      const writes = samples.map(([index, value]) => [vsuWaveOffset(bank, index), value]);
      const id = audio.writeCodeWave(writes);
      if (id) for (const [offset, value] of writes) submittedWaveWrites.set(offset, { id, value });
    } else {
      releaseKeyboard();
      chip.allNotesOff();
      chip.setWave(bank, banks[bank]);
    }
  }
  refreshWave();
}

function drawAtPointer(event) {
  if (drawPointer.target !== liveTarget || displayedWaveBank() !== drawPointer.bank) return;
  const rect = waveCanvas.getBoundingClientRect();
  waveSample = Math.min(31, Math.max(0, Math.floor((event.clientX - rect.left) * 32 / rect.width)));
  const value = Math.min(63, Math.max(0, Math.round((rect.bottom - event.clientY) * 63 / rect.height)));
  drawPointer.edits.set(waveSample, value);
  refreshWave();
}
waveCanvas.addEventListener('pointerdown', event => {
  if (!canEditWave() || event.button !== 0 || drawPointer !== null) return;
  drawPointer = { id: event.pointerId, bank: displayedWaveBank(), target: liveTarget, edits: new Map() };
  waveCanvas.setPointerCapture(event.pointerId);
  drawAtPointer(event);
});
waveCanvas.addEventListener('pointermove', event => {
  if (drawPointer?.id === event.pointerId) drawAtPointer(event);
});
waveCanvas.addEventListener('lostpointercapture', event => {
  if (drawPointer?.id !== event.pointerId) return;
  const { bank, target, edits } = drawPointer;
  drawPointer = null;
  if (target === liveTarget) editWaveSamples(bank, edits);
});
waveCanvas.addEventListener('keydown', event => {
  const samples = displayedWave();
  if (!samples) return;
  const index = { ArrowLeft: waveSample - 1, ArrowRight: waveSample + 1, Home: 0, End: samples.length - 1 }[event.key];
  if (index !== undefined) {
    event.preventDefault();
    waveSample = Math.min(samples.length - 1, Math.max(0, index));
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    if (!canEditWave()) return;
    const value = samples[waveSample] + (event.key === 'ArrowUp' ? 1 : -1);
    if (value < 0 || value > 63) return;
    editWaveSamples(displayedWaveBank(), [[waveSample, value]]);
    return;
  } else return;
  refreshWave();
});
byId('loadShape').addEventListener('click', () => {
  if (!canEditWave()) return;
  const samples = createVsuWave(waveShape.querySelector('input:checked').value);
  editWaveSamples(displayedWaveBank(), samples.entries());
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
const autoTypeTabs = ['vsuAutoWave', 'vsuAutoEffect', 'vsuAutoNoise'].map(byId);
for (const [position, button] of autoTypeTabs.entries()) {
  button.addEventListener('click', () => selectAutoSource(VSU_AUTO_SOURCES[position]));
  button.addEventListener('keydown', event => {
    const count = autoTypeTabs.length;
    const next = { Home: 0, End: count - 1, ArrowLeft: (position + count - 1) % count, ArrowRight: (position + 1) % count }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectAutoSource(VSU_AUTO_SOURCES[next]);
    autoTypeTabs[next].focus();
  });
}
function updateChannelTabs() {
  channelTabs.forEach((button, position) => {
    const active = channelChoices[position] === selectedChannel;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  byId('vsuAutoTypes').hidden = selectedChannel !== null;
  for (const [position, button] of autoTypeTabs.entries()) {
    const active = VSU_AUTO_SOURCES[position] === autoSource;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
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

function selectAutoSource(source, preferredChannel) {
  if (source === 'wave' && preferredChannel !== undefined) autoWaveChannel = preferredChannel;
  autoSource = source;
  autoChannel = vsuAutoChannel(source, autoWaveChannel);
  selectChannel(null);
}

function selectChannel(index) {
  stopComparison();
  releaseKeyboard();
  selectedChannel = index;
  const physical = index ?? autoChannel;
  channelSelect.value = physical;
  waveSample = 0;
  updateChannelTabs();
  reference.setChannel(index);
  const refreshed = syncLiveTarget();
  if (!refreshed) channelSettings(physical);
}

liveEnabled.addEventListener('change', () => {
  if (liveEnabled.checked && lastLiveVoice) showLiveVoice(lastLiveVoice);
  channelSettings();
});

noiseTap.addEventListener('input', () => {
  if (liveTarget) return;
  selectedNoiseTap = noiseTap.valueAsNumber;
  drawNoiseTap(selectedNoiseTap);
  if (canWrite() && !codeRunning) {
    const [address, value] = envelopeWrites(noiseChannel).at(-1);
    chip.write(address, value);
  }
});
function applyNoiseRate() {
  const note = voicePool.voiceOn(noiseChannel);
  if (canWrite() && !codeRunning && (!noiseSettings.keyTracking || note?.started)) {
    audio.writeBatch(vsuFrequencyWrites(noiseChannel, noiseRegisterFor(note?.note)));
  }
  drawNoiseTiming();
}
noiseFrequency.addEventListener('input', () => {
  if (liveTarget) return;
  noiseSettings.frequency = noiseFrequency.valueAsNumber;
  noiseSettings.keyTracking = false;
  applyNoiseRate();
});
noiseKeyTracking.addEventListener('change', () => {
  if (liveTarget) return;
  noiseSettings.keyTracking = noiseKeyTracking.checked;
  applyNoiseRate();
});
noiseInterval.addEventListener('input', () => {
  if (liveTarget) return;
  const steps = noiseInterval.valueAsNumber;
  noiseSettings.interval = steps ? steps - 1 : null;
  drawNoiseTiming();
});
channelSelect.addEventListener('change', () => selectChannel(Number(channelSelect.value)));
channelWave.addEventListener('change', event => {
  if (!event.target.checked) return;
  const wave = Number(event.target.value);
  if (liveTarget) {
    if (liveTarget.source === 'synth') updateLiveRegister('RAM', 7, wave);
    return;
  }
  stopComparison();
  const index = Number(channelSelect.value);
  channels[index].wave = wave;
  waveSample = 0;
  refreshWave();
  sendAuthoredParameter(index, channel => [vsuChannelRegister(channel, VSU_REGISTERS.RAM), wave]);
});
for (const side of ['left', 'right']) {
  const control = byId(side + 'Level');
  control.addEventListener('input', () => {
    const value = control.valueAsNumber;
    if (liveTarget) {
      if (side === 'left') updateLiveRegister('LRV', 0xf0, value << 4);
      else updateLiveRegister('LRV', 0x0f, value);
      return;
    }
    const index = Number(channelSelect.value);
    if (index === CH5) stopComparison();
    channels[index][side] = value;
    byId(side + 'Value').value = value;
    sendChannelLevels(index);
  });
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
setupOutputMixer(byId('vsuOutputChannels'), (channel, settings) => audio.setChannelMix(channel, settings));
const scopeButtonIds = { waveform: 'showWaveform', spectrum: 'showSpectrum' };
const scopes = Object.values(scopeButtonIds).map(byId);
function setScopeMode(mode) {
  showMode(scopes, scopeButtonIds[mode]);
  scopeMode = mode;
  outputCanvas.setAttribute('aria-label', 'Output ' + mode);
}
for (const [mode, id] of Object.entries(scopeButtonIds)) {
  byId(id).addEventListener('click', () => {
    setScopeMode(mode);
    drawOutput();
    scheduleScope();
  });
}
const inputs = [byId('showKeyboard'), byId('showCode')];
const chipTabs = [byId('vsuChipTab'), byId('vsuMixerTab')];
const workspaceModes = [byId('workspaceSynth'), byId('workspaceCode')];
const synthChipList = byId('vsuSynthChipTabs'), synthInputList = byId('vsuSynthPerformanceTabs');
const expandedList = byId('vsuCodeWorkspaceTabs');
const expandedTabs = [inputs[1], ...chipTabs, inputs[0]];
const workspaceMain = expandedList.parentElement;
let synthChipTab = chipTabs[0], synthInputTab = inputs[0], expandedTab = null;

function markSelectedTabs(tabs, selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function selectMonitor(showMixer) {
  const monitor = byId('vsuOutputMonitor');
  const container = byId(showMixer ? 'vsuMixerPanel' : 'vsuSynthControls');
  if (monitor.parentElement !== container) container.prepend(monitor);
}

function renderWorkspace() {
  const chipView = expandedTab ?? synthChipTab;
  const inputView = expandedTab ?? synthInputTab;
  const showVsu = chipView === chipTabs[0], showMixer = chipView === chipTabs[1];
  showMode(workspaceModes, workspaceModes[Number(expandedTab !== null)].id);
  if (expandedTab) markSelectedTabs(expandedTabs, expandedTab);
  else {
    markSelectedTabs(chipTabs, synthChipTab);
    markSelectedTabs(inputs, synthInputTab);
  }
  byId('vsuChannelBar').hidden = !showVsu;
  byId('vsuChipPanel').hidden = !showVsu;
  byId('vsuMixerPanel').hidden = !showMixer;
  byId('keyboardPanel').hidden = inputView !== inputs[0];
  codePanel.hidden = inputView !== inputs[1];
  performancePanel.hidden = !inputs.includes(inputView);
  const statusParent = codePanel.hidden ? performancePanel : codeTransport;
  if (status.parentElement !== statusParent) statusParent.append(status);
  if (showVsu || showMixer) selectMonitor(showMixer);
  drawOutput();
  scheduleScope();
}

function selectWorkspaceTab(tab) {
  if (expandedTab) expandedTab = tab;
  else if (chipTabs.includes(tab)) synthChipTab = tab;
  else synthInputTab = tab;
  renderWorkspace();
}

function setWorkspaceMode(showCode) {
  if (showCode && !expandedTab) {
    expandedList.append(...expandedTabs);
    synthChipList.hidden = synthInputList.hidden = true;
    expandedList.hidden = false;
    workspaceMain.dataset.layout = 'code';
  } else if (!showCode && expandedTab) {
    synthChipList.append(...chipTabs);
    synthInputList.append(...inputs);
    synthChipList.hidden = synthInputList.hidden = false;
    expandedList.hidden = true;
    delete workspaceMain.dataset.layout;
  }
  expandedTab = showCode ? inputs[1] : null;
  renderWorkspace();
}

for (const tab of expandedTabs) {
  tab.addEventListener('click', () => {
    selectWorkspaceTab(tab);
    tab.focus();
  });
  tab.addEventListener('keydown', event => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const horizontal = ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key);
    if (!horizontal && !(expandedTab && ['ArrowUp', 'ArrowDown'].includes(event.key))) return;
    event.preventDefault();
    const tabs = expandedTab ? expandedTabs : chipTabs.includes(tab) ? chipTabs : inputs;
    const index = tabs.indexOf(tab);
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)
      : tabs[(index + step + tabs.length) % tabs.length];
    selectWorkspaceTab(next);
    next.focus();
  });
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
    if (show) selectWorkspaceTab(inputs[1]);
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
for (const [button, action] of [[run, () => execute(false)], [apply, () => execute(true)], [stop, stopCode]]) {
  button.addEventListener('click', () => {
    button.focus();
    void action();
  });
}

function handleCodeShortcut(event) {
  if (codePanel.hidden || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
  event.preventDefault();
  const button = event.shiftKey ? apply : run;
  if (!event.repeat && !button.disabled) void execute(event.shiftKey);
}
codePanel.addEventListener('keydown', handleCodeShortcut);
inputs[1].addEventListener('keydown', handleCodeShortcut);

for (const [id, delta] of [['octaveDown', -1], ['octaveUp', 1]]) {
  byId(id).addEventListener('click', () => {
    keyboardOctave = Math.max(-2, Math.min(2, keyboardOctave + delta));
    redrawKeyboard();
  });
}
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey ||
      (!expandedTab && byId('keyboardPanel').hidden && !(codeRunning && liveTarget?.source === 'synth')) ||
      event.target.closest(editingTarget)) return;
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
redrawKeyboard();
drawOutput();
