// BSD-3-Clause host. The chip itself retains its zlib license.
import {SidCore} from '../../js/sid.js';
import {SidTestInstrument} from '../../js/sid_test_instrument.js';

class SidLabProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.instrument = null; this.disposed = false; this.loading = false;
    this.port.onmessage = ({data}) => void this.message(data);
  }
  async message({id, method, args = []}) {
    try {
      if (method === 'dispose') { this.disposed = true; this.instrument?.core.dispose(); this.instrument = null; return; }
      if (this.disposed) throw new Error('SID processor is disposed');
      let value;
      if (method === 'init') {
        if (this.instrument || this.loading) throw new Error('SID processor is already initialized');
        this.loading = true;
        const [wasmBinary, settings] = args;
        const core = await SidCore.create({sampleRate, clockHz: settings.clockHz, wasmBinary});
        if (this.disposed) { core.dispose(); return; }
        this.instrument = new SidTestInstrument(core, settings); this.loading = false;
      } else {
        if (!this.instrument) throw new Error('SID processor is not ready');
        if (!['setSettings', 'playTone', 'playChord', 'release', 'stop', 'getState'].includes(method)) throw new Error('Unknown SID lab method');
        value = method === 'getState' ? this.instrument.core.getState() : this.instrument[method](...args);
      }
      this.port.postMessage({id, value});
    } catch (error) { this.port.postMessage({id, error: error.message}); }
  }
  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (this.disposed) { output?.fill(0); return false; }
    if (!output) return true;
    if (!this.instrument) output.fill(0);
    else {
      try { this.instrument.renderInto(output); }
      catch (error) {
        output.fill(0); this.instrument.core.dispose(); this.instrument = null; this.disposed = true;
        this.port.postMessage({fatal: true, error: error.message}); return false;
      }
    }
    return true;
  }
}
registerProcessor('tetorica-sid-lab', SidLabProcessor);
