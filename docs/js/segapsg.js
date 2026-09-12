export const SEGAPSG_CLOCK = 3579545;
export const SEGAPSG_SAMPLE_RATE = 44100;

export class SegaPSG {
  constructor(module, handle, api) {
    this.module = module;
    this.handle = handle;
    this.api = api;
    this.leftPtr = 0;
    this.rightPtr = 0;
    this.bufferFrames = 0;
  }

  static async create(options = {}) {
    const {
      moduleFactory,
      moduleOptions,
      sampleRate = SEGAPSG_SAMPLE_RATE,
      clock = SEGAPSG_CLOCK,
    } = options;

    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    const module = await moduleFactory(moduleOptions || {});
    const api = {
      create: module.cwrap("segapsg_create", "number", ["number", "number"]),
      destroy: module.cwrap("segapsg_destroy", null, ["number"]),
      reset: module.cwrap("segapsg_reset", null, ["number"]),
      write: module.cwrap("segapsg_write", null, ["number", "number"]),
      sampleRate: module.cwrap("segapsg_sample_rate", "number", ["number"]),
      generate: module.cwrap("segapsg_generate", null, ["number", "number", "number", "number"]),
    };

    const handle = api.create(sampleRate, clock);
    return new SegaPSG(module, handle, api);
  }

  dispose() {
    if (this.leftPtr) {
      this.module._free(this.leftPtr);
      this.leftPtr = 0;
    }
    if (this.rightPtr) {
      this.module._free(this.rightPtr);
      this.rightPtr = 0;
    }
    if (this.handle) {
      this.api.destroy(this.handle);
      this.handle = 0;
    }
  }

  reset() {
    this.api.reset(this.handle);
  }

  write(data) {
    this.api.write(this.handle, data);
  }

  sampleRate() {
    return this.api.sampleRate(this.handle);
  }

  generateStereo(frames) {
    this.#ensureBuffers(frames);
    this.api.generate(this.handle, this.leftPtr, this.rightPtr, frames);

    const leftStart = this.leftPtr >> 2;
    const rightStart = this.rightPtr >> 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(this.module.HEAPF32.subarray(leftStart, leftStart + frames));
    right.set(this.module.HEAPF32.subarray(rightStart, rightStart + frames));
    return { left, right };
  }

  #ensureBuffers(frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) {
      throw new RangeError("Invalid frame count");
    }
    if (frames <= this.bufferFrames) {
      return;
    }

    if (this.leftPtr) {
      this.module._free(this.leftPtr);
    }
    if (this.rightPtr) {
      this.module._free(this.rightPtr);
    }

    const byteLength = frames * Float32Array.BYTES_PER_ELEMENT;
    this.leftPtr = this.module._malloc(byteLength);
    this.rightPtr = this.module._malloc(byteLength);
    this.bufferFrames = frames;
  }
}

export async function createSegaPSG(moduleFactory, moduleOptions) {
  return SegaPSG.create({ moduleFactory, moduleOptions });
}
