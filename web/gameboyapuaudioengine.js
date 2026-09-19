import {GameboyApu} from './gameboyapu.js';
export class GameboyApuAudioEngine {
  static async create({moduleFactory,moduleOptions,clock,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await GameboyApu.create({moduleFactory,moduleOptions,clock,sampleRate:outputSampleRate});
    try{return new GameboyApuAudioEngine(chip,masterVolume);}catch(error){chip.dispose();throw error;}
  }
  constructor(chip,volume=1){this.gameboy=chip;this.channelMask=0;this.muted=false;this.setMasterVolume(volume);}
  sampleRate(){return this.gameboy.sampleRate();}
  reset(){this.gameboy.reset();}
  dispose(){this.gameboy.dispose();}
  writeGameboyApu(offset,value){this.gameboy.writeRegister(offset,value);}
  setGameboyApuMuted(muted){this.muted=Boolean(muted);this.applyMute();}
  setGameboyApuChannelMuted(channel,muted){
    if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('Invalid Game Boy APU channel');
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);this.applyMute();
  }
  applyMute(){this.gameboy.setMuteMask(this.muted?0xf:this.channelMask);}
  setMasterVolume(value){if(!Number.isFinite(Number(value)))throw new RangeError('Invalid volume');return this.volume=Math.max(0,Math.min(3.8,Number(value)));}
  getMasterVolume(){return this.volume;}
  processFrames(frames){const pcm=this.gameboy.generateStereo(frames);for(let i=0;i<frames;i++){pcm.left[i]*=this.volume;pcm.right[i]*=this.volume;}return pcm;}
  process(left,right,frames){
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length<frames||right.length<frames)throw new RangeError('Invalid buffers');
    const pcm=this.processFrames(frames);left.set(pcm.left);right.set(pcm.right);
  }
}
export const createGameboyApuAudioEngine=options=>GameboyApuAudioEngine.create(options);
