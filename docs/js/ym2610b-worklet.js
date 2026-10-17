import {validateChipClock} from './playground_chip_clock.js';
import {createPerformanceQueue, createPerformanceChipOwnership} from './playground_performance_queue.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from './playground_audition_guard.js';
import {createChipPortReceiver} from "./playground_chip_port.js";
/**
 * @file ym2610b-worklet.js
 * 実行環境: Browser（AudioWorkletGlobalScope）
 * 依存: AudioWorkletProcessor / registerProcessor と MessagePort。
 * AudioContext.audioWorklet.addModule() で読み込む専用エントリーポイント。音源コアの WASM も必要。
 */
import ym2610bModuleFactory from "../generated/ym2610b_wasm.js";
import { Ym2610B, YM2610B_CLOCK } from "./ym2610b.js";

class YM2610BProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = null;
    this.auditions = null;
    this.chipRate = sampleRate;
    this.remainder = 0; this.lastLeft = 0; this.lastRight = 0;
    this.performanceOwnership = createPerformanceChipOwnership({
      writeFm: (register, value, port) => this.chip?.writeRegister(register, value, port),
      channelCount: 6,
    });
    this.performanceQueue = createPerformanceQueue({
      apply: (data, reply, _frame, performance) => handle(data, reply, performance),
      onCancelOwner: owner => this.performanceOwnership.cancel(owner),
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
      if (receiveOpnAuditionCommand(this.auditions, data, reply)) return;
      if (data.type === 'chip-clock') {
        try { if (!this.chip) throw new Error('Chip not ready'); this.chipRate = this.chip.sampleRate(validateChipClock(data.clock)); if (!data.performanceAcknowledged) reply({type:'chip-clock-result',id:data.id}); }
        catch (error) { if (!data.performanceAcknowledged) reply({type:'chip-clock-result',id:data.id,error:error.message}); }
        return;
      }
      if (data.type === "initialize") void this.initialize(data.wasmBinary);
      if (data.type === "write" && this.chip) this.chip.writeRegister(data.register, data.value, data.port);
      if (data.type === "reset") this.chip?.reset();
    };
    this.port.onmessage = ({data}) => {
      if (this.performanceQueue.receive(data, message => this.port.postMessage(message))) return;
      if (!receiveChipPort(data)) handle(data);
    };
  }

  async initialize(wasmBinary) {
    try {
      this.chip = await Ym2610B.create({ moduleFactory: ym2610bModuleFactory, moduleOptions: { wasmBinary: new Uint8Array(wasmBinary) } });
      this.auditions = createOpnAuditionGuard(this.chip, 6);
      this.chipRate = this.chip.sampleRate(YM2610B_CLOCK);
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

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.chip) { left.fill(0); right.fill(0); return true; }
    for (let frame = 0; frame < left.length; frame += 1) {
      if (this.performanceQueue.nextFrame() <= currentFrame + frame) this.performanceQueue.advance(currentFrame + frame);
      this.remainder += this.chipRate;
      const count = Math.floor(this.remainder / sampleRate);
      this.remainder -= count * sampleRate;
      if (count) {
      const pcm = this.chip.generateStereo(count);
      let l = 0; let r = 0;
      for (let index = 0; index < count; index += 1) { l += pcm.left[index]; r += pcm.right[index]; }
      this.lastLeft = l / count; this.lastRight = r / count;
      }
      left[frame] = this.lastLeft; right[frame] = this.lastRight;
    }
    return true;
  }
}

registerProcessor("ym2610b-processor", YM2610BProcessor);
