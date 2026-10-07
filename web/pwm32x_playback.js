import {PWM32X} from './pwm32x.js';

/** MAME-derived PWM plus output-frame scheduling; no timers or audio device. */
export class PWM32XPlayback {
  constructor(options = {}, chip) {
    this.chip = chip ?? new PWM32X({outputMode: 'duty', gain: 1, ...options});
    this.frame = 0; this.queue = []; this.order = 0;
  }
  sampleRate() {return this.chip.sampleRate();}
  write(register, value) {this.chip.writeRegister(register, value);}
  writeRegister(register, value) {this.write(register, value);}
  read(register) {return this.chip.read(register);}
  reset() {this.chip.reset(); this.queue.length = 0;}
  /** Entries are relative to the next output frame when this command is received. */
  scheduleWrites(entries) {
    this.chip.assertOpen();
    if (!Array.isArray(entries) || entries.length + this.queue.length > 1000000) throw new RangeError('Invalid PWM write queue');
    const pending = entries.map(({frame, register, value}) => {
      if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isSafeInteger(this.frame + frame) ||
          !Number.isInteger(register) || register < 0 || register > 4 ||
          !Number.isInteger(value) || value < 0 || value > 65535) throw new RangeError('Invalid PWM scheduled write');
      return {frame: this.frame + frame, register, value};
    });
    for (const entry of pending) this.queue.push({...entry, order: this.order++});
    this.queue.sort((a, b) => a.frame - b.frame || a.order - b.order);
    return this.frame;
  }
  clearSchedule() {this.chip.assertOpen(); this.queue.length = 0;}
  getState() {return {model: 'mame', outputMode: this.chip.outputMode, clock: this.chip.clock,
    sampleRate: this.sampleRate(), currentFrame: this.frame, queuedWrites: this.queue.length};}
  generateStereo(frames) {
    this.chip.assertOpen();
    if (!Number.isSafeInteger(frames) || frames < 0 || frames > 10000000 || !Number.isSafeInteger(this.frame + frames)) throw new RangeError('Invalid PWM render frames');
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let offset = 0, head = 0;
    while (true) {
      while (this.queue[head]?.frame <= this.frame) {
        const entry = this.queue[head++]; this.write(entry.register, entry.value);
      }
      if (offset === frames) break;
      const count = Math.min(frames - offset, (this.queue[head]?.frame ?? Infinity) - this.frame);
      const pcm = this.chip.generateStereo(count);
      left.set(pcm.left, offset); right.set(pcm.right, offset);
      offset += count; this.frame += count;
    }
    if (head) this.queue.splice(0, head);
    return {left, right, sampleRate: this.sampleRate()};
  }
  dispose() {this.queue.length = 0; this.chip.dispose();}
}

export const PWM_METHODS = new Set(['write', 'writeRegister', 'read', 'reset', 'scheduleWrites', 'clearSchedule', 'getState']);

/** Main or logic Worker client; PCM and scheduling stay in the AudioWorklet. */
export function createPWM32XClient(port) {
  let id = 0, disposed = false;
  const pending = new Map();
  port.onmessage = ({data}) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    data.error ? request.reject(new Error(data.error)) : request.resolve(data.value);
  };
  port.start();
  const client = Object.fromEntries([...PWM_METHODS].map(method => [method, (...args) => {
    if (disposed) return Promise.reject(new Error('PWM client disposed'));
    return new Promise((resolve, reject) => {
      const key = ++id; pending.set(key, {resolve, reject});
      try {port.postMessage({method, args, id: key});}
      catch (error) {pending.delete(key); reject(error);}
    });
  }]));
  client.dispose = () => {
    if (disposed) return;
    disposed = true; port.postMessage({method: 'dispose'}); port.close();
    for (const request of pending.values()) request.reject(new Error('PWM client disposed'));
    pending.clear();
  };
  return client;
}
