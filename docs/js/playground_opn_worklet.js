import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=y8950-adpcm-1';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Ym2612} from './ym2612.js?v=audio-numeric-bindings-1';
import {Ym2203} from './ym2203.js?v=audio-stability-2';
import {Ym2610B} from './ym2610b.js?v=audio-stability-2';
import ym2612Factory from '../generated/ym2612_wasm.js';
import nukedFactory from '../generated/nuked_opn2_wasm.js';
import {validateYm2612Engine} from './playground_soundchip_options.js?v=y8950-adpcm-1';
import ym2203Factory from '../generated/ym2203_wasm.js';
import ym2610Factory from '../generated/ym2610b_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=y8950-adpcm-1';

/** One independent WASM chip per processor; shares only the AudioContext clock. */
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chip = null; this.dead = false; this.schedule = null;
    this.remainder = 0; this.left = 0; this.right = 0;
    this.counts = new Uint32Array(128);
    this.performance=createProcessorPerformance({chip:()=>this.name,apply:(data,port)=>this.apply(data,port),prepare:(data,port)=>{
      if(data.method==='memory'){this.apply(data,port);return null;}
      // A schedule request resolves at its documented playback completion.
      if(data.id===undefined||data.method==='schedule')return data;
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
    const {name, wasmBinary, engine} = options.processorOptions; this.name = name;
    this.engine = name === 'ym2612' ? validateYm2612Engine(engine) : undefined;
    const [Chip, moduleFactory] = {ym2612: [Ym2612, this.engine === 'nuked' ? nukedFactory : ym2612Factory], ym2203: [Ym2203, ym2203Factory], ym2610: [Ym2610B, ym2610Factory], ym2610b: [Ym2610B, ym2610Factory]}[name];
    Chip.create({moduleFactory, moduleOptions: {wasmBinary}, variant: name === 'ym2610b'}).then(chip => {
      if (this.dead) { chip.dispose(); return; }
      this.chip = chip; this.rate = chip.sampleRate();
      this.auditions=createOpnAuditionGuard(chip,name==='ym2203'?3:6);
      this.opnInspector=new OpnKeyboardInspector(chip,{kind:name,guard:this.auditions,clock:()=>this.clock??(name==='ym2612'?7670454:name==='ym2203'?4000000:8000000),sampleRate});
      chip.reserveStereoFrames(Math.ceil(128 * this.rate / sampleRate));
      this.port.postMessage({ready: true});
    }).catch(error => { this.dispose(); this.port.postMessage({error: error.message}); });
  }
  cancelSchedule() {
    if (this.schedule) this.schedule.port.postMessage({id: this.schedule.id, error: 'Schedule cancelled'});
    this.schedule = null;
  }
  dispose() { this.performance.clear();this.cancelSchedule(); this.dead = true; this.chip?.dispose(); this.chip = null; this.remote?.close(); }
  receive(data, port) {
    if(data?.type==='chip-inspector'&&receiveChipInspector(data,port,this.opnInspector?(action,method,args)=>action==='read'?this.opnInspector.read():this.opnInspector.invoke(method,args):null))return;
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  apply(data,port) {
    try {
      if (data.method === 'dispose') { this.dispose(); return; }
      if (!this.chip) throw new Error('OPN not ready');
      const args = data.args ?? [];
      switch (data.method) {
        case 'write': this.chip.writeRegister(args[1],args[2],args[0]); break;
        case 'clear-auditions': this.opnInspector?.clear(); break;
        case 'reset': this.cancelSchedule(); this.chip.reset(); this.remainder = 0; this.left = this.right = 0; break;
        case 'clock':
          validateChipClock(args[0]);
          this.clock = args[0]; this.rate = this.chip.sampleRate(args[0]); break;
        case 'schedule': {
          if (this.name !== 'ym2203') throw new Error('Scheduling requires YM2203');
          if (this.schedule) throw new Error('Schedule already playing');
          const [entries, duration] = args;
          if (!Array.isArray(entries) || !Number.isSafeInteger(duration) || duration <= 0) throw new Error('Invalid schedule');
          let previous = 0;
          const events = entries.map(entry => {
            if (!Array.isArray(entry) || entry.length !== 3) throw new Error('Expected [sample, register, value]');
            const [sample, register, value] = entry;
            if (!Number.isSafeInteger(sample) || sample < previous || sample > duration ||
                !Number.isInteger(register) || register < 0 || register > 255 ||
                !Number.isInteger(value) || value < 0 || value > 255) throw new Error('Invalid scheduled write');
            previous = sample; return [sample, register, value];
          });
          this.schedule = {events, duration, frame: 0, index: 0, id: data.id, port};
          return;
        }
        case 'memory': this.chip.loadAdpcmRom(...args, 0x1000000); break;
        default: throw new Error('Unknown OPN method');
      }
      if (data.id) port.postMessage({id: data.id});
    } catch (error) { port.postMessage({id: data.id, error: error.message}); }
  }
  process(inputs, outputs) {
    if (this.dead) return false;
    const [left, right] = outputs[0];
    if (!this.chip) { left.fill(0); right.fill(0); return true; }
    this.performance.render(left,right,this.renderSegment);return true;
  }
  renderSegment(left,right) {
    if(!this.chip){left.fill(0);right.fill(0);return;}
    if (this.counts.length < left.length) this.counts = new Uint32Array(left.length);
    let frame = 0;
    while (frame < left.length) {
      let end = left.length;
      const schedule = this.schedule;
      if (schedule) {
        const position = schedule.frame * 44100 / sampleRate;
        while (schedule.index < schedule.events.length && schedule.events[schedule.index][0] <= position) {
          const [, register, value] = schedule.events[schedule.index++];
          this.chip.writeRegister(register,value,0);
        }
        if (position >= schedule.duration) {
          this.schedule = null; schedule.port.postMessage({id: schedule.id});
        } else {
          // Never render ahead of the next VGM write or completion. Compare
          // using the original frame-to-VGM conversion to retain its rounding.
          const next = Math.min(schedule.events[schedule.index]?.[0] ?? Infinity, schedule.duration);
          let count = 1;
          while (frame + count < end && (schedule.frame + count) * 44100 / sampleRate < next) count++;
          end = frame + count;
          schedule.frame += count;
        }
      }
      let samples = 0;
      for (let index = frame; index < end; index++) {
        this.remainder += this.rate;
        const count = Math.floor(this.remainder / sampleRate);
        this.remainder -= count * sampleRate;
        this.counts[index] = count; samples += count;
      }
      const pcm = samples ? this.chip.generateStereoView(samples) : null;
      let offset = 0;
      for (; frame < end; frame++) {
        const count = this.counts[frame];
        if (count) {
          let l = 0, r = 0;
          for (let j = 0; j < count; j++, offset++) { l += pcm.left[offset]; r += pcm.right[offset]; }
          this.left = l / count; this.right = r / count;
        }
        left[frame] = this.left; right[frame] = this.right;
      }
    }
  }
}
registerProcessor('tetorica-opn', Processor);
