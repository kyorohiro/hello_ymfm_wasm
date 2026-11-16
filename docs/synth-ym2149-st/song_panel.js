// SPDX-License-Identifier: BSD-3-Clause
import {listYmMusic,MUSIC_FILE_LIMIT} from './music_files.js';
import {YM_PROJECT_FILE_BYTES} from './code_project.js';
const time=seconds=>{const n=Math.max(0,Math.floor(seconds));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
export function setupYmSongPanel({project,files,player,onStatus=()=>{}}) {
  const $=id=>document.getElementById(id),listeners=[];
  let disposed=false,selectedPath='',selectedRevision=null,selection=0,pendingSelection=null,importGeneration=0,controller=null,signature='',seeking=false,stickyError='';
  const listen=(id,event,fn)=>{
    const node=$(id),listener=(...args)=>{try{Promise.resolve(fn(...args)).catch(report);}catch(e){report(e);}};
    node.addEventListener(event,listener);listeners.push(()=>node.removeEventListener(event,listener));
  };
  const say=(message,error=false)=>{
    if(disposed)return;$('ymSongStatus').textContent=message;$('ymSongPanel').dataset.error=String(error);onStatus(message,error);
  };
  const report=error=>{if(error?.name!=='AbortError'){stickyError=`${error?.message??error}. Previous song and instrument kept.`;say(stickyError,true);}};
  async function select(path,{signal}={}) {
    stickyError='';const token=++selection,file=project.fs.get(path);
    if(!file||file.type!=='binary')throw new Error('Choose a binary music file');
    pendingSelection?.controller.abort();
    const selectionController=new AbortController(),abort=()=>selectionController.abort();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    pendingSelection={path,revision:file.revision,controller:selectionController};
    say(`Preparing ${path.split('/').at(-1)}…`);
    try {
      const result=await player.load(file.data,{name:path.split('/').at(-1),signal:selectionController.signal});
      if(disposed||token!==selection)return false;
      selectedPath=path;selectedRevision=file.revision;$('ymSongSelect').value=path;
      update(result);return true;
    } catch(error) {if(token===selection&&!disposed)$('ymSongSelect').value=selectedPath;throw error;}
    finally {signal?.removeEventListener('abort',abort);if(pendingSelection?.controller===selectionController)pendingSelection=null;}
  }
  function refresh() {
    if(disposed)return;
    const entries=listYmMusic(project),next=entries.map(file=>`${file.path}:${file.revision}`).join('|');
    if(next===signature)return;signature=next;
    const selectNode=$('ymSongSelect');selectNode.replaceChildren();
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=entries.length?'Choose a reference song…':'Import music from Menu…';selectNode.append(placeholder);
    for(const file of entries){const option=document.createElement('option');option.value=file.path;option.textContent=file.path;selectNode.append(option);}
    if(pendingSelection) {
      const pending=entries.find(file=>file.path===pendingSelection.path);
      if(!pending||pending.revision!==pendingSelection.revision) {
        selection++;pendingSelection.controller.abort();pendingSelection=null;
      }
    }
    const current=entries.find(file=>file.path===selectedPath);
    if(selectedPath&&(!current||current.revision!==selectedRevision)) {
      selection++;pendingSelection?.controller.abort();pendingSelection=null;selectedPath='';selectedRevision=null;player.unload();
    }
    selectNode.value=selectedPath;
  }
  function update(state=player.read()) {
    if(disposed)return;
    $('ymSongPlay').disabled=!state.loaded||state.busy||state.playing;
    $('ymSongPause').disabled=state.busy||!state.playing&&!state.paused;
    $('ymSongPause').textContent=state.paused?'Resume':'Pause';
    $('ymSongStop').disabled=!state.canStop;
    $('ymSongSeek').disabled=!state.loaded||state.busy;
    $('ymSongSeek').max=String(state.durationSeconds||0);
    if(!seeking)$('ymSongSeek').value=String(state.positionSeconds||0);
    $('ymSongPosition').textContent=`${time(state.positionSeconds||0)} / ${time(state.durationSeconds||0)}${state.durationLimited?'*':''}`;
    $('ymSongLive').checked=state.liveEnabled;
    const subsongs=$('ymSubsong');
    if(subsongs.options.length!==state.subsongCount) {
      subsongs.replaceChildren();for(let n=1;n<=state.subsongCount;n++){const option=document.createElement('option');option.value=String(n);option.textContent=String(n);subsongs.append(option);}
    }
    subsongs.value=String(state.subsong);subsongs.disabled=state.busy;$('ymSubsongField').hidden=state.subsongCount<2;
    if(stickyError)say(stickyError,true);
    else if(state.error)say(state.error,true);
    else if(state.loaded&&!state.loading) {
      const title=state.metadata?.title||state.metadata?.musicName||state.name;
      const phase=state.seeking?`Seeking ${Math.round(state.seekProgress*100)}%`:state.busy?'Preparing':state.paused?'Paused':state.playing?'Playing':state.playback==='ended'?'Ended':'Ready';
      const parts=[`${phase} · ${String(state.format).toUpperCase()} · ${title}`];
      if(state.durationLimited)parts.push('Unknown length: limited to 3 minutes');
      if(state.metadata?.extraOutputs?.includes('ste-dac'))parts.push('SNDH may also include STE audio; controls show YM voices');
      say(parts.join('. '));
    }
  }
  function reset() {
    if(disposed)return false;
    selection++;pendingSelection?.controller.abort();pendingSelection=null;
    importGeneration++;controller?.abort();controller=null;
    selectedPath='';selectedRevision=null;signature=null;seeking=false;stickyError='';
    $('ymMusicInput').value='';$('ymSongSelect').value='';
    player.unload();refresh();update();say('Import music from Menu…');
    return true;
  }
  listen('ymLoadMusic','click',()=>{$('ymMusicInput').value='';$('ymMusicInput').click();});
  listen('ymMusicInput','change',async()=>{
    const chosen=Array.from($('ymMusicInput').files??[]);$('ymMusicInput').value='';if(!chosen.length)return;
    if(chosen.length>128)throw new Error('Choose at most 128 music files at once');
    const total=chosen.reduce((sum,file)=>sum+file.size,0)+project.listEntries().reduce((sum,file)=>sum+file.size,0);
    if(total>YM_PROJECT_FILE_BYTES)throw new Error('These files exceed the 16 MiB Cassette capacity');
    stickyError='';
    const generation=++importGeneration;controller?.abort();controller=new AbortController();const signal=controller.signal;
    const current=()=>!disposed&&generation===importGeneration&&!signal.aborted;
    say(`Reading ${chosen.length} music file(s)…`);
    try {
      const sources=[];
      for(const file of chosen){if(file.size>MUSIC_FILE_LIMIT)throw new Error('Music files must be at most 16 MiB');sources.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});if(!current())return;}
      const paths=await files.importMusicSources(sources,{isCurrent:current});
      if(!current())return;
      if(!paths.length)throw new Error('Files are busy; try importing again');
      refresh();await select(paths[0],{signal});
    } catch(error) {if(current())throw error;}
  });
  listen('ymSongSelect','change',()=>{const path=$('ymSongSelect').value;$('ymSongSelect').blur();if(path)return select(path);});
  listen('ymSongPlay','click',()=>{stickyError='';return player.play();});
  listen('ymSongPause','click',()=>{stickyError='';return player.read().paused?player.resume():player.pause();});
  listen('ymSongStop','click',()=>{stickyError='';return player.stop();});
  listen('ymSubsong','change',()=>{stickyError='';return player.setSubsong(Number($('ymSubsong').value));});
  listen('ymSongLive','change',()=>player.setLive($('ymSongLive').checked));
  listen('ymSongSeek','pointerdown',()=>{seeking=true;});
  listen('ymSongSeek','input',()=>{$('ymSongPosition').textContent=`${time(Number($('ymSongSeek').value))} / ${time(player.read().durationSeconds)}`;});
  listen('ymSongSeek','change',()=>{seeking=false;return player.seek(Number($('ymSongSeek').value));});
  listen('ymSongSeek','pointercancel',()=>{seeking=false;update();});
  const unwatch=project.onDidChange(refresh);refresh();update();
  const ready=files.ready.then(()=>{refresh();update();});
  return {ready,update,select,reset,get selectedPath(){return selectedPath;},dispose(){disposed=true;selection++;pendingSelection?.controller.abort();pendingSelection=null;importGeneration++;controller?.abort();unwatch();for(const off of listeners)off();}};
}
