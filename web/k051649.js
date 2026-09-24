/**
 * @file k051649.js
 * 実行環境: Browser / Node.js
 * 依存: WASM（moduleFactory と moduleOptions で読み込み方法を注入）。
 * チップ操作・PCM 生成に DOM・AudioContext は不要。ローダーは実行環境に合わせて渡す。
 */
export function validateK051649({clock, sampleRate=44100}={}) {
  if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff||!Number.isInteger(sampleRate)||sampleRate<=0||sampleRate>384000)
    throw new RangeError('Invalid K051649 clock or sample rate');
}
/**
 * K051649 chip instance backed by WASM. No AudioContext or playback device is created.
 * Use create() to initialize and dispose() to release native resources.
 * Register writes program the chip; generateStereo() advances it to produce PCM.
 */
export class K051649 {
  /**
   * Initialize K051649 and its native WASM module.
   * The generated module factory is injected so browser and Node callers can choose asset loading.
   * @param {Object} [options={}] Chip and Emscripten initialization settings.
   * @param {function(Object): (Object|Promise<Object>)} options.moduleFactory Generated WASM module factory.
   * @param {Object} [options.moduleOptions] Forwarded loader options, e.g. wasmBinary or locateFile.
   * @param {number} [options.clock] Input chip clock in Hz.
   * @param {number} [options.sampleRate=44100] Generated PCM frames per second.
   * @returns {Promise<K051649>} Ready-to-use chip; the caller must dispose it.
   */
  static async create({moduleFactory,moduleOptions,clock,sampleRate=44100}={}) {
    validateK051649({clock,sampleRate});
    if(typeof moduleFactory!=='function')throw new Error('moduleFactory is required');
    const module=await moduleFactory({...moduleOptions});
    const api={};
    for(const [name,ret,args] of [
      ['create','number',2],['destroy',null,1],['reset',null,1],['write',null,4],
      ['sample_rate','number',1],['set_mute_mask',null,2],['generate',null,4]])
      api[name]=module.cwrap(`k051649_${name}`,ret,Array(args).fill('number'));
    const handle=api.create(sampleRate,clock);
    if(!handle)throw new Error('Could not create K051649');
    return new K051649(module,handle,api);
  }
  /**
   * Wrap native resources allocated by create(); prefer the asynchronous factory.
   * @param {Object} module Initialized Emscripten module.
   * @param {number} handle Native chip handle owned by this instance.
   * @param {Object} api Bound native entry points.
   */
  constructor(module,handle,api){this.module=module;this.handle=handle;this.api=api;this.ptr=0;this.capacity=0;}
  /**
   * Reject operations on a disposed native handle.
   * @returns {void}
   * @throws {Error} When the chip has been disposed.
   */
  assertAlive(){if(!this.handle)throw new Error('K051649 is disposed');}
  /**
   * Reset synthesis state for a new playback pass. Reapply voice and key registers afterward.
   * @returns {void}
   */
  reset(){this.assertAlive();this.api.reset(this.handle);}
  // port selects the register group (0=SCC waveform, 1=frequency, 2=volume,
  // 3=key on/off, 4=SCC+/052539 waveform, 5=test); see the VGM 0xD2 command.
  /**
   * Write a register directly without rendering audio.
   * @param {number} port Register group: 0=SCC wave, 1=frequency, 2=volume, 3=key, 4=SCC+ wave, 5=test.
   * @param {number} register Byte offset within the group, 0..255.
   * @param {number} value Register byte, 0..255.
   * @returns {void}
   */
  writeRegister(port,register,value){
    this.assertAlive();
    if(!Number.isInteger(port)||port<0||port>7||!Number.isInteger(register)||register<0||register>255||!Number.isInteger(value)||value<0||value>255)
      throw new RangeError('Invalid K051649 register write');
    this.api.write(this.handle,port,register,value);
  }
  /**
   * Set native channel mute bits; a set bit suppresses that channel.
   * @param {number} mask Integer bit mask in the native chip channel layout.
   * @returns {void}
   */
  setMuteMask(mask){this.assertAlive();this.api.set_mute_mask(this.handle,mask);}
  /**
   * Return the configured PCM output rate.
   * @returns {number} Stereo frames per second.
   */
  sampleRate(){this.assertAlive();return this.api.sample_rate(this.handle);}
  /**
   * Generate PCM synchronously, advancing the chip by the requested number of frames.
   * Returned arrays are copied from WASM memory and survive later generation/disposal.
   * @param {number} frames Nonnegative integer stereo frame count.
   * @returns {{left: Float32Array, right: Float32Array}} Owned PCM arrays at sampleRate().
   */
  generateStereo(frames){
    this.assertAlive();
    if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
    if(frames>this.capacity){
      const ptr=this.module._malloc(frames*8);
      if(!ptr)throw new Error('K051649 audio buffer allocation failed');
      if(this.ptr)this.module._free(this.ptr);
      this.ptr=ptr;this.capacity=frames;
    }
    const rightPtr=this.ptr+this.capacity*4;
    this.api.generate(this.handle,this.ptr,rightPtr,frames);
    return {left:new Float32Array(this.module.HEAPF32.subarray(this.ptr/4,this.ptr/4+frames)),
      right:new Float32Array(this.module.HEAPF32.subarray(rightPtr/4,rightPtr/4+frames))};
  }
  /**
   * Release native chip state and allocated WASM buffers. Do not use the chip afterward.
   * @returns {void}
   */
  dispose(){if(this.ptr)this.module._free(this.ptr);if(this.handle)this.api.destroy(this.handle);this.ptr=0;this.handle=0;this.capacity=0;}
}
