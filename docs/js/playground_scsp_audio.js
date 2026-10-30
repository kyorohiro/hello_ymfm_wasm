/** Browser setup: Experimental CPU-free Saturn SCSP source for the existing mixer. */
const nativeFetch=globalThis.fetch?.bind(globalThis);
const modules=new WeakMap();
/** @param {AudioContext} context @param {AudioNode|null} destination
 * @param {{signal?:AbortSignal,fetch?:typeof fetch,wasmUrl?:string|URL,workletUrl?:string|URL,onError?:(error:Error)=>void}} [options] */
export async function createScspAudio(context,destination,options={}) {
  options.signal?.throwIfAborted();
  if(!context?.audioWorklet||context.state==='closed')throw new Error('Saturn SCSP requires an open AudioContext with AudioWorklet');
  const url=String(options.workletUrl??new URL('./playground_scsp_worklet.js?v=scsp-native-1',import.meta.url));
  let cache=modules.get(context);if(!cache)modules.set(context,cache=new Map());
  let module=cache.get(url);if(!module){module=context.audioWorklet.addModule(url);cache.set(url,module);module.catch(()=>cache.delete(url));}
  const wait=promise=>{const signal=options.signal;if(!signal)return promise;signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});};
  const [wasmBinary]=await wait(Promise.all([(options.fetch??nativeFetch)(options.wasmUrl??new URL('../generated/scsp_wasm.wasm',import.meta.url),{signal:options.signal}).then(response=>{if(!response.ok)throw new Error(`Saturn SCSP WASM HTTP ${response.status}`);return response.arrayBuffer();}),module]));
  options.signal?.throwIfAborted();
  const node=new AudioWorkletNode(context,'tetorica-playground-scsp',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary}});
  const channel=new MessageChannel();let disposed=false,endpoint=null,rejectReady,readyTimer;
  const dispose=()=>{if(disposed)return;disposed=true;try{node.port.postMessage({method:'dispose'});}catch{}clearTimeout(readyTimer);context.removeEventListener?.('statechange',closed);node.onprocessorerror=null;node.port.onmessage=null;try{node.disconnect();}catch{}node.port.close();channel.port1.close();if(!endpoint)channel.port2.close();};
  const failure=error=>{rejectReady?.(error);if(endpoint){endpoint.dispose();options.onError?.(error);}else dispose();};
  const closed=()=>{if(context.state==='closed')failure(new Error('Saturn SCSP AudioContext was closed'));};
  context.addEventListener?.('statechange',closed);
  const abort=()=>{rejectReady?.(options.signal.reason);dispose();};options.signal?.addEventListener('abort',abort,{once:true});
  try {
    const state=await wait(new Promise((resolve,reject)=>{rejectReady=reject;readyTimer=setTimeout(()=>{reject(new Error('Saturn SCSP AudioWorklet initialization timed out'));dispose();},15000);readyTimer.unref?.();node.port.onmessage=({data})=>{if(data.type==='chip-inspector-result')return;if(data.ready)resolve(data);else if(data.error||data.fatal){failure(new Error(data.error??'Saturn SCSP Worklet failed'));}};node.onprocessorerror=()=>failure(new Error('Saturn SCSP Worklet processor failed'));}));
    clearTimeout(readyTimer);options.signal?.throwIfAborted();if(context.state==='closed')throw new Error('Saturn SCSP AudioContext was closed');
    node.port.postMessage({port:channel.port1},[channel.port1]);if(destination)node.connect(destination);
    endpoint={node,port:channel.port2,sampleRate:state.sampleRate,nativeSampleRate:44100,state:state.state,dispose};return endpoint;
  }catch(error){dispose();throw error;}finally{clearTimeout(readyTimer);options.signal?.removeEventListener('abort',abort);}
}
