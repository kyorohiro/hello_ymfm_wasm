import {ChipClockResampler, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-stability-2';
import {NesApu} from './nesapu.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=sega-modes-1';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dead = false;
    this.performance=createProcessorPerformance({chip:'nes',apply:(data,port)=>this.apply(data,port),immediate:['loadMemory']});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if(data.primaryWorker) {
        this.workerRemote?.close();this.workerRemote=null;
        if(data.port) {
          if(this.dead){data.port.close();return;}
          const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();
        }
        return;
      }
      if (data.port) {
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        const remote=this.remote;
        remote.onmessage = ({data}) => this.receive(data, remote);
        remote.start();
      } else this.receive(data, this.port);
    };
    try {
      this.baseClock = options.processorOptions.clock ?? CHIP_CLOCKS.nes;
      this.chip = new NesApu({sampleRate, clock: options.processorOptions.clock, fds: options.processorOptions.fds});
      this.port.postMessage({ready: true});
    } catch (error) { this.port.postMessage({error: error.message}); this.dispose(); }
  }
  dispose() { this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close();this.workerRemote?.close(); }
  receive(data, port) {
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data, port) {
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
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if(!this.chip){left.fill(0);right.fill(0);return;}
    if (this.clockResampler) { this.clockResampler.render(this.chip, left, right); return; }
    const pcm = this.chip.generateStereo(left.length);
    left.set(pcm.left); right.set(pcm.right);
  }
}
registerProcessor('tetorica-nes', Processor);
