import {GameboyApu} from './gameboyapu.js';
import factory from '../generated/gameboy_apu_wasm.js';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false;
    this.port.onmessage = ({data}) => {
      if (data.port) {
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        this.remote.onmessage = event => this.receive(event.data);
        this.remote.start();
      } else this.receive(data);
    };
    GameboyApu.create({moduleFactory: factory, moduleOptions: {wasmBinary: options.processorOptions.wasmBinary}, sampleRate})
      .then(chip => {
        if (this.dead) { chip.dispose(); return; }
        this.chip = chip; this.port.postMessage({ready: true});
      }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  dispose() { this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close(); }
  receive(data) {
    if (data.method === 'dispose') { this.dispose(); return; }
    if (!this.chip) return;
    if (data.method === 'reset') this.chip.reset();
    if (data.method === 'writeRegister') this.chip.writeRegister(...data.args);
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    if (this.chip) { const pcm = this.chip.generateStereo(left.length); left.set(pcm.left); right.set(pcm.right); }
    else { left.fill(0); right.fill(0); }
    return true;
  }
}
registerProcessor('tetorica-gameboy', Processor);
