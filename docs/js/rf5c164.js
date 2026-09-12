export const RF5C164_CLOCK = 12500000;
export const RF5C164_SAMPLE_RATE = 44100;

export class Rf5c164 {
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
      sampleRate = RF5C164_SAMPLE_RATE,
      clock = RF5C164_CLOCK,
    } = options;

    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    for (const [name, value] of Object.entries({ sampleRate, clock })) {
      if (!Number.isInteger(value) || value <= 0 || value > 100000000) throw new RangeError(`Invalid ${name}`);
    }
    const module = await moduleFactory(moduleOptions || {});
    const api = {
      create: module.cwrap("rf5c164_create", "number", ["number", "number"]),
      destroy: module.cwrap("rf5c164_destroy", null, ["number"]),
      reset: module.cwrap("rf5c164_reset", null, ["number"]),
      write: module.cwrap("rf5c164_write", null, ["number", "number", "number"]),
      clearMemory: module.cwrap("rf5c164_clear_memory", null, ["number"]),
      writeMemory: module.cwrap("rf5c164_write_memory", null, ["number", "number", "number"]),
      readMemory: module.cwrap("rf5c164_read_memory", "number", ["number", "number"]),
      read: module.cwrap("rf5c164_read", "number", ["number", "number"]),
      bank: module.cwrap("rf5c164_bank", "number", ["number"]),
      load: module.cwrap("rf5c164_load", "number", ["number", "number", "number", "number"]),
      sampleRate: module.cwrap("rf5c164_sample_rate", "number", ["number"]),
      generate: module.cwrap("rf5c164_generate", null, ["number", "number", "number", "number"]),
    };

    const handle = api.create(sampleRate, clock);
    if (!handle) throw new Error("RF5C164 allocation failed");
    return new Rf5c164(module, handle, api);
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

  writeRegister(register, value) {
    this.api.write(this.handle, register, value);
  }

  clearMemory() { this.api.clearMemory(this.handle); }
  readMemory(offset) { return this.api.readMemory(this.handle, offset); }
  read(offset) { return this.api.read(this.handle, offset); }
  writeMemory(offset, value) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 0xfff) throw new RangeError("RF5C164 memory window is 4 KiB");
    this.api.writeMemory(this.handle, offset, value);
  }

  // Absolute RAM access, independent of the currently selected CPU window.
  loadMemory(data, offset = 0) {
    if (!(data instanceof Uint8Array)) throw new TypeError("Expected Uint8Array");
    if (!Number.isInteger(offset) || offset < 0 || offset > 65536 || data.length > 65536 - offset) {
      throw new RangeError("RF5C164 RAM range exceeds 64 KiB");
    }
    if (!data.length) return;
    const ptr = this.module._malloc(data.length);
    if (!ptr) throw new Error("RF5C164 sample allocation failed");
    try {
      this.module.HEAPU8.set(data, ptr);
      if (!this.api.load(this.handle, ptr, offset, data.length)) throw new RangeError("RF5C164 RAM range");
    } finally { this.module._free(ptr); }
  }

  // VGM RF5C RAM blocks start relative to the selected RAM bank.
  loadBankedMemory(data, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 65535) throw new RangeError("RF5C164 banked RAM offset");
    this.loadMemory(data, offset | this.api.bank(this.handle));
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

export async function createRf5c164(moduleFactory, moduleOptions) {
  return Rf5c164.create({ moduleFactory, moduleOptions });
}
