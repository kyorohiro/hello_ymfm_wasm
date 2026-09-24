export const AY8910_CLOCK = 1789773;
export function validateAy8910({clock=AY8910_CLOCK,sampleRate=44100,type=0,flags=1}={}) {
  if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff||!Number.isInteger(sampleRate)||sampleRate<=0||sampleRate>384000)
    throw new RangeError('Invalid AY clock or sample rate');
  if (![0,0x10].includes(type)) throw new Error(`AY chip type 0x${Number(type).toString(16)}: Support coming soon.`);
  if(!Number.isInteger(flags)||flags<0||flags>255||(flags & ~0x11)||(type===0 && (flags&0x10)))
    throw new Error(`AY flags 0x${Number(flags).toString(16)}: Support coming soon.`);
}
/**
 * Ay8910 chip instance backed by WASM. No AudioContext or playback device is created.
 * Use create() to initialize and dispose() to release native resources.
 * Register writes program the chip; generateStereo() advances it to produce PCM.
 */
export class Ay8910 {
  /**
   * Initialize Ay8910 and its native WASM module.
   * The generated module factory is injected so browser and Node callers can choose asset loading.
   * @param {Object} [options={}] Chip and Emscripten initialization settings.
   * @param {function(Object): (Object|Promise<Object>)} options.moduleFactory Generated WASM module factory.
   * @param {Object} [options.moduleOptions] Forwarded loader options, e.g. wasmBinary or locateFile.
   * @param {number} [options.clock] Input chip clock in Hz.
   * @param {number} [options.sampleRate=44100] Generated PCM frames per second.
   * @returns {Promise<Ay8910>} Ready-to-use chip; the caller must dispose it.
   */
  static async create({moduleFactory,moduleOptions,clock=AY8910_CLOCK,sampleRate=44100,type=0,flags=1}={}) {
    validateAy8910({clock,sampleRate,type,flags});
    if(typeof moduleFactory!=='function')throw new Error('moduleFactory is required');
    const module=await moduleFactory({...moduleOptions});
    const api={};
    for(const [name,ret,args] of [
      ['create','number',4],['destroy',null,1],['reset',null,1],['write',null,3],['read','number',2],
      ['sample_rate','number',1],['set_mute_mask',null,2],['generate',null,4]])
      api[name]=module.cwrap(`ay8910_${name}`,ret,Array(args).fill('number'));
    const handle=api.create(sampleRate,clock,type,flags);
    if(!handle)throw new Error('Could not create AY8910');
    return new Ay8910(module,handle,api);
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
  assertAlive(){if(!this.handle)throw new Error('AY8910 is disposed');}
  /**
   * Reset synthesis state for a new playback pass. Reapply voice and key registers afterward.
   * @returns {void}
   */
  reset(){this.assertAlive();this.api.reset(this.handle);}
  /**
   * Write a register directly without rendering audio.
   * @param {number} register AY register index, 0..15.
   * @param {number} value Register byte, 0..255.
   * @returns {void}
   */
  writeRegister(register,value){
    this.assertAlive();
    if(!Number.isInteger(register)||register<0||register>15||!Number.isInteger(value)||value<0||value>255)throw new RangeError('Invalid AY register write');
    this.api.write(this.handle,register,value);
  }
  /**
   * Read the selected PSG register.
   * @param {number} register Register number.
   * @returns {number} Register byte.
   */
  read(register){this.assertAlive();return this.api.read(this.handle,register);}
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
      if(!ptr)throw new Error('AY audio buffer allocation failed');
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
