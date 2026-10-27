// Original Tetorica code. BSD-3-Clause; see LICENSE.
const modules=new WeakMap();
const nativeFetch=globalThis.fetch?.bind(globalThis);
/** One PCM source on the existing AudioContext; it never creates a second clock.
 * The main thread prepares/transfers PCM16; the Worklet renders from those bytes.
 * @param {AudioContext} context
 * @param {{signal?:AbortSignal,onError?:(error:Error)=>void,fetch?:typeof globalThis.fetch,workletUrl?:string|URL,wasmUrl?:string|URL}} [options]
 */
export async function createCddaAudio(context,{signal,onError,fetch:fetcher=nativeFetch,workletUrl=new URL('./cdda_worklet.js?v=cdda-pcm-1',import.meta.url),wasmUrl=new URL('../generated/cdda_wasm.wasm',import.meta.url)}={}){
  signal?.throwIfAborted();if(!context?.audioWorklet||context.state==='closed')throw new Error('CD-DA requires an open AudioContext');
  let module=modules.get(context);if(!module){module=context.audioWorklet.addModule(workletUrl);modules.set(context,module);module.catch(()=>modules.delete(context));}
  const [response]=await Promise.all([fetcher(wasmUrl,{signal}),module]);if(!response.ok)throw new Error(`CD-DA WASM HTTP ${response.status}`);
  const wasmBinary=await response.arrayBuffer();signal?.throwIfAborted();
  const node=new AudioWorkletNode(context,'tetorica-cdda',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary}});
  let disposed=false,next=0;const pending=new Map();
  const dispose=()=>{if(disposed)return;disposed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new DOMException('CD-DA endpoint closed','AbortError'));}pending.clear();try{node.port.postMessage({action:{type:'dispose'}});node.disconnect();}catch{}node.onprocessorerror=null;node.port.onmessage=null;node.port.close();context.removeEventListener('statechange',closed);signal?.removeEventListener('abort',dispose);};
  const closed=()=>{if(context.state==='closed')dispose();};
  context.addEventListener('statechange',closed);signal?.addEventListener('abort',dispose,{once:true});
  const request=(action,transfer=[])=>new Promise((resolve,reject)=>{
    if(disposed){reject(new Error('CD-DA endpoint closed'));return;}
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CD-DA audio command timed out'));dispose();},20000);
    pending.set(id,{resolve,reject,timer});try{node.port.postMessage({id,action},transfer);}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
  });
  node.port.onmessage=({data})=>{if(data.type==='cdda-error'){onError?.(new Error(data.error));dispose();return;}const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.value);};
  node.onprocessorerror=()=>{onError?.(new Error('CD-DA Worklet processor failed'));dispose();};
  try{await request({type:'ready'});signal?.throwIfAborted();return {node,
    async prepare(pcm,track,{signal:operationSignal}={}){
      operationSignal?.throwIfAborted();
      if(!(pcm instanceof Uint8Array)||!pcm.length||pcm.length%4||pcm.length>256*1024*1024)throw new RangeError('Invalid CD-DA PCM16 track');
      // Never detach Virtual Files' buffer or copy a complete Float32 song.
      const copy=pcm.slice();await request({type:'prepare',pcm:copy,track},[copy.buffer]);operationSignal?.throwIfAborted();
    },
    /** @param {object} action @param {{at?:number}} [timing] */
    command(action,{at}={}){
      if(at!==undefined&&(!Number.isFinite(at)||at<0||!Number.isSafeInteger(Math.round(at*context.sampleRate))))return Promise.reject(new RangeError('CD-DA at must be nonnegative audio-clock seconds'));
      return request({...action,...(at===undefined?{}:{frame:Math.round(at*context.sampleRate)})});
    },dispose};
  }catch(error){dispose();throw error;}
}
