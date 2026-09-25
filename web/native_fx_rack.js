/** Browser-only AudioWorklet setup. FX controls themselves also run in Workers. */
import {createNativeFXController} from './native_fx.js';
export async function createNativeFXRack(context){
 const [module]=await Promise.all([
  fetch(new URL('./native_audio_effect.wasm',import.meta.url)).then(r=>{if(!r.ok)throw new Error(`Native FX WASM: HTTP ${r.status}`);return r.arrayBuffer();}).then(b=>WebAssembly.compile(b)),
  context.audioWorklet.addModule(new URL('./native-fx-worklet.js',import.meta.url)),
 ]);
 const node=new AudioWorkletNode(context,'tetorica-native-fx',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{module}});
 node.port.onmessage=({data})=>{if(data.error)console.error('Native FX:',data.error);};
 const controller=createNativeFXController(data=>node.port.postMessage(data),{getBeatSeconds:()=>rack.getBeatSeconds()});
 const rack={node,controller,getBeatSeconds:()=>.5,
  useMain(){node.port.postMessage({op:'main'});controller.dispose();},
  workerPort(){const c=new MessageChannel();node.port.postMessage({op:'attach',port:c.port1},[c.port1]);return c.port2;},
  stop(){node.port.postMessage({op:'emergency'});},
  dispose(){node.disconnect();node.port.close();},
 };
 return rack;
}
