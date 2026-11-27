// SPDX-License-Identifier: BSD-3-Clause
// The worker keeps Stop responsive even while a user script is busy.
import {attachRegisterTimedClient} from '../js/register_timed_client.js';
import {planTools} from './timed-plan.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';

const facade = (chip,methods) => Object.fromEntries(methods.map(method => [method,
  (...args) => postMessage({chip,method,args})]));
const opm = facade('opm',['loadVoice','writeRegister','setOperator','setAlgo','setPan','setNote','setPitch','setFrequency','noteOn','keyOn','keyOff','setNoise']);
const oki = facade('oki',['write','play','stop','setVoiceMuted']);
const pending=new Map();
let sequence=0, evaluation=0, scheduled=false;
for(const [chip,api] of [['ym2151',opm],['msm6295',oki]]){
  attachRegisterTimedClient(api,payload=>new Promise((resolve,reject)=>{
    const seq=++sequence;
    pending.set(seq,{resolve,reject});
    postMessage({chip,timedRequest:seq,payload});
    if(payload.action==='stage' && payload.method==='schedule')scheduled=true;
  }),planTools(chip));
}
const runtime=createPlaygroundCodeRuntime({
  ensureReady:()=>{}, now:()=>performance.now()/1000,
  supportedSoundChips:['ym2151','msm6295'],useSoundChip:name=>name==='ym2151'?opm:oki,
  prepareSource:source=>'const opm=await useSoundChip("ym2151"), oki=await useSoundChip("msm6295");\n'+source,
  guardExecution:false,
  onState:({status})=>{if(status.startsWith('Loop error'))postMessage({status});},
});
onmessage=async ({data})=>{
  if(data.timedReply){
    const seq=data.timedReply.seq,call=pending.get(seq);
    if(call){pending.delete(seq);if(data.failure)call.reject(Error(data.failure));else call.resolve(data.value);}
    return;
  }
  const {source,path,apply}=data;
  const revision=++evaluation;
  scheduled=false;
  try{
    const state=await runtime[apply?'apply':'run'](source,{path});
    if(revision!==evaluation)return;
    postMessage(state.loopNames.length?{status:state.status}:scheduled?{status:'Scheduled'}:{done:true});
  }catch(error){if(revision===evaluation)postMessage(apply?{status:error.message}:{error:error.message});}
};
