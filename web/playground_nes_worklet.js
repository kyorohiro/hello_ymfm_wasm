import {ChipClockResampler, CHIP_CLOCKS} from './playground_chip_clock.js';
import {NesApu} from './nesapu.js';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dead = false;
    this.port.onmessage = ({data}) => {
      if (data.port) {
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        this.remote.onmessage = ({data}) => this.receive(data, this.remote);
        this.remote.start();
      } else this.receive(data, this.port);
    };
    try {
      this.baseClock = options.processorOptions.clock ?? CHIP_CLOCKS.nes;
      this.chip = new NesApu({sampleRate, clock: options.processorOptions.clock, fds: options.processorOptions.fds});
      this.port.postMessage({ready: true});
    } catch (error) { this.port.postMessage({error: error.message}); this.dispose(); }
  }
  dispose() { this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close(); }
  receive(data, port) {
    if (data.method === 'dispose') { this.dispose(); return; }
    try {
      if (this.dead) throw new Error('NES disposed');
      if (data.method === 'clock') {
        (this.clockResampler ??= new ChipClockResampler()).setClock(data.args[0], this.baseClock ?? this.chip.clock);
        port.postMessage({id:data.id}); return;
      }
      const methods = ['reset', 'writeRegister', 'setChannelEnabled', 'loadMemory'];
      if (!methods.includes(data.method)) throw new Error('Unknown NES command');
      this.chip[data.method](...(data.args ?? []));
      if (data.method === 'reset') this.clockResampler?.resetPhase();
      if (data.id !== undefined) port.postMessage({id: data.id, value: true});
    } catch (error) { port.postMessage({id: data.id, error: error.message}); }
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    if (this.clockResampler) { this.clockResampler.render(this.chip, left, right); return true; }
    const pcm = this.chip.generateStereo(left.length);
    left.set(pcm.left); right.set(pcm.right);
    return true;
  }
}
registerProcessor('tetorica-nes', Processor);
