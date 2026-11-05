// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js';
import {createEditor} from './editor.js';
import {createVgmLibrary} from './vgm_library.js';
import {createDefaultPreset, readPreset, presetToCode} from './preset.js';
import {createHardwareMonitor} from './hardware_monitor.js';
import {createStateObserver} from './state_observer.js';
import {createPanelLayout} from './panel_layout.js';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard,
  setInstrument, setFretPosition, setStringWindowIndex, midiToNoteName} from '../synth/synth_keyboard.js';

const $ = id => document.getElementById(id);
const status = (text, error = false) => {
  $('audioStatus').textContent = text;
  $('audioStatus').dataset.error = String(error);
};
const report = error => status(error?.message ?? String(error), true);
let audio = null, opening = null, disposed = false, epoch = 0, sequence = 0, importSequence = 0, switchingAudioOutput = false;
let preset = createDefaultPreset(), revision = 0, octave = 0, pitch = 0;
let clickGuardEnabled = $('clickGuardEnabled').checked;
let queue = Promise.resolve();
let vgmLibrary = null;
let panelLayout = null;
const notes = new Map(), fret = createFretboardState();
const pitchWheels = [[$('pitchBend'), $('pitchValue')], [$('keyboardPitchBend'), $('keyboardPitchValue')]];
const visualizer = createSpuOutputVisualizer({canvas: $('outputCanvas')});
visualizer.setMode('waveform');
const hardwareMonitor = createHardwareMonitor({root: $('hardwareMonitor')});
const hardwareObserver = createStateObserver({
  read: engine => engine.read(),
  onState(state, engine) {if (audio === engine && state?.preset?.source === preset.source) hardwareMonitor.update(state);},
  onStatus(mode) {
    if (mode === 'disposed') return;
    hardwareMonitor.setMode(!audio ? 'waiting' : mode);
  },
});
let observedContext = null;
function syncHardwareMonitor() {
  const visible = !document.hidden, running = audio?.context.state === 'running';
  const panelVisible = $('sourcePanel').open && $('hardwarePanel').open;
  const active = Boolean(!disposed && visible && running && panelVisible && !switchingAudioOutput && preset.source !== 'dmc' && [...notes.values()].some(note => note.started));
  hardwareObserver.update({engine:audio, active});
  if (!active) hardwareMonitor.setMode(!audio ? 'waiting' : !visible || !running || !panelVisible || switchingAudioOutput ? 'paused' : 'idle');
}
function watchHardwareContext(context) {
  observedContext?.removeEventListener('statechange', syncHardwareMonitor);
  observedContext = context;
  observedContext?.addEventListener('statechange', syncHardwareMonitor);
  syncHardwareMonitor();
}
const enqueue = action => {
  const task = queue.then(action);
  queue = task.catch(report);
  return task;
};
const capacity = () => preset.source === 'pulse' ? 2 : 1;
function updateKeys() {
  const keys = new Set([...notes.values()].map(note => note.key));
  for (const button of $('keyboard').querySelectorAll('.key')) {
    const active = keys.has(button.dataset.key);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  visualizer.setRunning(notes.size > 0 && $('monitorPanel').open);
  updateCapacity();
  syncHardwareMonitor();
}
function readVoices(state) {
  const owners = new Set(state.voices.map(voice => voice.id));
  for (const [source, note] of notes) if (note.started && !owners.has(note.id)) notes.delete(source);
  updateKeys();
  updateCapacity();
}
function updateCapacity() {
  const description = {pulse:'Pulse · CH1 / CH2',triangle:'Triangle · CH3',noise:'Noise · CH4 · keys trigger the same noise',dmc:'DMC · CH5 · keys trigger the same sample',fds:'FDS · waveform + modulation'}[preset.source];
  $('voiceCapacity').textContent = `${description} · ${capacity()} ${capacity() === 1 ? 'voice' : 'voices'} · round robin · ${notes.size} held`;
}
function updatePresetUi({resetDmcHistory = false} = {}) {
  hardwareMonitor.setSource(preset.source);
  editor.update(preset, {resetDmcHistory});
  if (document.activeElement !== $('instrumentName')) $('instrumentName').value = preset.name;
  if (!$('codeOutput').hidden) $('codeOutput').value = presetToCode(preset);
  for (const [wheel] of pitchWheels) wheel.disabled = ['noise', 'dmc'].includes(preset.source);
  updateCapacity();
  if (!layout || keyboardSource !== preset.source || preset.source === 'dmc' && keyboardHasDpcm !== Boolean(preset.dmc.data.length)) renderKeyboard();
  else updateKeys();
}
function audioFailed(error) {
  epoch++;
  notes.clear(); updateKeys();
  const failed = audio; audio = null;
  watchHardwareContext(null);
  visualizer.disconnect();
  if (failed) void failed.dispose().catch(() => {});
  $('startAudio').textContent = 'Enable audio';
  report(error);
}
async function ensureAudio() {
  if (disposed) throw new Error('2A03 Synth is closed');
  if (!audio && !opening) {
    $('startAudio').disabled = true;
    status('Preparing NES + FDS audio…');
    opening = (async () => {
      const engine = await createAudio({volume: Number($('masterVolume').value), onError: audioFailed});
      try {
        // Source edits remain available while WASM loads. Adopt the latest draft.
        let applied, appliedPitch, appliedClickGuard;
        do {
          applied = revision; appliedPitch = pitch; appliedClickGuard = clickGuardEnabled;
          await engine.command('loadPreset', [readPreset(preset)]);
          await engine.command('setPitch', [appliedPitch]);
          await engine.command('setClickGuard', [appliedClickGuard]);
        } while (applied !== revision || appliedPitch !== pitch || appliedClickGuard !== clickGuardEnabled);
        if (disposed) throw new Error('2A03 Synth is closed');
        engine.setVolume(Number($('masterVolume').value));
        audio = engine;
        watchHardwareContext(engine.context);
        visualizer.connect(engine.context, engine.outputNode);
        $('startAudio').textContent = 'Audio ready';
        status('Audio ready · play the keyboard. Choose Pulse, Triangle, Noise, DMC or FDS to explore.');
        return engine;
      } catch (error) {await engine.dispose(); throw error;}
    })().finally(() => {opening = null; $('startAudio').disabled = false;});
  }
  const engine = audio ?? await opening;
  await engine.resume();
  return engine;
}
function applyPreset(value, {load = false, message, fromVgm = false} = {}) {
  const next = readPreset(value);
  if (!fromVgm) vgmLibrary?.clearSelection();
  const previous = preset;
  const replacesVoices = load || previous.source !== next.source
    || JSON.stringify(previous.fds.wave) !== JSON.stringify(next.fds.wave)
    || JSON.stringify(previous.fds.modulation.table) !== JSON.stringify(next.fds.modulation.table)
    || JSON.stringify(previous.dmc.data) !== JSON.stringify(next.dmc.data);
  if (replacesVoices) {epoch++;notes.clear();updateKeys();}
  preset = next; revision++;
  const editRevision = revision;
  if (load || previous.source !== next.source) setPitchUi(0);
  updatePresetUi({resetDmcHistory:load});
  if (!audio) {status(message ?? 'Instrument updated · enable audio, then play.'); return Promise.resolve();}
  return enqueue(async () => {
    const engine = audio;
    if (!engine) return;
    try {
      await engine.command(load ? 'loadPreset' : 'setPreset', [next]);
      if (load || previous.source !== next.source) await engine.command('setPitch', [0]);
      const state = await engine.read();
      if (audio !== engine) return;
      readVoices(state);
      visualizer.wake();
      if (revision === editRevision) status(message ?? 'Instrument updated · play a new note to hear envelope and Sweep edits.');
    } catch (error) {
      if (audio === engine && revision === editRevision) {
        preset = (await engine.read()).preset;
        updatePresetUi();
      }
      throw error;
    }
  });
}
const editor = createEditor({
  root: $('voiceEditor'), onChange: value => {void applyPreset(value).catch(report);}, onError: report,
  onCompareDepth: value => applyPreset(value, {load:true,message:'Slow vibrato comparison ready · release and play a new key. Direction changes apply on the next note.'}),
  onSaveDpcm: data => {
    saveFile('2a03-sample.dmc', Uint8Array.from(data), 'application/octet-stream');
    status(`DPCM download started · ${data.length} bytes. Save preset to keep Rate, Loop and Initial level too.`);
  },
});
vgmLibrary = createVgmLibrary({root: $('vgmImport'), onSelect: value => applyPreset(value, {
  load: true, fromVgm: true, message: `${value.name} loaded from VGM · play the keyboard.`,
})});
panelLayout = createPanelLayout({root:document,
  onSourceHidden:() => editor.cancelDrawing(),
  onVisibilityChange() {syncHardwareMonitor();visualizer.setRunning(notes.size > 0 && $('monitorPanel').open);},
});


const keyboard = document.createElement('div'); keyboard.className = 'keyboard';
$('keyboard').append(keyboard);
const tools = Object.fromEntries(['instrument','position','fret','strings','window'].map(name => {
  const node = document.createElement('div');
  node.className = `fretboard-${name} ${['fret','strings'].includes(name) ? 'fret-display' : 'toolbar-group'}`;
  return [name,node];
}));
const toolbar = document.createElement('div'); toolbar.className = 'fretboard-toolbar';
const summary = document.createElement('div'); summary.className = 'fretboard-row fretboard-summary'; summary.append(tools.fret,tools.strings);
const choices = document.createElement('div'); choices.className = 'fretboard-row';
for (const name of ['instrument','position','window']) choices.append(tools[name]);
toolbar.append(summary,choices); $('keyboardFretboard').append(toolbar);
let layout, keyboardSource, keyboardHasDpcm;
function renderKeyboard() {
  {
    keyboardSource = preset.source;
    keyboardHasDpcm = Boolean(preset.dmc.data.length);
    layout = createFretboardLayout({state:fret});
    renderFretboardControls({instrumentRoot:tools.instrument,positionRoot:tools.position,fretDisplayRoot:tools.fret,
      stringDisplayRoot:tools.strings,stringWindowRoot:tools.window,state:fret,
      onInstrumentChange(value) {stopNotes();setInstrument(fret,value);renderKeyboard();},
      onPositionPresetSelect(value) {stopNotes();setFretPosition(fret,value);renderKeyboard();},
      onStringWindowChange(value) {stopNotes();setStringWindowIndex(fret,value);renderKeyboard();}});
    const entries = layout.entries.map(entry => ({...entry,midi:entry.midi+octave*12,noteName:midiToNoteName(entry.midi+octave*12)}));
    buildKeyboard({root:keyboard,rowDefs:layout.rowDefs,layoutEntries:entries,showPitch:false,
      onPointerDown(event,entry) {if (event.button===0) press(`pointer:${event.pointerId}`,entry);},
      onPointerUp(event) {release(`pointer:${event.pointerId}`);},onPointerCancel(event) {release(`pointer:${event.pointerId}`);}});
    for (const button of keyboard.querySelectorAll('.key')) {
      const entry = entries.find(item => item.key === button.dataset.key);
      button.disabled = !canPlay(entry.midi);
      if (button.disabled) button.title = preset.source === 'dmc' ? 'Load DPCM or choose Demo sample to play.' : 'Outside this source’s hardware pitch range. Change the octave.';
      button.addEventListener('keydown', event => {
        if (event.key===' '||event.key==='Enter') {event.preventDefault(); if(!event.repeat) press(`button:${entry.key}`,entry);}
      });
      button.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter') {event.preventDefault();release(`button:${entry.key}`);}});
    }
  }
  $('octaveValue').textContent = `${octave>0?'+':''}${octave}`;
  $('octaveDown').disabled = octave<=-2; $('octaveUp').disabled = octave>=2;
  updateKeys();
}
function canPlay(midi) {
  if (!Number.isInteger(midi) || midi<0 || midi>127) return false;
  if (preset.source==='noise') return true;
  if (preset.source==='dmc') return preset.dmc.data.length > 0;
  const hz=440*2**((midi-69)/12), clock=1789773;
  if (preset.source==='fds') {const value=Math.round(hz*4194304/clock);return value>=1&&value<=4095;}
  const period=Math.round(clock/((preset.source==='triangle'?32:16)*hz)-1);
  // The deployed native Triangle renderer is silent at periods below eight.
  return period>=8&&period<=2047;
}
function press(source, entry) {
  if (switchingAudioOutput||notes.has(source)||!canPlay(entry.midi)) return;
  const note = {id:`nes-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch,started:false};
  notes.set(source,note); updateKeys();
  void enqueue(async () => {
    if (switchingAudioOutput || notes.get(source)!==note || note.epoch!==epoch) return;
    const engine = await ensureAudio();
    if (switchingAudioOutput||notes.get(source)!==note||note.epoch!==epoch) return;
    note.started = true;
    const result = await engine.command('noteOn',[note.id,note.midi]);
    if (audio!==engine||note.epoch!==epoch) return;
    if (result.stolenId) for (const [key,old] of notes) if (old.id===result.stolenId) notes.delete(key);
    readVoices(await engine.read());
    status(preset.source==='noise' ? 'Noise triggered · pitch is set by Noise clock controls.' : preset.source==='dmc' ? 'DMC triggered · playback speed is set by Rate.' : `${midiToNoteName(note.midi)} · ${notes.size}/${capacity()} voices`);
  }).catch(error=>{if(notes.get(source)===note) notes.delete(source);updateKeys();report(error);});
}
function release(source) {
  const note = notes.get(source);
  if (!note) return;
  notes.delete(source);updateKeys();
  if (note.started) void enqueue(async()=>{
    if (audio && note.epoch===epoch) {await audio.command('noteOff',[note.id]);updateCapacity();}
  });
}
function stopNotes(message) {
  epoch++; notes.clear(); updateKeys();
  return enqueue(async()=>{if(audio) await audio.command('stop'); visualizer.stop();if(message) status(message);});
}
$('startAudio').addEventListener('click',()=>{$('startAudio').blur();void enqueue(ensureAudio).catch(report);});
$('stopAudio').addEventListener('click',()=>{$('stopAudio').blur();stopNotes('Stopped · instrument retained. Play to resume.');});
for(const [id,delta] of [['octaveDown',-1],['octaveUp',1]]) $(id).addEventListener('click',()=>{
  $(id).blur();stopNotes();octave=Math.max(-2,Math.min(2,octave+delta));renderKeyboard();
});
function editing(target) {const control=target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');return control&&!control.matches?.('input[type="range"],input[type="checkbox"]');}
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||editing(event.target)) return;
  const key=event.key.toLowerCase(),entry=layout.entries.find(item=>item.key===key);
  if(!entry) return;
  event.preventDefault(); if(!event.repeat) press(`key:${event.code||key}`,{...entry,midi:entry.midi+octave*12});
});
window.addEventListener('keyup',event=>release(`key:${event.code||event.key.toLowerCase()}`));
window.addEventListener('blur',()=>{stopNotes();setPitch(0);});
document.addEventListener('visibilitychange',()=>{if(document.hidden) {stopNotes();setPitch(0);}syncHardwareMonitor();});
function setPitchUi(value) {
  pitch=value;
  for (const [wheel, output] of pitchWheels) {
    wheel.value=String(value);
    output.textContent=`${value>=0?'+':''}${value.toFixed(2)}`;
  }
}
function setPitch(value) {
  const previous=pitch;setPitchUi(value);
  if(audio) void enqueue(async()=>{
    try{await audio?.command('setPitch',[value]);visualizer.wake();}
    catch(error){if(pitch===value) setPitchUi(previous);throw error;}
  });
}
for (const [wheel] of pitchWheels) {
  wheel.addEventListener('input',()=>setPitch(Number(wheel.value)));
  for(const event of ['pointerup','pointercancel','lostpointercapture','change']) wheel.addEventListener(event,()=>setPitch(0));
  wheel.addEventListener('keydown',event=>{if(event.key==='Home'||event.key==='Escape') {event.preventDefault();setPitch(0);}});
}
function setVolume() {
  const value=Number($('masterVolume').value);
  $('masterVolumeValue').textContent=`${Math.round(value*100)}%`;
  $('masterVolume').dataset.boosted=String(value>1);
  audio?.setVolume(value);visualizer.wake();
}
$('masterVolume').addEventListener('input',setVolume);
$('masterVolume').addEventListener('change',()=>$('masterVolume').blur());
$('clickGuardEnabled').addEventListener('change', () => {
  clickGuardEnabled = $('clickGuardEnabled').checked;
  $('clickGuardEnabled').blur();
  const enabled = clickGuardEnabled;
  if (audio) void enqueue(async () => {
    if (!audio) return;
    await audio.command('setClickGuard', [enabled]);
    status(enabled ? 'Software click guard on · FDS / DMC key edges softened over 5 ms.' : 'Software click guard off · raw chip output.');
  });
});
for(const button of document.querySelectorAll('[data-visual-mode]')) button.addEventListener('click',()=>{
  const mode=button.dataset.visualMode;visualizer.setMode(mode);
  for(const peer of document.querySelectorAll('[data-visual-mode]')) peer.setAttribute('aria-pressed',String(peer===button));
  button.blur();
});
const monitorResize = new ResizeObserver(() => {
  const canvas=$('outputCanvas');
  if(!canvas.clientWidth||!canvas.clientHeight) return;
  canvas.width=Math.max(240,Math.round(canvas.clientWidth));
  canvas.height=Math.max(150,Math.round(canvas.clientHeight));
  visualizer.setMode(document.querySelector('[data-visual-mode][aria-pressed="true"]').dataset.visualMode);
});
monitorResize.observe($('outputCanvas'));
function commitName() {void applyPreset({...preset,name:$('instrumentName').value}).catch(report);$('instrumentName').blur();}
$('instrumentName').addEventListener('change',commitName);
$('instrumentName').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitName();}});
function saveFile(name, data, type = 'application/json') {
  const url=URL.createObjectURL(new Blob([data],{type})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('savePreset').addEventListener('click',()=>{
  $('savePreset').blur();
  try{saveFile('2a03-voice.json',JSON.stringify(readPreset(preset),null,2)+'\n');status('Preset saved · Pulse, Triangle, Noise, DMC sample and FDS included.');}catch(error){report(error);}
});
$('loadPreset').addEventListener('click',()=>{$('loadPreset').blur();$('presetFileInput').click();});
$('presetFileInput').addEventListener('change',async()=>{
  const file=$('presetFileInput').files?.[0];$('presetFileInput').value='';$('presetFileInput').blur();
  if(!file) return;
  const token=++importSequence, draftRevision=revision;
  try {
    if(file.size>65536) throw new Error('Preset must be at most 64 KiB');
    const next=readPreset(JSON.parse(await file.text()));
    if(disposed||token!==importSequence||draftRevision!==revision) return;
    await applyPreset(next,{load:true,message:'Preset loaded · play the keyboard.'});
  }catch(error){report(error);}
});
$('resetPreset').addEventListener('click',()=>{$('resetPreset').blur();void applyPreset(createDefaultPreset(),{load:true,message:'Instrument reset · Pulse ready.'}).catch(report);});
$('copyCode').addEventListener('click',async()=>{
  $('copyCode').blur();
  try {
    const code=presetToCode(preset);$('codeOutput').value=code;$('codeOutput').hidden=false;
    try{await navigator.clipboard.writeText(code);status('JavaScript copied · paste into Playground NES / FDS mode.');}
    catch{status('JavaScript ready below · select and copy it into Playground NES / FDS mode.');}
  }catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  if(event.persisted){stopNotes();return;}
  disposed=true;epoch++;notes.clear();panelLayout?.dispose();hardwareObserver.dispose();watchHardwareContext(null);hardwareMonitor.dispose();monitorResize.disconnect();visualizer.dispose();editor.dispose();vgmLibrary.dispose();void audio?.dispose();audio=null;
});
updatePresetUi();setVolume();setPitchUi(0);

// Desktop adapters change only the final Master bus. The NES + FDS APU, allocator
// and output monitor keep using the same graph; ordinary sites expose no API.
const localDesktop = (location.protocol === 'tauri:' && location.hostname === 'localhost') ||
  (['http:', 'https:'].includes(location.protocol) && location.hostname === 'tauri.localhost');
if (window.top === window && localDesktop && window.__TAURI_INTERNALS__) {
  Object.defineProperty(window, 'tetoricaSynthAudio', {value:Object.freeze({
    setSwitching(value) {switchingAudioOutput = value === true;syncHardwareMonitor();},
    async ensureReady() {const engine = await ensureAudio(); return {context:engine.context, output:engine.outputNode};},
    async stopPlayback() {
      setPitchUi(0);
      await stopNotes();
      await enqueue(async () => {if (audio) await audio.command('setPitch', [0]);});
    },
  })});
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
