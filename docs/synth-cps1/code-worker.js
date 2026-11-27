// SPDX-License-Identifier: BSD-3-Clause
// The worker keeps Stop responsive even while a user script is busy.
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';

const facade = (chip,methods) => Object.fromEntries(methods.map(method => [method,
  (...args) => postMessage({chip,method,args})]));
const opm = facade('opm',['loadVoice','writeRegister','setOperator','setAlgo','setPan','setNote','setPitch','setFrequency','noteOn','keyOn','keyOff','setNoise']);
const oki = facade('oki',['write','play','stop','setVoiceMuted']);
const runtime=createPlaygroundCodeRuntime({
  ensureReady:()=>{}, now:()=>performance.now()/1000,
  supportedSoundChips:['ym2151','msm6295'],useSoundChip:name=>name==='ym2151'?opm:oki,
  prepareSource:source=>'const opm=await useSoundChip("ym2151"), oki=await useSoundChip("msm6295");\n'+source,
  guardExecution:false,
  onState:({status})=>{if(status.startsWith('Loop error'))postMessage({status});},
});
onmessage=async ({data:{source,path,apply}})=>{
  try{
    const state=await runtime[apply?'apply':'run'](source,{path});
    postMessage(state.loopNames.length?{status:state.status}:{done:true});
  }catch(error){postMessage(apply?{status:error.message}:{error:error.message});}
};
