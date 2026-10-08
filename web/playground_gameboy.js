import {GameboySynth} from './gameboysynth.js';
/** Same immediate, ordered port writes for both raw and high-level APIs. */
/** @param {MessagePort} port */
export function createGameboyClient(port) {
  return new GameboySynth({transport: {
    writeRegister(offset, value) { port.postMessage({method: 'writeRegister', args: [offset, value]}); },
    reset() { port.postMessage({method: 'reset', args: []}); },
    dispose() { port.postMessage({method: 'dispose', args: []}); port.close(); },
  }});
}
