// MAME-derived OKIM6258 decoder. Source and license: third_party/mame-okim6258/.
export function validateOki6258Header(header) {
  if (header.okim6258Clock & 0xc0000000) throw new Error('Dual/variant OKIM6258 playback is not supported');
  if (!(header.okim6258Flags & 4)) throw new Error('OKIM6258 3-bit ADPCM playback is not supported (4-bit required)');
}
/**
 * Oki6258AudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class Oki6258AudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {Object} options Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<Oki6258AudioEngine>} Initialized engine owned by the caller.
   */
  static async create({moduleFactory,clock,flags=4,outputSampleRate=44100,masterVolume=1}) {
    validateOki6258Header({okim6258Clock:clock,okim6258Flags:flags});
    if(!Number.isInteger(clock)||clock<=0||clock>0x3fffffff||!Number.isInteger(outputSampleRate)||outputSampleRate<8000)throw new RangeError('Invalid OKIM6258 clock/sample rate');
    const module=await moduleFactory();return new Oki6258AudioEngine(module,clock,flags,outputSampleRate,masterVolume);
  }
  constructor(module,clock,flags,rate,volume){
    this.module=module;this.rate=rate;this.volume=volume;this.ptr=0;this.capacity=0;this.muted=false;
    this.handle=module._okim6258_create(clock,flags,rate);if(!this.handle)throw new Error('OKIM6258 initialization failed');
  }
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate(){return this.rate;}
  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} v Gain multiplier, not dB.
   */
  setMasterVolume(v){if(!Number.isFinite(Number(v)))throw new RangeError('Invalid volume');this.volume=Math.max(0,Math.min(3.8,Number(v)));}
  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume(){return this.volume;}
  setOkiMuted(v){this.muted=Boolean(v);}
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} r Register address.
   * @param {number} v Register data value.
   */
  writeOki6258(r,v){this.module._okim6258_write(this.handle,r,v);}
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset(){this.module._okim6258_reset(this.handle);}
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose(){if(this.ptr)this.module._free(this.ptr);if(this.handle)this.module._okim6258_destroy(this.handle);this.ptr=this.handle=this.capacity=0;}
  /**
   * Allocate stereo output and advance synthesis.
   * @param {number} frames Nonnegative integer frame count at sampleRate().
   * @returns {{left:Float32Array,right:Float32Array}} Rendered stereo output.
   */
  processFrames(frames){
    if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
    if(!frames)return {left:new Float32Array(),right:new Float32Array()};
    if(frames>this.capacity){if(this.ptr)this.module._free(this.ptr);this.ptr=this.module._malloc(frames*8);this.capacity=frames;}
    const r=this.ptr+this.capacity*4;this.module._okim6258_generate(this.handle,this.ptr,r,frames);
    const gain=this.muted?0:this.volume;
    return {left:Float32Array.from(this.module.HEAPF32.subarray(this.ptr/4,this.ptr/4+frames),v=>v*gain),right:Float32Array.from(this.module.HEAPF32.subarray(r/4,r/4+frames),v=>v*gain)};
  }
}
// Player renders through processFrames. Keep the primary engine's monitor hooks
// and channel controls; advance ADPCM over exactly the same output interval.
export function attachOki6258(engine, oki) {
  const render=engine.processFrames.bind(engine),reset=engine.reset.bind(engine),dispose=engine.dispose.bind(engine);
  engine.writeOki6258=(r,v)=>oki.writeOki6258(r,v);
  engine.setOkiMuted=(v)=>oki.setOkiMuted(v);
  engine.processFrames=frames=>{const pcm=render(frames),extra=oki.processFrames(frames),volume=engine.getMasterVolume();for(let i=0;i<frames;i++){pcm.left[i]+=extra.left[i]*volume;pcm.right[i]+=extra.right[i]*volume;}return pcm;};
  engine.reset=()=>{reset();oki.reset();};engine.dispose=()=>{dispose();oki.dispose();};
  return engine;
}
