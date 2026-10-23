import {watchAudioEndpoint} from './playground_audio_endpoint.js?v=native-extra-gameboy-1';
import {OKIM6258_CLOCK} from './okim6258synth.js?v=native-extra-gameboy-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
const nativeFetch = globalThis.fetch?.bind(globalThis);
const modules = new WeakMap();

/** @param {AudioContext} context
 * @param {AudioNode|null} destination
 * @param {{clock?:number,wasmUrl?:string|URL,workletUrl?:string|URL,signal?:AbortSignal,fetch?:typeof fetch}} [options]
 */
export async function createOki6258Audio(context, destination, {clock = OKIM6258_CLOCK,
  wasmUrl = new URL('../generated/okim6258_wasm.wasm', import.meta.url),
  workletUrl = new URL('./playground_okim6258_worklet.js?v=native-extra-gameboy-1', import.meta.url), signal, fetch:fetchBytes = nativeFetch} = {}) {
  validateChipClock(clock);
  signal?.throwIfAborted();
  if (!context?.audioWorklet || context.state === 'closed') throw new Error('OKIM6258 requires an open AudioContext with AudioWorklet');
  const url = String(workletUrl);
  let cache = modules.get(context); if (!cache) modules.set(context, cache = new Map());
  let module = cache.get(url);
  if (!module) { module = context.audioWorklet.addModule(url); cache.set(url, module); module.catch(() => cache.delete(url)); }
  const wait = promise => {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
      signal.addEventListener('abort', abort, {once:true});
      Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); },
        error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  };
  const [wasmBinary] = await wait(Promise.all([
    (async () => {
      const response = await fetchBytes(wasmUrl, {signal});
      if (!response.ok) throw new Error(`OKIM6258 HTTP ${response.status}`);
      return response.arrayBuffer();
    })(),
    module,
  ]));
  signal?.throwIfAborted();
  const node = new AudioWorkletNode(context, 'tetorica-okim6258', {
    numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{wasmBinary, clock},
  });
  const channel = new MessageChannel();
  let disposed = false, rejectReady, timer;
  const closed = () => { if (context.state === 'closed') { rejectReady?.(new Error('OKIM6258 AudioContext was closed')); dispose(); } };
  const abort = () => { rejectReady?.(signal.reason); dispose(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer); signal?.removeEventListener('abort', abort); context.removeEventListener?.('statechange', closed);
    node.onprocessorerror = null; node.port.onmessage = null;
    try { node.port.postMessage({method:'dispose'}); } catch {}
    try { node.disconnect(); } catch {}
    node.port.close(); channel.port1.close(); channel.port2.close();
  };
  context.addEventListener?.('statechange', closed); signal?.addEventListener('abort', abort, {once:true});
  try {
    await wait(new Promise((resolve, reject) => {
      rejectReady = reject;
      timer = setTimeout(() => { reject(new Error('OKIM6258 AudioWorklet initialization timed out')); dispose(); }, 15000); timer.unref?.();
      node.port.onmessage = ({data}) => {
        if(data.type==='chip-inspector-result')return;
        if (data.ready) resolve();
        else if (data.error) { reject(new Error(data.error)); dispose(); }
      };
      node.onprocessorerror = () => { reject(new Error('OKIM6258 Worklet failed')); dispose(); };
    }));
    clearTimeout(timer);
    signal?.throwIfAborted();
    if (context.state === 'closed') throw new Error('OKIM6258 AudioContext was closed');
    if (destination) node.connect(destination);
    node.port.postMessage({port:channel.port1}, [channel.port1]);
    return watchAudioEndpoint({node, port:channel.port2, clock, dispose}, {context,label:'OKIM6258'});
  } catch (error) { dispose(); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}
