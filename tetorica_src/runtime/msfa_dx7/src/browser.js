import { DEFAULT_WASM_URL } from './index.js';
import { validatePreset, validateOperator, validateOperators } from './preset.js';

const PROCESSOR_NAME = 'tetorica-msfa-dx7';
const loadedModules = new WeakMap();

function midiInteger(value, name, min = 0, max = 127) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
}

function copyBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (input instanceof Uint8Array) return input.slice();
  throw new TypeError('SysEx data must be a Uint8Array or ArrayBuffer.');
}

/**
 * Create a ready, unconnected mono AudioWorklet instrument. Each instance owns
 * its WASM state. The output rate follows context.sampleRate; internal synthesis
 * is fixed at 44,100 Hz. Await loadSysex() or a preset setter before using a
 * newly loaded/edited patch; a fresh node starts without a voice bank.
 */
export async function createDX7Node(context, options = {}) {
  if (!context?.audioWorklet || context.state === 'closed') {
    throw new Error('An open AudioContext with AudioWorklet support is required.');
  }
  const workletUrl = String(options.workletUrl ?? new URL('./dx7-worklet.js', import.meta.url));
  let contextModules = loadedModules.get(context);
  if (!contextModules) loadedModules.set(context, contextModules = new Map());
  let moduleReady = contextModules.get(workletUrl);
  if (!moduleReady) {
    moduleReady = context.audioWorklet.addModule(workletUrl);
    contextModules.set(workletUrl, moduleReady);
    moduleReady.catch(() => contextModules.delete(workletUrl));
  }
  let wasmBytes;
  if (options.wasmBytes !== undefined) {
    wasmBytes = copyBytes(options.wasmBytes);
  } else {
    const response = await fetch(options.wasmUrl ?? DEFAULT_WASM_URL);
    if (!response.ok) throw new Error(`Unable to load DX7 WASM: HTTP ${response.status}.`);
    wasmBytes = new Uint8Array(await response.arrayBuffer());
  }
  await moduleReady;
  if (context.state === 'closed') throw new Error('AudioContext was closed during initialization.');
  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { wasmBytes },
  });
  let disposed = false;
  let failed = null;
  let cleanedUp = false;
  let voices = [];
  let selectedVoice = -1;
  let selectionRevision = 0;
  let nextId = 1;
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    // A processor can already be dead or its context closed. Cleanup must still
    // release the other resources without hiding the original error.
    try { node.port.postMessage({ type: 'dispose' }); } catch { /* Already stopped. */ }
    node.port.onmessage = null;
    node.onprocessorerror = null;
    context.removeEventListener('statechange', onStateChange);
    try { node.disconnect(); } catch { /* Already disconnected. */ }
    try { node.port.close(); } catch { /* Already closed. */ }
  }
  function rejectRequests(error) {
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  function fail(error) {
    if (failed || disposed) return;
    failed = error;
    rejectRequests(error);
    cleanup();
    options.onError?.(error);
  }
  const onStateChange = () => {
    if (context.state === 'closed') fail(new Error('AudioContext is closed.'));
  };
  context.addEventListener('statechange', onStateChange);
  node.port.onmessage = ({ data }) => {
    if (disposed || failed || cleanedUp) return;
    if (data.type === 'ready') {
      voices = data.voices;
      selectedVoice = data.selectedVoice;
      readyResolve();
    } else if (data.type === 'result') {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data);
    } else if (data.type === 'error') {
      fail(new Error(data.error));
    }
  };
  node.onprocessorerror = () => fail(new Error('The DX7 AudioWorklet processor failed.'));
  function assertUsable() {
    if (disposed) throw new Error('DX7 node has been disposed.');
    if (failed) throw failed;
    if (context.state === 'closed') throw new Error('AudioContext is closed.');
  }
  function send(type, data = {}) {
    assertUsable();
    node.port.postMessage({ type, ...data });
  }
  function request(type, data = {}, transfer = []) {
    assertUsable();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { node.port.postMessage({ type, id, ...data }, transfer); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  function updateMetadata(result, revision) {
    voices = result.voices;
    // Replies are ordered snapshots. A later synchronous selectVoice() has
    // already updated local selection and must not be undone by an older reply.
    if (revision === selectionRevision) selectedVoice = result.selectedVoice;
  }
  async function requestWithMetadata(type, data = {}, transfer = []) {
    const revision = selectionRevision;
    const result = await request(type, data, transfer);
    updateMetadata(result, revision);
    return result;
  }
  try { await ready; } catch (error) {
    cleanup();
    throw error;
  }
  return {
    node,
    sampleRate: context.sampleRate,
    internalSampleRate: 44100,
    get voices() { return voices; },
    get selectedVoice() { return selectedVoice; },
    async loadSysex(input) {
      assertUsable();
      const bytes = copyBytes(input);
      await requestWithMetadata('loadSysex', { bytes }, [bytes.buffer]);
      return voices;
    },
    async setPreset(preset) {
      assertUsable();
      validatePreset(preset);
      const copy = structuredClone(preset);
      await requestWithMetadata('setPreset', { preset: copy });
    },
    async setOperator(op, patch) {
      assertUsable();
      validateOperator(op, patch);
      const copy = structuredClone(patch);
      await requestWithMetadata('setOperator', { op, patch: copy });
    },
    async setOperators(operators) {
      assertUsable();
      validateOperators(operators);
      const copy = structuredClone(operators);
      await requestWithMetadata('setOperators', { operators: copy });
    },
    async getPreset() {
      const result = await requestWithMetadata('getPreset');
      return result.preset;
    },
    async setFeedback(feedback) {
      assertUsable();
      midiInteger(feedback, 'Feedback', 0, 7);
      await requestWithMetadata('setFeedback', { feedback });
    },
    selectVoice(index) {
      midiInteger(index, 'Voice index', 0, voices.length - 1);
      send('selectVoice', { index });
      selectionRevision++;
      selectedVoice = index;
    },
    noteOn(note, velocity = 100) {
      midiInteger(note, 'Note');
      midiInteger(velocity, 'Velocity');
      send('noteOn', { note, velocity });
    },
    noteOff(note) {
      midiInteger(note, 'Note');
      send('noteOff', { note });
    },
    allNotesOff() { send('allNotesOff'); },
    panic() { send('panic'); },
    dispose() {
      if (disposed) return;
      disposed = true;
      rejectRequests(new Error('DX7 node has been disposed.'));
      cleanup();
    },
  };
}
