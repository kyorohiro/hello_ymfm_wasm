/**
 * @file segapcmaudioengine.js
 * 実行環境: Browser / Node.js
 * 依存: 音源チップ／WASM バックエンド（ファクトリーまたはエンジンを注入）。
 * 同期 PCM 生成・ミックス用。DOM・AudioContext・スピーカー出力は不要。
 */
import {SegaPcm} from './segapcm.js';
import {SegaPSG} from './segapsg.js';
// Sega PCM and optional Sega PSG (SN76489) share the output clock, but keep independent state.
/**
 * SegaPcmAudioEngine adapter for synchronous stereo rendering and VGM register dispatch.
 * Output timing uses sampleRate() frames per second. No browser audio device is opened.
 * Dispose the engine when done to release its underlying chips.
 */
export class SegaPcmAudioEngine {
  /**
   * Create the chip instances required by this engine.
   * @param {Object} [options={}] Chip factories, clocks in Hz and loader settings.
   * @param {number} [options.outputSampleRate=44100] Output stereo frames per second.
   * @param {number} [options.masterVolume=1] Linear output gain, not dB.
   * @returns {Promise<SegaPcmAudioEngine>} Initialized engine owned by the caller.
   */
  static async create({moduleFactory,moduleOptions,clock,bankShift=0,bankMask=0,segaPsgModuleFactory,psgClock=0,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await SegaPcm.create({moduleFactory,moduleOptions,clock,bankShift,bankMask,sampleRate:outputSampleRate});
    let psg;
    try {
      if(psgClock) psg=await SegaPSG.create({moduleFactory:segaPsgModuleFactory,clock:psgClock,sampleRate:outputSampleRate});
      return new SegaPcmAudioEngine(chip,psg,masterVolume);
    } catch(error){chip.dispose();psg?.dispose();throw error;}
  }
  constructor(chip,psg,volume=1){this.segapcm=chip;this.psg=psg;this.channelMask=0;this.muted=false;this.psgMuted=false;this.setMasterVolume(volume);}
  /**
   * Return the rate used by process() and processFrames().
   * @returns {number} Output stereo frames per second (Hz).
   */
  sampleRate(){return this.segapcm.sampleRate();}
  /**
   * Reset chip/playback state for a new pass. This is not pause/resume; replay setup writes afterward.
   * @returns {void}
   */
  reset(){this.segapcm.reset();this.psg?.reset();}
  /**
   * Release the underlying chips and their resources. Do not render after disposal.
   * @returns {void}
   */
  dispose(){this.segapcm.dispose();this.psg?.dispose();}
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} offset Chip address offset.
   * @param {number} value Register/command data value.
   */
  writeSegaPcm(offset,value){this.segapcm.writeRegister(offset,value);}
  loadSampleMemory(data,offset,memorySize){this.segapcm.loadSampleMemory(data,offset,memorySize);}
  clearSampleMemory(){this.segapcm.clearSampleMemory();}
  /**
   * Dispatch a VGM register/command write to the corresponding sound chip.
   * @param {number} value Register/command data value.
   */
  writePsg(value){this.psg?.write(value);}
  setPsgMuted(value){this.psgMuted=Boolean(value);}
  setSegaPcmMuted(muted){this.muted=Boolean(muted);this.applyMute();}
  setSegaPcmChannelMuted(channel,muted){
    if(!Number.isInteger(channel)||channel<0||channel>15)throw new RangeError('Invalid Sega PCM channel');
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);this.applyMute();
  }
  applyMute(){this.segapcm.setMuteMask(this.muted?0xffff:this.channelMask);}
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
  processFrames(frames){
    const pcm=this.segapcm.generateStereo(frames);
    const psg=this.psg?.generateStereo(frames);
    for(let i=0;i<frames;i++){
      pcm.left[i]=(pcm.left[i]+(psg&&!this.psgMuted?psg.left[i]:0))*this.volume;
      pcm.right[i]=(pcm.right[i]+(psg&&!this.psgMuted?psg.right[i]:0))*this.volume;
    }
    return pcm;
  }
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
export const createSegaPcmAudioEngine=options=>SegaPcmAudioEngine.create(options);
