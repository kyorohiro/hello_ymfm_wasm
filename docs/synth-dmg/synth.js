// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js?v=dmg-vgm-manual-1';
import {setupGameboyCodeHost} from './code_host.js?v=draft-reconnect-1';
import {createGameboyCodeLive,gameboyCodeLiveView} from './code_live.js?v=dmg-vgm-manual-1';
import {createEditor} from './editor.js?v=dmg-vgm-manual-1';
import {createGameboyCodeEdit,applyGameboyCodeEdit} from './code_parameter_edit.js?v=dmg-vgm-manual-1';
import {createGameboyChannelBank,readGameboyChannelBank,applyGameboyChannelEdit,updateGameboyChannelBank} from './channel_bank.js?v=dmg-vgm-manual-1';
import {setupGameboyVgmImport} from './vgm_library.js?v=dmg-vgm-manual-1';
import {setupSynthMenu} from '../synth/synth_menu.js';
import {setupGameboySongControls} from './song_controls.js?v=dmg-vgm-manual-1';
import {createGameboySongAudition} from './song_audition.js?v=dmg-vgm-manual-1';
import {prepareGameboySongVoice} from './song_voice.js?v=dmg-vgm-manual-1';
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
let channelBank=createGameboyChannelBank(preset),channelTarget='synth',autoUpdate=true,editorLive=null;
let queue = Promise.resolve(), captureWork = null;
let vgmImport = null, codeHost = null, codeLive = null, applySequence = 0, liveSignature = null, songControls = null, lastSongState = null, audition = null, auditionSelectionKey = null, pausedVoiceCache = null;
const notes = new Map(), auditionNotes = new Map(), vgmNotes = new Map(), fret = createFretboardState();
const pitchWheels = [[$('pitchBend'), $('pitchValue')], [$('keyboardPitchBend'), $('keyboardPitchValue')]];
const visualizer = createSpuOutputVisualizer({canvas: $('outputCanvas')});
visualizer.setMode('waveform');
const enqueue = action => {
  const task = queue.then(action);
  queue = task.catch(report);
  return task;
};
const capacity = () => channelTarget!=='synth'?1:preset.source === 'pulse' && !channelBank[0].pulse.sweep.enabled ? 2 : 1;
function updateKeys() {
  const keys = new Set([...notes.values(),...auditionNotes.values(),...vgmNotes.values()].map(note => note.key));
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
  if(state.channelPresets)channelBank=readGameboyChannelBank(state.channelPresets);
  const owners = new Set(state.voices.map(voice => voice.id));
  for (const [source, note] of notes) if (note.started && !owners.has(note.id)) notes.delete(source);
  updateKeys();
  updateCapacity();
}
function channelContext(){return isSongActive()?'vgm':codeHost?.isRunning()?'code':'synth';}
function selectedPreset(){return channelTarget==='synth'||channelContext()==='vgm'?readPreset(preset):readPreset(channelBank[channelTarget]);}
function updateCapacity() {
  const trial=pausedSongVoice();
  $('dmgKeyboardHint').textContent=lastSongState?.paused&&isSongChannelView()?trial?.playable?`Paused VGM CH ${lastSongState.liveVoice+1} · keyboard audition · one physical voice${trial.source==='noise'?' · keys retrigger the same Noise':''}.`:trial?.reason??'Select a playable VGM channel.':lastSongState?.playing?'Pause to audition a song channel.':'Every key plays the selected source. No keyboard split.';
  if(lastSongState?.playing){
    const target=keyboardTarget();
    $('voiceCapacity').textContent=`VGM + Keyboard · ${target.channel===null?`${target.source} round robin`:`CH ${target.channel+1}`} · ${vgmNotes.size} held`;
    $('dmgKeyboardHint').textContent=lastSongState.canInteract?'Keyboard and controls write to the same four song channels. Later VGM writes can change them again.':lastSongState.interactionMessage??'Finishing the song…';
    return;
  }
  if(isSongActive()&&isSongChannelView()){ $('voiceCapacity').textContent=`VGM CH ${lastSongState.liveVoice+1} · paused audition · ${auditionNotes.size} held`; return; }
  if(codeHost?.isRunning()){
    const target=keyboardTarget();
    $('voiceCapacity').textContent=target.channel===null?'Code + Keyboard · selected source · physical CH1–4':`Code + Keyboard · CH ${target.channel+1} · ${notes.size} held`;
    $('dmgKeyboardHint').textContent=target.channel===null?'Keyboard uses the selected source. Code continues; the latest Key On owns each physical channel.':`Keyboard plays CH ${target.channel+1}, using its live settings. The latest Key On owns this physical channel.`;
    return;
  }
  if(channelTarget!=='synth'){
    $('voiceCapacity').textContent=`CH ${channelTarget+1} · ${keyboardTarget().source} · ${notes.size} held`;
    $('dmgKeyboardHint').textContent='Display, controls and keyboard use this physical channel. Selecting it does not copy settings.';
    return;
  }
  const description = preset.source === 'pulse' ? preset.pulse.sweep.enabled ? 'Pulse · CH1 Sweep' : 'Pulse · CH1 / CH2'
    : preset.source === 'wave' ? 'Wave · CH3' : 'Noise · CH4 · keys trigger the same noise';
  $('voiceCapacity').textContent = `${description} · ${capacity()} ${capacity() === 1 ? 'voice' : 'voices'} · round robin · ${notes.size} held`;
}
function updatePresetUi() {
  renderChannelView();
  if (document.activeElement !== $('instrumentName')) $('instrumentName').value = preset.name;
  if (!$('codeOutput').hidden) $('codeOutput').value = presetToCode(preset);
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
          await engine.command('loadChannelBank',[readGameboyChannelBank(channelBank)]);
          await engine.command('setPitch', [appliedPitch]);
        } while (applied !== revision || appliedPitch !== pitch);
        if (disposed) throw new Error('DMG Synth is closed');
        engine.setVolume(Number($('masterVolume').value));
        audio = engine;
        visualizer.connect(engine.context, engine.outputNode);
        $('startAudio').textContent = 'Audio ready';
        status('Audio ready · play the keyboard. Choose Pulse, Wave or Noise to explore.');
        syncChannelObservers();renderChannelView();
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
  const retainPause=Boolean(lastSongState?.paused),retainSong=Boolean(lastSongState?.playing);
  const interactionRun=retainSong?lastSongState.interaction?.runId:null;
  if(isSongActive()&&!retainPause&&!retainSong&&!keepSongPaused)songControls?.stop();
  if(audition?.isRunning())await stopAudition();
  if(disposed||request!==applySequence||!isCurrent())return false;
  // Sound selection changes the existing Code chip. Only workspace/song/Stop
  // actions retire its runtime; retain this lease across the queued edit.
  const engineAtSelection=audio,keepCode=Boolean(engineAtSelection&&codeHost?.isRunning());
  const codeClient=keepCode?engineAtSelection.getGameboyClient():null;
  void codeClient?.catch(()=>{});
  const previous = preset;
  const replacesVoices = load || previous.source !== next.source || previous.pulse.sweep.enabled !== next.pulse.sweep.enabled
    || JSON.stringify(previous.wave.samples) !== JSON.stringify(next.wave.samples);
  // A rejected atomic Code edit leaves its keyboard leases alive. Keep their
  // key-up IDs until the acknowledged native state says they were retired.
  if (replacesVoices&&!keepCode) {epoch++;notes.clear();updateKeys();}
  let editRevision=revision;
  function publish(value,bank){
    channelBank=bank?readGameboyChannelBank(bank):updateGameboyChannelBank(channelBank,preset,value,{replace:load});
    preset=readPreset(value);revision++;editRevision=revision;
    if(load||previous.source!==preset.source)setPitchUi(0);
    updatePresetUi();codeHost?.markSoundDirty();
  }
  // During initial audio preparation ensureAudio adopts this latest draft.
  // An existing Code lease publishes only after its atomic sound commit.
  if(!keepCode)publish(next);
  if (!audio) {status(message ?? 'Instrument updated · enable audio, then play.'); return true;}
  return enqueue(async () => {
    const engine = audio;
    let client;
    const selected=()=>!disposed&&request===applySequence&&isCurrent()&&audio===engine&&revision===editRevision;
    const current=()=>!disposed&&request===applySequence&&isCurrent()&&audio===engine&&revision===editRevision
      &&(keepCode?engine===engineAtSelection&&codeHost?.isRunning()&&client?.isCurrent():!codeHost?.isRunning());
    async function reconcile(){
      if(!engine||!selected())return;
      const state=await engine.read();
      if(selected()){publish(state.preset,state.channelPresets);readVoices(state);}
    }
    try {
      client=codeClient?await codeClient:null;
      if (!engine||!current()) return false;
      if(keepCode)await engine.applyCodePreset(next,{isCurrent:current,replace:load});
      else await engine.command(load ? 'loadPreset' : 'setPreset', [next]);
      if(!current()){if(keepCode)await reconcile();return false;}
      if(keepCode)publish(next);
      if (!keepCode&&(load || previous.source !== next.source)) await engine.command('setPitch', [0]);
      if(!current())return false;
      const state = await engine.read();
      if (!current()) return false;
      readVoices(state);
      if(retainSong&&interactionRun!==null&&interactionRun!==undefined)songControls?.applyPreset(next,{previous,replace:load,runId:interactionRun});
      visualizer.wake();
      status(message ?? (retainSong?'Instrument updated · VGM continues; later song writes can change it again.':'Instrument updated · play a new note to hear envelope and Sweep edits.'));
      return true;
    } catch (error) {
      await reconcile();
      if(error.name==='AbortError')return false;
      throw error;
    }
  });
}
async function applyEditorChange(value,{previous,channel,origin}={}) {
  if(channel===null||channel===undefined)return applyPreset(value);
  const edit=createGameboyCodeEdit(previous,value,channel);
  if(!Object.keys(edit.changes).length)return true;
  if(origin==='VGM'||origin==='VGM live'||channelContext()==='vgm'){
    if(!lastSongState?.playing||!lastSongState.canInteract)return false;
    songControls.applyEdit(edit);visualizer.wake();status(`VGM CH ${channel+1} updated · playback continues.`);return true;
  }
  if(!audio){
    channelBank=applyGameboyChannelEdit(channelBank,edit);preset=applyGameboyCodeEdit(preset,edit);revision++;
    codeHost?.markSoundDirty();renderChannelView();return true;
  }
  // Keep successive knob edits in order; a later whole-instrument load may
  // cancel them, but a second field edit must not discard the first field.
  const code=Boolean(codeHost?.isRunning()),engine=audio,request=applySequence,client=code?engine.getGameboyClient():null;
  void client?.catch(()=>{});
  return enqueue(async()=>{
    let lease;
    const current=()=>!disposed&&audio===engine&&request===applySequence&&(code?lease?.isCurrent()&&codeHost?.isRunning():!codeHost?.isRunning());
    try{
      if(client)lease=await client;
      if(!current())return false;
      const state=code?await engine.applyCodeEdit(edit,{isCurrent:current}):await engine.applyChannelEdit(edit,{isCurrent:current});
      if(disposed||audio!==engine||request!==applySequence)return false;
      preset=readPreset(state.preset);revision++;readVoices(state);codeHost.markSoundDirty();
      visualizer.wake();
      status(`CH ${channel+1} updated${code?' · Code continues':''}.`);
      const observer=code?codeLive:editorLive;
      if(autoUpdate)void observer?.refresh().catch(report);
      else observer?.commitEdit(edit);
      return true;
    }catch(error){
      // A Stop can win after the native edit commits but before its reply.
      if(!disposed&&audio===engine&&request===applySequence){
        const state=await engine.read();
        if(!disposed&&audio===engine&&request===applySequence){preset=readPreset(state.preset);revision++;readVoices(state);codeHost.markSoundDirty();updatePresetUi();}
      }
      if(error.name==='AbortError')return false;
      throw error;
    }
  });
}
const editor = createEditor({root: $('voiceEditor'), onChange: applyEditorChange, onError: report});
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
  if(isSongActive()&&!lastSongState?.paused&&(!lastSongState?.playing||!lastSongState.canInteract))return false;
  const hz = 440*2**((midi-69)/12);
  const trial=pausedSongVoice();
  if(lastSongState?.paused&&isSongChannelView()&&(!trial?.playable||lastSongState.capturing))return false;
  const source=trial?.source??keyboardTarget().source;
  return midi>=0 && midi<=127 && (source==='noise' || hz>=(source==='wave'?32:64));
}
function keyboardTarget(){
  const channel=channelTarget==='synth'?null:channelTarget;
  return {channel,source:channel===null?preset.source:channel<2?'pulse':channel===2?'wave':'noise'};
}
function pressVgm(source,entry){
  if(switchingAudioOutput||codeHost?.isCodeMode()||vgmNotes.has(source)||!canPlay(entry.midi))return;
  const note={id:`dmg-vgm-key:${++sequence}`,key:entry.key,midi:entry.midi};
  vgmNotes.set(source,note);
  try{
    const result=songControls.noteOn(note.id,note.midi,keyboardTarget());
    if(!result){vgmNotes.delete(source);updateKeys();return;}
    if(result.stolenId)for(const [key,old]of vgmNotes)if(old.id===result.stolenId)vgmNotes.delete(key);
    updateKeys();status(`VGM CH ${result.channel+1} · keyboard plays alongside the song.`);
  }catch(error){vgmNotes.delete(source);updateKeys();report(error);}
}
function press(source, entry) {
  if(lastSongState?.seekPreparing){status('Finishing the previous seek · try the keyboard again when ready.');return;}
  if(lastSongState?.playing){pressVgm(source,entry);return;}
  if(lastSongState?.paused&&isSongChannelView()){pressAudition(source,entry);return;}
  if(isSongActive()&&!lastSongState?.paused)return;
  if (switchingAudioOutput||codeHost?.isCodeMode()||notes.has(source)||!canPlay(entry.midi)) return;
  const note = {id:`gameboy-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch,started:false};
  notes.set(source,note); updateKeys();
  void enqueue(async () => {
    if (switchingAudioOutput || notes.get(source)!==note || note.epoch!==epoch) return;
    const engine = await ensureAudio();
    if (switchingAudioOutput||notes.get(source)!==note||note.epoch!==epoch) return;
    note.started = true;
    const target=keyboardTarget();
    const result = await engine.command('noteOn',[note.id,note.midi,...(target.channel===null?[]:[{channel:target.channel}])]);
    if (audio!==engine||note.epoch!==epoch) return;
    if (result.stolenId) for (const [key,old] of notes) if (old.id===result.stolenId) notes.delete(key);
    readVoices(await engine.read());
    status(target.source==='noise' ? 'Noise triggered · pitch is set by Noise clock controls.' : `${midiToNoteName(note.midi)} · ${notes.size}/${capacity()} voices`);
  }).catch(error=>{if(notes.get(source)===note) notes.delete(source);updateKeys();report(error);});
}
function release(source) {
  if(vgmNotes.has(source)){const note=vgmNotes.get(source);vgmNotes.delete(source);if(!disposed)songControls?.noteOff(note.id);updateKeys();return;}
  if(auditionNotes.has(source)){const note=auditionNotes.get(source);auditionNotes.delete(source);updateKeys();void audition.noteOff(note.id).catch(report);return;}
  const note = notes.get(source);
  if (!note) return;
  notes.delete(source);updateKeys();
  if (note.started) void enqueue(async()=>{
    if (audio && note.epoch===epoch) {await audio.command('noteOff',[note.id]);updateCapacity();}
  });
}
function stopNotes(message) {
  epoch++; notes.clear(); auditionNotes.clear();vgmNotes.clear();if(!disposed)songControls?.releaseKeyboard();updateKeys();
  const retiring=audition?.stop();
  return enqueue(async()=>{await retiring;if(audio)await audio.command(codeHost?.isRunning()?'releaseKeyboard':'stop');if(!codeHost?.isRunning()&&!lastSongState?.playing)visualizer.stop();if(message) status(message);});
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
  if(lastSongState?.playing){
    if(keyboardTarget().source==='noise'){setPitchUi(0);return;}
    try{songControls?.setPitch(value);visualizer.wake();}catch(error){setPitchUi(previous);report(error);}return;
  }
  if(lastSongState?.paused&&isSongChannelView()){
    if(pausedSongVoice()?.source==='noise'){setPitchUi(0);return;}
    void Promise.resolve().then(()=>audition?.setPitch(value)).catch(error=>{if(pitch===value)setPitchUi(previous);report(error);});return;
  }
  if(audio&&(!isSongActive()||lastSongState?.paused&&!isSongChannelView())) void enqueue(async()=>{
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
  try{saveFile('dmg-voice.json',JSON.stringify(selectedPreset(),null,2)+'\n');status('Preset saved · Pulse, Wave, Noise and routing included.');}catch(error){report(error);}
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
    const code=presetToCode(selectedPreset());$('codeOutput').value=code;$('codeOutput').hidden=false;
    try{await navigator.clipboard.writeText(code);status('JavaScript copied · paste into Playground Game Boy mode.');}
    catch{status('JavaScript ready below · select and copy it into Playground Game Boy mode.');}
  }catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  if(event.persisted){void stopAll();return;}
  disposed=true;songControls?.dispose();void audition?.dispose().catch(()=>{});epoch++;applySequence++;notes.clear();vgmNotes.clear();codeLive?.dispose();editorLive?.dispose();monitorResize.disconnect();visualizer.dispose();editor.dispose();vgmImport.dispose();
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
function renderCodeLive() {renderChannelView();}
function renderChannelView(){
  if(disposed)return;
  const context=channelContext(),ch=channelTarget==='synth'?null:channelTarget,song=lastSongState;
  const observed=context==='code'?codeLive?.read():context==='synth'?editorLive?.read():null;
  const snapshot=context==='vgm'?song?.liveState:observed?.liveState;
  const blocked=context==='vgm'&&(Boolean(song?.seeking||song?.seekPreparing||song?.capturing)||song?.playing&&!song.canInteract||ch!==null&&!song?.playing)||context==='code'&&ch!==null&&!snapshot;
  $('dmgChannelSelect').value=String(channelTarget);
  $('dmgChannelSelect').disabled=Boolean(song?.capturing||song?.seeking);
  $('dmgAutoUpdate').checked=autoUpdate;
  $('dmgAutoUpdate').disabled=ch===null||Boolean(song?.capturing||song?.seeking);
  $('dmgSongCaptureButton').hidden=context!=='vgm';
  $('voiceEditor').inert=blocked;$('voiceEditor').dataset.readonly=String(blocked);
  $('voiceEditor').setAttribute('aria-label',context==='vgm'&&ch!==null?blocked?'Read-only paused VGM channel settings':`Edit playing VGM CH ${ch+1}`:ch===null?'Round robin instrument editor':`Edit CH ${ch+1}`);
  $('instrumentName').readOnly=ch!==null;
  for(const [wheel]of pitchWheels)wheel.disabled=Boolean(song?.seeking||song?.seekPreparing)||context==='vgm'&&(song?.playing?!song.canInteract:!song?.paused||ch!==null&&!pausedSongVoice()?.playable)||keyboardTarget().source==='noise';
  let value=preset,readout='',origin='Synth';
  if(ch!==null){
    if(snapshot){
      try{const view=gameboyCodeLiveView(snapshot,ch,preset);readout=view.readout;if(context!=='synth')value=view.preset;}
      catch(error){readout=error.message;}
    }
    if(context==='synth')value=channelBank[ch];
    origin=context==='vgm'?song?.playing?'VGM live':'VGM':context==='code'?'Code':'Synth';
  }
  const targetKey=`${context}:${channelTarget}${context==='vgm'?song?.playing?':playing':':paused':''}`,signature=JSON.stringify(value)+':'+targetKey;
  const sameTarget=liveSignature?.endsWith(':'+targetKey);
  if(signature!==liveSignature&&(!editor.isInteracting()||!sameTarget)){editor.update(value,{channel:ch,origin});liveSignature=signature;}
  const mixed=ch===null&&preset.source==='pulse'&&!channelBank[0].pulse.sweep.enabled&&
    JSON.stringify([channelBank[0].pulse.duty,channelBank[0].pulse.volume,channelBank[0].pulse.envelope,channelBank[0].pan])!==JSON.stringify([channelBank[1].pulse.duty,channelBank[1].pulse.volume,channelBank[1].pulse.envelope,channelBank[1].pan]);
  const source=context==='vgm'?`VGM · ${song?.paused?'Paused':song?.seeking?'Seeking':'Playing'}`:context==='code'?'Code · Run continues':'Synth';
  const target=ch===null?'Synth (Round robin)':`CH${ch+1} · ${ch<2?'Pulse':ch===2?'Wave':'Noise'}`;
  const mode=context==='vgm'&&song?.playing? song.canInteract?'edit and play · VGM continues':song.interactionMessage??'Finishing the song…':ch===null?`edit common instrument${mixed?' · mixed CH settings':''}`:context==='vgm'?'read-only · keyboard auditions this CH':context==='code'&&!snapshot?'waiting for channel settings…':'edit and play this CH';
  $('dmgChannelStatus').textContent=`${source} · ${target} · ${mode}${ch!==null&&!autoUpdate?' · Auto update Off':''}`;
  $('dmgChannelReadout').textContent=readout;
  updateKeys();
}
async function setChannelTarget(value,{fromSong=false}={}){
  const target=value==='synth'?'synth':Number(value);
  if(target!=='synth'&&(!Number.isInteger(target)||target<0||target>3))throw new RangeError('Choose Synth or CH1–CH4');
  if(target===channelTarget){renderChannelView();return;}
  channelTarget=target;
  if(!fromSong)songControls?.setView(target,{notify:false});
  if(target!=='synth'){codeLive?.setVoice(target);editorLive?.setVoice(target);}
  syncChannelObservers();syncAuditionSelection();renderChannelView();
  const observer=channelContext()==='code'?codeLive:channelContext()==='synth'?editorLive:null;
  if(target!=='synth'&&!observer?.read().liveState)await observer?.refresh();
}
function syncChannelObservers(){
  const enabled=autoUpdate&&channelTarget!=='synth';
  codeLive?.setEnabled(enabled);editorLive?.setEnabled(enabled);codeLive?.sync();editorLive?.sync();
  const observer=channelContext()==='code'?codeLive:channelContext()==='synth'?editorLive:null;
  if(channelTarget!=='synth'&&!observer?.read().liveState)void observer?.refresh().catch(report);
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
  const original=readPreset(preset),originalBank=readGameboyChannelBank(channelBank),captured=readPreset(payload.preset);
  let applied=false;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  async function rollback(){
    if(disposed||!applied||!same(preset,captured))return;
    const restoring=applyPreset(original,{load:true,keepSongPaused:true,message:'Capture cancelled · original instrument kept.'});
    const request=applySequence;
    if(await restoring===false||disposed||request!==applySequence)return;
    channelBank=originalBank;revision++;
    const engine=audio;
    if(engine){const state=await engine.command('loadChannelBank',[originalBank]);if(!disposed&&audio===engine&&request===applySequence)readVoices(state);}
    if(!disposed&&request===applySequence)renderChannelView();
  }
  try{
    await stopAudition();if(!isCurrent()||disposed)return false;
    const saved=await codeHost.files.saveCapturedSound(captured,{isCurrent,
      apply:async(value,options)=>{applied=true;return applyPreset(value,{...options,load:true,keepSongPaused:true,message:'Captured VGM sound · song remains paused.'});}});
    if(!saved){await rollback();return false;}
    return saved;
  }catch(error){await rollback();throw error;}
}
function isSongActive() {
  return ['starting','loading','seeking','playing','paused'].includes(lastSongState?.playback);
}
function renderSongLive(){renderChannelView();}
function syncSongActivity(state){
  lastSongState=state;if(disposed)return;
  if(!state.playing)vgmNotes.clear();
  else if(state.interaction){const owners=new Set(state.interaction.voices.map(voice=>voice.id));for(const [key,note]of vgmNotes)if(!owners.has(note.id))vgmNotes.delete(key);}
  $('dmgSongPlayer').dataset.renderedFrames=String(state.renderedFrames??0);
  $('dmgSongPlayer').dataset.sampleRate=String(state.sampleRate??44100);
  syncAuditionSelection();syncChannelObservers();renderChannelView();
}
function syncCodeActivity(){if(disposed)return;syncChannelObservers();renderChannelView();}
codeHost=setupGameboyCodeHost({ensureAudio,getAudio:()=>audio,getSettings:selectedPreset,
  applySettings:(value,options={})=>applyPreset(value,{load:true,message:'DMG preset loaded from Files.',...options}),
  stopKeyboard:()=>stopNotes(),stopSong:async()=>{songControls?.stop();await songControls?.whenIdle();await captureWork?.catch(()=>{});await stopAudition();},beforeRun:async()=>{
    await queue;
    setPitchUi(0);
    // Clear the keyboard bend before the APU checkpoint is borrowed. Apply
    // keeps its existing Code lease and must not send a keyboard-only edit.
    if(audio&&!codeHost?.isRunning())await audio.command('setPitch',[0]);
  },
  beforeSoundApply:async()=>{songControls?.cancelPendingCapture();await captureWork?.catch(()=>{});await songControls?.whenIdle();await stopAudition();},
  onActivity:syncCodeActivity,setStatus:status});
codeLive=createGameboyCodeLive({getAudio:()=>audio,isRunning:()=>Boolean(codeHost?.isRunning()),onUpdate:renderCodeLive,retainSnapshot:true});
editorLive=createGameboyCodeLive({getAudio:()=>audio,isRunning:()=>Boolean(audio&&channelContext()==='synth'),onUpdate:renderCodeLive,method:'observeEditor',retainSnapshot:true});
$('dmgChannelSelect').addEventListener('change',()=>{const value=$('dmgChannelSelect').value;$('dmgChannelSelect').blur();void setChannelTarget(value).catch(report);});
$('dmgAutoUpdate').addEventListener('change',()=>{autoUpdate=$('dmgAutoUpdate').checked;$('dmgAutoUpdate').blur();songControls?.setLiveEnabled(autoUpdate);syncChannelObservers();renderChannelView();});
audition=createGameboySongAudition({ensureAudio,getAudio:()=>audio,getSelection:getAuditionSelection,onUpdate:showAuditionState});
songControls=setupGameboySongControls({project:codeHost.project,getAudio:ensureAudio,onCapture:captureSongVoice,
  channelElement:null,liveElement:null,initialView:channelTarget,initialLiveEnabled:autoUpdate,
  onViewChange:(target)=>{void setChannelTarget(target,{fromSong:true}).catch(report);},
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
