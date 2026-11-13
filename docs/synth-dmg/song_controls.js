// SPDX-License-Identifier: BSD-3-Clause
import {createGameboySongPreview} from './song_preview.js';
import {isGameboySongPath} from './code_project.js?dmg-json-code=1';
import {prepareGameboySongVoice} from './song_voice.js';

const time = seconds => {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
};
const preciseTime = seconds => {
  const value=Math.max(0,Number.isFinite(seconds)?seconds:0);
  const hundredths=Math.round(value*100);
  return `${Math.floor(hundredths/6000)}:${((hundredths%6000)/100).toFixed(2).padStart(5,'0')}`;
};

/** Passive Files list; audio belongs exclusively to an explicit Play gesture.
 * channelElement/liveElement: undefined uses the legacy mount; null is API-only.
 * initialView is 'synth' or a zero-based physical CH (0..3). A shared application
 * selector calls setView(target,{notify:false}) and setLiveEnabled(boolean).
 * onViewChange(target,{reason}) reports explicit changes and successful Capture,
 * after its Synth view is published. Transport ticks never invoke this hook.
 * Live updates can be Off while the same CH remains selected and auditionable.
 */
export function setupGameboySongControls({project, getAudio, beforePlay,
  onLiveView = () => {}, onState = () => {}, onStatus = () => {},
  onCapture = async () => false,
  channelElement, liveElement, initialView, initialLiveEnabled,
  onViewChange = () => {},
  createPreview = createGameboySongPreview, document: doc = globalThis.document} = {}) {
  const $ = id => doc.getElementById(id);
  const root = $('dmgSongPlayer'), select = $('dmgSongSelect');
  const play = $('dmgSongPlayButton'), stop = $('dmgSongStopButton');
  // The application may own one shared Synth / CH selector and Live checkbox
  // across idle, Code and VGM. null means API-only: never write or listen to
  // that application's controls. Undefined retains the original mounts.
  const status = $('dmgSongStatus'), live = liveElement === undefined ? $('dmgSongLiveEnabled') : liveElement;
  const channel = channelElement === undefined ? $('dmgSongChannelSelect') : channelElement, liveStatus = $('dmgSongLiveStatus');
  const position = $('dmgSongPosition'), listeners = [];
  const capture = $('dmgSongCaptureButton');
  const seek = $('dmgSongSeek'), seekPosition = $('dmgSongSeekPosition');
  const channelNames=['CH1 · Pulse','CH2 · Pulse','CH3 · Wave','CH4 · Noise'];
  const channelButtons=channelNames.map((_,index)=>$(`dmgSongChannel${index+1}Toggle`));
  if (!root || !select || !play || !stop || !status)
    throw Error('Game Boy song controls mount is missing.');
  const normalizeView=value=>{
    if(value==='synth')return value;
    const voice=typeof value==='string'&&/^[0-3]$/.test(value)?Number(value):value;
    if(!Number.isInteger(voice)||voice<0||voice>3)throw new RangeError('Song view must be Synth or CH1–CH4.');
    return voice;
  };
  const requestedView=normalizeView(initialView??(/^[0-3]$/.test(String(channel?.value))?Number(channel.value):0)),requestedLive=initialLiveEnabled??(live?.checked!==false);
  if(typeof requestedLive!=='boolean')throw new TypeError('Song Live must be boolean');
  let disposed = false, selectedPath = null, selectedRevision = -1;
  let attempted = '', listSignature = '', selection = 0, choosing = false, selectionError = '';
  let viewTarget = requestedView === 'synth' ? 'synth' : 'song', captureOperation = 0, capturing = false;
  let seekDraft=null,seekPointer=false,seekCancelled=false;
  const decorate = state => ({...state, selectedPath, view: viewTarget === 'synth' ? 'synth' : 'song',
    viewTarget: viewTarget === 'synth' ? 'synth' : state.liveVoice, capturing});
  function pausedPayload() {
    const state = preview.read();
    if (!state.paused || choosing || capturing || viewTarget === 'synth' || !state.liveState ||
      state.liveState.positionFrames !== state.positionFrames) return null;
    const name = `${state.name || 'VGM'} · CH${state.liveVoice + 1}`.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '_').slice(0, 80);
    const voice = prepareGameboySongVoice(state.liveState, state.liveVoice, {name});
    return {...voice, sourceType: voice.source, snapshot: structuredClone(state.liveState), frame: state.positionFrames,
      source: {path: selectedPath, name: state.name}, sourceFile: selectedPath};
  }
  const text = (node, value) => {if (node && node.textContent !== value) node.textContent = value;};
  const report = error => {if (!disposed) {selectionError = error?.message ?? String(error); showState(preview.read()); onStatus(`VGM: ${selectionError}`);}};
  const listen = (node, type, fn) => {if (!node) return; node.addEventListener(type, fn); listeners.push(() => node.removeEventListener(type, fn));};
  function showState(state) {
    if (disposed) return;
    root.dataset.state = state.playback;
    root.dataset.loading = String(Boolean(choosing || state.loading));
    root.dataset.positionFrames = String(state.positionFrames ?? 0);
    root.dataset.live = String(Boolean(state.liveActive && state.liveState));
    root.dataset.seeking=String(Boolean(state.seeking));
    root.dataset.seekPreparing=String(Boolean(state.seekPreparing));
    root.dataset.seekTargetSeconds=String(state.seekTargetSeconds??0);
    root.dataset.seekProgressSeconds=String(state.seekProgressSeconds??0);
    root.dataset.renderedFrames = String((state.positionFrames ?? 0) + (state.bufferedFrames ?? 0));
    const channelEnabled=state.channelEnabled??[true,true,true,true];
    root.dataset.channelMuteMask=String(state.channelMuteMask??channelEnabled.reduce((mask,on,index)=>on?mask:mask|(1<<index),0));
    channelButtons.forEach((button,index)=>{
      if(!button)return;
      const on=channelEnabled[index]!==false;
      text(button,`${channelNames[index]} · ${on?'On':'Off'}`);
      button.setAttribute('aria-pressed',String(on));
      button.setAttribute('aria-label',`VGM ${channelNames[index]} ${on?'On':'Off'}`);
    });
    text(play, state.seeking ? 'Seeking…' : state.playing ? 'Pause' : state.paused ? 'Resume' : 'Play');
    play.disabled = capturing || choosing || state.loading || state.busy || !state.hasSource;
    stop.disabled = !(choosing || state.loading || state.canStop || ['starting', 'seeking', 'playing', 'paused'].includes(state.playback));
    select.disabled = capturing;
    if(live)live.disabled = capturing||Boolean(state.seeking);
    if(channel)channel.disabled = capturing||Boolean(state.seeking);
    const message = selectionError || (choosing || state.loading ? 'Validating VGM…' :
      state.seeking ? `Seeking to ${preciseTime(state.seekTargetSeconds)} · ${preciseTime(state.seekProgressSeconds)} prepared…` :
      state.seekPreparing ? 'Finishing the cancelled seek…' :
      state.seekMessage ? state.seekMessage :
      state.playback === 'playing' ? 'Playing.' : state.playback === 'paused' ? 'Paused.' :
      state.playback === 'starting' ? 'Starting…' : state.playback === 'ended' ? 'Finished.' :
      state.playback === 'error' ? state.errorMessage || 'Playback failed.' :
      state.hasSource ? 'Ready. Press Play; your instrument is kept.' : 'Add a VGM / VGZ to Files to hear a reference song.');
    text(status, message); status.dataset.error = String(Boolean(selectionError || state.playback === 'error' || state.seekMessage?.startsWith('Seek failed:')));
    text(position, `${time(state.positionSeconds)}${state.durationSeconds != null ? ` / ${time(state.durationSeconds)}` : ''}`);
    if(seek){
      const duration=Math.max(0,state.durationSeconds??0);
      const displayed=seekDraft??(state.seeking?state.seekTargetSeconds:state.positionSeconds)??0;
      seek.max=String(duration);seek.value=String(Math.max(0,Math.min(duration,displayed)));
      seek.disabled=capturing||choosing||Boolean(state.loading||state.seekPreparing)||!state.hasSource||!duration||state.canSeek===false;
      seek.ariaValueText=`${preciseTime(displayed)} of ${preciseTime(duration)}`;
      text(seekPosition,preciseTime(displayed));
    }
    const voice = Number.isInteger(state.liveVoice) ? state.liveVoice : 0;
    if(channel)channel.value = viewTarget === 'synth' ? 'synth' : String(voice);
    if(live)live.checked = state.liveEnabled !== false;
    const observed = Boolean(state.liveActive && state.liveState);
    text(liveStatus, state.liveError ? `CH${voice + 1}: ${state.liveMessage || 'Live unavailable.'}` : observed ?
      viewTarget === 'synth' ? `Synth · ${state.paused ? 'edit and play; the song stays paused.' : 'your sound; pause or stop the song to play.'}` :
      `${state.paused ? 'Paused' : state.liveEnabled ? 'Live' : 'Frozen'} CH${voice + 1} · read-only configured settings · ${state.paused ? 'Keyboard auditions this CH.' : 'Pause to audition this CH.'}` :
      state.liveWaiting ? 'Waiting for the audible song position…' : 'CH1–CH4 show the song while it plays.');
    let payload = null;
    try {payload = pausedPayload();} catch {}
    if (capture) {
      capture.disabled = capturing || !payload?.playable;
      text(capture, capturing ? 'Capturing…' : 'Capture to Synth');
      capture.title = capturing ? 'Saving the selected song sound…' : payload?.reason ||
        (payload ? 'Save this configured sound and keep the song paused.' : 'Pause and select a song channel to capture its sound.');
    }
    root.dataset.view = viewTarget === 'synth' ? 'synth' : 'song';
    root.dataset.capturing = String(capturing);
    onLiveView(decorate(state)); onState(decorate(state));
  }
  const preview = createPreview({getAudio, beforePlay, onState: showState, onStatus});
  preview.setLiveEnabled(requestedLive);
  preview.setLiveVoice(requestedView==='synth'?0:requestedView);

  async function choose(path) {
    const revision = path ? project.fs.getRevision(path) : -1;
    if (path === selectedPath && revision === selectedRevision) {select.value = path || ''; return true;}
    const key = `${path ?? ''}:${revision}`;
    if (key === attempted) {select.value = selectedPath || ''; return false;}
    attempted = key;
    cancelPendingCapture();
    seekDraft=null;seekCancelled=true;
    const token = ++selection;
    if (!path) {
      choosing = false; selectedPath = null; selectedRevision = -1; selectionError = '';
      preview.clear(); showState(preview.read()); return true;
    }
    const file = project.fs.get(path);
    if (!file || file.type !== 'binary') return false;
    choosing = true; selectionError = ''; showState(preview.read());
    try {
      const accepted = await preview.load(file.data, path.slice('/vgm/'.length));
      if (disposed || token !== selection) return false;
      if (accepted === false) throw Error(preview.read().errorMessage || `Could not load ${path}. Current song kept.`);
      selectedPath = path; selectedRevision = revision; select.value = path;
      return true;
    } catch (error) {
      if (!disposed && token === selection) {select.value = selectedPath || ''; if (error?.name !== 'AbortError') report(error);}
      return false;
    } finally {
      if (!disposed && token === selection) {choosing = false; showState(preview.read());}
    }
  }
  function refresh() {
    if (disposed) return;
    const entries = project.listEntries().filter(entry => entry.fileType === 'binary' && isGameboySongPath(entry.path))
      .sort((a, b) => a.path.localeCompare(b.path));
    const signature = JSON.stringify(entries.map(entry => [entry.path, entry.revision]));
    if (signature !== listSignature) {
      listSignature = signature;
      const placeholder = doc.createElement('option'); placeholder.value = '';
      placeholder.textContent = entries.length ? 'Choose VGM…' : 'No VGM files'; placeholder.disabled = true;
      select.replaceChildren(placeholder, ...entries.map(entry => {
        const option = doc.createElement('option'); option.value = entry.path;
        option.textContent = entry.path.slice('/vgm/'.length); option.title = entry.path; return option;
      }));
    }
    const next = entries.some(entry => entry.path === project.selectedPath) ? project.selectedPath :
      entries.some(entry => entry.path === selectedPath) ? selectedPath : entries[0]?.path ?? null;
    select.value = selectedPath || next || '';
    void choose(next);
  }
  const unsubscribe = project.onDidChange(refresh);
  function cancelPendingCapture() {captureOperation++; capturing = false;}
  function stopCurrent() {
    if (disposed) return;
    cancelPendingCapture(); selection++; choosing = false; selectionError = ''; select.value = selectedPath || '';
    seekDraft=null;seekCancelled=true;
    preview.stop(); showState(preview.read());
  }
  listen(select, 'change', () => {
    select.blur(); const path = select.value; selectionError = ''; attempted = '';
    if (project.fs.has(path) && isGameboySongPath(path)) {void choose(path); project.select(path);}
  });
  listen(play, 'click', () => {
    play.blur(); selectionError = '';
    const state = preview.read();
    if (capturing || choosing || state.loading || state.busy || !state.hasSource) return;
    cancelPendingCapture();
    if (state.playing) preview.pause();
    else Promise.resolve(state.paused ? preview.resume() : preview.play()).catch(report);
  });
  listen(stop, 'click', () => {stop.blur(); stopCurrent();});
  channelButtons.forEach((button,index)=>{
    listen(button,'pointerdown',event=>{if(event.button===0)event.preventDefault();});
    listen(button,'click',event=>{
      if(event.detail!==0)button.blur();
      try{preview.setChannelEnabled(index,preview.read().channelEnabled?.[index]===false);}
      catch(error){report(error);}
    });
  });
  async function seekTo(seconds) {
    const state=preview.read();
    if(disposed||capturing||choosing||state.loading||state.seekPreparing||state.canSeek===false||!state.hasSource)return false;
    seekDraft=null;selectionError='';cancelPendingCapture();
    return preview.seek(seconds);
  }
  listen(seek,'pointerdown',()=>{seekPointer=true;seekCancelled=false;});
  listen(seek,'input',()=>{
    if(!seekPointer)seekCancelled=false;
    if(seekCancelled){showState(preview.read());return;}
    seekDraft=Number(seek.value);showState(preview.read());
  });
  listen(seek,'change',()=>{
    if(seekCancelled){seekDraft=null;showState(preview.read());return;}
    void seekTo(Number(seek.value)).catch(report);
  });
  listen(seek,'pointerup',()=>{seekPointer=false;seek.blur();});
  listen(seek,'pointercancel',()=>{seekPointer=false;seekCancelled=true;seekDraft=null;seek.blur();showState(preview.read());});
  listen(seek,'keydown',event=>{
    if(event.key!=='Escape')return;
    event.preventDefault();event.stopPropagation();seekDraft=null;seekCancelled=true;
    if(preview.read().seeking)void Promise.resolve(preview.cancelSeek()).catch(report);
    showState(preview.read());
  });
  function setLiveEnabled(value) {
    if(typeof value!=='boolean')throw new TypeError('Song Live must be boolean');
    if(disposed)return false;
    if(preview.read().liveEnabled===value)return decorate(preview.read());
    cancelPendingCapture();preview.setLiveEnabled(value);return decorate(preview.read());
  }
  listen(live, 'change', () => {live.blur();setLiveEnabled(live.checked);});
  function setView(value,{notify=true,reason='api'}={}) {
    value=normalizeView(value);if(disposed)return false;
    const previous=viewTarget==='synth'?'synth':preview.read().liveVoice;
    if(previous===value){showState(preview.read());return decorate(preview.read());}
    cancelPendingCapture();
    if (value === 'synth') {viewTarget = 'synth'; showState(preview.read());}
    else {
      viewTarget = 'song'; preview.setLiveVoice(value);
      // The transport intentionally does not emit when its physical CH is
      // unchanged. Returning from Synth still changes this view's owner.
      showState(preview.read());
    }
    if(notify&&previous!==value)onViewChange(value,{reason});
    return decorate(preview.read());
  }
  listen(channel, 'change', () => {channel.blur(); setView(channel.value,{reason:'selector'});});
  listen(capture, 'click', () => {capture.blur(); void captureCurrent().catch(report);});
  async function captureCurrent() {
    if (disposed || capturing) return false;
    const payload = pausedPayload();
    if (!payload?.playable) {if (payload?.reason) onStatus(payload.reason); return false;}
    const token = ++captureOperation, source = selectedPath, frame = payload.frame, voice = payload.channel;
    const isCurrent = () => !disposed && token === captureOperation && selectedPath === source &&
      preview.read().paused && preview.read().positionFrames === frame && preview.read().liveVoice === voice;
    let succeeded=false;capturing = true; showState(preview.read());
    try {
      const result = await onCapture(payload, {isCurrent});
      if (!isCurrent() || result === false) return false;
      viewTarget = 'synth';succeeded=true;return true;
    } finally {if (!disposed && token === captureOperation) {capturing = false; showState(preview.read());if(succeeded)onViewChange('synth',{reason:'capture'});}}
  }
  refresh(); showState(preview.read());
  return {
    getState: () => decorate(preview.read()),
    getCapturePayload: pausedPayload, capture: captureCurrent, setView, setLiveEnabled, cancelPendingCapture,
    isActive: () => ['starting', 'seeking', 'playing', 'paused'].includes(preview.read().playback),
    isPlaying: () => preview.read().playing,
    async selectPath(path) {
      if (disposed || !isGameboySongPath(path) || !project.fs.has(path)) return false;
      attempted = ''; const pending = choose(path); project.select(path); return pending;
    },
    stop: stopCurrent,
    seek:seekTo,whenIdle:()=>preview.whenIdle?.()??Promise.resolve(),
    dispose() {if (disposed) return; disposed = true; cancelPendingCapture(); selection++; unsubscribe(); for (const remove of listeners) remove(); preview.dispose();},
  };
}
