import {watchAudioEndpoint} from './playground_audio_endpoint.js';
import {validateSidClock, SID_PAL_CLOCK} from './sidsynth.js';

const nativeFetch = globalThis.fetch?.bind(globalThis), modules = new WeakMap();
/** Main-thread asset loading; no fetch or URL constructor is needed in Worklet.
 * Every endpoint owns its SID/WASM instance and may only acknowledge its
 * creation clock. Output is the same mono signal on left and right. */
export async function createSidAudio(context, destination, options = {}) {
  options.signal?.throwIfAborted();
  const clock = validateSidClock(options.clock ?? SID_PAL_CLOCK);
  if (options.model !== undefined && options.model !== '6581') throw new RangeError('Only SID model 6581 is supported');
  if (!Number.isInteger(context?.sampleRate) || context.sampleRate < 8000 || context.sampleRate > 96000) throw new RangeError('SID output sample rate must be 8000..96000 Hz');
  if (!context?.audioWorklet || context.state === 'closed') throw new Error('SID requires an open AudioContext with AudioWorklet');
  const workletUrl = String(options.workletUrl ?? new URL('./playground_sid_worklet.js', import.meta.url));
  let cache = modules.get(context); if (!cache) modules.set(context, cache = new Map());
  let module = cache.get(workletUrl);
  if (!module) { module = context.audioWorklet.addModule(workletUrl); cache.set(workletUrl, module); module.catch(() => cache.delete(workletUrl)); }
  const wait = promise => {
    const signal = options.signal; if (!signal) return promise; signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, {once: true});
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  };
  const [wasmBinary] = await wait(Promise.all([
    (options.fetch ?? nativeFetch)(options.wasmUrl ?? new URL('../generated/sid/sid.wasm', import.meta.url), {signal: options.signal})
      .then(response => { if (!response.ok) throw new Error(`SID WASM HTTP ${response.status}`); return response.arrayBuffer(); }), module,
  ]));
  options.signal?.throwIfAborted();
  if (context.state === 'closed') throw new Error('SID AudioContext was closed');
  const node = new AudioWorkletNode(context, 'tetorica-sid', {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    processorOptions: {wasmBinary, clock, model: '6581'}});
  const channel = new MessageChannel(); let disposed = false, rejectReady, timer;
  const dispose = () => {
    if (disposed) return; disposed = true;
    try { node.port.postMessage({method: 'dispose'}); } catch {}
    clearTimeout(timer); context.removeEventListener?.('statechange', closed); node.onprocessorerror = null; node.port.onmessage = null;
    try { node.disconnect(); } catch {}
    node.port.close(); channel.port1.close(); channel.port2.close();
  };
  const closed = () => { if (context.state === 'closed') { rejectReady?.(new Error('SID AudioContext was closed')); dispose(); } };
  const abort = () => { rejectReady?.(options.signal.reason); dispose(); };
  context.addEventListener?.('statechange', closed); options.signal?.addEventListener('abort', abort, {once: true});
  try {
    await wait(new Promise((resolve, reject) => {
      rejectReady = reject;
      timer = setTimeout(() => { reject(new Error('SID AudioWorklet initialization timed out')); dispose(); }, 15000); timer.unref?.();
      node.port.onmessage = ({data}) => {
        if (data.type === 'chip-inspector-result') return;
        if (data.ready) resolve(); else if (data.error) { reject(new Error(data.error)); dispose(); }
      };
      node.onprocessorerror = () => { const error = new Error('SID Worklet processor failed'); reject(error); dispose(); options.onError?.(error); };
    }));
    clearTimeout(timer); options.signal?.throwIfAborted();
    if (context.state === 'closed') throw new Error('SID AudioContext was closed');
    node.port.postMessage({port: channel.port1}, [channel.port1]); if (destination) node.connect(destination);
    return watchAudioEndpoint({node, port: channel.port2, clock, model: '6581', chip: 'sid', dispose}, {context, label: 'SID', onError: options.onError});
  } catch (error) { dispose(); throw error; }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
