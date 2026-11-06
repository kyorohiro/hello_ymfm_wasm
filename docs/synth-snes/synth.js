// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js';
import {createEditor} from './editor.js';
import {createDefaultPreset, readPreset, presetToCode, pmonActive, presetBankKey} from './preset.js';
import {prepareAudio,prepareBrrFile} from './audio_import.js';
import {parseSpcVoices,MAX_SPC_BYTES} from './spc_import.js';
import {createSpcBrowser} from './spc_browser.js';
const MAX_PRESET_BYTES=256*1024;
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';
import {createFretboardState, createFretboardLayout, renderFretboardControls, buildKeyboard,
  setInstrument, setFretPosition, setStringWindowIndex, midiToNoteName} from '../synth/synth_keyboard.js';

const $ = id => document.getElementById(id);
const status = (text, error = false) => {
  $('audioStatus').textContent = text;
  $('audioStatus').dataset.error = String(error);
};
const report = error => status(error?.message ?? String(error), true);
let audio = null, opening = null, spcBrowser = null, disposed = false, epoch = 0, sequence = 0, importSequence = 0, switchingAudioOutput = false;
let preset = createDefaultPreset(), revision = 0, octave = 0, pitch = 0;
let queue = Promise.resolve();
const notes = new Map(), fret = createFretboardState();
const pitchWheels = [[$('pitchBend'), $('pitchValue')], [$('keyboardPitchBend'), $('keyboardPitchValue')]];
const visualizer = createSpuOutputVisualizer({canvas: $('outputCanvas')});
visualizer.setMode('waveform');
const enqueue = action => {
  const task = queue.then(action);
  queue = task.catch(report);
  return task;
};
const capacity = () => pmonActive(preset) ? 4 : 8;
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
  $('voiceCapacity').textContent = preset.source==='noise'
    ? `Hardware Noise · shared clock ${preset.noise.clock} · 8 voice envelopes · ${notes.size} held`
    : pmonActive(preset)
      ? `Hardware PMON · 2 voices per note · 4 notes · round robin · ${notes.size} held`
      : `${preset.source==='wave'?'128-point wave → BRR':'BRR sample'} · 8 hardware voices · round robin · ${notes.size} held`;
}
function updatePresetUi() {
  editor.update(preset);
  if (document.activeElement !== $('instrumentName')) $('instrumentName').value = preset.name;
  if (!$('codeOutput').hidden) {
    if (preset.source === 'brr' || pmonActive(preset) && preset.pmon.source === 'brr') {$('codeOutput').hidden=true;$('codeOutput').value='';}
    else $('codeOutput').value = presetToCode(preset);
  }
  $('copyCode').textContent = 'Copy JavaScript';
  setPitchUi(pitch);
  $('keyboardSourceHint').textContent=preset.source==='noise'
    ? 'Keys trigger Noise envelopes. Note names do not tune the sound.'
    : 'Every key plays the selected source. No keyboard split.';
  $('keyboardHint').textContent=preset.source==='noise'
    ? 'One shared Noise generator; each key has its own envelope. Noise clock changes its texture.'
    : pmonActive(preset)
      ? 'PMON uses two adjacent hardware voices per note. Four notes; when full, the oldest pair is replaced.'
      : 'When full, the oldest note is replaced.';
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
  if (disposed) throw new Error('S-DSP Synth is closed');
  if (!audio && !opening) {
    $('startAudio').disabled = true;
    status('Preparing S-DSP audio…');
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
        if (disposed) throw new Error('S-DSP Synth is closed');
        engine.setVolume(Number($('masterVolume').value));
        audio = engine;
        visualizer.connect(engine.context, engine.outputNode);
        $('startAudio').textContent = 'Audio ready';
        status('Audio ready · play the keyboard. Explore BRR, ADSR and GAIN.');
        return engine;
      } catch (error) {await engine.dispose(); throw error;}
    })().finally(() => {opening = null; $('startAudio').disabled = false;});
  }
  const engine = audio ?? await opening;
  await engine.resume();
  return engine;
}
function applyPreset(value, {load = false, message, fromSpc = false} = {}) {
  const next = readPreset(value);
  if(!fromSpc) spcBrowser?.clearSelection();
  const previous = preset;
  const replacesVoices = load || presetBankKey(previous) !== presetBankKey(next);
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
        ? 'Sample, PMON or Echo layout updated · previous notes and tails stopped. Play the keyboard.'
        : 'Instrument updated · hardware volume, envelopes, tuning, PMON ratio, Noise clock and Echo settings apply live.'));
    } catch (error) {
      if (audio === engine && revision === editRevision) {
        preset = (await engine.read()).preset;
        updatePresetUi();
      }
      throw error;
    }
  });
}
async function loadSample(file,options,isBrr) {
  const target=options.target??'carrier';
  if(!['carrier','modulator'].includes(target))throw new TypeError('Unknown sample target');
  const tuning=target==='modulator'?preset.pmon.brr:preset.brr;
  const token=++importSequence, draftRevision=revision;
  const prepared=isBrr ? await prepareBrrFile(file,{...options,rootNote:tuning.rootNote,basePitch:tuning.basePitch})
    : await prepareAudio(file,options);
  if(options.signal?.aborted) throw new DOMException('Sample import cancelled','AbortError');
  if(disposed||token!==importSequence||draftRevision!==revision) return 'Import discarded · instrument changed. Previous sound kept.';
  const next=readPreset(target==='modulator'
    ? {...preset,pmon:{...preset.pmon,source:'brr',brr:prepared}}
    : {...preset,source:'brr',name:prepared.name.slice(0,80),brr:prepared});
  options.onCommit?.();
  await applyPreset(next,{load:true,message:`Loaded ${prepared.name} · ${target} BRR sample · play the keyboard.`});
  return `Loaded ${prepared.name} into ${target}. Root note and base PITCH declare tuning; BRR does not store them.`;
}
const editor=createEditor({root:$('voiceEditor'),onChange:value=>{void applyPreset(value).catch(report);},onError:report,
  onLoadAudio:(file,options)=>loadSample(file,options,false),onLoadBrr:(file,options)=>loadSample(file,options,true)});
const spcCancelled = () => new DOMException('SPC import cancelled','AbortError');
async function openSpc(file,{signal}={}) {
  if(disposed||signal?.aborted) throw spcCancelled();
  if(!Number.isSafeInteger(file?.size)||file.size<0||file.size>MAX_SPC_BYTES) throw new RangeError('SPC must be at most 16 MiB');
  const data=await file.arrayBuffer();
  if(disposed||signal?.aborted) throw spcCancelled();
  return parseSpcVoices(data,{name:file.name});
}
async function selectSpc(candidate,{includeEcho=false,includePmon=false,signal,onCommit}={}) {
  if(disposed||signal?.aborted) throw spcCancelled();
  if(typeof includeEcho!=='boolean') throw new TypeError('SPC Echo import option must be boolean');
  if(typeof includePmon!=='boolean') throw new TypeError('SPC PMON import option must be boolean');
  const pair=includePmon&&candidate?.voice.pitchModulation&&!candidate?.voice.noise;
  const variant=pair?(includeEcho?candidate?.pmonEchoVariant:candidate?.pmonVariant):(includeEcho?candidate?.echoVariant:candidate);
  if(!variant?.preset) throw new Error(variant?.reason??'This SPC voice is unavailable');
  const next=readPreset(variant.preset);
  const sourceLabel=pair?`PMON CH${candidate.pmonPair.modulatorVoice.index+1} → CH${candidate.voice.index+1}`
    :next.source==='noise'?`Noise clock ${next.noise.clock}`:`SRCN ${candidate.voice.sourceNumber}`;
  const echoLabel=includeEcho?(next.echo.enabled?'Echo / FIR imported':'Echo / FIR settings imported · Echo Off'):'dry voice';
  // Invalidate older audio / preset file reads before this explicit adoption.
  const token=++importSequence;
  onCommit?.();
  const applying=applyPreset(next,{load:true,fromSpc:true,message:`Loaded SPC CH${candidate.voice.index+1} · ${sourceLabel} · ${echoLabel}. Play the keyboard.`});
  const adoptedRevision=revision;
  await applying;
  if(disposed||signal?.aborted||token!==importSequence||adoptedRevision!==revision) throw spcCancelled();
  const tuningHint=pair?'Both captured PITCH values are declared at C4. The modulator is muted in the mix; its hardware envelope drives PMON.'
    :next.source==='noise'?'Keys trigger envelopes; Noise clock controls the shared generator.'
    :'Snapshot PITCH is declared at C4; adjust Root note to retune.';
  return `Loaded CH${candidate.voice.index+1} · ${sourceLabel} · ${echoLabel}. ${tuningHint}`;
}
spcBrowser=createSpcBrowser({root:$('spcBrowser'),onOpen:openSpc,onSelect:selectSpc,onError:report});

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
const keyboardMode = () => preset.source==='noise'?'noise':`${preset.source}:${Boolean(preset.brr.data)}:${preset.brr.rootNote}:${preset.brr.basePitch}:${pmonActive(preset)}:${preset.pmon.source}:${Boolean(preset.pmon.brr.data)}`;
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
      if (button.disabled) button.title = 'Outside the S-DSP PITCH range. Change octave or sample tuning.';
      button.addEventListener('keydown', event => {
        if (event.key===' '||event.key==='Enter') {event.preventDefault(); if(!event.repeat) press(`button:${entry.key}`,entry);}
      });
      button.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter') {event.preventDefault();release(`button:${entry.key}`);}});
    }
  }
  $('octaveValue').textContent = preset.source==='noise'?'—':`${octave>0?'+':''}${octave}`;
  $('octaveDown').disabled = preset.source==='noise'||octave<=-2; $('octaveUp').disabled = preset.source==='noise'||octave>=2;
  updateKeys();
}
function canPlay(midi) {
  if(!Number.isInteger(midi)||midi<0||midi>127||preset.source==='brr'&&!preset.brr.data) return false;
  if(preset.source==='noise') return true;
  if(pmonActive(preset)&&preset.pmon.source==='brr'&&!preset.pmon.brr.data)return false;
  const raw=preset.source==='wave' ? 4096*(440*2**((midi-69)/12))/(32000/128)
    : preset.brr.basePitch*2**((midi-preset.brr.rootNote)/12);
  return Math.round(raw)>=1&&Math.round(raw)<=16383;
}
function press(source, entry) {
  if (switchingAudioOutput||notes.has(source)||!canPlay(entry.midi)) return;
  const note = {id:`sdsp-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch,started:false};
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
    const label=preset.source==='noise'?`Noise clock ${preset.noise.clock}`:midiToNoteName(note.midi);
    status(`${label} · ${notes.size}/${capacity()} ${pmonActive(preset)?'notes · hardware PMON':'voices'} · hardware ${preset.envelope.mode==='adsr'?'ADSR':'GAIN'}`);
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
  if(preset.source==='noise') return;
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
  const noise=preset.source==='noise';
  pitch=noise?0:value;
  for (const [wheel, output] of pitchWheels) {
    wheel.value=String(pitch);wheel.disabled=noise;
    output.textContent=noise?'—':`${pitch>=0?'+':''}${pitch.toFixed(2)}`;
    wheel.closest('label').title=noise?'Noise uses the shared Noise clock; Pitch does not tune it.'
      :'Software pitch bend, ±2 semitones. Release to return to center.';
  }
}
function setPitch(value) {
  if(preset.source==='noise'){setPitchUi(0);return;}
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
  try{saveFile('sdsp-voice.json',JSON.stringify(readPreset(preset),null,2)+'\n');status('Preset saved · waveform, BRR sample, tuning and hardware envelope included.');}catch(error){report(error);}
});
$('loadPreset').addEventListener('click',()=>{$('loadPreset').blur();$('presetFileInput').click();});
$('presetFileInput').addEventListener('change',async()=>{
  const file=$('presetFileInput').files?.[0];$('presetFileInput').value='';$('presetFileInput').blur();
  if(!file) return;
  const token=++importSequence, draftRevision=revision;
  try {
    if(file.size>MAX_PRESET_BYTES) throw new Error('Preset must be at most 256 KiB');
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
    const destination='paste into Playground SNES mode';
    try{await navigator.clipboard.writeText(code);status(`JavaScript copied · ${destination}.`);}
    catch{status(`JavaScript ready below · ${destination}.`);}
  }catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  if(event.persisted){stopNotes();return;}
  disposed=true;epoch++;notes.clear();monitorResize.disconnect();visualizer.dispose();editor.dispose();spcBrowser.dispose();void audio?.dispose();audio=null;
});
updatePresetUi();setVolume();setPitchUi(0);

// Desktop adapters change only the final Master bus. The S-DSP, allocator
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
