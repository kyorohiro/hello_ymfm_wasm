// SPDX-License-Identifier: BSD-3-Clause
// App client only: the audio owner starts and renders the release on arrival.
import {FM2608_ADPCM_RELEASE_SECONDS} from './adpcm_noteoff_guard.js';

let sequence = 0;
const write = (register,value) => ({type:'write',port:1,register,value});

/** Same owner callbacks as the offline/reference guard, without scheduling a
 * main-thread timestamp or posting a stream of future register writes.
 * getState times/fraction are request-time diagnostics, not renderer readback.
 */
export function createFm2608AudioOwnedRelease({postMessage = null,writePhysical,
  now = () => 0,sampleRate = 44100,getVolume,getMuted = () => false,
  getGate,requestedOff = () => {}} = {}) {
  for(const callback of [writePhysical,now,getVolume,getMuted,getGate,requestedOff])
    if(typeof callback!=='function')throw TypeError('ADPCM release requires owner callbacks');
  if(postMessage!==null&&typeof postMessage!=='function')throw TypeError('Invalid ADPCM release sender');
  if(!Number.isFinite(sampleRate)||sampleRate<=0)throw RangeError('Invalid ADPCM output sample rate');
  let tail=null,lastOwner=null,needsRestore=false,disposed=false;
  const level=() => getMuted()?0:getVolume();

  function noteOff() {
    if(disposed||tail)return false;
    const playing=getGate(),volume=level();
    requestedOff();
    if(!postMessage||!playing||volume===0) {
      writePhysical([write(0,1)]);
      return false;
    }
    const start=now();
    tail={owner:`fm2608-adpcm-release:${++sequence}`,start,end:start+FM2608_ADPCM_RELEASE_SECONDS};
    lastOwner=tail.owner;
    needsRestore=true;
    postMessage({type:'synth-adpcm-release',action:'release',owner:tail.owner,durationSeconds:FM2608_ADPCM_RELEASE_SECONDS});
    return true;
  }
  function cancel({restore=false,stop=false} = {}) {
    const previous=tail,owner=previous?.owner??lastOwner,affected=Boolean(previous||needsRestore);
    if(!affected||disposed)return false;
    if(stop)requestedOff();
    if(owner) {
      // Never expire this owner using the estimated main-thread deadline: its
      // request may reach the renderer late. A stale cancel names only this
      // owner and cannot stop or restore a subsequently triggered voice.
      postMessage({type:'synth-adpcm-release',action:'cancel',owner,stop,restore});
      tail=null;
      if(restore){needsRestore=false;lastOwner=null;}
    }
    return affected;
  }
  function restore() {
    if(disposed||!needsRestore)return;
    writePhysical([write(11,level())]);needsRestore=false;if(!tail)lastOwner=null;
  }
  return {
    noteOff,cancel,restore,
    volumeChanged() {},
    filterVolume(value) {return value;},
    getState() {
      if(!tail)return {pending:false,needsRestore};
      const progress=Math.max(0,Math.min(1,(now()-tail.start)/FM2608_ADPCM_RELEASE_SECONDS));
      return {pending:progress<1,needsRestore,...tail,fraction:(1+Math.cos(progress*Math.PI))/2};
    },
    dispose() {if(disposed)return;cancel();disposed=true;},
  };
}
