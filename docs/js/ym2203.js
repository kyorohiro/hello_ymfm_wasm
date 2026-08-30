export const YM2203_CLOCK = 4000000;

export class Ym2203 {
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
  }

  static async create(options = {}) {
    const { moduleFactory, moduleOptions } = options;
    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    const module = await moduleFactory(moduleOptions || {});
    const api = {
      create: module.cwrap("ym2203_create", "number", []),
      destroy: module.cwrap("ym2203_destroy", null, ["number"]),
      reset: module.cwrap("ym2203_reset", null, ["number"]),
      write: module.cwrap("ym2203_write", null, ["number", "number", "number"]),
      read: optionalCwrap(module, "ym2203_read", "number", ["number", "number"]),
      readStatus: optionalCwrap(module, "ym2203_read_status", "number", ["number"]),
      getIrq: optionalCwrap(module, "ym2203_get_irq", "number", ["number"]),
      sampleRate: module.cwrap("ym2203_sample_rate", "number", ["number", "number"]),
      generate: module.cwrap("ym2203_generate", null, ["number", "number", "number", "number"]),
    };

    const handle = api.create();
    return new Ym2203(module, handle, api);
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
      throw new Error("This YM2203 runtime does not support read(offset). Rebuild or reload the generated wasm runtime.");
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

  sampleRate(clock = YM2203_CLOCK) {
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
    return { left, right };
  }

  #ensureBuffers(frames) {
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

export async function createYm2203(moduleFactory, moduleOptions) {
  return Ym2203.create({ moduleFactory, moduleOptions });
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
