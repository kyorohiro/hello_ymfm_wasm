import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Ym2151} from './ym2151.js?v=audio-stability-2';
import factory from '../generated/ym2151_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=y8950-adpcm-1';
import {Ym2151VoiceInspector} from './playground_ym2151_inspector.js?v=y8950-adpcm-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false; this.remainder = 0; this.left = 0; this.right = 0;
    this.clock = 3579545;
    this.counts = new Uint32Array(128);
    this.registers = new Uint8Array(256); this.mutedChannels = new Set(); this.silent = false;
    this.auditionStarts=new Map();
    this.performance=createProcessorPerformance({chip:'ym2151',immediate:['stopVoices'],apply:(data,port,frame,metadata)=>this.apply(data,port,frame,metadata)});
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
        remote.onmessage = event => {if(this.remote===remote)this.receive(event.data, remote);};
        remote.start();
      } else this.receive(data, this.port);
    };
    Ym2151.create({moduleFactory: factory, moduleOptions: {wasmBinary: options.processorOptions.wasmBinary}, sampleRate})
      .then(chip => {
        if (this.dead) { chip.dispose(); return; }
        this.chip = chip; this.rate = chip.sampleRate();
        this.inspector=new Ym2151VoiceInspector({clock:()=>this.clock,sampleRate,
          dispatch:(command,owner)=>this.performance.applyImmediate(command,this.port,{owner}),
          beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
        this.port.postMessage({ready: true});
      }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  dispose() { this.performance.clear();this.auditionStarts.clear();this.inspector?.resetAuditions();this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close();this.workerRemote?.close(); }
  receive(data, port=this.port) {
    if(Array.isArray(data)){for(const command of data)this.receive(command,port);return;}
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.inspector?(action,method,args)=>action==='read'?this.inspector.read():this.inspector.invoke(method,args):null))return;
    if((data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession)||data?.method==='stopVoices')this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data,port,frame,metadata) {
    if (data.method === 'dispose') { this.dispose(); return; }
    if (data.method === 'clock') {
      try { if (!this.chip) throw new Error('OPM not ready'); const clock=validateChipClock(data.args[0]);this.rate = this.chip.sampleRate(clock);this.clock=clock;port.postMessage({id:data.id}); }
      catch (error) { port.postMessage({id:data.id,error:error.message}); }
      return;
    }
    if(data.method==='stopVoices'){
      try{
        if(!this.chip)throw new Error('OPM not ready');
        this.inspector?.invoke('auditionAllOff');this.performance.clear();
        for(let channel=0;channel<8;channel++)this.forceKeyOff(channel);this.silent=true;
        if(data.id!==undefined)port.postMessage({id:data.id,value:true});
      }catch(error){if(data.id!==undefined)port.postMessage({id:data.id,error:error.message});}
      return;
    }
    if (!this.chip) return;
    if(data.method==='auditionKeyOn'){
      const [channel,mask]=data.args,owner=metadata?.owner;
      if(this.inspector?.ownsAudition(channel,owner))this.auditionStarts.set(channel,{mask,owner});
      return;
    }
    if (data.method === 'reset') { this.chip.reset();this.auditionStarts.clear();this.inspector?.reset();this.remainder = 0; this.left = this.right = 0; this.registers.fill(0);this.mutedChannels.clear();this.silent=true; }
    if (data.method === 'forceKeyOff') this.forceKeyOff(data.args[0]);
    if (data.method === 'allNotesOff') {for(let channel=0;channel<8;channel++)this.forceKeyOff(channel);this.silent=true;}
    if (data.method === 'writeRegister') {
      const [register,value] = data.args;
      this.registers[register]=value;
      this.inspector?.observeWrite(register,value);
      if(register===8 && (value&0x78)) {
        const channel=value&7;
        if(this.mutedChannels.delete(channel))for(let op=0;op<4;op++)this.writeRegister(0x60+op*8+channel,this.registers[0x60+op*8+channel]);
        this.silent=false;
      }
      this.writeRegister(register, register>=0x60&&register<0x80&&this.mutedChannels.has(register&7)?127:value);
    }
  }
  writeRegister(register,value) {this.chip.write(0,register);this.chip.write(1,value);}
  forceKeyOff(channel) {
    if(!Number.isInteger(channel)||channel<0||channel>7)throw new RangeError('YM2151 channel must be0..7');
    this.auditionStarts.delete(channel);
    this.writeRegister(8,channel);this.mutedChannels.add(channel);
    this.inspector?.observeKeyOff(channel);
    for(let op=0;op<4;op++)this.writeRegister(0x60+op*8+channel,127);
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if(this.chip&&this.auditionStarts.size){
      // ymfm consumes keyon_live only while generating. OFF/ON in one native
      // frame does not retrigger an envelope that has already decayed. Render
      // the first ordinary native interval with the key released, then apply
      // only the current editor lease. No control handler generates/discards PCM.
      const count=Math.min(left.length,Math.max(1,Math.ceil((sampleRate-this.remainder)/this.rate)));
      const generated=this.renderFrames(left,right,0,count);
      if(generated){
        for(const [channel,{mask,owner}]of this.auditionStarts){
          if(this.inspector?.ownsAudition(channel,owner))this.performance.applyImmediate({method:'writeRegister',args:[8,channel|(mask<<3)]},this.port,{owner});
        }
        this.auditionStarts.clear();
      }
      if(count<left.length)this.renderFrames(left,right,count,left.length-count);
      return;
    }
    this.renderFrames(left,right,0,left.length);
  }
  renderFrames(left,right,start,length) {
    if (this.chip) {
      // OPM generates at its native clock/64 rate; convert to the device rate.
      // Generate once per event-delimited segment rather than allocating PCM
      // arrays and crossing into WASM for every output sample. Keep the same
      // additions/remainder as the sample loop so source-frame boundaries agree.
      if (this.counts.length < length) this.counts = new Uint32Array(length);
      let frames = 0;
      for (let i = 0; i < length; i++) {
        this.remainder += this.rate;
        const count = Math.floor(this.remainder / sampleRate);
        this.remainder -= count * sampleRate;
        this.counts[i] = count; frames += count;
      }
      const pcm = frames ? this.chip.generateStereo(frames) : null;
      let offset = 0;
      for (let i = 0; i < length; i++) {
        const count = this.counts[i];
        if (count) {
          let l = 0, r = 0;
          for (let j = 0; j < count; j++, offset++) { l += pcm.left[offset]; r += pcm.right[offset]; }
          this.left = l / count; this.right = r / count;
        }
        left[start+i] = this.silent?0:this.left; right[start+i] = this.silent?0:this.right;
      }
      return frames;
    }
    else { left.fill(0,start,start+length); right.fill(0,start,start+length);return 0; }
  }
}
registerProcessor('tetorica-ym2151', Processor);
