import {ChipClockResampler, CHIP_CLOCKS, validateChipClock} from './playground_chip_clock.js?v=wonderswan-mode-2';
import {GameboyApu} from './gameboyapu.js?v=audio-stability-2';
import factory from '../generated/gameboy_apu_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=wonderswan-mode-2';
import {GameboyVoiceInspector} from './playground_native_voice_inspector.js?v=wonderswan-mode-2';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=wonderswan-mode-2';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false;
    this.performance=createProcessorPerformance({chip:'gameboy',prepare:(data,port)=>{
      if (data.type === 'chip-clock') {
        try {
          if (!this.chip) throw new Error('Chip not ready');
          validateChipClock(data.clock);
          port.postMessage({type:'chip-clock-result',id:data.id});
          return {...data,id:undefined,performanceAcknowledged:true};
        } catch (error) { port.postMessage({type:'chip-clock-result',id:data.id,error:error.message}); return null; }
      }
      if (data.id === undefined) return data;
      const {id,...command} = data;
      port.postMessage({id,value:true});
      return command;
    },apply:(data,port)=>this.apply(data,port)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if (data.type === 'detach-chip-port') { this.retireRemote(); return; }
      if (data.port) {
        this.retireRemote();
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        const remote = this.remote;
        remote.onmessage = event => { if (this.remote === remote) this.receive(event.data, remote); };
        this.remote.start();
      } else this.receive(data, this.port);
    };
    GameboyApu.create({moduleFactory: factory, moduleOptions: {wasmBinary: options.processorOptions.wasmBinary}, sampleRate})
      .then(chip => {
        if (this.dead) { chip.dispose(); return; }
        this.chip = chip;
        this.inspector=new GameboyVoiceInspector(chip,{clock:()=>CHIP_CLOCKS.gameboy*(this.clockResampler?.ratio??1),sampleRate,
          dispatch:(command,owner)=>this.performance.applyImmediate(command,this.port,{owner}),
          beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
        this.port.postMessage({ready: true});
      }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  retireRemote() {
    this.remote?.close(); this.remote = null;
    const session = this.performance.getStats().activeSession;
    if (session) this.performance.receive({type:'performance-stop',session},this.port);
    else this.performance.clear();
  }
  dispose() { this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close(); }
  receive(data, port=this.port) {
    if (Array.isArray(data)) { for (const command of data) this.receive(command,port); return; }
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    if(data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession)this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data,port) {
    if (data.method === 'dispose') { this.dispose(); return; }
    if (data.method === 'clock' || data.type === 'chip-clock') {
      try {
        if (!this.chip) throw new Error('Chip not ready');
        (this.clockResampler ??= new ChipClockResampler()).setClock(data.clock ?? data.args[0], CHIP_CLOCKS.gameboy);
        if (!data.performanceAcknowledged && data.id !== undefined) port.postMessage({id:data.id});
      } catch (error) { if (!data.performanceAcknowledged && data.id !== undefined) port.postMessage({id:data.id, error:error.message}); }
      return;
    }
    if (!this.chip) return;
    if (data.type === 'clear-scheduled-writes') { this.performance.clear(); return; }
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
