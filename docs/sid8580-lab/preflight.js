// SPDX-License-Identifier: BSD-3-Clause
// Complete pending VBI initialization on the main thread before selection.
// Native C64 cycle limits enforce the bound; yields permit cancellation.
export async function finishResearchPreflight(core,{signal}={}){
  let state=core.getState(),blocks=0;
  while(state.initPending){
    signal?.throwIfAborted();core.render(128);state=core.getState();
    if(++blocks%8===0){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
    if(blocks>8192)throw new Error('Research initialization exceeded the bounded preflight');
  }
  signal?.throwIfAborted();return state;
}
