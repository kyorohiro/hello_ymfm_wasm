// SPDX-License-Identifier: BSD-3-Clause
import { createPlaygroundCodeRuntime } from '../js/playground_code_runtime.js';
import { buildKeyboard, createFretboardLayout, createFretboardState } from '../synth/synth_keyboard.js';
import { createSynthOutputVisualizer } from '../synth/synth_output_visualizer.js';
import { createVsuAudio } from './audio.js';
import { createVsuClient, createVsuWave, vsuChannelRegister, VSU_REGISTERS } from './vsu.js';

const byId = id => document.getElementById(id);
const status = byId('status'), code = byId('code'), codeOutput = byId('codeOutput');
const run = byId('run'), apply = byId('apply'), stop = byId('stop');
const keyboard = byId('keyboard'), playingNote = byId('playingNote');
const channelSelect = byId('channel'), channelWave = byId('channelWave');
const noiseTap = byId('noiseTap');
const editBank = byId('editBank'), sampleIndex = byId('sampleIndex'), sampleValue = byId('sampleValue');
const outputCanvas = byId('outputCanvas'), waveCanvas = byId('waveCanvas');
const visualizer = createSynthOutputVisualizer({
  background: '#18090f', grid: '#5c293b', labels: '#e9b3be', trace: '#ff6978',
});
const audio = createVsuAudio({ onError(error) {
  releaseKeyboard();
  void runtime.stop();
  status.textContent = error.message;
} });
const chip = createVsuClient(audio);
const banks = ['triangle', 'sine', 'square', 'saw', 'triangle'].map(shape => createVsuWave(shape));
let selectedNoiseTap = 0;
const channels = Array.from({ length: 6 }, (_, index) => ({
  wave: index < 5 ? index : null, left: 10, right: 10,
}));
let soundContext = null, scopeMode = 'waveform', scopeFrame = null;
let held = null, codeHandoff = Promise.resolve(), keys = new Map();
const fretboard = createFretboardState();
const editingTarget = 'input, textarea, select, [contenteditable]';
const canWrite = () => soundContext !== null && soundContext === audio.context;

code.value = `const vsu = await useSoundChip("vsu");
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
  if (settings.wave !== null) channelWave.value = settings.wave;
  byId('leftLevel').value = byId('leftValue').value = settings.left;
  byId('rightLevel').value = byId('rightValue').value = settings.right;
}

function sendChannelLevels(index) {
  if (!canWrite()) return;
  const { left, right } = channels[index];
  chip.setVolume(index, left, right);
}

async function ensureVsu() {
  await audio.ensureReady();
  if (!canWrite()) {
    banks.forEach((wave, bank) => chip.setWave(bank, wave));
    channels.forEach(({ wave, left, right }, channel) => {
      chip.write(vsuChannelRegister(channel, VSU_REGISTERS.EV0), 0xf0);
      chip.setVolume(channel, left, right);
      if (wave !== null) chip.setWaveBank(channel, wave);
    });
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
  onLog(line) { codeOutput.textContent = (codeOutput.textContent + line + '\n').slice(-12000); },
  onState(state) {
    status.textContent = state.status;
    run.disabled = state.busy;
    apply.disabled = !state.running || state.busy;
    stop.disabled = !state.running || state.stopping;
  },
  stopSoundChips() { if (canWrite()) chip.allNotesOff(); },
});

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
  releaseKeyboard();
  const voice = { owner, button, channel: Number(channelSelect.value), started: false };
  held = voice;
  button.classList.add('is-held');
  button.setAttribute('aria-pressed', 'true');
  try {
    if (runtime.getState().running) codeHandoff = runtime.stop();
    await codeHandoff;
    await ensureVsu();
    if (held !== voice) return;
    const wave = channels[voice.channel].wave;
    sendChannelLevels(voice.channel);
    if (wave !== null) chip.setWaveBank(voice.channel, wave);
    else chip.write(vsuChannelRegister(voice.channel, VSU_REGISTERS.EV1), selectedNoiseTap << 4);
    chip.noteOn(voice.channel, entry.midi);
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
  const mode = settings.wave === null ? 'Noise' : index === 4 ? 'Wave / Sweep' : 'Wave';
  option.textContent = 'CH' + (index + 1) + ' · ' + mode;
  channelSelect.append(option);
}
for (let tap = 0; tap < 8; tap += 1) noiseTap.add(new Option(String(tap), String(tap)));
noiseTap.addEventListener('change', () => {
  selectedNoiseTap = Number(noiseTap.value);
  if (canWrite()) chip.write(vsuChannelRegister(5, VSU_REGISTERS.EV1), selectedNoiseTap << 4);
});
channelSelect.addEventListener('change', () => {
  releaseKeyboard();
  channelSettings();
});
channelWave.addEventListener('change', () => {
  const index = Number(channelSelect.value), wave = Number(channelWave.value);
  channels[index].wave = wave;
  if (canWrite()) chip.setWaveBank(index, wave);
});
for (const side of ['left', 'right']) {
  const control = byId(side + 'Level'), output = byId(side + 'Value');
  control.addEventListener('input', () => {
    const index = Number(channelSelect.value);
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
for (const button of inputs) button.addEventListener('click', () => {
  showMode(inputs, button.id);
  const showCode = button === inputs[1];
  byId('codePanel').hidden = !showCode;
  byId('keyboardPanel').hidden = showCode;
  if (showCode) releaseKeyboard();
});
async function execute(isApply) {
  releaseKeyboard();
  if (!isApply) codeOutput.textContent = '';
  try {
    await (isApply ? runtime.apply(code.value) : runtime.run(code.value));
  } catch (error) {
    if (error.name !== 'AbortError' && runtime.getState().state !== 'error') status.textContent = error.message;
  }
}
run.addEventListener('click', () => void execute(false));
apply.addEventListener('click', () => void execute(true));
stop.addEventListener('click', () => void runtime.stop());

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
  if (document.hidden) releaseKeyboard();
  else scheduleScope();
});
new ResizeObserver(drawOutput).observe(outputCanvas);
new ResizeObserver(drawWaveRam).observe(waveCanvas);

channelSettings();
showSample();
redrawKeyboard();
drawOutput();
