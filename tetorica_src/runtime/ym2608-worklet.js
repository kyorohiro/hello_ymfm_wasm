import {createYm2608TimedProcessor,observeYm2608TimedChip} from './ym2608_timed_processor.js';
import {OpnKeyboardInspector} from './playground_opn_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {validateChipClock} from './playground_chip_clock.js';
import {createPerformanceQueue, createPerformanceChipOwnership} from './playground_performance_queue.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from './playground_audition_guard.js';
import {createChipPortReceiver} from "./playground_chip_port.js";
/**
 * @file ym2608-worklet.js
 * 実行環境: Browser（AudioWorkletGlobalScope）
 * 依存: AudioWorkletProcessor / registerProcessor と MessagePort。
 * AudioContext.audioWorklet.addModule() で読み込む専用エントリーポイント。音源コアの WASM も必要。
 */
import ym2608ModuleFactory from "./generated/ym2608_wasm.js";
import { Ym2608, YM2608_CLOCK, normalizeYm2608OutputGains, normalizeYm2608SourceGains } from "./ym2608.js";

class YM2608Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = null;
    this.auditions = null;
    this.chipRate = sampleRate;
    this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
    this.outputGains = {fm:1,ssg:1};
    this.sourceGains = {fm:1,ssg:1,rhythm:1,adpcm:1};
    this.sectionOwners = {ssg: new Array(3).fill(null), rhythm: new Array(6).fill(null), adpcm: null};
    this.performanceOwnership = createPerformanceChipOwnership({
      writeFm: (register, value, port) => this.chip?.writeRegister(register, value, port),
      channelCount: 6,
    });
    this.performanceQueue = createPerformanceQueue({
      apply: (data, reply, _frame, performance) => handle(data, reply, performance, _frame),
      onCancelOwner: owner => { this.performanceOwnership.cancel(owner); this.cancelSectionOwner(owner); },
      nowFrame: () => currentFrame, sampleRate,
      patternCommandCost:command=>command.method==='applyTimedOperation'?command.writeCost:1,
      prepare: (data, reply) => {
        if (data.type === 'loadRhythmRom' || data.type === 'loadAdpcmMemory') { handle(data, reply); return null; }
        if (data.type !== 'chip-clock') return data;
        try {
          if (!this.chip) throw new Error('Chip not ready');
          const clock = validateChipClock(data.clock);
          reply?.({type: 'chip-clock-result', id: data.id});
          return {...data, clock, performanceAcknowledged: true};
        } catch (error) { reply?.({type: 'chip-clock-result', id: data.id, error: error.message}); return null; }
      },
    });
    this.instanceId='ym2608:'+Math.random().toString(36).slice(2);
    this.timed=createYm2608TimedProcessor({performance:{...this.performanceQueue,receive:(data,port)=>this.performanceQueue.receive(data,message=>port.postMessage(message))},
      getState:()=>{if(!this.timedChip)throw new Error('YM2608 timed API not ready');return this.timedChip.getState();},
      getConfig:()=>({instanceId:this.instanceId,clock:this.clock??8000000,engine:'ymfm'}),
      dispatch:(data,port,frame,metadata)=>handle(data,m=>port.postMessage(m),metadata),nowFrame:()=>currentFrame,sampleRate});
    const receiveChipPort = createChipPortReceiver((data, reply) => handle(data, reply), undefined, {performanceQueue: this.performanceQueue,receiveControl:(data,reply)=>{if(data?.method==='ym2608Timed')return this.timed.receive(data,{postMessage:reply});if(data?.method==='ym2608Retained'){handle(data,reply);return true;}return false;}});
    const handle = (data, reply = message => this.port.postMessage(message), performance, frame = currentFrame) => {
      if(data.method==='ym2608Timed'){this.timed.receive(data,{postMessage:reply});return;}
      if(data.method==='applyTimedOperation'){this.timed.apply(data.operation,{postMessage:reply},frame,performance);return;}
      if(data.method==='ym2608Retained'){
        const [channel,level]=data.args??[];
        if(Number.isInteger(channel)&&channel>=0&&channel<3&&Number.isInteger(level)&&level>=0&&level<=31&&this.timedChip)this.timedChip.getState().ssgLevels[channel]=level;
        return;
      }
      if(performance?.timedOperation&&data.type==='write'){
        if(!this.performanceOwnership.canApplyTimed(data,performance))return;
        if(data.port===0&&data.register>=8&&data.register<=10&&!(data.value&31)){
          const owner=this.sectionOwners.ssg[data.register-8];
          if(owner!==null&&owner!==performance.owner)return;
        }
        if(this.opnInspector&&!this.opnInspector.writeTimedRegister(data.register,data.value,data.port))return;
        if(!this.opnInspector)this.write(data.port,data.register,data.value);
        this.performanceOwnership.observe(data,performance);this.observeSectionOwnership(data,performance);return;
      }
      this.performanceOwnership.observe(data, performance);
      this.observeSectionOwnership(data, performance);
      if(data.type==='clear-auditions')this.opnInspector?.clear();
      if (receiveOpnAuditionCommand(this.auditions, data, reply)) return;
      if (data.type === 'chip-clock') {
        try { if (!this.chip) throw new Error('Chip not ready'); this.clock = validateChipClock(data.clock); this.chipRate = this.chip.sampleRate(this.clock); if (!data.performanceAcknowledged) reply({type:'chip-clock-result',id:data.id}); }
        catch (error) { if (!data.performanceAcknowledged) reply({type:'chip-clock-result',id:data.id,error:error.message}); }
        return;
      }
      if (data.type === "initialize") void this.initialize(data.wasmBinary, data.rhythmRom);
      if (data.type === 'output-gains') {
        try {
          const gains = normalizeYm2608OutputGains(data.gains,this.outputGains);
          this.chip?.setOutputGains(gains);
          this.outputGains = gains;
        } catch (error) { reply({type:'error',message:String(error.message ?? error)}); }
        return;
      }
      if (data.type === 'source-gains') {
        try {
          const gains = normalizeYm2608SourceGains(data.gains,this.sourceGains);
          this.chip?.setSourceGains(gains);
          this.sourceGains = gains;
        } catch (error) { reply({type:'error',message:String(error.message ?? error)}); }
        return;
      }
      if (data.type === 'loadRhythmRom' || data.type === 'loadAdpcmMemory') {
        const type = data.type === 'loadRhythmRom' ? 'rhythm-rom-loaded' : 'adpcm-memory-loaded';
        try {
          if (!this.chip) throw new Error('YM2608 is not ready');
          if (data.type === 'loadRhythmRom') this.chip.loadAdpcmARom(data.bytes);
          else this.chip.loadAdpcmBMemory(data.bytes, data.address);
          reply({type, id: data.id});
        } catch (error) {
          reply({type, id: data.id, error: String(error.message ?? error)});
        }
        return;
      }
      if (data.type === "write" && this.chip) this.write(data.port, data.register, data.value);
      if (data.type === "reset") this.chip?.reset();
    };
    this.port.onmessage = ({data}) => {
      if(data?.type==='chip-inspector'&&receiveChipInspector(data,this.port,this.opnInspector?(action,method,args)=>action==='read'?this.opnInspector.read():this.opnInspector.invoke(method,args):null))return;
      if (this.performanceQueue.receive(data, message => this.port.postMessage(message))) return;
      if (!receiveChipPort(data)) handle(data);
    };
  }

  async initialize(wasmBinary, rhythmRom) {
    try {
      this.chip = await Ym2608.create({
        moduleFactory: ym2608ModuleFactory,
        moduleOptions: { wasmBinary: new Uint8Array(wasmBinary) },
      });
      this.timedChip=observeYm2608TimedChip(this.chip);
      this.chip.setOutputGains(this.outputGains);
      if (Object.values(this.sourceGains).some(value => value !== 1)) this.chip.setSourceGains(this.sourceGains);
      this.auditions = createOpnAuditionGuard(this.chip, 6);
      this.opnInspector = new OpnKeyboardInspector(this.chip,{kind:'ym2608',guard:this.auditions,clock:()=>this.clock??8000000,sampleRate});
      this.chipRate = this.chip.sampleRate(YM2608_CLOCK);
      this.chip.reserveStereoFrames(Math.ceil(128 * this.chipRate / sampleRate));
      if (rhythmRom) this.chip.loadAdpcmARom(rhythmRom);
      this.port.postMessage({ type: "ready" });
    } catch (error) {
      this.chip?.dispose();
      this.chip = null;
      this.port.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  write(port, register, value) {
    this.chip.writeRegister(register, value, port);
  }

  observeSectionOwnership(data, performance) {
    const owner = performance?.owner ?? null;
    if (data.type === 'reset') { this.sectionOwners.ssg.fill(null); this.sectionOwners.rhythm.fill(null); this.sectionOwners.adpcm = null; }
    if (data.type !== 'write') return;
    const {register, value} = data;
    if ((data.port ?? 0) === 0) {
      if (register >= 8 && register <= 10) this.sectionOwners.ssg[register - 8] = value & 31 ? owner : null;
      if (register === 0x10) for (let ch = 0; ch < 6; ch++) {
        if (value & (1 << ch)) this.sectionOwners.rhythm[ch] = value & 0x80 ? null : owner;
      }
    } else if (data.port === 1 && register === 0) {
      if (value & 0x80) this.sectionOwners.adpcm = owner;
      else if (value & 1) this.sectionOwners.adpcm = null;
    }
  }

  cancelSectionOwner(owner) {
    for (let ch = 0; ch < 3; ch++) if (this.sectionOwners.ssg[ch] === owner) {
      this.sectionOwners.ssg[ch] = null; this.chip?.writeRegister(8 + ch, 0, 0);
    }
    let rhythmMask = 0;
    for (let ch = 0; ch < 6; ch++) if (this.sectionOwners.rhythm[ch] === owner) {
      this.sectionOwners.rhythm[ch] = null; rhythmMask |= 1 << ch;
    }
    if (rhythmMask) this.chip?.writeRegister(0x10, 0x80 | rhythmMask, 0);
    if (this.sectionOwners.adpcm === owner) { this.sectionOwners.adpcm = null; this.chip?.writeRegister(0, 1, 1); }
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.chip) { left.fill(0); right.fill(0); return true; }
    // Render only as far as the next timed register/clock change. The native
    // chip can then generate the whole segment in one call, avoiding tens of
    // thousands of tiny PCM allocations per second on the audio thread.
    if (!this.sampleCounts || this.sampleCounts.length < left.length) this.sampleCounts = new Uint32Array(left.length);
    let frame = 0;
    while (frame < left.length) {
      if (this.performanceQueue.nextFrame() <= currentFrame + frame) this.performanceQueue.advance(currentFrame + frame);
      const end = Math.min(left.length, this.performanceQueue.nextFrame() - currentFrame);
      let samples = 0;
      for (let index = frame; index < end; index++) {
        this.remainder += this.chipRate;
        const count = Math.floor(this.remainder / sampleRate);
        this.remainder -= count * sampleRate;
        this.sampleCounts[index] = count;
        samples += count;
      }
      const pcm = samples ? this.chip.generateStereoView(samples) : null;
      let offset = 0;
      for (; frame < end; frame++) {
        const count = this.sampleCounts[frame];
        if (count) {
          let l = 0, r = 0;
          for (let index = 0; index < count; index++, offset++) { l += pcm.left[offset]; r += pcm.right[offset]; }
          this.lastLeft = l / count; this.lastRight = r / count;
        }
        left[frame] = this.lastLeft; right[frame] = this.lastRight;
      }
    }
    return true;
  }
}

registerProcessor("ym2608-processor", YM2608Processor);
