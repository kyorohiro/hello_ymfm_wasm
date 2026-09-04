export const YM2610B_CLOCK = 8000000;

export class Ym2610B {
  constructor(module, handle, api) {
    this.module = module;
    this.handle = handle;
    this.api = api;
    this.leftPtr = 0;
    this.rightPtr = 0;
    this.bufferFrames = 0;
  }

  static async create({ moduleFactory, moduleOptions } = {}) {
    if (!moduleFactory) throw new Error("moduleFactory is required");
    const module = await moduleFactory(moduleOptions ?? {});
    const api = {
      create: module.cwrap("ym2610b_create", "number", []),
      destroy: module.cwrap("ym2610b_destroy", null, ["number"]),
      reset: module.cwrap("ym2610b_reset", null, ["number"]),
      write: module.cwrap("ym2610b_write", null, ["number", "number", "number"]),
      read: module.cwrap("ym2610b_read", "number", ["number", "number"]),
      readStatus: module.cwrap("ym2610b_read_status", "number", ["number"]),
      readStatusHi: module.cwrap("ym2610b_read_status_hi", "number", ["number"]),
      getIrq: module.cwrap("ym2610b_get_irq", "number", ["number"]),
      sampleRate: module.cwrap("ym2610b_sample_rate", "number", ["number", "number"]),
      generate: module.cwrap("ym2610b_generate", null, ["number", "number", "number", "number"]),
    };
    return new Ym2610B(module, api.create(), api);
  }

  dispose() {
    if (this.leftPtr) this.module._free(this.leftPtr);
    if (this.rightPtr) this.module._free(this.rightPtr);
    this.leftPtr = 0;
    this.rightPtr = 0;
    if (this.handle) this.api.destroy(this.handle);
    this.handle = 0;
  }

  reset() { this.api.reset(this.handle); }
  write(offset, data) { this.api.write(this.handle, offset, data); }
  read(offset) { return this.api.read(this.handle, offset); }
  readStatus() { return this.api.readStatus(this.handle); }
  readStatusHi() { return this.api.readStatusHi(this.handle); }
  getIrq() { return this.api.getIrq(this.handle) !== 0; }
  sampleRate(clock = YM2610B_CLOCK) { return this.api.sampleRate(this.handle, clock); }

  generateStereo(frames) {
    this.#ensureBuffers(frames);
    this.api.generate(this.handle, this.leftPtr, this.rightPtr, frames);
    const leftStart = this.leftPtr >> 2;
    const rightStart = this.rightPtr >> 2;
    return {
      left: Float32Array.from(this.module.HEAPF32.subarray(leftStart, leftStart + frames)),
      right: Float32Array.from(this.module.HEAPF32.subarray(rightStart, rightStart + frames)),
    };
  }

  #ensureBuffers(frames) {
    if (frames <= this.bufferFrames) return;
    if (this.leftPtr) this.module._free(this.leftPtr);
    if (this.rightPtr) this.module._free(this.rightPtr);
    const size = frames * Float32Array.BYTES_PER_ELEMENT;
    this.leftPtr = this.module._malloc(size);
    this.rightPtr = this.module._malloc(size);
    this.bufferFrames = frames;
  }
}

export async function createYm2610B(moduleFactory, moduleOptions) {
  return Ym2610B.create({ moduleFactory, moduleOptions });
}
