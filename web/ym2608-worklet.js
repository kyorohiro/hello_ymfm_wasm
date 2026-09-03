import ym2608ModuleFactory from "./generated/ym2608_wasm.js";
import { Ym2608, YM2608_CLOCK } from "./ym2608.js";

class YM2608Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = null;
    this.chipRate = sampleRate;
    this.remainder = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "initialize") void this.initialize(data.wasmBinary);
      if (data.type === "write" && this.chip) this.write(data.port, data.register, data.value);
      if (data.type === "reset") this.chip?.reset();
    };
  }

  async initialize(wasmBinary) {
    this.chip = await Ym2608.create({
      moduleFactory: ym2608ModuleFactory,
      moduleOptions: { wasmBinary: new Uint8Array(wasmBinary) },
    });
    this.chipRate = this.chip.sampleRate(YM2608_CLOCK);
    this.port.postMessage({ type: "ready" });
  }

  write(port, register, value) {
    this.chip.write(port * 2, register);
    this.chip.write(port * 2 + 1, value);
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

registerProcessor("ym2608-processor", YM2608Processor);
