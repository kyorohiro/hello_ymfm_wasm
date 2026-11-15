// SPDX-License-Identifier: BSD-3-Clause
import {createNesSongPlayer} from './song_player.js';
import {captureNesSongPreset} from './song_state.js';

const songPath=path=>/^\/vgm\/.*\.(?:vgm|vgz)$/i.test(path);
const timeLabel=seconds=>{const value=Math.max(0,Math.floor(seconds||0));return Math.floor(value/60)+':'+String(value%60).padStart(2,'0');};

/** Project-backed reference transport. Selection and Auto/physical-channel
 * editor tabs belong to the Synth, so this controller never changes them. */
export function setupNesSongControls({project,ensureAudio,getAudio,stopCode=async()=>{},
  getClickGuard=()=>true,
  onState=()=>{},onLiveState=()=>{},setStatus=()=>{},document:doc=globalThis.document,
  createPlayer=createNesSongPlayer}={}) {
  const node=id=>doc.getElementById(id),listeners=[];
  let selectedPath='',sourceData=null,operation=0,optionsSignature='',loading=false,disposed=false,state=null,seekDraft=false,preparation=null;
  const listen=(id,type,callback)=>{const target=node(id);if(target){target.addEventListener(type,callback);listeners.push(()=>target.removeEventListener(type,callback));}};
  const report=error=>{if(error?.name!=='AbortError')setStatus(error?.message??String(error),true);};
  const run=task=>void Promise.resolve().then(task).catch(report);
  const player=createPlayer({getAudio,getClickGuard,beforePlay:async({manualPreparation=false}={})=>{
    if(!manualPreparation)await stopCode();await ensureAudio();
  },onState:next=>{
    state=next;render();onState(next);if(next.liveState)onLiveState(next.liveState,next);
  },onStatus:message=>setStatus(message,true)});
  function currentState(){return state??player.getState();}
  function render() {
    if(disposed)return;
    const current=currentState(),playback=current.playback,loaded=Boolean(selectedPath&&sourceData);
    const play=node('nesSongPlay'),pause=node('nesSongPause'),stop=node('nesSongStop'),seek=node('nesSongSeek');
    if(play){play.disabled=!loaded||loading||current.busy||playback==='playing'||playback==='paused';play.textContent='Play song';}
    if(pause){pause.disabled=!current.canPause&&!current.canResume;pause.textContent=playback==='paused'?'Resume':'Pause';}
    if(stop)stop.disabled=!current.canStop;
    if(seek){seek.max=String(Math.max(1,current.durationSeconds));seek.disabled=!loaded||!current.canSeek;if(!seekDraft)seek.value=String(current.positionSeconds);}
    const position=node('nesSongPosition');if(position)position.textContent=timeLabel(current.positionSeconds)+' / '+timeLabel(current.durationSeconds);
    const message=loading||playback==='starting'?'Preparing reference song…':current.seeking?'Seeking · '+Math.round(current.seekProgress*100)+'%':current.errorMessage||
      (current.preparingAudition?'Preparing paused channels…':loaded?playback==='paused'?'Paused · play or edit the selected channel.':playback==='playing'?'Playing · NES APU / FDS':playback==='ended'?'Ended · select a channel to audition or capture.':'Ready · '+selectedPath:'Import a VGM / VGZ song.');
    const status=node('nesSongStatus');if(status){status.textContent=message;status.hidden=!message;}
  }
  function refresh() {
    if(disposed)return;
    const entries=project.fs.list().filter(file=>file.type==='binary'&&songPath(file.path));
    const signature=JSON.stringify(entries.map(file=>[file.path,file.revision]));
    if(signature===optionsSignature)return;
    optionsSignature=signature;
    const select=node('nesSongSelect');
    if(select){
      const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent=entries.length?'Choose a song…':'Import VGM / VGZ…';
      const options=entries.map(file=>{const option=doc.createElement('option');option.value=file.path;option.textContent=file.path.slice(5);option.title=file.path;return option;});
      select.replaceChildren(placeholder,...options);select.disabled=!entries.length;
    }
    const selected=entries.find(file=>file.path===selectedPath);
    const unchanged=selected&&sourceData?.length===selected.data.length&&sourceData.every((byte,index)=>byte===selected.data[index]);
    if(selectedPath&&!unchanged){operation++;selectedPath='';sourceData=null;player.clear();}
    if(select)select.value=selectedPath;render();
  }
  async function selectFile(value) {
    if(disposed)return false;
    const file=typeof value==='string'?project.fs.get(value):value;
    const path=typeof value==='string'?value:value?.path,data=file?.data;
    if(!songPath(path)||!(data instanceof Uint8Array))throw new Error('Choose a VGM or VGZ file in /vgm');
    if(selectedPath===path&&sourceData?.length===data.length&&sourceData.every((byte,index)=>byte===data[index]))return true;
    const ticket=++operation;loading=true;render();
    try{
      await player.load(data,path.split('/').pop());if(disposed||ticket!==operation)return false;
      selectedPath=path;sourceData=data.slice();state=player.getState();
      const select=node('nesSongSelect');if(select)select.value=path;setStatus('Reference song loaded · '+path);return true;
    }catch(error){const select=node('nesSongSelect');if(select)select.value=selectedPath;throw error;}
    finally{if(!disposed&&ticket===operation){loading=false;render();}}
  }
  async function ensureEditable() {
    const current=player.getState();
    if(current.manualReady)return true;
    if(current.preparingAudition){await player.whenIdle();return player.getState().manualReady;}
    if(!current.loaded||current.busy)return false;
    preparation??=player.seek(current.positionSeconds,{manualPreparation:true}).finally(()=>{preparation=null;});
    await preparation;return player.getState().manualReady;
  }
  listen('nesSongSelect','change',()=>{const select=node('nesSongSelect');if(select.value)run(()=>selectFile(select.value));select.blur();});
  listen('nesSongPlay','click',()=>run(()=>player.play()));
  listen('nesSongPause','click',()=>run(()=>currentState().paused?player.resume():player.pause()));
  listen('nesSongStop','click',()=>player.stop());
  listen('nesSongSeek','input',()=>{seekDraft=true;const position=node('nesSongPosition');if(position)position.textContent=timeLabel(Number(node('nesSongSeek').value))+' / '+timeLabel(currentState().durationSeconds);});
  listen('nesSongSeek','change',()=>{const value=Number(node('nesSongSeek').value);seekDraft=false;run(()=>player.seek(value));node('nesSongSeek').blur();});
  const unsubscribe=project.onDidChange(refresh);refresh();render();
  return {player,selectFile,load:selectFile,refresh,getState:()=>player.getState(),snapshot:()=>player.getState().liveState,
    capture:(channel,options={})=>captureNesSongPreset(player.getState().liveState,{...options,channel}),
    setLiveEnabled:value=>player.setLiveEnabled(value),setClickGuard:value=>player.setClickGuard(value),ensureEditable,whenIdle:()=>player.whenIdle(),
    stop:()=>player.stop(),reset(){operation++;selectedPath='';sourceData=null;player.clear();const select=node('nesSongSelect');if(select)select.value='';refresh();render();},
    dispose(){if(disposed)return;disposed=true;operation++;unsubscribe?.();listeners.forEach(remove=>remove());player.dispose();}};
}
