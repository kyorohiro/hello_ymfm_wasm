// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {encodeDdaDataAsync, MAX_DDA_SAMPLES} from './dda_pcm.js';

const MAX_COMMANDS=4_000_000, MAX_REGIONS=100_000, MAX_VOICES=4096, CHUNK=4096;
const SCALE=[0,3,5,7,9,11,13,15,16,19,21,23,25,27,29,31];
const abort=signal=>{if(signal?.aborted)throw new DOMException('VGM import cancelled','AbortError');};
const pause=async signal=>{abort(signal);await new Promise(resolve=>setTimeout(resolve,0));abort(signal);};

/** Recover direct 0xb9 DAC writes on VGM's 44,100 Hz time grid.
 * A direct DDA activation, initial DAC write at that timestamp, constant spacing
 * and an explicit gate-off/DDA-disable one period after the last sample are
 * required. Long waits never imply a new sample boundary. Same-time writes are
 * ordered as hardware writes, then their last audible value is sampled only
 * when time advances. Loop and a sample's musical root are never inferred.
 */
export async function extractVgmDirectPcm(bytes,{signal}={}) {
  abort(signal);
  if(!(bytes instanceof Uint8Array)||bytes.length<64)throw new TypeError('Expected decoded VGM bytes');
  const parser=new Ym2612VGM(bytes,{logger:{warn:()=>{}}});
  if(parser.header.dataOffset<64||parser.header.dataOffset>=bytes.length)throw new Error('Invalid VGM data offset');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const channels=Array.from({length:8},()=>({control:null,balance:null,noise:undefined,region:null,pending:null}));
  const streams=new Map(), definitions=new Map(), warnings=new Set(), ready=[];
  let selected=null,globalBalance,lfoControl,time=0,regions=0,sampleWork=0;
  const active=control=>control!==null&&(control&192)===192;
  const warn=reason=>warnings.add(`Direct PCM omitted: ${reason}.`);
  function invalidate(channel,reason) {
    if(channel.region&&!channel.region.invalid){channel.region.invalid=reason;channel.region.chunks=[];}
  }
  function affect(index,reason) {
    for(let i=0;i<channels.length;i++)if(index===null||index===i)invalidate(channels[i],reason);
  }
  function open(channel,index) {
    if(++regions>MAX_REGIONS)throw new RangeError('Direct PCM import exceeds 100,000 DDA regions');
    channel.region={channel:index+1,start:time,firstTime:null,lastTime:null,spacing:null,count:0,chunks:[],
      first:null,varied:false,attempted:false,invalid:null,mix:null,warnings:[]};
    channel.pending=null;
  }
  function close(channel) {
    const job=channel.region;channel.region=null;channel.pending=null;
    if(!job||!job.attempted)return;
    if(job.invalid){warn(job.invalid);return;}
    if(job.count<3||job.spacing===null){warn('at least three positive-duration DAC writes are required');return;}
    if(time-job.lastTime!==job.spacing){warn('the explicit end does not follow the last DAC write by one recorded sample period');return;}
    if(!job.varied){warn('constant DAC values contain no changing waveform');return;}
    const rate=44100/job.spacing;
    if(rate<1||rate>192000){warn('recorded rate is outside the supported 1–192,000 Hz range');return;}
    ready.push({...job,rate});
  }
  function mix(channel,index) {
    if(!active(channel.control)||channel.balance===null)return {reason:'known DDA key-on, level and channel balance are required'};
    if(globalBalance===null)return {reason:'global balance is unknown after streamed changes'};
    if(index<2&&(lfoControl===null||(lfoControl&3)))return {reason:'active or unknown LFO routing affects CH1 / CH2'};
    if(index>=4&&(channel.noise===null||(channel.noise&128)))return {reason:'active or unknown Noise overrides CH5 / CH6 DDA'};
    const global=globalBalance??255,volume=channel.control&31;
    const attenuation=shift=>31-SCALE[global>>shift&15]+31-volume+31-SCALE[channel.balance>>shift&15];
    if(attenuation(0)>=31&&attenuation(4)>=31)return {reason:'the recorded channel is inaudible'};
    return {global,volume,balance:channel.balance};
  }
  function flushSamples() {
    for(let index=0;index<channels.length;index++) {
      const channel=channels[index],job=channel.region,pending=channel.pending;channel.pending=null;
      if(!job||job.invalid)continue;
      const current=mix(channel,index);
      if(current.reason){invalidate(channel,current.reason);continue;}
      if(job.mix) {
        if(current.global!==job.mix.global||current.volume!==job.mix.volume||current.balance!==job.mix.balance) {
          invalidate(channel,'audible channel level / balance or global balance changes during the region');continue;
        }
      } else {
        job.mix=current;
        if(globalBalance===undefined)job.warnings.push('Global balance was not recorded; this audition assumes full global balance.');
        else if(globalBalance!==255)job.warnings.push('Recorded global balance is not applied; this audition retains channel level / balance and uses full global balance.');
        if(index<2&&lfoControl===undefined)job.warnings.push('LFO control was not recorded; this audition assumes the reset state, LFO off.');
        if(index>=4&&channel.noise===undefined)job.warnings.push('Noise control was not recorded; this audition assumes the reset state, Noise off.');
      }
      if(!pending) {
        if(job.firstTime===null)invalidate(channel,'the activation timestamp has no known initial direct DAC write');
        continue;
      }
      if(job.firstTime===null) {
        if(time!==job.start){invalidate(channel,'the initial DAC value before the first write is unknown');continue;}
        job.firstTime=time;job.first=pending.value;
      } else {
        const spacing=time-job.lastTime;
        if(job.spacing===null)job.spacing=spacing;
        else if(spacing!==job.spacing){invalidate(channel,'direct DAC write spacing changes within the region');continue;}
      }
      if(++sampleWork>MAX_DDA_SAMPLES)throw new RangeError('Direct PCM import exceeds 16,777,216 DAC samples of extraction work');
      if(job.count%CHUNK===0)job.chunks.push(new Uint8Array(CHUNK));
      job.chunks.at(-1)[job.count%CHUNK]=pending.value;job.count++;
      job.varied ||= pending.value!==job.first;job.lastTime=time;
    }
  }
  function streamEffects() {
    for(const stream of streams.values()) {
      if(!stream.active||stream.chip!==0x1b||stream.rate===0)continue;
      const register=stream.register&15;
      if(stream.port!==255&&stream.register>>>4!==0) {
        affect(null,'a nonstandard DAC stream changes hardware state');selected=null;globalBalance=lfoControl=null;
        for(const channel of channels)channel.control=channel.balance=channel.noise=null;
        continue;
      }
      if(register===0){selected=null;continue;}
      if(register===1){globalBalance=null;affect(null,'a DAC stream changes global balance');continue;}
      if(register===9){lfoControl=null;affect(0,'a DAC stream changes LFO state');affect(1,'a DAC stream changes LFO state');continue;}
      const target=stream.port===255?selected:stream.port&7;
      if([4,5,6,7].includes(register))for(let index=0;index<channels.length;index++)if(target===null||index===target) {
        const channel=channels[index];
        if(register===4)channel.control=null;
        else if(register===5)channel.balance=null;
        else if(register===7)channel.noise=null;
        invalidate(channel,'DAC stream writes overlap the direct PCM region');
      }
    }
  }
  function advance(samples) {
    if(!samples)return;
    streamEffects();flushSamples();time+=samples;
    for(const stream of streams.values())if(stream.active&&!stream.loop&&stream.rate!==0&&time>=stream.endTime)stream.active=false;
  }
  function write(register,value) {
    register&=15;
    if(register===0){selected=value&7;return;}
    if(register===1){globalBalance=value;return;}
    if(register===9){lfoControl=value;return;}
    if(selected===null) {
      if([4,5,6,7].includes(register)) {
        affect(null,'a direct channel write has no known selection');
        if(register===6)warn('a direct DAC write has no known channel selection');
        for(const channel of channels) {
          if(register===4)channel.control=null;
          else if(register===5)channel.balance=null;
          else if(register===7)channel.noise=null;
        }
      }
      return;
    }
    const channel=channels[selected];
    if(register===4) {
      const before=active(channel.control),after=active(value);
      if(!after)close(channel);
      else if(!before&&!channel.region&&selected<6)open(channel,selected);
      channel.control=value;
    } else if(register===5)channel.balance=value;
    else if(register===7)channel.noise=value;
    else if(register===6&&active(channel.control)&&channel.region) {
      channel.region.attempted=true;channel.pending={value:value&31};
    }
  }
  function streamCommand(code,position) {
    const id=bytes[position+1];
    if(code===0x94){for(const [key,stream] of streams)if(id===255||id===key)stream.active=false;return;}
    if(id===255)return;
    if(code===0x90) {
      const previous=streams.get(id),chip=bytes[position+2];
      if(chip===0x9b)throw new Error('Second HuC6280 DAC streams are not supported');
      streams.set(id,{...previous,chip,port:bytes[position+3],register:bytes[position+4],active:false});return;
    }
    const stream=streams.get(id);if(!stream)return;
    if(code===0x91){if(stream.active){stream.loop=true;stream.endTime=Infinity;}return;}
    if(code===0x92) {
      const rate=view.getUint32(position+2,true);
      if(stream.rate!==rate&&stream.active){stream.loop=true;stream.endTime=Infinity;}
      stream.rate=rate;return;
    }
    if(code===0x93) {
      const mode=bytes[position+6],kind=mode&15,length=view.getUint32(position+7,true);
      let count=null;
      if(!(mode&0x6c)) {
        if(kind===1)count=length;
        else if(kind===2&&stream.rate!==undefined)count=Math.floor(length*stream.rate/1000);
        else if(kind===0)count=stream.count??null;
      }
      if(count!==null)stream.count=count;
      stream.active=count!==0;stream.loop=Boolean(mode&128)||count===null;
      stream.endTime=count!==null&&stream.rate>0?time+Math.max(0,count-1)*44100/stream.rate:Infinity;
    } else if(code===0x95){stream.active=true;stream.loop=true;stream.endTime=Infinity;}
  }
  async function recordReady() {
    while(ready.length) {
      const job=ready.shift();abort(signal);
      const samples=new Uint8Array(job.count);
      for(let offset=0;offset<job.count;offset+=CHUNK) {
        samples.set(job.chunks[offset/CHUNK].subarray(0,Math.min(CHUNK,job.count-offset)),offset);
        if(offset&&offset%65536===0)await pause(signal);
      }
      const data=await encodeDdaDataAsync(samples,{signal});
      const key=JSON.stringify([data,job.spacing,job.mix.volume,job.mix.balance]);
      const previous=definitions.get(key);
      if(previous){previous.occurrences++;previous.warnings=[...new Set([...previous.warnings,...job.warnings])];continue;}
      if(definitions.size>=MAX_VOICES)throw new RangeError('Direct PCM import exceeds 4,096 different assets');
      const notes=['Direct DAC PCM: constant write spacing and an explicit end were recorded. C4 plays the captured timing; Loop and the original musical root are not inferred.',...job.warnings];
      const preset=createDefaultPreset();preset.source='dda';preset.envelope.enabled=false;preset.volume=job.mix.volume;
      preset.pan={left:job.mix.balance>>4,right:job.mix.balance&15};preset.name=`PCM CH${job.channel}`;
      preset.dda={name:preset.name,data,sampleRate:job.rate,rootNote:60,loop:false,speed:1};
      const voice={kind:'pcm',origin:'direct',channel:job.channel,firstTime:job.firstTime,occurrences:1,preset:readPreset(preset),warnings:notes};
      definitions.set(key,voice);
      for(const note of notes)warnings.add(note);
    }
  }
  for(let count=0;;count++) {
    abort(signal);if(count>=MAX_COMMANDS)throw new RangeError('VGM import exceeds four million commands');
    const position=parser.position,code=bytes[position];
    if(position>=bytes.length)throw new Error('Unexpected end of VGM data');
    let length;try{length=rawCommandLength(bytes,view,position);}catch(error){if(error instanceof RangeError)throw new Error('Truncated VGM command',{cause:error});throw error;}
    if(position+length>bytes.length)throw new Error('Truncated VGM command');
    if((code===0x67||code===0x68)&&bytes[position+1]!==0x66)throw new Error('Invalid VGM data block header');
    if(code===0x66)break;
    parser.position+=length;
    if(code===0xb9) {
      if(bytes[position+1]&128)throw new Error('Second HuC6280 chip writes are not supported');
      write(bytes[position+1],bytes[position+2]);
    } else if(code>=0x90&&code<=0x95)streamCommand(code,position);
    else if(code===0x61)advance(view.getUint16(position+1,true));
    else if(code===0x62)advance(735);
    else if(code===0x63)advance(882);
    else if(code>=0x70&&code<=0x7f)advance((code&15)+1);
    else if(code>=0x80&&code<=0x8f)advance(code&15);
    if(ready.length)await recordReady();
    if(count%4096===4095)await pause(signal);
  }
  for(const channel of channels)if(channel.region?.attempted)warn('DDA region reaches the VGM end without an explicit gate-off / DDA-disable');
  abort(signal);
  return {voices:[...definitions.values()],warnings:[...warnings]};
}
