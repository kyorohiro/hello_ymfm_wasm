import {K051649} from './k051649.js';
/**
 * K051649AudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class K051649AudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<K051649AudioEngine>} Initialized engine owned by the caller.
   */
  static async create({moduleFactory,moduleOptions,clock,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await K051649.create({moduleFactory,moduleOptions,clock,sampleRate:outputSampleRate});
    try{return new K051649AudioEngine(chip,masterVolume);}catch(error){chip.dispose();throw error;}
  }
  constructor(chip,volume=1){this.k051649=chip;this.channelMask=0;this.muted=false;this.setMasterVolume(volume);}
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate(){return this.k051649.sampleRate();}
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset(){this.k051649.reset();}
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose(){this.k051649.dispose();}
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} port Chip register bank/port (not a MIDI channel).
   * @param {number} register Register address within the selected chip bank.
   * @param {number} value Register/command data value.
   */
  writeK051649(port,register,value){this.k051649.writeRegister(port,register,value);}
  setSccMuted(muted){this.muted=Boolean(muted);this.applyMute();}
  setSccChannelMuted(channel,muted){
    if(!Number.isInteger(channel)||channel<0||channel>4)throw new RangeError('Invalid SCC channel');
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);this.applyMute();
  }
  applyMute(){this.k051649.setMuteMask(this.muted?0x1f:this.channelMask);}
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
  processFrames(frames){const pcm=this.k051649.generateStereo(frames);for(let i=0;i<frames;i++){pcm.left[i]*=this.volume;pcm.right[i]*=this.volume;}return pcm;}
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
export const createK051649AudioEngine=options=>K051649AudioEngine.create(options);
