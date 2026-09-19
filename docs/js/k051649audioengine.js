import {K051649} from './k051649.js';
export class K051649AudioEngine {
  static async create({moduleFactory,moduleOptions,clock,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await K051649.create({moduleFactory,moduleOptions,clock,sampleRate:outputSampleRate});
    try{return new K051649AudioEngine(chip,masterVolume);}catch(error){chip.dispose();throw error;}
  }
  constructor(chip,volume=1){this.k051649=chip;this.channelMask=0;this.muted=false;this.setMasterVolume(volume);}
  sampleRate(){return this.k051649.sampleRate();}
  reset(){this.k051649.reset();}
  dispose(){this.k051649.dispose();}
  writeK051649(port,register,value){this.k051649.writeRegister(port,register,value);}
  setSccMuted(muted){this.muted=Boolean(muted);this.applyMute();}
  setSccChannelMuted(channel,muted){
    if(!Number.isInteger(channel)||channel<0||channel>4)throw new RangeError('Invalid SCC channel');
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);this.applyMute();
  }
  applyMute(){this.k051649.setMuteMask(this.muted?0x1f:this.channelMask);}
  setMasterVolume(value){if(!Number.isFinite(Number(value)))throw new RangeError('Invalid volume');return this.volume=Math.max(0,Math.min(3.8,Number(value)));}
  getMasterVolume(){return this.volume;}
  processFrames(frames){const pcm=this.k051649.generateStereo(frames);for(let i=0;i<frames;i++){pcm.left[i]*=this.volume;pcm.right[i]*=this.volume;}return pcm;}
  process(left,right,frames){
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length<frames||right.length<frames)throw new RangeError('Invalid buffers');
    const pcm=this.processFrames(frames);left.set(pcm.left);right.set(pcm.right);
  }
}
export const createK051649AudioEngine=options=>K051649AudioEngine.create(options);
