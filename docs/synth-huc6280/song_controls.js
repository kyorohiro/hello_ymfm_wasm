// SPDX-License-Identifier: BSD-3-Clause
import {createHuc6280SongPreview} from './song_preview.js';
import {isHuc6280SongPath} from './code_project.js?v=huc-song-1';

const time=seconds=>{
  const value=Math.max(0,Number.isFinite(seconds)?seconds:0);
  return `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
};

/** Files are validated passively. Only the transport's Play gesture acquires
 * audio; it never applies a song's registers to the authored instrument. */
export function setupHuc6280SongControls({project,getAudio,beforePlay,
  onState=()=>{},onStatus=()=>{},createPreview=createHuc6280SongPreview,document:doc=globalThis.document}={}){
  const $=id=>doc.getElementById(id),root=$('hucSongPlayer'),select=$('hucSongSelect');
  const play=$('hucSongPlayButton'),stop=$('hucSongStopButton'),status=$('hucSongStatus'),position=$('hucSongPosition');
  if(!root||!select||!play||!stop||!status)throw Error('HuC6280 song controls mount is missing.');
  const listeners=[];
  let disposed=false,selectedPath=null,selectedRevision=-1,attempted='',listSignature='',selection=0,choosing=false,selectionError='',pending=null;
  const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
  const decorate=state=>({...state,selectedPath,choosing});
  let preview;
  const read=()=>preview?.getState?.()??preview?.read?.()??{playback:'stopped',hasSource:false};
  function showState(state){
    if(disposed)return;
    root.dataset.state=state.playback;
    root.dataset.loading=String(Boolean(choosing||state.loading));
    root.dataset.positionFrames=String(state.positionFrames??0);
    root.dataset.renderedFrames=String((state.positionFrames??0)+(state.bufferedFrames??0));
    text(play,state.playing?'Pause':state.paused?'Resume':'Play');
    play.disabled=Boolean(choosing||state.loading||state.busy||!state.hasSource);
    stop.disabled=!(choosing||state.loading||state.canStop||['starting','playing','paused'].includes(state.playback));
    select.disabled=false;
    const message=selectionError||(choosing||state.loading?'Validating VGM…':state.playback==='playing'?'Playing.':
      state.playback==='paused'?'Paused.':state.playback==='starting'?'Starting…':state.playback==='ended'?'Finished.':
      state.playback==='error'?state.errorMessage||'Playback failed.':state.hasSource?'Ready. Press Play; your instrument is kept.':
      'Add a VGM / VGZ to Files to hear a reference song.');
    text(status,message);status.dataset.error=String(Boolean(selectionError||state.playback==='error'));
    text(position,`${time(state.positionSeconds)}${state.durationSeconds!=null?` / ${time(state.durationSeconds)}`:''}`);
    onState(decorate(state));
  }
  const report=error=>{if(!disposed&&error?.name!=='AbortError'){selectionError=error?.message??String(error);showState(read());onStatus(`VGM: ${selectionError}`);}};
  preview=createPreview({getAudio,beforePlay,onState:showState,onStatus});
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  function stopCurrent(){
    if(disposed)return false;
    selection++;pending?.abort();pending=null;choosing=false;selectionError='';select.value=selectedPath??'';
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
    attempted=key;const token=++selection;pending?.abort();const controller=new AbortController();pending=controller;
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
    if(state.playing){preview.pause();return;}
    void Promise.resolve(state.paused?preview.resume():preview.play()).catch(report);
  });
  listen(stop,'click',()=>{stop.blur();stopCurrent();});
  refresh();showState(read());
  return{
    getState:()=>decorate(read()),read:()=>decorate(read()),isPlaying:()=>Boolean(read().playing),
    isActive:()=>Boolean(choosing||read().loading||['starting','playing','paused'].includes(read().playback)),
    async selectPath(path){if(disposed||!isHuc6280SongPath(path)||!project.fs.has(path))return false;attempted='';const result=choose(path);project.select(path);return result;},
    stop:stopCurrent,whenIdle:()=>preview.whenIdle?.()??Promise.resolve(),
    dispose(){if(disposed)return;disposed=true;selection++;pending?.abort();unsubscribe();for(const remove of listeners)remove();preview.dispose();},
  };
}
