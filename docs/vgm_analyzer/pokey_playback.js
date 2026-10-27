import {PokeyAudioEngine} from '../js/pokeyaudioengine.js';
import {MultiChipAudioEngine} from '../js/multichipaudioengine.js';

export function pokeyPlaybackConfiguration(rawClock) {
  if (!Number.isInteger(rawClock) || rawClock < 0 || rawClock > 0xffffffff || (rawClock & 0x80000000))
    throw new RangeError('Unsupported POKEY clock or variant');
  const clock = rawClock & 0x3fffffff;
  if (clock < 1 || clock > 100000000) throw new RangeError('Invalid POKEY clock');
  return {clock, count:rawClock & 0x40000000 ? 2 : 1};
}

/** Each chip owns its timers/DAC/DC-blocker; the shared WASM module is storage,
 * not shared chip state. No per-chip attenuation is hidden in this adapter. */
export class PokeyPlaybackEngine extends MultiChipAudioEngine {
  static async create({moduleFactory,moduleOptions,rawClock,masterVolume=1}) {
    const {clock,count}=pokeyPlaybackConfiguration(rawClock), engines=[];
    if (typeof moduleFactory!=='function') throw new TypeError('Missing POKEY WASM factory');
    try {
      const module=await moduleFactory({...moduleOptions});
      for(let i=0;i<count;i++)engines.push(await PokeyAudioEngine.create({moduleFactory:()=>module,clock,outputSampleRate:44100}));
      return new PokeyPlaybackEngine(engines,masterVolume);
    } catch(error) {for(const engine of engines)engine.dispose();throw error;}
  }
  constructor(engines,volume=1) {
    super(engines.map((engine,index)=>({type:'pokey',index,engine,target:{}})),44100,volume);
    this.channelMutes=new Uint8Array(engines.length*4);
    this.onWrite=null;
    this.playbackMixerSources=engines.map((engine,index)=>({id:index?'pokey:2':'pokey',source:engine,method:'processFrames',rate:44100}));
    for(const [index,engine] of engines.entries())this.entries.get(`pokey:${index}`).target={writeRegister:(register,value)=>{
      engine.writePokey(register,value);this.onWrite?.(register,value,index);
    }};
  }
  writePokey(register,value,index=0){this.getVgmTarget('pokey',index).writeRegister(register,value);}
  setChannelMuted(channel,muted) {
    if(!Number.isInteger(channel)||channel<0||channel>=this.channelMutes.length||typeof muted!=='boolean')throw new RangeError('Invalid POKEY monitor channel');
    this.entries.get(`pokey:${channel>>2}`).engine.setChannelMuted(channel&3,muted);
    this.channelMutes[channel]=Number(muted);
  }
  reset() {
    super.reset();
    // User monitoring choices survive seek/replay; reset still restarts every
    // counter, polynomial and speaker DC filter before the setup writes replay.
    for(let ch=0;ch<this.channelMutes.length;ch++)if(this.channelMutes[ch])this.setChannelMuted(ch,true);
  }
  supportsState(){return false;}
}
