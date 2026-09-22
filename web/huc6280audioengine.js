// MAME HuC6280 adapter. Source/license: third_party/mame-huc6280/.
export class Huc6280AudioEngine {
  static async create({moduleFactory, clock, outputSampleRate = 44100, masterVolume = 1}) {
    if (!Number.isInteger(clock) || clock <= 0 || clock > 0x3fffffff ||
        !Number.isInteger(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 384000) {
      throw new RangeError('Invalid HuC6280 clock/sample rate');
    }
    if (!Number.isFinite(Number(masterVolume))) throw new RangeError('Invalid volume');
    const module = await moduleFactory();
    return new Huc6280AudioEngine(module, clock, outputSampleRate, masterVolume);
  }

  constructor(module, clock, rate, volume) {
    this.module = module;
    this.rate = rate;
    this.setMasterVolume(volume);
    this.ptr = this.capacity = this.selectedChannel = 0;
    this.handle = module._huc6280_create(clock, rate);
    if (!this.handle) throw new Error('HuC6280 initialization failed');
  }

  sampleRate() { return this.rate; }
  getMasterVolume() { return this.volume; }
  setMasterVolume(value) {
    if (!Number.isFinite(Number(value))) throw new RangeError('Invalid volume');
    this.volume = Math.max(0, Math.min(3.8, Number(value)));
  }

  setChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 6) throw new RangeError('Invalid HuC6280 channel');
    this.module._huc6280_mute(this.handle, channel, Boolean(muted));
  }

  writeHuc6280(register, value) {
    if ((register & 15) === 0) this.selectedChannel = value & 7;
    this.module._huc6280_write(this.handle, register, value);
  }

  // VGM stream port selects a channel (FF uses the current channel). Restore
  // the selection afterwards so interleaved direct register writes stay intact.
  writeHuc6280Stream(port, register, value) {
    const previous = this.selectedChannel;
    if (port !== 0xff) this.writeHuc6280(register >>> 4, port);
    this.writeHuc6280(register & 15, value);
    if (port !== 0xff) this.writeHuc6280(register >>> 4, previous);
  }

  reset() {
    this.selectedChannel = 0;
    this.module._huc6280_reset(this.handle);
  }

  dispose() {
    if (this.ptr) this.module._free(this.ptr);
    if (this.handle) this.module._huc6280_destroy(this.handle);
    this.ptr = this.handle = this.capacity = 0;
  }

  processFrames(frames) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    if (!this.handle) throw new Error('HuC6280 engine is disposed');
    if (!frames) return {left: new Float32Array(), right: new Float32Array()};
    if (frames > this.capacity) {
      if (this.ptr) this.module._free(this.ptr);
      this.ptr = this.capacity = 0;
      this.ptr = this.module._malloc(frames * 8);
      if (!this.ptr) throw new Error('HuC6280 output allocation failed');
      this.capacity = frames;
    }
    const rightPtr = this.ptr + this.capacity * 4;
    this.module._huc6280_generate(this.handle, this.ptr, rightPtr, frames);
    // Read the current heap after allocation/generation, which may grow memory.
    const heap = this.module.HEAPF32;
    return {
      left: Float32Array.from(heap.subarray(this.ptr / 4, this.ptr / 4 + frames), v => v * this.volume),
      right: Float32Array.from(heap.subarray(rightPtr / 4, rightPtr / 4 + frames), v => v * this.volume),
    };
  }
}
