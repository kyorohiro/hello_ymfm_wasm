import {ChipClockResampler, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {PsgInspectorState, receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {SegaPSG} from './segapsg.js?v=audio-numeric-bindings-1';
import factory from '../generated/segapsg_wasm.js?v=audio-numeric-bindings-1';
import {createProcessorPerformance} from './playground_performance_processor.js?v=extra-ym2612-nuked-1';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false;
    this.baseClock = options.processorOptions.clock ?? CHIP_CLOCKS.segapsg;
    this.stereoEnabled = options.processorOptions.stereoEnabled ?? true;
    this.performance=createProcessorPerformance({chip:'segapsg',getPsgLatch:()=>this.inspector?.latched,getPsgMode:()=>this.inspector?.mode??0,apply:(data,port)=>this.apply(data,port)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage = ({data}) => {
      if (data.primaryWorker) {
        this.workerRemote?.close(); this.workerRemote = null;
        if (data.port) {
          if (this.dead) {data.port.close(); return;}
          const remote = this.workerRemote = data.port;
          remote.onmessage = event => {if (this.workerRemote === remote) this.receive(event.data, remote);}; remote.start();
        }
        return;
      }
      if (data.type === 'detach-chip-port') {this.retireRemote(); return;}
      if (data.port) {
        this.retireRemote();
        if (this.dead) { data.port.close(); return; }
        this.remote = data.port;
        const remote = this.remote;
        remote.onmessage = event => {if (this.remote === remote) this.receive(event.data, remote);};
        remote.start();
      } else this.receive(data, this.port);
    };
    SegaPSG.create({moduleFactory: factory, moduleOptions: {wasmBinary: options.processorOptions.wasmBinary}, sampleRate, clock:this.baseClock})
      .then(chip => {
        if (this.dead) { chip.dispose(); return; }
        this.chip = chip; chip.reserveStereoFrames(128);
        this.inspector = new PsgInspectorState(chip, {clock:()=>this.baseClock*(this.clockResampler?.ratio??1),sampleRate,
          dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),
          beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)}); this.port.postMessage({ready: true});
      }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  retireRemote() {
    this.remote?.close(); this.remote = null;
    const session = this.performance.getStats().activeSession;
    if (session) this.receive({type:'performance-stop', session}, this.port);
    else this.stopVoices();
  }
  stopVoices(){this.inspector?.resetAuditions();this.performance.clear();this.apply({method:'allNotesOff'},this.port);}
  dispose() { this.inspector?.resetAuditions();this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close(); this.workerRemote?.close(); }
  receive(data, port=this.port) {
    if (Array.isArray(data)) {for (const command of data) this.receive(command, port); return;}
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector ? (action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args) : null))return;
    const stop = data.type === 'performance-stop' && Number.isSafeInteger(data.session) && data.session > 0 && data.session >= this.performance.getStats().latestSession;
    if(stop||data.method==='stopVoices'){this.stopVoices();if(stop)this.performance.receive(data,port);if(data.id!==undefined)port.postMessage({id:data.id,value:true});return;}
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data,port) {
    if (data.method === 'dispose') { this.dispose(); return; }
    if (data.method === 'clock') {
      try {
        if (!this.chip) throw new Error('Chip not ready');
        (this.clockResampler ??= new ChipClockResampler()).setClock(data.args[0], this.baseClock);
        port.postMessage({id:data.id});
      } catch (error) { port.postMessage({id:data.id, error:error.message}); }
      return;
    }
    if (!this.chip) return;
    if (data.method === 'reset') { this.chip.reset(); this.clockResampler?.resetPhase(); }
    if (data.method === 'write') {
      const byte=data.args[0],register=data.psgRegister;
      if(!(byte&128)&&Number.isInteger(register)&&register>=0&&register<8&&register!==this.inspector.latched){
        const low=register&1?byte&15:register===6?this.inspector.mode:this.inspector.periods[register>>1]&15;
        this.chip.write(0x80|(register<<4)|low);
      }
      this.chip.write(byte);
    }
    if (data.method === 'setStereo' && this.stereoEnabled) this.chip.setStereo(...data.args);
    if (data.method === 'allNotesOff') for (let channel = 0; channel < 4; channel++) this.chip.write(0x9f | (channel << 5));
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if (this.chip && this.clockResampler) this.clockResampler.render(this.chip, left, right);
    else if (this.chip) {
      const pcm = this.chip.generateStereoView(left.length);
      for (let frame = 0; frame < left.length; frame++) { left[frame] = pcm.left[frame]; right[frame] = pcm.right[frame]; }
    }
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-segapsg', Processor);
