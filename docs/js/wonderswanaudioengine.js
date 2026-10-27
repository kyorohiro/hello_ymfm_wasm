/** Synchronous VGM playback adapter. No AudioContext or device is opened.
 * The raw BSD core remains unipolar; this speaker boundary follows the
 * Playground Worklet's tick-aligned wave midpoint correction.
 */
import {WonderSwan, WONDERSWAN_CLOCK} from './wonderswan.js?v=wonderswan-pcm-timeline-1';

/** @typedef {{moduleFactory?: import('./soundchip.js?v=pokey-mode-1').WasmModuleFactory,
 * moduleOptions?: object, clock?: number, outputSampleRate?: number,
 * masterVolume?: number}} WonderSwanAudioEngineOptions */
export class WonderSwanAudioEngine {
  /** @param {WonderSwanAudioEngineOptions} [options] */
  static async create({moduleFactory, moduleOptions, clock=WONDERSWAN_CLOCK,
    outputSampleRate=44100, masterVolume=1}={}) {
    const chip=await WonderSwan.create({moduleFactory,moduleOptions,clock,sampleRate:outputSampleRate});
    try { return new WonderSwanAudioEngine(chip,masterVolume); }
    catch(error) { chip.dispose(); throw error; }
  }
  constructor(chip,volume=1) {
    this.chip=chip;
    this.rate=chip.sampleRate();this.engineRate=Math.floor(chip.clock/128);
    this.registers=new Uint8Array(32);this.memory=new Uint8Array(0x4000);
    this.mutedChannels=new Uint8Array(4);
    this.targetLeft=new Float64Array(4);this.targetRight=new Float64Array(4);
    this.heldLeft=new Float64Array(4);this.heldRight=new Float64Array(4);
    this.waveReady=new Uint8Array(4);this.coldWavePosition=new Uint16Array(4);
    this.speakerPhase=0;this.setMasterVolume(volume);
  }
  alive(){if(!this.chip)throw new Error('WonderSwan engine is disposed');}
  sampleRate(){this.alive();return this.rate;}
  setMasterVolume(value){if(!Number.isFinite(Number(value)))throw new RangeError('Invalid volume');return this.volume=Math.max(0,Math.min(3.8,Number(value)));}
  getMasterVolume(){return this.volume;}
  supportsState(){return false;}
  /** VGM 0xBC / DAC-stream register numbers are relative to I/O 0x80. */
  writeWonderSwan(register,value){
    this.alive();
    if(!Number.isInteger(register)||register<0||register>31)throw new RangeError('Unsupported WonderSwan register: this core supports I/O 0x80..0x9f');
    this.chip.writeRegister(0x80+register,value);
    this.registers[register]=register===14?value&~8:value;
    this.updateSpeakerCenter();
  }
  writeWonderSwanMemory(offset,value){
    this.alive();this.chip.writeMemory(offset,value);this.memory[offset]=value;this.updateSpeakerCenter();
  }
  loadWonderSwanMemory(data,offset=0){
    this.alive();this.chip.loadMemory(data,offset);this.memory.set(data,offset);this.updateSpeakerCenter();
  }
  clearWonderSwanMemory(){this.loadWonderSwanMemory(new Uint8Array(0x4000));}
  setChannelMuted(channel,muted){
    this.alive();this.chip.setChannelMuted(channel,Boolean(muted));this.mutedChannels[channel]=Number(Boolean(muted));
  }
  reset(){
    this.alive();this.chip.reset();this.registers.fill(0);this.memory.fill(0);
    for(const array of [this.targetLeft,this.targetRight,this.heldLeft,this.heldRight,this.waveReady,this.coldWavePosition])array.fill(0);
    this.speakerPhase=0;
    for(let ch=0;ch<4;ch++)this.chip.setChannelMuted(ch,Boolean(this.mutedChannels[ch]));
  }
  dispose(){this.chip?.dispose();this.chip=null;}
  updateSpeakerCenter(){
    const r=this.registers,control=r[16];this.targetLeft.fill(0);this.targetRight.fill(0);
    if(r[17]&8)for(let ch=0;ch<4;ch++)if(control&(1<<ch)){
      let left=0,right=0;
      if(ch===1&&(control&32)){
        const volume=r[20];if(volume&12)left=(volume&8)?127.5:63.5;if(volume&3)right=(volume&2)?127.5:63.5;
      }else{
        let midpoint=0;
        if(ch===3&&(control&128)){if(r[14]&16)midpoint=7.5;}
        else{
          const address=((r[15]<<6)+ch*16)&0x3fff;
          for(let i=0;i<16;i++){const value=this.memory[(address+i)&0x3fff];midpoint+=(value&15)+(value>>4);}
          midpoint/=32;
        }
        left=midpoint*(r[8+ch]>>4);right=midpoint*(r[8+ch]&15);
      }
      this.targetLeft[ch]=left/1024;this.targetRight[ch]=right/1024;
    }
  }
  speakerTick(){
    const r=this.registers,control=r[16];this.heldLeft.fill(0);this.heldRight.fill(0);
    if(r[17]&8)for(let ch=0;ch<4;ch++)if(control&(1<<ch)){
      const pcm=ch===1&&!!(control&32);
      if(pcm||this.waveReady[ch]){this.heldLeft[ch]=this.targetLeft[ch];this.heldRight[ch]=this.targetRight[ch];}
      // The core emits the first fetched wave sample one native tick later.
      if(!pcm&&!this.waveReady[ch]){
        const period=2048-(r[ch*2]|((r[ch*2+1]&7)<<8));this.coldWavePosition[ch]+=128;
        if(this.coldWavePosition[ch]>=period)this.waveReady[ch]=1;
      }
    }
  }
  /** Borrowed, speaker-centered PCM. Consume before the next render or dispose.
   * Stable frame sizes reuse the core's output views and allocate no PCM arrays.
   * @param {number} frames
   * @returns {Readonly<{left:Float32Array,right:Float32Array}>}
   */
  generateStereoView(frames){
    this.alive();const raw=this.chip.generateStereoView(frames);
    const {left,right}=raw,r=this.registers;
    const silent=!(r[16]&15)||!(r[17]&8);
    for(let i=0;i<frames;i++){
      this.speakerPhase+=this.engineRate;
      while(this.speakerPhase>=this.rate){this.speakerPhase-=this.rate;this.speakerTick();}
      let centerLeft=0,centerRight=0;
      for(let ch=0;ch<4;ch++)if(!this.mutedChannels[ch]){centerLeft+=this.heldLeft[ch];centerRight+=this.heldRight[ch];}
      // Match the Float32 speaker boundary before applying the outer Mixer gain.
      left[i]=silent?0:Math.fround(raw.left[i]-centerLeft)*this.volume;
      right[i]=silent?0:Math.fround(raw.right[i]-centerRight)*this.volume;
    }
    return raw;
  }
  /** Owned speaker-centered PCM, valid after subsequent renders and disposal. */
  processFrames(frames){
    const {left,right}=this.generateStereoView(frames);
    return {left:new Float32Array(left),right:new Float32Array(right)};
  }
  process(left,right,frames){
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length<frames||right.length<frames)throw new RangeError('Invalid buffers');
    const pcm=this.generateStereoView(frames);left.set(pcm.left);right.set(pcm.right);
  }
}
/** @param {WonderSwanAudioEngineOptions} [options] */
export const createWonderSwanAudioEngine=options=>WonderSwanAudioEngine.create(options);
