import {validateChipClock} from './playground_chip_clock.js?v=audio-stability-2';
import {Ym2151} from './ym2151.js?v=audio-stability-2';
import factory from '../generated/ym2151_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=sega-modes-1';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false; this.remainder = 0; this.left = 0; this.right = 0;
    this.counts = new Uint32Array(128);
    this.registers = new Uint8Array(256); this.mutedChannels = new Set(); this.silent = false;
    this.performance=createProcessorPerformance({chip:'ym2151',apply:(data,port)=>this.apply(data,port)});
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
        remote.onmessage = event => this.receive(event.data, remote);
        remote.start();
      } else this.receive(data, this.port);
    };
    Ym2151.create({moduleFactory: factory, moduleOptions: {wasmBinary: options.processorOptions.wasmBinary}, sampleRate})
      .then(chip => {
        if (this.dead) { chip.dispose(); return; }
        this.chip = chip; this.rate = chip.sampleRate(); this.port.postMessage({ready: true});
      }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  dispose() { this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close();this.workerRemote?.close(); }
  receive(data, port=this.port) {
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data,port) {
    if (data.method === 'dispose') { this.dispose(); return; }
    if (data.method === 'clock') {
      try { if (!this.chip) throw new Error('OPM not ready'); this.rate = this.chip.sampleRate(validateChipClock(data.args[0])); port.postMessage({id:data.id}); }
      catch (error) { port.postMessage({id:data.id,error:error.message}); }
      return;
    }
    if (!this.chip) return;
    if (data.method === 'reset') { this.chip.reset(); this.remainder = 0; this.left = this.right = 0; this.registers.fill(0);this.mutedChannels.clear();this.silent=true; }
    if (data.method === 'forceKeyOff') this.forceKeyOff(data.args[0]);
    if (data.method === 'allNotesOff') {for(let channel=0;channel<8;channel++)this.forceKeyOff(channel);this.silent=true;}
    if (data.method === 'writeRegister') {
      const [register,value] = data.args;
      this.registers[register]=value;
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
    this.writeRegister(8,channel);this.mutedChannels.add(channel);
    for(let op=0;op<4;op++)this.writeRegister(0x60+op*8+channel,127);
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if (this.chip) {
      // OPM generates at its native clock/64 rate; convert to the device rate.
      // Generate once per event-delimited segment rather than allocating PCM
      // arrays and crossing into WASM for every output sample. Keep the same
      // additions/remainder as the sample loop so source-frame boundaries agree.
      if (this.counts.length < left.length) this.counts = new Uint32Array(left.length);
      let frames = 0;
      for (let i = 0; i < left.length; i++) {
        this.remainder += this.rate;
        const count = Math.floor(this.remainder / sampleRate);
        this.remainder -= count * sampleRate;
        this.counts[i] = count; frames += count;
      }
      const pcm = frames ? this.chip.generateStereo(frames) : null;
      let offset = 0;
      for (let i = 0; i < left.length; i++) {
        const count = this.counts[i];
        if (count) {
          let l = 0, r = 0;
          for (let j = 0; j < count; j++, offset++) { l += pcm.left[offset]; r += pcm.right[offset]; }
          this.left = l / count; this.right = r / count;
        }
        left[i] = this.silent?0:this.left; right[i] = this.silent?0:this.right;
      }
    }
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-ym2151', Processor);
