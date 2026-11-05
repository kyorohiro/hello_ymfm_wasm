// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {encodeDdaDataAsync, MAX_DDA_SAMPLES} from './dda_pcm.js';

// DAC stream control: VGM v1.71, and libvgm emu/dac_control.c.
// https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt
// https://github.com/ValleyBell/libvgm/blob/master/emu/dac_control.c
const MAX_COMMANDS=4_000_000, MAX_STARTS=100_000, MAX_VOICES=4096, MAX_BANK_BLOCKS=65_536;
const SCALE=[0,3,5,7,9,11,13,15,16,19,21,23,25,27,29,31];
const abort=signal=>{if(signal?.aborted)throw new DOMException('VGM import cancelled','AbortError');};
const pause=async signal=>{abort(signal);await new Promise(resolve=>setTimeout(resolve,0));abort(signal);};

/** Extract complete, independently playable HuC6280 DAC-stream assets.
 * This is a second passive pass over an already decoded and bounded VGM.
 * Direct timed register writes, changing-rate playback, compressed banks and
 * incomplete / overlapping playback are deliberately not flattened to PCM.
 * No song playback, inferred sample boundaries or pitch detection is performed.
 */
export async function extractVgmDacStreams(bytes,{signal}={}) {
  abort(signal);
  if(!(bytes instanceof Uint8Array)||bytes.length<64)throw new TypeError('Expected decoded VGM bytes');
  const parser=new Ym2612VGM(bytes,{logger:{warn:()=>{}}});
  if(parser.header.dataOffset<64||parser.header.dataOffset>=bytes.length)throw new Error('Invalid VGM data offset');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const warnings=new Set(), streams=new Map(), banks=new Map(), completed=new Map();
  const channels=Array.from({length:8},()=>({control:null,balance:null,noise:undefined}));
  let time=0,selected=null,globalBalance,lfoControl,starts=0,sampleBudget=0,bankBlocks=0;
  const warn=message=>warnings.add(message);
  const getBank=id=>{if(!banks.has(id))banks.set(id,{id,length:0,blocks:[],poisoned:false});return banks.get(id);};
  const omit=(stream,reason)=>{
    if(stream.job){warn(`PCM DAC stream omitted: ${reason}.`);stream.job=null;}
  };
  const applies=(stream,index)=>stream.chip===0x1b&&(stream.port===255||stream.port===index);
  function hazard(index,reason) {
    for(const stream of streams.values())if(stream.active&&(index===null||applies(stream,index)))omit(stream,reason);
  }
  function accept(job) {
    const key=JSON.stringify([job.bank.id,job.offset,job.count,job.step,job.reverse,job.rate,job.loop,job.volume,job.pan]);
    const previous=completed.get(key);
    if(previous){previous.occurrences++;previous.warnings=[...new Set([...previous.warnings,...job.warnings])];return;}
    if(completed.size>=MAX_VOICES)throw new RangeError('PCM import exceeds 4,096 different stream assets');
    sampleBudget+=job.count;
    if(sampleBudget>MAX_DDA_SAMPLES)throw new RangeError('PCM import exceeds 16,777,216 extracted DAC samples');
    completed.set(key,{...job,occurrences:1});
  }
  function finishDue() {
    for(const stream of streams.values()) {
      if(stream.job&&time>=stream.job.endTime&&stream.job.waited){accept(stream.job);stream.job=null;}
      if(stream.active&&!stream.loop&&time>=stream.endTime)stream.active=false;
    }
  }
  function invalidateDestination(stream) {
    if(stream.chip!==0x1b||!stream.active)return;
    const register=stream.register&15;
    if(stream.port!==255&&stream.register>>>4!==0) {
      hazard(null,'a nonstandard streamed channel-select write changes hardware state');
      selected=null;globalBalance=lfoControl=null;
      for(const channel of channels)channel.control=channel.balance=channel.noise=null;
      return;
    }
    if(register===0){selected=null;hazard(null,'another stream changes the channel selection');return;}
    if(register===1){globalBalance=null;hazard(null,'another stream changes global balance');return;}
    if(register===9){lfoControl=null;hazard(0,'another stream changes LFO state');hazard(1,'another stream changes LFO state');return;}
    const target=stream.port===255?selected:stream.port&7;
    if(register===4||register===5||register===7||register===6) {
      for(let index=0;index<channels.length;index++)if(target===null||index===target) {
        // The one supported case is an isolated PCM stream writing its DAC.
        if(register===6&&stream.supported)continue;
        const channel=channels[index];
        if(register===4)channel.control=null;
        else if(register===5)channel.balance=null;
        else if(register===7)channel.noise=null;
        hazard(index,'another stream changes the same channel');
      }
    }
  }
  function advance(samples) {
    if(!samples)return;
    for(const stream of streams.values())invalidateDestination(stream);
    for(const stream of streams.values())if(stream.job)stream.job.waited=true;
    time+=samples;finishDue();
  }
  function write(register,value) {
    register&=15;
    if(register===0){selected=value&7;return;}
    if(register===1){if(globalBalance!==value)hazard(null,'global balance changes during playback');globalBalance=value;return;}
    if(register===9){if(lfoControl!==value){hazard(0,'LFO state changes during playback');hazard(1,'LFO state changes during playback');}lfoControl=value;return;}
    if(selected===null){if([4,5,6,7].includes(register)){hazard(null,'a direct write has no known channel selection');for(const c of channels)c.control=c.balance=c.noise=null;}return;}
    const channel=channels[selected];
    if(register===4){if(channel.control!==value)hazard(selected,'channel control / level changes during playback');channel.control=value;}
    else if(register===5){if(channel.balance!==value)hazard(selected,'channel balance changes during playback');channel.balance=value;}
    else if(register===7){if(channel.noise!==value)hazard(selected,'Noise control changes during playback');channel.noise=value;}
    else if(register===6)hazard(selected,'direct DAC writes overlap the stream');
  }
  function start(stream,offset,mode,count) {
    if(++starts>MAX_STARTS)throw new RangeError('PCM import exceeds 100,000 stream starts');
    omit(stream,'the stream is restarted before a complete sample was observed');
    stream.active=false;stream.supported=false;
    if(stream.chip!==0x1b)return;
    // Unsupported but potentially writing starts still compete with later
    // streams. Keep them live until an explicit stop / destination reset.
    stream.active=stream.rate!==0;stream.loop=true;stream.endTime=Infinity;
    const bank=banks.get(stream.bank), kind=mode&15;
    const reason=message=>warn(`PCM DAC stream omitted: ${message}.`);
    if(mode&0x6c){reason('unsupported start-mode flags');return;}
    if(!Number.isInteger(stream.rate)||stream.rate<1||stream.rate>192000){reason('rate must be recorded in the supported 1–192,000 Hz range');return;}
    if(!stream.dataSet||!bank||bank.poisoned){reason(bank?.poisoned?'compressed data bank cannot be reconstructed by this importer':'matching uncompressed data bank / stream data setup is missing');return;}
    if(offset===0xffffffff){if(stream.offset===undefined){reason('previous data start was not recorded');return;}offset=stream.offset;}
    else offset+=stream.base;
    const available=Math.max(0,Math.floor((bank.length-1-offset)/stream.step)+1);
    if(kind===0){if(stream.count===undefined){reason('previous command count was not recorded');return;}count=stream.count;}
    else if(kind===2)count=Math.floor(count*stream.rate/1000);
    else if(kind===3)count=available;
    else if(kind!==1){reason('unsupported length mode');return;}
    stream.offset=offset;stream.count=count;
    stream.loop=Boolean(mode&128);stream.endTime=time+Math.max(0,count-1)*44100/stream.rate;
    // Keep unsupported destinations active: their writes can invalidate later
    // PCM starts, even when no asset can be reconstructed for that stream.
    stream.active=count>0;stream.endTime=Number.isFinite(stream.endTime)?stream.endTime:Infinity;
    if(stream.port>5||stream.register!==6){reason('only fixed CH1–CH6 register-6 DAC destinations are supported');invalidateDestination(stream);return;}
    if(!Number.isSafeInteger(count)||count<1||count>MAX_DDA_SAMPLES){reason('sample count is empty or exceeds 16,777,216');return;}
    if(count>available){reason('requested data extends beyond the recorded bank; no truncated full sample is fabricated');return;}
    const index=stream.port,channel=channels[index];
    if(channel.control===null||(channel.control&192)!==192||channel.balance===null){reason('known DDA enable / key-on, level and channel balance are required');return;}
    if(globalBalance===null){reason('global balance is unknown after streamed changes');return;}
    if(index<2&&(lfoControl===null||(lfoControl&3))){reason('active or unknown LFO routing affects CH1 / CH2');return;}
    if(index>=4&&(channel.noise===null||(channel.noise&128))){reason('active or unknown Noise overrides CH5 / CH6 DDA');return;}
    const balance=globalBalance??255,volume=channel.control&31;
    const attenuation=shift=>31-SCALE[balance>>shift&15]+31-volume+31-SCALE[channel.balance>>shift&15];
    if(attenuation(0)>=31&&attenuation(4)>=31){reason('the recorded channel is inaudible');return;}
    const other=[...streams.values()].filter(value=>value!==stream&&value.active&&applies(value,index));
    if(other.length){for(const value of other)omit(value,'multiple DAC streams overlap the same channel');reason('multiple DAC streams overlap the same channel');return;}
    const notes=['PCM asset from a recorded DAC stream. C4 plays the recorded rate; song notes, later driver automation and the final held DAC value are not replayed.'];
    if(globalBalance===undefined)notes.push('Global balance was not recorded; this audition assumes full global balance.');
    else if(globalBalance!==255)notes.push('Recorded global balance is not applied; this audition retains channel level / balance and uses full global balance.');
    if(index<2&&lfoControl===undefined)notes.push('LFO control was not recorded; this audition assumes the reset state, LFO off.');
    if(index>=4&&channel.noise===undefined)notes.push('Noise control was not recorded; this audition assumes the reset state, Noise off.');
    stream.supported=true;
    stream.job={bank,offset,count,step:stream.step,reverse:Boolean(mode&16),loop:stream.loop,rate:stream.rate,
      channel:index+1,volume,pan:{left:channel.balance>>4,right:channel.balance&15},firstTime:time,endTime:stream.endTime,waited:false,warnings:notes};
  }
  function command(code,position) {
    const id=bytes[position+1];
    if(code===0x94){for(const [key,stream] of streams)if(id===255||key===id){omit(stream,'stream stopped before all sample writes were observed');stream.active=false;}return;}
    if(id===255)return;
    if(code===0x90) {
      const previous=streams.get(id);if(previous)omit(previous,'stream destination is reconfigured during playback');
      const chip=bytes[position+2];
      if(chip===0x9b)throw new Error('Second HuC6280 DAC streams are not supported');
      streams.set(id,{...previous,chip,port:bytes[position+3],register:bytes[position+4],step:previous?.step??1,base:previous?.base??0,active:false,job:null});
      return;
    }
    const stream=streams.get(id);if(!stream)return;
    if(code===0x91){omit(stream,'stream data / stepping changes during playback');if(stream.active){stream.loop=true;stream.endTime=Infinity;}stream.bank=bytes[position+2];stream.step=bytes[position+3]||1;stream.base=bytes[position+4];stream.dataSet=true;}
    else if(code===0x92){const rate=view.getUint32(position+2,true);if(stream.rate!==rate){omit(stream,'stream rate changes during playback');if(stream.active){stream.loop=true;stream.endTime=Infinity;}}stream.rate=rate;}
    else if(code===0x93)start(stream,view.getUint32(position+2,true),bytes[position+6],view.getUint32(position+7,true));
    else if(code===0x95) {
      const bank=banks.get(stream.bank), block=bank?.blocks[view.getUint16(position+2,true)],flags=bytes[position+4];
      if(flags&0xee){warn('PCM DAC stream omitted: unsupported fast-start flags.');omit(stream,'unsupported fast-start flags');stream.active=stream.rate!==0;stream.supported=false;stream.loop=true;stream.endTime=Infinity;return;}
      if(!block||bank.poisoned){warn('PCM DAC stream omitted: fast-start block is missing or compressed.');omit(stream,'a missing fast-start block replaces playback');stream.active=Boolean(bank?.poisoned)&&stream.rate!==0;stream.supported=false;stream.loop=true;stream.endTime=Infinity;return;}
      const count=Math.max(0,Math.floor((block.data.length-1-stream.base)/stream.step)+1);
      start(stream,block.offset,1|((flags&1)<<7)|(flags&16),count);
    }
  }

  for(let count=0;;count++) {
    abort(signal);if(count>=MAX_COMMANDS)throw new RangeError('VGM import exceeds four million commands');
    finishDue();const position=parser.position,code=bytes[position];
    if(position>=bytes.length)throw new Error('Unexpected end of VGM data');
    let length;try{length=rawCommandLength(bytes,view,position);}catch(error){if(error instanceof RangeError)throw new Error('Truncated VGM command',{cause:error});throw error;}
    if(position+length>bytes.length)throw new Error('Truncated VGM command');
    if((code===0x67||code===0x68)&&bytes[position+1]!==0x66)throw new Error('Invalid VGM data block header');
    if(code===0x66)break;
    parser.position+=length;
    if(code===0x67) {
      const type=bytes[position+2],size=view.getUint32(position+3,true);
      if(type<=0x7e) {
        if(++bankBlocks>MAX_BANK_BLOCKS)throw new RangeError('PCM import exceeds 65,536 data bank blocks');
        const bank=getBank(type&63);
        if(size&0x80000000||type>=0x40){bank.poisoned=true;warn('PCM compressed or second-chip data banks are omitted; their offsets / block IDs are not guessed.');}
        else {const data=bytes.subarray(position+7,position+length);bank.blocks.push({offset:bank.length,data});bank.length+=data.length;}
      }
    } else if(code===0xb9) {
      if(bytes[position+1]&128)throw new Error('Second HuC6280 chip writes are not supported');
      write(bytes[position+1],bytes[position+2]);
    } else if(code>=0x90&&code<=0x95)command(code,position);
    else if(code===0x61)advance(view.getUint16(position+1,true));
    else if(code===0x62)advance(735);
    else if(code===0x63)advance(882);
    else if(code>=0x70&&code<=0x7f)advance((code&15)+1);
    else if(code>=0x80&&code<=0x8f)advance(code&15);
    if(count%4096===4095)await pause(signal);
  }
  finishDue();
  for(const stream of streams.values())omit(stream,'VGM ends before all sample writes were observed');
  const voices=[],definitions=new Map();let jobs=0;
  for(const job of completed.values()) {
    if(jobs++%16===15)await pause(signal);
    abort(signal);
    const samples=new Uint8Array(job.count);let blockIndex=0,blockWork=0;
    let offset=job.offset+(job.reverse?(job.count-1)*job.step:0);
    // Find the containing chunk without scanning every earlier bank block.
    let low=0,high=job.bank.blocks.length;
    while(low<high){const middle=(low+high)>>>1;if(job.bank.blocks[middle].offset<=offset)low=middle+1;else high=middle;}
    blockIndex=Math.max(0,low-1);
    let varied=false;
    for(let index=0;index<samples.length;index++) {
      while(blockIndex+1<job.bank.blocks.length&&offset>=job.bank.blocks[blockIndex].offset+job.bank.blocks[blockIndex].data.length){blockIndex++;if(++blockWork%4096===0)await pause(signal);}
      while(blockIndex>0&&offset<job.bank.blocks[blockIndex].offset){blockIndex--;if(++blockWork%4096===0)await pause(signal);}
      const block=job.bank.blocks[blockIndex];samples[index]=block.data[offset-block.offset]&31;
      if(index&&samples[index]!==samples[0])varied=true;
      offset+=job.reverse?-job.step:job.step;
      if(index&&index%65536===0)await pause(signal);
    }
    if(!varied){warn('PCM constant DAC streams are omitted because they contain no changing waveform.');continue;}
    const data=await encodeDdaDataAsync(samples,{signal});
    const key=JSON.stringify([data,job.rate,job.loop,job.volume,job.pan]);
    const previous=definitions.get(key);
    if(previous){previous.occurrences+=job.occurrences;previous.warnings=[...new Set([...previous.warnings,...job.warnings])];for(const note of job.warnings)warn(note);continue;}
    const preset=createDefaultPreset();preset.source='dda';preset.envelope.enabled=false;preset.volume=job.volume;preset.pan=job.pan;
    preset.name=`PCM CH${job.channel}`;
    preset.dda={name:preset.name,data,sampleRate:job.rate,rootNote:60,loop:job.loop,speed:1};
    const voice={kind:'pcm',channel:job.channel,firstTime:job.firstTime,occurrences:job.occurrences,preset:readPreset(preset),warnings:job.warnings};
    definitions.set(key,voice);voices.push(voice);
    for(const note of job.warnings)warn(note);
  }
  return {voices,warnings:[...warnings]};
}
