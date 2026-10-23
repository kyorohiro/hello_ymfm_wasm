import {watchAudioEndpoint} from './playground_audio_endpoint.js?v=native-extra-levels-1';
import {CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';

const nativeFetch = globalThis.fetch?.bind(globalThis);
const modules = new WeakMap();
/** Browser setup; subsequent writes travel directly from Worker to Worklet.
 * @param {AudioContext} context @param {AudioNode|null} destination
 * @param {{clock?:number,signal?:AbortSignal,wasmUrl?:string|URL,workletUrl?:string|URL,fetch?:typeof fetch,onError?:()=>void}} [options] */
export async function createAy8910Audio(context, destination, options = {}) {
  options.signal?.throwIfAborted();
  const chip = 'ay8910';
  const clock = validateChipClock(options.clock ?? CHIP_CLOCKS[chip]);
  if (!context?.audioWorklet || context.state === 'closed') throw new Error('AY8910 requires an open AudioContext with AudioWorklet');
  const workletUrl = String(options.workletUrl ?? new URL('./playground_ay8910_worklet.js?v=native-extra-levels-1', import.meta.url));
  let cache = modules.get(context); if (!cache) modules.set(context, cache = new Map());
  let module = cache.get(workletUrl);
  if (!module) { module = context.audioWorklet.addModule(workletUrl); cache.set(workletUrl, module); module.catch(() => cache.delete(workletUrl)); }
  const wait = promise => {
    const signal = options.signal; if (!signal) return promise; signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, {once:true});
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  };
  const [wasmBinary] = await wait(Promise.all([
    (options.fetch ?? nativeFetch)(options.wasmUrl ?? new URL(`../generated/${chip}_wasm.wasm`, import.meta.url), {signal:options.signal})
      .then(response => { if (!response.ok) throw new Error(`AY8910 WASM HTTP ${response.status}`); return response.arrayBuffer(); }),
    module,
  ]));
  options.signal?.throwIfAborted();
  const node = new AudioWorkletNode(context, 'tetorica-ay8910', {
    numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{wasmBinary, clock, chip},
  });
  const channel = new MessageChannel(); let disposed = false, rejectReady, timer;
  const dispose = () => {
    if (disposed) return; disposed = true;
    try { node.port.postMessage({method:'dispose'}); } catch {}
    clearTimeout(timer); context.removeEventListener?.('statechange', closed); node.onprocessorerror = null; node.port.onmessage = null;
    try { node.disconnect(); } catch {}
    node.port.close(); channel.port1.close(); channel.port2.close();
  };
  const closed = () => { if (context.state === 'closed') { rejectReady?.(new Error('AY8910 AudioContext was closed')); dispose(); } };
  const abort = () => { rejectReady?.(options.signal.reason); dispose(); };
  context.addEventListener?.('statechange', closed); options.signal?.addEventListener('abort', abort, {once:true});
  try {
    await wait(new Promise((resolve, reject) => {
      rejectReady = reject;
      timer = setTimeout(() => { reject(new Error('AY8910 AudioWorklet initialization timed out')); dispose(); }, 15000); timer.unref?.();
      node.port.onmessage = ({data}) => {
        if(data.type==='chip-inspector-result')return;
        if (data.ready) resolve(); else if (data.error) { reject(new Error(data.error)); dispose(); }
      };
      node.onprocessorerror = () => { reject(new Error('AY8910 Worklet processor failed')); dispose(); options.onError?.(); };
    }));
    clearTimeout(timer); options.signal?.throwIfAborted();
    if (context.state === 'closed') throw new Error('AY8910 AudioContext was closed');
    node.port.postMessage({port:channel.port1}, [channel.port1]); if (destination) node.connect(destination);
    return watchAudioEndpoint({node, port:channel.port2, clock, chip, dispose}, {context,label:'AY8910',onError:options.onError});
  } catch (error) { dispose(); throw error; }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
