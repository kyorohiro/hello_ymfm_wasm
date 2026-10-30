// SPDX-License-Identifier: BSD-3-Clause
export async function createAudio({volume=.6,onError=()=>{}}={}) {
  const Context=globalThis.AudioContext??globalThis.webkitAudioContext;
  if(!Context)throw new Error('Web Audio is unavailable');
  const context=new Context({latencyHint:'interactive'}),pending=new Map();let node,gain,closed=false,sequence=0,initReject;
  const dispose=async()=>{if(closed)return;closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('SCSP audio closed'));}pending.clear();node?.port.postMessage({method:'dispose'});node?.disconnect();node?.port.close();gain?.disconnect();context.removeEventListener('statechange',contextClosed);if(context.state!=='closed')await context.close();};
  const fail=error=>{initReject?.(error);onError(error);void dispose();};
  const contextClosed=()=>{if(context.state==='closed'&&!closed)fail(new Error('SCSP AudioContext was closed; Start audio to reconnect'));};context.addEventListener('statechange',contextClosed);
  try{
    const resumed=context.resume();
    const [wasmBinary]=await Promise.all([fetch(new URL('../generated/scsp_wasm.wasm',import.meta.url)).then(r=>{if(!r.ok)throw new Error(`SCSP WASM HTTP ${r.status}`);return r.arrayBuffer();}),context.audioWorklet.addModule(new URL('./processor.js?v=fm2-1',import.meta.url))]);
    gain=context.createGain();gain.gain.value=volume*.125;gain.connect(context.destination);
    node=new AudioWorkletNode(context,'tetorica-scsp-synth',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary}});node.onprocessorerror=()=>fail(new Error('SCSP processor failed'));
    await new Promise((resolve,reject)=>{initReject=reject;const timer=setTimeout(()=>reject(new Error('SCSP initialization timed out')),15000);node.port.onmessage=({data})=>{if(data.ready){clearTimeout(timer);resolve();}else if(data.fatal){clearTimeout(timer);reject(new Error(data.error));}};});initReject=null;await resumed;
    node.port.onmessage=({data})=>{if(data.fatal){fail(new Error(data.error));return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.value);};
    function request(message){if(closed)return Promise.reject(new Error('Start audio again'));const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('SCSP processor timed out'));fail(new Error('SCSP processor timed out'));},15000);pending.set(id,{resolve,reject,timer});try{node.port.postMessage({...message,id});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}});}
    return {context,dispose,resume:()=>context.resume(),setVolume(value){gain.gain.setTargetAtTime(value*.125,context.currentTime,.01);},read:()=>request({type:'chip-inspector',action:'read'}),invoke:(method,args=[])=>request({type:'chip-inspector',action:'invoke',method,args}),command:(method,args=[])=>request({method,args})};
  }catch(error){await dispose();throw error;}
}
