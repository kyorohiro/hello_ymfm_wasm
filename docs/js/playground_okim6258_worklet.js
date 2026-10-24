import {Oki6258AudioEngine} from './okim6258audioengine.js?v=audio-stability-2';
import {Oki6258Stream, OKIM6258_CLOCK} from './okim6258synth.js?v=extra-ym2610b-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import factory from '../generated/okim6258_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=extra-ym2610b-1';
import {Oki6258VoiceInspector} from './playground_okim6258_inspector.js?v=extra-ym2610b-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';

class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dead = false;
    this.performance = createProcessorPerformance({chip:'okim6258', apply:(data, port) => this.apply(data, port),
      prepare:(data, port) => {
        if(data.method==='stopVoices'){this.apply(data,port);return null;}
        if(this.rejectHeldRequest(data,port))return null;
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
        this.inspector=new Oki6258VoiceInspector(this.stream,{sampleRate,
          dispatch:(command,owner)=>this.performance.applyImmediate(command,this.port,{owner}),
          beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
        this.port.postMessage({ready:true});
      }).catch(error => { this.dispose(); this.port.postMessage({error:error.message}); });
  }
  retireRemote() {
    this.remote?.close(); this.remote = null;this.inspector?.invoke('auditionAllOff');this.performance.clear(); this.stream?.stop();
  }
  dispose() { this.inspector?.resetAudition();this.performance.clear(); this.dead = true; this.engine?.dispose(); this.engine = null; this.remote?.close();this.workerRemote?.close(); }
  rejectHeldRequest(data,port){
    if(!this.inspector?.held()||!['loadMemory','clock'].includes(data.method))return false;
    if(data.id!==undefined)port.postMessage({id:data.id,error:'OKIM6258 is held by a manual audition'});
    return true;
  }
  receive(data, port = this.port) {
    if (Array.isArray(data)) { for (const command of data) this.receive(command, port); return; }
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():action==='loadSample'?this.inspector.loadMemory(...args):this.inspector.invoke(method,args):null))return;
    const previousSession = this.performance.getStats().latestSession;
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=previousSession;
    if(stopping||data.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if(this.rejectHeldRequest(data,port))return;
    if (this.performance.receive(data, port)) {
      if (stopping) this.stream?.stop();
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
        case 'loadMemory': this.inspector.loadMemory(...args); break;
        case 'play': this.stream.play(...args); break;
        case 'stop': case 'keyOff': case 'allNotesOff': this.stream.stop(); break;
        case 'stopVoices': this.inspector.invoke('auditionAllOff');this.performance.clear();this.stream.stop();break;
        case 'setRepeat': this.stream.repeat=!!args[0];break;
        case 'reset': this.inspector.resetAudition();this.stream.reset(); break;
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
    if (this.stream) {this.stream.process(left, right);if(!this.stream.playing)this.inspector?.resetAudition();}
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-okim6258', Processor);
