// SPDX-License-Identifier: BSD-3-Clause
import {integer} from './chip.js';

// MSFA releases all voices of a given MIDI pitch. Share that pitch across
// sources until the last one releases it; keep solo retriggers audible.
export function createMsfaNotes(dx,mirror){
  const held=new Map();
  function noteOff(note,owner){
    integer(note,0,127,'note');
    const owners=held.get(note);
    if(!owners?.has(owner))return;
    mirror?.off(owners.get(owner));owners.delete(owner);
    if(owners.size)return;
    dx.noteOff(note);held.delete(note);
  }
  function noteOn(note,velocity,owner){
    integer(note,0,127,'note');integer(velocity,0,127,'velocity');
    if(velocity===0){noteOff(note,owner);return;}
    const owners=held.get(note)??new Map();
    if(!owners.size || (owners.size===1 && owners.has(owner))){
      if(owners.size)dx.noteOff(note);
      dx.noteOn(note,velocity);
    }
    const token=owners.get(owner)??{};
    owners.set(owner,token);held.set(note,owners);
    mirror?.on(token,owner,note,velocity);
  }
  return {noteOn,noteOff,stopOwner(owner){for(const note of held.keys())noteOff(note,owner);},
    panic(){
      for(const owners of held.values())for(const token of owners.values())mirror?.off(token);
      held.clear();dx.panic();
    }};
}
