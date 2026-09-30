import {Ym2608AudioEngine} from './ym2608audioengine.js';
import factory from '../generated/ym2608_wasm.js';

class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.engine = null; this.dead = false;
    this.port.onmessage = ({data}) => {
      if (data.port) {
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        this.remote.onmessage = event => this.receive(event.data, this.remote);
        this.remote.start();
      } else this.receive(data, this.port);
    };
    const {wasmBinary, rom} = options.processorOptions;
    Ym2608AudioEngine.create({ym2608ModuleFactory: factory, ym2608ModuleOptions: {wasmBinary}, outputSampleRate: sampleRate})
      .then(engine => {
        if (this.dead) { engine.dispose(); return; }
        this.engine = engine;
        const bytes = new Uint8Array(rom);
        if (bytes.length !== 8192) throw new Error('Expected 8192-byte rhythm ROM');
        engine.loadAdpcmARom(bytes);
        this.port.postMessage({ready: true});
      }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  dispose() { this.dead = true; this.engine?.dispose(); this.engine = null; this.remote?.close(); }
  receive(data, port) {
    try {
      if (data.method === 'dispose') { this.dispose(); return; }
      if (!this.engine) throw new Error('YM2608 not ready');
      const args = data.args ?? [];
      switch (data.method) {
        case 'write': this.engine.writeYm2608(...args); break;
        // Synth reset preserves uploaded ADPCM-B memory, like DirectTransport.
        case 'reset': this.engine.ym2608.reset(); break;
        case 'rom':
          if (!(args[0] instanceof Uint8Array) || args[0].length !== 8192) throw new Error('Expected 8192-byte rhythm ROM');
          this.engine.loadAdpcmARom(...args); break;
        case 'clock':
          if (!Number.isInteger(args[0]) || args[0] < 100000 || args[0] > 20000000) throw new Error('Invalid YM2608 clock');
          this.engine._chipSampleRate = this.engine.ym2608.sampleRate(args[0]); break;
        case 'memory': this.engine.loadAdpcmBMemory(...args); break;
        default: throw new Error('Unknown YM2608 method');
      }
      if (data.id) port.postMessage({id: data.id});
    } catch (error) { port.postMessage({id: data.id, error: error.message}); }
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    if (this.engine) this.engine.process(left, right, left.length);
    else { left.fill(0); right.fill(0); }
    return true;
  }
}
registerProcessor('tetorica-ym2608', Processor);
