// Readable, standalone Web Audio adapter for the first SID experiment.
import {defaultSidSettings, validateSidSettings} from '../../js/sid_test_instrument.js';
export {defaultSidSettings};

/** Creates no audio device until start(), called from a user gesture. */
export function createSidAudio({onError = () => {}} = {}) {
  let settings = {...defaultSidSettings}, context = null, analyser = null, output = null;
  let node = null, starting = null, moduleReady = false, disposed = false, epoch = 0, sequence = 0;
  const pending = new Map();
  const cancelled = () => new DOMException('SID audio operation cancelled', 'AbortError');
  function teardown() {
    epoch++;
    if (node) {
      try { node.port.postMessage({method: 'dispose'}); } catch {}
      node.onprocessorerror = null; node.port.onmessage = null; node.port.onmessageerror = null;
      node.disconnect(); node.port.close(); node = null;
    }
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(cancelled()); }
    pending.clear(); starting = null;
  }
  function failure(error) { teardown(); onError(error); }
  function request(method, args = [], transfer = []) {
    if (disposed || !node) return Promise.reject(new Error('Start SID audio before playing'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => failure(new Error('SID AudioWorklet did not respond')), 10000);
      pending.set(id, {resolve, reject, timer});
      try { node.port.postMessage({id, method, args}, transfer); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  const audio = {
    get context() { return context; },
    get analyser() { return analyser; },
    get sampleRate() { return context?.sampleRate ?? 0; },
    async start() {
      if (disposed) throw new Error('SID audio is disposed');
      if (starting) return starting;
      if (!context) {
        context = new AudioContext({latencyHint: 'interactive'});
        analyser = context.createAnalyser(); analyser.fftSize = 4096;
        output = context.createGain();
        analyser.connect(output); output.connect(context.destination);
      }
      // Resume immediately in the Play gesture, before fetching or compilation.
      const resume = context.resume();
      if (node) { await resume; return; }
      const token = ++epoch;
      const operation = (async () => {
        await resume;
        if (!moduleReady) { await context.audioWorklet.addModule(new URL('./processor.js', import.meta.url)); moduleReady = true; }
        const response = await fetch(new URL('../../generated/sid/sid.wasm', import.meta.url));
        if (!response.ok) throw new Error(`SID WASM could not be loaded (${response.status})`);
        const bytes = await response.arrayBuffer();
        if (disposed || token !== epoch) throw cancelled();
        node = new AudioWorkletNode(context, 'tetorica-sid-lab', {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1]});
        node.port.onmessage = ({data}) => {
          if (data.fatal) { failure(new Error(data.error)); return; }
          const item = pending.get(data.id);
          if (!item) return;
          clearTimeout(item.timer); pending.delete(data.id);
          data.error ? item.reject(new Error(data.error)) : item.resolve(data.value);
        };
        node.port.onmessageerror = () => failure(new Error('Invalid SID AudioWorklet message'));
        node.onprocessorerror = () => failure(new Error('SID AudioWorklet failed'));
        node.connect(analyser);
        await request('init', [bytes, settings], [bytes]);
        if (disposed || token !== epoch) throw cancelled();
      })();
      starting = operation;
      try { await operation; }
      catch (error) { if (token === epoch) teardown(); throw error; }
      finally { if (starting === operation) starting = null; }
    },
    async setSettings(value) {
      if (disposed) throw new Error('SID audio is disposed');
      const next = validateSidSettings({...settings, ...value});
      if (next.clockHz !== settings.clockHz) { teardown(); settings = next; return; }
      if (node) await request('setSettings', [next]);
      settings = next;
    },
    playTone(hz = 220) { return request('playTone', [hz]); },
    playChord() { return request('playChord'); },
    release() { return node ? request('release') : Promise.resolve(); },
    stop() { teardown(); return Promise.resolve(); },
    getState() { return request('getState'); },
    async dispose() {
      if (disposed) return;
      disposed = true; teardown(); analyser?.disconnect(); output?.disconnect();
      if (context && context.state !== 'closed') await context.close();
    },
  };
  return audio;
}
