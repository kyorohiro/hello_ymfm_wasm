// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js';
import {createEditor} from './editor.js';
import {createVgmLibrary} from './vgm_library.js';
import {createDefaultPreset, readPreset, presetToCode} from './preset.js';
import {createHardwareMonitor} from './hardware_monitor.js';
import {createStateObserver} from './state_observer.js';
import {createPanelLayout} from './panel_layout.js';
import {setupNesCodeHost} from './code_host.js';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {createNesSongSnapshot, captureNesSongPreset} from './song_state.js';
import {setupNesSongControls} from './song_controls.js';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard,
  setInstrument, setFretPosition, setStringWindowIndex, midiToNoteName} from '../synth/synth_keyboard.js';

const $ = id => document.getElementById(id);
const status = (text, error = false) => {
  $('audioStatus').textContent = text;
  $('audioStatus').dataset.error = String(error);
};
const report = error => {if (error?.name !== 'AbortError') status(error?.message ?? String(error), true);};
let audio = null, opening = null, disposed = false, epoch = 0, sequence = 0, importSequence = 0, switchingAudioOutput = false;
let preset = createDefaultPreset(), revision = 0, octave = 0, pitch = 0;
let autoPreset = readPreset(preset), selectedChannel = null, channelRevision = 0;
let lastChipState = null, lastManualEdit = 0, editorPointer = false, pendingChannelEdits = 0;
let codeHost = null, songControls = null;
let songState = null;
const channelDrafts = new Map();
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
  onState(state, engine) {
    if (audio !== engine) return;
    lastChipState = state;
    const voices = state.owners?.filter(Boolean).map(owner => ({id:`apu:${owner.channel}`,channel:owner.channel})) ?? state.voices;
    if (state?.preset?.source === preset.source || selectedChannel !== null) hardwareMonitor.update({...state,
      preset:selectedChannel === null ? state.preset : channelPreset(state, selectedChannel), voices,
    });
    if (!songIsActive()) updateLivePreset(state);
    readVoices(state);
  },
  onStatus(mode) {
    if (mode === 'disposed') return;
    hardwareMonitor.setMode(!audio ? 'waiting' : mode);
  },
});
let observedContext = null;
function syncHardwareMonitor() {
  const visible = !document.hidden, running = audio?.context.state === 'running';
  const panelVisible = $('sourcePanel').open && $('hardwarePanel').open;
  const observeCode = codeHost?.isRunning() && (selectedChannel !== null && $('nesAutoUpdate').checked || panelVisible);
  const active = Boolean(!disposed && visible && running && !switchingAudioOutput && !songIsActive()
    && (observeCode || panelVisible && preset.source !== 'dmc' && [...notes.values()].some(note => note.started)));
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
const channelSources = ['pulse', 'pulse', 'triangle', 'noise', 'dmc', 'fds'];
const songIsActive = () => Boolean(songState?.playing || songState?.paused || songState?.playback === 'ended');
function syncActivity() {
  visualizer.setRunning(Boolean((notes.size || codeHost?.isRunning() || songState?.playing) && $('monitorPanel').open));
  syncHardwareMonitor();
}
function updateKeys() {
  const keys = new Set([...notes.values()].map(note => note.key));
  for (const button of $('keyboard').querySelectorAll('.key')) {
    const active = keys.has(button.dataset.key);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  syncActivity();
  updateCapacity();
  syncHardwareMonitor();
}
function readVoices(state) {
  const owners = new Set((state.voices ?? []).map(voice => voice.id));
  for (const [source, note] of notes) if (note.started && !note.pending && !note.song && !owners.has(note.id)) notes.delete(source);
  updateKeys();
  updateCapacity();
}
function updateCapacity() {
  const description = {pulse:'Pulse · CH1 / CH2',triangle:'Triangle · CH3',noise:'Noise · CH4 · keys trigger the same noise',dmc:'DMC · CH5 · keys trigger the same sample',fds:'FDS · waveform + modulation'}[preset.source];
  const allocation = selectedChannel === null ? `${capacity()} ${capacity() === 1 ? 'voice' : 'voices'} · round robin` : `CH${selectedChannel + 1} · physical channel`;
  $('voiceCapacity').textContent = `${description} · ${allocation} · ${notes.size} held`;
}
function updatePresetUi({resetDmcHistory = false} = {}) {
  hardwareMonitor.setSource(preset.source);
  editor.update(preset, {resetDmcHistory});
  if (selectedChannel !== null) $('voiceEditor').querySelector('.nes-source-bar p').textContent = `CH${selectedChannel + 1} · display, edit and play this physical channel.`;
  $('source').inert = selectedChannel !== null;
  $('source').setAttribute('aria-disabled', String(selectedChannel !== null));
  $('voiceEditor').classList.toggle('nes-live-source-locked', selectedChannel !== null);
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
  songControls?.stop();
  void codeHost?.stop().catch(() => {});
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
        for (const [channel, draft] of channelDrafts) await engine.command('applyPhysicalPreset', [channel, draft]);
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
  selectedChannel = null; channelRevision++;
  if (!fromVgm) vgmLibrary?.clearSelection();
  const previous = preset;
  const replacesVoices = load || previous.source !== next.source
    || JSON.stringify(previous.fds.wave) !== JSON.stringify(next.fds.wave)
    || JSON.stringify(previous.fds.modulation.table) !== JSON.stringify(next.fds.modulation.table)
    || JSON.stringify(previous.dmc.data) !== JSON.stringify(next.dmc.data);
  if (replacesVoices) {epoch++;notes.clear();updateKeys();}
  autoPreset = next; preset = next; revision++;
  const editRevision = revision;
  if (load || previous.source !== next.source) setPitchUi(0);
  updatePresetUi({resetDmcHistory:load});
  syncChannelUi();
  codeHost?.markSoundDirty();
  if (!audio) {status(message ?? 'Instrument updated · enable audio, then play.'); return Promise.resolve();}
  return enqueue(async () => {
    const engine = audio;
    if (!engine) return;
    try {
      await engine.command(load && !codeHost?.isRunning() ? 'loadPreset' : 'setPreset', [next]);
      if (load || previous.source !== next.source) await engine.command('setPitch', [0]);
      const state = await engine.read();
      if (audio !== engine) return;
      readVoices(state);
      visualizer.wake();
      if (revision === editRevision) status(message ?? 'Instrument updated · play a new note to hear envelope and Sweep edits.');
    } catch (error) {
      if (audio === engine && revision === editRevision) {
        autoPreset = (await engine.read()).preset;
        preset = autoPreset;
        updatePresetUi();
      }
      throw error;
    }
  });
}
function syncChannelUi() {
  for (const button of document.querySelectorAll('[data-nes-channel]')) {
    const selected = button.dataset.nesChannel === (selectedChannel === null ? 'auto' : String(selectedChannel));
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  let snapshot = songIsActive() ? songState?.liveState : lastChipState;
  try {if (snapshot?.registers && !snapshot.channels) snapshot = createNesSongSnapshot(snapshot);} catch {snapshot = null;}
  const capture = selectedChannel === null ? null : snapshot?.channels?.[selectedChannel];
  $('nesSongCapture').disabled = !capture?.canCapture;
  $('nesSongCapture').title = capture?.captureError ?? '';
  const transport = songState?.playing ? 'VGM playing' : songState?.paused ? 'VGM paused' : songState?.playback === 'ended' ? 'VGM ended' : codeHost?.isRunning() ? 'Code running' : 'Manual';
  $('nesChannelStatus').textContent = selectedChannel === null
    ? 'Auto · selected source, Pulse round robin'
    : `CH${selectedChannel + 1} · ${channelSources[selectedChannel]} · ${transport}`;
}
function channelPreset(state, channel) {
  const snapshot = state?.liveState ?? state;
  if (snapshot?.channels?.[channel]?.preset) return readPreset(snapshot.channels[channel].preset);
  if (snapshot?.registers) {
    try {return createNesSongSnapshot(snapshot).channels[channel].preset;} catch {}
  }
  const bank = state?.channelPresets?.[channel];
  const value = bank ?? channelDrafts.get(channel) ?? autoPreset;
  return readPreset({...value, source:channelSources[channel]});
}
function updateLivePreset(state) {
  if (selectedChannel === null || !$('nesAutoUpdate').checked || editorPointer || pendingChannelEdits || performance.now() - lastManualEdit < 300) return;
  if (document.activeElement?.closest('#voiceEditor,input#instrumentName')) return;
  // The register snapshot mapper is installed with the reference player below.
  const next = channelPreset(state, selectedChannel);
  preset = next;
  updatePresetUi();
  syncChannelUi();
}
async function selectChannel(channel) {
  const token = ++channelRevision;
  await stopNotes();
  if (disposed || token !== channelRevision) return;
  selectedChannel = channel;
  if (channel === null) preset = readPreset(autoPreset);
  else {
    const state = songIsActive() ? songControls.getState() : audio ? await audio.read() : null;
    if (disposed || token !== channelRevision) return;
    if (!songIsActive()) lastChipState = state;
    preset = channelPreset(state, channel);
  }
  updatePresetUi({resetDmcHistory:true});
  syncChannelUi();
  hardwareObserver.invalidate();
  syncActivity();
}
async function editCurrentPreset(value) {
  lastManualEdit = performance.now();
  if (selectedChannel === null) return applyPreset(value);
  const channel = selectedChannel, token = channelRevision;
  const next = readPreset({...value, source:channelSources[channel]});
  preset = next;
  channelDrafts.set(channel, next);
  updatePresetUi();
  pendingChannelEdits++;
  try {
    if (songIsActive()) {
      if (!await songControls.ensureEditable() || channelRevision !== token) return;
      await songControls.player.applyPreset(channel, next);
    }
    else if (audio) await enqueue(async () => {
      if (channelRevision !== token || !audio) return;
      await audio.command('applyPhysicalPreset', [channel, next]);
      lastChipState = await audio.read();
      readVoices(lastChipState);
    });
  } finally {pendingChannelEdits--;}
  visualizer.wake();
}
const editor = createEditor({
  root: $('voiceEditor'), onChange: value => {void editCurrentPreset(value).catch(report);}, onError: report,
  onCompareDepth: value => selectedChannel === null
    ? applyPreset(value, {load:true,message:'Slow vibrato comparison ready · release and play a new key. Direction changes apply on the next note.'})
    : editCurrentPreset(value),
  onSaveDpcm: data => {
    saveFile('2a03-sample.dmc', Uint8Array.from(data), 'application/octet-stream');
    status(`DPCM download started · ${data.length} bytes. Save preset to keep Rate, Loop and Initial level too.`);
  },
});
vgmLibrary = createVgmLibrary({root: $('vgmImport'),
  onSelect: value => applyPreset(value, {
    load:true, fromVgm:true, message:`${value.name} loaded from VGM · play the keyboard.`,
  }),
  async onImported({name, bytes, result, isCurrent}) {
    await codeHost.ready;
    const paths = await codeHost.files.importVgm({name, bytes:new Uint8Array(bytes), result, isCurrent});
    if (!paths.length || !isCurrent()) return;
    try {await songControls.selectFile(paths[0]);}
    catch (error) {status(`Sounds imported. Reference playback unavailable · ${error.message}`);}
  },
});
panelLayout = createPanelLayout({root:document,
  onSourceHidden:() => editor.cancelDrawing(),
  onVisibilityChange:syncActivity,
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
    const note = {id:`nes-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch,started:false,channel:selectedChannel,
      song:selectedChannel !== null && songIsActive()};
  notes.set(source,note); updateKeys();
  void enqueue(async () => {
    if (switchingAudioOutput || notes.get(source)!==note || note.epoch!==epoch) return;
    const engine = await ensureAudio();
    if (switchingAudioOutput||notes.get(source)!==note||note.epoch!==epoch) return;
    if (note.song && !await songControls.ensureEditable()) return;
    if (notes.get(source)!==note||note.epoch!==epoch) return;
    note.started = true; note.pending = true;
    const result = note.song
      ? await songControls.player.noteOn(note.id, note.midi, note.channel)
      : await engine.command('noteOn',note.channel === null ? [note.id,note.midi] : [note.id,note.midi,note.channel]);
    note.pending = false;
    if (audio!==engine||note.epoch!==epoch) return;
    if (result?.stolenId) for (const [key,old] of notes) if (old.id===result.stolenId) notes.delete(key);
    readVoices(await engine.read());
    status(preset.source==='noise' ? 'Noise triggered · pitch is set by Noise clock controls.' : preset.source==='dmc' ? 'DMC triggered · playback speed is set by Rate.' : `${midiToNoteName(note.midi)} · ${notes.size}/${capacity()} voices`);
  }).catch(error=>{if(notes.get(source)===note) notes.delete(source);updateKeys();report(error);});
}
function release(source) {
  const note = notes.get(source);
  if (!note) return;
  notes.delete(source);updateKeys();
  if (note.started) void enqueue(async()=>{
    if (audio && note.epoch===epoch) {
      if (note.song) await songControls?.player.noteOff(note.id);
      else await audio.command('noteOff',[note.id]);
      updateCapacity();
    }
  });
}
function stopNotes(message) {
  const held = [...notes.values()].filter(note => note.started);
  epoch++; notes.clear(); updateKeys();
  return enqueue(async()=>{
    for (const note of held) {
      if (note.song) await songControls?.player.noteOff(note.id);
      else if (audio) await audio.command('noteOff', [note.id]);
    }
    syncActivity();
    if(message) status(message);
  });
}
async function stopAll() {
  await codeHost?.stop();
  await songControls?.stop();
  await stopNotes();
  if (audio) await enqueue(() => audio?.command('stop'));
  visualizer.stop();
  syncChannelUi();
  status('Stopped · instrument retained. Play to resume.');
}
$('startAudio').addEventListener('click',()=>{$('startAudio').blur();void enqueue(ensureAudio).catch(report);});
$('stopAudio').addEventListener('click',()=>{$('stopAudio').blur();void stopAll().catch(report);});
for(const [id,delta] of [['octaveDown',-1],['octaveUp',1]]) $(id).addEventListener('click',()=>{
  $(id).blur();stopNotes();octave=Math.max(-2,Math.min(2,octave+delta));renderKeyboard();
});
function editing(target) {const control=target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open],.monaco-editor');return control&&!control.matches?.('input[type="range"],input[type="checkbox"]');}
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
    try{
      await audio?.command('setPitch',[value]);
      if (songIsActive() && songControls.getState().manualReady) await songControls.player.setPitch(value);
      visualizer.wake();
    }
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
  songControls?.setClickGuard(enabled);
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
function commitName() {void editCurrentPreset({...preset,name:$('instrumentName').value}).catch(report);$('instrumentName').blur();}
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
setupSynthMenu({document, window});
for (const [action, target] of [['synthMenuVgm','loadVgm'], ['synthMenuPresetImport','loadPreset'], ['synthMenuPresetExport','savePreset']]) {
  $(action).addEventListener('click', () => $(target).click());
}
codeHost = setupNesCodeHost({
  ensureAudio, getAudio:() => audio, getSettings:() => readPreset(autoPreset),
  async applySettings(value, {isCurrent = () => true} = {}) {
    if (!isCurrent()) return false;
    await applyPreset(value, {load:true, message:'Sound loaded from Files.'});
    return isCurrent();
  },
  stopKeyboard:stopNotes,
  stopSong:async () => {await songControls?.stop(); await songControls?.whenIdle();},
  onSelectSong:(file, options) => songControls.selectFile({path:options?.path ?? file.path, data:file.data}),
  onActivity() {syncActivity(); syncChannelUi();},
  setStatus:(message,error=false) => status(message,error),
});
songControls = setupNesSongControls({
  project:codeHost.project, ensureAudio, getAudio:() => audio,
  getClickGuard:() => clickGuardEnabled,
  stopCode:async () => {await codeHost.stop(); await stopNotes();},
  onState(state) {
    songState = state;
    if (selectedChannel !== null) updateLivePreset(state);
    syncActivity(); syncChannelUi();
  },
  onLiveState(state) {
    const snapshot = state?.liveState ?? state;
    if (snapshot?.registers && selectedChannel !== null) hardwareMonitor.update({...snapshot,
      preset:snapshot.channels[selectedChannel].preset,
      voices:snapshot.channels.filter(voice => voice.gate).map(voice => ({id:`vgm:${voice.channel}`,channel:voice.channel})),
    });
  },
  setStatus:(message,error=false) => status(message,error),
});
void codeHost.ready.then(() => songControls.refresh()).catch(report);
for (const button of document.querySelectorAll('[data-nes-channel]')) {
  const choose = () => selectChannel(button.dataset.nesChannel === 'auto' ? null : Number(button.dataset.nesChannel)).catch(report);
  button.addEventListener('pointerdown', event => {event.preventDefault();document.activeElement?.blur();});
  button.addEventListener('click', () => {void choose();});
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = [...document.querySelectorAll('[data-nes-channel]')], current = buttons.indexOf(button);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index].click(); buttons[index].focus();
  });
}
$('nesAutoUpdate').addEventListener('change', () => {
  $('nesAutoUpdate').blur();
  songControls.setLiveEnabled($('nesAutoUpdate').checked);
  if ($('nesAutoUpdate').checked && selectedChannel !== null) updateLivePreset(songIsActive() ? songControls.getState() : lastChipState);
  syncActivity();
});
$('nesSongCapture').addEventListener('click', async () => {
  $('nesSongCapture').blur();
  const channel = selectedChannel;
  if (channel === null) return;
  try {
    const state = songIsActive() ? songControls.getState().liveState : await audio?.read();
    const captured = captureNesSongPreset(state, {channel, basePreset:autoPreset});
    await stopNotes();
    await applyPreset(captured, {load:true, message:`CH${channel + 1} captured to Auto · song position retained.`});
  } catch (error) {report(error);}
});
$('voiceEditor').addEventListener('pointerdown', () => {editorPointer = true;});
window.addEventListener('pointerup', () => {editorPointer = false;});
window.addEventListener('pointercancel', () => {editorPointer = false;});
window.addEventListener('pagehide',event=>{
  if(event.persisted){stopNotes();return;}
  disposed=true;epoch++;notes.clear();panelLayout?.dispose();hardwareObserver.dispose();watchHardwareContext(null);hardwareMonitor.dispose();monitorResize.disconnect();visualizer.dispose();editor.dispose();vgmLibrary.dispose();songControls?.dispose();
  const owner=audio;audio=null;
  void codeHost?.dispose().finally(() => owner?.dispose());
});
updatePresetUi();setVolume();setPitchUi(0);syncChannelUi();

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
      await stopAll();
      await enqueue(async () => {if (audio) await audio.command('setPitch', [0]);});
    },
  })});
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
