// SPDX-License-Identifier: BSD-3-Clause
// Owners are physical OPS slots or MSFA pitches. One external gate survives
// until the last owner of a MIDI channel/pitch pair releases it.
export function createNoteOutput(onError){
  let port=null;
  const held=new Map();
  function send(bytes){
    try{port?.send(bytes);}
    catch(error){port=null;held.clear();onError(error);}
  }
  function off(slot){
    const key=held.get(slot);
    if(key===undefined)return;
    held.delete(slot);
    if(![...held.values()].includes(key))send([0x80|(key>>7),key&127,0]);
  }
  function select(next){
    if(next===port)return;
    for(const slot of held.keys())off(slot);
    port=next;
  }
  return {select,off,on(slot,channel,note,velocity){
    if(!port)return;
    off(slot);
    const key=channel*128+note;
    if(![...held.values()].includes(key))send([0x90|channel,note,velocity]);
    if(port)held.set(slot,key);
  }};
}
