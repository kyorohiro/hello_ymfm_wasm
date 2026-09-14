export const Y8950_CLOCK = 3579545;

export class Y8950 {
  constructor(module, handle, api) {
    this.module = module;
    this.handle = handle;
    this.api = api;
    this.hooks = {
      onWrite: undefined,
      onRead: undefined,
      onIrq: undefined,
    };
    this.lastIrqState = undefined;
    this.leftPtr = 0;
    this.rightPtr = 0;
    this.bufferFrames = 0;
    this.sampleMemory = new Uint8Array(0);
  }

  static async create(options = {}) {
    const { moduleFactory, moduleOptions } = options;
    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    const module = await moduleFactory({ ...moduleOptions });
    const api = {
      loadMemory: module.cwrap("y8950_load_memory", "number", ["number", "number", "number", "number", "number"]),
      clearMemory: module.cwrap("y8950_clear_memory", null, ["number"]),
      create: module.cwrap("y8950_create", "number", []),
      destroy: module.cwrap("y8950_destroy", null, ["number"]),
      reset: module.cwrap("y8950_reset", null, ["number"]),
      write: module.cwrap("y8950_write", null, ["number", "number", "number"]),
      read: optionalCwrap(module, "y8950_read", "number", ["number", "number"]),
      readStatus: optionalCwrap(module, "y8950_read_status", "number", ["number"]),
      getIrq: optionalCwrap(module, "y8950_get_irq", "number", ["number"]),
      sampleRate: module.cwrap("y8950_sample_rate", "number", ["number", "number"]),
      generate: module.cwrap("y8950_generate", null, ["number", "number", "number", "number"]),
    };

    const handle = api.create();
    return new Y8950(module, handle, api);
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

  loadSampleMemory(data, offset = 0, memorySize = offset + data.length) {
    if (!(data instanceof Uint8Array) || !Number.isInteger(offset) || !Number.isInteger(memorySize) ||
        offset < 0 || memorySize < offset || memorySize > 2097152 || data.length > memorySize - offset)
      throw new RangeError('Invalid sample memory range');
    const memory = new Uint8Array(memorySize);
    memory.set(this.sampleMemory.subarray(0, memorySize));
    memory.set(data, offset);
    const ptr = this.module._malloc(data.length || 1);
    try {
      this.module.HEAPU8.set(data, ptr);
      if (!this.api.loadMemory(this.handle, ptr, data.length, offset, memorySize)) throw new RangeError('Invalid sample memory');
      this.sampleMemory = memory;
    } finally { this.module._free(ptr); }
  }
  clearSampleMemory() { this.api.clearMemory(this.handle); this.sampleMemory = new Uint8Array(0); }

  reset() {
    // A chip reset leaves free-running envelope/LFO counters intact.
    // Start VGM replay/seek from the same power-on state each time.
    this.api.destroy(this.handle);
    this.handle = this.api.create();
    this.loadSampleMemory(this.sampleMemory, 0, this.sampleMemory.length);
    this.#syncIrq();
  }

  write(offset, data) {
    this.api.write(this.handle, offset, data);
    if (typeof this.hooks.onWrite === "function") {
      this.hooks.onWrite({ offset, data });
    }
    this.#syncIrq();
  }

  read(offset) {
    if (typeof this.api.read !== "function") {
      throw new Error("This Y8950 runtime does not support read(offset). Rebuild or reload the generated wasm runtime.");
    }
    const value = this.api.read(this.handle, offset);
    if (typeof this.hooks.onRead === "function") {
      this.hooks.onRead({ offset, value });
    }
    this.#syncIrq();
    return value;
  }

  readStatus() {
    if (typeof this.api.readStatus !== "function") {
      return this.read(0);
    }
    const value = this.api.readStatus(this.handle);
    if (typeof this.hooks.onRead === "function") {
      this.hooks.onRead({ offset: 0, value });
    }
    this.#syncIrq();
    return value;
  }

  getIrq() {
    if (typeof this.api.getIrq !== "function") {
      return false;
    }
    return this.api.getIrq(this.handle) !== 0;
  }

  setHooks(hooks = {}) {
    const { onWrite, onRead, onIrq } = hooks;
    assertHook("onWrite", onWrite);
    assertHook("onRead", onRead);
    assertHook("onIrq", onIrq);
    this.hooks = { onWrite, onRead, onIrq };
    this.lastIrqState = undefined;
    this.#syncIrq();
  }

  sampleRate(clock = Y8950_CLOCK) {
    return this.api.sampleRate(this.handle, clock);
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
    this.#syncIrq();
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

  #syncIrq() {
    if (typeof this.api.getIrq !== "function" || typeof this.hooks.onIrq !== "function") {
      return;
    }

    const asserted = this.getIrq();
    if (this.lastIrqState === asserted) {
      return;
    }

    this.lastIrqState = asserted;
    this.hooks.onIrq(asserted);
  }
}

export async function createY8950(moduleFactory, moduleOptions) {
  return Y8950.create({ moduleFactory, moduleOptions });
}

function assertHook(name, value) {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`${name} must be a function when provided`);
  }
}

function optionalCwrap(module, name, returnType, argTypes) {
  const table = module.asm || module;
  const exportedName = `_${name}`;
  if (typeof table[exportedName] !== "function") {
    return undefined;
  }
  return module.cwrap(name, returnType, argTypes);
}
