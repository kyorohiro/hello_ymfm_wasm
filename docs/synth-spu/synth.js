// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createSpuAudio} from './spu_synth_audio.js?v=spu-master-200-1';
import {createSpuInstrumentPanel} from './spu_synth_panel.js?v=spu-keyboard-wheels-1';
import {createSpuOutputVisualizer} from './spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard, setInstrument, setFretPosition, setStringWindowIndex} from '../synth/synth_keyboard.js';
import {createOfflineAudioDecoder} from '../js/audio_decode.js';
import {readSpuInstrument, writeSpuInstrument, prepareAudioPcm, MAX_INSTRUMENT_BYTES} from './spu_synth_instrument.js';

import {MAX_AUDIO_FILE_BYTES, prepareHostAudio} from './spu_synth_long_audio.js';
import {MAX_VAB_FILE_BYTES, readVab, prepareVabTone} from './spu_synth_vab.js';
import {PSF_FILES, readPsfFileSet, extractPsfVabs, psfRejectionSummary} from '../playground/playground_ps1_psf.js';

const $ = id => document.getElementById(id);
const status = (message, error = false) => { $('audioStatus').textContent = message; $('audioStatus').dataset.error = String(error); };
const sampleStatus = (message, error = false) => {status(message,error);$('sampleLoadStatus').textContent=message;$('sampleLoadStatus').dataset.error=String(error);};
const report = error => status(error?.message ?? String(error), true);
let audio = null, opening = null, state = null, stateFrame = null, epoch = 0, assetEpoch = 0, octave = 0, bend = 0;
const notes = new Map();
let instrumentName = 'Sine';
let noteSequence = 0, topologyPending = 0;
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
    $('sampleName').textContent = state.hostAudio ? `${instrumentName} · Software audio · ${state.hostAudio.duration.toFixed(1)} s · ${state.hostAudio.loop ? 'loop' : 'one shot'}` : `${instrumentName}${sample ? ` · ${sample.byteLength.toLocaleString()} ADPCM bytes · ${sample.loop ? 'loop' : 'one shot'}` : ''}`;
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
  if (changesTopology) topologyPending++;
  const commandEpoch = epoch;
  let result;
  try {
    result = await engine.command(method, args);
    // The worklet validates before stopping voices. Preserve note owners when
    // it rejects the change, so their later key-up can still release them.
    if (changesTopology && audio===engine && commandEpoch===epoch) {epoch++;notes.clear();updateKeys();}
  } finally {if(changesTopology)topologyPending--;}

  // A live edit may expose a release/reverb tail after the display slept.
  // Monitoring remains passive, and an intervening Stop cancels this wake.
  if (method.startsWith('set') && commandEpoch === epoch) visualizer.wake();
  return result;
}
const panel = createSpuInstrumentPanel({
  root:$('spuVoicePanel'), morphPerformanceRoot:document, invoke, ensureAudioReady:ensureAudio, onError:report,
});
$('monitorEnvelopeMount').append(rmsCanvas);
const editorTabs = [...document.querySelectorAll('[data-spu-editor-tab]')];
function selectEditorTab(name, focus = false) {
  const selected = editorTabs.find(button => button.dataset.spuEditorTab === name);
  if (!selected) return;
  panel.setSection(name);
  $('instrumentPanel-audio').hidden = name !== 'audio';
  $('instrumentPanel-bank').hidden = name !== 'bank';
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
  const node = document.createElement('div');
  node.className = `fretboard-${name} ${['fret', 'strings'].includes(name) ? 'fret-display' : 'toolbar-group'}`;
  return [name, node];
}));
const summary = document.createElement('div'); summary.className = 'fretboard-row fretboard-summary';
summary.append(keyboardTools.fret, keyboardTools.strings);
const choices = document.createElement('div'); choices.className = 'fretboard-row';
for (const name of ['instrument', 'position', 'window']) {
  if (choices.childElementCount) {const divider = document.createElement('span'); divider.className = 'toolbar-divider'; divider.textContent = '|'; divider.setAttribute('aria-hidden', 'true'); choices.append(divider);}
  choices.append(keyboardTools[name]);
}
toolbar.append(summary, choices);
$('keyboardFretboard').append(toolbar);
$('keyboardMount').append(keyboard);
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
  if (topologyPending) return;
  if (notes.get(source)?.released) release(source, true);
  if (notes.has(source)) return;
  const note = {key:entry.key, midi:entry.midi, channel:null, id:`spu-synth:${++noteSequence}`, epoch, started:false};
  notes.set(source, note); updateKeys();
  try {
    await ensureAudio();
    if (note.epoch !== epoch || notes.get(source) !== note) return;
    if(topologyPending){notes.delete(source);updateKeys();return;}
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
// Native select popups can consume keys before document handlers see them.
// Return pointer users to performance focus once a choice is committed; keep
// focus for keyboard navigation so arrows and Tab remain usable.
let pointerSelect = null;
document.addEventListener('pointerdown', event => {
  pointerSelect = event.target?.closest?.('select') ?? null;
}, {capture:true});
document.addEventListener('change', event => {
  const select = event.target?.closest?.('select');
  if (select && select === pointerSelect) {pointerSelect = null; select.blur();}
}, {capture:true});
document.addEventListener('keydown', event => {
  if (event.target?.closest?.('select') && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End',' ','Enter','Escape','Tab'].includes(event.key)) pointerSelect = null;
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
function applyBend(value = Number($('pitchBend').value)) {
  bend = value;
  for (const id of ['pitchBend', 'keyboardPitchBend']) $(id).value = String(bend);
  for (const id of ['pitchValue', 'keyboardPitchValue']) $(id).textContent = `${bend > 0 ? '+' : ''}${bend.toFixed(2)} st`;
  if (bendFrame !== null) return;
  bendFrame = requestAnimationFrame(() => {
    bendFrame = null;
    if (audio) void invoke('setInstrumentPitchBend', [bend]).catch(report);
  });
}
function resetBend() {applyBend(0);}
for (const id of ['pitchBend', 'keyboardPitchBend']) {
  $(id).addEventListener('input', event => applyBend(Number(event.currentTarget.value)));
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) $(id).addEventListener(event, resetBend);
}
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
  $('masterVolume').dataset.boosted = String(value > 1);
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
  const operation = beginAssetOperation();
  preparation?.cancel();
  const rootNote = Number($('sampleRootNote').value), loop = $('sampleLoop').checked;
  try {
    if (!Number.isInteger(rootNote) || rootNote < 0 || rootNote > 127) throw new RangeError('Root MIDI note must be 0–127');
    if (file.size > MAX_AUDIO_FILE_BYTES) throw new RangeError('Choose an audio file smaller than 32 MiB');
    sampleStatus('Opening audio…');
    const engine = await ensureAudio(); sampleStatus('Decoding audio…');
    const buffer = await decodeAudio(await file.arrayBuffer());
    if (operation !== assetEpoch) return;
    const current = await engine.inspect(), maxBytes = 524288 - current.nextAddress;
    const useHost=Math.ceil(buffer.length/28)*16 > maxBytes;
    const prepared=useHost ? {pcm:prepareHostAudio(buffer),trimmedFrames:0} : prepareAudioPcm(buffer, {loop, maxBytes});
    sampleStatus(useHost ? 'Preparing Software audio…' : 'Encoding SPU ADPCM…');
    const encoded = useHost ? null : await encodeInWorker(prepared.pcm, {loopStartSamples:prepared.loopStartSamples, maxBytes});
    if (operation !== assetEpoch) return;
    await stop();
    if (operation !== assetEpoch) return;
    if (useHost) await engine.command('loadHostPCM',[prepared.pcm,{baseFrequencyHz:440*2**((rootNote-69)/12),loop}]);
    else {
      const sample = await engine.command('loadADPCM', [encoded.adpcm, {rootNote, ...(loop ? {loopStartSamples:0} : {})}]);
      if (operation !== assetEpoch) return;
      await engine.command('setInstrumentPreset', [{sample}]);
    }
    if (operation !== assetEpoch) return;
    instrumentName = file.name.slice(0, 80); $('instrumentName').value = instrumentName;
    sampleStatus(`Loaded ${file.name} · ${useHost ? 'Software audio · ' : ''}root ${noteName(rootNote)}${prepared.trimmedFrames ? ` · trimmed ${prepared.trimmedFrames} frames for the loop boundary` : ''}.`);
    applyState(await engine.inspect());
  } catch (error) {if (operation === assetEpoch && error.name !== 'AbortError') sampleStatus(error.message,true);}
});

function download(name, contents) {
  const url = URL.createObjectURL(new Blob([contents], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
let vabBank = null, vabName = '', vabSamples = new Map(), bankChoices = [], psfSet = null, bankReadController = null;
const vabStatus = (message, error=false) => { $('vabStatus').textContent=message; $('vabStatus').dataset.error=String(error); };
function updateBankControls() {
  const busy=Boolean(bankReadController);
  $('psfEntry').disabled=$('extractPsf').disabled=busy||!psfSet;
  $('vabBank').disabled=busy||!bankChoices.length;
  $('vabTone').disabled=busy||!vabBank;
  $('loadVabTone').disabled=busy||!vabBank||$('vabTone').value==='';
}
function beginAssetOperation() {
  const reading=Boolean(bankReadController);
  bankReadController?.abort(); bankReadController=null;
  if (reading) vabStatus('Sound bank operation cancelled.');
  updateBankControls();
  return ++assetEpoch;
}
function chooseBank(index) {
  const choice=bankChoices[index]; if (!choice) return;
  vabBank=choice.bank; vabName=choice.name; vabSamples=choice.samples;
  const availability=new Map(); let first=null;
  $('vabTone').replaceChildren(...vabBank.tones.map((tone,index)=>{
    if (!availability.has(tone.sample)) {
      try {prepareVabTone(vabBank,index); availability.set(tone.sample,'');}
      catch (error) {availability.set(tone.sample,error.message);}
    }
    const reason=availability.get(tone.sample);
    const option=new Option(`Program ${tone.program} · Tone ${tone.index} · Sample ${tone.sample} · ${noteName(tone.center)} +${tone.shift}/128 st · keys ${tone.keyLow}–${tone.keyHigh}${reason?' · unavailable':''}`,String(index));
    option.disabled=Boolean(reason); if (reason) option.title=reason; else first??=index;
    return option;
  }));
  $('vabTone').value=first===null?'':String(first); updateBankControls();
}
function showBanks(choices) {
  bankChoices=choices.map(choice=>({...choice,samples:new Map()}));
  $('vabBank').replaceChildren(...choices.map((choice,index)=>new Option(choice.name,String(index))));
  $('vabBank').value='0'; chooseBank(0);
}
$('vabBank').addEventListener('change',()=>{beginAssetOperation();chooseBank(Number($('vabBank').value));});
$('vabTone').addEventListener('change',()=>{beginAssetOperation();updateBankControls();});
$('psfEntry').addEventListener('change',()=>beginAssetOperation());
$('loadPsf').addEventListener('click',()=>$('psfFileInput').click());
$('loadPsfFolder').addEventListener('click',()=>$('psfFolderInput').click());
async function openPsf(input,isFolder) {
  const selected=[...input.files]; input.value=''; if (!selected.length) return;
  const operation=beginAssetOperation(); preparation?.cancel();
  bankReadController=new AbortController(); const signal=bankReadController.signal;
  updateBankControls(); vabStatus('Reading PSF set…');
  try {
    const next=await readPsfFileSet(isFolder?selected.filter(file=>PSF_FILES.test(file.name)):selected,{signal});
    if (operation!==assetEpoch) return;
    psfSet=next;
    $('psfEntry').replaceChildren(...next.entries.map(entry=>new Option(`${entry.path}${entry.title?` · ${entry.title}`:''}`,entry.path)));
    vabStatus(`Opened ${next.records.size} PSF/library files. Choose a PSF entry and Extract VAB banks. Current instrument is kept.`);
  } catch (error) {if (operation===assetEpoch && error.name!=='AbortError') vabStatus(error.message,true);}
  finally {if (operation===assetEpoch) {bankReadController=null;updateBankControls();}}
}
$('psfFileInput').addEventListener('change',()=>openPsf($('psfFileInput'),false));
$('psfFolderInput').addEventListener('change',()=>openPsf($('psfFolderInput'),true));
$('extractPsf').addEventListener('click',async()=>{
  if (!psfSet || bankReadController) return;
  const operation=beginAssetOperation(), entry=$('psfEntry').value;
  preparation?.cancel(); bankReadController=new AbortController(); const signal=bankReadController.signal;
  updateBankControls(); vabStatus('Expanding PSF libraries and searching for VAB banks…');
  try {
    const result=await extractPsfVabs(psfSet,entry,{signal});
    if (operation!==assetEpoch) return;
    if (!result.banks.length) {
      vabStatus(`No standard VAB found in ${entry}. Separate VH/VB layouts, custom or runtime-packed banks need further support.${psfRejectionSummary(result)}${vabBank?' Previous bank is kept.':''}`);
      return;
    }
    showBanks(result.banks.map(found=>({bank:found.bank,name:`${entry} · VAB @0x${(0x80000000+found.address).toString(16)}`})));
    vabStatus(`Extracted ${result.banks.length} VAB banks from ${entry} (${result.loadedFiles.length} program overlays). Choose a bank and Tone, then load it.${psfRejectionSummary(result)}`);
  } catch (error) {if (operation===assetEpoch && error.name!=='AbortError') vabStatus(error.message,true);}
  finally {if (operation===assetEpoch) {bankReadController=null;updateBankControls();}}
});
$('loadVab').addEventListener('click', () => $('vabFileInput').click());
$('vabFileInput').addEventListener('change', async () => {
  const files = [...$('vabFileInput').files]; $('vabFileInput').value='';
  if (!files.length) return;
  const operation=beginAssetOperation(); preparation?.cancel();
  bankReadController=new AbortController(); updateBankControls();
  try {
    if (files.some(file => file.size > MAX_VAB_FILE_BYTES)) throw new RangeError('Each VAB / VH / VB file must be at most 1 MiB');
    let header, body;
    if (files.length===1 && !/\.vb$/i.test(files[0].name)) header=files[0];
    else if (files.length===2) {header=files.find(file => /\.vh$/i.test(file.name)); body=files.find(file => /\.vb$/i.test(file.name));}
    if (!header || files.length>1 && !body) throw new TypeError('Choose one VAB file, or one VH and one matching VB together');
    vabStatus('Reading sound bank…');
    const [vh, vb] = await Promise.all([header.arrayBuffer(), body?.arrayBuffer()]);
    const bank = readVab(vh, vb);
    if (operation!==assetEpoch) return;
    showBanks([{bank,name:header.name}]);
    vabStatus(`${vabName}: ${bank.programs.length} programs · ${bank.tones.length} tones · ${bank.samples.length} samples. Choose a Tone and load it.`);
  } catch (error) {if (operation===assetEpoch) vabStatus(`${error.message}${vabBank ? ' Previous bank is kept.' : ''}`,true);}
  finally {if (operation===assetEpoch) {bankReadController=null;updateBankControls();}}
});
$('loadVabTone').addEventListener('click', async () => {
  if (!vabBank || bankReadController || $('vabTone').value==='') return;
  const operation=beginAssetOperation(), bank=vabBank, cache=vabSamples, name=vabName, index=Number($('vabTone').value);
  preparation?.cancel();
  try {
    // Validate bytes/tuning before stopping or changing the current sound.
    const prepared=prepareVabTone(bank,index), engine=await ensureAudio();
    if (operation!==assetEpoch) return;
    const current=await engine.inspect();
    if (operation!==assetEpoch) return;
    const key=`${prepared.tone.sample}:${prepared.options.baseFrequencyHz}`;
    const cached=cache.get(key);
    let sample=cached?.engine===engine ? cached.sample : null;
    if (!sample && prepared.adpcm.length > 524288-current.nextAddress) throw new RangeError('Tone exceeds free SPU sample RAM. Reload the page for a fresh bank.');
    await stop();
    if (operation!==assetEpoch) return;
    if (!sample) {
      sample=await engine.command('loadADPCM',[prepared.adpcm,prepared.options]);
      cache.set(key,{engine,sample});
      if (operation!==assetEpoch) return;
    }
    // Check the asset generation between messages, so a newer load/reset wins.
    for (const [method,args] of [
      ['setInstrumentPmon',[{enabled:false}]],
      ['setInstrumentNoise',[{enabled:false}]],
      ['setInstrumentMorph',[{enabled:false}]],
      ['setInstrumentPreset',[{...prepared.preset,sample}]],
    ]) {
      await engine.command(method,args);
      if (operation!==assetEpoch) return;
    }
    instrumentName=`${name} P${prepared.tone.program} T${prepared.tone.index}`.slice(0,80);
    $('instrumentName').value=instrumentName;
    const message=`Loaded ${instrumentName} · ${sample.byteLength} ADPCM bytes${prepared.trimmedBytes ? ` · ignored ${prepared.trimmedBytes} bytes after END` : ''}. Play the keyboard or save a preset.`;
    vabStatus(message); status(message); applyState(await engine.inspect());
  } catch (error) {if (operation===assetEpoch) {vabStatus(error.message,true); report(error);}}
});
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
  const operation = beginAssetOperation();
  preparation?.cancel();
  try {
    if (file.size > MAX_INSTRUMENT_BYTES) throw new RangeError('Instrument file exceeds 224 MiB');
    const instrument = readSpuInstrument(JSON.parse(await file.text()));
    if (operation !== assetEpoch) return;
    const engine = await ensureAudio();
    if (operation !== assetEpoch) return;
    const bank = await engine.inspect();
    if (operation !== assetEpoch) return;
    const requiredBytes=(instrument.waveform || instrument.version===2 ? 0 : instrument.sample.adpcm.length)+(instrument.pmon.enabled && !bank.pmonSampleReserved ? 64 : 0);
    if (requiredBytes > 524288 - bank.nextAddress) throw new RangeError('Instrument exceeds free SPU sample RAM. Reload for a fresh bank.');
    await stop();
    if (operation !== assetEpoch) return;
    let sample;
    if (instrument.waveform) await engine.command('setInstrumentWaveform', [instrument.waveform]);
    else if (instrument.version===2) {const {pcm,...options}=instrument.sample;await engine.command('loadHostPCM',[pcm,options]);}
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
  const operation = beginAssetOperation(); preparation?.cancel();
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
    await engine.command('setInstrumentMorph', [{enabled:true}]);
    await engine.command('setInstrumentPmon', [{enabled:false}]);
    instrumentName = 'Sine'; $('instrumentName').value = instrumentName;
    status('Instrument reset to Sine.'); applyState(await engine.inspect());
  } catch (error) {report(error);}
});
window.addEventListener('pagehide', event => {
  epoch++; beginAssetOperation(); preparation?.cancel(); releaseKeyboard(true); panel.setVisible(false);
  if (event.persisted) visualizer.stop(); else visualizer.dispose();
  if (audio) void audio.stop().catch(() => {});
});
renderKeyboard();
