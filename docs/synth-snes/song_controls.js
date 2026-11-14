// SPDX-License-Identifier: BSD-3-Clause
import {setupSnesSongSeekControls} from './song_seek_controls.js';
export function setupSnesSongControls({player,document:doc=globalThis.document,onError=()=>{},setMuteMask=value=>player.setMuteMask(value)}){
  const $=id=>doc.getElementById(id),cleanups=[];let state=player.read();
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);cleanups.push(()=>node.removeEventListener(type,fn));};
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const call=fn=>void Promise.resolve().then(fn).catch(onError);
  const seekControls=setupSnesSongSeekControls({player,range:$('spcSongSeek'),time:$('spcSongPosition'),document:doc,onError});
  const channels=$('spcSongChannels');
  for(let index=0;index<8;index++){
    const button=doc.createElement('button');button.type='button';button.dataset.spcMute=String(index);button.textContent=`CH${index+1}`;
    listen(button,'click',()=>{button.blur();call(()=>setMuteMask(state.muteMask^(1<<index)));});channels.append(button);
  }
  function update(next){
    state=next;const loaded=state.loaded,busy=state.busy;
    text($('spcSongTitle'),state.source?[state.source.title||state.source.name,state.source.game].filter(Boolean).join(' · '):'No SPC loaded');
    $('spcSongPlay').disabled=!loaded||busy||state.playing;$('spcSongPause').disabled=!loaded||busy||!state.playing;$('spcSongStop').disabled=!loaded;
    seekControls.update(state);
    text($('spcSongStatus'),state.error||({empty:'Load SPC from Menu or Sounds from SPC. Loading is silent.',stopped:'Stopped · Play starts from the snapshot.',paused:'Paused · Play resumes at this position.',loading:'Preparing SPC playback…',seeking:`Seeking to ${(state.seekTargetSeconds??0).toFixed(2)} s… Stop cancels the operation.`,playing:'Playing SPC · SPC700 + S-DSP. Your edited instrument is kept.'}[state.mode]??state.mode));
    $('spcSongStatus').dataset.error=String(Boolean(state.error));
    for(const button of channels.querySelectorAll('button')){const on=!(state.muteMask&(1<<Number(button.dataset.spcMute)));button.disabled=false;button.textContent=`CH${Number(button.dataset.spcMute)+1} · ${on?'On':'Off'}`;button.setAttribute('aria-pressed',String(on));button.title=`${on?'Mute':'Unmute'} SPC CH${Number(button.dataset.spcMute)+1}`;}
  }
  for(const[id,action]of [['spcSongPlay',()=>player.play()],['spcSongPause',()=>player.pause()],['spcSongStop',()=>player.stop()]])listen($(id),'click',()=>{seekControls.cancelDraft();$(id).blur();call(action);});
  update(state);
  return{update,dispose(){seekControls.dispose();for(const cleanup of cleanups)cleanup();}};
}
