import {ChipClockResampler, validateChipClock} from './playground_chip_clock.js?v=audio-stability-2';
import {Huc6280AudioEngine} from './huc6280audioengine.js?v=audio-stability-2';
import {HUC6280_CLOCK} from './huc6280synth.js?v=audio-stability-2';
import factory from '../generated/huc6280_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=sega-modes-1';

class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.chip = null; this.dead = false; this.selectedChannel = 0; this.controls = new Uint8Array(8);
    this.baseClock = options.processorOptions.clock ?? HUC6280_CLOCK;
    this.performance = createProcessorPerformance({chip:'huc6280',
      releaseNote:key => ({method:'keyOff', args:[key]}),
      prepare:(data, port) => {
        if (data.type === 'chip-clock' || data.method === 'clock') {
          try {
            if (!this.chip) throw new Error('HuC6280 not ready');
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
        chip.generateStereo = frames => chip.processFrames(frames);
        this.port.postMessage({ready:true});
      }).catch(error => { this.dispose(); this.port.postMessage({error:error.message}); });
  }
  retireRemote() {
    this.remote?.close(); this.remote = null;
    const session = this.performance.getStats().activeSession;
    if (session) this.receive({type:'performance-stop', session}, this.port);
    else { this.performance.clear(); this.apply({method:'allNotesOff'}, this.port); }
  }
  dispose() { this.performance.clear(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close();this.workerRemote?.close(); }
  receive(data, port = this.port) {
    if (Array.isArray(data)) { for (const command of data) this.receive(command, port); return; }
    const stop = data.type === 'performance-stop' && Number.isSafeInteger(data.session) && data.session > 0 && data.session >= this.performance.getStats().latestSession;
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
    if (!this.chip) return;
    if (data.type === 'clear-scheduled-writes') { this.performance.clear(); return; }
    if (data.method === 'reset') { this.chip.reset(); this.clockResampler?.resetPhase(); this.selectedChannel = 0; this.controls.fill(0); }
    if (data.method === 'writeRegister') this.write(...data.args);
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
    else if (this.chip) { const pcm = this.chip.processFrames(left.length); left.set(pcm.left); right.set(pcm.right); }
    else { left.fill(0); right.fill(0); }
  }
}
registerProcessor('tetorica-huc6280', Processor);
