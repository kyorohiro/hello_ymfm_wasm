import {Pokey,POKEY_CLOCK} from './pokey.js?v=pokey-mode-1';

/** Speaker-only boundary for the unipolar legacy POKEY DAC. A 10 Hz DC blocker
 * removes its variable offset (including clipped multi-channel mixes) without
 * output normalization. Raw Pokey.generateStereo() remains unchanged.
 */
/** @typedef {{moduleFactory?:Function,moduleOptions?:object,clock?:number,outputSampleRate?:number,masterVolume?:number}} PokeyAudioEngineOptions */
export class PokeyAudioEngine {
  /** @param {PokeyAudioEngineOptions} [options] @returns {Promise<PokeyAudioEngine>} */
  static async create({moduleFactory,moduleOptions,clock=POKEY_CLOCK,outputSampleRate=44100,masterVolume=1}={}){
    const chip=await Pokey.create({moduleFactory,moduleOptions,clock,sampleRate:outputSampleRate});
    try{return new PokeyAudioEngine(chip,masterVolume);}catch(error){chip.dispose();throw error;}
  }
  /** @param {Pokey} chip @param {number} [volume=1] */
  constructor(chip,volume=1){this.chip=chip;this.rate=chip.sampleRate();this.registers=new Uint8Array(16);this.mutedChannels=new Uint8Array(4);this.coefficient=Math.exp(-2*Math.PI*10/this.rate);this.previousInput=0;this.previousOutput=0;this.setMasterVolume(volume);}
  alive(){if(!this.chip)throw new Error('POKEY engine is disposed');}
  sampleRate(){this.alive();return this.rate;}
  getState(){this.alive();return {clock:this.chip.clock,registers:Array.from(this.registers),mutedChannels:Array.from(this.mutedChannels)};}
  setMasterVolume(volume){if(!Number.isFinite(volume)||volume<0||volume>4)throw new RangeError('Invalid POKEY output volume');this.volume=volume;}
  getMasterVolume(){return this.volume;}
  writeRegister(register,value){this.alive();this.chip.writeRegister(register,value);this.registers[register]=value;}
  readRegister(register){this.alive();return this.chip.readRegister(register);}
  writePokey(register,value){this.writeRegister(register,value);}
  setChannelMuted(channel,muted){this.alive();this.chip.setChannelMuted(channel,muted);this.mutedChannels[channel]=Number(muted);}
  reset(){this.alive();this.chip.reset();this.registers.fill(0);this.mutedChannels.fill(0);this.previousInput=this.previousOutput=0;}
  /** Borrowed buffers, reused with no render-time allocation. */
  /** @param {number} frames @returns {Readonly<{left:Float32Array,right:Float32Array}>} */
  generateStereoView(frames){
    this.alive();const pcm=this.chip.generateStereoView(frames);
    let active=false;for(let ch=0;ch<4;ch++)if(!this.mutedChannels[ch]&&(this.registers[ch*2+1]&15))active=true;
    if(!active){pcm.left.fill(0);pcm.right.fill(0);this.previousInput=this.previousOutput=0;return pcm;}
    let input=this.previousInput,output=this.previousOutput;
    for(let i=0;i<frames;i++){const value=pcm.left[i];output=value-input+this.coefficient*output;input=value;pcm.left[i]=pcm.right[i]=output*this.volume;}
    this.previousInput=input;this.previousOutput=output;return pcm;
  }
  processFrames(frames){const pcm=this.generateStereoView(frames);return {left:pcm.left.slice(),right:pcm.right.slice()};}
  process(left,right,frames=left.length){if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length<frames||right.length<frames)throw new RangeError('Invalid POKEY output buffers');const pcm=this.generateStereoView(frames);left.set(pcm.left);right.set(pcm.right);}
  dispose(){this.chip?.dispose();this.chip=null;}
}
export const createPokeyAudioEngine=options=>PokeyAudioEngine.create(options);
