import {SidSynth, validateSidClock, SID_PAL_CLOCK} from './sidsynth.js';
import {attachChipClock} from './playground_chip_clock.js';
import {attachSidTimedClient} from './sid_timed_client.js';

/** @typedef {Omit<SidSynth,'readRegister'> & {
 * readRegister:(register:number)=>Promise<number>,
 * getState:()=>Promise<import('./sidsynth.js').SidState>,
 * _forceKeyOff:(channel:number)=>void,
 * _stopVoices:()=>Promise<any>,
 * _setLifecycle:(hooks:any)=>void,
 * _requestControl:(method:string,args?:any[])=>Promise<any>
 * }} SidRegisterClient
 * @typedef {SidRegisterClient & import('./sid_timed_client.js').SidTimedApi} SidClient */

/** Main/Worker authoring client. Only accepted low-level writes cross the port;
 * applied snapshots are adopted without replaying them into the processor.
 * @returns {SidRegisterClient} */
export function createSidRegisterClient(send, {clock = SID_PAL_CLOCK, model = '6581', close = () => {}, request, lifecycle = {}} = {}) {
  validateSidClock(clock);
  if (!['6581','8580'].includes(model)) throw new RangeError('SID model must be 6581 or 8580');
  if (model === '8580' && clock !== SID_PAL_CLOCK) throw new RangeError('SID 8580 Preview requires PAL 985248 Hz');
  let disposed = false, parameterDepth = 0, writeMasks = null;
  const api = new SidSynth({clock, model, transport: {
    writeRegister(register, value, channel) {
      if (disposed) throw new Error('SID client is disposed');
      // setVoice preserves Gate while editing waveform/Sync/Ring/TEST. Its
      // packed control write must not claim ownership of a scheduled Gate.
      const sidMask=writeMasks?.get(register);
      if(parameterDepth || sidMask!==undefined)send('writeRegister',[register,value],channel,
        {...(parameterDepth?{preserveOwner:true}:{}),...(sidMask===undefined?{}:{sidMask})});
      else send('writeRegister', [register, value], channel);
    },
    reset() { if (disposed) throw new Error('SID client is disposed'); send('reset', []); },
  }});
  const state = api._getState.bind(api), adopt = api._adoptState.bind(api), dispose = api.dispose.bind(api);
  function masked(masks,parameters,invoke) {
    const previous=writeMasks;writeMasks=masks;if(parameters)parameterDepth++;
    try{return invoke();}finally{writeMasks=previous;if(parameters)parameterDepth--;}
  }
  const setVoice = api.setVoice.bind(api), setFilter=api.setFilter.bind(api);
  api.setVoice = (channel,patch) => {
    const masks=new Map(),base=channel*7;
    if(patch&&typeof patch==='object'){
      if('pulseWidth' in patch){masks.set(base+2,255);masks.set(base+3,15);}
      if('attack' in patch||'decay' in patch)masks.set(base+5,('attack' in patch?240:0)|('decay' in patch?15:0));
      if('sustain' in patch||'release' in patch)masks.set(base+6,('sustain' in patch?240:0)|('release' in patch?15:0));
      let control=0;
      for(const[field,mask]of [['waveform',240],['sync',2],['ring',4],['test',8]])if(field in patch)control|=mask;
      if(control)masks.set(base+4,control);
    }
    return masked(masks,true,()=>setVoice(channel,patch));
  };
  api.setFilter = patch => {
    const masks=new Map();
    if(patch&&typeof patch==='object'){
      if('cutoff' in patch){masks.set(21,7);masks.set(22,255);}
      if('resonance' in patch||'routing' in patch)masks.set(23,('resonance' in patch?240:0)|('routing' in patch?7:0));
      let control=0;
      for(const[field,mask]of [['mode',112],['volume',15],['voice3off',128]])if(field in patch)control|=mask;
      if(control)masks.set(24,control);
    }
    return masked(masks,true,()=>setFilter(patch));
  };
  for(const method of ['keyOn','keyOff']){
    const original=api[method].bind(api);
    api[method]=channel=>masked(new Map([[channel*7+4,1]]),false,()=>original(channel));
  }
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
    _sidParameterWrite: {get:()=>parameterDepth>0},
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
  const api = createSidRegisterClient((method, args, channel, metadata) => port.postMessage({method, args, ...(channel === undefined ? {} : {channel}),...metadata}),
    {clock, model, close: () => port.close(), lifecycle});
  const setClock = api.setClock.bind(api), client = attachChipClock(api, port, clock);
  client.setClock = setClock;
  if (options.state) api._adoptState(options.state);
  return attachSidTimedClient(client,options,port);
}
