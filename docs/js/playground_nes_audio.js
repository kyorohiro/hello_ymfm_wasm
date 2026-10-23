import {watchAudioEndpoint} from './playground_audio_endpoint.js?v=native-extra-opl-1';
import {NES_APU_CLOCK, validateNesApuClock} from './nesapu.js?v=nes-wasm-1';
const nativeFetch=globalThis.fetch?.bind(globalThis);
/** @param {AudioContext} context
 * @param {AudioNode|null} destination
 * @param {{fds?:boolean,clock?:number,signal?:AbortSignal,workletUrl?:string|URL}} [options] */
export async function createNesAudio(context, destination, {fds = false, clock = NES_APU_CLOCK, signal, workletUrl} = {}) {
  validateNesApuClock(clock);
  signal?.throwIfAborted();
  const wasmUrl=new URL('../generated/nesapu_wasm.wasm?v=nes-wasm-1',import.meta.url);
  const [wasmBinary]=await waitForInitialization(Promise.all([
    nativeFetch(wasmUrl,{signal}).then(response=>{if(!response.ok)throw new Error(`NES WASM HTTP ${response.status}`);return response.arrayBuffer();}),
    context.audioWorklet.addModule(workletUrl ?? new URL('./playground_nes_worklet.js?v=nes-wasm-1', import.meta.url)),
  ]), signal);
  signal?.throwIfAborted();
  const node = new AudioWorkletNode(context, 'tetorica-nes', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {fds, clock,wasmBinary},
  });
  const channel = new MessageChannel();
  let disposed = false, readyTimer;
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearTimeout(readyTimer);
    node.onprocessorerror = null; node.port.onmessage = null;
    try { node.port.postMessage({method:'dispose'}); } catch {}
    node.disconnect(); node.port.close(); channel.port1.close(); channel.port2.close();
  };
  try {
    await waitForInitialization(new Promise((resolve, reject) => {
      readyTimer = setTimeout(() => reject(new Error('NES AudioWorklet initialization timed out')), 15000);
      readyTimer.unref?.();
      node.port.onmessage = ({data}) => {
        if(data.type==='chip-inspector-result')return;
        if (data.ready) resolve(); else if (data.error) reject(new Error(data.error));
      };
      node.onprocessorerror = () => reject(new Error('NES Worklet failed'));
    }), signal);
    clearTimeout(readyTimer); signal?.throwIfAborted();
    if (destination) node.connect(destination);
    node.port.postMessage({port: channel.port1}, [channel.port1]);
    return watchAudioEndpoint({node, port:channel.port2, clock, fdsEnabled:fds, dispose}, {context,label:'NES'});
  } catch (error) { dispose(); throw error; }
}

async function waitForInitialization(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once:true});
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
