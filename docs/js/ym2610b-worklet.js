import ym2610bModuleFactory from "./generated/ym2610b_wasm.js";
import { Ym2610B, YM2610B_CLOCK } from "./ym2610b.js";

class YM2610BProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = null;
    this.chipRate = sampleRate;
    this.remainder = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "initialize") void this.initialize(data.wasmBinary);
      if (data.type === "write" && this.chip) this.chip.write(data.port * 2, data.register), this.chip.write(data.port * 2 + 1, data.value);
      if (data.type === "reset") this.chip?.reset();
    };
  }

  async initialize(wasmBinary) {
    this.chip = await Ym2610B.create({ moduleFactory: ym2610bModuleFactory, moduleOptions: { wasmBinary: new Uint8Array(wasmBinary) } });
    this.chipRate = this.chip.sampleRate(YM2610B_CLOCK);
    this.port.postMessage({ type: "ready" });
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.chip) { left.fill(0); right.fill(0); return true; }
    for (let frame = 0; frame < left.length; frame += 1) {
      this.remainder += this.chipRate;
      const count = Math.max(1, Math.floor(this.remainder / sampleRate));
      this.remainder -= count * sampleRate;
      const pcm = this.chip.generateStereo(count);
      let l = 0; let r = 0;
      for (let index = 0; index < count; index += 1) { l += pcm.left[index]; r += pcm.right[index]; }
      left[frame] = l / count;
      right[frame] = r / count;
    }
    return true;
  }
}

registerProcessor("ym2610b-processor", YM2610BProcessor);
