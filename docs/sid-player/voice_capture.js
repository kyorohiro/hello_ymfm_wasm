// SPDX-License-Identifier: BSD-3-Clause
import {captureSidVoices} from './voice_snapshot.js';

/** One explicit read per capture. The owner is the accepted audio/tune, never a
 * display-poll snapshot or a draft model. A captured instrument is independent
 * of subsequent playback; cancelling a pending read keeps the previous one.
 */
export function createVoiceCapture({getSource,isCurrent,onUpdate=()=>{},capture=captureSidVoices}) {
  let serial=0,dead=false,busy=false,voice=0,snapshot=null,message='Play a tune, then capture its current voice settings.',error=false;
  const state=()=>({busy,voice,snapshot,selected:snapshot?.voices[voice]??null,message,error});
  const emit=()=>{if(!dead)onUpdate(state());};
  const previous=()=>snapshot?' Previous snapshot kept.':'';
  const controller={
    read:state,
    selectVoice(value){
      if(!Number.isInteger(value)||value<0||value>2)throw new RangeError('Snapshot voice must be 0, 1 or 2');
      if(dead)return;voice=value;emit();
    },
    async capture(){
      if(dead||busy)return false;
      const source=getSource();
      if(!source){message='Start playback before capturing a voice.'+previous();error=true;emit();return false;}
      const request=++serial;busy=true;error=false;message='Reading the current SID settings…';emit();
      try{
        const current=await source.engine.read();
        if(dead||request!==serial)return false;
        if(!isCurrent(source)){
          message='Capture cancelled because playback changed.'+previous();error=false;return false;
        }
        const next=capture(current,{name:source.name,subtune:source.subtune});
        snapshot={...next,name:source.name,subtune:source.subtune};
        message='Snapshot captured. Select a voice to save or open in the Synth.';error=false;return true;
      }catch(cause){
        if(dead||request!==serial)return false;
        message=`Capture failed: ${cause?.message??String(cause)}.${previous()}`;error=true;return false;
      }finally{if(!dead&&request===serial){busy=false;emit();}}
    },
    invalidate(){
      if(dead||!busy)return;
      serial++;busy=false;message='Capture cancelled because playback changed.'+previous();error=false;emit();
    },
    notify(text,isError=false){if(dead)return;message=text;error=isError;emit();},
    dispose(){if(dead)return;dead=true;serial++;busy=false;},
  };
  emit();return controller;
}
