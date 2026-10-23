import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=native-extra-huc6280-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createPerformanceQueue, createPerformanceChipOwnership} from './playground_performance_queue.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {createChipPortReceiver} from "./playground_chip_port.js?v=audio-stability-2";
/**
 * @file ym2203-worklet.js
 * 実行環境: Browser（AudioWorkletGlobalScope）
 * 依存: AudioWorkletProcessor / registerProcessor と MessagePort。
 * AudioContext.audioWorklet.addModule() で読み込む専用エントリーポイント。音源コアの WASM も必要。
 */
import ym2203ModuleFactory from "../generated/ym2203_wasm.js";
import { Ym2203, YM2203_CLOCK } from "./ym2203.js?v=audio-stability-2";

class YM2203Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = null;
    this.auditions = null;
    this.chipRate = sampleRate;
    this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
    this.ssgOwners = new Array(3).fill(null);
    this.performanceOwnership = createPerformanceChipOwnership({
      writeFm: (register, value, port) => this.chip?.writeRegister(register, value, port),
      channelCount: 3,
    });
    this.performanceQueue = createPerformanceQueue({
      apply: (data, reply, _frame, performance) => handle(data, reply, performance),
      onCancelOwner: owner => { this.performanceOwnership.cancel(owner); this.cancelSsgOwner(owner); },
      nowFrame: () => currentFrame, sampleRate,
      prepare: (data, reply) => {
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
      this.observeSsgOwnership(data, performance);
      if(data.type==='clear-auditions')this.opnInspector?.clear();
      if (receiveOpnAuditionCommand(this.auditions, data, reply)) return;
      if (data.type === 'chip-clock') {
        try { if (!this.chip) throw new Error('Chip not ready'); this.clock = validateChipClock(data.clock); this.chipRate = this.chip.sampleRate(this.clock); if (!data.performanceAcknowledged) reply({type:'chip-clock-result',id:data.id}); }
        catch (error) { if (!data.performanceAcknowledged) reply({type:'chip-clock-result',id:data.id,error:error.message}); }
        return;
      }
      if (data.type === "initialize") void this.initialize(data.wasmBinary);
      if (data.type === "write" && this.chip) this.write(data.register, data.value);
      if (data.type === "reset") this.chip?.reset();
    };
    this.port.onmessage = ({data}) => {
      if(data?.type==='chip-inspector'&&receiveChipInspector(data,this.port,this.opnInspector?(action,method,args)=>action==='read'?this.opnInspector.read():this.opnInspector.invoke(method,args):null))return;
      if (this.performanceQueue.receive(data, message => this.port.postMessage(message))) return;
      if (!receiveChipPort(data)) handle(data);
    };
  }

  async initialize(wasmBinary) {
    try {
      this.chip = await Ym2203.create({
        moduleFactory: ym2203ModuleFactory,
        moduleOptions: { wasmBinary: new Uint8Array(wasmBinary) },
      });
      this.auditions = createOpnAuditionGuard(this.chip, 3);
      this.opnInspector = new OpnKeyboardInspector(this.chip,{kind:'ym2203',guard:this.auditions,clock:()=>this.clock??4000000,sampleRate});
      this.chipRate = this.chip.sampleRate(YM2203_CLOCK);
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

  write(register, value) {
    this.chip.writeRegister(register, value, 0);
  }

  observeSsgOwnership(data, performance) {
    if (data.type === 'reset') this.ssgOwners.fill(null);
    if (data.type !== 'write' || (data.port ?? 0) !== 0) return;
    if (data.register >= 8 && data.register <= 10) {
      this.ssgOwners[data.register - 8] = data.value & 31 ? performance?.owner ?? null : null;
    }
  }

  cancelSsgOwner(owner) {
    for (let ch = 0; ch < 3; ch++) if (this.ssgOwners[ch] === owner) {
      this.ssgOwners[ch] = null; this.chip?.writeRegister(8 + ch, 0, 0);
    }
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

registerProcessor("ym2203-processor", YM2203Processor);
