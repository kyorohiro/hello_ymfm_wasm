/** Full SPC file playback, independent of musical BPM and Worker lookahead. */
const abortError = () => new DOMException('SPC player disposed or operation cancelled', 'AbortError');
const TIMEOUT_MS = 15000;
export function createSpcClient(port, initial = {}, {
  getOwner = () => null, captureContext = () => null, restoreContext = () => {},
} = {}) {
  let disposed = false, sequence = 0, loadToken = 0, seekToken = 0;
  let seekResume;
  const pending = new Map();
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
        port.postMessage({method, args, id, ...(owner ? {spcPerformance:owner} : {})}, transfer);
      }
      catch (error) {clearTimeout(timer); pending.delete(id); reject(error);}
    });
  }
  port.onmessage = ({data}) => {
    if (disposed) return;
    if (data.fatal) {client.dispose(); return;}
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
      const state = await request('loadSPC', [bytes], [bytes.buffer]);
      assertOpen(); if (token !== loadToken) throw abortError(); return state;
    },
    play() {++seekToken; seekResume = undefined; return request('play');},
    pause() {++seekToken; seekResume = undefined; return request('pause');},
    stop() {++loadToken; ++seekToken; seekResume = undefined; return request('stop');},
    getState() {return request('getState');},
    snapshot() {return request('snapshot');},
    setMuteMask(mask) {
      if (!Number.isInteger(mask) || mask < 0 || mask > 255) throw new RangeError('SPC mute mask must be 0..255');
      return request('setMuteMask', [mask]);
    },
    async seek(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) throw new RangeError('SPC seek seconds must be between 0 and 3600');
      const token = ++seekToken, seekId = `seek:${token}`;
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
      try {port.postMessage({method: 'dispose', args: []});} catch {}
      for (const task of pending.values()) {clearTimeout(task.timer); task.reject(abortError());}
      pending.clear(); port.onmessage = null; port.onmessageerror = null; port.close();
    },
  };
  return client;
}
