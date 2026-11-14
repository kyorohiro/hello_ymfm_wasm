// SPDX-License-Identifier: BSD-3-Clause
import {createHuc6280SongPreview} from './song_preview.js?v=huc-seek-1';
import {isHuc6280SongPath} from './code_project.js?v=huc-song-1';
import {prepareHuc6280SongVoice} from './song_voice.js';

const time=seconds=>{
  const value=Math.max(0,Number.isFinite(seconds)?seconds:0);
  return `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
};
const preciseTime=seconds=>{
  const value=Math.round(Math.max(0,Number.isFinite(seconds)?seconds:0)*100);
  return `${Math.floor(value/6000)}:${((value%6000)/100).toFixed(2).padStart(5,'0')}`;
};

/** Files are validated passively. Only the transport's Play gesture acquires
 * audio; it never applies a song's registers to the authored instrument. */
export function setupHuc6280SongControls({project,getAudio,beforePlay,
  onState=()=>{},onStatus=()=>{},onCapture=async()=>false,onViewChange=()=>{},createPreview=createHuc6280SongPreview,document:doc=globalThis.document}={}){
  const $=id=>doc.getElementById(id),root=$('hucSongPlayer'),select=$('hucSongSelect');
  const play=$('hucSongPlayButton'),stop=$('hucSongStopButton'),status=$('hucSongStatus'),position=$('hucSongPosition');
  const capture=$('hucSongCaptureButton'),captureStatus=$('hucSongCaptureStatus');
  const channelButtons=Array.from({length:6},(_,index)=>$(`hucSongChannel${index+1}Toggle`));
  const channelGroup=$('hucSongChannels');
  const seek=$('hucSongSeek'),seekPosition=$('hucSongSeekPosition'),cancelSeekButton=$('hucSongCancelSeek');
  if(!root||!select||!play||!stop||!status)throw Error('HuC6280 song controls mount is missing.');
  const listeners=[];
  let disposed=false,selectedPath=null,selectedRevision=-1,attempted='',listSignature='',selection=0,choosing=false,selectionError='',pending=null;
  let viewTarget='synth',capturing=false,captureOperation=0,captureMessage='',captureBinding=null,pausedSelectionCache=null;
  let seekDraft=null,seekPointer=false,seekCancelled=false;
  const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
  const decorate=state=>({...state,selectedPath,choosing,viewTarget,capturing,captureMessage,pausedVoice:getPausedSelection(state)?.prepared??null});
  let preview;
  const read=()=>preview?.getState?.()??preview?.read?.()??{playback:'stopped',hasSource:false};
  function showState(state){
    if(disposed)return;
    if(capturing&&captureBinding&&getPausedSelection(state)?.key!==captureBinding)cancelPendingCapture();
    root.dataset.state=state.playback;
    root.dataset.loading=String(Boolean(choosing||state.loading));
    root.dataset.positionFrames=String(state.positionFrames??0);
    root.dataset.renderedFrames=String((state.positionFrames??0)+(state.bufferedFrames??0));
    root.dataset.liveEnabled=String(state.liveEnabled!==false);
    root.dataset.livePositionFrames=String(state.liveState?.positionFrames??'');
    root.dataset.seeking=String(Boolean(state.seeking));root.dataset.seekPreparing=String(Boolean(state.seekPreparing));
    root.dataset.seekCancelling=String(Boolean(state.seekCancelling));
    root.dataset.seekTargetSeconds=String(state.seekTargetSeconds??0);root.dataset.seekProgressSeconds=String(state.seekProgressSeconds??0);
    const channelEnabled=state.channelEnabled??Array(6).fill(true);
    if(channelGroup)channelGroup.hidden=!state.hasSource;
    root.dataset.channelMuteMask=String(state.channelMuteMask??channelEnabled.reduce((mask,on,index)=>on?mask:mask|(1<<index),0));
    channelButtons.forEach((button,index)=>{
      if(!button)return;const enabled=channelEnabled[index]!==false;
      text(button,`CH ${index+1} · ${enabled?'On':'Off'}`);
      button.setAttribute('aria-pressed',String(enabled));button.setAttribute('aria-label',`VGM CH${index+1} output ${enabled?'On':'Off'}`);
    });
    text(play,state.seekCancelling?'Cancelling…':state.seeking?'Seeking…':state.seekPreparing?'Cancelling…':state.playing?'Pause':state.paused?'Resume':'Play');
    play.disabled=Boolean(choosing||state.loading||state.busy||!state.hasSource);
    stop.disabled=!(choosing||state.loading||state.seeking||state.seekPreparing||state.canStop||['starting','seeking','playing','paused'].includes(state.playback));
    select.disabled=false;
    const message=selectionError||(state.seekCancelling?'Cancelling seek…':choosing||state.loading?'Validating VGM…':state.seeking?`Seeking to ${preciseTime(state.seekTargetSeconds)} · ${preciseTime(state.seekProgressSeconds)} prepared…`:
      state.seekPreparing?'Finishing the cancelled seek…':state.seekMessage?state.seekMessage:state.playback==='playing'?'Playing.':
      state.playback==='paused'?'Paused.':state.playback==='starting'?'Starting…':state.playback==='ended'?'Finished.':
      state.playback==='error'?state.errorMessage||'Playback failed.':state.hasSource?'Ready. Press Play; your instrument is kept.':
      'Add a VGM / VGZ to Files to hear a reference song.');
    text(status,message);status.dataset.error=String(Boolean(selectionError||state.playback==='error'||state.seekMessage?.startsWith('Seek failed:')));
    text(position,`${time(state.positionSeconds)}${state.durationSeconds!=null?` / ${time(state.durationSeconds)}`:''}`);
    if(seek){
      const duration=Math.max(0,state.durationSeconds??0),draft=seekDraft??(state.seeking?state.seekTargetSeconds:state.positionSeconds)??0;
      const displayed=Math.max(0,Math.min(duration,draft));seek.max=String(duration);seek.value=String(displayed);
      seek.disabled=Boolean(choosing||state.loading||state.seekPreparing||state.seekCancelling||!state.hasSource||!duration||state.canSeek===false);
      seek.setAttribute('aria-valuetext',`${preciseTime(displayed)} of ${preciseTime(duration)}`);text(seekPosition,preciseTime(displayed));
    }
    if(cancelSeekButton){cancelSeekButton.hidden=!(state.seeking||state.seekPreparing||state.seekCancelling);cancelSeekButton.disabled=Boolean(state.seekCancelling||state.seekPreparing&&!state.seeking);}
    const payload=getCapturePayload(state);
    if(capture){capture.disabled=capturing||!payload?.capturable;text(capture,capturing?'Capturing…':'Capture to Synth');}
    text(captureStatus,captureMessage||(payload?payload.capturable?payload.playable?payload.description:`Capture available. ${payload.reason}`:payload.reason:
      state.paused?'Choose a recorded CH to audition or capture its configured sound.':'Pause a song and choose a CH to capture its configured sound.'));
    root.dataset.capturePending=String(capturing);root.dataset.capturable=String(Boolean(payload?.capturable));root.dataset.viewTarget=String(viewTarget);
    onState(decorate(state));
  }
  const report=error=>{if(!disposed&&error?.name!=='AbortError'){selectionError=error?.message??String(error);showState(read());onStatus(`VGM: ${selectionError}`);}};
  preview=createPreview({getAudio,beforePlay,onState:showState,onStatus});
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  function stopCurrent(){
    if(disposed)return false;
    cancelPendingCapture();selection++;pending?.abort();pending=null;choosing=false;selectionError='';select.value=selectedPath??'';
    seekDraft=null;seekCancelled=true;
    preview.stop();showState(read());return true;
  }
  async function choose(path){
    if(disposed)return false;
    const entry=path&&project.listEntries().find(entry=>entry.path===path&&entry.fileType==='binary'&&isHuc6280SongPath(entry.path));
    if(!entry)return false;
    const key=JSON.stringify([entry.path,entry.revision]);
    if(selectedPath===path&&selectedRevision===entry.revision){
      if(choosing){selection++;pending?.abort();pending=null;choosing=false;selectionError='';showState(read());}
      attempted=key;select.value=path;return true;
    }
    if(attempted===key)return selectedPath===path&&selectedRevision===entry.revision;
    seekDraft=null;seekCancelled=true;
    cancelPendingCapture();attempted=key;const token=++selection;pending?.abort();const controller=new AbortController();pending=controller;
    choosing=true;selectionError='';select.value=path;showState(read());
    try{
      const file=project.fs.get(path);
      if(!file||file.type!=='binary')throw Error('The selected reference song is missing.');
      const result=await preview.load(file.data,path.split('/').pop(),{signal:controller.signal});
      if(disposed||token!==selection||controller.signal.aborted||result===false)return false;
      const current=project.listEntries().find(value=>value.path===path);
      if(!current||current.revision!==entry.revision)return false;
      selectedPath=path;selectedRevision=entry.revision;select.value=path;return true;
    }catch(error){
      if(!disposed&&token===selection&&!controller.signal.aborted&&error?.name!=='AbortError')report(error);
      return false;
    }finally{
      if(!disposed&&token===selection){choosing=false;pending=null;select.value=selectedPath??'';showState(read());}
    }
  }
  function refresh(){
    if(disposed)return;
    const entries=project.listEntries().filter(entry=>entry.fileType==='binary'&&isHuc6280SongPath(entry.path)).sort((a,b)=>a.path.localeCompare(b.path));
    const signature=JSON.stringify(entries.map(entry=>[entry.path,entry.revision]));
    if(signature!==listSignature){
      listSignature=signature;
      const placeholder=doc.createElement('option');placeholder.value='';placeholder.disabled=true;placeholder.textContent=entries.length?'Choose VGM…':'No VGM files';
      select.replaceChildren(placeholder,...entries.map(entry=>{const option=doc.createElement('option');option.value=entry.path;option.textContent=entry.path.slice('/vgm/'.length);option.title=entry.path;return option;}));
    }
    if(selectedPath&&!entries.some(entry=>entry.path===selectedPath)){
      stopCurrent();preview.clear();selectedPath=null;selectedRevision=-1;attempted='';
    }
    const next=entries.some(entry=>entry.path===project.selectedPath)?project.selectedPath:
      entries.some(entry=>entry.path===selectedPath)?selectedPath:entries[0]?.path??null;
    select.value=selectedPath??next??'';
    if(next)void choose(next);else{selection++;pending?.abort();pending=null;choosing=false;showState(read());}
  }
  const unsubscribe=project.onDidChange(refresh);
  listen(select,'change',()=>{select.blur();const path=select.value;attempted='';selectionError='';
    if(isHuc6280SongPath(path)&&project.fs.has(path)){void choose(path);project.select(path);}
  });
  listen(play,'click',()=>{
    play.blur();selectionError='';const state=read();
    if(choosing||state.loading||state.busy||!state.hasSource)return;
    cancelPendingCapture();if(state.playing){preview.pause();return;}
    void Promise.resolve(state.paused?preview.resume():preview.play()).catch(report);
  });
  listen(stop,'click',()=>{stop.blur();stopCurrent();});
  async function seekTo(seconds){
    const state=read();if(disposed||choosing||state.loading||state.seekPreparing||state.seekCancelling||!state.hasSource||state.canSeek===false)return false;
    seekDraft=null;seekCancelled=true;selectionError='';cancelPendingCapture();return preview.seek(seconds);
  }
  async function cancelCurrentSeek(){
    seekDraft=null;seekCancelled=true;selectionError='';
    if(disposed)return false;showState(read());return preview.cancelSeek();
  }
  function handleEscape(event,fromRange=false){
    if(disposed||event.key!=='Escape'||event.defaultPrevented)return;
    const state=read(),gesture=seekPointer||seekDraft!==null,activeSeek=state.seeking||state.seekPreparing||state.seekCancelling;
    if(!fromRange&&!gesture){
      if(!activeSeek)return;
      // An Escape already used to edit text or close a native control/dialog
      // does not cancel transport work unless our own drag is still pending.
      const control=event.target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');
      if(control&&control!==seek&&!control.matches?.('input[type="range"],input[type="checkbox"],input[type="radio"]'))return;
    }
    // Native range blur can synchronously flush its pending change event.
    // Fence that event before blurring or rendering a disabled control.
    seekDraft=null;seekCancelled=true;event.preventDefault();event.stopPropagation();seek?.blur();
    if(activeSeek)void cancelCurrentSeek().catch(report);else showState(state);
  }
  if(seek){
    listen(seek,'pointerdown',()=>{seekPointer=true;seekCancelled=false;});
    listen(seek,'input',()=>{
      if(!seekPointer)seekCancelled=false;
      if(seekCancelled){showState(read());return;}seekDraft=Number(seek.value);showState(read());
    });
    listen(seek,'change',()=>{
      if(seekCancelled){seekDraft=null;showState(read());return;}
      const seconds=Number(seek.value);seekDraft=null;seekCancelled=true;
      // A blur-generated recursive change belongs to this same commit. Its
      // readback must not replace the captured destination or commit twice.
      seek.blur();void seekTo(seconds).catch(report);
    });
    listen(seek,'pointerup',()=>{seekPointer=false;seek.blur();});
    listen(seek,'pointercancel',()=>{seekPointer=false;seekDraft=null;seekCancelled=true;seek.blur();const state=read();
      if(state.seeking||state.seekPreparing)void cancelCurrentSeek().catch(report);else{seekDraft=null;seekPointer=false;seekCancelled=true;showState(state);}
    });
    listen(seek,'keydown',event=>{
      if(event.key==='Home'||event.key==='End'){
        event.preventDefault();event.stopPropagation();seekDraft=null;seekCancelled=true;seek.blur();
        // The native range's 0.01-second step can stop short of a fractional
        // song end. Address the transport's exact duration instead of value.
        void seekTo(event.key==='Home'?0:read().durationSeconds).catch(report);return;
      }
      handleEscape(event,true);
    });
  }
  // Safari can keep focus on body throughout a native range drag. Handle the
  // same gesture at document level as well, without depending on range focus.
  if(typeof doc.addEventListener==='function')listen(doc,'keydown',event=>handleEscape(event));
  if(cancelSeekButton)listen(cancelSeekButton,'click',()=>{cancelSeekButton.blur();void cancelCurrentSeek().catch(report);});
  function setChannelEnabled(channel,enabled){
    if(!Number.isInteger(channel)||channel<0||channel>5)throw RangeError('VGM channel must be CH1–CH6.');
    if(typeof enabled!=='boolean')throw TypeError('VGM channel enabled must be boolean.');
    if(disposed)return false;
    return decorate(preview.setChannelEnabled(channel,enabled));
  }
  channelButtons.forEach((button,index)=>{
    if(!button)return;
    listen(button,'pointerdown',event=>{if(event.button===0)event.preventDefault();});
    listen(button,'click',()=>{button.blur();try{setChannelEnabled(index,read().channelEnabled?.[index]===false);}catch(error){report(error);}});
  });
  function getPausedSelection(state=read()){
    if(disposed||choosing||state.loading||state.busy||state.seeking||state.seekPreparing||state.seekCancelling||!state.paused||!state.hasSource||state.liveError||viewTarget==='synth'||!selectedPath||
      !state.liveState||state.liveState.positionFrames!==state.positionFrames)return null;
    const snapshot=state.liveState,channel=viewTarget;
    const key=JSON.stringify([selectedPath,selectedRevision,state.positionFrames,channel,snapshot.revision??null]);
    if(pausedSelectionCache?.key===key&&pausedSelectionCache.snapshot===snapshot)return pausedSelectionCache;
    let prepared;
    try{prepared=prepareHuc6280SongVoice(snapshot,channel);}
    catch(error){prepared={preset:null,channel,source:'unknown',positionFrames:state.positionFrames,playable:false,capturable:false,reason:error.message,description:error.message};}
    return pausedSelectionCache={key,snapshot,channel,positionFrames:state.positionFrames,sourcePath:selectedPath,sourceRevision:selectedRevision,prepared};
  }
  function getCapturePayload(state=read()){
    const selection=getPausedSelection(state);if(!selection)return null;
    return{...selection.prepared,key:selection.key,frame:selection.positionFrames,sourcePath:selection.sourcePath,sourceRevision:selection.sourceRevision,snapshot:selection.snapshot};
  }
  function cancelPendingCapture(){captureOperation++;capturing=false;captureMessage='';captureBinding=null;}
  function setView(value,{notify=true,reason='api'}={}){
    if(value!=='synth'){if(typeof value==='string'&&/^[0-5]$/.test(value))value=Number(value);if(!Number.isInteger(value)||value<0||value>5)throw RangeError('Song view must be Synth or CH1–CH6');}
    if(disposed)return false;if(value===viewTarget)return decorate(read());
    cancelPendingCapture();viewTarget=value;showState(read());if(notify)onViewChange(value,{reason});return decorate(read());
  }
  async function captureCurrent(){
    if(disposed||capturing)return false;
    const payload=getCapturePayload();
    if(!payload?.capturable){if(payload?.reason){captureMessage=payload.reason;showState(read());onStatus(payload.reason);}return false;}
    const token=++captureOperation,boundKey=payload.key;
    const isCurrent=()=>!disposed&&token===captureOperation&&getPausedSelection()?.key===boundKey;
    capturing=true;captureBinding=boundKey;captureMessage='';showState(read());let succeeded=false;
    try{
      const result=await onCapture(payload,{isCurrent});
      if(!isCurrent()||result===false)return false;
      viewTarget='synth';succeeded=true;captureMessage='Captured to Synth. The reference song remains paused.';return true;
    }finally{
      if(!disposed&&token===captureOperation){capturing=false;captureBinding=null;showState(read());if(succeeded)onViewChange('synth',{reason:'capture'});}
    }
  }
  if(capture)listen(capture,'click',()=>{capture.blur();void captureCurrent().catch(report);});
  refresh();showState(read());
  return{
    getState:()=>decorate(read()),read:()=>decorate(read()),isPlaying:()=>Boolean(read().playing),
    getPausedSelection,getCapturePayload,capture:captureCurrent,setView,cancelPendingCapture,setChannelEnabled,
    isActive:()=>Boolean(choosing||read().loading||read().seeking||read().seekPreparing||read().seekCancelling||['starting','seeking','playing','paused'].includes(read().playback)),
    async selectPath(path){if(disposed||!isHuc6280SongPath(path)||!project.fs.has(path))return false;attempted='';const result=choose(path);project.select(path);return result;},
    setLiveEnabled(value){if(disposed)return false;return decorate(preview.setLiveEnabled(value));},
    stop:stopCurrent,seek:seekTo,cancelSeek:cancelCurrentSeek,whenIdle:()=>preview.whenIdle?.()??Promise.resolve(),
    dispose(){if(disposed)return;disposed=true;cancelPendingCapture();selection++;pending?.abort();unsubscribe();for(const remove of listeners)remove();preview.dispose();},
  };
}
