import {GameboyApu} from './gameboyapu.js';
/**
 * GameboyApuAudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class GameboyApuAudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<GameboyApuAudioEngine>} Initialized engine owned by the caller.
   */
  static async create({moduleFactory,moduleOptions,clock,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await GameboyApu.create({moduleFactory,moduleOptions,clock,sampleRate:outputSampleRate});
    try{return new GameboyApuAudioEngine(chip,masterVolume);}catch(error){chip.dispose();throw error;}
  }
  constructor(chip,volume=1){this.gameboy=chip;this.channelMask=0;this.setMasterVolume(volume);}
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate(){return this.gameboy.sampleRate();}
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset(){this.gameboy.reset();}
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose(){this.gameboy.dispose();}
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} offset Chip address offset.
   * @param {number} value Register/command data value.
   */
  writeGameboyApu(offset,value){this.gameboy.writeRegister(offset,value);}
  // Matches the generic setChannelMuted(channel, muted) shape shared by the
  // other standalone-chip engines (YM2151/YMF262/YM2413/YM3526/YM3812), so
  // the analyzer's shared per-channel toggle UI can drive this chip too.
  /**
   * Change one physical channel mute flag.
   * @param {number} channel Zero-based physical channel index, not a MIDI part.
   * @param {boolean} muted True to suppress the channel.
   * @returns {void}
   */
  setChannelMuted(channel,muted){
    if(!Number.isInteger(channel)||channel<0||channel>=4)throw new RangeError('Invalid Game Boy APU channel');
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);
    this.gameboy.setMuteMask(this.channelMask);
  }
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
  processFrames(frames){const pcm=this.gameboy.generateStereo(frames);for(let i=0;i<frames;i++){pcm.left[i]*=this.volume;pcm.right[i]*=this.volume;}return pcm;}
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
export const createGameboyApuAudioEngine=options=>GameboyApuAudioEngine.create(options);
