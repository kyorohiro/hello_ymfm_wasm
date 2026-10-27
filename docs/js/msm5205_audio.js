// Original Tetorica code. BSD-3-Clause; see LICENSE.
const modules=new WeakMap();
const nativeFetch=globalThis.fetch?.bind(globalThis);
/** One ADPCM source on the existing AudioContext; it never creates a second clock.
 * The main thread prepares/transfers packed four-bit ADPCM; the Worklet renders from those bytes.
 * @param {AudioContext} context
 * @param {{signal?:AbortSignal,onError?:(error:Error)=>void,fetch?:typeof globalThis.fetch,workletUrl?:string|URL,wasmUrl?:string|URL}} [options]
 */
export async function createMsm5205Audio(context,{signal,onError,fetch:fetcher=nativeFetch,workletUrl=new URL('./msm5205_worklet.js?v=pcengine-cd-1',import.meta.url),wasmUrl=new URL('../generated/msm5205_wasm.wasm',import.meta.url)}={}){
  signal?.throwIfAborted();if(!context?.audioWorklet||context.state==='closed')throw new Error('MSM5205 requires an open AudioContext');
  let module=modules.get(context);if(!module){module=context.audioWorklet.addModule(workletUrl);modules.set(context,module);module.catch(()=>modules.delete(context));}
  const [response]=await Promise.all([fetcher(wasmUrl,{signal}),module]);if(!response.ok)throw new Error(`MSM5205 WASM HTTP ${response.status}`);
  const wasmBinary=await response.arrayBuffer();signal?.throwIfAborted();
  const node=new AudioWorkletNode(context,'tetorica-msm5205',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary}});
  let disposed=false,next=0;const pending=new Map();
  const dispose=()=>{if(disposed)return;disposed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new DOMException('MSM5205 endpoint closed','AbortError'));}pending.clear();try{node.port.postMessage({action:{type:'dispose'}});node.disconnect();}catch{}node.onprocessorerror=null;node.port.onmessage=null;node.port.close();context.removeEventListener('statechange',closed);signal?.removeEventListener('abort',dispose);};
  const closed=()=>{if(context.state==='closed')dispose();};
  context.addEventListener('statechange',closed);signal?.addEventListener('abort',dispose,{once:true});
  const request=(action,transfer=[])=>new Promise((resolve,reject)=>{
    if(disposed){reject(new Error('MSM5205 endpoint closed'));return;}
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error('MSM5205 audio command timed out'));dispose();},20000);
    pending.set(id,{resolve,reject,timer});try{node.port.postMessage({id,action},transfer);}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
  });
  node.port.onmessage=({data})=>{if(data.type==='msm5205-error'){onError?.(new Error(data.error));dispose();return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.value);};
  node.onprocessorerror=()=>{onError?.(new Error('MSM5205 Worklet processor failed'));dispose();};
  try{await request({type:'ready'});signal?.throwIfAborted();return {node,
    async prepare(pcm,name,{signal:operationSignal}={}){
      operationSignal?.throwIfAborted();
      if(!(pcm instanceof Uint8Array)||!pcm.length||pcm.length>65536)throw new RangeError('Invalid MSM5205 ADPCM sample');
      // Never detach Virtual Files' buffer; encoded RAM is bounded to 64 KiB.
      const copy=pcm.slice();await request({type:'prepare',data:copy,name},[copy.buffer]);operationSignal?.throwIfAborted();
    },
    /** @param {object} action @param {{at?:number}} [timing] */
    command(action,{at}={}){
      if(at!==undefined&&(!Number.isFinite(at)||at<0||!Number.isSafeInteger(Math.round(at*context.sampleRate))))return Promise.reject(new RangeError('MSM5205 at must be nonnegative audio-clock seconds'));
      return request({...action,...(at===undefined?{}:{frame:Math.round(at*context.sampleRate)})});
    },dispose};
  }catch(error){dispose();throw error;}
}
