/** Direct Main/logic-Worker client for the Playground DX7 AudioWorklet. */
const REQUEST_TIMEOUT_MS = 15000;

function midiInteger(value, name, maximum = 127) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}.`);
  }
}

function copySysex(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
  throw new TypeError('SysEx data must be an ArrayBuffer or an ArrayBuffer view.');
}

/**
 * The port is owned by this client and may be transferred directly to a logic
 * Worker. Tone uploads are acknowledged before resolving; subsequent commands
 * on this port cannot overtake an upload. This API uses integer MIDI notes.
 * @param {MessagePort} port
 * @param {{sampleRate?:number,internalSampleRate?:number,voices?:Array<{index:number,name:string}>,selectedVoice?:number}} [initial]
 */
export function createDx7Client(port, initial = {}) {
  let voices = (initial.voices ?? []).map(voice => ({...voice}));
  let selectedVoice = initial.selectedVoice ?? -1;
  let disposed = false, failed = null, nextId = 0;
  let client;
  const sampleRate = initial.sampleRate ?? 44100;
  const internalSampleRate = initial.internalSampleRate ?? 44100;
  const pending = new Map();

  function assertUsable() {
    if (disposed) throw new Error('DX7 instance is disposed.');
    if (failed) throw failed;
  }
  function finish(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    port.onmessage = null;
    port.onmessageerror = null;
    port.close();
  }
  function fail(error) {
    if (failed || disposed) return;
    failed = error;
    finish(error);
    // The registry/runtime wrap dispose() to evict cached instances and release
    // mixer routes. Resolve the current method rather than bypassing wrappers.
    client?.dispose();
  }
  function send(method, args = []) {
    assertUsable();
    try { port.postMessage({method, args}); }
    catch (error) { fail(error); throw error; }
  }
  function request(method, args = [], transfer = []) {
    assertUsable();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      // Processor errors outside its own handlers can stop a Worklet before it
      // can send a fatal notification. Bound pending requests in that case too.
      const timer = setTimeout(() => fail(new Error('DX7 AudioWorklet did not respond.')), REQUEST_TIMEOUT_MS);
      timer.unref?.();
      pending.set(id, {resolve, reject, timer});
      try { port.postMessage({method, args, id}, transfer); }
      catch (error) { fail(error); }
    });
  }
  function updateState(state) {
    voices = state.voices.map(voice => ({...voice}));
    selectedVoice = state.selectedVoice;
    return {...state, voices: voices.map(voice => ({...voice}))};
  }
  port.onmessage = ({data}) => {
    if (disposed || failed) return;
    if (data.fatal) { fail(new Error(data.error ?? 'DX7 AudioWorklet failed.')); return; }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.value);
  };
  port.onmessageerror = () => fail(new Error('Could not read a DX7 AudioWorklet message.'));
  port.start();
  client = {
    sampleRate,
    internalSampleRate,
    get voices() { return voices.map(voice => ({...voice})); },
    get selectedVoice() { return selectedVoice; },
    async getState() { return updateState(await request('getState')); },
    async loadSysex(input) {
      assertUsable();
      // Do not detach the caller's file bytes when transferring to the Worklet.
      const bytes = copySysex(input);
      const state = updateState(await request('loadSysex', [bytes], [bytes.buffer]));
      return state.voices;
    },
    selectVoice(index) {
      assertUsable();
      midiInteger(index, 'Voice index', voices.length - 1);
      send('selectVoice', [index]);
      selectedVoice = index;
    },
    noteOn(note, velocity = 100) {
      assertUsable();
      midiInteger(note, 'MIDI note');
      midiInteger(velocity, 'Velocity');
      send('noteOn', [note, velocity]);
    },
    noteOff(note) {
      assertUsable();
      midiInteger(note, 'MIDI note');
      send('noteOff', [note]);
    },
    allNotesOff() { send('allNotesOff'); },
    panic() { send('panic'); },
    dispose() {
      if (disposed) return;
      try { if (!failed) port.postMessage({method: 'dispose'}); }
      finally {
        disposed = true;
        finish(new Error('DX7 instance is disposed.'));
      }
    },
  };
  return client;
}
