export const YM2612_CLOCK = 7670454;

export class Ym2612 {
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
    this.envPtrs = [0, 0, 0, 0];
    this.bufferFrames = 0;
  }

  static async create(options = {}) {
    const { moduleFactory, moduleOptions } = options;
    if (!moduleFactory) {
      throw new Error("moduleFactory is required");
    }

    const module = await moduleFactory(moduleOptions || {});
    const api = {
      create: module.cwrap("ym2612_create", "number", []),
      destroy: module.cwrap("ym2612_destroy", null, ["number"]),
      reset: module.cwrap("ym2612_reset", null, ["number"]),
      write: module.cwrap("ym2612_write", null, ["number", "number", "number"]),
      read: optionalCwrap(module, "ym2612_read", "number", ["number", "number"]),
      readStatus: optionalCwrap(module, "ym2612_read_status", "number", ["number"]),
      getIrq: optionalCwrap(module, "ym2612_get_irq", "number", ["number"]),
      sampleRate: module.cwrap("ym2612_sample_rate", "number", ["number", "number"]),
      generate: module.cwrap("ym2612_generate", null, ["number", "number", "number", "number"]),
      generateWithInternalEnvelope: module.cwrap(
        "ym2612_generate_with_internal_envelope",
        null,
        ["number", "number", "number", "number", "number", "number", "number", "number", "number"]
      ),
    };

    const handle = api.create();
    return new Ym2612(module, handle, api);
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
    this.envPtrs.forEach((ptr, index) => {
      if (ptr) {
        this.module._free(ptr);
        this.envPtrs[index] = 0;
      }
    });
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
      throw new Error("This YM2612 runtime does not support read(offset). Rebuild or reload the generated wasm runtime.");
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

  writeRegister(register, value, port = 0) {
    const addressOffset = port === 0 ? 0 : 2;
    const dataOffset = addressOffset + 1;
    this.write(addressOffset, register);
    this.write(dataOffset, value);
  }

  sampleRate(clock = YM2612_CLOCK) {
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

  generateStereoWithInternalEnvelope(frames, channel = 0) {
    this.#ensureBuffers(frames);
    this.api.generateWithInternalEnvelope(
      this.handle,
      this.leftPtr,
      this.rightPtr,
      this.envPtrs[0],
      this.envPtrs[1],
      this.envPtrs[2],
      this.envPtrs[3],
      frames,
      channel
    );

    const leftStart = this.leftPtr >> 2;
    const rightStart = this.rightPtr >> 2;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(this.module.HEAPF32.subarray(leftStart, leftStart + frames));
    right.set(this.module.HEAPF32.subarray(rightStart, rightStart + frames));

    const envelopes = this.envPtrs.map((ptr) => {
      const start = ptr >> 2;
      const values = new Float32Array(frames);
      values.set(this.module.HEAPF32.subarray(start, start + frames));
      return values;
    });

    return { left, right, envelopes };
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
    this.envPtrs.forEach((ptr) => {
      if (ptr) {
        this.module._free(ptr);
      }
    });

    const byteLength = frames * Float32Array.BYTES_PER_ELEMENT;
    this.leftPtr = this.module._malloc(byteLength);
    this.rightPtr = this.module._malloc(byteLength);
    this.envPtrs = this.envPtrs.map(() => this.module._malloc(byteLength));
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

export async function createYm2612(moduleFactory, moduleOptions) {
  return Ym2612.create({ moduleFactory, moduleOptions });
}

function assertHook(name, value) {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`${name} must be a function when provided`);
  }
}

function optionalCwrap(module, name, returnType, argTypes) {
  const exportName = `_${name}`;
  if (typeof module[exportName] !== "function") {
    return undefined;
  }
  return module.cwrap(name, returnType, argTypes);
}
