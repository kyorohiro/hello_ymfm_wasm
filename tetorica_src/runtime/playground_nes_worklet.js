import {createNesTimedProcessor} from './nes_timed_processor.js';
import {validateNesOperationState} from './nes_operation_state.js';
import {ChipClockResampler, CHIP_CLOCKS} from './playground_chip_clock.js';
import {NesApuWasm} from './nesapu_wasm.js';
import factory from './generated/nesapu_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {NesVoiceInspector} from './playground_native_voice_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dead = false;this.chip=null;this.dmcSample=null;this.timedFdsConfig=undefined;
    this.performance=createProcessorPerformance({chip:'nes',patternCommandCost:c=>c.method==='applyTimedOperation'?c.writeCost:1,apply:(data,port,frame,metadata)=>{if(data.method==='applyTimedOperation')this.timed.apply(data.operation,port,frame,metadata);else this.apply(data,port,metadata);},immediate:['loadMemory','stopVoices','nesSelectSample'],
      getNesEnableMask:()=>{const s=this.chip?.getState();return s?((s.registers[0x15]&15)|(s.dmcRemaining>0?16:0)):0;},
      releaseNote:channel=>channel===5?{method:'writeRegister',args:[0x4083,(this.inspector?.registers[0x83]??0)|128]}:{method:'setChannelEnabled',args:[channel,false]}});
    this.instanceId='nes:'+Math.random().toString(36).slice(2);
    this.timed=createNesTimedProcessor({performance:this.performance,getState:()=>{const s=this.chip.getState();return validateNesOperationState({...s,clock:this.baseClock*(this.clockResampler?.ratio??1),enabled:(s.registers[0x15]&15)|(s.dmcRemaining>0?16:0),sample:this.dmcSample,...this.timedFdsConfig});},getConfig:()=>({instanceId:this.instanceId,clock:this.baseClock*(this.clockResampler?.ratio??1),engine:'nes-wasm',fds:this.chip?.fdsEnabled===true}),dispatch:(command,port,frame,metadata)=>{const applied=this.performance.applyImmediate({...command,nesTimed:true},port,metadata);if(metadata.fdsState&&command.args[0]>=0x4023)this.timedFdsConfig={fdsGain:metadata.fdsState.fdsGain,fdsMaster:metadata.fdsState.fdsMaster};return applied;},nowFrame:()=>currentFrame,sampleRate});
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
  dispose() { this.timed?.clear();this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close();this.workerRemote?.close(); }
  receive(data, port) {
    if(data?.method==='nesTimed'){this.timed.receive(data,port);return;}
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    if(data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession)this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data, port, metadata) {
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
      if(data.method==='nesSelectSample'){
        const descriptor=data.args?.[0];validateNesOperationState({clock:this.baseClock,registers:Array(144).fill(0),sample:descriptor});
        if(!descriptor||!this.inspector.memoryRanges.some(r=>r.address<=descriptor.address&&r.end>=descriptor.address+descriptor.length))throw new Error('DMC selection requires uploaded memory');
        this.dmcSample={...descriptor};if(data.id!==undefined)port.postMessage({id:data.id,value:true});return;
      }
      const methods = ['reset', 'writeRegister', 'setChannelEnabled', 'loadMemory'];
      if (!methods.includes(data.method)) throw new Error('Unknown NES command');
      if(metadata?.timedOperation&&data.nesTimed&&data.method==='writeRegister'){const ch=data.args[0]===0x4083&&!metadata.preserveOwner&&!(data.args[1]&128)?5:data.args[0]===0x4015&&metadata.nesRetriggerDmc&&(data.args[1]&16)?4:[0x4003,0x4007,0x400b,0x400f].indexOf(data.args[0]);if(ch>=0){const id=this.inspector.auditions.get(ch);if(id){this.inspector.auditions.delete(ch);this.performance.endAudition(ch,'voice-editor:'+id);}}}
      if(['reset','loadMemory'].includes(data.method))this.dmcSample=null;
      if(data.method==='reset'||(!metadata?.timedOperation&&data.method==='writeRegister'&&[0x4080,0x4089].includes(data.args[0])))this.timedFdsConfig=undefined;
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
