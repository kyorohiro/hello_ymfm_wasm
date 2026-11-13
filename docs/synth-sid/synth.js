// SPDX-License-Identifier: BSD-3-Clause
import {createAudio} from './audio.js?sid-channels=3&sid-waves=1&sid-keys=1&sid-code=1&sid-code-live=1&sid-live-preset=2&sid-code-keyboard=1';
import {createEditor} from './editor.js?sid-song-manual=1';
import {createDefaultPreset,readPreset,presetToCode} from './preset.js?sid-waves=1';
import {createChannelSettings,readChannelSettings,selectedChannelPreset,selectChannelTarget,selectKeyboardMode,applyChannelPreset,editChannelPreset,channelPlaybackPlan,channelSettingsToCode} from './channel_settings.js?sid-channels=3&sid-waves=1&sid-keys=1';
import {captureSidVoices} from '../sid-player/voice_snapshot.js?sid-waves=1';
import {consumeSidPresetHandoff,stripSidPresetHandoffFragment} from './handoff.js?sid-waves=1';
import {createSidImport} from './sid_import.js?sid-song-manual=1';
import {createSidImportPanel} from './sid_import_panel.js?sid-channels=2&sid-code-live=1';
import {createSidLiveView} from './sid_live_view.js?sid-song-manual=1';
import {setupSidCodeHost} from './code_host.js?sid-song-manual=1';
import {createSidCodeLive} from './code_live.js?sid-code-live=1&sid-code-keyboard=1';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';
import {createFretboardState,createFretboardLayout,renderFretboardControls,buildKeyboard,
  setInstrument,setFretPosition,setStringWindowIndex,midiToNoteName} from '../synth/synth_keyboard.js';

const $=id=>document.getElementById(id), notes=new Map(), fret=createFretboardState();
let audio=null, opening=null, disposed=false, generation=0, noteEpoch=0, sequence=0;
let channelSettings=createChannelSettings(),appliedChannelSettings=readChannelSettings(channelSettings);
let preset=selectedChannelPreset(channelSettings), appliedPreset=readPreset(preset), revision=0, manualRevision=0, importSequence=0, octave=0, pitch=0;
let appliedPitch=0,pitchIntent=0,commandSequence=0,pitchAckSequence=0;
let resetIntent=0,appliedResetIntent=0,resetPitchIntent=0;
let sidImporter=null,previewEngine=null;
let switchingAudioOutput=false,desktopOutputHandler=null;
let songTarget=0,pausedKeyboard=false,lastSongPaused=false;
let codeHost=null,codeLive=null;
let queue=Promise.resolve(), layout;
const pitchWheels=[[$('pitchBend'),$('pitchValue')],[$('keyboardPitchBend'),$('keyboardPitchValue')]];
const visualizer=createSpuOutputVisualizer({canvas:$('outputCanvas')});visualizer.setMode('waveform');
const cancelled=error=>error?.name==='AbortError';
function status(text,error=false){if(disposed)return;$('audioStatus').textContent=text;$('audioStatus').dataset.error=String(error);}
function report(error){if(!cancelled(error))status(error?.message??String(error),true);}
function patchStatus(text,busy=false){$('patchStatus').textContent=text;$('patchStatus').dataset.busy=String(busy);$('voiceEditor').setAttribute('aria-busy',String(busy));}
function enqueue(action){const task=queue.then(action);queue=task.catch(report);return task;}
async function prepareDesktopOutput(engine,isCurrent){
  if(desktopOutputHandler&&isCurrent())await desktopOutputHandler({context:engine.context,output:engine.outputNode},{isCurrent});
}
const paired=()=>channelPlaybackPlan(channelSettings).source!==null;
const capacity=()=>channelPlaybackPlan(channelSettings).channels.length;
const legato=()=>channelSettings.target!=='round-robin'&&channelSettings.keyboardMode==='legato';
const heldKeys=()=>`${notes.size} ${notes.size===1?'key':'keys'} held`;
const songOpen=(state=sidImporter?.read())=>Boolean(state&&(state.playing||state.paused||state.pausing||state.resuming||state.starting));
const songChannel=(state=sidImporter?.read())=>songOpen(state)&&songTarget!=='round-robin';
function updateNoteStatus(midi){
  if(legato()){
    const current=[...notes.values()].filter(note=>note.started).at(-1);
    status(`${current?midiToNoteName(current.midi)+' · ':''}Legato · ${heldKeys()} · 1 voice`);
  }else status(`${midiToNoteName(midi)} · ${notes.size}/${capacity()} voices`);
}
function updateCapacity(){
  if(codeHost?.isCodeMode()){$('voiceCapacity').textContent='Code · explicit CH 1 / 2 / 3 · one shared hardware filter';return;}
  const {carrier,source}=channelPlaybackPlan(channelSettings);
  const mode=channelSettings.target==='round-robin'?'':` · ${legato()?'Legato':'Retrigger'}`;
  $('voiceCapacity').textContent=paired()
    ?`CH ${source+1} → CH ${carrier+1} · silent Triangle modulator${mode} · maximum 1 note · ${heldKeys()}`
    :channelSettings.target==='round-robin'?`3 hardware voices · round robin · ${notes.size} held`
      :`CH ${carrier+1}${mode} · maximum 1 note · ${heldKeys()}`;
  if(preset.voice.test)$('voiceCapacity').textContent+=' · TEST held';
}
function updateKeys(){
  const active=new Set([...notes.values()].map(note=>note.key));
  for(const button of $('keyboard').querySelectorAll('.key')){const on=active.has(button.dataset.key);button.classList.toggle('is-active',on);button.setAttribute('aria-pressed',String(on));}
  const coding=Boolean(codeHost?.isCodeMode());
  for(const[wheel]of pitchWheels)wheel.disabled=coding;
  visualizer.setRunning(notes.size>0||Boolean(sidImporter?.read().playing)||Boolean(codeHost?.isRunning()));updateCapacity();refreshPlayableKeys();
}
function setPitchUi(value){pitch=value;for(const[wheel,output]of pitchWheels){wheel.value=String(value);output.textContent=`${value>=0?'+':''}${value.toFixed(2)}`;}}
function acceptPitch(state,order,intent=null){
  if(Number.isFinite(state?.pitch)&&order>=pitchAckSequence){appliedPitch=state.pitch;pitchAckSequence=order;}
  if(intent===pitchIntent){setPitchUi(appliedPitch);refreshPlayableKeys();}
}
function readVoices(state){
  if(!Array.isArray(state?.voices))return;
  const owners=new Set(state.voices.map(voice=>voice.id));
  for(const[source,note]of notes)if(note.owner!=='song'&&note.started&&!owners.has(note.id))notes.delete(source);
  updateKeys();
}
function updateLiveDisplay(song=sidImporter?.read()??{}){
  if(disposed)return null;
  const coding=Boolean(codeHost?.isRunning()),state=coding?codeLive.read():song;
  const observing=coding?state.liveEnabled:songChannel(state);
  const observation=sidLiveView.update(state);
  editor.observe(observing?observation:null,{active:observing,editable:coding||Boolean(state.manualReady&&songChannel(state))});
  const displayModel=observing&&observation?observation.model:preset.model;
  $('sidModelBadge').textContent=displayModel;
  $('sidModelStatus').textContent=displayModel==='8580'?'PAL · PREVIEW':'PAL · APPROXIMATION';
  $('instrumentName').disabled=observing;
  $('sidLiveView').hidden=!observing;$('voiceCapacity').hidden=observing;$('patchStatus').hidden=observing;
  $('sidLiveEnabled').checked=coding?state.liveEnabled:state.liveEnabled!==false;
  const label=$('sidLiveEnabledLabel'),labelText=coding?'Live from Code':'Auto update from song';
  if(label.textContent!==labelText)label.textContent=labelText;
  const channelLabel=$('sidLiveChannelLabel'),channelText=coding?'Code view':songOpen(song)?'Song CH / Synth':'Edit & play';
  if(channelLabel.textContent!==channelText)channelLabel.textContent=channelText;
  $('sidKeyboardMode').hidden=coding||songChannel(song);
  for(const button of document.querySelectorAll('[data-sid-live-voice]')){
    button.hidden=coding&&button.dataset.sidLiveVoice==='round-robin';
    button.setAttribute('aria-pressed',String(button.dataset.sidLiveVoice===String(coding?state.liveVoice:songOpen(song)?songTarget:channelSettings.target)));
    if(button.dataset.sidLiveVoice==='round-robin')button.textContent=songOpen(song)?'Synth · Round robin':'Round robin';
  }
  const mixed=channelSettings.target==='round-robin'&&channelSettings.channels.some(value=>JSON.stringify([value.voice,value.modulation])!==JSON.stringify([preset.voice,preset.modulation]));
  $('sidChannelState').hidden=observing||!mixed;
  const editingHeading=channelSettings.target==='round-robin'?'Your sound · Round robin':`Your sound · CH ${channelSettings.target+1}`;
  $('voiceHeading').textContent=observing
    ?coding?`Your sound · Code Live CH ${state.liveVoice+1}`:`Your sound · ${state.paused?'Paused':state.liveEnabled?'Live':'Frozen'} CH ${(state.liveVoice??0)+1}`
    :editingHeading;
  return observation;
}
function codeActivity(){if(disposed)return;updateKeys();visualizer.wake();codeLive?.sync();updateLiveDisplay();}
function updatePresetUi(){
  editor.update(preset);if(document.activeElement!==$('instrumentName'))$('instrumentName').value=preset.name;
  $('sidModelBadge').textContent=preset.model;
  $('sidModelStatus').textContent=preset.model==='8580'?'PAL · PREVIEW':'PAL · APPROXIMATION';
  if(!$('codeOutput').hidden)$('codeOutput').value=channelSettingsToCode(channelSettings);
  for(const button of document.querySelectorAll('[data-sid-live-voice]')){
    const selected=button.dataset.sidLiveVoice===String(channelSettings.target);
    button.setAttribute('aria-pressed',String(selected));
  }
  for(const button of document.querySelectorAll('[data-sid-keyboard-mode]')){
    button.setAttribute('aria-pressed',String(button.dataset.sidKeyboardMode===channelSettings.keyboardMode));
    button.disabled=channelSettings.target==='round-robin';
  }
  const mixed=channelSettings.target==='round-robin'&&channelSettings.channels.some(value=>JSON.stringify([value.voice,value.modulation])!==JSON.stringify([preset.voice,preset.modulation]));
  $('sidChannelState').hidden=!mixed;
  const song=sidImporter?.read();
  if(!song?.liveEnabled||!(song.playing||song.paused||song.pausing||song.resuming))$('voiceHeading').textContent=channelSettings.target==='round-robin'?'Your sound · Round robin':`Your sound · CH ${channelSettings.target+1}`;
  updateCapacity();refreshPlayableKeys();updateLiveDisplay();
}
function audioFailed(error,owner){
  if(disposed||owner!==audio&&owner!==opening?.engine&&owner!==opening)return;
  generation++;noteEpoch++;pitchIntent++;appliedPitch=0;notes.clear();setPitchUi(0);updateKeys();
  const failed=audio;audio=null;if(opening){const old=opening;opening=null;old.controller.abort();}
  visualizer.disconnect();if(failed)void failed.dispose().catch(()=>{});
  void codeHost?.stop().catch(report);
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
          appliedSnapshot=readChannelSettings(channelSettings);await engine.command('loadChannelSettings',[appliedSnapshot]);
          await engine.command('setPitch',[snapshotPitch]);
        }while(applied!==revision||snapshotPitch!==pitch);
        if(disposed||opening!==owner||generation!==owner.generation)throw new DOMException('Audio preparation cancelled','AbortError');
        engine.setVolume(Number($('masterVolume').value));audio=engine;appliedChannelSettings=appliedSnapshot;appliedPreset=selectedChannelPreset(appliedSnapshot);
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
  return applySettings((load?applyChannelPreset:editChannelPreset)(channelSettings,readPreset(value)),{load,message});
}
function applySettings(value,{load=false,message,fromSong=false,isCurrent=()=>true}={}){
  if(disposed||!isCurrent())return Promise.resolve(false);
  const editOwner=audio?.captureSoundEditGuard?.()??(()=>true);
  const nextSettings=readChannelSettings(value),next=selectedChannelPreset(nextSettings),previous=preset;
  if(!load&&JSON.stringify(nextSettings)===JSON.stringify(channelSettings))return Promise.resolve(true);
  const changedTopology=load||channelSettings.target!==nextSettings.target||channelSettings.keyboardMode!==nextSettings.keyboardMode||topology(previous)!==topology(next);
  // A Code-owned model candidate may fail without touching the current chip.
  // Keep keyboard IDs releasable until an acknowledged replacement retires
  // them through readVoices(); an optimistic clear would strand a held Gate.
  if(changedTopology){if(!codeHost?.isRunning())clearNotes();setPitchUi(0);resetPitchIntent=++pitchIntent;resetIntent++;}
  if(!fromSong)manualRevision++;
  channelSettings=nextSettings;preset=next;const editRevision=++revision;updatePresetUi();
  if(!audio){if(!fromSong){codeHost?.markSoundDirty();patchStatus(opening?'Preparing latest edit…':'Ready · edits apply automatically.');status(message??'Instrument updated · enable audio, then play.');}return Promise.resolve(true);}
  const target=audio;if(!fromSong)patchStatus('Applying latest edit…',true);
  async function reconcile(){
    if(disposed||audio!==target||editRevision!==revision)return;
    const state=await target.read().catch(()=>null);
    if(disposed||audio!==target||editRevision!==revision||!state)return;
    appliedChannelSettings=readChannelSettings(state.channelSettings??applyChannelPreset(appliedChannelSettings,state.preset??appliedPreset));
    appliedPreset=selectedChannelPreset(appliedChannelSettings);channelSettings=readChannelSettings(appliedChannelSettings);preset=selectedChannelPreset(channelSettings);
    appliedResetIntent=resetIntent;revision++;acceptPitch(state,++commandSequence,pitchIntent);readVoices(state);updatePresetUi();
    if(!fromSong)codeHost?.markSoundDirty();patchStatus('Current applied sound kept.');
  }
  return enqueue(async()=>{
    if(disposed||audio!==target||editRevision!==revision||!isCurrent()||!editOwner()){await reconcile();return false;}
    try{
      // Coalescing a draft must preserve any earlier load/topology reset.
      const hardReset=pausedKeyboard||resetIntent>appliedResetIntent,resetAtDispatch=resetIntent;
      const pitchAtDispatch=resetPitchIntent,order=++commandSequence;
      const state=await target.command(hardReset?'loadChannelSettings':'setChannelSettings',[nextSettings]);
      pausedKeyboard=false;
      if(disposed||audio!==target||editRevision!==revision||!isCurrent()||!editOwner()){await reconcile();return false;}
      if(hardReset)appliedResetIntent=Math.max(appliedResetIntent,resetAtDispatch);
      appliedChannelSettings=readChannelSettings(state?.channelSettings??nextSettings);appliedPreset=selectedChannelPreset(appliedChannelSettings);acceptPitch(state,order,hardReset?pitchAtDispatch:null);readVoices(state);visualizer.wake();
      if(!fromSong)codeHost?.markSoundDirty();
      if(editRevision===revision&&!fromSong){patchStatus('Applied · edits are live.');status(message??(hardReset?'Instrument updated · held notes and Pitch reset.':'Instrument updated · changes are live.'));}
      return true;
    }catch(error){
      // Recover the actual applied bank after a rejected or cancelled edit.
      const recoveryOrder=++commandSequence,recoveryIntent=pitchIntent;
      const current=await target.read().catch(()=>null);
      if(audio===target&&current){
        appliedChannelSettings=readChannelSettings(current.channelSettings??applyChannelPreset(appliedChannelSettings,current.preset??appliedPreset));
        appliedPreset=selectedChannelPreset(appliedChannelSettings);
        acceptPitch(current,recoveryOrder,recoveryIntent);readVoices(current);
      }
      if(audio===target&&editRevision===revision){channelSettings=readChannelSettings(appliedChannelSettings);preset=selectedChannelPreset(channelSettings);revision++;updatePresetUi();if(!fromSong)codeHost?.markSoundDirty();patchStatus('Edit rejected · previous settings kept.');}
      throw error;
    }
  });
}
const editor=createEditor({root:$('voiceEditor'),onChange:value=>applyPreset(value),onLiveChange(patch,channel,masks){
  if(songChannel()&&sidImporter.read().manualReady){
    return sidImporter.manualEdit(channel,patch,masks).then(()=>{visualizer.wake();});
  }
  const target=audio,guard=target?.captureSoundEditGuard?.();
  if(!target||!codeHost?.isRunning())return;
  return enqueue(async()=>{
    const current=()=>!disposed&&audio===target&&codeHost?.isRunning()&&(!guard||guard());
    if(!current())return;
    const state=await target.editCodeVoice(channel,patch,{isCurrent:current});
    if(!current())return;
    channelSettings=readChannelSettings(state.channelSettings);preset=selectedChannelPreset(channelSettings);
    appliedChannelSettings=readChannelSettings(channelSettings);appliedPreset=readPreset(preset);revision++;manualRevision++;
    editor.update(preset);codeHost.markSoundDirty();visualizer.wake();
  });
},onError:report});
const sidLiveView=createSidLiveView({root:$('sidLiveView')});
codeLive=createSidCodeLive({getAudio:()=>audio,
  isRunning:()=>Boolean(codeHost?.isRunning()&&!document.hidden),
  onUpdate:()=>updateLiveDisplay(),
});
const sidImportPanel=createSidImportPanel({root:$('sidImportTools'),liveRoot:$('sidLiveTools'),getController:()=>sidImporter,
  onLiveChange(enabled){if(!codeHost?.isRunning())return false;codeLive.setEnabled(enabled);return true;},
});
sidImporter=createSidImport({
  getVolume:()=>Number($('masterVolume').value),
  getInstrumentRevision:()=>`${revision}/${importSequence}`,
  onUpdate(state){
    sidImportPanel.update(state);updateLiveDisplay(state);
    // Observing a song never adopts a full snapshot into the authored bank.
    if((state.pausing||state.resuming||state.playing&&lastSongPaused)&&pausedKeyboard){
      void stopNotes().catch(report);
      if(previewEngine){visualizer.disconnect();visualizer.connect(previewEngine.context,previewEngine.outputNode);}
    }
    lastSongPaused=Boolean(state.paused||state.pausing);
    if(Array.isArray(state.liveState?.manualVoices)){
      const owners=new Set(state.liveState.manualVoices.filter(voice=>voice.gateOwned).map(voice=>voice.id));
      for(const[source,note]of notes)if(note.owner==='song'&&note.started&&!owners.has(note.id))notes.delete(source);
      updateKeys();
    }
    if(previewEngine)visualizer.setRunning(Boolean(state.playing));
  },
  async onPreviewStart(engine,{isCurrent=()=>true}={}){
    if(disposed||!isCurrent())return;
    await codeHost?.stop();
    if(disposed||!isCurrent())return;
    await stopNotes();
    if(disposed||!isCurrent()||engine.context.state==='closed')return;
    songTarget=sidImporter.read().liveVoice??0;lastSongPaused=false;
    previewEngine=engine;visualizer.disconnect();visualizer.connect(engine.context,engine.outputNode);visualizer.setRunning(false);
    await prepareDesktopOutput(engine,()=>!disposed&&previewEngine===engine&&isCurrent()&&engine.context.state!=='closed');
  },
  onPreviewStop(engine){
    if(previewEngine!==engine)return;
    previewEngine=null;
    for(const[source,note]of notes)if(note.owner==='song')notes.delete(source);
    updateKeys();if(disposed)return;
    if(pausedKeyboard)void stopNotes().catch(report);
    visualizer.setRunning(false);visualizer.disconnect();
    if(audio)visualizer.connect(audio.context,audio.outputNode);
    visualizer.setRunning(notes.size>0||Boolean(codeHost?.isRunning()));
  },
  onUsePreset(value){importSequence++;return applyPreset(value,{load:true,message:'SID voice imported · play this keyboard, edit it or save a preset.'});},
});
function chooseChannel(target){
  if(codeHost?.isRunning()){
    if(target!=='round-robin')codeLive.setVoice(target);
    return Promise.resolve();
  }
  if(songOpen()){
    const released=stopNotes();songTarget=target;
    if(target!=='round-robin')sidImporter.setLiveVoice(target);
    else if(channelSettings.target!=='round-robin')void applySettings(selectChannelTarget(channelSettings,'round-robin')).catch(report);
    updateLiveDisplay();return released;
  }
  const changed=applySettings(selectChannelTarget(channelSettings,target),{message:target==='round-robin'?'Round robin · channel settings kept. Edits apply to all three.':`CH ${target+1} · edit and play this channel.`});
  if(target!=='round-robin')sidImporter.setLiveVoice(target);
  return changed;
}
for(const button of document.querySelectorAll('[data-sid-live-voice]'))button.addEventListener('click',()=>{
  button.blur();const target=button.dataset.sidLiveVoice==='round-robin'?'round-robin':Number(button.dataset.sidLiveVoice);
  void chooseChannel(target).catch(report);
});
function chooseKeyboardMode(mode){
  if(channelSettings.target==='round-robin')return Promise.resolve();
  return applySettings(selectKeyboardMode(channelSettings,mode),{message:`${mode==='legato'?'Legato':'Retrigger'} · software keyboard mode.`});
}
for(const button of document.querySelectorAll('[data-sid-keyboard-mode]'))button.addEventListener('click',()=>{
  button.blur();void chooseKeyboardMode(button.dataset.sidKeyboardMode).catch(report);
});
function stopSongForKeyboard(){
  const state=sidImporter?.read();
  return state&&(state.playing||state.starting||state.paused||state.pausing||state.resuming)?sidImporter.stop({cancelLoad:false}):Promise.resolve();
}

const keyboard=document.createElement('div');keyboard.className='keyboard';$('keyboard').append(keyboard);
const tools=Object.fromEntries(['instrument','position','fret','strings','window'].map(name=>{const node=document.createElement('div');node.className=`fretboard-${name} ${['fret','strings'].includes(name)?'fret-display':'toolbar-group'}`;return[name,node];}));
const toolbar=document.createElement('div');toolbar.className='fretboard-toolbar';const summary=document.createElement('div');summary.className='fretboard-row fretboard-summary';summary.append(tools.fret,tools.strings);const choices=document.createElement('div');choices.className='fretboard-row';for(const name of ['instrument','position','window'])choices.append(tools[name]);toolbar.append(summary,choices);$('keyboardFretboard').append(toolbar);
function canPlay(midi){
  if(songChannel())return midi>=0&&midi<=127&&440*2**((midi-69+pitch)/12)<=65535*985248/16777216;
  const plan=channelPlaybackPlan(channelSettings),sound=channelSettings.channels[plan.carrier];
  const hz=440*2**((midi-69+pitch)/12),source=plan.source!==null?hz*sound.modulation.ratio:hz;
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
  if(disposed||switchingAudioOutput||codeHost?.isCodeMode()||notes.has(source)||!canPlay(entry.midi))return;
  const song=sidImporter.read(),reference=songChannel(song),owner=reference?(song.paused?'paused':'song'):'author';
  if(reference&&(song.starting||song.pausing||song.resuming||!song.paused&&!song.manualReady)){status('Wait for the SID song to finish its transport operation.');return;}
  const note={id:`sid-synth:${++sequence}`,key:entry.key,midi:entry.midi,epoch:noteEpoch,started:false,owner};notes.set(source,note);updateKeys();
  if(owner==='song'){
    void enqueue(async()=>{
      if(notes.get(source)!==note||note.epoch!==noteEpoch)return;
      note.started=true;await sidImporter.manualNoteOn(note.id,song.liveVoice,entry.midi,pitch);
      if(notes.get(source)===note){visualizer.wake();status(`Song CH ${song.liveVoice+1} · ${midiToNoteName(note.midi)} · later song writes take priority.`);}
    }).catch(error=>{if(notes.get(source)===note){notes.delete(source);updateKeys();}report(error);});return;
  }
  let pausedSound=null;
  if(owner==='paused'){
    try{pausedSound=captureSidVoices(song.liveState,{name:song.selection?.name}).voices[song.liveVoice??0];}
    catch(error){notes.delete(source);updateKeys();report(error);return;}
  }
  if(owner==='paused'&&!pausedSound?.available){notes.delete(source);updateKeys();status(pausedSound?.reason??'Wait for the paused CH observation.',true);return;}
  const ready=ensureAudio();ready.catch(()=>{});
  const songEngine=previewEngine;
  void enqueue(async()=>{
    const discard=()=>{if(notes.get(source)===note){notes.delete(source);updateKeys();}};
    if(switchingAudioOutput||notes.get(source)!==note||note.epoch!==noteEpoch){discard();return;}
    const engine=await ready;
    const current=()=>!disposed&&audio===engine&&notes.get(source)===note&&note.epoch===noteEpoch&&engine.context.state!=='closed'&&
      (owner!=='paused'||previewEngine===songEngine&&sidImporter.read().paused&&!sidImporter.read().resuming);
    if(switchingAudioOutput||!current()){discard();return;}
    await prepareDesktopOutput(engine,current);if(!current()){discard();return;}
    if(owner==='paused'){
      const audition=selectChannelTarget(createChannelSettings(pausedSound.preset),song.liveVoice??0);
      await engine.command('loadChannelSettings',[audition]);pausedKeyboard=true;
      if(!current()){
        await engine.command('loadChannelSettings',[channelSettings]);pausedKeyboard=false;
        if(notes.get(source)===note){notes.delete(source);updateKeys();}return;
      }
      visualizer.disconnect();visualizer.connect(engine.context,engine.outputNode);
    }else if(pausedKeyboard){await engine.command('loadChannelSettings',[channelSettings]);pausedKeyboard=false;if(!current())return;}
    const codeState=codeHost?.isRunning()?codeLive.read():null;
    note.started=true;await engine.command('noteOn',[note.id,note.midi,codeState?.liveEnabled?codeState.liveVoice:null]);
    if(audio!==engine||note.epoch!==noteEpoch)return;
    const state=await engine.read();if(audio!==engine||note.epoch!==noteEpoch)return;
    readVoices(state);visualizer.wake();updateNoteStatus(note.midi);
  }).catch(error=>{if(notes.get(source)===note){notes.delete(source);updateKeys();}report(error);});
}
function release(source){
  const note=notes.get(source);if(!note)return;notes.delete(source);updateKeys();
  if(note.started)void enqueue(async()=>{
    if(note.owner==='song'){await sidImporter.manualNoteOff(note.id);return;}
    const target=audio;if(!target||note.epoch!==noteEpoch)return;
    await target.command('noteOff',[note.id]);
    if(audio!==target||note.epoch!==noteEpoch)return;
    const state=await target.read();
    if(audio!==target||note.epoch!==noteEpoch)return;
    readVoices(state);visualizer.wake();if(legato())updateNoteStatus();
  }).catch(()=>{});
}
async function stopNotes(message){
  clearNotes();setPitchUi(0);const stopPitchIntent=++pitchIntent;refreshPlayableKeys();
  if(opening){const old=opening;opening=null;generation++;old.controller.abort();$('startAudio').disabled=false;$('startAudio').textContent='Enable audio';}
  const target=audio,stoppedEpoch=noteEpoch;
  try{
    const songReleased=sidImporter?.manualRelease?.();
    if(target){const order=++commandSequence,state=await target.command(codeHost?.isRunning()?'releaseKeyboard':'stop');if(audio===target){acceptPitch(state,order,stopPitchIntent);if(noteEpoch===stoppedEpoch&&!notes.size)readVoices(state);}}
    if(target&&pausedKeyboard&&noteEpoch===stoppedEpoch&&!notes.size){pausedKeyboard=false;await target.command('loadChannelSettings',[channelSettings]);}
    await songReleased;
    // A Stop ACK belongs to the notes cleared above, never a later key press.
    if((!target||audio===target)&&noteEpoch===stoppedEpoch&&!notes.size){
      if(previewEngine&&sidImporter?.read().playing)visualizer.setRunning(true);
      else visualizer.stop();
      if(message)status(message);
    }
  }
  catch(error){report(error);}
}
$('startAudio').addEventListener('click',()=>{$('startAudio').blur();if(songOpen())return;void ensureAudio().catch(report);});
$('stopAudio').addEventListener('click',()=>{$('stopAudio').blur();void stopPerformances('Stopped · preset kept. Play to resume.').catch(report);});
async function stopPerformances(message){await codeHost?.stop();await sidImporter.stop();await stopNotes(message);}
for(const[id,delta]of [['octaveDown',-1],['octaveUp',1]])$(id).addEventListener('click',()=>{$(id).blur();void stopNotes();octave=Math.max(-2,Math.min(2,octave+delta));renderKeyboard();});
function editing(target){const control=target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');return control&&!control.matches?.('input[type="range"]');}
window.addEventListener('keydown',event=>{
  if(codeHost?.isCodeMode()||event.ctrlKey||event.metaKey||event.altKey||editing(event.target))return;
  const key=event.key.toLowerCase(),entry=layout.entries.find(item=>item.key===key);if(!entry)return;
  event.preventDefault();if(!event.repeat)press(`key:${event.code||key}`,{...entry,midi:entry.midi+octave*12});
});
window.addEventListener('keyup',event=>release(`key:${event.code||event.key.toLowerCase()}`));
window.addEventListener('blur',()=>{void stopNotes();});
document.addEventListener('visibilitychange',()=>{codeLive.sync();if(document.hidden)void stopNotes();});
function setPitch(value){
  if(disposed)return;const request=++pitchIntent,epoch=noteEpoch;setPitchUi(value);refreshPlayableKeys();const target=audio;
  if(songChannel()&&sidImporter.read().manualReady){void enqueue(()=>sidImporter.manualPitch(value)).catch(report);return;}
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
$('saveChannelSettings').addEventListener('click',()=>{
  $('saveChannelSettings').blur();try{const url=URL.createObjectURL(new Blob([JSON.stringify(readChannelSettings(channelSettings),null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='tetorica-sid-channels.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('SID channel setup saved.');}catch(error){report(error);}
});
$('loadPreset').addEventListener('click',()=>{$('loadPreset').blur();$('presetFileInput').click();});
$('presetFileInput').addEventListener('cancel',()=>{$('presetFileInput').blur();status('Preset selection cancelled. Current preset kept.');});
$('presetFileInput').addEventListener('change',async()=>{
  const file=$('presetFileInput').files?.[0];$('presetFileInput').value='';$('presetFileInput').blur();if(!file){status('Preset selection cancelled. Current preset kept.');return;}
  const token=++importSequence,draftRevision=manualRevision;
  try{
    if(file.size>65536)throw new Error('SID preset must be at most 64 KiB');const value=JSON.parse(await file.text());
    const setup=value?.format==='tetorica-sid-channels',next=setup?readChannelSettings(value):readPreset(value);
    if(disposed||token!==importSequence||draftRevision!==manualRevision)return;
    await stopNotes();if(songOpen())songTarget='round-robin';
    await (setup?applySettings:applyPreset)(next,{load:true,message:setup?'SID channel setup loaded · play the selected channel.':'SID preset loaded · play the keyboard.'});
    if(setup&&next.target!=='round-robin')sidImporter.setLiveVoice(next.target);
  }
  catch(error){if(!disposed&&token===importSequence)status(`${error.message??error} Current preset kept.`,true);}
});
$('resetPreset').addEventListener('click',()=>{$('resetPreset').blur();void (async()=>{await stopNotes();if(songOpen())songTarget='round-robin';await applySettings(createChannelSettings(),{load:true,message:'Reset · Saw ready on all three channels.'});})().catch(report);});
$('copyCode').addEventListener('click',async()=>{
  $('copyCode').blur();try{const code=channelSettingsToCode(channelSettings);$('codeOutput').value=code;$('codeOutput').hidden=false;try{await navigator.clipboard.writeText(code);status('JavaScript copied · paste into Playground C64 mode.');}catch{status('JavaScript ready below · select and copy into Playground C64 mode.');}}catch(error){report(error);}
});
window.addEventListener('pagehide',event=>{
  if(event.persisted){void stopPerformances().catch(report);return;}codeLive.dispose();void codeHost?.dispose().catch(()=>{});disposed=true;generation++;clearNotes();if(opening){opening.controller.abort();opening=null;}sidImportPanel.dispose();sidLiveView.dispose();void sidImporter.dispose();monitorResize.disconnect();visualizer.dispose();editor.dispose();const previous=audio;audio=null;if(previous)void previous.dispose().catch(()=>{});
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
renderKeyboard();updatePresetUi();setVolume();setPitchUi(0);
codeHost=setupSidCodeHost({ensureAudio,getAudio:()=>audio,getSettings:()=>readChannelSettings(channelSettings),
  async beforeSoundApply(){await stopNotes();if(songOpen()){songTarget='round-robin';updateLiveDisplay();}},
  async applySettings(value,{isCurrent=()=>true}={}){
    if(disposed||!isCurrent())throw new DOMException('SID project selection cancelled','AbortError');
    if(await applySettings(value,{load:true,isCurrent,message:'SID project sound loaded · play or run Code.'})===false)return false;
    if(disposed||!isCurrent()||JSON.stringify(readChannelSettings(channelSettings))!==JSON.stringify(readChannelSettings(value)))
      throw new DOMException('SID project selection changed','AbortError');
  },
  stopKeyboard:()=>stopNotes(),stopSong:()=>stopSongForKeyboard(),beforeRun:()=>queue,
  prepareOutput:(engine,isCurrent)=>prepareDesktopOutput(engine,isCurrent),
  onActivity:codeActivity,setStatus:message=>status(message),
});
void codeHost.ready.then(()=>{if(!disposed)receivePlayerSnapshot();}).catch(report);

// Desktop adapters select the final Master output before a keyboard attack or
// SID preview starts. Normal websites expose no bridge. The desktop host keeps
// these readable assets unchanged and supplies device output / window controls.
const desktopLocation=window.location;
const localDesktop=desktopLocation&&((desktopLocation.protocol==='tauri:'&&desktopLocation.hostname==='localhost')||
  (['http:','https:'].includes(desktopLocation.protocol)&&desktopLocation.hostname==='tauri.localhost'));
if(window.top===window&&localDesktop&&window.__TAURI_INTERNALS__){
  const output=engine=>engine&&engine.context.state!=='closed'?{context:engine.context,output:engine.outputNode}:null;
  Object.defineProperty(window,'tetoricaSynthAudio',{value:Object.freeze({
    getOutput(){return output(previewEngine)??output(audio);},
    async ensureReady(){return output(previewEngine)??output(await ensureAudio());},
    setSwitching(value){switchingAudioOutput=value===true;},
    setOutputHandler(handler){
      if(handler!==null&&typeof handler!=='function')throw new TypeError('Desktop output handler must be a function or null');
      desktopOutputHandler=handler;
    },
    async stopPlayback(){await codeHost?.stop();await sidImporter.stop({cancelLoad:false});await stopNotes();},
  })});
  window.dispatchEvent(new Event('tetorica-synth-ready'));
}
