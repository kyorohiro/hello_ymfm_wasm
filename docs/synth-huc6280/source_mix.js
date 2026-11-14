// SPDX-License-Identifier: BSD-3-Clause
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';

export const PC_ENGINE_SOURCES=Object.freeze(['huc6280','msm5205','cdda']);
const measured=new Map(SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.map(({name,volume})=>[name,volume]));
export const PC_ENGINE_SOURCE_DEFAULTS=Object.freeze(Object.fromEntries(PC_ENGINE_SOURCES.map(id=>[id,
  Object.freeze({volume:measured.get(id)??1,pan:0,muted:false,effectiveMuted:false})])));

export function readPcEngineSourceMix(value=PC_ENGINE_SOURCE_DEFAULTS){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(id=>!PC_ENGINE_SOURCES.includes(id)))throw TypeError('Expected PC Engine source mixer settings');
  const result={};
  for(const id of PC_ENGINE_SOURCES){
    const item=value[id];
    if(!item||typeof item!=='object'||!Number.isFinite(item.volume)||item.volume<0||item.volume>3.8||typeof item.muted!=='boolean'||item.pan!==undefined&&item.pan!==0)throw RangeError('Source mixer requires volume 0..3.8 and boolean muted; stereo balance remains centered');
    result[id]=Object.freeze({volume:item.volume,pan:0,muted:item.muted,effectiveMuted:item.muted});
  }
  return Object.freeze(result);
}

/** One session mixer for keyboard, Code and reference playback. No audio is
 * opened here. Values use the same absolute calibrated gains as Playground. */
export function createPcEngineSourceMix(){
  let state=readPcEngineSourceMix();const listeners=new Set();
  function replace(value){const next=readPcEngineSourceMix(value);
    if(PC_ENGINE_SOURCES.every(id=>state[id].volume===next[id].volume&&state[id].muted===next[id].muted))return state;
    state=next;for(const listener of listeners)listener(state);return state;
  }
  return{read:()=>state,
    set(id,patch){if(!PC_ENGINE_SOURCES.includes(id)||!patch||typeof patch!=='object'||Object.keys(patch).some(key=>!['volume','muted'].includes(key)))throw TypeError('Unknown source mixer setting');return replace({...state,[id]:{...state[id],...patch}});},
    reset:()=>replace(PC_ENGINE_SOURCE_DEFAULTS),
    onChange(listener){if(typeof listener!=='function')throw TypeError('Expected a mixer listener');listeners.add(listener);return()=>listeners.delete(listener);},
  };
}

export function setupPcEngineSourceMix({root,mix}){
  const doc=root.ownerDocument,controls=new Map(),listeners=[];
  const labels={huc6280:'HuC6280',msm5205:'MSM5205',cdda:'CD-DA'};
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  for(const id of PC_ENGINE_SOURCES){
    const row=doc.createElement('div');row.className='huc-source-mix-row';row.dataset.cdrom2Source=id;
    const label=doc.createElement('label'),name=doc.createElement('span'),range=doc.createElement('input'),output=doc.createElement('output'),mute=doc.createElement('button');
    name.textContent=labels[id];range.type='range';range.min='0';range.max='3.8';range.step='0.01';range.dataset.mixerVolume='';range.setAttribute('aria-label',`${labels[id]} volume, 0 to 380 percent`);
    output.setAttribute('aria-label',`${labels[id]} mixer level`);mute.type='button';mute.dataset.mixerMute='';mute.textContent='Mute';mute.setAttribute('aria-label',`Mute ${labels[id]}`);
    label.append(name,range,output);row.append(label,mute);root.append(row);controls.set(id,{range,output,mute});
    listen(range,'input',()=>mix.set(id,{volume:Number(range.value)}));listen(range,'change',()=>range.blur());
    listen(mute,'click',()=>{mute.blur();mix.set(id,{muted:!mix.read()[id].muted});});
  }
  const reset=doc.createElement('button');reset.type='button';reset.textContent='Reset mixer';root.append(reset);
  listen(reset,'click',()=>{reset.blur();mix.reset();});
  function render(state){for(const[id,{range,output,mute}]of controls){range.value=String(state[id].volume);range.dataset.boosted=String(state[id].volume>1);output.textContent=`${Math.round(state[id].volume*100)}%`;mute.setAttribute('aria-pressed',String(state[id].muted));}}
  render(mix.read());const unsubscribe=mix.onChange(render);
  return{dispose(){unsubscribe();for(const unlisten of listeners)unlisten();}};
}
