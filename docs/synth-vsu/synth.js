// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { buildKeyboard, createFretboardLayout, createFretboardState } from '../synth/synth_keyboard.js';
import { createSynthOutputVisualizer } from '../synth/synth_output_visualizer.js';
import { createVsuAudio } from './audio.js';
import {
  CH5, CH5_MODULATION_MAX, CH5_MODULATION_MIN,
  createCh5Settings, createCh5DemoSettings, ch5ControlWrites, ch5ModulationWrites, ch5StepMs,
} from './ch5.js';
import { setupVsuFiles } from './files.js';
import { validateVsuPatch, VSU_PATCH_FORMAT } from './patch.js';
import { createVsuClient, createVsuWave, vsuChannelRegister, vsuNoteOnWrites, VSU_REGISTERS } from './vsu.js';
import { loadVsuVgm } from './vgm.js';
import { setupVgmPlayer } from './vgm-player.js';

const byId = id => document.getElementById(id);
const status = byId('status'), code = byId('code'), codeOutput = byId('codeOutput');
const run = byId('run'), apply = byId('apply'), stop = byId('stop');
const keyboard = byId('keyboard'), playingNote = byId('playingNote');
const channelSelect = byId('channel'), channelWave = byId('channelWave');
const noiseTap = byId('noiseTap');
const editBank = byId('editBank'), sampleIndex = byId('sampleIndex'), sampleValue = byId('sampleValue');
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
  onVgmState(update) { reference.onAudioState(update); },
});
const chip = createVsuClient(audio);
const banks = ['triangle', 'sine', 'square', 'saw', 'triangle'].map(shape => createVsuWave(shape));
let selectedNoiseTap = 0;
let ch5Settings = createCh5Settings();
let comparison = null;
const channels = Array.from({ length: 6 }, (_, index) => ({
  wave: index < 5 ? index : null, left: 10, right: 10,
}));
let soundContext = null, scopeMode = 'waveform', scopeFrame = null;
let held = null, codeHandoff = Promise.resolve(), keys = new Map();
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
  const { width, height, context } = fitCanvas(outputCanvas);
  if (width > 60 && height > 40) visualizer.draw({ width, height }, context, scopeMode);
}

function scheduleScope() {
  if (scopeFrame !== null || audio.context?.state !== 'running' || document.hidden) return;
  scopeFrame = requestAnimationFrame(() => {
    scopeFrame = null;
    drawOutput();
    scheduleScope();
  });
}

function drawWaveRam() {
  const { width, height, context } = fitCanvas(waveCanvas);
  const samples = banks[Number(editBank.value)];
  const column = width / samples.length;
  context.fillStyle = '#18090f';
  context.fillRect(0, 0, width, height);
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

function showSample() {
  const bank = banks[Number(editBank.value)], index = sampleIndex.valueAsNumber;
  if (Number.isInteger(index) && index >= 0 && index < bank.length) sampleValue.value = bank[index];
  drawWaveRam();
}

function channelSettings(index = Number(channelSelect.value)) {
  const settings = channels[index];
  channelWave.disabled = settings.wave === null;
  byId('channelWaveGroup').hidden = settings.wave === null;
  byId('noiseTapGroup').hidden = settings.wave !== null;
  byId('ch5Panel').hidden = index !== CH5;
  if (settings.wave !== null) channelWave.value = settings.wave;
  byId('leftLevel').value = byId('leftValue').value = settings.left;
  byId('rightLevel').value = byId('rightValue').value = settings.right;
}

function sendChannelLevels(index) {
  if (!canWrite()) return;
  const { left, right } = channels[index];
  chip.setVolume(index, left, right);
}

function writePatchToChip() {
  audio.reset();
  banks.forEach((wave, bank) => chip.setWave(bank, wave));
  channels.forEach(({ wave, left, right }, channel) => {
    chip.write(vsuChannelRegister(channel, VSU_REGISTERS.EV0), 0xf0);
    chip.setVolume(channel, left, right);
    if (wave !== null) chip.setWaveBank(channel, wave);
  });
  chip.write(vsuChannelRegister(5, VSU_REGISTERS.EV1), selectedNoiseTap << 4);
  audio.writeBatch([...ch5ModulationWrites(ch5Settings.modulation), ...ch5ControlWrites(ch5Settings)]);
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
  },
  stopSoundChips() { if (canWrite()) chip.allNotesOff(); },
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
  noiseTap.value = selectedNoiseTap;
  ch5Settings = next.ch5;
  channelSettings();
  showSample();
  refreshCh5Controls();
  if (canWrite()) writePatchToChip();
}

const ch5Gate = vsuChannelRegister(CH5, VSU_REGISTERS.INT);
const ch5ModInputs = [];

function startCh5Note(note, settings) {
  const writes = [[ch5Gate, 0], [vsuChannelRegister(CH5, VSU_REGISTERS.EV0), 0xf0]];
  if (settings.mode === 'modulation') writes.push(...ch5ModulationWrites(settings.modulation));
  // Off, Sweep and Modulation all restart at the same base note.
  writes.push(...ch5ControlWrites(settings), ...vsuNoteOnWrites(CH5, note));
  audio.writeBatch(writes);
}

function refreshCh5Controls() {
  for (const [key, input] of Object.entries(ch5Controls)) {
    if (key === 'repeat') input.checked = ch5Settings[key];
    else input.value = ch5Settings[key];
  }
  byId('ch5Timing').hidden = ch5Settings.mode === 'off';
  byId('ch5Sweep').hidden = ch5Settings.mode !== 'sweep';
  byId('ch5Modulation').hidden = ch5Settings.mode !== 'modulation';
  const interval = ch5StepMs(ch5Settings);
  byId('ch5Step').value = interval ? `${interval.toFixed(2)} ms / step` : 'Off';
  ch5ModInputs.forEach((input, index) => { input.value = ch5Settings.modulation[index]; });
}

function updateCh5Audio({ restart = false, table = false } = {}) {
  stopComparison();
  const { running, stopping } = runtime.getState();
  if (!canWrite() || running || stopping) return;
  if (held?.channel === CH5 && held.started) {
    if (restart || table) startCh5Note(held.note, ch5Settings);
    else audio.writeBatch(ch5ControlWrites(ch5Settings));
    return;
  }
  // The modulation RAM remains writable whenever CH5 is stopped.
  const writes = table ? ch5ModulationWrites(ch5Settings.modulation) : [];
  audio.writeBatch([...writes, ...ch5ControlWrites(ch5Settings)]);
}

function setupCh5Controls() {
  for (const [key, input] of Object.entries(ch5Controls)) input.addEventListener('change', () => {
    const previous = ch5Settings[key];
    ch5Settings[key] = key === 'repeat' ? input.checked
      : key === 'rate' || key === 'shift' ? Number(input.value) : input.value;
    // Changing mode or switching the interval off/on begins again at base pitch.
    const rateToggled = key === 'rate' && (previous === 0 || ch5Settings.rate === 0);
    updateCh5Audio({ restart: key === 'mode' || rateToggled });
    refreshCh5Controls();
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
    audio.writeBatch([[ch5Gate, 0], ...ch5ModulationWrites(ch5Settings.modulation), ...ch5ControlWrites(ch5Settings)]);
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
    for (const [mode, name] of comparisonStages) {
      startCh5Note(comparisonNote, createCh5DemoSettings(mode));
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

function releaseKeyboard() {
  const voice = held;
  held = null;
  if (!voice) return;
  voice.button.classList.remove('is-held');
  voice.button.setAttribute('aria-pressed', 'false');
  if (voice.started && canWrite()) chip.noteOff(voice.channel);
  playingNote.value = '';
}

async function playKeyboard(owner, entry, button) {
  if (held?.owner === owner) return;
  reference.interrupt();
  stopComparison();
  releaseKeyboard();
  const voice = { owner, button, channel: Number(channelSelect.value), note: entry.midi, started: false };
  held = voice;
  button.classList.add('is-held');
  button.setAttribute('aria-pressed', 'true');
  try {
    await waitForCodeStop();
    await ensureVsu();
    if (held !== voice) return;
    const wave = channels[voice.channel].wave;
    sendChannelLevels(voice.channel);
    if (wave !== null) chip.setWaveBank(voice.channel, wave);
    else chip.write(vsuChannelRegister(voice.channel, VSU_REGISTERS.EV1), selectedNoiseTap << 4);
    if (voice.channel === CH5) startCh5Note(voice.note, ch5Settings);
    else chip.noteOn(voice.channel, voice.note);
    voice.started = true;
    playingNote.value = entry.noteName;
    status.textContent = 'Ready';
  } catch (error) {
    if (held === voice) releaseKeyboard();
    status.textContent = error.message;
  }
}

function releaseKey(owner) {
  if (held?.owner === owner) releaseKeyboard();
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
  stopComparison();
  if (!canWrite()) return;
  releaseKeyboard();
  chip.allNotesOff();
  const bank = Number(editBank.value);
  chip.setWave(bank, banks[bank]);
}

function setSample(index, value) {
  if (!Number.isInteger(index) || index < 0 || index > 31 || !Number.isInteger(value) || value < 0 || value > 63) return false;
  banks[Number(editBank.value)][index] = value;
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
  if (event.button !== 0 || drawPointer !== null) return;
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
editBank.addEventListener('change', showSample);
sampleIndex.addEventListener('change', showSample);
sampleValue.addEventListener('change', () => {
  if (setSample(sampleIndex.valueAsNumber, sampleValue.valueAsNumber)) writeEditedBank();
});
byId('loadShape').addEventListener('click', () => {
  banks[Number(editBank.value)] = createVsuWave(byId('waveShape').value);
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
for (let tap = 0; tap < 8; tap += 1) noiseTap.add(new Option(String(tap), String(tap)));
noiseTap.addEventListener('change', () => {
  selectedNoiseTap = Number(noiseTap.value);
  if (canWrite()) chip.write(vsuChannelRegister(5, VSU_REGISTERS.EV1), selectedNoiseTap << 4);
});
channelSelect.addEventListener('change', () => {
  stopComparison();
  releaseKeyboard();
  channelSettings();
});
channelWave.addEventListener('change', () => {
  stopComparison();
  const index = Number(channelSelect.value), wave = Number(channelWave.value);
  channels[index].wave = wave;
  if (canWrite()) chip.setWaveBank(index, wave);
});
for (const side of ['left', 'right']) {
  const control = byId(side + 'Level'), output = byId(side + 'Value');
  control.addEventListener('input', () => {
    const index = Number(channelSelect.value);
    if (index === CH5) stopComparison();
    output.value = channels[index][side] = control.valueAsNumber;
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
const scopes = [byId('showWaveform'), byId('showSpectrum')];
for (const button of scopes) button.addEventListener('click', () => {
  showMode(scopes, button.id);
  scopeMode = button === scopes[0] ? 'waveform' : 'spectrum';
  outputCanvas.setAttribute('aria-label', 'Output ' + scopeMode);
  drawOutput();
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

channelSettings();
setupCh5Controls();
showSample();
redrawKeyboard();
drawOutput();
