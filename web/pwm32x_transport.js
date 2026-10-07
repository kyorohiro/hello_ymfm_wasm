import {PWM32X} from './pwm32x.js';
import {PWM32XPlayback} from './pwm32x_playback.js';

/** Main-side command API; chip rendering and the schedule live in AudioWorklet. */
export class PWM32XWorkletTransport {
  /** @param {import("./soundchip_worklet.js").WorkletSoundChip} chip */
  constructor(chip) {
    if (chip.execution !== 'worklet' || chip.name !== 'pwm') throw new TypeError('Expected a PWM worklet endpoint');
    this.chip = chip;
    for (const method of ['write', 'writeRegister', 'read', 'reset', 'scheduleWrites', 'clearSchedule', 'getState']) this[method] = this[method].bind(this);
  }
  /** @param {number} register @param {number} value @returns {Promise<void>} */
  write(register, value) {return /** @type {Promise<void>} */ (this.chip.request('write', [register, value]));}
  /** @param {number} register @param {number} value @returns {Promise<void>} */
  writeRegister(register, value) {return /** @type {Promise<void>} */ (this.chip.request('writeRegister', [register, value]));}
  /** @param {number} register @returns {Promise<number>} */
  read(register) {return /** @type {Promise<number>} */ (this.chip.request('read', [register]));}
  /** @returns {Promise<void>} */
  reset() {return /** @type {Promise<void>} */ (this.chip.request('reset'));}
  /** @param {import('./pwm32x_playback.js').PWMWrite[]} entries @returns {Promise<number>} */
  scheduleWrites(entries) {return /** @type {Promise<number>} */ (this.chip.request('scheduleWrites', [entries]));}
  /** @returns {Promise<void>} */
  clearSchedule() {return /** @type {Promise<void>} */ (this.chip.request('clearSchedule'));}
  /** @returns {Promise<ReturnType<PWM32XPlayback['getState']>>} */
  getState() {return /** @type {Promise<ReturnType<PWM32XPlayback['getState']>>} */ (this.chip.request('getState'));}
  start() {return this.chip.start();}
  stop() {return this.chip.stop();}
  flush() {return this.chip.request('barrier');}
  close() {return this.chip.dispose();}
}

/** Explicit PCM rendering for WAV export or a consumer-owned output. */
export class PWM32XDirectTransport {
  /** @param {PWM32X | PWM32XPlayback} chip */
  constructor(chip) {
    if (chip instanceof PWM32X) chip = new PWM32XPlayback({}, chip);
    if (!(chip instanceof PWM32XPlayback)) throw new TypeError('Expected a PWM chip');
    this.chip = chip;
  }
  /** @param {number} register @param {number} value */
  write(register, value) {this.chip.write(register, value);}
  /** @param {number} register @param {number} value */
  writeRegister(register, value) {this.chip.writeRegister(register, value);}
  /** @param {number} register */
  read(register) {return this.chip.read(register);}
  reset() {this.chip.reset();}
  /** @param {import('./pwm32x_playback.js').PWMWrite[]} entries */
  scheduleWrites(entries) {return this.chip.scheduleWrites(entries);}
  clearSchedule() {this.chip.clearSchedule();}
  getState() {return this.chip.getState();}
  /** @param {number} frames */
  generateStereo(frames) {return this.chip.generateStereo(frames);}
}
