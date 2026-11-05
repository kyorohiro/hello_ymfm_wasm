// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js';
import {createEditor} from './editor.js';
import {createVgmLibrary} from './vgm_library.js';
import {createDefaultPreset, readPreset, presetToCode} from './preset.js';
import {prepareDdaAudio} from './audio_import.js';
import {MAX_PRESET_BYTES} from './dda_pcm.js';
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
let queue = Promise.resolve();
let vgmLibrary = null;
const notes = new Map(), fret = createFretboardState();
const pitchWheels = [[$('pitchBend'), $('pitchValue')], [$('keyboardPitchBend'), $('keyboardPitchValue')]];
const visualizer = createSpuOutputVisualizer({canvas: $('outputCanvas')});
visualizer.setMode('waveform');
const enqueue = action => {
  const task = queue.then(action);
  queue = task.catch(report);
  return task;
};
const capacity = () => preset.source === 'noise' ? 2 : preset.source === 'wave' && preset.lfo.enabled ? 1 : 6;
function updateKeys() {
  const keys = new Set([...notes.values()].map(note => note.key));
  for (const button of $('keyboard').querySelectorAll('.key')) {
    const active = keys.has(button.dataset.key);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  visualizer.setRunning(notes.size > 0);
  updateCapacity();
}
function readVoices(state) {
  const owners = new Set(state.voices.map(voice => voice.id));
  for (const [source, note] of notes) if (note.started && !owners.has(note.id)) notes.delete(source);
  updateKeys();
  updateCapacity();
}
function updateCapacity() {
  const description = preset.source === 'noise' ? 'Noise · CH5 / CH6 · keys trigger the same noise'
    : preset.source === 'dda' ? 'DDA PCM · CH1–CH6 · software sample feed'
      : preset.lfo.enabled ? 'Wave + Hardware LFO · CH2 → CH1' : 'Wave · CH1–CH6';
  const recorded = preset.source === 'wave' && preset.lfo.enabled && preset.lfo.mode === 'recorded';
  $('voiceCapacity').textContent = `${description} · ${capacity()} ${capacity() === 1 ? 'voice' : 'voices'} · round robin · ${notes.size} held${recorded ? ' · C4 = recorded pitch' : ''}`;
}
function updatePresetUi() {
  editor.update(preset);
  if (document.activeElement !== $('instrumentName')) $('instrumentName').value = preset.name;
  if (!$('codeOutput').hidden) {
    if (preset.source === 'dda') {$('codeOutput').hidden=true;$('codeOutput').value='';}
    else $('codeOutput').value = presetToCode(preset);
  }
  $('copyCode').textContent = preset.source === 'dda' ? 'Copy DDA preset JS' : 'Copy JavaScript';
  for (const [wheel] of pitchWheels) wheel.disabled = preset.source === 'noise';
  updateCapacity();
  if (!layout || keyboardSource !== keyboardMode()) renderKeyboard();
  else updateKeys();
}
function audioFailed(error) {
  epoch++;
  notes.clear(); updateKeys();
  const failed = audio; audio = null;
  visualizer.disconnect();
  if (failed) void failed.dispose().catch(() => {});
  $('startAudio').textContent = 'Enable audio';
  report(error);
}
async function ensureAudio() {
  if (disposed) throw new Error('HuC6280 Synth is closed');
  if (!audio && !opening) {
    $('startAudio').disabled = true;
    status('Preparing HuC6280 audio…');
    opening = (async () => {
      const engine = await createAudio({volume: Number($('masterVolume').value), onError: audioFailed});
      try {
        // Source edits remain available while WASM loads. Adopt the latest draft.
        let applied, appliedPitch;
        do {
          applied = revision; appliedPitch = pitch;
          await engine.command('loadPreset', [readPreset(preset)]);
          await engine.command('setPitch', [appliedPitch]);
        } while (applied !== revision || appliedPitch !== pitch);
        if (disposed) throw new Error('HuC6280 Synth is closed');
        engine.setVolume(Number($('masterVolume').value));
        audio = engine;
        visualizer.connect(engine.context, engine.outputNode);
        $('startAudio').textContent = 'Audio ready';
        status('Audio ready · play the keyboard. Explore Wave, Noise, Hardware LFO or DDA PCM.');
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
  const replacesVoices = load || previous.source !== next.source || previous.lfo.enabled !== next.lfo.enabled
    || previous.lfo.mode !== next.lfo.mode || previous.lfo.output.enabled !== next.lfo.output.enabled
    || previous.envelope.enabled !== next.envelope.enabled || JSON.stringify(previous.wave) !== JSON.stringify(next.wave)
    || JSON.stringify(previous.lfo.wave) !== JSON.stringify(next.lfo.wave) || previous.dda.data !== next.dda.data;
  if (replacesVoices) {epoch++;notes.clear();updateKeys();}
  preset = next; revision++;
  const editRevision = revision;
  if (load || previous.source !== next.source) setPitchUi(0);
  updatePresetUi();
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
      if (revision === editRevision) status(message ?? (replacesVoices
        ? 'Wave or routing updated · previous notes stopped. Play the keyboard.'
        : 'Instrument updated · volume, pan, Noise clock and LFO rate apply live.'));
    } catch (error) {
      if (audio === engine && revision === editRevision) {
        preset = (await engine.read()).preset;
        updatePresetUi();
      }
      throw error;
    }
  });
}
async function loadDdaAudio(file,{sampleRate,signal,onCommit}) {
  const token=++importSequence, draftRevision=revision;
  const prepared=await prepareDdaAudio(file,{sampleRate,signal});
  if (signal?.aborted) throw new DOMException('Audio import cancelled','AbortError');
  if (disposed||token!==importSequence||draftRevision!==revision) return 'Import discarded · instrument changed. Previous sound kept.';
  const next=readPreset({...preset, source:'dda', name:prepared.name.slice(0,80),
    dda:{...prepared,rootNote:preset.dda.rootNote,loop:preset.dda.loop,speed:preset.dda.speed}});
  // Conversion can be cancelled; committing the validated preset is atomic.
  // End the UI's cancellable stage before changing its authored instrument.
  onCommit?.();
  await applyPreset(next,{load:true,message:`Loaded ${prepared.name} · DDA PCM · play the keyboard.`});
  return `Loaded ${prepared.name} · 5-bit PCM at ${prepared.sampleRate.toLocaleString()} Hz.`;
}
const editor = createEditor({root: $('voiceEditor'), onChange: value => {void applyPreset(value).catch(report);},
  onError:report,onLoadAudio:loadDdaAudio});
vgmLibrary = createVgmLibrary({root:$('vgmImport'), onSelect:value => applyPreset(value, {
  load:true, fromVgm:true, message:`${value.name} loaded from VGM · Software Envelope off · play the keyboard.`,
})});

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
let layout, keyboardSource;
const keyboardMode = () => `${preset.source}:${preset.source==='dda' ? Boolean(preset.dda.data) : preset.lfo.enabled && preset.lfo.mode === 'recorded' ? 'recorded' : 'keyboard'}`;
function renderKeyboard() {
  {
    keyboardSource = keyboardMode();
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
      if (button.disabled) button.title = 'Below this hardware channel’s pitch range. Raise the octave.';
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
  const hz = 440*2**((midi-69)/12);
  if(preset.source==='dda') return midi>=0&&midi<=127&&Boolean(preset.dda.data);
  return midi>=0 && midi<=127 && (preset.source==='noise' || preset.lfo.enabled && preset.lfo.mode==='recorded' || hz >= 3579545 / (32 * 4096));
}
function press(source, entry) {
  if (switchingAudioOutput||notes.has(source)||!canPlay(entry.midi)) return;
  const note = {id:`huc6280-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch,started:false};
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
    status(preset.source==='noise' ? 'Noise triggered · pitch is set by Noise clock controls.'
      : preset.source==='dda' ? `${midiToNoteName(note.midi)} · DDA PCM · ${notes.size}/6 voices · software playback`
      : `${midiToNoteName(note.midi)}${preset.lfo.enabled && preset.lfo.mode==='recorded' ? ' trigger · C4 = recorded carrier pitch' : ''} · ${notes.size}/${capacity()} voices`);
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
function editing(target) {
  const control = target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');
  return control && !control.matches?.('input[type="range"],input[type="checkbox"],input[type="radio"]');
}
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||editing(event.target)) return;
  const key=event.key.toLowerCase(),entry=layout.entries.find(item=>item.key===key);
  if(!entry) return;
  event.preventDefault(); if(!event.repeat) press(`key:${event.code||key}`,{...entry,midi:entry.midi+octave*12});
});
window.addEventListener('keyup',event=>release(`key:${event.code||event.key.toLowerCase()}`));
window.addEventListener('blur',()=>{stopNotes();setPitch(0);});
document.addEventListener('visibilitychange',()=>{if(document.hidden) {stopNotes();setPitch(0);}});
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
function saveFile(name, text) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('savePreset').addEventListener('click',()=>{
  $('savePreset').blur();
  try{saveFile('huc6280-voice.json',JSON.stringify(readPreset(preset),null,2)+'\n');status('Preset saved · Wave, Noise, LFO, DDA PCM and Software envelope included.');}catch(error){report(error);}
});
$('loadPreset').addEventListener('click',()=>{$('loadPreset').blur();$('presetFileInput').click();});
$('presetFileInput').addEventListener('change',async()=>{
  const file=$('presetFileInput').files?.[0];$('presetFileInput').value='';$('presetFileInput').blur();
  if(!file) return;
  const token=++importSequence, draftRevision=revision;
  try {
    if(file.size>MAX_PRESET_BYTES) throw new Error('Preset must be at most 32 MiB');
    const next=readPreset(JSON.parse(await file.text()));
    if(disposed||token!==importSequence||draftRevision!==revision) return;
    await applyPreset(next,{load:true,message:'Preset loaded · play the keyboard.'});
  }catch(error){report(error);}
});
$('resetPreset').addEventListener('click',()=>{$('resetPreset').blur();void applyPreset(createDefaultPreset(),{load:true,message:'Instrument reset · Sine ready.'}).catch(report);});
$('copyCode').addEventListener('click',async()=>{
  $('copyCode').blur();
  try {
    const code=presetToCode(preset);$('codeOutput').value=code;$('codeOutput').hidden=false;
    const destination=preset.source==='dda' ? 'DDA preset data and Instrument usage example' : 'paste into Playground HuC6280 mode';
    try{await navigator.clipboard.writeText(code);status(`JavaScript copied · ${destination}.`);}
    catch{status(`JavaScript ready below · ${destination}.`);}
  }catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  if(event.persisted){stopNotes();return;}
  disposed=true;epoch++;notes.clear();monitorResize.disconnect();visualizer.dispose();editor.dispose();vgmLibrary.dispose();void audio?.dispose();audio=null;
});
updatePresetUi();setVolume();setPitchUi(0);

// Desktop adapters change only the final Master bus. The HuC6280 PSG, allocator
// and output monitor keep using the same graph; ordinary sites expose no API.
const localDesktop = (location.protocol === 'tauri:' && location.hostname === 'localhost') ||
  (['http:', 'https:'].includes(location.protocol) && location.hostname === 'tauri.localhost');
if (window.top === window && localDesktop && window.__TAURI_INTERNALS__) {
  Object.defineProperty(window, 'tetoricaSynthAudio', {value:Object.freeze({
    setSwitching(value) {switchingAudioOutput = value === true;},
    async ensureReady() {const engine = await ensureAudio(); return {context:engine.context, output:engine.outputNode};},
    async stopPlayback() {
      setPitchUi(0);
      await stopNotes();
      await enqueue(async () => {if (audio) await audio.command('setPitch', [0]);});
    },
  })});
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
