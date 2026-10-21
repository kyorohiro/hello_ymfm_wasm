/** Native Mega-CD PCM controls. Only commands and one-off RAM uploads cross IPC. */
import {RF5C164Synth} from './rf5c164synth.js?v=audio-stability-2';
import {sampleBytes,encodeRf5c164} from './rf5c164_pcm.js';
import {RfInspectorState,rfSampleMetadata} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {CHIP_CLOCKS,validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {decodeNativeGenesisPCM} from './native_genesis_media.js';
import {createOfflineAudioDecoder} from './audio_decode.js';

const integer=(v,max,name)=>{if(!Number.isInteger(v)||v<0||v>max)throw new RangeError(`Invalid ${name}`);return v;};
const abort=()=>new DOMException('Native PCM operation was cancelled','AbortError');

/** Shared Main/Worker endpoint; all masks and register batches have one author. */
export function createNativeGenesisRf5c164(synth,{decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>synth.clock.sampleRate}),fetcher=globalThis.fetch?.bind(globalThis)}={}) {
  let clock=CHIP_CLOCKS.rf5c164,collecting=null,nextVoice=0;
  const auditionVoices=new Map();
  const allocateVoice=()=>{if(nextVoice>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native PCM voice lease limit exceeded');return ++nextVoice;};
  const check=()=>{
    if(!synth.isReady())throw new Error('Native Mega-CD audio is not ready');
    if(synth.stopping||synth.closing)throw abort();
  };
  const capture=()=>{check();return {session:synth.session,generation:synth.generation};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation)throw abort();};
  const chip={writeRegister(register,value){collecting.push({type:'rf5c164-write',register,value,frame:0});},
    loadMemory(bytes,address){collecting.push({type:'rf5c164-load-memory',offset:address,data:Array.from(bytes),frame:0});},
    reset(){collecting.push({type:'rf5c164-reset',frame:0});}};
  const inspector=new RfInspectorState({writeRegister(){},loadMemory(){},reset(){}},{clock:()=>clock,sampleRate:synth.clock.sampleRate||48000,
    dispatch:(command,owner)=>{
      const channel=command.args?.[0];let voice;
      if(command.method==='keyOn'){voice=allocateVoice();auditionVoices.set(channel,{owner,voice});}
      if(command.method==='keyOff'){const held=auditionVoices.get(channel);if(held?.owner===owner)voice=held.voice;}
      return perform(command.method,command.args??[],voice===undefined?{}:{voice});
    },endAudition:(channel,owner)=>{if(auditionVoices.get(channel)?.owner===owner)auditionVoices.delete(channel);}});
  const control=new RF5C164Synth({transport:{write:(...args)=>chip.writeRegister(...args),loadMemory:(...args)=>chip.loadMemory(...args),reset:()=>chip.reset()}});
  const timed=(command,timing)=>({...command,...(timing.time===undefined?{}:{frame:synth.frameAt(timing.time)}),
    ...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  function perform(method,args=[],timing={}) {
    check();if(collecting)throw new Error('Nested Native PCM command');
    const commands=[];collecting=commands;
    try {
      control.channelMask=inspector.mask;
      if(!['loadMemory','setChannel','setPitch','keyOn','keyOff','writeRegister','reset'].includes(method))throw new Error('Unsupported Native RF5C164 operation');
      control[method](...args);
      // Native note gates update only their physical channel. A cancelled owner
      // cannot have its old mask re-enable a different channel later.
      const voice=method==='keyOn'?(timing.voice??allocateVoice()):timing.voice;
      const normalized=['keyOn','keyOff'].includes(method)?commands.filter(c=>c.register!==8).concat({type:method==='keyOn'?'rf5c164-key-on':'rf5c164-key-off',channel:args[0],frame:0,...(voice===undefined?{}:{voice})}):commands;
      synth.enqueueMany(normalized.map(command=>timed(inspector.auditionWriting&&command.type==='rf5c164-write'?{...command,audition:true}:command,
        method==='loadMemory'?{...timing,time:undefined}:timing)));
      for(const command of commands){if(command.type==='rf5c164-write')inspector.write(command.register,command.value);else if(command.type==='rf5c164-load-memory')inspector.memoryWrite(command.offset,command.data.length);else if(command.type==='rf5c164-reset')inspector.reset();}
    } finally {collecting=null;}
    return synth.flush();
  }
  const client={
    id:'rf5c164',
    loadMemory(bytes,address=0){return perform('loadMemory',[sampleBytes(bytes).slice(),address]);},
    async loadSample(source,{address=0,loopStart,endGuardBytes=0}={}) {
      const token=capture();integer(address,65535,'address');integer(endGuardBytes,65536,'endGuardBytes');
      if(address%256)throw new RangeError('Start must be 256-byte aligned');
      const data=encodeRf5c164(source?.channels&&source.sampleRate?source:await decodeNativeGenesisPCM(source,{decodeAudio,fetcher}));current(token);
      let bytes=data.bytes;
      if(endGuardBytes){const length=data.frames+Math.max(3,endGuardBytes);if(address+length>65536)throw new RangeError('Sample exceeds RAM');bytes=new Uint8Array(length);bytes.set(data.bytes.subarray(0,data.frames));bytes.fill(255,data.frames);}
      if(address+bytes.length>65536)throw new RangeError('Sample exceeds RAM');
      const loop=loopStart===undefined?address+data.frames+1:address+integer(loopStart,data.frames-1,'loopStart');
      const step=Math.max(1,Math.min(65535,Math.round(data.step*CHIP_CLOCKS.rf5c164/clock)));
      await perform('loadMemory',[bytes,address]);current(token);inspector.addSample(address,bytes,{frames:data.frames,step,loopStart:loop,...(endGuardBytes?{endGuardBytes}:{})});
      return {start:address,loopStart:loop,step};
    },
    setChannel:(channel,options)=>perform('setChannel',[channel,options]),setPitch:(channel,step)=>perform('setPitch',[channel,step]),
    keyOn:channel=>perform('keyOn',[channel]),keyOff:channel=>perform('keyOff',[channel]),writeRegister:(register,value)=>perform('writeRegister',[register,value]),
    reset:()=>perform('reset'),
    async setClock(hz){validateChipClock(hz);const token=capture();synth.enqueue({type:'rf5c164-clock',hz,frame:0});await synth.flush();current(token);clock=hz;},
    // The owner is NativeGenesisSynth. Disposing a borrowed script handle must
    // not release its device or mute voices belonging to another script.
    dispose(){},
  };
  Object.defineProperties(client,{clock:{enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}},
    _stopVoices:{value:()=>{
      if(synth.stopping)return synth.stopping;
      if(synth.closing||!synth.isReady())return Promise.resolve();
      inspector.resetAuditions();inspector.mask=255;control.channelMask=255;
      synth.enqueueMany(Array.from({length:8},(_,channel)=>({type:'rf5c164-key-off',channel,frame:0})));return synth.flush();
    }}});
  return {client,
    async dispatch(message,timing={}) {
      const token=capture();
      const method=message.method,args=message.args??[];
      if(!Array.isArray(args))throw new TypeError('RF5C164 arguments must be an array');
      if(method==='clock'){validateChipClock(args[0]);synth.enqueue(timed({type:'rf5c164-clock',hz:args[0],frame:0},timing));await synth.flush();current(token);clock=args[0];return;}
      if(method==='stopVoices'){
        synth.enqueueMany(Array.from({length:8},(_,channel)=>timed({type:'rf5c164-key-off',channel,frame:0},timing)));
        await synth.flush();current(token);return;
      }
      if(method==='dispose')return;
      await perform(method,args,timing);
      current(token);
      if(method==='loadMemory'&&args[2])inspector.addSample(args[1]??0,args[0],args[2]);
    },
    async read() {
      const token=capture();const applied=await synth.nativeRequest('native_genesis_rf5c164_status');current(token);
      if(!applied||!Array.isArray(applied.channels)||applied.channels.length!==8)throw new Error('Native RF5C164 returned an invalid snapshot');
      inspector.sampleRate=synth.clock.sampleRate;
      const {clock:appliedClock,sampleRate,channels,enabled,mask,selected,frame}=applied;
      return {...inspector.read(),clock:appliedClock,sampleRate,channels,enabled,mask,selected,frame,kind:'rf5c164'};
    },
    async invoke(method,args=[]) {
      const token=capture();
      if(['auditionOn','auditionOff','auditionAllOff'].includes(method)){
        const applied=await this.read();
        current(token);
        for(const channel of applied.channels)if(Number.isInteger(channel.configuredStep))inspector.configuredSteps[channel.channel]=channel.configuredStep;
        else if(inspector.configuredSteps[channel.channel]===0&&!inspector.auditions.has(channel.channel))inspector.configuredSteps[channel.channel]=channel.step;
        inspector.channels=applied.channels.map(channel=>({...channel,pan:{...channel.pan}}));inspector.mask=applied.mask;inspector.enabled=applied.enabled;
        const result=inspector.invoke(method,args);await synth.flush();return result;
      }
      await perform(method,args);return true;
    },
    async loadSample(source,options={}) {
      const token=capture();const selected={name:options.name??'Sample',address:options.address,loopStart:options.loopStart};
      if(typeof selected.name!=='string'||!selected.name.length||selected.name.length>256)throw new TypeError('Sample name must contain 1..256 characters');
      if(selected.address!==undefined&&(integer(selected.address,65535,'address')%256))throw new RangeError('Start must be 256-byte aligned');
      const data=encodeRf5c164(source?.channels&&source.sampleRate?source:await decodeNativeGenesisPCM(source,{decodeAudio,fetcher}));current(token);
      rfSampleMetadata(data.bytes,{frames:data.frames,step:data.step,name:selected.name});
      const address=inspector.allocate(data.bytes.length,selected.address),loopStart=selected.loopStart===undefined?address+data.frames+1:address+integer(selected.loopStart,data.frames-1,'loopStart');
      const step=Math.max(1,Math.min(65535,Math.round(data.step*CHIP_CLOCKS.rf5c164/clock)));
      await perform('loadMemory',[data.bytes,address]);current(token);
      const sample=inspector.addSample(address,data.bytes,{frames:data.frames,step,name:selected.name,loopStart});return {...sample,start:address};
    },
    stopped(){inspector.resetAuditions();inspector.mask=255;control.channelMask=255;},
    reset(){inspector.reset();inspector.samples=[];inspector.memoryRanges=[];inspector.memoryRevision=0;control.channelMask=255;clock=CHIP_CLOCKS.rf5c164;},
  };
}
