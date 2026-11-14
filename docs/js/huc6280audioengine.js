/**
 * @file huc6280audioengine.js
 * 実行環境: Browser / Node.js
 * 依存: 音源チップ／WASM バックエンド（ファクトリーまたはエンジンを注入）。
 * 同期 PCM 生成・ミックス用。DOM・AudioContext・スピーカー出力は不要。
 */
// MAME HuC6280 adapter. Source/license: third_party/mame-huc6280/.
// Opaque state handles can move between matching engines in this module. Native
// validation binds their encoding to the exact core ABI, clock and output rate.
const huc6280States=new WeakMap();
const stateExports=['_huc6280_state_size','_huc6280_save_state','_huc6280_validate_state','_huc6280_load_state'];
const stateHeap=module=>new Uint8Array((module.HEAPU8??module.HEAPF32).buffer);
/**
 * Huc6280AudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class Huc6280AudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {{moduleFactory: import('./soundchip.js').WasmModuleFactory, clock: number, outputSampleRate?: number, masterVolume?: number}} options Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<Huc6280AudioEngine>} Initialized engine owned by the caller.
   */
  static async create({moduleFactory, clock, outputSampleRate = 44100, masterVolume = 1}) {
    if (!Number.isInteger(clock) || clock <= 0 || clock > 0x3fffffff ||
        !Number.isInteger(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 384000) {
      throw new RangeError('Invalid HuC6280 clock/sample rate');
    }
    if (!Number.isFinite(Number(masterVolume))) throw new RangeError('Invalid volume');
    const module = await moduleFactory();
    return new Huc6280AudioEngine(module, clock, outputSampleRate, masterVolume);
  }

  /** @param {import('./soundchip.js').WasmChipModule} module
   * @param {number} clock
   * @param {number} rate
   * @param {number} volume */
  constructor(module, clock, rate, volume) {
    this.module = module;
    this.clock=clock;this.rate = rate;this.channelMask=0;
    this.setMasterVolume(volume);
    this.ptr = this.capacity = this.selectedChannel = 0;
    this.handle = module._huc6280_create(clock, rate);
    if (!this.handle) throw new Error('HuC6280 initialization failed');
  }

  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate() { return this.rate; }
  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume() { return this.volume; }
  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} value Gain multiplier, not dB.
   */
  setMasterVolume(value) {
    if (!Number.isFinite(Number(value))) throw new RangeError('Invalid volume');
    this.volume = Math.max(0, Math.min(3.8, Number(value)));
  }

  /**
   * Change one physical channel mute flag.
   * @param {number} channel Zero-based physical channel index, not a MIDI part.
   * @param {boolean} muted True to suppress the channel.
   * @returns {void}
   */
  setChannelMuted(channel, muted) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= 6) throw new RangeError('Invalid HuC6280 channel');
    this.module._huc6280_mute(this.handle, channel, Boolean(muted));
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);
  }

  /** Whether this build exposes the validated, versioned native state ABI. */
  supportsState(){return Boolean(this.handle&&stateExports.every(name=>typeof this.module[name]==='function'));}
  /** Output settings must match before restoring a cached native timeline. */
  stateSettingsKey(){return JSON.stringify([this.clock,this.rate,this.volume,this.channelMask]);}
  _stateHeader(bytes,selected=this.selectedChannel,mask=this.channelMask){
    if(bytes.length!==512)throw Error('Incompatible HuC6280 native state size');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(String.fromCharCode(...bytes.subarray(0,8))!=='HUCSAVE1'||view.getUint32(8,true)!==1||view.getUint32(12,true)!==512||
      view.getUint32(24,true)!==this.clock||view.getUint32(28,true)!==this.rate||bytes[48]!==selected||bytes[53]!==mask)
      throw Error('Incompatible HuC6280 native state settings');
  }
  _withStateBytes(bytes,callback){
    const ptr=this.module._malloc(bytes.length);if(!ptr)throw Error('HuC6280 state allocation failed');
    try{stateHeap(this.module).set(bytes,ptr);return callback(ptr,bytes.length);}finally{this.module._free(ptr);}
  }
  /** Save native phase, Wave RAM, Noise/LFO and resampler state without exposing bytes. */
  saveState(){
    if(!this.supportsState())throw Error('HuC6280 state saving unavailable');
    const size=this.module._huc6280_state_size(this.handle);if(size!==512)throw Error('Incompatible HuC6280 native state size');
    const ptr=this.module._malloc(size);if(!ptr)throw Error('HuC6280 state allocation failed');
    try{
      if(this.module._huc6280_save_state(this.handle,ptr,size)!==1)throw Error('HuC6280 native state saving failed');
      const bytes=stateHeap(this.module).slice(ptr,ptr+size);this._stateHeader(bytes);
      const state=Object.freeze({byteLength:size});huc6280States.set(state,{bytes,key:this.stateSettingsKey(),selected:this.selectedChannel,mask:this.channelMask});return state;
    }finally{this.module._free(ptr);}
  }
  /** Reject forged, incompatible or corrupted snapshots before any chip mutation. */
  validateState(state){
    const saved=huc6280States.get(state);
    if(!this.supportsState()||!saved||saved.key!==this.stateSettingsKey())throw Error('Invalid or incompatible HuC6280 state');
    this._stateHeader(saved.bytes,saved.selected,saved.mask);
    this._withStateBytes(saved.bytes,(ptr,size)=>{if(this.module._huc6280_validate_state(this.handle,ptr,size)!==1)throw Error('Invalid HuC6280 native state');});return true;
  }
  /** Restore into a matching build/configuration; PCM output buffers are not state. */
  loadState(state){
    this.validateState(state);const saved=huc6280States.get(state);
    this._withStateBytes(saved.bytes,(ptr,size)=>{if(this.module._huc6280_load_state(this.handle,ptr,size)!==1)throw Error('Invalid HuC6280 native state');});
    this.selectedChannel=saved.selected;this.channelMask=saved.mask;
  }

  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeHuc6280(register, value) {
    if ((register & 15) === 0) this.selectedChannel = value & 7;
    this.module._huc6280_write(this.handle, register, value);
  }

  // VGM stream port selects a channel (FF uses the current channel). Restore
  // the selection afterwards so interleaved direct register writes stay intact.
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} port Chip register bank/port (not a MIDI channel).
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeHuc6280Stream(port, register, value) {
    const previous = this.selectedChannel;
    if (port !== 0xff) this.writeHuc6280(register >>> 4, port);
    this.writeHuc6280(register & 15, value);
    if (port !== 0xff) this.writeHuc6280(register >>> 4, previous);
  }

  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset() {
    this.selectedChannel = 0;
    this.module._huc6280_reset(this.handle);
  }

  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose() {
    if (this.ptr) this.module._free(this.ptr);
    if (this.handle) this.module._huc6280_destroy(this.handle);
    this.ptr = this.handle = this.capacity = 0;
  }

  /**
   * Allocate stereo output and advance synthesis.
   * @param {number} frames Nonnegative integer frame count at sampleRate().
   * @returns {{left:Float32Array,right:Float32Array}} Rendered stereo output.
   */
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
    const left = new Float32Array(frames), right = new Float32Array(frames);
    const leftOffset = this.ptr / 4, rightOffset = rightPtr / 4;
    for (let i = 0; i < frames; i++) {
      left[i] = heap[leftOffset + i] * this.volume;
      right[i] = heap[rightOffset + i] * this.volume;
    }
    return {left, right};
  }
}
