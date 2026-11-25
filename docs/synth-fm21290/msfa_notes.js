// SPDX-License-Identifier: BSD-3-Clause
import {integer} from './chip.js';

// MSFA releases all voices of a given MIDI pitch. Share that pitch across
// sources until the last one releases it; keep solo retriggers audible.
export function createMsfaNotes(dx){
  const held=new Map();
  function noteOff(note,owner){
    integer(note,0,127,'note');
    const owners=held.get(note);
    if(!owners?.delete(owner) || owners.size)return;
    dx.noteOff(note);held.delete(note);
  }
  function noteOn(note,velocity,owner){
    integer(note,0,127,'note');integer(velocity,0,127,'velocity');
    if(velocity===0){noteOff(note,owner);return;}
    const owners=held.get(note)??new Set();
    if(!owners.size || (owners.size===1 && owners.has(owner))){
      if(owners.size)dx.noteOff(note);
      dx.noteOn(note,velocity);
    }
    owners.add(owner);held.set(note,owners);
  }
  return {noteOn,noteOff,stopOwner(owner){for(const note of held.keys())noteOff(note,owner);},
    panic(){held.clear();dx.panic();}};
}
