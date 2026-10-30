// SPDX-License-Identifier: BSD-3-Clause
import {createScspAudio} from '../js/playground_scsp_audio.js';
export async function createAudio({volume=.6,onError=()=>{}}={}) {
  const Context=globalThis.AudioContext??globalThis.webkitAudioContext;
  if(!Context)throw new Error('Web Audio is unavailable');
  const context=new Context({latencyHint:'interactive'}),pending=new Map();
  let endpoint,gain,closed=false,sequence=0;
  const rejectAll=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();};
  const dispose=async()=>{if(closed)return;closed=true;rejectAll(new Error('SCSP audio closed'));endpoint?.dispose();gain?.disconnect();if(context.state!=='closed')await context.close();};
  const fail=error=>{onError(error);void dispose();};
  try {
    // Resume in the initiating gesture, before asynchronous module loading.
    const resumed=context.resume();
    gain=context.createGain();gain.gain.value=volume*.125;gain.connect(context.destination);
    endpoint=await createScspAudio(context,gain,{onError:fail});await resumed;
    const port=endpoint.port;
    port.onmessage=({data})=>{
      if(data.fatal){fail(new Error(data.error));return;}
      const p=pending.get(data.id);if(!p)return;
      pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.value);
    };port.start();
    function request(message){
      if(closed)return Promise.reject(new Error('Start audio again'));
      const id=++sequence;
      return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('SCSP processor timed out'));fail(new Error('SCSP processor timed out'));},15000);pending.set(id,{resolve,reject,timer});try{port.postMessage({...message,id});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}});
    }
    return {context,dispose,resume:()=>context.resume(),setVolume(value){gain.gain.setTargetAtTime(value*.125,context.currentTime,.01);},
      read:()=>request({type:'chip-inspector',action:'read'}),
      invoke:(method,args=[])=>request({type:'chip-inspector',action:'invoke',method,args}),
      command:(method,args=[])=>request({method,args})};
  }catch(error){await dispose();throw error;}
}
