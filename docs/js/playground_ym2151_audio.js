import {watchAudioEndpoint} from './playground_audio_endpoint.js?v=mixer-state-1';
/** Browser setup; commands subsequently travel directly from Worker to Worklet. */
const nativeFetch = globalThis.fetch?.bind(globalThis);
/** @param {AudioContext} context
 * @param {AudioNode|null} destination
 * @param {{signal?:AbortSignal,fetch?:typeof fetch,wasmUrl?:string|URL,workletUrl?:string|URL}} [options] */
export async function createYm2151Audio(context, destination, options = {}) {
  const signal = options.signal;
  signal?.throwIfAborted();
  const bytes = async () => {
    const response = await (options.fetch ?? nativeFetch)(options.wasmUrl ?? new URL('../generated/ym2151_wasm.wasm', import.meta.url), {signal});
    if (!response.ok) throw new Error(`YM2151 HTTP ${response.status}`);
    return response.arrayBuffer();
  };
  const [wasmBinary] = await waitForInitialization(Promise.all([
    bytes(), context.audioWorklet.addModule(options.workletUrl ?? new URL('./playground_ym2151_worklet.js?v=audio-numeric-bindings-1', import.meta.url)),
  ]), signal);
  signal?.throwIfAborted();
  const node = new AudioWorkletNode(context, 'tetorica-ym2151', {
    numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{wasmBinary},
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
      readyTimer = setTimeout(() => reject(new Error('YM2151 AudioWorklet initialization timed out')), 15000);
      readyTimer.unref?.();
      node.port.onmessage = ({data}) => { if(data.type==='chip-inspector-result')return; if (data.ready) resolve(); else if (data.error) reject(new Error(data.error)); };
      node.onprocessorerror = () => reject(new Error('YM2151 Worklet failed'));
    }), signal);
    clearTimeout(readyTimer); signal?.throwIfAborted();
    if (destination) node.connect(destination);
    node.port.postMessage({port:channel.port1}, [channel.port1]);
    return watchAudioEndpoint({node, port:channel.port2, dispose}, {context,label:'YM2151',onError:options.onError});
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
