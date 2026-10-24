import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=y8950-adpcm-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createPerformanceQueue, createPerformanceChipOwnership} from './playground_performance_queue.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {createChipPortReceiver} from "./playground_chip_port.js?v=audio-stability-2";
/**
 * @file ym2610b-worklet.js
 * 実行環境: Browser（AudioWorkletGlobalScope）
 * 依存: AudioWorkletProcessor / registerProcessor と MessagePort。
 * AudioContext.audioWorklet.addModule() で読み込む専用エントリーポイント。音源コアの WASM も必要。
 */
import ym2610bModuleFactory from "../generated/ym2610b_wasm.js";
import { Ym2610B, YM2610B_CLOCK } from "./ym2610b.js?v=audio-stability-2";

class YM2610BProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = null;
    this.auditions = null;
    this.chipRate = sampleRate;
    this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
    this.sectionOwners = {ssg: new Array(3).fill(null), adpcmA: new Array(6).fill(null), adpcmB: null};
    this.performanceOwnership = createPerformanceChipOwnership({
      writeFm: (register, value, port) => this.chip?.writeRegister(register, value, port),
      channelCount: 6,
    });
    this.performanceQueue = createPerformanceQueue({
      apply: (data, reply, _frame, performance) => handle(data, reply, performance),
      onCancelOwner: owner => { this.performanceOwnership.cancel(owner); this.cancelSectionOwner(owner); },
      nowFrame: () => currentFrame, sampleRate,
      prepare: (data, reply) => {
        if (data.type === 'loadAdpcmMemory') { handle(data, reply); return null; }
        if (data.type !== 'chip-clock') return data;
        try {
          if (!this.chip) throw new Error('Chip not ready');
          const clock = validateChipClock(data.clock);
          reply?.({type: 'chip-clock-result', id: data.id});
          return {...data, clock, performanceAcknowledged: true};
        } catch (error) { reply?.({type: 'chip-clock-result', id: data.id, error: error.message}); return null; }
      },
    });
    const receiveChipPort = createChipPortReceiver((data, reply) => handle(data, reply), undefined, {performanceQueue: this.performanceQueue});
    const handle = (data, reply = message => this.port.postMessage(message), performance) => {
      this.performanceOwnership.observe(data, performance);
      this.observeSectionOwnership(data, performance);
      if(data.type==='clear-auditions')this.opnInspector?.clear();
      if (receiveOpnAuditionCommand(this.auditions, data, reply)) return;
      if (data.type === 'chip-clock') {
        try { if (!this.chip) throw new Error('Chip not ready'); this.clock = validateChipClock(data.clock); this.chipRate = this.chip.sampleRate(this.clock); if (!data.performanceAcknowledged) reply({type:'chip-clock-result',id:data.id}); }
        catch (error) { if (!data.performanceAcknowledged) reply({type:'chip-clock-result',id:data.id,error:error.message}); }
        return;
      }
      if (data.type === "initialize") void this.initialize(data.wasmBinary, data.variant);
      if (data.type === 'loadAdpcmMemory') {
        try {
          if (!this.chip) throw new Error('YM2610 is not ready');
          this.chip.loadAdpcmRom(data.memoryType, data.bytes, data.address ?? 0, 0x1000000);
          reply({type: 'adpcm-memory-loaded', id: data.id});
        } catch (error) {
          reply({type: 'adpcm-memory-loaded', id: data.id, error: String(error.message ?? error)});
        }
        return;
      }
      if (data.type === "write" && this.chip) this.chip.writeRegister(data.register, data.value, data.port);
      if (data.type === "reset") this.chip?.reset();
    };
    this.port.onmessage = ({data}) => {
      if(data?.type==='chip-inspector'&&receiveChipInspector(data,this.port,this.opnInspector?(action,method,args)=>action==='read'?this.opnInspector.read():this.opnInspector.invoke(method,args):null))return;
      if (this.performanceQueue.receive(data, message => this.port.postMessage(message))) return;
      if (!receiveChipPort(data)) handle(data);
    };
  }

  async initialize(wasmBinary, variant = true) {
    try {
      this.chip = await Ym2610B.create({ moduleFactory: ym2610bModuleFactory, moduleOptions: { wasmBinary: new Uint8Array(wasmBinary) }, variant });
      this.auditions = createOpnAuditionGuard(this.chip, 6);
      this.opnInspector = new OpnKeyboardInspector(this.chip,{kind:variant?'ym2610b':'ym2610',guard:this.auditions,clock:()=>this.clock??8000000,sampleRate});
      this.chipRate = this.chip.sampleRate(YM2610B_CLOCK);
      this.chip.reserveStereoFrames(Math.ceil(128 * this.chipRate / sampleRate));
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

  observeSectionOwnership(data, performance) {
    const owner = performance?.owner ?? null;
    if (data.type === 'reset') { this.sectionOwners.ssg.fill(null); this.sectionOwners.adpcmA.fill(null); this.sectionOwners.adpcmB = null; }
    if (data.type !== 'write') return;
    const {register, value} = data;
    if ((data.port ?? 0) === 0) {
      if (register >= 8 && register <= 10) this.sectionOwners.ssg[register - 8] = value & 31 ? owner : null;
      if (register === 0x10) {
        if (value & 0x80) this.sectionOwners.adpcmB = owner;
        else if (value & 1) this.sectionOwners.adpcmB = null;
      }
    } else if (data.port === 1 && register === 0) {
      for (let ch = 0; ch < 6; ch++) if (value & (1 << ch)) this.sectionOwners.adpcmA[ch] = value & 0x80 ? null : owner;
    }
  }

  cancelSectionOwner(owner) {
    for (let ch = 0; ch < 3; ch++) if (this.sectionOwners.ssg[ch] === owner) {
      this.sectionOwners.ssg[ch] = null; this.chip?.writeRegister(8 + ch, 0, 0);
    }
    let adpcmAMask = 0;
    for (let ch = 0; ch < 6; ch++) if (this.sectionOwners.adpcmA[ch] === owner) {
      this.sectionOwners.adpcmA[ch] = null; adpcmAMask |= 1 << ch;
    }
    if (adpcmAMask) this.chip?.writeRegister(0, 0x80 | adpcmAMask, 1);
    if (this.sectionOwners.adpcmB === owner) { this.sectionOwners.adpcmB = null; this.chip?.writeRegister(0x10, 1, 0); }
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

registerProcessor("ym2610b-processor", YM2610BProcessor);
