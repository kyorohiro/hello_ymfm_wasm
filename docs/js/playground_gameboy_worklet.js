import {ChipClockResampler, CHIP_CLOCKS} from './playground_chip_clock.js';
import {GameboyApu} from './gameboyapu.js';
import factory from '../generated/gameboy_apu_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false;
    this.performance=createProcessorPerformance({chip:'gameboy',apply:(data,port)=>this.apply(data,port)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if (data.port) {
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        this.remote.onmessage = event => this.receive(event.data, this.remote);
        this.remote.start();
      } else this.receive(data, this.port);
    };
    GameboyApu.create({moduleFactory: factory, moduleOptions: {wasmBinary: options.processorOptions.wasmBinary}, sampleRate})
      .then(chip => {
        if (this.dead) { chip.dispose(); return; }
        this.chip = chip; this.port.postMessage({ready: true});
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
      try {
        if (!this.chip) throw new Error('Chip not ready');
        (this.clockResampler ??= new ChipClockResampler()).setClock(data.args[0], CHIP_CLOCKS.gameboy);
        port.postMessage({id:data.id});
      } catch (error) { port.postMessage({id:data.id, error:error.message}); }
      return;
    }
    if (!this.chip) return;
    if (data.method === 'reset') { this.chip.reset(); this.clockResampler?.resetPhase(); }
    if (data.method === 'writeRegister') this.chip.writeRegister(...data.args);
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if (this.chip && this.clockResampler) this.clockResampler.render(this.chip, left, right);
    else if (this.chip) { const pcm = this.chip.generateStereo(left.length); left.set(pcm.left); right.set(pcm.right); }
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-gameboy', Processor);
