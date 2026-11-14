// SPDX-License-Identifier: BSD-3-Clause
/** One session mixer for the authored S-DSP, Code and SPC playback. */
export function createSnesMixer({getAudio,player,onChange=()=>{}}){
  let volume=1,mask=0;
  const read=()=>({volume,muteMask:mask});
  const api={read,
    async setMuteMask(value){if(!Number.isInteger(value)||value<0||value>255)throw RangeError('Mute mask must be 0..255');mask=value;await player.setMuteMask(mask);const owner=getAudio();if(owner)await owner.command('setMuteMask',[mask]);onChange(read());},
    setVolume(value){if(!Number.isFinite(value)||value<0||value>3.8)throw RangeError('Chip volume must be 0..3.8');volume=value;getAudio()?.setChipVolume(volume);onChange(read());},
    async apply(owner=getAudio()){let appliedMask,appliedVolume;do{appliedMask=mask;appliedVolume=volume;if(owner){owner.setChipVolume(appliedVolume);await owner.command('setMuteMask',[appliedMask]);}await player.setMuteMask(mask);}while(appliedMask!==mask||appliedVolume!==volume);onChange(read());},
    async reset(){api.setVolume(1);await api.setMuteMask(0);},
  };return api;
}
export function setupSnesChipTabs({document:doc=globalThis.document,onError=()=>{},mixer}){
 const listeners=[],$=id=>doc.getElementById(id);
 const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
 const buttons=[$('snesChipTab'),$('snesMixerTab')],panels=[$('snesChipPanel'),$('snesMixerPanel')];
 function select(index){buttons.forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});}
 buttons.forEach((button,i)=>{listen(button,'click',()=>{select(i);button.blur();});listen(button,'keydown',event=>{let index=event.key==='Home'?0:event.key==='End'?1:['ArrowLeft','ArrowRight'].includes(event.key)?1-i:null;if(index===null)return;event.preventDefault();select(index);buttons[index].focus();});});
 const volume=$('snesChipVolume'),value=$('snesChipVolumeValue'),reset=$('snesMixerReset');
 listen(volume,'input',()=>{try{mixer.setVolume(Number(volume.value)/100);update();}catch(error){onError(error);}});
 listen(reset,'click',()=>{reset.blur();void mixer.reset().then(update).catch(onError);});
 function update(){const state=mixer.read();volume.value=String(state.volume*100);value.textContent=`${Math.round(state.volume*100)}%`;reset.disabled=state.volume===1&&state.muteMask===0;}
 update();return {update,dispose(){for(const cleanup of listeners)cleanup();}};
}
