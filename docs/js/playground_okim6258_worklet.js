import {Oki6258AudioEngine} from './okim6258audioengine.js?v=audio-stability-2';
import {Oki6258Stream, OKIM6258_CLOCK} from './okim6258synth.js?v=audio-stability-2';
import {validateChipClock} from './playground_chip_clock.js?v=audio-stability-2';
import factory from '../generated/okim6258_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=native-modes-3';

class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dead = false;
    this.performance = createProcessorPerformance({chip:'okim6258', apply:(data, port) => this.apply(data, port),
      prepare:(data, port) => {
        if (data.method === 'loadMemory') { this.apply(data, port); return null; }
        if (data.id === undefined) return data;
        const {id, ...command} = data; port.postMessage({id}); return command;
      }});
    this.renderSegment = this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if(data.primaryWorker) {
        this.workerRemote?.close();this.workerRemote=null;
        if(data.port) {
          if(this.dead){data.port.close();return;}
          const remote=this.workerRemote=data.port;
          remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();
        }
        return;
      }
      if (data.type === 'detach-chip-port') { this.retireRemote(); return; }
      if (data.port) {
        this.retireRemote();
        if (this.dead) { data.port.close(); return; }
        const remote = this.remote = data.port;
        remote.onmessage = event => { if (this.remote === remote) this.receive(event.data, remote); };
        remote.start();
      } else this.receive(data, this.port);
    };
    const {clock = OKIM6258_CLOCK, wasmBinary} = options.processorOptions;
    Oki6258AudioEngine.create({moduleFactory:() => factory({wasmBinary}), clock, flags:12, outputSampleRate:sampleRate})
      .then(engine => {
        if (this.dead) { engine.dispose(); return; }
        this.engine = engine; this.stream = new Oki6258Stream(engine, {clock});
        this.port.postMessage({ready:true});
      }).catch(error => { this.dispose(); this.port.postMessage({error:error.message}); });
  }
  retireRemote() {
    this.remote?.close(); this.remote = null; this.performance.clear(); this.stream?.stop();
  }
  dispose() { this.performance.clear(); this.dead = true; this.engine?.dispose(); this.engine = null; this.remote?.close();this.workerRemote?.close(); }
  receive(data, port = this.port) {
    if (Array.isArray(data)) { for (const command of data) this.receive(command, port); return; }
    const previousSession = this.performance.getStats().latestSession;
    if (this.performance.receive(data, port)) {
      if (data.type === 'performance-stop' && data.session >= previousSession) this.stream?.stop();
      return;
    }
    this.apply(data, port);
  }
  apply(data, port) {
    try {
      if (data.method === 'dispose') { this.dispose(); return; }
      if (!this.stream) throw new Error('OKIM6258 not ready');
      const args = data.args ?? [];
      switch (data.method) {
        case 'writeRegister': this.stream.writeRegister(...args); break;
        case 'loadMemory': this.stream.loadMemory(...args); break;
        case 'play': this.stream.play(...args); break;
        case 'stop': case 'keyOff': case 'allNotesOff': this.stream.stop(); break;
        case 'reset': this.stream.reset(); break;
        case 'clock': this.stream.setClock(validateChipClock(args[0])); break;
        default: throw new Error('Unknown OKIM6258 method');
      }
      if (data.id !== undefined) port.postMessage({id:data.id});
    } catch (error) { port.postMessage({id:data.id, error:error.message}); }
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    this.performance.render(left, right, this.renderSegment); return true;
  }
  renderSegment(left, right) {
    if (this.stream) this.stream.process(left, right);
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-okim6258', Processor);
