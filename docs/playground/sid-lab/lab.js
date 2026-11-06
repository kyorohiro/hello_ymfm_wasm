// SPDX-License-Identifier: BSD-3-Clause
import {createSidAudio, defaultSidSettings} from './audio.js';

const $ = id => document.getElementById(id);
let settings = {...defaultSidSettings}, playing = null, busy = false, disposed = false;
let actionSequence = 0, settingsRevision = 0, view = 'waveform', animation = 0;
let audio, timeData, frequencyData;
const controls = new Map();

function setStatus(message, state = 'idle') {
  $('status').textContent = message;
  $('status').dataset.state = state;
}
function showError(error) {
  if (disposed) return;
  actionSequence++;busy = false;playing = null;
  setStatus(error?.message ?? String(error), 'error');renderControls();
}
try {audio = createSidAudio({onError:showError});} catch (error) {showError(error);}

function preventPointerFocus(element) {
  element.addEventListener('pointerdown', event => {if (event.button === 0) event.preventDefault();});
}
function numericControl({key, label, parent, min, max, step = 1, slider = true, display = String}) {
  const host = $(parent), labelElement = document.createElement('label');
  labelElement.className = 'field-label';labelElement.htmlFor = key;labelElement.textContent = label;
  const row = document.createElement('div');row.className = 'field-row';
  let input;
  if (slider) {
    input = document.createElement('input');input.type = 'range';input.id = key;
    input.min = String(min);input.max = String(max);input.step = String(step);
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => void changeSetting(key, Number(input.value)));
    row.append(input);
  }
  const stepper = document.createElement('div');stepper.className = 'stepper';
  const output = document.createElement('output');output.id = key + 'Value';
  output.tabIndex = 0;output.setAttribute('role', 'spinbutton');output.setAttribute('aria-label', label);
  output.setAttribute('aria-valuemin', String(min));output.setAttribute('aria-valuemax', String(max));
  if (!slider) {output.id = key;labelElement.htmlFor = key;}
  const buttons = [-1,1].map(delta => {
    const button = document.createElement('button');button.type = 'button';button.textContent = delta < 0 ? '−' : '+';
    button.dataset.stepperFor = key;button.dataset.stepperDelta = String(delta);
    button.setAttribute('aria-label', (delta < 0 ? 'Decrease ' : 'Increase ') + label);
    preventPointerFocus(button);
    button.addEventListener('click', () => adjust(Number(settings[key]) + delta * step));
    return button;
  });
  function adjust(value) {if (!busy && !disposed && (key !== 'pulseWidth' || settings.waveform === 'pulse')) void changeSetting(key, Math.max(min, Math.min(max, value)));}
  output.addEventListener('keydown', event => {
    const delta = ['ArrowRight','ArrowUp'].includes(event.key) ? step : ['ArrowLeft','ArrowDown'].includes(event.key) ? -step
      : event.key === 'PageUp' ? step * 10 : event.key === 'PageDown' ? -step * 10 : null;
    if (delta === null && !['Home','End'].includes(event.key)) return;
    event.preventDefault();adjust(event.key === 'Home' ? min : event.key === 'End' ? max : Number(settings[key]) + delta);
  });
  stepper.append(buttons[0], output, buttons[1]);row.append(stepper);host.append(labelElement, row);
  controls.set(key, {render() {
    const value = settings[key], disabled = busy || disposed || key === 'pulseWidth' && settings.waveform !== 'pulse';
    if (input) {input.value = String(value);input.disabled = disabled;}
    output.textContent = display(value);output.setAttribute('aria-valuenow', String(value));
    output.setAttribute('aria-disabled', String(disabled));output.tabIndex = disabled ? -1 : 0;
    buttons[0].disabled = disabled || value <= min;buttons[1].disabled = disabled || value >= max;
  }});
}

numericControl({key:'pulseWidth', label:'Pulse width · 12-bit code', parent:'pulseWidthField', min:0, max:4095, step:32});
for (const [key,label] of [['attack','Attack'],['decay','Decay'],['sustain','Sustain'],['release','Release']]) {
  const host = document.createElement('div');host.className = 'range-field';host.id = key + 'Field';$('envelopeFields').append(host);
  numericControl({key,label,parent:host.id,min:0,max:15,slider:false});
}
numericControl({key:'cutoff', label:'Cutoff · 11-bit code, not Hz', parent:'cutoffField', min:0, max:2047, step:1});
numericControl({key:'resonance', label:'Resonance · 4-bit code', parent:'resonanceField', min:0, max:15});
numericControl({key:'modulatorHz', label:'Silent modulator · Hz', parent:'modulatorHzField', min:1, max:2000});

function renderControls() {
  $('transportPanel').setAttribute('aria-busy', String(busy));
  for (const control of controls.values()) control.render();
  for (const button of document.querySelectorAll('[data-waveform]')) {
    button.setAttribute('aria-pressed', String(button.dataset.waveform === settings.waveform));button.disabled = busy || disposed;
  }
  for (const button of document.querySelectorAll('[data-filter-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.filterMode === settings.filterMode));button.disabled = busy || disposed;
  }
  for (const button of document.querySelectorAll('[data-clock-hz]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.clockHz) === settings.clockHz));button.disabled = busy || disposed;
  }
  for (const key of ['sync','ring']) {$(key).setAttribute('aria-pressed', String(settings[key]));$(key).disabled = busy || disposed;}
  $('master').value = String(Math.round(settings.master * 100));$('master').disabled = busy || disposed;
  $('masterValue').textContent = Math.round(settings.master * 100) + '%';
  $('playTone').disabled = busy || disposed || !audio;
  $('playChord').disabled = busy || disposed || !audio || settings.sync || settings.ring;
  $('playChord').title = settings.sync || settings.ring ? 'Voice 3 is reserved as the modulator. Turn Sync and Ring off to play the triad.' : 'Play a software-triggered three-voice test chord.';
  $('playTone').setAttribute('aria-pressed', String(playing === 'tone'));
  $('playChord').setAttribute('aria-pressed', String(playing === 'chord'));
  $('releaseGate').disabled = busy || disposed || !playing;
  $('stopAudio').disabled = disposed || !audio || !busy && !playing && !audio.context;
  $('gateState').textContent = busy ? 'Preparing…' : playing === 'tone' ? 'Gate on · Voice 1' : playing === 'chord' ? 'Gate on · 3 voices' : 'Gate off';
  const modes = {off:'Off sends the dry voices. Choose a mode, then move Cutoff while the sound is held.',
    lowpass:'Low-pass keeps lower frequencies. Move Cutoff to hear the bright harmonics change.',
    bandpass:'Band-pass keeps a band around the cutoff region. Resonance changes its emphasis.',
    highpass:'High-pass keeps higher frequencies. Move Cutoff to change the low-frequency reduction.',
    notch:'Notch combines low-pass and high-pass. It changes the band between them.'};
  $('filterHint').textContent = modes[settings.filterMode];
  $('modulationHint').textContent = settings.ring && settings.waveform !== 'triangle'
    ? 'Ring is on; choose Triangle to hear its effect. Voice 3 is a silent modulator, so the triad is unavailable. Sync can also reset Voice 1’s oscillator from Voice 3.'
    : 'Sync resets Voice 1’s oscillator from Voice 3. Ring affects Triangle. The modulator is silent; using it reserves Voice 3 and disables the triad.';
}

async function changeSetting(key, value) {
  if (disposed || busy || settings[key] === value) return;
  const previous = settings, revision = ++settingsRevision;
  const clockChanged = key === 'clockHz', reservesModulator = ['sync','ring'].includes(key) && value && playing === 'chord';
  const token = clockChanged || reservesModulator ? ++actionSequence : actionSequence;
  settings = {...settings, [key]:value};
  if (clockChanged || reservesModulator) {busy = true;playing = null;}
  renderControls();
  try {
    if (reservesModulator) await audio?.stop();
    await audio?.setSettings({...settings});
    if (disposed || token !== actionSequence) return;
    if (clockChanged) setStatus('Clock changed · sound stopped. Play again to use the new clock.');
    else if (reservesModulator) setStatus('Voice 3 is reserved for modulation. Play a tone to try it.');
  } catch (error) {if (revision === settingsRevision) settings = previous;showError(error);}
  finally {if (token === actionSequence) busy = false;renderControls();}
}

async function play(kind) {
  if (busy || disposed || !audio || kind === 'chord' && (settings.sync || settings.ring)) return;
  const token = ++actionSequence;busy = true;playing = null;renderControls();
  setStatus('Preparing SID audio…', 'busy');
  try {
    await audio.start();
    if (disposed || token !== actionSequence) return;
    await audio.setSettings({...settings});
    if (disposed || token !== actionSequence) return;
    if (kind === 'tone') await audio.playTone(220);else await audio.playChord();
    if (disposed || token !== actionSequence) return;
    playing = kind;setStatus(kind === 'tone' ? '220 Hz · gate held. Change the controls while it plays.' : 'Three-voice test triad · gates held. All voices share one filter.', 'playing');
  } catch (error) {if (token === actionSequence) showError(error);}
  finally {if (token === actionSequence) busy = false;renderControls();}
}
async function releaseGate() {
  if (disposed || busy || !playing) return;
  const token = ++actionSequence;playing = null;renderControls();
  try {await audio.release();if (token === actionSequence) setStatus('Gate released · the hardware Release envelope continues.');}
  catch (error) {showError(error);}
}
async function stop() {
  if (disposed || !audio) return;
  const token = ++actionSequence;busy = false;playing = null;renderControls();
  try {await audio.stop();if (token === actionSequence) setStatus('Stopped · settings kept. Play a tone or triad to start again.');}
  catch (error) {showError(error);}
}

$('playTone').addEventListener('click', () => void play('tone'));
$('playChord').addEventListener('click', () => void play('chord'));
$('releaseGate').addEventListener('click', () => void releaseGate());
$('stopAudio').addEventListener('click', () => void stop());
for (const button of document.querySelectorAll('[data-waveform]')) button.addEventListener('click', () => void changeSetting('waveform', button.dataset.waveform));
for (const button of document.querySelectorAll('[data-filter-mode]')) button.addEventListener('click', () => void changeSetting('filterMode', button.dataset.filterMode));
for (const button of document.querySelectorAll('[data-clock-hz]')) button.addEventListener('click', () => void changeSetting('clockHz', Number(button.dataset.clockHz)));
for (const key of ['sync','ring']) $(key).addEventListener('click', () => void changeSetting(key, !settings[key]));
$('master').addEventListener('input', () => void changeSetting('master', Number($('master').value) / 100));
for (const button of document.querySelectorAll('button')) preventPointerFocus(button);

const canvas = $('outputCanvas'), context = canvas.getContext('2d');
function setView(value) {
  view = value;
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  canvas.setAttribute('aria-label', 'Live SID output ' + view);
  $('monitorCaption').textContent = value === 'spectrum' ? 'Frequency spectrum · output after software level control.' : 'Output after software level control.';
  draw();
}
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view));

function draw() {
  if (!context || disposed || !canvas.clientWidth || !canvas.clientHeight) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1), width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {canvas.width = Math.round(width * ratio);canvas.height = Math.round(height * ratio);}
  context.setTransform(ratio,0,0,ratio,0,0);context.fillStyle = '#101c21';context.fillRect(0,0,width,height);
  const left = 43, right = width - 12, top = 12, bottom = height - 24, plotWidth = right - left, plotHeight = bottom - top;
  context.font = '10px system-ui';context.fillStyle = '#aac7cd';context.strokeStyle = '#2d454e';context.lineWidth = 1;
  for (const fraction of [0,.5,1]) {const y = top + fraction * plotHeight;context.beginPath();context.moveTo(left,y);context.lineTo(right,y);context.stroke();context.fillText(view === 'waveform' ? String(1 - fraction * 2) : String(-fraction * 100),4,y+3);}
  const analyser = audio?.analyser, rate = Number.isFinite(audio?.sampleRate) && audio.sampleRate > 0 ? audio.sampleRate : 44100;
  $('audioInfo').textContent = analyser ? rate.toLocaleString('en-US') + ' Hz · ' + settings.clockHz.toLocaleString('en-US') + ' clocks/s' : 'Audio idle';
  if (analyser) {
    if (!timeData || timeData.length !== analyser.fftSize) timeData = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(timeData);
  }
  let rms = 0;
  if (analyser && timeData) {for (const value of timeData) rms += value * value;rms = Math.sqrt(rms / timeData.length);}
  $('levelReadout').textContent = rms > 0 ? Math.max(-100,20 * Math.log10(rms)).toFixed(1) + ' dBFS' : '— dBFS';
  context.strokeStyle = '#72d8d3';context.lineWidth = 1.4;context.beginPath();
  if (view === 'waveform') {
    const values = analyser ? timeData : null, count = values?.length ?? 2;
    for (let index = 0; index < count; index++) {const x = left + index / (count - 1) * plotWidth, value = Math.max(-1,Math.min(1,values?.[index] ?? 0)), y = top + (1 - value) / 2 * plotHeight;if (!index) context.moveTo(x,y);else context.lineTo(x,y);}
    context.stroke();context.fillText('0 ms',left,height-7);
    context.textAlign = 'right';context.fillText(((timeData?.length ?? 2048) / rate * 1000).toFixed(1) + ' ms',right,height-7);context.textAlign = 'left';
  } else {
    if (analyser) {if (!frequencyData || frequencyData.length !== analyser.frequencyBinCount) frequencyData = new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(frequencyData);}
    const high = Math.min(16000,rate / 2), logRange = Math.log(high / 20);
    for (let x = 0; x <= plotWidth; x++) {const hz = 20 * Math.exp(x / plotWidth * logRange), bin = Math.min((frequencyData?.length ?? 1) - 1,Math.round(hz / (rate / 2) * (frequencyData?.length ?? 1))), db = analyser ? frequencyData[bin] : -100, y = top + (1 - Math.max(0,Math.min(1,(db + 100) / 100))) * plotHeight;if (!x) context.moveTo(left+x,y);else context.lineTo(left+x,y);}
    context.stroke();context.fillText('20 Hz',left,height-7);
    context.textAlign = 'center';for (const hz of [100,1000]) context.fillText(hz === 1000 ? '1 kHz' : '100 Hz',left+Math.log(hz/20)/logRange*plotWidth,height-7);
    context.textAlign = 'right';context.fillText((high/1000).toFixed(0) + ' kHz',right,height-7);context.textAlign = 'left';
  }
}
function frame() {if (disposed) return;if (!document.hidden) draw();animation = requestAnimationFrame(frame);}
window.addEventListener('resize', draw);
document.addEventListener('visibilitychange', () => {if (!document.hidden) draw();});
window.addEventListener('pagehide', () => {
  disposed = true;actionSequence++;cancelAnimationFrame(animation);
  try {void Promise.resolve(audio?.dispose()).catch(() => {});} catch {}
}, {once:true});
renderControls();draw();animation = requestAnimationFrame(frame);
