// SPDX-License-Identifier: BSD-3-Clause
import {createSynthLiveHighlighter} from '../synth/synth_live_highlight.js';

/** Cached scalar bindings over the panels already painted by Live. No canvas,
 * sample arrays, register queries, timers or layout measurements are involved. */
export function getSpuLiveHighlightControls(root){
  const bindings=[];
  const bind=(selector,read)=>{
    const control=root.querySelector(selector);if(!control)return;
    const element=control.closest('label')??control,ancestors=[];
    for(let node=control;node;node=node.parentElement)ancestors.push(node);
    element.classList.add('spu-live-value');
    bindings.push({element,read,available:()=>root.ownerDocument.activeElement!==control&&!ancestors.some(node=>node.hidden)});
  };
  const voice=state=>state.channels?.[0];
  for(const [name,key]of [['pitch','pitch'],['volume-left','volumeLeft'],['volume-right','volumeRight'],['reverb-send','reverb']])
    bind(`[data-chip-control="ps1-${name}"]`,state=>voice(state)?.[key]);
  for(const [name,key]of [['attack-rate','attackRate'],['attack-exponential','attackExponential'],['decay-rate','decayRate'],
    ['sustain-level','sustainLevel'],['sustain-rate','sustainRate'],['sustain-decrease','sustainDecrease'],
    ['sustain-exponential','sustainExponential'],['release-rate','releaseRate'],['release-exponential','releaseExponential']])
    bind(`[data-chip-control="ps1-${name}"]`,state=>voice(state)?.envelopeParameters?.[key]);
  for(const [name,key]of [['reverb-preset','preset'],['reverb-left','volumeLeft'],['reverb-right','volumeRight']])
    bind(`[data-chip-control="ps1-${name}"]`,state=>state.reverb?.[key]);
  const psf=state=>state.observation?.kind==='psf';
  bind('[data-noise="source"]',state=>psf(state)?voice(state)?.noise:state.noise?.enabled);
  bind('[data-noise="clock"]',state=>state.noise?.clock);
  bind('[data-pmon="enabled"]',state=>psf(state)?voice(state)?.hardwarePmon:state.pmon?.enabled);
  for(const key of ['waveform','ratio','depth','decayMs'])
    bind(`[data-pmon="${key}"]`,state=>psf(state)?undefined:state.pmon?.[key]);
  for(const key of ['enabled','amount'])
    bind(`[data-morph="${key}"]`,state=>psf(state)?undefined:state.morph?.[key]);
  return bindings;
}

/** Scope changes and unavailable fields establish a fresh per-control baseline.
 * Off exits before examining the view or evaluating any scalar/availability. */
export function createSpuLiveHighlighter({controls,enabled=true}={}){
  if(!Array.isArray(controls)||typeof enabled!=='boolean')throw TypeError('SPU highlight needs controls and an enabled setting');
  const elements=new Set();
  for(const binding of controls){
    if(!binding||!binding.element?.classList||typeof binding.element.addEventListener!=='function'||typeof binding.element.removeEventListener!=='function'||
      elements.has(binding.element)||typeof binding.read!=='function'||binding.available!==undefined&&typeof binding.available!=='function')throw TypeError('SPU highlight needs distinct controls and scalar readers');
    elements.add(binding.element);
  }
  const bindings=controls.map(({element,read,available=()=>true})=>({read,available,
    highlighter:createSynthLiveHighlighter({enabled,controls:[{element,read:view=>view.snapshot.value}]})}));
  let scope=null,lastFrame=null,disposed=false;
  const same=(a,b)=>a.owner===b.owner&&a.origin===b.origin&&a.epoch===b.epoch&&a.channel===b.channel;
  function clear(){for(const binding of bindings)binding.highlighter.clear();scope=null;lastFrame=null;}
  return{
    update(view){
      if(!enabled||disposed)return;
      if(!view||!view.snapshot||!view.following||!view.visible||view.paused||view.waiting||view.error){clear();return;}
      const next={owner:view.owner,origin:view.origin,epoch:view.epoch,channel:view.channel},frame=view.snapshot.nativeFrames;
      if(frame===0){clear();return;}
      if(scope&&(!same(scope,next)||Number.isFinite(frame)&&Number.isFinite(lastFrame)&&frame<lastFrame))clear();
      scope=next;lastFrame=frame;
      try{for(const binding of bindings){
        if(!binding.available()){binding.highlighter.clear();continue;}
        const value=binding.read(view.snapshot);
        if(value===undefined||typeof value==='number'&&!Number.isFinite(value)){binding.highlighter.clear();continue;}
        if(value!==null&&typeof value==='object'||['function','symbol','bigint'].includes(typeof value))throw TypeError('SPU highlight values must be scalar');
        binding.highlighter.update({channel:view.channel,snapshot:{value}});
      }}catch(error){clear();throw error;}
    },clear,
    setEnabled(value){
      if(typeof value!=='boolean')throw TypeError('SPU highlight enabled must be boolean');
      if(disposed||value===enabled)return;enabled=value;clear();for(const binding of bindings)binding.highlighter.setEnabled(value);
    },
    dispose(){if(disposed)return;disposed=true;clear();for(const binding of bindings)binding.highlighter.dispose();},
  };
}
