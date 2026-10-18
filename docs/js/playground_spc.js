/** Full SPC file playback, independent of musical BPM and Worker lookahead. */
import {createSpcEventDecoder} from './spc_events.js?v=spc-events-1';
const abortError = () => new DOMException('SPC player disposed or operation cancelled', 'AbortError');
const TIMEOUT_MS = 15000;
export function createSpcClient(port, initial = {}, {
  getOwner = () => null, captureContext = () => null, restoreContext = () => {}, invokeEvent = (fn,event) => fn(event),
} = {}) {
  let disposed = false, sequence = 0, loadToken = 0, seekToken = 0;
  let seekResume;
  const pending = new Map();
  const listeners = new Set(); let eventEpoch = 0, decoder = null, observationInterval = 16, observationRequested = false;
  const fenceEvents = () => {++eventEpoch; decoder = null;};
  function dispatch(events) {
    const epoch = eventEpoch;
    for (const event of events) for (const listener of [...listeners]) {
      if (eventEpoch !== epoch) return;
      if (disposed || !listeners.has(listener)) continue;
      if (event.type !== 'overflow' && ((event.channel !== undefined && listener.voices && !listener.voices.has(event.channel)) || (listener.types && !listener.types.has(event.type)))) continue;
      const previousContext = captureContext();
      try {restoreContext(listener.context); Promise.resolve(invokeEvent(listener.callback,event)).catch(error => console.error('[SPC onEvent]', error));}
      catch (error) {console.error('[SPC onEvent]', error);}
      finally {restoreContext(previousContext);}
    }
  }
  function configureObservation() {
    const enabled = listeners.size > 0, interval = enabled ? Math.min(...[...listeners].map(listener => listener.intervalMs)) : 16;
    if (enabled === observationRequested && interval === observationInterval) return;
    if (enabled !== observationRequested) fenceEvents();
    observationRequested = enabled; observationInterval = interval;
    void request('observe', [enabled,eventEpoch,observationInterval]).catch(error => {
      if (!disposed && listeners.size && error.name !== 'AbortError') dispatch([{type:'overflow',clock:0,droppedWrites:0,message:`SPC observation unavailable: ${error.message}`}]);
    });
  }
  const assertOpen = () => {if (disposed) throw abortError();};
  function request(method, args = [], transfer = []) {
    assertOpen();
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id); reject(new Error('SPC AudioWorklet did not respond')); client.dispose();
      }, TIMEOUT_MS);
      timer.unref?.(); pending.set(id, {resolve, reject, timer, context:captureContext()});
      try {
        const owner = getOwner();
        port.postMessage({method, args, id, spcEventEpoch:eventEpoch, ...(owner ? {spcPerformance:owner} : {})}, transfer);
      }
      catch (error) {clearTimeout(timer); pending.delete(id); reject(error);}
    });
  }
  port.onmessage = ({data}) => {
    if (disposed) return;
    if (data.fatal) {client.dispose(); return;}
    if (data.type === 'spc-events-reset') {
      if (data.epoch === eventEpoch && listeners.size) decoder = createSpcEventDecoder({dsp:data.dsp,startClock:data.clock});
      return;
    }
    if (data.type === 'spc-events-suspended') {if (data.epoch === eventEpoch) decoder = null; return;}
    if (data.type === 'spc-events') {
      try {
        if (data.epoch !== eventEpoch || !listeners.size || !decoder) return;
        if (data.droppedWrites) {
          dispatch([{type:'overflow',clock:data.clock,droppedWrites:data.droppedWrites,message:'SPC event delivery fell behind; chronology was interrupted and DSP state was resynchronized.'}]);
          decoder = createSpcEventDecoder({dsp:data.dsp,startClock:data.clock,includeInitial:false});
        } else dispatch(decoder.pushWrites(data.writes.subarray(0,data.count * 3), data.final ? Infinity : data.clock));
      } catch (error) {
        decoder = null; dispatch([{type:'overflow',clock:data.clock,droppedWrites:data.count,message:`SPC event decoder stopped: ${error.message}`}]);
      } finally {
        try {port.postMessage({method:'eventAck',args:[data.epoch,data.sequence,data.writes.buffer]}, [data.writes.buffer]);} catch {}
      }
      return;
    }
    const task = pending.get(data.id); if (!task) return;
    clearTimeout(task.timer); pending.delete(data.id);
    restoreContext(task.context);
    if (data.error) {const error = new Error(data.error); if (data.name) error.name = data.name; task.reject(error);}
    else task.resolve(data.value);
  };
  port.onmessageerror = () => client.dispose(); port.start?.();
  const client = {
    sampleRate: initial.sampleRate ?? 48000,
    nativeSampleRate: 32000,
    async loadSPC(input) {
      assertOpen();
      const bytes = input instanceof Uint8Array ? input.slice()
        : input instanceof ArrayBuffer ? new Uint8Array(input.slice(0)) : null;
      if (!bytes) throw new TypeError('SPC data must be a Uint8Array or ArrayBuffer');
      if (bytes.length < 0x10180 || bytes.length > 16 * 1024 * 1024) throw new RangeError('Invalid SPC file size');
      const token = ++loadToken; ++seekToken; seekResume = undefined;
      fenceEvents();
      const state = await request('loadSPC', [bytes], [bytes.buffer]);
      assertOpen(); if (token !== loadToken) throw abortError(); return state;
    },
    play() {++seekToken; seekResume = undefined; return request('play');},
    pause() {++seekToken; seekResume = undefined; return request('pause');},
    stop() {++loadToken; ++seekToken; seekResume = undefined; fenceEvents(); return request('stop');},
    /** Observe semantic DSP events on the caller's Main/logic Worker thread.
     * Overload always emits an overflow diagnostic even when types are filtered.
     * @param {(event:any)=>void} callback
     * @param {{voices?:number[],types?:string[],intervalMs?:number}} [options]
     * @returns {()=>void} */
    onEvent(callback, {voices,types,intervalMs = 16} = {}) {
      assertOpen(); if (typeof callback !== 'function') throw new TypeError('SPC event callback must be a function');
      if (listeners.size >= 32) throw new RangeError('SPC supports at most 32 event subscriptions');
      if (voices !== undefined && (!Array.isArray(voices) || voices.some(voice => !Number.isInteger(voice) || voice < 0 || voice > 7))) throw new RangeError('SPC event voices must be integers from 0 to 7');
      if (types !== undefined && (!Array.isArray(types) || types.some(type => !['noteOn','noteOff','pitch','volume','instrument','dsp'].includes(type)))) throw new TypeError('Unknown SPC event type');
      if (!Number.isFinite(intervalMs) || intervalMs < 16 || intervalMs > 1000) throw new RangeError('SPC event intervalMs must be between 16 and 1000');
      const listener = {callback,voices:voices ? new Set(voices) : null,types:types ? new Set(types) : null,intervalMs,context:captureContext()};
      listeners.add(listener); configureObservation(); let active = true;
      return () => {if (!active) return; active = false; listeners.delete(listener); if (!disposed) configureObservation();};
    },
    getState() {return request('getState');},
    snapshot() {return request('snapshot');},
    setMuteMask(mask) {
      if (!Number.isInteger(mask) || mask < 0 || mask > 255) throw new RangeError('SPC mute mask must be 0..255');
      return request('setMuteMask', [mask]);
    },
    async seek(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) throw new RangeError('SPC seek seconds must be between 0 and 3600');
      const token = ++seekToken, seekId = `seek:${token}`;
      fenceEvents();
      const check = () => {assertOpen(); if (token !== seekToken) throw abortError();};
      try {
        const prior = await request('getState'); check();
        const resume = seekResume ?? prior.playing;
        seekResume = resume;
        await request('seekBegin', [seekId]); check();
        const target = Math.floor(seconds * 32000);
        for (let consumed = 0; consumed < target;) {
          const count = Math.min(16000, target - consumed);
          await request('seekStep', [seekId, count]); check(); consumed += count;
        }
        const state = await request('seekEnd', [seekId, resume]); check();
        return state;
      } finally {
        if (token === seekToken) seekResume = undefined;
      }
    },
    dispose() {
      if (disposed) return; disposed = true; ++loadToken; ++seekToken; seekResume = undefined;
      fenceEvents(); listeners.clear();
      try {port.postMessage({method: 'dispose', args: []});} catch {}
      for (const task of pending.values()) {clearTimeout(task.timer); task.reject(abortError());}
      pending.clear(); port.onmessage = null; port.onmessageerror = null; port.close();
    },
  };
  return client;
}
