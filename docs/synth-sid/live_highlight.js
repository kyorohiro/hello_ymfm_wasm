// SPDX-License-Identifier: BSD-3-Clause
import {createSynthLiveHighlighter} from '../synth/synth_live_highlight.js';

/** Observe only the scalar controls already painted by the SID Live view.
 * Scope changes and unavailable fields establish fresh baselines. This adapter
 * owns no clock, register queries, audio commands, layout reads or value arrays.
 */
export function createSidLiveHighlighter({controls,enabled=true}={}){
  if(!Array.isArray(controls)||typeof enabled!=='boolean')
    throw new TypeError('SID highlight needs controls and an enabled setting');
  const elements=new Set();
  for(const binding of controls){
    if(!binding||!binding.element?.classList||typeof binding.element.addEventListener!=='function'||
      typeof binding.element.removeEventListener!=='function'||elements.has(binding.element)||
      typeof binding.read!=='function'||binding.available!==undefined&&typeof binding.available!=='function')
      throw new TypeError('SID highlight needs distinct controls and scalar readers');
    elements.add(binding.element);
  }
  const bindings=controls.map(({element,read,available=()=>true})=>({read,available,
    highlighter:createSynthLiveHighlighter({enabled,controls:[{element,read:view=>view.snapshot.value}]})}));
  let scope=null,lastFrame=null,disposed=false;
  const same=(a,b)=>a.owner===b.owner&&a.origin===b.origin&&a.epoch===b.epoch&&a.channel===b.channel&&
    a.model===b.model&&a.sampleRate===b.sampleRate&&a.clockHz===b.clockHz;
  function clear(){
    for(const binding of bindings)binding.highlighter.clear();
    scope=null;lastFrame=null;
  }
  return{
    update(view){
      // Off must not inspect a view or invoke any field/availability getter.
      if(!enabled||disposed)return;
      if(!view||!view.snapshot||!view.following||!view.visible||view.paused||view.waiting||view.error){clear();return;}
      const snapshot=view.snapshot,frame=snapshot.positionFrames;
      if(!Number.isSafeInteger(frame)||frame<=0){clear();return;}
      const next={owner:view.owner,origin:view.origin,epoch:view.epoch,channel:view.channel,
        model:snapshot.model,sampleRate:snapshot.sampleRate,clockHz:snapshot.clockHz};
      if(scope&&(!same(scope,next)||frame<lastFrame))clear();
      scope=next;lastFrame=frame;
      try{
        for(const binding of bindings){
          if(!binding.available()){binding.highlighter.clear();continue;}
          const value=binding.read(snapshot);
          if(value===undefined||typeof value==='number'&&!Number.isFinite(value)){
            binding.highlighter.clear();continue;
          }
          if(value!==null&&typeof value==='object'||['function','symbol','bigint'].includes(typeof value))
            throw new TypeError('SID highlight values must be scalar');
          binding.highlighter.update({channel:view.channel,snapshot:{value}});
        }
      }catch(error){clear();throw error;}
    },
    clear,
    setEnabled(value){
      if(typeof value!=='boolean')throw new TypeError('SID highlight enabled must be boolean');
      if(disposed||value===enabled)return;
      enabled=value;clear();
      for(const binding of bindings)binding.highlighter.setEnabled(value);
    },
    dispose(){
      if(disposed)return;disposed=true;clear();
      for(const binding of bindings)binding.highlighter.dispose();
    },
  };
}
