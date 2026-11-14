// SPDX-License-Identifier: BSD-3-Clause
// Only opaque, exact producer checkpoints are retained; no native cores live here.
export function createHuc6280SongCache({enabled=true,maxBytes=8*1024*1024,maxCount=64,intervalSeconds=5}={}) {
  if(typeof enabled!=='boolean'||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024||
    !Number.isInteger(maxCount)||maxCount<1||maxCount>256||!Number.isFinite(intervalSeconds)||intervalSeconds<=0)throw TypeError('Invalid HuC6280 seek cache limits');
  let source=null,mask=0,available=null,entries=[],bytes=0,hits=0,misses=0,restoredFrame=0,reconstructedFrames=0,error='';
  const clear=()=>{entries=[];bytes=hits=misses=restoredFrame=reconstructedFrames=0;error='';};
  const validMask=value=>Number.isInteger(value)&&value>=0&&value<=63;
  function reset(nextSource,nextMask=mask){if(!validMask(nextMask))throw RangeError('Invalid cache channel mask');clear();source=nextSource;mask=nextMask;available=null;}
  function read(){return{enabled,available,count:entries.length,bytes,maxBytes,maxCount,intervalSeconds,hits,misses,restoredFrame,reconstructedFrames,error};}
  function insert(nextSource,checkpoint){
    if(!enabled||!available||source!==nextSource)return false;
    if(!checkpoint||!Object.isFrozen(checkpoint)||!Number.isSafeInteger(checkpoint.frame)||checkpoint.frame<0||
      !Number.isInteger(checkpoint.rate)||checkpoint.rate<8000||checkpoint.rate>96000||checkpoint.mask!==mask||
      !Number.isSafeInteger(checkpoint.byteLength)||checkpoint.byteLength<1)throw TypeError('Invalid HuC6280 checkpoint metadata');
    if(checkpoint.byteLength>maxBytes)return false;
    if(entries.some(item=>item.frame===checkpoint.frame&&item.rate===checkpoint.rate))return false;
    entries.push(checkpoint);bytes+=checkpoint.byteLength;
    while(entries.length>maxCount||bytes>maxBytes)bytes-=entries.shift().byteLength;
    return true;
  }
  function find(nextSource,rate,targetFrame){
    restoredFrame=0;
    if(!enabled||!available||source!==nextSource)return null;
    let selected=null;
    for(const entry of entries)if(entry.rate===rate&&entry.frame<=targetFrame&&(!selected||entry.frame>selected.frame))selected=entry;
    if(!selected){misses++;return null;}
    hits++;restoredFrame=selected.frame;
    // The bounded list is also an LRU eviction queue.
    entries=entries.filter(entry=>entry!==selected);entries.push(selected);return selected;
  }
  function reject(checkpoint,cause){
    entries=entries.filter(entry=>entry!==checkpoint);bytes=entries.reduce((sum,entry)=>sum+entry.byteLength,0);
    restoredFrame=0;error=cause?.message??String(cause);
  }
  return{read,reset,clear,insert,find,reject,
    setEnabled(value){if(typeof value!=='boolean')throw TypeError('Seek cache enabled must be boolean');if(value!==enabled){enabled=value;clear();}return read();},
    setAvailable(value){if(typeof value!=='boolean')throw TypeError('Cache capability must be boolean');available=value;return read();},
    setMask(value){if(!validMask(value))throw RangeError('Invalid cache channel mask');if(value!==mask){mask=value;clear();}return read();},
    beginSeek(){restoredFrame=reconstructedFrames=0;error='';},
    captureFailed(cause){error=cause?.message??String(cause);},
    noteProgress(frames){if(!Number.isSafeInteger(frames)||frames<0)throw RangeError('Invalid reconstructed frame count');reconstructedFrames=frames;},
  };
}
