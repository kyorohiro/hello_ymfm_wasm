import {Ay8910} from './ay8910.js';
export class Ay8910AudioEngine {
  static async create({moduleFactory,moduleOptions,clock,type=0,flags=1,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await Ay8910.create({moduleFactory,moduleOptions,clock,type,flags,sampleRate:outputSampleRate});
    try{return new Ay8910AudioEngine(chip,masterVolume);}catch(error){chip.dispose();throw error;}
  }
  constructor(chip,volume=1){this.ay8910=chip;this.channelMask=0;this.muted=false;this.setMasterVolume(volume);}
  sampleRate(){return this.ay8910.sampleRate();}
  reset(){this.ay8910.reset();}
  dispose(){this.ay8910.dispose();}
  writeAy8910(register,value){this.ay8910.writeRegister(register,value);}
  setAyMuted(muted){this.muted=Boolean(muted);this.applyMute();}
  setAyChannelMuted(channel,muted){
    if(!Number.isInteger(channel)||channel<0||channel>2)throw new RangeError('Invalid AY channel');
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);this.applyMute();
  }
  applyMute(){this.ay8910.setMuteMask(this.muted?7:this.channelMask);}
  setMasterVolume(value){if(!Number.isFinite(Number(value)))throw new RangeError('Invalid volume');return this.volume=Math.max(0,Math.min(3.8,Number(value)));}
  getMasterVolume(){return this.volume;}
  processFrames(frames){const pcm=this.ay8910.generateStereo(frames);for(let i=0;i<frames;i++){pcm.left[i]*=this.volume;pcm.right[i]*=this.volume;}return pcm;}
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
