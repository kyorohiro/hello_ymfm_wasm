// Capture the application fetch before Playground user-code network guards run.
const nativeFetch = globalThis.fetch?.bind(globalThis);
const loadedModules = new WeakMap();
const wasmLoads = new WeakMap();

function ensureContext(context) {
  if (!context?.audioWorklet || context.state === 'closed') {
    throw new Error('An open AudioContext with AudioWorklet support is required.');
  }
  if (context.sampleRate !== 44100 && context.sampleRate !== 48000) {
    throw new RangeError('DX7 output sampleRate must be 44100 or 48000 Hz.');
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error('DX7 initialization was aborted.');
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('DX7 initialization was aborted.'));
    signal.addEventListener('abort', abort, {once: true});
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function loadWasm(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('DX7 WASM loading requires fetch.');
  let ready = wasmLoads.get(fetchImpl);
  if (!ready) {
    ready = (async () => {
      const response = await fetchImpl(new URL('./msfa_dx7/wasm/msfa.wasm', import.meta.url));
      if (!response.ok) throw new Error(`Could not load DX7 WASM (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    })();
    wasmLoads.set(fetchImpl, ready);
    ready.catch(() => { if (wasmLoads.get(fetchImpl) === ready) wasmLoads.delete(fetchImpl); });
  }
  return ready;
}

function loadModule(context) {
  let ready = loadedModules.get(context);
  if (!ready) {
    ready = context.audioWorklet.addModule(new URL('./playground_dx7_worklet.js?v=audio-numeric-bindings-1', import.meta.url));
    loadedModules.set(context, ready);
    ready.catch(() => { if (loadedModules.get(context) === ready) loadedModules.delete(context); });
  }
  return ready;
}

/**
 * Ready PCM source for the existing Playground mixer. Owns no AudioContext;
 * control commands use a direct transferable Main/Worker-to-Worklet port.
 * @param {AudioContext} context
 * @param {AudioNode|null} destination
 * @param {{signal?:AbortSignal,fetch?:typeof fetch,onError?:(error:Error)=>void}} [options]
 */
export async function createDx7Audio(context, destination, options = {}) {
  ensureContext(context);
  throwIfAborted(options.signal);
  const [wasmBytes] = await waitWithSignal(Promise.all([
    loadWasm(options.fetch ?? nativeFetch), loadModule(context),
  ]), options.signal);
  ensureContext(context);
  throwIfAborted(options.signal);
  const node = new AudioWorkletNode(context, 'tetorica-playground-dx7', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {wasmBytes},
  });
  let disposed = false, failed = null, endpoint = null;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const channel = new MessageChannel();
  const closed = () => { if (context.state === 'closed') fail(new Error('DX7 AudioContext is closed.')); };
  const abort = () => fail(options.signal.reason ?? new Error('DX7 initialization was aborted.'));
  function cleanup() {
    if (disposed) return;
    disposed = true;
    try { node.port.postMessage({method: 'dispose'}); } catch { /* Processor already stopped. */ }
    node.port.onmessage = null;
    node.onprocessorerror = null;
    context.removeEventListener?.('statechange', closed);
    options.signal?.removeEventListener('abort', abort);
    try { node.disconnect(); } catch { /* Context already closed. */ }
    node.port.close();
    // port1 may already be transferred; close() is safe in both states.
    channel.port1.close();
    // Once returned, port2 belongs to the client. Leave it open long enough to
    // receive the Worklet's fatal disposal acknowledgement and reject uploads.
    if (!endpoint) channel.port2.close();
  }
  function fail(error) {
    if (disposed || failed) return;
    failed = error;
    readyReject(error);
    // Runtime may wrap dispose() to release its mixer route and Main client.
    // Use that current wrapper before disconnecting the underlying node.
    if (endpoint) endpoint.dispose(); else cleanup();
    options.onError?.(error);
  }
  node.port.onmessage = ({data}) => {
    // Editor validation errors belong to their admin RPC caller. They must not
    // dispose a healthy synth or turn an invalid edit into a fatal audio error.
    if (data.type === 'chip-inspector-result') return;
    if (data.ready) readyResolve(data);
    else if (data.fatal || data.error) fail(new Error(data.error ?? 'DX7 AudioWorklet failed.'));
  };
  node.onprocessorerror = () => fail(new Error('DX7 AudioWorklet processor failed.'));
  context.addEventListener?.('statechange', closed);
  options.signal?.addEventListener('abort', abort, {once: true});
  try {
    const state = await ready;
    throwIfAborted(options.signal);
    ensureContext(context);
    node.port.postMessage({port: channel.port1}, [channel.port1]);
    if (destination) node.connect(destination);
    // AbortSignal controls initialization; ownership moves to the endpoint.
    options.signal?.removeEventListener('abort', abort);
    endpoint = {
      node,
      port: channel.port2,
      sampleRate: state.sampleRate,
      internalSampleRate: state.internalSampleRate,
      voices: state.voices,
      selectedVoice: state.selectedVoice,
      dispose: cleanup,
    };
    return endpoint;
  } catch (error) { cleanup(); throw error; }
}
