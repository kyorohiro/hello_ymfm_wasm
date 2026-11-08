import {SidSynth, validateSidClock, SID_PAL_CLOCK} from './sidsynth.js';
import {attachChipClock} from './playground_chip_clock.js';

/** @typedef {Omit<SidSynth,'readRegister'> & {
 * readRegister:(register:number)=>Promise<number>,
 * getState:()=>Promise<import('./sidsynth.js').SidState>,
 * _forceKeyOff:(channel:number)=>void,
 * _stopVoices:()=>Promise<any>,
 * _setLifecycle:(hooks:any)=>void,
 * _requestControl:(method:string,args?:any[])=>Promise<any>
 * }} SidClient */

/** Main/Worker authoring client. Only accepted low-level writes cross the port;
 * applied snapshots are adopted without replaying them into the processor.
 * @returns {SidClient} */
export function createSidRegisterClient(send, {clock = SID_PAL_CLOCK, model = '6581', close = () => {}, request, lifecycle = {}} = {}) {
  validateSidClock(clock);
  if (!['6581','8580'].includes(model)) throw new RangeError('SID model must be 6581 or 8580');
  if (model === '8580' && clock !== SID_PAL_CLOCK) throw new RangeError('SID 8580 Preview requires PAL 985248 Hz');
  let disposed = false;
  const api = new SidSynth({clock, model, transport: {
    writeRegister(register, value, channel) { if (disposed) throw new Error('SID client is disposed'); send('writeRegister', [register, value], channel); },
    reset() { if (disposed) throw new Error('SID client is disposed'); send('reset', []); },
  }});
  const state = api._getState.bind(api), adopt = api._adoptState.bind(api), dispose = api.dispose.bind(api);
  const check = context => { if (disposed || lifecycle.isStopped?.(context)) throw new DOMException('SID disposed or Run stopped', 'AbortError'); };
  const control = (method, args = []) => {
    if (disposed) throw new Error('SID client is disposed');
    return request ? request(method, args) : api._requestControl(method, args);
  };
  const ordered = (method, args = []) => {
    const context = lifecycle.captureContext?.(); check(context);
    let pending; try { pending = control(method, args); } catch (error) { pending = Promise.reject(error); }
    const resume = callback => new Promise((resolve, reject) => setTimeout(() => {
      try { check(context); lifecycle.restoreContext?.(context); resolve(callback()); } catch (error) { reject(error); }
    }, 0));
    return Promise.resolve(pending).then(value => resume(() => value), error => resume(() => { throw error; }));
  };
  api.readRegister = register => {
    if (!Number.isInteger(register) || register < 0 || register > 31) throw new RangeError('SID register must be 0..31');
    return ordered('readRegister', [register]);
  };
  api.getState = () => ordered('getState');
  api.setClock = hz => {
    try { validateSidClock(hz); if (hz !== clock) throw new RangeError('Create a new SID instance to change its clock'); }
    catch (error) { return Promise.reject(error); }
    return ordered('clock', [hz]);
  };
  Object.defineProperties(api, {
    _setLifecycle: {value: hooks => { lifecycle = hooks ?? {}; }},
    _forceKeyOff: {value: channel => {
      if (disposed) throw new Error('SID client is disposed');
      if (!Number.isInteger(channel) || channel < 0 || channel > 2) throw new RangeError('SID channel must be 0..2');
      const next = state(); next.registers[channel * 7 + 4] &= 254; adopt(next);
      send('forceKeyOff', [channel], channel);
    }},
    _stopVoices: {value: () => {
      const next = state(); for (let ch = 0; ch < 3; ++ch) next.registers[ch * 7 + 4] &= 254; adopt(next);
      return control('stopVoices');
    }},
  });
  api.dispose = () => { if (disposed) return; disposed = true; try { dispose(); send('dispose', []); } finally { close(); } };
  return api;
}

/** @returns {SidClient} */
export function createSidClient(port, options = {}, lifecycle = {}) {
  const model = options.model ?? '6581';
  const clock = validateSidClock(options.clock ?? SID_PAL_CLOCK);
  const api = createSidRegisterClient((method, args, channel) => port.postMessage({method, args, ...(channel === undefined ? {} : {channel})}),
    {clock, model, close: () => port.close(), lifecycle});
  const setClock = api.setClock.bind(api), client = attachChipClock(api, port, clock);
  client.setClock = setClock;
  if (options.state) api._adoptState(options.state);
  return client;
}
