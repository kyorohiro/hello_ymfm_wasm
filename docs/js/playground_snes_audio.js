/** Browser setup: CPU-free authored SNES DSP source for the existing mixer. */
const nativeFetch=globalThis.fetch?.bind(globalThis);
const modules=new WeakMap();
/** @param {AudioContext} context @param {AudioNode} destination
 * @param {{signal?:AbortSignal,fetch?:typeof fetch,wasmUrl?:string|URL,workletUrl?:string|URL}} [options] */
export async function createSnesAudio(context,destination,options={}) {
  options.signal?.throwIfAborted();
  if(!context?.audioWorklet||context.state==='closed')throw new Error('SNES requires an open AudioContext with AudioWorklet');
  const url=String(options.workletUrl??new URL('./playground_snes_worklet.js?v=spc-song-js-1',import.meta.url));
  let cache=modules.get(context);if(!cache)modules.set(context,cache=new Map());
  let module=cache.get(url);if(!module){module=context.audioWorklet.addModule(url);cache.set(url,module);module.catch(()=>cache.delete(url));}
  const wait=promise=>{const signal=options.signal;if(!signal)return promise;signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});};
  const [wasmBinary]=await wait(Promise.all([(options.fetch??nativeFetch)(options.wasmUrl??new URL('../generated/spc_wasm.wasm?v=spc-events-1',import.meta.url),{signal:options.signal}).then(response=>{if(!response.ok)throw new Error(`SNES WASM HTTP ${response.status}`);return response.arrayBuffer();}),module]));
  options.signal?.throwIfAborted();
  const node=new AudioWorkletNode(context,'tetorica-playground-snes',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary}});
  const channel=new MessageChannel();let disposed=false,endpoint=null,rejectReady,readyTimer;
  const dispose=()=>{if(disposed)return;disposed=true;try{node.port.postMessage({method:'dispose'});}catch{}clearTimeout(readyTimer);context.removeEventListener?.('statechange',closed);node.onprocessorerror=null;node.port.onmessage=null;try{node.disconnect();}catch{}node.port.close();channel.port1.close();if(!endpoint)channel.port2.close();};
  const closed=()=>{if(context.state==='closed'){rejectReady?.(new Error('SNES AudioContext was closed'));if(endpoint)endpoint.dispose();else dispose();}};
  context.addEventListener?.('statechange',closed);
  const abort=()=>{rejectReady?.(options.signal.reason);dispose();};options.signal?.addEventListener('abort',abort,{once:true});
  try {
    const state=await wait(new Promise((resolve,reject)=>{rejectReady=reject;readyTimer=setTimeout(()=>{reject(new Error('SNES AudioWorklet initialization timed out'));dispose();},15000);readyTimer.unref?.();node.port.onmessage=({data})=>{if(data.ready)resolve(data);else if(data.error||data.fatal){reject(new Error(data.error??'SNES Worklet failed'));endpoint?.dispose();}};node.onprocessorerror=()=>{reject(new Error('SNES Worklet processor failed'));endpoint?.dispose();};}));
    clearTimeout(readyTimer);options.signal?.throwIfAborted();if(context.state==='closed')throw new Error('SNES AudioContext was closed');
    node.port.postMessage({port:channel.port1},[channel.port1]);node.connect(destination);
    endpoint={node,port:channel.port2,sampleRate:state.sampleRate,nativeSampleRate:32000,dispose};return endpoint;
  }catch(error){dispose();throw error;}finally{clearTimeout(readyTimer);options.signal?.removeEventListener('abort',abort);}
}
