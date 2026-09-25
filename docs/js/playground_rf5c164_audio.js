/** Browser main thread: setup only. Playback commands use a dedicated MessagePort. */
const nativeFetch=globalThis.fetch?.bind(globalThis);
export async function createRf5c164Audio(context,destination){
 const [wasmBinary]=await Promise.all([nativeFetch(new URL('../generated/rf5c164_wasm.wasm',import.meta.url)).then(r=>{if(!r.ok)throw new Error(`RF5C164 HTTP ${r.status}`);return r.arrayBuffer();}),context.audioWorklet.addModule(new URL('./rf5c164-worklet.js',import.meta.url))]);
 const node=new AudioWorkletNode(context,'tetorica-rf5c164',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{wasmBinary}});
 try{await new Promise((resolve,reject)=>{node.port.onmessage=({data})=>{if(data.ready)resolve();else if(data.error)reject(new Error(data.error));};node.onprocessorerror=()=>reject(new Error('RF5C164 Worklet failed'));});}catch(e){node.port.postMessage({method:'dispose'});node.disconnect();throw e;}
 node.connect(destination);const channel=new MessageChannel();node.port.postMessage({port:channel.port1},[channel.port1]);
 return {port:channel.port2,dispose(){node.port.postMessage({method:'dispose'});node.disconnect();}};
}
