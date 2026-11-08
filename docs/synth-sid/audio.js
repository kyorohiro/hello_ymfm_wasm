// SPDX-License-Identifier: BSD-3-Clause
export const SID_SYNTH_BALANCE = 1;
const DEADLINE_MS = 15000;
const COMMANDS = new Set(['read', 'setPreset', 'loadPreset', 'setChannelSettings', 'loadChannelSettings', 'noteOn', 'noteOff', 'setPitch', 'stop']);

function validateVolume(value) {
  if (!Number.isFinite(value) || value < 0 || value > 3.8) throw new RangeError('SID Master must be from 0 to 3.8');
}

/** User-gesture-created mono SID, duplicated to stereo by the processor.
 * outputNode is after the user Master. Attach visualizers as passive branches;
 * do not connect their output to destination a second time.
 * @param {{volume?:number,model?:'6581'|'8580',onError?:(error:Error)=>void,signal?:AbortSignal}} [options]
 */
export async function createAudio({volume = .7, model = '6581', onError = () => {}, signal} = {}) {
  validateVolume(volume);
  if(!['6581','8580'].includes(model))throw new RangeError('SID model must be 6581 or 8580');
  if (signal?.aborted) throw new DOMException('SID audio startup cancelled', 'AbortError');
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('This browser does not support Web Audio');
  const context = new Context({latencyHint: 'interactive'}), controller = new AbortController(), pending = new Map();
  let node = null, balance = null, master = null, disposed = false, closing = null, fatalError = null;
  let nextId = 0, startupTimer, rejectStartup, resolveReady;
  const startupFailure = new Promise((_, reject) => { rejectStartup = reject; });
  void startupFailure.catch(() => {});
  const report = error => { try { onError(error); } catch {} };
  const rejectPending = error => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  function assertOpen() {
    if (fatalError) throw fatalError;
    if (disposed || context.state === 'closed') throw new Error('SID audio is closed. Enable audio to restart.');
  }
  function dispose() {
    if (closing) return closing;
    disposed = true; clearTimeout(startupTimer); controller.abort();
    context.removeEventListener('statechange', stateChanged);
    rejectPending(fatalError ?? new Error('SID audio was disposed'));
    if (node) {
      node.onprocessorerror = null; node.port.onmessage = null; node.port.onmessageerror = null;
      try { node.port.postMessage({method: 'dispose'}); } catch {}
      try { node.disconnect(); } catch {}
      node.port.close();
    }
    balance?.disconnect(); master?.disconnect();
    closing = (async () => { if (context.state !== 'closed') await context.close(); })();
    return closing;
  }
  function fail(error) {
    if (disposed || fatalError) return;
    fatalError = error instanceof Error ? error : new Error(String(error));
    rejectStartup(fatalError); rejectPending(fatalError); report(fatalError);
    void dispose().catch(() => {});
  }
  function stateChanged() {
    if (context.state === 'closed' && !disposed) fail(new Error('SID AudioContext was closed. Enable audio to restart.'));
  }
  const cancelled = () => {
    rejectStartup(new DOMException('SID audio startup cancelled', 'AbortError'));
    void dispose().catch(() => {});
  };
  context.addEventListener('statechange', stateChanged); signal?.addEventListener('abort', cancelled, {once: true});
  const boundedStartup = promise => Promise.race([promise, startupFailure]);
  try {
    if (signal?.aborted) throw new DOMException('SID audio startup cancelled', 'AbortError');
    if (!context.audioWorklet) throw new Error('SID Synth needs AudioWorklet. Open it over HTTPS or localhost.');
    if (!Number.isInteger(context.sampleRate) || context.sampleRate < 8000 || context.sampleRate > 96000) throw new RangeError('SID output sample rate must be 8000..96000 Hz');
    startupTimer = setTimeout(() => fail(new Error('SID audio initialization timed out. Enable audio to retry.')), DEADLINE_MS);
    // Resume inside the user gesture, before awaiting either asset load.
    const resumed = context.resume();
    // Cache both model binaries for atomic model swaps in this same Worklet.
    // Neither binary is instantiated until its model is selected.
    const [wasmBinary,wasm8580Binary] = await boundedStartup(Promise.all([
      fetch(new URL('../generated/sid/sid.wasm', import.meta.url), {signal: controller.signal}).then(response => {
        if (!response.ok) throw new Error(`SID WASM could not load (HTTP ${response.status})`);
        return response.arrayBuffer();
      }),
      fetch(new URL('../generated/sid8580-machine/sid8580-endpoint.wasm', import.meta.url), {signal: controller.signal}).then(response => {
        if (!response.ok) throw new Error(`SID 8580 WASM could not load (HTTP ${response.status})`);
        return response.arrayBuffer();
      }),
      context.audioWorklet.addModule(new URL('./processor.js?sid-channels=2', import.meta.url)), resumed,
    ]));
    assertOpen();
    const ready = new Promise(resolve => { resolveReady = resolve; });
    node = new AudioWorkletNode(context, 'tetorica-sid-synth', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {model,wasmBinary,wasm8580Binary},
    });
    node.onprocessorerror = () => fail(new Error('SID audio processor failed. Enable audio to restart.'));
    node.port.onmessageerror = () => fail(new Error('SID audio reply could not be read. Enable audio to restart.'));
    node.port.onmessage = ({data}) => {
      if (data?.fatal) { fail(new Error(data.error ?? 'SID audio processor failed')); return; }
      if (data?.ready) { resolveReady(); return; }
      const request = pending.get(data?.id); if (!request) return;
      pending.delete(data.id); clearTimeout(request.timer);
      if (data.error) { const error = new Error(data.error); error.name = data.name ?? 'Error'; request.reject(error); }
      else request.resolve(data.value);
    };
    await boundedStartup(ready); assertOpen(); clearTimeout(startupTimer);
    balance = context.createGain(); balance.gain.value = SID_SYNTH_BALANCE;
    master = context.createGain(); master.gain.value = volume;
    node.connect(balance); balance.connect(master); master.connect(context.destination);

    async function command(method, args = []) {
      assertOpen();
      if (!COMMANDS.has(method)) throw new Error(`Unknown SID command: ${method}`);
      if (!Array.isArray(args)) throw new TypeError('SID command arguments must be an array');
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error(`SID command timed out (${method}). Enable audio to restart.`)), DEADLINE_MS);
        pending.set(id, {resolve, reject, timer});
        try { node.port.postMessage({id, method, args}); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    }
    return {
      context, outputNode: master, sampleRate: context.sampleRate, command, read: () => command('read'),
      async resume() {
        assertOpen();
        try { await context.resume(); assertOpen(); } catch (error) { fail(error); throw error; }
      },
      setVolume(value) {
        assertOpen(); validateVolume(value);
        const parameter = master.gain, now = context.currentTime;
        if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
        else { const current = parameter.value; parameter.cancelScheduledValues(now); parameter.setValueAtTime(current, now); }
        parameter.linearRampToValueAtTime(value, now + .01);
      },
      dispose,
    };
  } catch (error) {
    // Caller cancellation is silent; failures retire this engine and notify UI.
    if (signal?.aborted && !fatalError) error = new DOMException('SID audio startup cancelled', 'AbortError');
    if (error?.name !== 'AbortError') fail(error);
    await dispose().catch(() => {}); throw error;
  } finally { clearTimeout(startupTimer); signal?.removeEventListener('abort', cancelled); }
}
