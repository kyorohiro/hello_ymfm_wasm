// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js';
import {createEditor} from './editor.js';
import {createDefaultPreset,readPreset,presetToCode} from './preset.js';
import {consumeSidPresetHandoff,stripSidPresetHandoffFragment} from './handoff.js';
import {createSidImport} from './sid_import.js';
import {createSidImportPanel} from './sid_import_panel.js';
import {createSidLiveView} from './sid_live_view.js';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';
import {createFretboardState,createFretboardLayout,renderFretboardControls,buildKeyboard,
  setInstrument,setFretPosition,setStringWindowIndex,midiToNoteName} from '../synth/synth_keyboard.js';

const $=id=>document.getElementById(id), notes=new Map(), fret=createFretboardState();
let audio=null, opening=null, disposed=false, generation=0, noteEpoch=0, sequence=0;
let preset=createDefaultPreset(), appliedPreset=readPreset(preset), revision=0, importSequence=0, octave=0, pitch=0;
let appliedPitch=0,pitchIntent=0,commandSequence=0,pitchAckSequence=0;
let resetIntent=0,appliedResetIntent=0,resetPitchIntent=0;
let sidImporter=null,previewEngine=null;
let queue=Promise.resolve(), layout;
const pitchWheels=[[$('pitchBend'),$('pitchValue')],[$('keyboardPitchBend'),$('keyboardPitchValue')]];
const visualizer=createSpuOutputVisualizer({canvas:$('outputCanvas')});visualizer.setMode('waveform');
const cancelled=error=>error?.name==='AbortError';
function status(text,error=false){if(disposed)return;$('audioStatus').textContent=text;$('audioStatus').dataset.error=String(error);}
function report(error){if(!cancelled(error))status(error?.message??String(error),true);}
function patchStatus(text,busy=false){$('patchStatus').textContent=text;$('patchStatus').dataset.busy=String(busy);$('voiceEditor').setAttribute('aria-busy',String(busy));}
function enqueue(action){const task=queue.then(action);queue=task.catch(report);return task;}
const paired=()=>preset.modulation.sync||preset.modulation.ring;
const capacity=()=>paired()?1:3;
function updateCapacity(){
  $('voiceCapacity').textContent=paired()
    ?`Voice 3 → voice 1 · silent Triangle modulator · maximum 1 note · ${notes.size} held`
    :`3 hardware voices · round robin · ${notes.size} held`;
  if(preset.voice.test)$('voiceCapacity').textContent+=' · TEST held';
}
function updateKeys(){
  const active=new Set([...notes.values()].map(note=>note.key));
  for(const button of $('keyboard').querySelectorAll('.key')){const on=active.has(button.dataset.key);button.classList.toggle('is-active',on);button.setAttribute('aria-pressed',String(on));}
  visualizer.setRunning(notes.size>0||Boolean(sidImporter?.read().playing));updateCapacity();refreshPlayableKeys();
}
function setPitchUi(value){pitch=value;for(const[wheel,output]of pitchWheels){wheel.value=String(value);output.textContent=`${value>=0?'+':''}${value.toFixed(2)}`;}}
function acceptPitch(state,order,intent=null){
  if(Number.isFinite(state?.pitch)&&order>=pitchAckSequence){appliedPitch=state.pitch;pitchAckSequence=order;}
  if(intent===pitchIntent){setPitchUi(appliedPitch);refreshPlayableKeys();}
}
function readVoices(state){
  if(!Array.isArray(state?.voices))return;
  const owners=new Set(state.voices.map(voice=>voice.id));
  for(const[source,note]of notes)if(note.started&&!owners.has(note.id))notes.delete(source);
  updateKeys();
}
function updatePresetUi(){
  editor.update(preset);if(document.activeElement!==$('instrumentName'))$('instrumentName').value=preset.name;
  $('sidModelBadge').textContent=preset.model;
  $('sidModelStatus').textContent=preset.model==='8580'?'PAL · PREVIEW':'PAL · APPROXIMATION';
  if(!$('codeOutput').hidden)$('codeOutput').value=presetToCode(preset);
  updateCapacity();refreshPlayableKeys();
}
function audioFailed(error,owner){
  if(disposed||owner!==audio&&owner!==opening?.engine&&owner!==opening)return;
  generation++;noteEpoch++;pitchIntent++;appliedPitch=0;notes.clear();setPitchUi(0);updateKeys();
  const failed=audio;audio=null;if(opening){const old=opening;opening=null;old.controller.abort();}
  visualizer.disconnect();if(failed)void failed.dispose().catch(()=>{});
  $('startAudio').disabled=false;$('startAudio').textContent='Enable audio';patchStatus('Audio unavailable · preset kept.');report(error);
}
async function ensureAudio(){
  if(disposed)throw new DOMException('SID Synth is closed','AbortError');
  if(!audio&&!opening){
    const owner={controller:new AbortController(),generation:++generation,engine:null,promise:null};opening=owner;
    $('startAudio').disabled=true;$('startAudio').textContent='Preparing…';status('Preparing SID audio…');
    owner.promise=(async()=>{
      let engine;
      try{
        engine=await createAudio({model:preset.model,volume:Number($('masterVolume').value),signal:owner.controller.signal,onError:error=>audioFailed(error,owner.engine??owner)});owner.engine=engine;
        let applied,snapshotPitch,appliedSnapshot,snapshotReset;
        do{
          owner.controller.signal.throwIfAborted();applied=revision;snapshotPitch=pitch;snapshotReset=resetIntent;
          appliedSnapshot=readPreset(preset);await engine.command('loadPreset',[appliedSnapshot]);
          await engine.command('setPitch',[snapshotPitch]);
        }while(applied!==revision||snapshotPitch!==pitch);
        if(disposed||opening!==owner||generation!==owner.generation)throw new DOMException('Audio preparation cancelled','AbortError');
        engine.setVolume(Number($('masterVolume').value));audio=engine;appliedPreset=appliedSnapshot;
        appliedPitch=snapshotPitch;pitchAckSequence=++commandSequence;appliedResetIntent=snapshotReset;
        visualizer.connect(engine.context,engine.outputNode);$('startAudio').textContent='Audio ready';patchStatus('Applied · edits are live.');
        status('Audio ready · play the keyboard. Explore the shared filter.');return engine;
      }catch(error){if(engine)await engine.dispose().catch(()=>{});throw error;}
      finally{if(opening===owner){opening=null;$('startAudio').disabled=false;if(!audio)$('startAudio').textContent='Enable audio';}}
    })();
  }
  const engine=audio??await opening.promise;
  if(disposed||audio!==engine)throw new DOMException('Audio preparation cancelled','AbortError');
  await engine.resume();return engine;
}
function clearNotes(){noteEpoch++;notes.clear();updateKeys();}
function topology(value){return `${value.model}/${value.modulation.sync}/${value.modulation.ring}/${value.voice.test}`;}
function applyPreset(value,{load=false,message}={}){
  const next=readPreset(value),previous=preset,changedTopology=load||topology(previous)!==topology(next);
  if(changedTopology){clearNotes();setPitchUi(0);resetPitchIntent=++pitchIntent;resetIntent++;}
  preset=next;const editRevision=++revision;updatePresetUi();
  if(!audio){patchStatus(opening?'Preparing latest edit…':'Ready · edits apply automatically.');status(message??'Instrument updated · enable audio, then play.');return Promise.resolve();}
  const target=audio;patchStatus('Applying latest edit…',true);
  return enqueue(async()=>{
    if(disposed||audio!==target||editRevision!==revision)return;
    try{
      // Coalescing a draft must preserve any earlier load/topology reset.
      const hardReset=resetIntent>appliedResetIntent,resetAtDispatch=resetIntent;
      const pitchAtDispatch=resetPitchIntent,order=++commandSequence;
      const state=await target.command(hardReset?'loadPreset':'setPreset',[next]);
      if(disposed||audio!==target)return;
      if(hardReset)appliedResetIntent=Math.max(appliedResetIntent,resetAtDispatch);
      appliedPreset=readPreset(state?.preset??next);acceptPitch(state,order,hardReset?pitchAtDispatch:null);readVoices(state);visualizer.wake();
      if(editRevision===revision){patchStatus('Applied · edits are live.');status(message??(hardReset?'Instrument updated · held notes and Pitch reset.':'Instrument updated · changes are live.'));}
    }catch(error){
      // A failed model allocation may already have stopped the previous core.
      // Recover its actual Pitch/owners rather than restoring the pre-swap bend.
      const recoveryOrder=++commandSequence,recoveryIntent=pitchIntent;
      const current=await target.read().catch(()=>null);
      if(audio===target&&current){
        appliedPreset=readPreset(current.preset??appliedPreset);
        acceptPitch(current,recoveryOrder,recoveryIntent);readVoices(current);
      }
      if(audio===target&&editRevision===revision){preset=readPreset(appliedPreset);revision++;updatePresetUi();patchStatus('Edit rejected · previous preset kept.');}
      throw error;
    }
  });
}
const editor=createEditor({root:$('voiceEditor'),onChange:value=>applyPreset(value),onError:report});
const sidLiveView=createSidLiveView({root:$('sidLiveView')});
const sidImportPanel=createSidImportPanel({root:$('sidImportTools'),liveRoot:$('sidLiveTools'),getController:()=>sidImporter});
sidImporter=createSidImport({
  getVolume:()=>Number($('masterVolume').value),
  getInstrumentRevision:()=>`${revision}/${importSequence}`,
  onUpdate(state){
    sidImportPanel.update(state);const observation=sidLiveView.update(state);
    const observing=Boolean(state.liveEnabled&&(state.playing||state.paused||state.pausing||state.resuming));
    editor.observe(observing?observation:null,{active:observing});
    $('sidLiveView').hidden=!observing;$('voiceCapacity').hidden=observing;$('patchStatus').hidden=observing;
    $('voiceHeading').textContent=observing?`Your sound · ${state.paused?'Paused':'Live'} CH ${(state.liveVoice??0)+1}`:'Your sound';
    if(previewEngine)visualizer.setRunning(Boolean(state.playing));
  },
  async onPreviewStart(engine,{isCurrent=()=>true}={}){
    if(disposed||!isCurrent())return;
    await stopNotes();
    if(disposed||!isCurrent()||engine.context.state==='closed')return;
    previewEngine=engine;visualizer.disconnect();visualizer.connect(engine.context,engine.outputNode);visualizer.setRunning(false);
  },
  onPreviewStop(engine){
    if(previewEngine!==engine)return;
    previewEngine=null;if(disposed)return;
    visualizer.setRunning(false);visualizer.disconnect();
    if(audio)visualizer.connect(audio.context,audio.outputNode);
    visualizer.setRunning(notes.size>0);
  },
  onUsePreset(value){importSequence++;return applyPreset(value,{load:true,message:'SID voice imported · play this keyboard, edit it or save a preset.'});},
});
function stopSongForKeyboard(){
  const state=sidImporter?.read();
  return state&&(state.playing||state.starting||state.paused||state.pausing||state.resuming)?sidImporter.stop({cancelLoad:false}):Promise.resolve();
}

const keyboard=document.createElement('div');keyboard.className='keyboard';$('keyboard').append(keyboard);
const tools=Object.fromEntries(['instrument','position','fret','strings','window'].map(name=>{const node=document.createElement('div');node.className=`fretboard-${name} ${['fret','strings'].includes(name)?'fret-display':'toolbar-group'}`;return[name,node];}));
const toolbar=document.createElement('div');toolbar.className='fretboard-toolbar';const summary=document.createElement('div');summary.className='fretboard-row fretboard-summary';summary.append(tools.fret,tools.strings);const choices=document.createElement('div');choices.className='fretboard-row';for(const name of ['instrument','position','window'])choices.append(tools[name]);toolbar.append(summary,choices);$('keyboardFretboard').append(toolbar);
function canPlay(midi){
  const hz=440*2**((midi-69+pitch)/12),source=paired()?hz*preset.modulation.ratio:hz;
  return midi>=0&&midi<=127&&hz>0&&Math.max(hz,source)<=65535*985248/16777216;
}
function refreshPlayableKeys(){if(!layout)return;const held=new Set([...notes.values()].map(note=>note.key));for(const button of keyboard.querySelectorAll('.key')){const entry=layout.entries.find(item=>item.key===button.dataset.key);button.disabled=!held.has(button.dataset.key)&&!canPlay(entry.midi+octave*12);button.title=button.disabled?'Outside this SID oscillator range. Lower the octave, Pitch or modulator ratio.':'';}}
function renderKeyboard(){
  layout=createFretboardLayout({state:fret});
  renderFretboardControls({instrumentRoot:tools.instrument,positionRoot:tools.position,fretDisplayRoot:tools.fret,stringDisplayRoot:tools.strings,stringWindowRoot:tools.window,state:fret,
    onInstrumentChange(value){void stopNotes();setInstrument(fret,value);renderKeyboard();},onPositionPresetSelect(value){void stopNotes();setFretPosition(fret,value);renderKeyboard();},onStringWindowChange(value){void stopNotes();setStringWindowIndex(fret,value);renderKeyboard();}});
  const entries=layout.entries.map(entry=>({...entry,midi:entry.midi+octave*12,noteName:midiToNoteName(entry.midi+octave*12)}));
  buildKeyboard({root:keyboard,rowDefs:layout.rowDefs,layoutEntries:entries,showPitch:false,onPointerDown(event,entry){if(event.button===0)press(`pointer:${event.pointerId}`,entry);},onPointerUp(event){release(`pointer:${event.pointerId}`);},onPointerCancel(event){release(`pointer:${event.pointerId}`);}});
  for(const button of keyboard.querySelectorAll('.key')){const entry=entries.find(item=>item.key===button.dataset.key);
    button.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();if(!event.repeat)press(`button:${entry.key}`,entry);}});
    button.addEventListener('keyup',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();release(`button:${entry.key}`);}});
    button.addEventListener('blur',()=>release(`button:${entry.key}`));
  }
  $('octaveValue').textContent=`${octave>=0?'+':''}${octave}`;$('octaveDown').disabled=octave<=-2;$('octaveUp').disabled=octave>=2;
  refreshPlayableKeys();updateKeys();
}
function press(source,entry){
  if(disposed||notes.has(source)||!canPlay(entry.midi))return;
  // Fence a pending song start synchronously, preserving this key's gesture.
  const songClosing=stopSongForKeyboard();
  const note={id:`sid-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch:noteEpoch,started:false};notes.set(source,note);updateKeys();
  const ready=ensureAudio();ready.catch(()=>{});
  void enqueue(async()=>{
    if(notes.get(source)!==note||note.epoch!==noteEpoch)return;
    await songClosing;
    const engine=await ready;if(disposed||audio!==engine||notes.get(source)!==note||note.epoch!==noteEpoch)return;
    note.started=true;await engine.command('noteOn',[note.id,note.midi]);
    if(audio!==engine||note.epoch!==noteEpoch)return;
    readVoices(await engine.read());visualizer.wake();status(`${midiToNoteName(note.midi)} · ${notes.size}/${capacity()} voices`);
  }).catch(error=>{if(notes.get(source)===note){notes.delete(source);updateKeys();}report(error);});
}
function release(source){
  const note=notes.get(source);if(!note)return;notes.delete(source);updateKeys();
  if(note.started)void enqueue(async()=>{const target=audio;if(target&&note.epoch===noteEpoch){await target.command('noteOff',[note.id]);visualizer.wake();}}).catch(()=>{});
}
async function stopNotes(message){
  clearNotes();setPitchUi(0);const stopPitchIntent=++pitchIntent;refreshPlayableKeys();
  if(opening){const old=opening;opening=null;generation++;old.controller.abort();$('startAudio').disabled=false;$('startAudio').textContent='Enable audio';}
  const target=audio,stoppedEpoch=noteEpoch;
  try{
    if(target){const order=++commandSequence,state=await target.command('stop');if(audio===target){acceptPitch(state,order,stopPitchIntent);if(noteEpoch===stoppedEpoch&&!notes.size)readVoices(state);}}
    // A Stop ACK belongs to the notes cleared above, never a later key press.
    if((!target||audio===target)&&noteEpoch===stoppedEpoch&&!notes.size){
      if(previewEngine&&sidImporter?.read().playing)visualizer.setRunning(true);
      else visualizer.stop();
      if(message)status(message);
    }
  }
  catch(error){report(error);}
}
$('startAudio').addEventListener('click',()=>{$('startAudio').blur();const closing=stopSongForKeyboard(),ready=ensureAudio();void Promise.all([closing,ready]).catch(report);});
$('stopAudio').addEventListener('click',()=>{$('stopAudio').blur();void sidImporter.stop().catch(report);void stopNotes('Stopped · preset kept. Play to resume.');});
for(const[id,delta]of [['octaveDown',-1],['octaveUp',1]])$(id).addEventListener('click',()=>{$(id).blur();void stopNotes();octave=Math.max(-2,Math.min(2,octave+delta));renderKeyboard();});
function editing(target){const control=target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');return control&&!control.matches?.('input[type="range"]');}
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||editing(event.target))return;
  const key=event.key.toLowerCase(),entry=layout.entries.find(item=>item.key===key);if(!entry)return;
  event.preventDefault();if(!event.repeat)press(`key:${event.code||key}`,{...entry,midi:entry.midi+octave*12});
});
window.addEventListener('keyup',event=>release(`key:${event.code||event.key.toLowerCase()}`));
window.addEventListener('blur',()=>{void stopNotes();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)void stopNotes();});
function setPitch(value){
  if(disposed)return;const request=++pitchIntent,epoch=noteEpoch;setPitchUi(value);refreshPlayableKeys();const target=audio;
  if(target)void enqueue(async()=>{
    if(audio!==target||epoch!==noteEpoch)return;
    try{const order=++commandSequence,state=await target.command('setPitch',[value]);if(audio===target){acceptPitch(state,order,request);if(epoch===noteEpoch)readVoices(state);visualizer.wake();}}
    catch(error){if(audio===target&&request===pitchIntent){setPitchUi(appliedPitch);refreshPlayableKeys();}throw error;}
  }).catch(()=>{});
}
for(const[wheel]of pitchWheels){wheel.addEventListener('input',()=>setPitch(Number(wheel.value)));for(const event of ['pointerup','pointercancel','lostpointercapture','change'])wheel.addEventListener(event,()=>{setPitch(0);wheel.blur();});wheel.addEventListener('keydown',event=>{if(event.key==='Home'||event.key==='Escape'){event.preventDefault();setPitch(0);wheel.blur();}});}
function setVolume(){const value=Number($('masterVolume').value),boosted=value>1;$('masterVolumeValue').textContent=`${Math.round(value*100)}%`;$('masterVolume').dataset.boosted=String(boosted);$('masterVolumeValue').dataset.boosted=String(boosted);audio?.setVolume(value);sidImporter?.setVolume(value);visualizer.wake();}
$('masterVolume').addEventListener('input',setVolume);$('masterVolume').addEventListener('change',()=>$('masterVolume').blur());
for(const button of document.querySelectorAll('[data-visual-mode]'))button.addEventListener('click',()=>{visualizer.setMode(button.dataset.visualMode);for(const peer of document.querySelectorAll('[data-visual-mode]'))peer.setAttribute('aria-pressed',String(peer===button));button.blur();});
const monitorResize=new ResizeObserver(()=>{const canvas=$('outputCanvas');if(!canvas.clientWidth||!canvas.clientHeight)return;canvas.width=Math.max(240,Math.round(canvas.clientWidth));canvas.height=Math.max(140,Math.round(canvas.clientHeight));visualizer.setMode(document.querySelector('[data-visual-mode][aria-pressed="true"]').dataset.visualMode);});monitorResize.observe($('outputCanvas'));
function commitName(){try{void applyPreset({...preset,name:$('instrumentName').value}).catch(()=>{});}catch(error){$('instrumentName').value=preset.name;report(error);}$('instrumentName').blur();}
$('instrumentName').addEventListener('change',commitName);$('instrumentName').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commitName();}});
$('savePreset').addEventListener('click',()=>{
  $('savePreset').blur();try{const url=URL.createObjectURL(new Blob([JSON.stringify(readPreset(preset),null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='tetorica-sid-voice.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('SID voice preset saved.');}catch(error){report(error);}
});
$('loadPreset').addEventListener('click',()=>{$('loadPreset').blur();$('presetFileInput').click();});
$('presetFileInput').addEventListener('cancel',()=>{$('presetFileInput').blur();status('Preset selection cancelled. Current preset kept.');});
$('presetFileInput').addEventListener('change',async()=>{
  const file=$('presetFileInput').files?.[0];$('presetFileInput').value='';$('presetFileInput').blur();if(!file){status('Preset selection cancelled. Current preset kept.');return;}
  const token=++importSequence,draftRevision=revision;
  try{if(file.size>65536)throw new Error('SID preset must be at most 64 KiB');const next=readPreset(await file.text());if(disposed||token!==importSequence||draftRevision!==revision)return;await applyPreset(next,{load:true,message:'SID preset loaded · play the keyboard.'});}
  catch(error){if(!disposed&&token===importSequence)status(`${error.message??error} Current preset kept.`,true);}
});
$('resetPreset').addEventListener('click',()=>{$('resetPreset').blur();void applyPreset(createDefaultPreset(),{load:true,message:'Reset · Saw ready.'}).catch(()=>{});});
$('copyCode').addEventListener('click',async()=>{
  $('copyCode').blur();try{const code=presetToCode(preset);$('codeOutput').value=code;$('codeOutput').hidden=false;try{await navigator.clipboard.writeText(code);status('JavaScript copied · paste into Playground C64 mode.');}catch{status('JavaScript ready below · select and copy into Playground C64 mode.');}}catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  if(event.persisted){void sidImporter.stop().catch(report);void stopNotes();return;}disposed=true;generation++;clearNotes();if(opening){opening.controller.abort();opening=null;}sidImportPanel.dispose();sidLiveView.dispose();void sidImporter.dispose();monitorResize.disconnect();visualizer.dispose();editor.dispose();const previous=audio;audio=null;if(previous)void previous.dispose().catch(()=>{});
});
function receivePlayerSnapshot(){
  const fragment=window.location?.hash;
  if(!fragment||!new URLSearchParams(fragment.slice(1)).has('sid-voice'))return;
  try{
    const incoming=consumeSidPresetHandoff(fragment);
    if(!incoming)return;
    // Startup has no audio engine. This changes authoring data only; the user
    // still enables audio or presses a key to audition the captured settings.
    void applyPreset(incoming,{load:true,message:'SID Player snapshot loaded · enable audio, then play. Envelope and pitch restart from this keyboard.'}).catch(report);
  }catch(error){status(`SID Player import failed: ${error.message??error}. Current preset kept.`,true);return;}
  try{
    const hash=stripSidPresetHandoffFragment(fragment);
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+hash);
  }catch{status('SID Player snapshot loaded. The URL token could not be cleared; it cannot import a second time.');}
}
renderKeyboard();updatePresetUi();setVolume();setPitchUi(0);receivePlayerSnapshot();
