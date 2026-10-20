/** Direct Main/logic-Worker client for the Playground DX7 AudioWorklet. */
import {validatePreset, validateOperator, validateOperators} from './msfa_dx7/src/preset.js';
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
 * @param {{sampleRate?:number,internalSampleRate?:number,voices?:Array<{index:number,name:string}>,selectedVoice?:number,stateRevision?:number}} [initial]
 */
export function createDx7Client(port, initial = {}) {
  let voices = (initial.voices ?? []).map(voice => ({...voice}));
  let selectedVoice = initial.selectedVoice ?? -1;
  let selectionRevision = 0;
  let pendingSelection = 0, observedSelection = selectedVoice;
  let stateRevision = initial.stateRevision ?? 0;
  const stateListeners=new Set();
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
    stateListeners.clear();
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
  function updateState(state, revision) {
    const incoming=state.stateRevision??stateRevision;
    // Return the command's ordered snapshot while keeping a newer optimistic
    // selectVoice() visible on the client until its following acknowledgement.
    if(incoming>=stateRevision){
      voices = state.voices.map(voice => ({...voice}));
      observedSelection=state.selectedVoice;
      if (revision === selectionRevision) selectedVoice = state.selectedVoice;
      stateRevision=incoming;
    }
    return {...state, voices: state.voices.map(voice => ({...voice}))};
  }
  async function requestState(method, args = [], transfer = []) {
    const revision = selectionRevision;
    return updateState(await request(method, args, transfer), revision);
  }
  port.onmessage = ({data}) => {
    if (disposed || failed) return;
    if (data.fatal) { fail(new Error(data.error ?? 'DX7 AudioWorklet failed.')); return; }
    if(data.type==='dx7-state'){
      if(client._adoptState(data.state)!==false)for(const listener of stateListeners)listener();
      return;
    }
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
    _getState() { return {sampleRate,internalSampleRate,voices:voices.map(voice=>({...voice})),selectedVoice,stateRevision}; },
    _adoptState(state) {
      if (!state || state.sampleRate !== sampleRate || state.internalSampleRate !== internalSampleRate ||
          !Array.isArray(state.voices) || !state.voices.length || state.voices.length > 32 ||
          state.voices.some((voice,index)=>voice?.index!==index||typeof voice.name!=='string') ||
          (state.stateRevision!==undefined&&(!Number.isSafeInteger(state.stateRevision)||state.stateRevision<0)) ||
          !Number.isInteger(state.selectedVoice) || state.selectedVoice < 0 || state.selectedVoice >= state.voices.length) {
        throw new TypeError('Invalid DX7 primary state.');
      }
      if((state.stateRevision??stateRevision)<stateRevision)return false;
      voices=state.voices.map(voice=>({...voice}));observedSelection=state.selectedVoice;
      if(!pendingSelection){selectedVoice=state.selectedVoice;selectionRevision++;}
      stateRevision=state.stateRevision??stateRevision;
    },
    _onStateChange(listener) { stateListeners.add(listener);return ()=>stateListeners.delete(listener); },
    _stopVoices() { return requestState('stopVoices'); },
    async getState() { return requestState('getState'); },
    async loadSysex(input) {
      assertUsable();
      // Do not detach the caller's file bytes when transferring to the Worklet.
      const bytes = copySysex(input);
      const state = await requestState('loadSysex', [bytes], [bytes.buffer]);
      return state.voices;
    },
    /** Replace the selected slot from INIT defaults; retain the other bank voices.
     * @param {import('./msfa_dx7/src/preset.js').DX7Preset} preset */
    async setPreset(preset) {
      assertUsable(); validatePreset(preset);
      await requestState('setPreset', [structuredClone(preset)]);
    },
    /** Patch OP1..6. Level/frequency edits also affect this patch's sounding
     * notes and release tails. Other operator parameters affect future notes.
     * @param {1|2|3|4|5|6} operator
     * @param {import('./msfa_dx7/src/preset.js').DX7OperatorParams} params */
    async setOperator(operator, params) {
      assertUsable(); validateOperator(operator, params);
      await requestState('setOperator', [operator, structuredClone(params)]);
    },
    /** Validate and apply the entire batch atomically.
     * @param {ReadonlyArray<readonly [1|2|3|4|5|6, import('./msfa_dx7/src/preset.js').DX7OperatorParams]>} entries */
    async setOperators(entries) {
      assertUsable(); validateOperators(entries);
      await requestState('setOperators', [structuredClone(entries)]);
    },
    /** Feedback 0..7, applied to this patch's sounding and future notes.
     * @param {number} feedback */
    async setFeedback(feedback) {
      assertUsable(); midiInteger(feedback, 'Feedback', 7);
      await requestState('setFeedback', [feedback]);
    },
    /** A fresh complete object after preceding commands have been applied.
     * @returns {Promise<import('./msfa_dx7/src/preset.js').DX7PresetState>} */
    async getPreset() { return request('getPreset'); },
    /** @param {number} index */
    selectVoice(index) {
      assertUsable();
      midiInteger(index, 'Voice index', voices.length - 1);
      const revision=++selectionRevision;
      pendingSelection=revision;
      selectedVoice = index;
      // Selection remains synchronous to callers. Its private acknowledgement
      // prevents an older cross-port state notification hiding a newer choice.
      requestState('selectVoice',[index]).then(()=>{
        if(pendingSelection===revision){pendingSelection=0;selectedVoice=observedSelection;}
      },()=>{
        if(pendingSelection===revision){pendingSelection=0;selectedVoice=observedSelection;}
      });
    },
    /** @param {number} note @param {number} [velocity] */
    noteOn(note, velocity = 100) {
      assertUsable();
      midiInteger(note, 'MIDI note');
      midiInteger(velocity, 'Velocity');
      send('noteOn', [note, velocity]);
    },
    /** @param {number} note */
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
