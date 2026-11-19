// SPDX-License-Identifier: BSD-3-Clause
import {createSynthLiveHighlighter} from '../synth/synth_live_highlight.js';

/** Passive display feedback over the existing HuC6280 observation/render pass.
 * Every control keeps its own known/visible baseline. Opening a card must not
 * fabricate changes, nor hide a real change in another already-visible field.
 */
export function createHuc6280LiveHighlighter({controls,enabled=true}={}) {
  if(!Array.isArray(controls)||typeof enabled!=='boolean')throw TypeError('HuC6280 highlight needs controls and a boolean enabled setting');
  const elements=new Set();
  for(const control of controls) {
    if(!control||!control.element?.classList||typeof control.element.addEventListener!=='function'||typeof control.element.removeEventListener!=='function'||
      typeof control.path!=='string'||!control.path||typeof control.read!=='function'||control.available!==undefined&&typeof control.available!=='function'||elements.has(control.element)) {
      throw TypeError('HuC6280 highlight needs distinct elements, field paths and scalar readers');
    }
    elements.add(control.element);
  }
  const bindings=controls.map(({element,path,read,available=()=>true})=>({path,available,
    highlighter:createSynthLiveHighlighter({enabled,controls:[{element,read:view=>{
      const value=read(view.snapshot.preset);
      if(value!==null&&typeof value==='object'||typeof value==='function'||typeof value==='symbol'||typeof value==='bigint')throw TypeError('HuC6280 highlight readers must return scalar values');
      return value;
    }}]}),
  }));
  let disposed=false,scope=null,lastFrame=null,frozen=null;
  const sameScope=(left,right)=>Object.is(left.owner,right.owner)&&Object.is(left.origin,right.origin)&&Object.is(left.epoch,right.epoch)&&Object.is(left.channel,right.channel);
  function clear() {
    for(const binding of bindings)binding.highlighter.clear();
    scope=null;lastFrame=null;frozen=null;
  }
  function update(view) {
    // Off must not inspect the view, field availability or preset values.
    if(!enabled||disposed)return;
    if(!view||!view.physical||!view.snapshot||!view.preset) {clear();return;}
    const {snapshot,owner,origin,epoch,channel}=view,frame=snapshot.positionFrames;
    const nextScope={owner,origin,epoch,channel};
    if(view.following===false){clear();frozen={scope:nextScope,frame};return;}
    if(frozen) {
      // Auto update resumes by publishing its retained old snapshot first.
      // That stale instant is not the baseline for a later catch-up flash.
      if(sameScope(nextScope,frozen.scope)&&Number.isFinite(frame)&&Number.isFinite(frozen.frame)&&frame<=frozen.frame)return;
      clear();
    }
    if(view.visible===false||view.paused||view.waiting||view.error||view.interacting){clear();return;}
    if(frame===0){clear();return;}
    if(scope&&(!sameScope(nextScope,scope)||
      Number.isFinite(frame)&&Number.isFinite(lastFrame)&&frame<lastFrame))clear();
    scope=nextScope;lastFrame=frame;
    const unknown=new Set(view.unknownFields??[]);
    const scalarView={channel,snapshot:{frame,revision:snapshot.revision,preset:view.preset}};
    try {
      for(const binding of bindings) {
        if(unknown.has(binding.path)||!binding.available())binding.highlighter.clear();
        else binding.highlighter.update(scalarView);
      }
    }catch(error){clear();throw error;}
  }
  return {update,clear,
    setEnabled(value) {
      if(typeof value!=='boolean')throw TypeError('HuC6280 highlight enabled must be boolean');
      if(disposed||enabled===value)return;
      enabled=value;clear();
      for(const binding of bindings)binding.highlighter.setEnabled(value);
    },
    dispose() {
      if(disposed)return;
      disposed=true;clear();
      for(const binding of bindings)binding.highlighter.dispose();
    },
  };
}
