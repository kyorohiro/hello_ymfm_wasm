import {Ay8910AudioEngine} from './ay8910audioengine.js';
import {Ym2413AudioEngine} from './ym2413audioengine.js';
// AY and OPLL remain separate chips; VgmPlayer advances both by the same duration.
export class MsxAudioEngine {
  static async create({ayModuleFactory,ayModuleOptions,ayClock,ayType=0,ayFlags=1,
    ym2413ModuleFactory,ym2413ModuleOptions,ym2413Clock,outputSampleRate=44100,masterVolume=1}={}) {
    const ay=await Ay8910AudioEngine.create({moduleFactory:ayModuleFactory,moduleOptions:ayModuleOptions,clock:ayClock,type:ayType,flags:ayFlags,outputSampleRate});
    let opll;
    try{
      opll=await Ym2413AudioEngine.create({ym2413ModuleFactory,ym2413ModuleOptions,ym2413Clock,outputSampleRate});
      return new MsxAudioEngine(ay,opll,masterVolume);
    }catch(error){ay.dispose();opll?.dispose();throw error;}
  }
  constructor(ay,opll,volume){this.ay=ay;this.opll=opll;this.opllMuted=false;this.setMasterVolume(volume);}
  sampleRate(){return this.ay.sampleRate();}
  reset(){this.ay.reset();this.opll.reset();}
  dispose(){this.ay.dispose();this.opll.dispose();}
  writeAy8910(register,value){this.ay.writeAy8910(register,value);}
  writeYm2413(register,value){this.opll.writeYm2413(register,value);}
  setAyMuted(value){this.ay.setAyMuted(value);}
  setAyChannelMuted(channel,value){this.ay.setAyChannelMuted(channel,value);}
  setOpllMuted(value){this.opllMuted=Boolean(value);}
  setMasterVolume(value){if(!Number.isFinite(Number(value)))throw new RangeError('Invalid volume');return this.volume=Math.max(0,Math.min(3.8,Number(value)));}
  getMasterVolume(){return this.volume;}
  processFrames(frames){
    const a=this.ay.processFrames(frames),b=this.opll.processFrames(frames);
    for(let i=0;i<frames;i++){
      a.left[i]=(a.left[i]+(this.opllMuted?0:b.left[i]))*this.volume;
      a.right[i]=(a.right[i]+(this.opllMuted?0:b.right[i]))*this.volume;
    }return a;
  }
  process(left,right,frames){
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length<frames||right.length<frames)throw new RangeError('Invalid buffers');
    const pcm=this.processFrames(frames);left.set(pcm.left);right.set(pcm.right);
  }
}
export const createMsxAudioEngine=options=>MsxAudioEngine.create(options);
