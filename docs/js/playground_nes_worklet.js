import {ChipClockResampler, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {NesApuWasm} from './nesapu_wasm.js?v=nes-wasm-1';
import factory from '../generated/nesapu_wasm.js?v=nes-wasm-1';
import {createProcessorPerformance} from './playground_performance_processor.js?v=extra-ym2610b-1';
import {NesVoiceInspector} from './playground_native_voice_inspector.js?v=extra-ym2610b-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dead = false;this.chip=null;
    this.performance=createProcessorPerformance({chip:'nes',apply:(data,port)=>this.apply(data,port),immediate:['loadMemory','stopVoices'],
      releaseNote:channel=>channel===5?{method:'writeRegister',args:[0x4083,(this.inspector?.registers[0x83]??0)|128]}:{method:'setChannelEnabled',args:[channel,false]}});
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
    this.baseClock = options.processorOptions.clock ?? CHIP_CLOCKS.nes;
    this.initializing=NesApuWasm.create({sampleRate,clock:this.baseClock,fds:options.processorOptions.fds,
      moduleFactory:factory,moduleOptions:{wasmBinary:options.processorOptions.wasmBinary}}).then(chip=>{
      if(this.dead){chip.dispose();return;}this.chip=chip;
      this.inspector=new NesVoiceInspector(this.chip,{clock:()=>this.baseClock*(this.clockResampler?.ratio??1),sampleRate,
        dispatch:(command,owner)=>this.performance.applyImmediate(command,this.port,{owner}),
        beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
      const read=this.inspector.read.bind(this.inspector);
      this.inspector.read=()=>{
        const value=read(),applied=chip.getState();value.dmc.active=applied.dmcRemaining>0;value.channels[4].active=value.dmc.active;
        if(value.fds){value.fds.active=applied.fdsActive;value.fds.wave=applied.wave;value.fds.modulation.table=applied.modulation;}
        return value;
      };
      this.port.postMessage({ready: true,backend:chip.backend});
    }).catch(error=>{if(this.dead)return;this.port.postMessage({error:error.message});this.dispose();});
  }
  dispose() { this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close();this.workerRemote?.close(); }
  receive(data, port) {
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    if(data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession)this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data, port) {
    if (data.method === 'dispose') { this.dispose(); return; }
    try {
      if (this.dead) throw new Error('NES disposed');if(!this.chip)throw new Error('NES chip is not ready');
      if(data.method==='stopVoices'){
        this.performance.clear();this.inspector.stopVoices();
        if(data.id!==undefined)port.postMessage({id:data.id,value:true});return;
      }
      if (data.method === 'clock') {
        (this.clockResampler ??= new ChipClockResampler()).setClock(data.args[0], this.baseClock ?? this.chip.clock);
        this.chip.reserveStereoFrames(Math.ceil(128*this.clockResampler.ratio));
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
    const pcm = this.chip.generateStereoView(left.length);
    left.set(pcm.left); right.set(pcm.right);
  }
}
registerProcessor('tetorica-nes', Processor);
