// SPDX-License-Identifier: BSD-3-Clause
// Authored CD audio transport; session files deliberately stay outside Cassette.
import {isCddaProjectEntry,isCddaSessionPath} from './cdda_inputs.js';
const setHostTimer=globalThis.setTimeout.bind(globalThis),clearHostTimer=globalThis.clearTimeout.bind(globalThis);
const clock=seconds=>{const centis=Math.round(Math.max(0,seconds??0)*100);return `${Math.floor(centis/6000)}:${((centis%6000)/100).toFixed(2).padStart(5,'0')}`;};
const label=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160);

export function setupCddaControls({root,source,session,project,addFiles,onStatus=()=>{},onOutput=()=>{},beforePlay=()=>{},afterPlay=()=>{},isVisible=()=>true}={}){
  const doc=root.ownerDocument,win=doc.defaultView??globalThis,$=id=>root.querySelector('#'+id),listeners=[];
  const select=$('cddaSourceSelect'),trackSelect=$('cddaTrackSelect'),load=$('cddaLoadSource'),play=$('cddaPlay'),stop=$('cddaStop'),seek=$('cddaSeek');
  const stateNode=$('cddaSourceState'),info=$('cddaSourceInfo'),status=$('cddaSourceStatus'),position=$('cddaPosition'),storage=$('cddaStorageNote'),input=$('cddaSessionInput');
  let disposed=false,selected=null,signature='',trackSignature='',lastProjectSelection=null,localError='',lastRevision=-1,loading=null,loadSerial=0,playPending=false,playSerial=0,pendingLabel='Starting…',sessionBusy=false;
  let seekDraft=null,seekPointer=false,seekCancelled=false,seekRevision=null,polling=false,timer=null;
  const jsonCache=new Map();
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  const report=error=>{if(disposed||error?.name==='AbortError')return;localError=error?.message??String(error);render();onStatus('CD-DA: '+localError,true);};
  function cancelPlay(){playSerial++;playPending=false;render();}
  function cancelLoad({all=false}={}){loadSerial++;loading?.controller.abort();loading=null;if(all)source.cancelLoad();}
  function projectEntries(){
    return project.listEntries().filter(entry=>{
      if(!/\.json$/i.test(entry.path))return isCddaProjectEntry(entry);
      let cached=jsonCache.get(entry.path);if(cached?.revision!==entry.revision){cached={revision:entry.revision,allowed:isCddaProjectEntry(entry,project.fs.get(entry.path)?.data)};jsonCache.set(entry.path,cached);}
      return cached.allowed;
    });
  }
  function allEntries(){return [...projectEntries(),...session.list().map(entry=>({...entry,revision:entry.path}))];}
  function refreshSources(){
    if(disposed)return;const files=allEntries();
    if(loading?.path&&!files.some(entry=>entry.path===loading.path&&entry.revision===loading.revision))cancelLoad();
    const nextSignature=JSON.stringify(files.map(entry=>[entry.path,entry.revision]));
    if(signature!==nextSignature){
      signature=nextSignature;const empty=doc.createElement('option');empty.value='';empty.textContent=files.length?'Choose WAV / track manifest…':'No CD audio sources';empty.disabled=true;
      const groups=['Project Files','Session WAVs'].map(text=>{const group=doc.createElement('optgroup');group.label=text;return group;});
      for(const entry of files){const option=doc.createElement('option');option.value=entry.path;option.textContent=label(entry.session?entry.name:entry.path.slice(1));groups[entry.session?1:0].append(option);}
      select.replaceChildren(empty,...groups.filter(group=>group.children.length));
    }
    if(lastProjectSelection!==project.selectedPath){lastProjectSelection=project.selectedPath;if(files.some(entry=>entry.path===lastProjectSelection&&!entry.session))selected=lastProjectSelection;}
    if(!files.some(entry=>entry.path===selected))selected=files[0]?.path??null;
    select.value=selected??'';render();
  }
  function render(){
    if(disposed)return;const value=source.read(),track=value.track,asset=value.asset,tracks=asset?.tracks??[],duration=track?.frames/44100||0;
    if(lastRevision!==value.revision){lastRevision=value.revision;localError='';seekDraft=null;seekCancelled=true;}
    const origin=asset?(isCddaSessionPath(asset.path)||tracks.some(item=>isCddaSessionPath(item.file))?'session':asset.path?'project':'memory'):'none';
    const data={sourceId:value.sourceId,revision:value.revision,state:value.state,sourceState:value.state,busy:value.busy||sessionBusy,playPending,selectedTrack:value.selectedTrack??'',trackFrames:track?.frames??0,positionFrames:Math.round(value.position*44100),duration,sessionCount:session.list().length,sourcePath:asset?.path??'',sourceKind:origin};
    for(const node of [root,stateNode])for(const[key,item]of Object.entries(data))node.dataset[key]=String(item);
    const nextTracks=JSON.stringify(tracks.map(item=>[item.number,label(item.title),label(item.file)]));
    if(trackSignature!==nextTracks){trackSignature=nextTracks;trackSelect.replaceChildren(...tracks.map(item=>{const option=doc.createElement('option');option.value=String(item.number);option.textContent=`${item.number} · ${label(item.title||item.file?.split('/').pop()||'Audio track')}`;return option;}));}
    trackSelect.value=String(value.selectedTrack??'');trackSelect.disabled=!tracks.length||value.busy||sessionBusy;
    load.disabled=!selected||value.busy||sessionBusy;select.disabled=sessionBusy;$('cddaCancelLoad').hidden=!value.busy;
    play.disabled=!track||value.busy||sessionBusy||playPending||value.transportPending;
    play.textContent=playPending?pendingLabel:value.state==='playing'?'Pause':value.state==='paused'?'Resume':'Play';
    stop.disabled=!(playPending||value.transportPending||value.busy||['playing','paused'].includes(value.state));
    $('cddaClearSession').disabled=!session.list().length||sessionBusy;
    stateNode.textContent=playPending?pendingLabel:sessionBusy?'Clearing session…':value.busy?'Loading track…':value.state==='empty'?'Empty':value.state==='ready'?'Ready':value.state==='playing'?'Playing':value.state==='paused'?'Paused':'Finished';
    info.textContent=asset&&track?`${label(asset.name)} · Track ${track.number} · ${label(track.title||track.file?.split('/').pop()||'Audio')} · ${clock(duration)} · ${track.bytes.toLocaleString()} PCM bytes · 44.1 kHz stereo PCM16`:'Choose a 44.1 kHz stereo PCM16 WAV or a track manifest, then Load.';
    const shown=Math.max(0,Math.min(duration,seekDraft??value.position));seek.max=String(duration);seek.value=String(shown);seek.disabled=!track||value.busy||sessionBusy||playPending;
    seek.setAttribute('aria-valuetext',`${clock(shown)} of ${clock(duration)}`);position.textContent=`${clock(shown)} / ${clock(duration)}`;
    const files=session.list(),bytes=files.reduce((sum,file)=>sum+file.size,0);
    storage.textContent=files.length?`Session only · ${files.length} WAV${files.length===1?'':'s'} · ${(bytes/1048576).toFixed(1)} MiB. Not included in Project / Cassette exports or reload recovery. Keep the original WAVs and reopen them after restoring a Project.`:'Project Files / Cassette: 16 MiB total. Open session WAVs for longer audio; session audio is not saved or exported with the Project.';
    status.textContent=localError||value.error||'';status.dataset.error=String(Boolean(localError||value.error));schedulePoll();
  }
  function schedulePoll(){
    if(disposed||timer!==null||polling||doc.hidden||source.read().state!=='playing')return;
    timer=setHostTimer(async()=>{timer=null;if(disposed)return;polling=true;try{await source.getState();}catch(error){report(error);}finally{polling=false;if(!disposed){render();onOutput();}}},isVisible()?100:300);
  }
  async function loadSelected(){
    if(disposed||!selected||sessionBusy)return false;
    const entry=allEntries().find(entry=>entry.path===selected);if(!entry)return false;
    cancelLoad();cancelPlay();seekDraft=null;localError='';const serial=++loadSerial,controller=new AbortController(),path=selected;
    loading={controller,path,revision:entry.revision};
    try{await source.load(path,{name:entry.name??path.split('/').pop(),path,signal:controller.signal});if(disposed||serial!==loadSerial)return false;
      onStatus(`CD-DA loaded · ${label(entry.name??path)}. Press Play; other sound chips continue.`);return true;
    }catch(error){if(serial===loadSerial)report(error);return false;}finally{if(serial===loadSerial){loading=null;render();}}
  }
  async function chooseTrack(number){
    cancelPlay();cancelLoad();seekDraft=null;localError='';const serial=++loadSerial,controller=new AbortController();loading={controller,path:null,revision:null};
    try{await source.selectTrack(number,{signal:controller.signal});if(!disposed&&serial===loadSerial)onStatus(`CD-DA Track ${number} selected · press Play.`);}
    catch(error){if(serial===loadSerial)report(error);}finally{if(serial===loadSerial){loading=null;render();}}
  }
  function cancelSeekPreview({blur=true}={}){seekPointer=false;seekDraft=null;seekCancelled=true;if(blur)seek.blur();render();}
  function commitSeek(seconds){seekDraft=null;seekCancelled=true;localError='';if(disposed)return;void source.seek(seconds).then(onOutput).catch(report);}
  listen(select,'change',()=>{select.blur();cancelLoad();selected=select.value;localError='';if(!isCddaSessionPath(selected))project.select(selected);render();});
  listen(load,'click',()=>{load.blur();void loadSelected();});
  listen(trackSelect,'change',()=>{const number=Number(trackSelect.value);trackSelect.blur();void chooseTrack(number);});
  listen($('cddaAddFiles'),'click',()=>{doc.activeElement?.blur?.();addFiles();});
  listen($('cddaOpenSession'),'click',()=>{doc.activeElement?.blur?.();input.value='';input.click();});
  listen(input,'change',()=>{const files=[...input.files];input.value='';if(!files.length)return;localError='';try{const paths=session.addFiles(files);selected=paths[0]??selected;refreshSources();void loadSelected();}catch(error){report(error);}});
  listen($('cddaClearSession'),'click',()=>{
    doc.activeElement?.blur?.();const asset=source.read().asset;
    const sessionDependent=asset&&(isCddaSessionPath(asset.path)||asset.tracks.some(track=>isCddaSessionPath(track.file)));
    if(sessionDependent)cancelPlay();cancelLoad({all:true});sessionBusy=true;localError='';render();
    void(async()=>{
      if(sessionDependent){const cleared=await source.clear();if(disposed||cleared===false)return;}
      if(disposed)return;session.clear();if(isCddaSessionPath(selected))selected=null;refreshSources();
      onStatus('Session WAVs cleared · Project files and other sound chips kept.');
    })().catch(report).finally(()=>{sessionBusy=false;render();});
  });
  listen($('cddaCancelLoad'),'click',()=>{doc.activeElement?.blur?.();cancelLoad({all:true});localError='';render();onStatus('CD-DA load cancelled · previous track kept.');});
  listen(play,'click',()=>{
    play.blur();localError='';const value=source.read(),serial=++playSerial;
    pendingLabel=value.state==='playing'?'Pausing…':value.state==='paused'?'Resuming…':'Starting…';playPending=true;render();
    void(async()=>{
      if(value.state==='playing')await source.pause();
      else {
        const ready=beforePlay();if(ready&&typeof ready.then==='function')await ready;if(disposed||serial!==playSerial)return;
        if(value.state==='paused')await source.resume();else await source.play(value.selectedTrack,{offset:value.position>=value.track.frames/44100?0:value.position});
      }
      if(disposed||serial!==playSerial)return;if(value.state!=='playing')await afterPlay();onOutput();
    })().catch(error=>{if(serial===playSerial)report(error);}).finally(()=>{if(!disposed&&serial===playSerial){playPending=false;render();}});
  });
  listen(stop,'click',()=>{stop.blur();cancelPlay();cancelLoad({all:true});seekDraft=null;localError='';void source.stop().then(onOutput).catch(report);});
  listen(seek,'pointerdown',()=>{seekPointer=true;seekCancelled=false;seekRevision=source.read().revision;});
  listen(seek,'input',()=>{
    if(seekPointer&&seekRevision!==source.read().revision){seekCancelled=true;seekDraft=null;render();return;}
    if(!seekPointer)seekCancelled=false;if(seekCancelled)return;seekDraft=Number(seek.value);render();
  });
  listen(seek,'change',()=>{if(seekCancelled)return;const seconds=Number(seek.value);seekDraft=null;seekCancelled=true;seek.blur();commitSeek(seconds);});
  listen(seek,'pointerup',()=>{
    const commit=!seekCancelled&&seekDraft!==null,seconds=seekDraft;seekPointer=false;seekDraft=null;seekCancelled=true;seek.blur();
    if(commit)commitSeek(seconds);else render();
  });
  listen(seek,'pointercancel',()=>cancelSeekPreview());
  listen(seek,'blur',()=>{if(seekPointer||seekDraft!==null)cancelSeekPreview({blur:false});});
  listen(seek,'keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelSeekPreview();}
    else if(event.key==='Home'||event.key==='End'){event.preventDefault();event.stopPropagation();seekCancelled=true;seekDraft=null;seek.blur();commitSeek(event.key==='Home'?0:(source.read().track?.frames??0)/44100);}
  });
  listen(doc,'keydown',event=>{if(event.key==='Escape'&&seekPointer&&!event.defaultPrevented){event.preventDefault();cancelSeekPreview();}});
  listen(win,'blur',()=>cancelSeekPreview());
  listen(doc,'visibilitychange',()=>{if(doc.hidden){clearHostTimer(timer);timer=null;cancelSeekPreview();}else render();});
  const unproject=project.onDidChange(refreshSources),unsession=session.subscribe(refreshSources),unsubscribe=source.subscribe(render);
  refreshSources();
  return{refresh:render,refreshSources,loadSelected,cancelPlay,
    dispose(){if(disposed)return;disposed=true;playSerial++;loading?.controller.abort();clearHostTimer(timer);unproject();unsession();unsubscribe();for(const remove of listeners)remove();},
  };
}
