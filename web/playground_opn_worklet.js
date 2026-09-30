import {Ym2612} from './ym2612.js';
import {Ym2203} from './ym2203.js';
import {Ym2610B} from './ym2610b.js';
import ym2612Factory from './generated/ym2612_wasm.js';
import ym2203Factory from './generated/ym2203_wasm.js';
import ym2610Factory from './generated/ym2610b_wasm.js';

/** One independent WASM chip per processor; shares only the AudioContext clock. */
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chip = null; this.dead = false; this.schedule = null;
    this.remainder = 0; this.left = 0; this.right = 0;
    this.port.onmessage = ({data}) => {
      if (data.port) {
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        this.remote.onmessage = event => this.receive(event.data, this.remote);
        this.remote.start();
      } else this.receive(data, this.port);
    };
    const {name, wasmBinary} = options.processorOptions; this.name = name;
    const [Chip, moduleFactory] = {ym2612: [Ym2612, ym2612Factory], ym2203: [Ym2203, ym2203Factory], ym2610: [Ym2610B, ym2610Factory]}[name];
    Chip.create({moduleFactory, moduleOptions: {wasmBinary}, variant: false}).then(chip => {
      if (this.dead) { chip.dispose(); return; }
      this.chip = chip; this.rate = chip.sampleRate();
      this.port.postMessage({ready: true});
    }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  cancelSchedule() {
    if (this.schedule) this.schedule.port.postMessage({id: this.schedule.id, error: 'Schedule cancelled'});
    this.schedule = null;
  }
  dispose() { this.cancelSchedule(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close(); }
  receive(data, port) {
    try {
      if (data.method === 'dispose') { this.dispose(); return; }
      if (!this.chip) throw new Error('OPN not ready');
      const args = data.args ?? [];
      switch (data.method) {
        case 'write': this.chip.write(args[0] * 2, args[1]); this.chip.write(args[0] * 2 + 1, args[2]); break;
        case 'reset': this.cancelSchedule(); this.chip.reset(); this.remainder = 0; this.left = this.right = 0; break;
        case 'clock':
          if (this.name !== 'ym2203' || !Number.isInteger(args[0]) || args[0] < 100000 || args[0] > 20000000) throw new Error('Invalid YM2203 clock');
          if (this.schedule && this.clock !== args[0]) throw new Error('Cannot change clock during scheduled playback');
          this.clock = args[0]; this.rate = this.chip.sampleRate(args[0]); break;
        case 'schedule': {
          if (this.name !== 'ym2203') throw new Error('Scheduling requires YM2203');
          if (this.schedule) throw new Error('Schedule already playing');
          const [entries, duration] = args;
          if (!Array.isArray(entries) || !Number.isSafeInteger(duration) || duration <= 0) throw new Error('Invalid schedule');
          let previous = 0;
          const events = entries.map(entry => {
            if (!Array.isArray(entry) || entry.length !== 3) throw new Error('Expected [sample, register, value]');
            const [sample, register, value] = entry;
            if (!Number.isSafeInteger(sample) || sample < previous || sample > duration ||
                !Number.isInteger(register) || register < 0 || register > 255 ||
                !Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid scheduled write');
            previous = sample; return [sample, register, value];
          });
          this.schedule = {events, duration, frame: 0, index: 0, id: data.id, port};
          return;
        }
        case 'memory': this.chip.loadAdpcmRom(...args, 0x1000000); break;
        default: throw new Error('Unknown OPN method');
      }
      if (data.id) port.postMessage({id: data.id});
    } catch (error) { port.postMessage({id: data.id, error: error.message}); }
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    if (!this.chip) { left.fill(0); right.fill(0); return true; }
    for (let i = 0; i < left.length; i++) {
      const schedule = this.schedule;
      if (schedule) {
        const position = schedule.frame * 44100 / sampleRate;
        while (schedule.index < schedule.events.length && schedule.events[schedule.index][0] <= position) {
          const [, register, value] = schedule.events[schedule.index++];
          this.chip.write(0, register); this.chip.write(1, value);
        }
        if (position >= schedule.duration) {
          this.schedule = null; schedule.port.postMessage({id: schedule.id});
        } else schedule.frame++;
      }
      this.remainder += this.rate;
      const count = Math.floor(this.remainder / sampleRate);
      this.remainder -= count * sampleRate;
      if (count) {
        const pcm = this.chip.generateStereo(count);
        let l = 0, r = 0;
        for (let j = 0; j < count; j++) { l += pcm.left[j]; r += pcm.right[j]; }
        this.left = l / count; this.right = r / count;
      }
      left[i] = this.left; right[i] = this.right;
    }
    return true;
  }
}
registerProcessor('tetorica-opn', Processor);
