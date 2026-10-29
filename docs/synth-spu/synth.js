// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createSpuAudio} from './spu_synth_audio.js';
import {createPlaygroundPs1VoicePanel} from '../playground/playground_ps1_voice_panel.js?v=ps1-deferred-release-1';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard, setInstrument, setFretPosition, setStringWindowIndex} from '../synth/synth_keyboard.js';
import {createOfflineAudioDecoder} from '../js/audio_decode.js';
import {readSpuInstrument, writeSpuInstrument, prepareAudioPcm, MAX_INSTRUMENT_BYTES} from './spu_synth_instrument.js';

const $ = id => document.getElementById(id);
const status = (message, error = false) => { $('audioStatus').textContent = message; $('audioStatus').dataset.error = String(error); };
const report = error => status(error?.message ?? String(error), true);
let audio = null, opening = null, state = null, stateFrame = null, epoch = 0, assetEpoch = 0, octave = 0, bend = 0;
const notes = new Map(), lastMidi = new Map(), names = Array(24).fill('Sine');
let noteSequence = 0;

function applyState(next) {
  state = next;
  if (stateFrame !== null) return;
  stateFrame = requestAnimationFrame(() => {
    stateFrame = null;
    panel.update(state);
    const ch = panel.getSelectedChannel(), sample = state.samples?.find(item => item.id === state.channels[ch].sample);
    $('sampleName').textContent = `${names[ch]}${sample ? ` · ${sample.byteLength.toLocaleString()} ADPCM bytes · ${sample.loop ? 'loop' : 'one shot'}` : ''}`;
  });
}
function audioFailed(error) {
  const failed = audio; epoch++; notes.clear(); lastMidi.clear(); updateKeys();
  // Release handlers must see the failed engine, rather than implicitly
  // creating a replacement while disconnecting this panel's note owners.
  panel.setConnected(false); $('startAudio').textContent = 'Enable audio';
  audio = null;
  $('refreshVoice').disabled = true;
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
        names.fill('Sine'); $('instrumentName').value = 'Sine';
        audio.setVolume(Number($('masterVolume').value));
        panel.setConnected(true);
        $('refreshVoice').disabled = false;
        applyState(audio.state);
        $('startAudio').textContent = 'Audio ready';
        status(restarting ? 'Audio restarted with Sine voices. Load a saved preset to restore an instrument.' : 'Audio ready. Play a key or hold a voice while editing.');
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
  if (method === 'auditionOn') {
    lastMidi.set(args[0], args[1]);
    args = [...args.slice(0, 3), bend];
  }
  return engine.command(method, args);
}
const panel = createPlaygroundPs1VoicePanel({
  root:$('spuVoicePanel'), invoke, ensureAudioReady:ensureAudio, onError:report,
  onSelectedChannelChange() {
    releaseKeyboard(true);
    $('instrumentName').value = names[panel.getSelectedChannel()];
  },
  onKeyboardTargetChange() { $('keyboardMount').scrollIntoView({behavior:'smooth', block:'nearest'}); },
});
// Keep the shared editor's controls, with copy appropriate to this application.
for (const node of $('spuVoicePanel').querySelectorAll('p')) {
  if (node.textContent.includes('Use Sample Editor for recordings')) node.textContent = node.textContent.replace('Use Sample Editor for recordings and longer samples.', 'Use Load audio above for recordings and longer samples.');
  if (node.textContent.startsWith('The original default waveform')) node.textContent = 'Every voice starts with an editable sine cycle. Load audio or draw a waveform, edit its ADSR, and play the selected voice below. Settings update after edits; no background inspection is running.';
  if (node.textContent.includes('Use transport Stop')) node.textContent = node.textContent.replace('Use transport Stop', 'Use Stop');
}

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
  const note = {key:entry.key, midi:entry.midi, channel:panel.getSelectedChannel(), id:`spu-synth:${++noteSequence}`, epoch, started:false};
  notes.set(source, note); updateKeys();
  try {
    await ensureAudio();
    if (note.epoch !== epoch || notes.get(source) !== note) return;
    note.started = true;
    await invoke('auditionOn', [note.channel, note.midi, note.id]);
    status(`${noteName(note.midi)} · Voice ${note.channel + 1}`);
  } catch (error) { if (notes.get(source) === note) notes.delete(source); updateKeys(); throw error; }
}
function release(source, force = false) {
  const note = notes.get(source); if (!note) return;
  if (!force && $('sustainToggle').checked) {note.released = true; return;}
  notes.delete(source); updateKeys();
  if (note.started && audio) void audio.command('auditionOff', [note.channel, note.id]).catch(report);
}
function releaseKeyboard(force = false) {for (const source of [...notes.keys()]) release(source, force);}
function editing(target) {
  const node = target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');
  return node && !node.matches('input[type=range]');
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {void stop().catch(report); return;}
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || editing(event.target)) return;
  const entry = layout.entries.find(value => value.key === event.key.toLowerCase()); if (!entry) return;
  event.preventDefault(); void press(`key:${event.code}`, {...entry, midi:entry.midi + octave * 12}).catch(report);
});
document.addEventListener('keyup', event => release(`key:${event.code}`));
window.addEventListener('blur', () => {releaseKeyboard(true); resetBend();});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {releaseKeyboard(true); panel.setVisible(false); resetBend();}
  else panel.setVisible(true);
});
$('sustainToggle').addEventListener('change', () => {if (!$('sustainToggle').checked) for (const [source, note] of notes) if (note.released) release(source, true);});
for (const [id, delta] of [['octaveDown', -1], ['octaveUp', 1]]) $(id).addEventListener('click', () => {releaseKeyboard(true); octave = Math.max(-2, Math.min(2, octave + delta)); renderKeyboard();});
let bendFrame = null;
function applyBend() {
  bend = Number($('pitchBend').value); $('pitchValue').textContent = `${bend > 0 ? '+' : ''}${bend.toFixed(2)} st`;
  if (bendFrame !== null) return;
  bendFrame = requestAnimationFrame(() => {
    bendFrame = null;
    const ch = panel.getSelectedChannel(), midi = lastMidi.get(ch);
    if (audio && midi !== undefined) void audio.command('setPitchBend', [ch, midi, bend]).catch(report);
  });
}
function resetBend() {$('pitchBend').value = '0'; applyBend();}
$('pitchBend').addEventListener('input', applyBend);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) $('pitchBend').addEventListener(event, resetBend);
$('startAudio').addEventListener('click', () => {void ensureAudio().catch(report);});
$('refreshVoice').addEventListener('click', () => {if (audio) void audio.inspect().catch(report);});
async function stop() {
  epoch++; notes.clear(); updateKeys(); panel.releaseAll();
  $('sustainToggle').checked = false;
  if (opening) {try {await opening;} catch {return;}}
  if (audio) await audio.stop();
  status('Stopped. Samples and settings are kept.');
}
$('stopAudio').addEventListener('click', () => {void stop().catch(report);});
$('allNotesOff').addEventListener('click', () => {
  releaseKeyboard(true); panel.releaseAll();
  if (audio) void audio.command('auditionAllOff').catch(report);
  $('sustainToggle').checked = false;
});
$('masterVolume').addEventListener('input', () => {
  const value = Number($('masterVolume').value);
  $('masterVolumeValue').textContent = `${Math.round(value * 100)}%`; audio?.setVolume(value);
});
$('instrumentName').addEventListener('change', () => {
  const ch = panel.getSelectedChannel(); names[ch] = $('instrumentName').value.trim() || 'Untitled';
  $('instrumentName').value = names[ch]; if (state) applyState(state);
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
  const operation = ++assetEpoch, ch = panel.getSelectedChannel();
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
    await engine.command('setPreset', [ch, {sample}]);
    if (operation !== assetEpoch) return;
    names[ch] = file.name.slice(0, 80); if (panel.getSelectedChannel() === ch) $('instrumentName').value = names[ch];
    status(`Loaded ${file.name} on Voice ${ch + 1} · root ${noteName(rootNote)}${prepared.trimmedFrames ? ` · trimmed ${prepared.trimmedFrames} frames for the loop boundary` : ''}.`);
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
    const engine = await ensureAudio(), ch = panel.getSelectedChannel(), name = $('instrumentName').value.trim() || 'Untitled';
    const instrument = writeSpuInstrument(name, await engine.command('getInstrument', [ch]));
    download(`${name.replace(/[^\p{L}\p{N}_. -]/gu, '_')}.spu.json`, JSON.stringify(instrument));
    status(`Saved ${name}, including its sample, ADSR and shared reverb settings.`);
  } catch (error) {report(error);}
});
$('loadPreset').addEventListener('click', () => $('presetFileInput').click());
$('presetFileInput').addEventListener('change', async () => {
  const file = $('presetFileInput').files[0]; $('presetFileInput').value = ''; if (!file) return;
  const operation = ++assetEpoch, ch = panel.getSelectedChannel();
  preparation?.cancel();
  try {
    if (file.size > MAX_INSTRUMENT_BYTES) throw new RangeError('Instrument file exceeds 4 MiB');
    const instrument = readSpuInstrument(JSON.parse(await file.text()));
    if (operation !== assetEpoch) return;
    const engine = await ensureAudio();
    if (operation !== assetEpoch) return;
    const bank = await engine.inspect();
    if (operation !== assetEpoch) return;
    if (!instrument.waveform && instrument.sample.adpcm.length > 524288 - bank.nextAddress) throw new RangeError('Instrument exceeds free SPU sample RAM. Reload for a fresh bank.');
    await stop();
    if (operation !== assetEpoch) return;
    let sample;
    if (instrument.waveform) sample = await engine.command('setWaveform', [ch, instrument.waveform]);
    else {const {adpcm, ...options} = instrument.sample; sample = await engine.command('loadADPCM', [adpcm, options]);}
    if (operation !== assetEpoch) return;
    await engine.command('setPreset', [ch, {...instrument.preset, sample}]);
    if (operation !== assetEpoch) return;
    await engine.command('setReverb', [instrument.reverb]);
    if (operation !== assetEpoch) return;
    names[ch] = instrument.name;
    if (panel.getSelectedChannel() === ch) $('instrumentName').value = instrument.name;
    status(`Loaded ${instrument.name} on Voice ${ch + 1}.`); applyState(await engine.inspect());
  } catch (error) {if (operation === assetEpoch) report(error);}
});
$('resetPreset').addEventListener('click', async () => {
  const ch = panel.getSelectedChannel(), operation = ++assetEpoch; preparation?.cancel();
  try {
    const engine = await ensureAudio();
    if (operation !== assetEpoch) return;
    await stop();
    if (operation !== assetEpoch) return;
    const pcm = Array.from({length:112}, (_, index) => .65 * Math.sin(2 * Math.PI * index / 112));
    const sample = await engine.command('setWaveform', [ch, pcm]);
    if (operation !== assetEpoch) return;
    await engine.command('setPreset', [ch, {sample, volumeLeft:.75, volumeRight:.75, adsr1:15, adsr2:0, pitch:4096, reverb:false}]);
    if (operation !== assetEpoch) return;
    names[ch] = 'Sine'; if (panel.getSelectedChannel() === ch) $('instrumentName').value = 'Sine';
    status(`Voice ${ch + 1} reset to Sine.`); applyState(await engine.inspect());
  } catch (error) {report(error);}
});
window.addEventListener('pagehide', () => {
  epoch++; ++assetEpoch; preparation?.cancel(); releaseKeyboard(true); panel.setVisible(false);
  if (audio) void audio.stop().catch(() => {});
});
renderKeyboard();
