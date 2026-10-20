import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=msx-modes-2';
import {GameboySynth} from './gameboysynth.js?v=audio-stability-2';
/** Same immediate, ordered port writes for both raw and high-level APIs. */
/** @param {MessagePort} port */
export function createGameboyClient(port) {
  return attachChipClock(new GameboySynth({transport: {
    writeRegister(offset, value) { port.postMessage({method: 'writeRegister', args: [offset, value]}); },
    reset() { port.postMessage({method: 'reset', args: []}); },
    dispose() { port.postMessage({method: 'dispose', args: []}); port.close(); },
  }}), port, CHIP_CLOCKS.gameboy);
}

/** Safe builtin controls borrow the primary device, whose lifetime belongs to the runtime. */
export function createPrimaryGameboyApi(raw) {
  const api = {pulse:raw.pulse, wave:raw.wave, noise:raw.noise};
  for (const method of Object.getOwnPropertyNames(GameboySynth.prototype)) {
    if (method === 'constructor' || method === 'dispose' || method.startsWith('_')) continue;
    api[method] = (...args) => raw[method](...args);
  }
  api.setClock = (...args) => raw.setClock(...args);
  Object.defineProperties(api, {
    id:{value:'gameboy', enumerable:true},
    clock:{get:() => raw.clock, enumerable:true},
  });
  return api;
}
