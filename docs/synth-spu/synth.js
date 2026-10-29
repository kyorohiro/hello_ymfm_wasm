// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createSpuAudio} from './spu_synth_audio.js';
import {createSpuInstrumentPanel} from './spu_synth_panel.js';
import {createSpuOutputVisualizer} from './spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard, setInstrument, setFretPosition, setStringWindowIndex} from '../synth/synth_keyboard.js';
import {createOfflineAudioDecoder} from '../js/audio_decode.js';
import {readSpuInstrument, writeSpuInstrument, prepareAudioPcm, MAX_INSTRUMENT_BYTES} from './spu_synth_instrument.js';

const $ = id => document.getElementById(id);
const status = (message, error = false) => { $('audioStatus').textContent = message; $('audioStatus').dataset.error = String(error); };
const report = error => status(error?.message ?? String(error), true);
let audio = null, opening = null, state = null, stateFrame = null, epoch = 0, assetEpoch = 0, octave = 0, bend = 0;
const notes = new Map();
let instrumentName = 'Sine';
let noteSequence = 0;
const rmsCanvas = document.createElement('canvas');
rmsCanvas.id = 'outputEnvelopeCanvas'; rmsCanvas.width = 900; rmsCanvas.height = 240;
rmsCanvas.setAttribute('role', 'img'); rmsCanvas.setAttribute('aria-label', 'Measured SPU output RMS history');
const visualizer = createSpuOutputVisualizer({canvas:$('outputCanvas'), envelopeCanvas:rmsCanvas});

function applyState(next) {
  state = next;
  visualizer.setRunning((next.auditions?.length ?? 0) > 0);
  if (stateFrame !== null) return;
  stateFrame = requestAnimationFrame(() => {
    stateFrame = null;
    panel.update(state);
    const sample = state.samples?.find(item => item.id === state.channels[0].sample);
    $('sampleName').textContent = `${instrumentName}${sample ? ` · ${sample.byteLength.toLocaleString()} ADPCM bytes · ${sample.loop ? 'loop' : 'one shot'}` : ''}`;
    $('voiceAllocationStatus').textContent = `${state.noise?.enabled ? '24 voices · Noise · shared clock' : state.pmon?.enabled ? '12 notes · paired PMON' : '24 voices · round robin'} · ${state.auditions?.length ?? 0} held`;
  });
}
function audioFailed(error) {
  const failed = audio; epoch++; notes.clear(); updateKeys();
  // Release handlers must see the failed engine, rather than implicitly
  // creating a replacement while disconnecting this panel's note owners.
  panel.setConnected(false); $('startAudio').textContent = 'Enable audio';
  visualizer.disconnect();
  audio = null;
  if (failed) void failed.dispose().catch(() => {});
  report(error);
}
async function ensureAudio() {
  if (!audio) {
    if (!opening) {
      const restarting = state !== null;
      $('startAudio').disabled = true;
      status('Preparing SPU…');
      opening = createSpuAudio({onState:applyState, onError:audioFailed}).then(value => {
        audio = value;
        instrumentName = 'Sine'; $('instrumentName').value = instrumentName;
        audio.setVolume(Number($('masterVolume').value));
        visualizer.connect(audio.context, audio.gain);
        panel.setConnected(true);
        applyState(audio.state);
        $('startAudio').textContent = 'Audio ready';
        status(restarting ? 'Audio restarted with Sine. Load a saved preset to restore an instrument.' : 'Audio ready. Play notes and edit the instrument.');
        return audio;
      }).catch(error => {
        $('startAudio').textContent = 'Enable audio';
        panel.setConnected(false);
        throw error;
      }).finally(() => {opening = null; $('startAudio').disabled = false;});
    }
    await opening;
  }
  await audio.resume();
  return audio;
}
async function invoke(method, args = []) {
  // Note owners have already awaited resume and checked their press token.
  // Do not yield again here: an Off/Stop must never overtake its pending On.
  const engine = audio ?? await ensureAudio();
  const changesTopology = method === 'setInstrumentPmon' && Boolean(state?.pmon?.enabled) !== args[0]?.enabled || method === 'setInstrumentNoise' && Boolean(state?.noise?.enabled) !== args[0]?.enabled;
  if (changesTopology) {epoch++; notes.clear(); updateKeys();}
  const commandEpoch = epoch;
  const result = await engine.command(method, args);
  // A live edit may expose a release/reverb tail after the display slept.
  // Monitoring remains passive, and an intervening Stop cancels this wake.
  if (method.startsWith('set') && commandEpoch === epoch) visualizer.wake();
  return result;
}
const panel = createSpuInstrumentPanel({
  root:$('spuVoicePanel'), morphPerformanceRoot:$('monitorMorph'), invoke, ensureAudioReady:ensureAudio, onError:report,
});
$('monitorEnvelopeMount').append(rmsCanvas);
const editorTabs = [...document.querySelectorAll('[data-spu-editor-tab]')];
function selectEditorTab(name, focus = false) {
  const selected = editorTabs.find(button => button.dataset.spuEditorTab === name);
  if (!selected) return;
  panel.setSection(name);
  $('instrumentPanel-audio').hidden = name !== 'audio';
  for (const button of editorTabs) {
    const active = button === selected;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  if (focus) selected.focus();
}
for (const [index, button] of editorTabs.entries()) {
  button.addEventListener('click', () => selectEditorTab(button.dataset.spuEditorTab));
  button.addEventListener('keydown', event => {
    let target;
    if (event.key === 'ArrowRight') target = (index + 1) % editorTabs.length;
    else if (event.key === 'ArrowLeft') target = (index + editorTabs.length - 1) % editorTabs.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = editorTabs.length - 1;
    else return;
    event.preventDefault();
    selectEditorTab(editorTabs[target].dataset.spuEditorTab, true);
  });
}
selectEditorTab('pcm');
const visualDescriptions = {
  envelope:'Live output level after Master volume. Open ADSR below to edit the instrument’s envelope.',
  waveform:'Live SPU output waveform after Master volume. Pitch bends sounding notes without restarting them.',
  spectrum:'Live SPU output spectrum after Master volume. Frequency increases from left to right.',
};
function setVisualMode(mode) {
  $('monitorEnvelopeMount').hidden = mode !== 'envelope';
  $('outputCanvas').hidden = mode === 'envelope';
  $('outputCanvas').setAttribute('aria-label', mode === 'spectrum' ? 'Live SPU output frequency spectrum' : 'Live SPU output waveform');
  $('visualizerDescription').textContent = visualDescriptions[mode];
  for (const button of document.querySelectorAll('[data-spu-visual-mode]')) button.setAttribute('aria-pressed', String(button.dataset.spuVisualMode === mode));
  visualizer.setMode(mode);
}
for (const button of document.querySelectorAll('[data-spu-visual-mode]')) button.addEventListener('click', () => setVisualMode(button.dataset.spuVisualMode));
setVisualMode('envelope');

const fret = createFretboardState(), keyboard = document.createElement('div');
keyboard.className = 'keyboard'; keyboard.id = 'keyboardKeys';
const toolbar = document.createElement('div'); toolbar.className = 'fretboard-toolbar';
const keyboardTools = Object.fromEntries(['instrument', 'position', 'fret', 'strings', 'window'].map(name => {
  const node = document.createElement('div'); node.className = `fretboard-${name}`; toolbar.append(node); return [name, node];
}));
$('keyboardMount').append(toolbar, keyboard);
let layout;
function renderKeyboard() {
  layout = createFretboardLayout({state:fret});
  renderFretboardControls({instrumentRoot:keyboardTools.instrument, positionRoot:keyboardTools.position,
    fretDisplayRoot:keyboardTools.fret, stringDisplayRoot:keyboardTools.strings, stringWindowRoot:keyboardTools.window,
    state:fret, onInstrumentChange(value) { releaseKeyboard(true); setInstrument(fret, value); renderKeyboard(); },
    onPositionPresetSelect(value) { releaseKeyboard(true); setFretPosition(fret, value); renderKeyboard(); },
    onStringWindowChange(value) { releaseKeyboard(true); setStringWindowIndex(fret, value); renderKeyboard(); }});
  const entries = layout.entries.map(entry => ({...entry, midi:entry.midi + octave * 12,
    noteName:noteName(entry.midi + octave * 12)}));
  buildKeyboard({root:keyboard, rowDefs:layout.rowDefs, layoutEntries:entries, showPitch:false,
    onPointerDown(event, entry) { if (event.button !== 0) return; void press(`pointer:${event.pointerId}`, entry).catch(report); },
    onPointerUp(event) { release(`pointer:${event.pointerId}`); },
    onPointerCancel(event) { release(`pointer:${event.pointerId}`, true); }});
  $('octaveValue').textContent = `${octave > 0 ? '+' : ''}${octave}`;
  $('octaveDown').disabled = octave <= -2; $('octaveUp').disabled = octave >= 2;
  updateKeys();
}
function noteName(midi) {return `${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;}
function updateKeys() {
  const keys = new Set([...notes.values()].map(note => note.key));
  for (const button of keyboard.querySelectorAll('.key')) {
    const active = keys.has(button.dataset.key);
    button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
  }
}
async function press(source, entry) {
  if (notes.get(source)?.released) release(source, true);
  if (notes.has(source)) return;
  const note = {key:entry.key, midi:entry.midi, channel:null, id:`spu-synth:${++noteSequence}`, epoch, started:false};
  notes.set(source, note); updateKeys();
  try {
    await ensureAudio();
    if (note.epoch !== epoch || notes.get(source) !== note) return;
    note.started = true;
    const allocation = await invoke('instrumentNoteOn', [note.midi, note.id, bend]);
    note.channel = allocation.channel;
    if (allocation.stolenId) for (const [oldSource, old] of notes) if (old.id === allocation.stolenId) notes.delete(oldSource);
    updateKeys();
    if (notes.get(source) === note) status(`${noteName(note.midi)} · ${state?.auditions?.length ?? notes.size} notes held`);
  } catch (error) { if (notes.get(source) === note) notes.delete(source); updateKeys(); throw error; }
}
function release(source, force = false) {
  const note = notes.get(source); if (!note) return;
  if (!force && $('sustainToggle').checked) {note.released = true; return;}
  notes.delete(source); updateKeys();
  if (note.started && audio) void audio.command('instrumentNoteOff', [note.id]).catch(report);
}
function releaseKeyboard(force = false) {
  if (force) {
    epoch++; notes.clear(); updateKeys();
    if (audio) void audio.command('instrumentAllNotesOff').catch(report);
  } else for (const source of [...notes.keys()]) release(source);
}
function editing(target) {
  const node = target?.closest?.('input,textarea,[contenteditable="true"],dialog[open]');
  return node && !node.matches('input[type=range],input[type=checkbox]');
}
document.addEventListener('keydown', event => {
  if (event.isComposing) return;
  const entryField=event.target?.closest?.('input[type=number],input[type=text]');
  if (event.key === 'Enter' && entryField) {event.preventDefault();entryField.blur();return;}
  if (event.key === 'Escape') {void stop().catch(report); return;}
  if (event.ctrlKey || event.metaKey || event.altKey || editing(event.target)) return;
  const entry = layout.entries.find(value => value.key === event.key.toLowerCase()); if (!entry) return;
  // Capture musical keys before a focused select can use type-ahead. Keep
  // arrows, Space and Tab available for normal control navigation. Repeats
  // are cancelled as well, without starting a second note.
  event.preventDefault();
  if (!event.repeat) void press(`key:${event.code}`, {...entry, midi:entry.midi + octave * 12}).catch(report);
}, {capture:true});
document.addEventListener('keyup', event => release(`key:${event.code}`));
window.addEventListener('blur', () => {releaseKeyboard(true); resetBend();});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {releaseKeyboard(true); panel.setVisible(false); resetBend();}
  else panel.setVisible(true);
  visualizer.setVisible(!document.hidden);
});
$('sustainToggle').addEventListener('change', () => {if (!$('sustainToggle').checked) for (const [source, note] of notes) if (note.released) release(source, true);});
for (const [id, delta] of [['octaveDown', -1], ['octaveUp', 1]]) $(id).addEventListener('click', () => {releaseKeyboard(true); octave = Math.max(-2, Math.min(2, octave + delta)); renderKeyboard();});
let bendFrame = null;
function applyBend() {
  bend = Number($('pitchBend').value); $('pitchValue').textContent = `${bend > 0 ? '+' : ''}${bend.toFixed(2)} st`;
  if (bendFrame !== null) return;
  bendFrame = requestAnimationFrame(() => {
    bendFrame = null;
    if (audio) void invoke('setInstrumentPitchBend', [bend]).catch(report);
  });
}
function resetBend() {$('pitchBend').value = '0'; applyBend();}
$('pitchBend').addEventListener('input', applyBend);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) $('pitchBend').addEventListener(event, resetBend);
$('startAudio').addEventListener('click', () => {void ensureAudio().catch(report);});
async function stop() {
  epoch++; notes.clear(); updateKeys(); panel.releaseAll();
  visualizer.stop();
  $('sustainToggle').checked = false;
  if (opening) {try {await opening;} catch {return;}}
  if (audio) await audio.stop();
  visualizer.stop();
  status('Stopped. Samples and settings are kept.');
}
$('stopAudio').addEventListener('click', () => {void stop().catch(report);});
$('allNotesOff').addEventListener('click', () => {
  releaseKeyboard(true); panel.releaseAll();
  $('sustainToggle').checked = false;
});
$('masterVolume').addEventListener('input', () => {
  const value = Number($('masterVolume').value);
  $('masterVolumeValue').textContent = `${Math.round(value * 100)}%`; audio?.setVolume(value);
  if (audio) visualizer.wake();
});
$('instrumentName').addEventListener('change', () => {
  instrumentName = $('instrumentName').value.trim() || 'Untitled';
  $('instrumentName').value = instrumentName; if (state) applyState(state);
});

const decodeAudio = createOfflineAudioDecoder({getSampleRate:() => 44100});
let preparation = null;
function encodeInWorker(pcm, options) {
  preparation?.cancel();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spu_synth_prepare_worker.js', import.meta.url), {type:'module'});
    const complete = (error, result) => {worker.terminate(); if (preparation?.worker === worker) preparation = null; error ? reject(error) : resolve(result);};
    preparation = {worker, cancel:() => complete(new DOMException('Sample preparation cancelled', 'AbortError'))};
    worker.onmessage = ({data}) => complete(data.error ? new Error(data.error) : null, data.result);
    worker.onerror = event => complete(new Error(event.message || 'Sample encoding failed'));
    worker.postMessage({pcm, options}, [pcm.buffer]);
  });
}
$('loadAudio').addEventListener('click', () => $('audioFileInput').click());
$('audioFileInput').addEventListener('change', async () => {
  const file = $('audioFileInput').files[0]; $('audioFileInput').value = ''; if (!file) return;
  const operation = ++assetEpoch;
  preparation?.cancel();
  const rootNote = Number($('sampleRootNote').value), loop = $('sampleLoop').checked;
  try {
    if (!Number.isInteger(rootNote) || rootNote < 0 || rootNote > 127) throw new RangeError('Root MIDI note must be 0–127');
    if (file.size > 32 * 1024 * 1024) throw new RangeError('Choose an audio file smaller than 32 MiB');
    const engine = await ensureAudio(); status('Decoding audio…');
    const buffer = await decodeAudio(await file.arrayBuffer());
    if (operation !== assetEpoch) return;
    const current = await engine.inspect(), maxBytes = 524288 - current.nextAddress;
    const prepared = prepareAudioPcm(buffer, {loop, maxBytes}); status('Encoding SPU ADPCM…');
    const encoded = await encodeInWorker(prepared.pcm, {loopStartSamples:prepared.loopStartSamples, maxBytes});
    if (operation !== assetEpoch) return;
    await stop();
    if (operation !== assetEpoch) return;
    const sample = await engine.command('loadADPCM', [encoded.adpcm, {rootNote, ...(loop ? {loopStartSamples:0} : {})}]);
    if (operation !== assetEpoch) return;
    await engine.command('setInstrumentPreset', [{sample}]);
    if (operation !== assetEpoch) return;
    instrumentName = file.name.slice(0, 80); $('instrumentName').value = instrumentName;
    status(`Loaded ${file.name} · root ${noteName(rootNote)}${prepared.trimmedFrames ? ` · trimmed ${prepared.trimmedFrames} frames for the loop boundary` : ''}.`);
    applyState(await engine.inspect());
  } catch (error) {if (operation === assetEpoch && error.name !== 'AbortError') report(error);}
});

function download(name, contents) {
  const url = URL.createObjectURL(new Blob([contents], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('savePreset').addEventListener('click', async () => {
  try {
    const engine = await ensureAudio(), name = $('instrumentName').value.trim() || 'Untitled';
    const instrument = writeSpuInstrument(name, await engine.command('getInstrument', [0]));
    download(`${name.replace(/[^\p{L}\p{N}_. -]/gu, '_')}.spu.json`, JSON.stringify(instrument));
    status(`Saved ${name}, including its sample, ADSR, PMON, Noise, Software morph and shared reverb settings.`);
  } catch (error) {report(error);}
});
$('loadPreset').addEventListener('click', () => $('presetFileInput').click());
$('presetFileInput').addEventListener('change', async () => {
  const file = $('presetFileInput').files[0]; $('presetFileInput').value = ''; if (!file) return;
  const operation = ++assetEpoch;
  preparation?.cancel();
  try {
    if (file.size > MAX_INSTRUMENT_BYTES) throw new RangeError('Instrument file exceeds 4 MiB');
    const instrument = readSpuInstrument(JSON.parse(await file.text()));
    if (operation !== assetEpoch) return;
    const engine = await ensureAudio();
    if (operation !== assetEpoch) return;
    const bank = await engine.inspect();
    if (operation !== assetEpoch) return;
    const requiredBytes=(instrument.waveform ? 0 : instrument.sample.adpcm.length)+(instrument.pmon.enabled && !bank.pmonSampleReserved ? 64 : 0);
    if (requiredBytes > 524288 - bank.nextAddress) throw new RangeError('Instrument exceeds free SPU sample RAM. Reload for a fresh bank.');
    await stop();
    if (operation !== assetEpoch) return;
    let sample;
    if (instrument.waveform) await engine.command('setInstrumentWaveform', [instrument.waveform]);
    else {const {adpcm, ...options} = instrument.sample; sample = await engine.command('loadADPCM', [adpcm, options]);}
    if (operation !== assetEpoch) return;
    await engine.command('setInstrumentPreset', [{...instrument.preset, ...(sample ? {sample} : {})}]);
    if (operation !== assetEpoch) return;
    await engine.command('setReverb', [instrument.reverb]);
    await engine.command('setInstrumentNoise', [instrument.noise]);
    await engine.command('setInstrumentPmon', [instrument.pmon]);
    await engine.command('setInstrumentMorph', [instrument.morph]);
    if (operation !== assetEpoch) return;
    instrumentName = instrument.name; $('instrumentName').value = instrumentName;
    status(`Loaded ${instrument.name}.`); applyState(await engine.inspect());
  } catch (error) {if (operation === assetEpoch) report(error);}
});
$('resetPreset').addEventListener('click', async () => {
  const operation = ++assetEpoch; preparation?.cancel();
  try {
    const engine = await ensureAudio();
    if (operation !== assetEpoch) return;
    await stop();
    if (operation !== assetEpoch) return;
    const pcm = Array.from({length:112}, (_, index) => .65 * Math.sin(2 * Math.PI * index / 112));
    await engine.command('setInstrumentWaveform', [pcm]);
    if (operation !== assetEpoch) return;
    await engine.command('setInstrumentPreset', [{volumeLeft:.75, volumeRight:.75, adsr1:15, adsr2:0, pitch:4096, reverb:false}]);
    if (operation !== assetEpoch) return;
    await engine.command('setInstrumentNoise', [{enabled:false}]);
    await engine.command('setInstrumentMorph', [{enabled:false}]);
    await engine.command('setInstrumentPmon', [{enabled:false}]);
    instrumentName = 'Sine'; $('instrumentName').value = instrumentName;
    status('Instrument reset to Sine.'); applyState(await engine.inspect());
  } catch (error) {report(error);}
});
window.addEventListener('pagehide', event => {
  epoch++; ++assetEpoch; preparation?.cancel(); releaseKeyboard(true); panel.setVisible(false);
  if (event.persisted) visualizer.stop(); else visualizer.dispose();
  if (audio) void audio.stop().catch(() => {});
});
renderKeyboard();
