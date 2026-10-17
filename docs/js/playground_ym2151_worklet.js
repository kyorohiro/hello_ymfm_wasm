import {validateChipClock} from './playground_chip_clock.js';
import {Ym2151} from './ym2151.js';
import factory from '../generated/ym2151_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false; this.remainder = 0; this.left = 0; this.right = 0;
    this.performance=createProcessorPerformance({chip:'ym2151',apply:(data,port)=>this.apply(data,port)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if (data.port) {
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        this.remote.onmessage = event => this.receive(event.data, this.remote);
        this.remote.start();
      } else this.receive(data, this.port);
    };
    Ym2151.create({moduleFactory: factory, moduleOptions: {wasmBinary: options.processorOptions.wasmBinary}, sampleRate})
      .then(chip => {
        if (this.dead) { chip.dispose(); return; }
        this.chip = chip; this.rate = chip.sampleRate(); this.port.postMessage({ready: true});
      }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  dispose() { this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close(); }
  receive(data, port=this.port) {
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data,port) {
    if (data.method === 'dispose') { this.dispose(); return; }
    if (data.method === 'clock') {
      try { if (!this.chip) throw new Error('OPM not ready'); this.rate = this.chip.sampleRate(validateChipClock(data.args[0])); port.postMessage({id:data.id}); }
      catch (error) { port.postMessage({id:data.id,error:error.message}); }
      return;
    }
    if (!this.chip) return;
    if (data.method === 'reset') { this.chip.reset(); this.remainder = 0; this.left = this.right = 0; }
    if (data.method === 'writeRegister') { this.chip.write(0, data.args[0]); this.chip.write(1, data.args[1]); }
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if (this.chip) {
      // OPM generates at its native clock/64 rate; convert to the device rate.
      for (let i = 0; i < left.length; i++) {
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
    }
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-ym2151', Processor);
