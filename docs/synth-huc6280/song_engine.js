// SPDX-License-Identifier: BSD-3-Clause
// The existing HuC6280 native core and shared VGM MSM5205 decoder share one clock.
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
import {Msm5205AudioEngine} from '../js/msm5205audioengine.js';
import factory from '../generated/huc6280_wasm.js';

export const HUC6280_MSM5205_STATE_REASON='MSM5205 has no paired playback snapshot.';
const ids=['huc6280','msm5205'];
export function readHuc6280SongMix(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw TypeError('Expected PC Engine source mixer settings');
  return Object.fromEntries(ids.map(id=>{
    const item=value[id]??{},volume=item.volume??1,muted=item.muted??false;
    if(!item||typeof item!=='object'||Array.isArray(item)||!Number.isFinite(volume)||volume<0||volume>3.8||typeof muted!=='boolean')throw TypeError(`Invalid ${id} source mixer settings`);
    return[id,{volume,muted}];
  }));
}
export const huc6280SongMixKey=value=>JSON.stringify(readHuc6280SongMix(value));

/** No audio nodes or device. Mixer gains are separate from the native master,
 * preserving the opaque native state ABI and the old unit-gain PCM path. */
export async function createHuc6280SongEngine(header,{mixer,moduleFactory=factory,wasmBinary}={}){
  const mix=readHuc6280SongMix(mixer);
  const engine=await Huc6280AudioEngine.create({moduleFactory:wasmBinary?()=>moduleFactory({wasmBinary}):moduleFactory,
    clock:header.huc6280Clock||HUC6280_CLOCK,outputSampleRate:44100,masterVolume:1});
  try{
    const msm=header.msm5205Clock?new Msm5205AudioEngine({clock:header.msm5205Clock,flags:header.msm5205Flags,outputSampleRate:engine.sampleRate(),masterVolume:1}):null;
    const process=engine.processFrames.bind(engine),reset=engine.reset.bind(engine),dispose=engine.dispose.bind(engine),key=engine.stateSettingsKey.bind(engine);
    let settings=mix,closed=false;
    engine.setSourceMix=value=>{const next=readHuc6280SongMix(value);settings=next;return readHuc6280SongMix(settings);};
    engine.getSourceMix=()=>readHuc6280SongMix(settings);
    engine.stateSettingsKey=()=>JSON.stringify([key(),settings.huc6280]);
    engine.processFrames=frames=>{
      const pcm=process(frames),adpcm=msm?.processFrames(frames),h=settings.huc6280,a=settings.msm5205;
      const hg=h.muted?0:h.volume,ag=a.muted?0:a.volume;
      if(!adpcm&&hg===1)return pcm;
      for(let i=0;i<frames;i++){
        pcm.left[i]=pcm.left[i]*hg+(adpcm?adpcm.left[i]*ag:0);
        pcm.right[i]=pcm.right[i]*hg+(adpcm?adpcm.right[i]*ag:0);
      }
      return pcm;
    };
    engine.reset=()=>{reset();msm?.reset();};
    engine.dispose=()=>{if(closed)return;closed=true;try{msm?.dispose();}finally{dispose();}};
    if(msm){
      engine.msm5205=msm;engine.writeMsm5205=msm.writeMsm5205.bind(msm);
      engine.setMsm5205Muted=msm.setMsm5205Muted.bind(msm);engine.supportsState=()=>false;engine.stateReason=HUC6280_MSM5205_STATE_REASON;
      for(const method of ['saveState','loadState','validateState'])engine[method]=()=>{throw Error(HUC6280_MSM5205_STATE_REASON);};
    }
    return engine;
  }catch(error){engine.dispose();throw error;}
}
