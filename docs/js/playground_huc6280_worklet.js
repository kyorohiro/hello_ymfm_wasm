import {ChipClockResampler, validateChipClock} from './playground_chip_clock.js?v=pokey-mode-1';
import {Huc6280AudioEngine} from './huc6280audioengine.js?v=audio-stability-2';
import {HUC6280_CLOCK} from './huc6280synth.js?v=audio-stability-2';
import factory from '../generated/huc6280_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=pokey-mode-1';
import {Huc6280VoiceInspector} from './playground_huc6280_inspector.js?v=pokey-mode-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=pokey-mode-1';

class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false; this.selectedChannel = 0; this.controls = new Uint8Array(8);
    this.baseClock = options.processorOptions.clock ?? HUC6280_CLOCK;
    this.performance = createProcessorPerformance({chip:'huc6280',
      getHucChannel:()=>this.selectedChannel,
      releaseNote:key => ({method:'keyOff', args:[key]}),
      prepare:(data, port) => {
        if(data.method==='stopVoices'){this.apply(data,port);return null;}
        if (data.type === 'chip-clock' || data.method === 'clock') {
          try {
            if (!this.chip) throw new Error('HuC6280 not ready');
            if(this.inspector?.auditions.size)throw new Error('HuC6280 is held by a manual audition');
            validateChipClock(data.clock ?? data.args[0]);
            if (data.id !== undefined) port.postMessage(data.type === 'chip-clock' ? {type:'chip-clock-result', id:data.id} : {id:data.id, value:true});
            return {...data, id:undefined, performanceAcknowledged:true};
          } catch (error) {
            if (data.id !== undefined) port.postMessage({type:data.type === 'chip-clock' ? 'chip-clock-result' : undefined, id:data.id, error:error.message});
            return null;
          }
        }
        if (data.id === undefined) return data;
        const {id, ...command} = data; port.postMessage({id, value:true}); return command;
      }, apply:(data, port) => this.apply(data, port)});
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
        this.remote = data.port;
        const remote = this.remote;
        remote.onmessage = event => { if (this.remote === remote) this.receive(event.data, remote); };
        remote.start();
      } else this.receive(data, this.port);
    };
    Huc6280AudioEngine.create({moduleFactory:() => factory({wasmBinary:options.processorOptions.wasmBinary}), clock:this.baseClock, outputSampleRate:sampleRate})
      .then(chip => {
        if (this.dead) { chip.dispose(); return; }
        this.chip = chip;
        // The clock resampler consumes generateStereo(); the offline engine's
        // public rendering method is processFrames(). Both use output-frame Hz.
        this.inspector=new Huc6280VoiceInspector({clock:()=>this.baseClock*(this.clockResampler?.ratio??1),sampleRate,
          dispatch:(command,owner,metadata)=>this.performance.applyImmediate(command,this.port,{owner,...metadata}),
          beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
        chip.generateStereo=frames=>{const pcm=chip.processFrames(frames);if(frames)this.inspector.observeRendered();return pcm;};
        this.port.postMessage({ready:true});
      }).catch(error => { this.dispose(); this.port.postMessage({error:error.message}); });
  }
  retireRemote() {
    this.remote?.close(); this.remote = null;
    const session = this.performance.getStats().activeSession;
    if (session) this.receive({type:'performance-stop', session}, this.port);
    else {this.inspector?.invoke('auditionAllOff');this.performance.clear(); this.apply({method:'allNotesOff'}, this.port); }
  }
  dispose() {this.inspector?.resetAuditions();this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close();this.workerRemote?.close(); }
  receive(data, port = this.port) {
    if (Array.isArray(data)) { for (const command of data) this.receive(command, port); return; }
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    const stop = data.type === 'performance-stop' && Number.isSafeInteger(data.session) && data.session > 0 && data.session >= this.performance.getStats().latestSession;
    if(stop||data.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if((data.method==='clock'||data.type==='chip-clock')&&this.inspector?.auditions.size){if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:'HuC6280 is held by a manual audition'});return;}
    if (this.performance.receive(data, port)) {
      if (stop) { this.apply({method:'allNotesOff'}, port); this.performance.clear(); }
      return;
    }
    this.apply(data, port);
  }
  write(register, value) {
    if (register === 0) this.selectedChannel = value & 7;
    if (register === 4) this.controls[this.selectedChannel] = value;
    this.chip.writeHuc6280(register, value);
    this.inspector?.observeWrite(register,value);
  }
  apply(data, port) {
    if (data.method === 'dispose') { this.dispose(); return; }
    if (data.method === 'clock' || data.type === 'chip-clock') {
      try {
        if (!this.chip) throw new Error('HuC6280 not ready');
        (this.clockResampler ??= new ChipClockResampler()).setClock(data.clock ?? data.args[0], this.baseClock);
        if (!data.performanceAcknowledged && data.id !== undefined) port.postMessage(data.type === 'chip-clock' ? {type:'chip-clock-result', id:data.id} : {id:data.id});
      } catch (error) {
        if (!data.performanceAcknowledged && data.id !== undefined) port.postMessage({type:data.type === 'chip-clock' ? 'chip-clock-result' : undefined, id:data.id, error:error.message});
      }
      return;
    }
    if(data.method==='stopVoices'){
      try{
        if(!this.chip)throw new Error('HuC6280 not ready');
        this.inspector?.invoke('auditionAllOff');this.performance.clear();this.apply({method:'allNotesOff'},port);
        if(data.id!==undefined)port.postMessage({id:data.id,value:true});
      }catch(error){if(data.id!==undefined)port.postMessage({id:data.id,error:error.message});}
      return;
    }
    if (!this.chip) return;
    if (data.type === 'clear-scheduled-writes') { this.performance.clear(); return; }
    if (data.method === 'reset') { this.chip.reset();this.inspector?.reset();this.clockResampler?.resetPhase(); this.selectedChannel = 0; this.controls.fill(0); }
    if (data.method === 'writeRegister') {
      const [register,value]=data.args,target=data.channel,previous=this.selectedChannel;
      if(register>=2&&register<=7&&Number.isInteger(target)&&target>=0&&target<=7&&target!==previous){this.write(0,target);this.write(register,value);this.write(0,previous);}
      else this.write(register,value);
    }
    if(data.method==='setWaveform'){
      const [channel,samples]=data.args,previous=this.selectedChannel,control=this.controls[channel],dda=this.inspector.ddaValues[channel];
      this.write(0,channel);this.write(4,(control&63)|64);this.write(4,control&63);
      for(const value of samples)this.write(6,value);
      this.write(4,control);if(control&64)this.write(6,dda);this.write(0,previous);
    }
    if (data.method === 'keyOff') {
      const channel = data.args[0], previous = this.selectedChannel;
      this.write(0, channel); this.write(4, this.controls[channel] & 0x7f); this.write(0, previous);
    }
    if (data.method === 'allNotesOff') {
      const previous = this.selectedChannel;
      for (let channel = 0; channel < 6; channel++) { this.write(0, channel); this.write(4, this.controls[channel] & 0x7f); }
      this.write(0, previous);
    }
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    this.performance.render(left, right, this.renderSegment); return true;
  }
  renderSegment(left, right) {
    if (this.chip && this.clockResampler) this.clockResampler.render(this.chip, left, right);
    else if (this.chip) { const pcm = this.chip.processFrames(left.length);if(left.length)this.inspector?.observeRendered();left.set(pcm.left); right.set(pcm.right); }
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-huc6280', Processor);
