import {Ay8910} from './ay8910.js';
/**
 * Ay8910AudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class Ay8910AudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<Ay8910AudioEngine>} Initialized engine owned by the caller.
   */
  static async create({moduleFactory,moduleOptions,clock,type=0,flags=1,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await Ay8910.create({moduleFactory,moduleOptions,clock,type,flags,sampleRate:outputSampleRate});
    try{return new Ay8910AudioEngine(chip,masterVolume);}catch(error){chip.dispose();throw error;}
  }
  constructor(chip,volume=1){this.ay8910=chip;this.channelMask=0;this.muted=false;this.setMasterVolume(volume);}
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate(){return this.ay8910.sampleRate();}
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset(){this.ay8910.reset();}
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose(){this.ay8910.dispose();}
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeAy8910(register,value){this.ay8910.writeRegister(register,value);}
  setAyMuted(muted){this.muted=Boolean(muted);this.applyMute();}
  setAyChannelMuted(channel,muted){
    if(!Number.isInteger(channel)||channel<0||channel>2)throw new RangeError('Invalid AY channel');
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);this.applyMute();
  }
  applyMute(){this.ay8910.setMuteMask(this.muted?7:this.channelMask);}
  /**
   * Set the linear master gain; validation/clamping follows this engine.
   * @param {number} value Gain multiplier, not dB.
   */
  setMasterVolume(value){if(!Number.isFinite(Number(value)))throw new RangeError('Invalid volume');return this.volume=Math.max(0,Math.min(3.8,Number(value)));}
  /**
   * Read the current linear master gain.
   * @returns {number} Gain multiplier, not a dB value.
   */
  getMasterVolume(){return this.volume;}
  /**
   * Allocate stereo output and advance synthesis.
   * @param {number} frames Nonnegative integer frame count at sampleRate().
   * @returns {{left:Float32Array,right:Float32Array}} Rendered stereo output.
   */
  processFrames(frames){const pcm=this.ay8910.generateStereo(frames);for(let i=0;i<frames;i++){pcm.left[i]*=this.volume;pcm.right[i]*=this.volume;}return pcm;}
  /**
   * Advance synthesis and fill caller-owned stereo buffers.
   * @param {Float32Array} left Left output buffer with capacity for frames samples.
   * @param {Float32Array} right Right output buffer with capacity for frames samples.
   * @param {number} frames Nonnegative integer output frame count; not VGM wait samples.
   */
  process(left,right,frames){
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length<frames||right.length<frames)throw new RangeError('Invalid buffers');
    const pcm=this.processFrames(frames);left.set(pcm.left);right.set(pcm.right);
  }
}
export const createAy8910AudioEngine=options=>Ay8910AudioEngine.create(options);

// Only AY plus optional OPLL is currently routed by the Analyzer's MSX engine.
export function validateAyPlaybackHeader(header) {
  if(header.ay8910Clock & 0xc0000000)throw new Error('Multiple AY chips: Support coming soon.');
  if(header.ym2413Clock & 0xc0000000)throw new Error('This OPLL variant: Support coming soon.');
  for(const key of ['ym2612Clock','ym2203Clock','ym2608Clock','ym2610Clock','rf5c164Clock','pwmClock','psgClock','y8950Clock','k051649Clock'])
    if(header[key])throw new Error(`AY with ${key.replace('Clock','')}: Support coming soon.`);
}
