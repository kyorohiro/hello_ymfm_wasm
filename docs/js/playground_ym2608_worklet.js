import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=native-extra-gameboy-1';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Ym2608Timeline} from './playground_ym2608_timeline.js';
import {Ym2608AudioEngine} from './ym2608audioengine.js?v=audio-stability-2';
import factory from '../generated/ym2608_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=audio-numeric-bindings-1';

class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.engine = null; this.dead = false;
    this.performance=createProcessorPerformance({chip:'ym2608',apply:(data,port)=>this.apply(data,port),prepare:(data,port)=>{
      if(['rom','memory','prepareTimeline'].includes(data.method)){this.apply(data,port);return null;}
      if(data.id===undefined||data.method==='playTimeline')return data;
      const {id,...command}=data;port.postMessage({id});return command;
    }});
    this.renderSegment=this.renderSegment.bind(this);
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
        this.auditions=createOpnAuditionGuard(engine.ym2608,6);
        this.opnInspector=new OpnKeyboardInspector(engine.ym2608,{kind:'ym2608',guard:this.auditions,clock:()=>this.clock??8000000,sampleRate});
        engine.writeYm2608=(port,register,value)=>engine.ym2608.writeRegister(register,value,port);
        this.timeline = new Ym2608Timeline(engine, sampleRate);
        const bytes = new Uint8Array(rom);
        if (bytes.length !== 8192) throw new Error('Expected 8192-byte rhythm ROM');
        engine.loadAdpcmARom(bytes);
        this.port.postMessage({ready: true});
      }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  dispose() { this.performance.clear();this.timeline?.dispose(); this.dead = true; this.engine?.dispose(); this.engine = null; this.remote?.close(); }
  receive(data, port) {
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.opnInspector?(action,method,args)=>action==='read'?this.opnInspector.read():this.opnInspector.invoke(method,args):null))return;
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data,port) {
    try {
      if (data.method === 'dispose') { this.dispose(); return; }
      if (!this.engine) throw new Error('YM2608 not ready');
      const args = data.args ?? [];
      switch (data.method) {
        case 'write': this.engine.writeYm2608(...args); break;
        case 'clear-auditions': this.opnInspector?.clear(); break;
        // Synth reset preserves uploaded ADPCM-B memory, like DirectTransport.
        case 'reset': this.timeline.cancel(); this.engine.ym2608.reset(); break;
        case 'rom':
          if (!(args[0] instanceof Uint8Array) || args[0].length !== 8192) throw new Error('Expected 8192-byte rhythm ROM');
          this.engine.loadAdpcmARom(...args); break;
        case 'clock':
          validateChipClock(args[0]);
          this.clock=args[0]; this.engine._chipSampleRate = this.engine.ym2608.sampleRate(args[0]); break;
        case 'prepareTimeline': this.timeline.prepare(...args); break;
        case 'playTimeline': this.timeline.play(error => port.postMessage({id: data.id, ...(error ? {error} : {})})); return;
        case 'memory': this.engine.loadAdpcmBMemory(...args); break;
        default: throw new Error('Unknown YM2608 method');
      }
      if (data.id) port.postMessage({id: data.id});
    } catch (error) { port.postMessage({id: data.id, error: error.message}); }
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if (this.engine) this.timeline.process(left, right);
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-ym2608', Processor);
