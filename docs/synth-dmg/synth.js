// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js?v=dmg-menu-1';
import {setupGameboyCodeHost} from './code_host.js?v=dmg-menu-1';
import {createGameboyCodeLive,gameboyCodeLiveView} from './code_live.js?v=dmg-menu-1';
import {createEditor} from './editor.js?v=dmg-menu-1';
import {setupGameboyVgmImport} from './vgm_library.js?v=dmg-menu-1';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {setupGameboySongControls} from './song_controls.js?v=dmg-menu-1';
import {createGameboySongAudition} from './song_audition.js?v=dmg-menu-1';
import {prepareGameboySongVoice} from './song_voice.js?v=dmg-menu-1';
import {createDefaultPreset, readPreset, presetToCode} from './preset.js';
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
let queue = Promise.resolve(), captureWork = null;
let vgmImport = null, codeHost = null, codeLive = null, applySequence = 0, liveSignature = null, songControls = null, lastSongState = null, audition = null, auditionSelectionKey = null, pausedVoiceCache = null;
const notes = new Map(), auditionNotes = new Map(), fret = createFretboardState();
const pitchWheels = [[$('pitchBend'), $('pitchValue')], [$('keyboardPitchBend'), $('keyboardPitchValue')]];
const visualizer = createSpuOutputVisualizer({canvas: $('outputCanvas')});
visualizer.setMode('waveform');
const enqueue = action => {
  const task = queue.then(action);
  queue = task.catch(report);
  return task;
};
const capacity = () => preset.source === 'pulse' && !preset.pulse.sweep.enabled ? 2 : 1;
function updateKeys() {
  const keys = new Set([...notes.values(),...auditionNotes.values()].map(note => note.key));
  for (const button of $('keyboard').querySelectorAll('.key')) {
    const active = keys.has(button.dataset.key);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    const entry=layout?.entries.find(item=>item.key===button.dataset.key);
    if(entry)button.disabled=!canPlay(entry.midi+octave*12);
  }
  visualizer.setRunning(notes.size > 0 || Boolean(codeHost?.isRunning()) || Boolean(lastSongState?.playing) || Boolean(audition?.read().soundingCount));
  updateCapacity();
}
function readVoices(state) {
  const owners = new Set(state.voices.map(voice => voice.id));
  for (const [source, note] of notes) if (note.started && !owners.has(note.id)) notes.delete(source);
  updateKeys();
  updateCapacity();
}
function updateCapacity() {
  const trial=pausedSongVoice();
  $('dmgKeyboardHint').textContent=lastSongState?.paused&&isSongChannelView()?trial?.playable?`Paused VGM CH ${lastSongState.liveVoice+1} · keyboard audition · one physical voice${trial.source==='noise'?' · keys retrigger the same Noise':''}.`:trial?.reason??'Select a playable VGM channel.':lastSongState?.playing?'Pause to audition a song channel.':'Every key plays the selected source. No keyboard split.';
  if(isSongActive()&&isSongChannelView()){ $('voiceCapacity').textContent=`VGM CH ${lastSongState.liveVoice+1} · ${lastSongState.paused?'paused audition':'read-only'} · ${auditionNotes.size} held`; return; }
  if(codeHost?.isRunning()){ $('voiceCapacity').textContent='Code · physical CH1 / CH2 Pulse · CH3 Wave · CH4 Noise'; return; }
  const description = preset.source === 'pulse' ? preset.pulse.sweep.enabled ? 'Pulse · CH1 Sweep' : 'Pulse · CH1 / CH2'
    : preset.source === 'wave' ? 'Wave · CH3' : 'Noise · CH4 · keys trigger the same noise';
  $('voiceCapacity').textContent = `${description} · ${capacity()} ${capacity() === 1 ? 'voice' : 'voices'} · round robin · ${notes.size} held`;
}
function updatePresetUi() {
  if((!isSongActive()||!isSongChannelView())&&!codeLive?.read().liveActive) editor.update(preset);
  if (document.activeElement !== $('instrumentName')) $('instrumentName').value = preset.name;
  if (!$('codeOutput').hidden) $('codeOutput').value = presetToCode(preset);
  for (const [wheel] of pitchWheels) wheel.disabled = preset.source === 'noise';
  updateCapacity();
  if (!layout || keyboardSource !== preset.source) renderKeyboard();
  else updateKeys();
}
function audioFailed(error) {
  songControls?.stop();
  void stopAudition().catch(()=>{});
  epoch++;
  void codeHost?.stop();
  notes.clear(); updateKeys();
  const failed = audio; audio = null;
  visualizer.disconnect();
  if (failed) void failed.dispose().catch(() => {});
  $('startAudio').textContent = 'Enable audio';
  report(error);
}
async function ensureAudio() {
  if (disposed) throw new Error('DMG Synth is closed');
  if (!audio && !opening) {
    $('startAudio').disabled = true;
    status('Preparing DMG audio…');
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
        if (disposed) throw new Error('DMG Synth is closed');
        engine.setVolume(Number($('masterVolume').value));
        audio = engine;
        visualizer.connect(engine.context, engine.outputNode);
        $('startAudio').textContent = 'Audio ready';
        status('Audio ready · play the keyboard. Choose Pulse, Wave or Noise to explore.');
        return engine;
      } catch (error) {await engine.dispose(); throw error;}
    })().finally(() => {opening = null; $('startAudio').disabled = false;});
  }
  const engine = audio ?? await opening;
  await engine.resume();
  return engine;
}
async function applyPreset(value, {load = false, message, isCurrent = () => true, keepSongPaused = false} = {}) {
  const next = readPreset(value), request=++applySequence;
  if(!isCurrent())return false;
  const retainPause=lastSongState?.paused&&(keepSongPaused||!isSongChannelView());
  if(isSongActive()&&!retainPause&&!keepSongPaused)songControls?.stop();
  if(audition?.isRunning())await stopAudition();
  if(disposed||request!==applySequence||!isCurrent())return false;
  if(codeHost?.isRunning() || codeHost?.isCodeMode()&&!keepSongPaused) await codeHost.stop();
  if(disposed || request!==applySequence || !isCurrent())return false;
  const previous = preset;
  const replacesVoices = load || previous.source !== next.source || previous.pulse.sweep.enabled !== next.pulse.sweep.enabled
    || JSON.stringify(previous.wave.samples) !== JSON.stringify(next.wave.samples);
  if (replacesVoices) {epoch++;notes.clear();updateKeys();}
  preset = next; revision++;
  if(load || previous.source!==next.source)codeLive?.setVoice(next.source==='wave'?2:next.source==='noise'?3:0);
  const editRevision = revision;
  if (load || previous.source !== next.source) setPitchUi(0);
  updatePresetUi();
  codeHost?.markSoundDirty();
  if (!audio) {status(message ?? 'Instrument updated · enable audio, then play.'); return true;}
  return enqueue(async () => {
    const engine = audio;
    const current=()=>!disposed&&request===applySequence&&isCurrent()&&audio===engine&&revision===editRevision;
    if (!engine||!current()) return false;
    try {
      await engine.command(load ? 'loadPreset' : 'setPreset', [next]);
      if(!current())return false;
      if (load || previous.source !== next.source) await engine.command('setPitch', [0]);
      if(!current())return false;
      const state = await engine.read();
      if (!current()) return false;
      readVoices(state);
      visualizer.wake();
      status(message ?? 'Instrument updated · play a new note to hear envelope and Sweep edits.');
      return true;
    } catch (error) {
      if (current()) {
        const state=await engine.read();
        if(current()){preset=state.preset;updatePresetUi();}
      }
      throw error;
    }
  });
}
const editor = createEditor({root: $('voiceEditor'), onChange: value => {void applyPreset(value).catch(report);}, onError: report});
setupSynthMenu({document,window});
vgmImport = setupGameboyVgmImport({root:$('vgmImport'),onStatus:status,
  onSource:(source,options)=>codeHost.files.saveSongSource(source,options),
  onSounds:(sounds,options)=>codeHost.files.saveVgmSounds(sounds,options)});

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
function renderKeyboard() {
  {
    keyboardSource = preset.source;
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
  if(lastSongState?.seeking||lastSongState?.seekPreparing)return false;
  const hz = 440*2**((midi-69)/12);
  const trial=pausedSongVoice();
  if(lastSongState?.paused&&isSongChannelView()&&(!trial?.playable||lastSongState.capturing))return false;
  const source=trial?.source??preset.source;
  return midi>=0 && midi<=127 && (source==='noise' || hz>=(source==='wave'?32:64));
}
function press(source, entry) {
  if(lastSongState?.seekPreparing){status('Finishing the previous seek · try the keyboard again when ready.');return;}
  if(lastSongState?.paused&&isSongChannelView()){pressAudition(source,entry);return;}
  if(isSongActive()&&!lastSongState?.paused){status('Pause the VGM to audition a channel or play your edited instrument.');return;}
  if (switchingAudioOutput||codeHost?.isCodeMode()||notes.has(source)||!canPlay(entry.midi)) return;
  const note = {id:`gameboy-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch,started:false};
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
    status(preset.source==='noise' ? 'Noise triggered · pitch is set by Noise clock controls.' : `${midiToNoteName(note.midi)} · ${notes.size}/${capacity()} voices`);
  }).catch(error=>{if(notes.get(source)===note) notes.delete(source);updateKeys();report(error);});
}
function release(source) {
  if(auditionNotes.has(source)){const note=auditionNotes.get(source);auditionNotes.delete(source);updateKeys();void audition.noteOff(note.id).catch(report);return;}
  const note = notes.get(source);
  if (!note) return;
  notes.delete(source);updateKeys();
  if (note.started) void enqueue(async()=>{
    if (audio && note.epoch===epoch) {await audio.command('noteOff',[note.id]);updateCapacity();}
  });
}
function stopNotes(message) {
  epoch++; notes.clear(); auditionNotes.clear(); updateKeys();
  const retiring=audition?.stop();
  return enqueue(async()=>{await retiring;if(audio&&!codeHost?.isRunning()) await audio.command('stop'); if(!codeHost?.isRunning()&&!lastSongState?.playing)visualizer.stop();if(message) status(message);});
}
$('startAudio').addEventListener('click',()=>{$('startAudio').blur();void enqueue(ensureAudio).catch(report);});
$('stopAudio').addEventListener('click',()=>{$('stopAudio').blur();void stopAll('Stopped · instrument retained. Play to resume.').catch(report);});
for(const [id,delta] of [['octaveDown',-1],['octaveUp',1]]) $(id).addEventListener('click',()=>{
  $(id).blur();stopNotes();octave=Math.max(-2,Math.min(2,octave+delta));renderKeyboard();
});
function editing(target) {const control=target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');return control&&!control.matches?.('input[type="range"]');}
window.addEventListener('keydown',event=>{
  if(document.getElementById('spuFileContextMenu')?.hidden===false)return;
  if(codeHost?.isCodeMode()||event.ctrlKey||event.metaKey||event.altKey||editing(event.target)) return;
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
  if(lastSongState?.seekPreparing){setPitchUi(0);return;}
  if(lastSongState?.paused&&isSongChannelView()){
    if(pausedSongVoice()?.source==='noise'){setPitchUi(0);return;}
    void Promise.resolve().then(()=>audition?.setPitch(value)).catch(error=>{if(pitch===value)setPitchUi(previous);report(error);});return;
  }
  if(audio&&!codeHost?.isRunning()&&(!isSongActive()||lastSongState?.paused&&!isSongChannelView())) void enqueue(async()=>{
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
function commitName() {
  if($('instrumentName').readOnly)return;
  void applyPreset({...preset,name:$('instrumentName').value}).catch(report);$('instrumentName').blur();
}
$('instrumentName').addEventListener('change',commitName);
$('instrumentName').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitName();}});
function saveFile(name, text) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('savePreset').addEventListener('click',()=>{
  $('savePreset').blur();
  try{saveFile('dmg-voice.json',JSON.stringify(readPreset(preset),null,2)+'\n');status('Preset saved · Pulse, Wave, Noise and routing included.');}catch(error){report(error);}
});
$('loadPreset').addEventListener('click',()=>{$('loadPreset').blur();$('presetFileInput').click();});
$('presetFileInput').addEventListener('change',async()=>{
  const file=$('presetFileInput').files?.[0];$('presetFileInput').value='';$('presetFileInput').blur();
  if(!file) return;
  const token=++importSequence;
  try {
    if(!/\.json$/i.test(file.name))throw new Error('Choose a .json file for a DMG instrument.');
    if(file.size>65536) throw new Error('Preset must be at most 64 KiB');
    const next=readPreset(JSON.parse(await file.text()));
    if(disposed||token!==importSequence)return;
    const paths=await codeHost.files.importFiles([file],{isCurrent:()=>!disposed&&token===importSequence});
    if(disposed||token!==importSequence||!paths.length)return;
    codeHost.files.setVisible(true);
    status(`${next.name} added to Files · select its JSON to load it. Current instrument kept.`);
  }catch(error){if(!disposed&&token===importSequence)report(error);}
});
$('resetPreset').addEventListener('click',()=>{$('resetPreset').blur();void applyPreset(createDefaultPreset(),{load:true,message:'Instrument reset · Pulse ready.'}).catch(report);});
$('copyCode').addEventListener('click',async()=>{
  $('copyCode').blur();
  try {
    const code=presetToCode(preset);$('codeOutput').value=code;$('codeOutput').hidden=false;
    try{await navigator.clipboard.writeText(code);status('JavaScript copied · paste into Playground Game Boy mode.');}
    catch{status('JavaScript ready below · select and copy it into Playground Game Boy mode.');}
  }catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  if(event.persisted){void stopAll();return;}
  disposed=true;songControls?.dispose();void audition?.dispose().catch(()=>{});epoch++;applySequence++;notes.clear();codeLive?.dispose();monitorResize.disconnect();visualizer.dispose();editor.dispose();vgmImport.dispose();
  const closing=audio;
  void Promise.resolve(codeHost?.dispose()).catch(()=>{}).finally(()=>closing?.dispose()).catch(()=>{});
  audio=null;
});
async function stopAll(message) {
  songControls?.stop();
  await songControls?.whenIdle();
  await captureWork?.catch(()=>{});
  await stopAudition();
  await codeHost?.stop();
  await stopNotes(message);
  syncCodeActivity();
}
function renderCodeLive(state) {
  if(disposed)return;
  if(isSongActive()&&isSongChannelView()){renderSongLive(lastSongState);return;}
  const running=Boolean(codeHost?.isRunning()),readonly=running&&state.liveEnabled;
  $('dmgCodeLiveTools').hidden=isSongActive()||!codeHost?.isCodeMode()&&!running;
  $('dmgLiveEnabled').checked=state.liveEnabled;
  $('dmgLiveChannel').value=String(state.liveVoice);
  $('voiceEditor').inert=readonly;
  $('voiceEditor').dataset.readonly=String(readonly);
  $('voiceEditor').setAttribute('aria-label',readonly?'Read-only Code channel settings':'Instrument editor');
  $('instrumentName').readOnly=readonly;
  for(const [wheel] of pitchWheels)wheel.disabled=running||lastSongState?.playing||lastSongState?.seeking||lastSongState?.seekPreparing||preset.source==='noise';
  let view=null;
  if(state.liveActive){
    try{view=gameboyCodeLiveView(state.liveState,state.liveVoice,preset);}
    catch(error){$('dmgLiveStatus').textContent=`Code Live: ${error.message}`;return;}
  }
  const signature=JSON.stringify(view?.preset??preset)+':'+(view?.channel??'edit');
  if(signature!==liveSignature){editor.update(view?.preset??preset,{channel:view?.channel??null});liveSignature=signature;}
  $('dmgLiveStatus').textContent=state.liveError?state.liveMessage:!running?'Code stopped · edit your sound.':
    !state.liveEnabled?'Live Off · your edited sound. Editing stops Code.':state.liveWaiting?'Waiting for Code channel settings…':
    `Live · Code CH ${state.liveVoice+1} · read-only sent / configured settings`;
  $('dmgLiveReadout').textContent=view?.readout??'';
}
function isSongChannelView() {return lastSongState?.view!=='synth';}
function pausedSongVoice() {
  const state=lastSongState;
  if(!state?.paused||!isSongChannelView()||!state.liveState)return null;
  if(pausedVoiceCache?.snapshot===state.liveState&&pausedVoiceCache.channel===state.liveVoice)return pausedVoiceCache.voice;
  try{
    const voice=prepareGameboySongVoice(state.liveState,state.liveVoice);
    pausedVoiceCache={snapshot:state.liveState,channel:state.liveVoice,voice};return voice;
  }catch{return null;}
}
function getAuditionSelection() {
  const state=lastSongState;
  if(disposed||switchingAudioOutput||codeHost?.isRunning()||state?.capturing||!state?.paused||!isSongChannelView()||!state.liveState)return null;
  return {key:JSON.stringify([state.selectedPath,state.positionFrames,state.liveVoice]),snapshot:state.liveState,channel:state.liveVoice};
}
function showAuditionState(state) {
  if(disposed)return;
  const root=$('dmgSongPlayer');
  root.dataset.auditionState=state.state;root.dataset.auditionHeld=String(state.heldCount);root.dataset.auditionSounding=String(state.soundingCount);
  $('dmgSongAuditionStatus').textContent=state.active||state.error?state.message:'';
  updateKeys();
}
function syncAuditionSelection() {
  const key=getAuditionSelection()?.key??null;
  if(key===auditionSelectionKey)return;
  const hadSelection=auditionSelectionKey!==null;auditionSelectionKey=key;
  const hadAuthorNotes=notes.size>0;
  if(key!==null){epoch++;notes.clear();}
  auditionNotes.clear();setPitchUi(0);
  const retiring=hadSelection||audition?.isRunning()?audition?.stop():null;
  // Finish the old keyboard owner before either a new trial lease or normal
  // Synth notes can start. The paused song APU is never part of this queue.
  void enqueue(async()=>{
    await retiring;
    if(disposed||codeHost?.isRunning()||key===null)return;
    if(audio){if(hadAuthorNotes)await audio.command('stop');await audio.command('setPitch',[0]);}
  }).catch(report);
}
async function stopAudition() {
  auditionNotes.clear();
  await audition?.stop();
  if(!disposed)updateKeys();
}
function pressAudition(source,entry) {
  if(switchingAudioOutput||codeHost?.isCodeMode()||auditionNotes.has(source)||!canPlay(entry.midi))return;
  const prepared=pausedSongVoice();
  if(!prepared?.playable){status(prepared?.reason??'Select a playable paused song channel.');return;}
  const note={id:`dmg-trial:${++sequence}`,key:entry.key,midi:entry.midi};
  auditionNotes.set(source,note);updateKeys();
  const keyboardReady=queue,isCurrent=()=>!disposed&&auditionNotes.get(source)===note;
  void Promise.resolve().then(async()=>{
    await keyboardReady;
    return isCurrent()?audition.noteOn(note.id,note.midi,{isCurrent}):null;
  }).then(result=>{
    if(result?.stolenId)for(const [key,old] of auditionNotes)if(old.id===result.stolenId)auditionNotes.delete(key);
    if(!result&&auditionNotes.get(source)===note)auditionNotes.delete(source);
    updateKeys();
  }).catch(error=>{if(auditionNotes.get(source)===note)auditionNotes.delete(source);updateKeys();if(error.name!=='AbortError')report(error);});
}
function captureSongVoice(payload,options) {
  // Cancellation can unlock the controls before the first rollback finishes.
  // Keep its barrier until completion instead of replacing it with a retry.
  if(captureWork)return Promise.resolve(false);
  const work=performCaptureSongVoice(payload,options);
  captureWork=work;
  void work.then(()=>{if(captureWork===work)captureWork=null;},()=>{if(captureWork===work)captureWork=null;});
  return work;
}
async function performCaptureSongVoice(payload,{isCurrent=()=>true}={}) {
  const original=readPreset(preset),captured=readPreset(payload.preset);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  async function rollback(){
    if(disposed||!same(preset,captured)||same(original,captured))return;
    await applyPreset(original,{load:true,keepSongPaused:true,message:'Capture cancelled · original instrument kept.'});
  }
  try{
    await stopAudition();if(!isCurrent()||disposed)return false;
    const saved=await codeHost.files.saveCapturedSound(captured,{isCurrent,
      apply:(value,options)=>applyPreset(value,{...options,load:true,keepSongPaused:true,message:'Captured VGM sound · song remains paused.'})});
    if(!saved){await rollback();return false;}
    return saved;
  }catch(error){await rollback();throw error;}
}
function isSongActive() {
  return ['starting','loading','seeking','playing','paused'].includes(lastSongState?.playback);
}
function renderSongLive(state) {
  if(disposed||!state)return;
  $('dmgCodeLiveTools').hidden=true;
  $('voiceEditor').inert=true;
  $('voiceEditor').dataset.readonly='true';
  $('voiceEditor').setAttribute('aria-label','Read-only VGM channel settings');
  $('instrumentName').readOnly=true;
  for(const [wheel] of pitchWheels)wheel.disabled=!state.paused||!pausedSongVoice()?.playable||pausedSongVoice()?.source==='noise';
  let view=null;
  if(state.liveState){
    try{view=gameboyCodeLiveView(state.liveState,state.liveVoice,preset);}
    catch(error){$('dmgSongReadout').textContent=`VGM Live: ${error.message}`;return;}
  }
  const signature=JSON.stringify(view?.preset??preset)+':vgm:'+(view?.channel??'waiting');
  if(signature!==liveSignature){editor.update(view?.preset??preset,{channel:view?.channel??null,origin:'VGM'});liveSignature=signature;}
  $('dmgSongReadout').textContent=view?.readout??'';
}
function syncSongActivity(state) {
  lastSongState=state;
  if(disposed)return;
  $('dmgSongPlayer').dataset.renderedFrames=String(state.renderedFrames??0);
  $('dmgSongPlayer').dataset.sampleRate=String(state.sampleRate??44100);
  syncAuditionSelection();
  if(isSongActive()&&isSongChannelView())renderSongLive(state);
  else{
    $('dmgSongReadout').textContent='';
    if(codeLive)renderCodeLive(codeLive.read());
  }
  updateKeys();
}
function syncCodeActivity() {
  if(disposed)return;
  codeLive?.sync();
  if(codeLive)renderCodeLive(codeLive.read());
  updateKeys();
}
codeHost=setupGameboyCodeHost({ensureAudio,getAudio:()=>audio,getSettings:()=>readPreset(preset),
  applySettings:(value,options={})=>applyPreset(value,{load:true,message:'DMG preset loaded from Files · play the keyboard.',...options}),
  stopKeyboard:()=>stopNotes(),stopSong:async()=>{songControls?.stop();await songControls?.whenIdle();await captureWork?.catch(()=>{});await stopAudition();},beforeRun:async()=>{
    await queue;
    setPitchUi(0);
    // Clear the keyboard bend before the APU checkpoint is borrowed. Apply
    // keeps its existing Code lease and must not send a keyboard-only edit.
    if(audio&&!codeHost?.isRunning())await audio.command('setPitch',[0]);
  },
  onActivity:syncCodeActivity,setStatus:status});
codeLive=createGameboyCodeLive({getAudio:()=>audio,isRunning:()=>Boolean(codeHost?.isRunning()),onUpdate:renderCodeLive});
$('dmgLiveEnabled').addEventListener('change',()=>{codeLive.setEnabled($('dmgLiveEnabled').checked);$('dmgLiveEnabled').blur();});
$('dmgLiveChannel').addEventListener('change',()=>{codeLive.setVoice(Number($('dmgLiveChannel').value));$('dmgLiveChannel').blur();});
audition=createGameboySongAudition({ensureAudio,getAudio:()=>audio,getSelection:getAuditionSelection,onUpdate:showAuditionState});
songControls=setupGameboySongControls({project:codeHost.project,getAudio:ensureAudio,onCapture:captureSongVoice,
  beforePlay:async({isCurrent=()=>true}={})=>{
    if(!isCurrent()||disposed)return;
    await captureWork?.catch(()=>{});
    if(!isCurrent()||disposed)return;
    await stopAudition();
    if(!isCurrent()||disposed)return;
    await codeHost.stop();
    if(!isCurrent()||disposed)return;
    await stopNotes();
    if(!isCurrent()||disposed)return;
    setPitchUi(0);
    if(audio)await audio.command('setPitch',[0]);
  },
  onLiveView:syncSongActivity,onState:state=>{lastSongState=state;syncCodeActivity();},onStatus:status});
void codeHost.ready.then(()=>{if(!disposed)syncCodeActivity();}).catch(report);
updatePresetUi();setVolume();setPitchUi(0);syncCodeActivity();

// Desktop adapters change only the final Master bus. The DMG APU, allocator
// and output monitor keep using the same graph; ordinary sites expose no API.
const localDesktop = (location.protocol === 'tauri:' && location.hostname === 'localhost') ||
  (['http:', 'https:'].includes(location.protocol) && location.hostname === 'tauri.localhost');
if (window.top === window && localDesktop && window.__TAURI_INTERNALS__) {
  Object.defineProperty(window, 'tetoricaSynthAudio', {value:Object.freeze({
    setSwitching(value) {switchingAudioOutput = value === true;},
    async ensureReady() {const engine = await ensureAudio(); return {context:engine.context, output:engine.outputNode};},
    async stopPlayback() {
      setPitchUi(0);
      await stopAll();
      await enqueue(async () => {if (audio) await audio.command('setPitch', [0]);});
    },
  })});
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
