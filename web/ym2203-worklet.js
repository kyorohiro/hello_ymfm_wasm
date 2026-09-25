import {createChipPortReceiver} from "./playground_chip_port.js";
/**
 * @file ym2203-worklet.js
 * 実行環境: Browser（AudioWorkletGlobalScope）
 * 依存: AudioWorkletProcessor / registerProcessor と MessagePort。
 * AudioContext.audioWorklet.addModule() で読み込む専用エントリーポイント。音源コアの WASM も必要。
 */
import ym2203ModuleFactory from "./generated/ym2203_wasm.js";
import { Ym2203, YM2203_CLOCK } from "./ym2203.js";

class YM2203Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = null;
    this.chipRate = sampleRate;
    this.remainder = 0;
    const receiveChipPort = createChipPortReceiver(data => handle(data));
    const handle = data => {
      if (data.type === "initialize") void this.initialize(data.wasmBinary);
      if (data.type === "write" && this.chip) this.write(data.register, data.value);
      if (data.type === "reset") this.chip?.reset();
    };
    this.port.onmessage = ({data}) => { if (!receiveChipPort(data)) handle(data); };
  }

  async initialize(wasmBinary) {
    try {
      this.chip = await Ym2203.create({
        moduleFactory: ym2203ModuleFactory,
        moduleOptions: { wasmBinary: new Uint8Array(wasmBinary) },
      });
      this.chipRate = this.chip.sampleRate(YM2203_CLOCK);
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
    this.chip.write(0, register);
    this.chip.write(1, value);
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.chip) { left.fill(0); right.fill(0); return true; }
    for (let frame = 0; frame < left.length; frame += 1) {
      this.remainder += this.chipRate;
      const samples = Math.max(1, Math.floor(this.remainder / sampleRate));
      this.remainder -= samples * sampleRate;
      const pcm = this.chip.generateStereo(samples);
      let mixedLeft = 0, mixedRight = 0;
      for (let index = 0; index < samples; index += 1) { mixedLeft += pcm.left[index]; mixedRight += pcm.right[index]; }
      left[frame] = mixedLeft / samples;
      right[frame] = mixedRight / samples;
    }
    return true;
  }
}

registerProcessor("ym2203-processor", YM2203Processor);
