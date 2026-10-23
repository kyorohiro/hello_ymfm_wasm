import {watchAudioEndpoint} from './playground_audio_endpoint.js?v=native-extra-nes-1';
// Capture the trusted asset loader before user-code execution installs its
// network guard, as the other Playground audio adapters do.
const defaultFetch=globalThis.fetch?.bind(globalThis);
/** Commands travel directly from Main or logic Worker to the PWM AudioWorklet. */
/** @param {AudioContext} context
 * @param {AudioNode} destination
 * @param {{signal?:AbortSignal,clock?:number,gain?:number,outputMode?:'dac'|'duty',implementation?:'wasm'|'js',wasmBinary?:Uint8Array|ArrayBuffer,fetch?:typeof fetch}} [options] */
export async function createPWM32XAudio(context, destination, options = {}) {
  options.signal?.throwIfAborted();
  const wasmUrl=new URL('../generated/pwm32x_wasm.wasm?v=pwm-wasm-1',import.meta.url);
  const [wasmBinary]=await Promise.all([
    options.implementation==='js'?undefined:options.wasmBinary??(options.fetch??defaultFetch)(wasmUrl,{signal:options.signal}).then(response=>{
      if(!response.ok)throw new Error(`PWM WASM HTTP ${response.status}`);return response.arrayBuffer();
    }),
    context.audioWorklet.addModule(new URL('./playground_pwm_worklet.js?v=pwm-wasm-1', import.meta.url)),
  ]);
  options.signal?.throwIfAborted();
  const node = new AudioWorkletNode(context, 'tetorica-pwm32x', {
    numberOfInputs: 0, outputChannelCount: [2],
    processorOptions: {...Object.fromEntries(['clock', 'gain', 'outputMode','implementation'].filter(key => options[key] !== undefined).map(key => [key, options[key]])),wasmBinary},
  });
  try {
    await new Promise((resolve, reject) => {
      node.port.onmessage = ({data}) => {if(data.type==='chip-inspector-result')return;if (data.ready) resolve(); else if (data.error) reject(new Error(data.error));};
      node.onprocessorerror = () => reject(new Error('PWM AudioWorklet failed'));
    });
    options.signal?.throwIfAborted();
  } catch (error) {node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close(); throw error;}
  node.connect(destination);
  const channel = new MessageChannel(); node.port.postMessage({port: channel.port1}, [channel.port1]);
  let disposed = false;
  return watchAudioEndpoint({node, port:channel.port2, dispose() {
    if (disposed) return;
    disposed=true;node.port.onmessage=null;node.onprocessorerror=null;
    try {node.port.postMessage({method:'dispose'});} catch {}
    try {node.disconnect();} catch {}
    node.port.close();channel.port1.close();channel.port2.close();
  }}, {context,label:'PWM',onError:options.onError});
}
