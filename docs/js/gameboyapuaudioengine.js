/**
 * @file gameboyapuaudioengine.js
 * 実行環境: Browser / Node.js
 * 依存: 音源チップ／WASM バックエンド（ファクトリーまたはエンジンを注入）。
 * 同期 PCM 生成・ミックス用。DOM・AudioContext・スピーカー出力は不要。
 */
import {GameboyApu} from './gameboyapu.js?v=audio-stability-2';
/**
 * GameboyApuAudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class GameboyApuAudioEngine {
  #states = new WeakMap();
  /**
   * Create the chip instances required by this engine.
   * @param {{moduleFactory: import('./soundchip.js?v=wonderswan-native-1').WasmModuleFactory, moduleOptions?: import('./soundchip.js?v=wonderswan-native-1').WasmModuleOptions, clock?: number, outputSampleRate?: number, masterVolume?: number}} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<GameboyApuAudioEngine>} Initialized engine owned by the caller.
   */
  static async create({moduleFactory,moduleOptions,clock,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await GameboyApu.create({moduleFactory,moduleOptions,clock,sampleRate:outputSampleRate});
    try{return new GameboyApuAudioEngine(chip,masterVolume);}catch(error){chip.dispose();throw error;}
  }
  /** @param {GameboyApu} chip
   * @param {number} [volume] */
  constructor(chip,volume=1){this.gameboy=chip;this.channelMask=0;this.setMasterVolume(volume);}
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate(){return this.gameboy.sampleRate();}
  supportsState(){return Boolean(this.gameboy.supportsState?.());}
  stateSettingsKey(){return JSON.stringify([this.sampleRate(),this.volume,this.channelMask]);}
  saveState(){
    if(!this.supportsState())throw new Error('Game Boy state saving unavailable');
    const chip=this.gameboy.saveState(),state=Object.freeze({byteLength:chip.byteLength});
    this.#states.set(state,{chip,key:this.stateSettingsKey()});return state;
  }
  validateState(state){
    const saved=this.#states.get(state);
    if(!this.supportsState()||!saved||saved.key!==this.stateSettingsKey())throw new Error('Incompatible Game Boy state');
    this.gameboy.validateState(saved.chip);
  }
  loadState(state){this.validateState(state);this.gameboy.loadState(this.#states.get(state).chip);}
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
/** @param {Parameters<typeof GameboyApuAudioEngine.create>[0]} [options] */
export const createGameboyApuAudioEngine=options=>GameboyApuAudioEngine.create(options);
