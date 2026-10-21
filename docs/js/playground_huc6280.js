import {attachChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Huc6280Synth, HUC6280_CLOCK} from './huc6280synth.js?v=audio-stability-2';

/** Immediate, ordered register commands shared by Main and Worker runtimes.
 * @param {MessagePort} port
 * @param {{clock?:number}} [options] */
export function createHuc6280Client(port, {clock = HUC6280_CLOCK} = {}) {
  const synth = new Huc6280Synth({clock, transport:{
    writeRegister(register, value, channel) { port.postMessage({method:'writeRegister', args:[register, value], channel}); },
    reset() { port.postMessage({method:'reset', args:[]}); },
    dispose() { port.postMessage({method:'dispose', args:[]}); port.close(); },
  }});
  const controlled=attachChipClock(synth,port,clock);
  Object.defineProperty(synth,'_stopVoices',{value:()=>{
    const state=synth._getState();for(const registers of state.registers)registers[4]&=127;
    synth._adoptState(state);return controlled._requestControl('stopVoices');
  }});
  return controlled;
}

/** Builtin controls borrow the primary device; the runtime owns its lifetime. */
export function createPrimaryHuc6280Api(raw) {
  const api = {};
  for (const method of Object.getOwnPropertyNames(Huc6280Synth.prototype)) {
    if (method === 'constructor' || method === 'dispose' || method.startsWith('_')) continue;
    api[method] = (...args) => raw[method](...args);
  }
  api.setClock = (...args) => raw.setClock(...args);
  Object.defineProperties(api, {
    id:{value:'huc6280', enumerable:true},
    clock:{get:() => raw.clock, enumerable:true},
  });
  return api;
}
