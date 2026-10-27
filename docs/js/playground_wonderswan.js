import {attachChipClock} from './playground_chip_clock.js?v=wonderswan-pcm-timeline-1';
import {WonderSwanSynth, WONDERSWAN_CLOCK} from './wonderswansynth.js?v=wonderswan-pcm-timeline-1';
import {prepareWonderSwanTimeline} from './wonderswan_timeline.js?v=wonderswan-pcm-timeline-1';

/** Immediate, ordered register/RAM commands shared by Main and Worker runtimes.
 * This client keeps authored state; it does not read advancing core registers.
 * @param {MessagePort} port @param {{clock?:number}} [options]
 */
export function createWonderSwanClient(port, options = {}, lifecycle = {}) {
  const {clock = WONDERSWAN_CLOCK} = options;
  let disposed = false, controlled, preparedTimeline = null, timelineRevision = 0;
  const check = context => {
    if (disposed || options.native && lifecycle.isStopped?.(context)) throw new Error('WonderSwan disposed or Run stopped');
  };
  const send = (method, args = [], metadata = {}) => { check(lifecycle.captureContext?.()); port.postMessage({method, args, ...metadata}); };
  const synth = new WonderSwanSynth({clock, transport:{
    writeRegister(address, value, channel, controlMask) {
      send('writeRegister', [address, value], {...(channel === undefined ? {} : {channel}), ...(controlMask === undefined ? {} : {controlMask})});
    },
    writeMemory(address, value, channel) { send('writeMemory', [address, value], channel === undefined ? {} : {channel}); },
    reset() { preparedTimeline = null; timelineRevision++; send('reset'); },
    async prepareTimeline(trace) {
      check(lifecycle.captureContext?.());
      const data = prepareWonderSwanTimeline(trace), revision = ++timelineRevision;
      const result = await timelineRequest('prepareTimeline', [data]);
      if (revision !== timelineRevision) throw new DOMException('WonderSwan timeline preparation cancelled', 'AbortError');
      preparedTimeline = data;
      return result;
    },
    playTimeline() {
      check(lifecycle.captureContext?.());
      if (!preparedTimeline) throw new Error('Prepare a WonderSwan timeline before playback');
      return timelineRequest('playTimeline');
    },
    stopTimeline() { return timelineRequest('stopTimeline'); },
    dispose() { if (disposed) return; disposed = true; try { port.postMessage({method:'dispose', args:[]}); } finally { port.close(); } },
  }});
  controlled = attachChipClock(synth, port, clock);
  function timelineRequest(method, args = []) {
    const context = lifecycle.captureContext?.(); check(context);
    const result = controlled._requestControl(method, args).catch(error => {
      if (/stopped|cancelled|replaced|disposed/i.test(error.message)) throw new DOMException(error.message, 'AbortError');
      throw error;
    });
    if (!options.native) return result;
    const resume = callback => new Promise((resolve, reject) => setTimeout(() => {
      try { check(context); lifecycle.restoreContext?.(context); resolve(callback()); } catch (error) { reject(error); }
    }, 0));
    return result.then(value => resume(() => value), error => resume(() => { throw error; }));
  }
  Object.defineProperty(synth, '_stopVoices', {value:() => {
    const state = synth._getState(); state.registers[16] &= 0xf0; synth._adoptState(state);
    return controlled._requestControl('stopVoices');
  }});
  if(options.native){
    const setClock=controlled.setClock.bind(controlled);
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    controlled.setClock=hz=>{const context=lifecycle.captureContext?.();check(context);return setClock(hz).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};
  }
  return controlled;
}

/** Builtin controls borrow the primary device; the runtime owns its lifetime. */
export function createPrimaryWonderSwanApi(raw) {
  const api = {};
  for (const method of Object.getOwnPropertyNames(WonderSwanSynth.prototype)) {
    if (method === 'constructor' || method === 'dispose' || method.startsWith('_')) continue;
    api[method] = (...args) => raw[method](...args);
  }
  api.setClock = (...args) => raw.setClock(...args);
  Object.defineProperties(api, {
    id:{value:'wonderswan', enumerable:true},
    clock:{get:() => raw.clock, enumerable:true},
  });
  return api;
}
