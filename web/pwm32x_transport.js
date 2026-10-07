import {PWM32X} from './pwm32x.js';
import {PWM32XPlayback, PWM_METHODS} from './pwm32x_playback.js';

/** Main-side command API; chip rendering and the schedule live in AudioWorklet. */
export class PWM32XWorkletTransport {
  constructor(chip) {
    if (chip.execution !== 'worklet' || chip.name !== 'pwm') throw new TypeError('Expected a PWM worklet endpoint');
    this.chip = chip;
    for (const method of PWM_METHODS) this[method] = (...args) => chip.request(method, args);
  }
  start() {return this.chip.start();}
  stop() {return this.chip.stop();}
  flush() {return this.chip.request('barrier');}
  close() {return this.chip.dispose();}
}

/** Explicit PCM rendering for WAV export or a consumer-owned output. */
export class PWM32XDirectTransport {
  constructor(chip) {
    if (chip instanceof PWM32X) chip = new PWM32XPlayback({}, chip);
    if (!(chip instanceof PWM32XPlayback)) throw new TypeError('Expected a PWM chip');
    this.chip = chip;
  }
  write(register, value) {this.chip.write(register, value);}
  writeRegister(register, value) {this.chip.writeRegister(register, value);}
  read(register) {return this.chip.read(register);}
  reset() {this.chip.reset();}
  scheduleWrites(entries) {return this.chip.scheduleWrites(entries);}
  clearSchedule() {this.chip.clearSchedule();}
  getState() {return this.chip.getState();}
  generateStereo(frames) {return this.chip.generateStereo(frames);}
}
