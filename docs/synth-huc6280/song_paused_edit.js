// SPDX-License-Identifier: BSD-3-Clause
// Project only a deliberate edit onto the frozen, heard register observation.
// The reference core itself is ahead of this snapshot by its retained PCM.
import {createHuc6280RegisterState} from './song_state.js';
import {createHuc6280SongManual} from './song_manual.js?v=huc-channel-ui-1';

export function projectHuc6280PausedEdit(snapshot,edit) {
  if(!snapshot||!Number.isSafeInteger(snapshot.positionFrames)||snapshot.positionFrames<0||
    !Number.isSafeInteger(snapshot.revision)||snapshot.revision<0)throw TypeError('Expected a frozen HuC6280 song observation');
  const state=createHuc6280RegisterState(snapshot.clock);
  const rows=(name,kind,length)=>{
    if(!Array.isArray(snapshot[name])||snapshot[name].length!==8||snapshot[name].some(row=>!Array.isArray(row)||row.length!==length))throw TypeError(`Invalid paused ${name}`);
    snapshot[name].forEach((row,ch)=>row.forEach((value,index)=>state.apply({kind,ch,index,value})));
  };
  const columns=(name,kind,length=8)=>{
    if(!Array.isArray(snapshot[name])||snapshot[name].length!==length)throw TypeError(`Invalid paused ${name}`);
    snapshot[name].forEach((value,index)=>state.apply({kind,ch:kind==='g'?0:index,index,value}));
  };
  rows('registers','r',8);rows('waveforms','w',32);
  columns('globals','g',10);columns('indices','i');columns('ddaValues','d');columns('ddaFrames','f');columns('ddaWrites','n');
  state.apply({kind:'s',ch:0,index:0,value:snapshot.selectedChannel});
  // Reuse the hardware edit planner, including untouched-bit validation and
  // Wave/LFO upload rules. This in-memory register model never opens audio or
  // writes to the native core; no unedited lookahead state enters the view.
  const engine={get selectedChannel(){return state.selectedChannel;},writeHuc6280:(register,value)=>state.write(register,value,snapshot.positionFrames)};
  const timeline={engine,peek:()=>state.snapshot(snapshot.positionFrames),generatedFrames:snapshot.positionFrames,onWrite:()=>()=>{}};
  const manual=createHuc6280SongManual({engine,timeline});
  try{manual.applyEdit(edit);return Object.freeze({...state.snapshot(snapshot.positionFrames),revision:snapshot.revision+1});}
  finally{manual.dispose();}
}
