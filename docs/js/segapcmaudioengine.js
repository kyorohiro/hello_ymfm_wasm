import {SegaPcm} from './segapcm.js';
import {SegaPSG} from './segapsg.js';
// Sega PCM and optional Sega PSG (SN76489) share the output clock, but keep independent state.
export class SegaPcmAudioEngine {
  static async create({moduleFactory,moduleOptions,clock,bankShift=0,bankMask=0,segaPsgModuleFactory,psgClock=0,outputSampleRate=44100,masterVolume=1}={}) {
    const chip=await SegaPcm.create({moduleFactory,moduleOptions,clock,bankShift,bankMask,sampleRate:outputSampleRate});
    let psg;
    try {
      if(psgClock) psg=await SegaPSG.create({moduleFactory:segaPsgModuleFactory,clock:psgClock,sampleRate:outputSampleRate});
      return new SegaPcmAudioEngine(chip,psg,masterVolume);
    } catch(error){chip.dispose();psg?.dispose();throw error;}
  }
  constructor(chip,psg,volume=1){this.segapcm=chip;this.psg=psg;this.channelMask=0;this.muted=false;this.psgMuted=false;this.setMasterVolume(volume);}
  sampleRate(){return this.segapcm.sampleRate();}
  reset(){this.segapcm.reset();this.psg?.reset();}
  dispose(){this.segapcm.dispose();this.psg?.dispose();}
  writeSegaPcm(offset,value){this.segapcm.writeRegister(offset,value);}
  loadSampleMemory(data,offset,memorySize){this.segapcm.loadSampleMemory(data,offset,memorySize);}
  clearSampleMemory(){this.segapcm.clearSampleMemory();}
  writePsg(value){this.psg?.write(value);}
  setPsgMuted(value){this.psgMuted=Boolean(value);}
  setSegaPcmMuted(muted){this.muted=Boolean(muted);this.applyMute();}
  setSegaPcmChannelMuted(channel,muted){
    if(!Number.isInteger(channel)||channel<0||channel>15)throw new RangeError('Invalid Sega PCM channel');
    this.channelMask=muted?this.channelMask|(1<<channel):this.channelMask&~(1<<channel);this.applyMute();
  }
  applyMute(){this.segapcm.setMuteMask(this.muted?0xffff:this.channelMask);}
  setMasterVolume(value){if(!Number.isFinite(Number(value)))throw new RangeError('Invalid volume');return this.volume=Math.max(0,Math.min(3.8,Number(value)));}
  getMasterVolume(){return this.volume;}
  processFrames(frames){
    const pcm=this.segapcm.generateStereo(frames);
    const psg=this.psg?.generateStereo(frames);
    for(let i=0;i<frames;i++){
      pcm.left[i]=(pcm.left[i]+(psg&&!this.psgMuted?psg.left[i]:0))*this.volume;
      pcm.right[i]=(pcm.right[i]+(psg&&!this.psgMuted?psg.right[i]:0))*this.volume;
    }
    return pcm;
  }
  process(left,right,frames){
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length<frames||right.length<frames)throw new RangeError('Invalid buffers');
    const pcm=this.processFrames(frames);left.set(pcm.left);right.set(pcm.right);
  }
}
export const createSegaPcmAudioEngine=options=>SegaPcmAudioEngine.create(options);
