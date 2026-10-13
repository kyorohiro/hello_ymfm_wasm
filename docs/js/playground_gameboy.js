import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js';
import {GameboySynth} from './gameboysynth.js';
/** Same immediate, ordered port writes for both raw and high-level APIs. */
/** @param {MessagePort} port */
export function createGameboyClient(port) {
  return attachChipClock(new GameboySynth({transport: {
    writeRegister(offset, value) { port.postMessage({method: 'writeRegister', args: [offset, value]}); },
    reset() { port.postMessage({method: 'reset', args: []}); },
    dispose() { port.postMessage({method: 'dispose', args: []}); port.close(); },
  }}), port, CHIP_CLOCKS.gameboy);
}
