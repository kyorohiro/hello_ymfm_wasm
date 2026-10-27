/** Neo Geo authoring stays in the shared YM2610/B helpers; Native owns synthesis. */
import {YM2610BSynth, YM2610BAdpcmBSynth, NeoGeoFMSynth} from './ym2610bsynth.js?v=pokey-mode-1';
import {encodeAdpcmB} from './adpcm_b_sample.js';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=pokey-mode-1';
import {CHIP_CLOCKS, validateChipClock} from './playground_chip_clock.js?v=pokey-mode-1';
import {createOfflineAudioDecoder} from './audio_decode.js';
import {decodeNativeGenesisPCM} from './native_genesis_media.js';

const MAX_MEMORY=0x1000000, CHUNK=65536;
const abort=()=>new DOMException('Native YM2610B operation was cancelled','AbortError');
const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`Invalid YM2610B ${label}`);return value;};
const keyChannel=channel=>channel<3?channel:channel+1;
const copyBytes=input=>{
  if(input instanceof ArrayBuffer)input=new Uint8Array(input);
  if(!(input instanceof Uint8Array))throw new TypeError('YM2610B memory requires Uint8Array or ArrayBuffer');
  if(input.byteLength>MAX_MEMORY)throw new RangeError('ADPCM memory exceeds 16 MiB');
  return input.slice();
};

/** Decode the applied register snapshot without writing it back to the chip. */
function appliedFm(registers,base){
  const state=structuredClone(base),slots=[0,8,4,12],special=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]];
  state.modeRegister=registers[0][0x27];state.lfo={enabled:!!(registers[0][0x22]&8),frequency:registers[0][0x22]&7};
  for(let channel=0;channel<6;channel++){
    const r=registers[channel<3?0:1],offset=channel%3,c=state.channels[channel],pan=r[0xb4+offset],pitch=r[0xa4+offset];
    Object.assign(c,{algorithm:r[0xb0+offset]&7,feedback:(r[0xb0+offset]>>3)&7,left:!!(pan&128),right:!!(pan&64),ams:(pan>>4)&3,pms:pan&7,block:(pitch>>3)&7,fnum:((pitch&7)<<8)|r[0xa0+offset]});
    for(let op=0;op<4;op++){
      const n=slots[op]+offset;
      Object.assign(c.operators[op],{dt:(r[0x30+n]>>4)&7,multi:r[0x30+n]&15,tl:r[0x40+n]&127,rs:(r[0x50+n]>>6)&3,ar:r[0x50+n]&31,am:!!(r[0x60+n]&128),d1r:r[0x60+n]&31,d2r:r[0x70+n]&31,sl:r[0x80+n]>>4,rr:r[0x80+n]&15,ssg:r[0x90+n]&15});
    }
    if(channel===2)c.specialFrequencies=special.map(([low,high])=>({block:(r[high]>>3)&7,fnum:((r[high]&7)<<8)|r[low]}));
  }
  return state;
}

export function createNativeGenesisYm2610B(synth,{
  variant=true,
  fetcher=globalThis.fetch?.bind(globalThis),
  decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>synth.clock.sampleRate}),
}={}){
  let clock=CHIP_CLOCKS.ym2610b,appliedClock=clock,enabled=false,nextCommand=0,collecting=null,uiSerial=Promise.resolve(),initializedSession=null,initializing=null;
  if(typeof variant!=='boolean')throw new TypeError('YM2610 variant must be boolean');
  const kind=variant?'ym2610b':'ym2610',fmChannels=variant?[0,1,2,3,4,5]:[1,2,4,5];
  const logicalChannel=value=>{
    if(typeof value==='number')return fmChannels[integer(value,fmChannels.length-1,'FM channel')];
    const match=/^(fm|ssg|adpcm-a|adpcm-b):(\d+)$/.exec(value);
    if(!match)throw new RangeError('Invalid YM2610/B keyboard channel');
    const channel=Number(match[2]),section=match[1];
    integer(channel,section==='fm'?fmChannels.length-1:section==='ssg'?2:section==='adpcm-a'?5:0,'keyboard channel');
    return section==='fm'?fmChannels[channel]:channel+({ssg:6,'adpcm-a':9,'adpcm-b':15})[section];
  };
  const channelName=channel=>channel<6?`fm:${fmChannels.indexOf(channel)}`:channel<9?`ssg:${channel-6}`:channel<15?`adpcm-a:${channel-9}`:'adpcm-b:0';
  const physicalChannel=channel=>{integer(channel,5,'physical FM channel');if(!fmChannels.includes(channel))throw new RangeError('Unavailable YM2610 physical FM channel');return channel;};
  const registers=[new Uint8Array(256),new Uint8Array(256)],held=new Map();
  const check=()=>{if(!synth.isReady())throw new Error('Native Neo Geo audio is not ready');if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation)throw abort();};
  const identify=message=>{if(nextCommand>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native YM2610B command identity limit reached');return {...message,id:++nextCommand};};
  const timed=(message,timing={})=>({type:'ym2610b',message,frame:timing.time===undefined?0:synth.frameAt(timing.time),...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  const send=(message,timing={})=>{check();synth.enqueue(timed(message,timing));};
  const write=(port,register,value)=>{
    integer(port,1,'port');integer(register,255,'register');integer(value,255,'value');
    if(!enabled)return;
    const message={method:'write',port,register,value};if(collecting)collecting.push(message);else send(message);
  };
  const rawFm=new YM2610BSynth({transport:{write,
    writeBatch:writes=>{for(const entry of writes)write(entry.port,entry.register,entry.value);},
    reset(){if(enabled){if(collecting)collecting.push({method:'reset'});else send({method:'reset'});}},
    loadAdpcmMemory:(kind,bytes,offset)=>upload(kind,bytes,offset),
  },clock});
  const client=variant?rawFm:new NeoGeoFMSynth(rawFm);
  if(!variant)Object.assign(client,{ssg:rawFm.ssg,adpcmA:rawFm.adpcmA,adpcmB:rawFm.adpcmB,adpcm:rawFm.adpcm,getState:()=>rawFm.getState()});
  const fmBase=rawFm.getState();
  const adoptClock=hz=>{clock=validateChipClock(hz);rawFm.ssg.clock=clock/4;rawFm.adpcmB.clock=clock;};
  Object.defineProperties(rawFm,{id:{value:kind,enumerable:true},clock:{configurable:true,enumerable:true,get:()=>clock},
    _adoptClock:{value:adoptClock},_getState:{value:()=>({...rawFm.getState(),clock,ssg:rawFm.ssg._getState(),adpcmA:{levels:Array.from(rawFm.adpcmA.levels)},adpcmB:{registers:Array.from(rawFm.adpcmB.registers)}})},
    _adoptState:{value:state=>{
      if(!state)return;if(state.clock!==undefined)adoptClock(state.clock);
      if(state.channels)rawFm.channels=structuredClone(state.channels);if(state.lfo)rawFm.lfo=structuredClone(state.lfo);if(state.modeRegister!==undefined)rawFm._modeRegister=state.modeRegister;
      if(state.ssg?.registers)client.ssg._adoptState(state.ssg);
      if(state.adpcmA?.levels)rawFm.adpcmA.levels.set(state.adpcmA.levels);
      if(state.adpcmB?.registers)rawFm.adpcmB.registers.set(state.adpcmB.registers);
    }},
    _stopVoices:{value:()=>dispatch({method:'stopVoices'})},
  });
  if(!variant)for(const name of ['id','_adoptClock','_getState','_adoptState','_stopVoices'])Object.defineProperty(client,name,{get:()=>rawFm[name]});
  rawFm.dispose=client.dispose=()=>{};
  rawFm.setClock=client.setClock=async hz=>{validateChipClock(hz);const token=capture();send({method:'clock',hz});await synth.flush();current(token);adoptClock(hz);};
  // Reads explicitly cross IPC; no sync facade fabricates register values.
  rawFm.read=client.read=async offset=>{integer(offset,3,'read offset');const data=await snapshot();if(offset===0)return data.status;if(offset===2)return data.statusHi;throw new Error('Native YM2610B supports status reads at offsets 0 and 2');};
  rawFm.readStatus=client.readStatus=async()=>client.read(0);rawFm.getIrq=client.getIrq=async()=>!!(await snapshot()).irq;

  async function upload(kind,input,offset=0,timing={},signal){
    integer(kind,1,'memory kind');const token=capture();timing.checkCurrent?.();
    const bytes=copyBytes(input);integer(offset,MAX_MEMORY,'memory address');signal?.throwIfAborted();
    if(bytes.length>MAX_MEMORY-offset)throw new RangeError('ADPCM memory exceeds 16 MiB');
    for(let start=0;start<bytes.length;start+=CHUNK){current(token);timing.checkCurrent?.();signal?.throwIfAborted();send({method:'memory',kind,offset:offset+start,data:Array.from(bytes.subarray(start,start+CHUNK))},{...timing,time:undefined});await synth.flush();current(token);timing.checkCurrent?.();signal?.throwIfAborted();}
  }
  // Stage decoding, resampling, encoding and register setup before touching the
  // current session. Padding is PCM silence with continuous ADPCM history.
  client.adpcmB.loadSample=async(source,options={})=>{
    const token=capture(),{address=0,signal}=options;integer(address,MAX_MEMORY-1,'sample address');if(address%256)throw new RangeError('ADPCM-B address must be 256-byte aligned');signal?.throwIfAborted();
    const pcm=await decodeNativeGenesisPCM(source,{decodeAudio:options.decodeAudio??decodeAudio,fetcher});current(token);signal?.throwIfAborted();
    const requested=options.sampleRate??Math.min(pcm.sampleRate,Math.floor(clock/144)),deltaN=Math.round(requested*144*65536/clock);
    if(!Number.isFinite(requested)||requested<=0||deltaN<1||deltaN>65535)throw new RangeError('ADPCM-B sample rate is outside the chip range');
    const actualRate=deltaN*clock/(144*65536),frames=Math.max(1,Math.round(pcm.channels[0].length*actualRate/pcm.sampleRate)),paddedFrames=Math.ceil(frames/512)*512;
    if(!Number.isSafeInteger(paddedFrames)||paddedFrames/2>MAX_MEMORY-address)throw new RangeError('Sample exceeds ADPCM-B memory');
    const mono=new Float32Array(paddedFrames);
    for(let i=0;i<frames;i++){
      const position=Math.min(i*pcm.sampleRate/actualRate,pcm.channels[0].length-1),first=Math.floor(position),fraction=position-first,next=Math.min(first+1,pcm.channels[0].length-1);
      for(const channel of pcm.channels)mono[i]+=(Math.max(-1,Math.min(1,channel[first]))*(1-fraction)+Math.max(-1,Math.min(1,channel[next]))*fraction)/pcm.channels.length;
    }
    const encoded=encodeAdpcmB({channels:[mono],sampleRate:actualRate},actualRate,MAX_MEMORY-address),operations=[];
    const staged=new YM2610BAdpcmBSynth({write:(register,value)=>operations.push({method:'write',port:0,register:0x10+register,value}),loadMemory:(bytes,offset)=>operations.push({method:'memory',bytes,offset})},clock);
    staged.registers.set(client.adpcmB.registers);staged.keyOff();operations.push({method:'memory',bytes:encoded.bytes,offset:address});staged.setSample({start:address,end:address+encoded.bytes.length});staged.setDeltaN(deltaN);
    for(const operation of operations){current(token);signal?.throwIfAborted();if(operation.method==='memory')await upload(1,operation.bytes,operation.offset,{},signal);else send(operation);}
    await synth.flush();current(token);signal?.throwIfAborted();client.adpcmB.registers.set(staged.registers);
    return {start:address,end:address+encoded.bytes.length,frames,paddedFrames,sampleRate:actualRate,deltaN,duration:paddedFrames/actualRate};
  };

  let inspector;
  const chip={writeRegister(register,value,port=0){if(!collecting)throw new Error('Native YM2610B inspector command outside an edit');collecting.push({method:'write',port,register,value});inspector?.observe(register,value,port);},reset(){}};
  const guard=createOpnAuditionGuard(chip,6);
  inspector=new OpnKeyboardInspector(chip,{kind,guard,clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000});

  function adopt(data,{adoptClient=false}={}){
    if(!Array.isArray(data?.registers)||data.registers.length!==2||data.registers.some(row=>!Array.isArray(row)||row.length!==256||row.some(v=>!Number.isInteger(v)||v<0||v>255))||!Array.isArray(data.pendingCommands)||data.pendingCommands.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('Native YM2610B returned an invalid snapshot');
    if(data.variant!==undefined&&data.variant!==kind||data.held!==undefined&&(!Array.isArray(data.held)||data.held.some(channel=>!Number.isInteger(channel)||channel<0||channel>15||channel<6&&!fmChannels.includes(channel))))throw new Error('Native YM2610B returned an invalid variant or held voice');
    validateChipClock(data.clock);appliedClock=data.clock;inspector.sampleRate=synth.clock.sampleRate;
    for(let port=0;port<2;port++){registers[port].set(data.registers[port]);inspector.registers[port].set(data.registers[port]);}
    for(let ch=0;ch<3;ch++)if(registers[0][8+ch]&31)inspector.levels[ch]=registers[0][8+ch]&31;
    if(registers[0][0x10]&128)inspector.adpcmRepeat=registers[0][0x10]&16;
    const fmState=appliedFm(registers,fmBase);
    if(adoptClient)client._adoptState({...fmState,clock:data.clock,ssg:{registers:data.registers[0].slice(0,16),levels:Array.from(inspector.levels)},adpcmA:{levels:data.registers[1].slice(8,14)},adpcmB:{registers:data.registers[0].slice(0x10,0x20)}});
    return {...data,...inspector.read(),registers:data.registers.map(row=>row.slice()),fmState,held:Array.isArray(data.held)?data.held.map(channelName):[...held.keys()]};
  }
  async function snapshot(args={}){const token=capture(),data=await synth.nativeRequest('native_genesis_ym2610b_status',args);current(token);adopt(data);return data;}
  async function read(args={}){return adopt(await snapshot(args));}
  function rawWrite(message){return {method:'write',port:integer(message.port,1,'port'),register:integer(message.register,255,'register'),value:integer(message.value,255,'value')};}
  async function dispatch(message,timing={}){
    const token=capture(),args=message.args??[];let value,type;
    if(Array.isArray(message)){
      // A related register group enters the transport atomically. Validation
      // completes before the first write, including malformed later entries.
      const commands=message.map(command=>{
        if(command.type==='write')return rawWrite(command);
        if(command.type==='reset')return {method:'reset'};
        throw new Error('Unsupported Native YM2610B register batch operation');
      });
      synth.enqueueMany(commands.map(command=>timed(command,timing)));await synth.flush();current(token);return;
    }
    if(!Array.isArray(args))throw new TypeError('YM2610B arguments must be an array');
    const method=message.method??message.type;
    if(method==='dispose')value=true;
    else if(['memory','loadAdpcmMemory'].includes(method)){await upload(method==='memory'?args[0]:message.memoryType,method==='memory'?args[1]:message.bytes,method==='memory'?(args[2]??0):(message.address??0),timing);type=method==='loadAdpcmMemory'?'adpcm-memory-loaded':undefined;}
    else if(['clock','chip-clock'].includes(method)){const hz=validateChipClock(method==='clock'?args[0]:message.clock);send({method:'clock',hz},timing);await synth.flush();current(token);adoptClock(hz);if(method==='chip-clock')return {type:'chip-clock-result',id:message.id,clock:hz};}
    else if(['clear-scheduled-writes','clear-dac-playback'].includes(method))value=true;
    else if(method==='source-mute'){const mask=integer(message.mask??args[0],7,'source mute mask');send({method:'source-mute',mask},timing);}
    else if(method==='clear-memory'){const kind=message.kind??args[0];if(kind!==undefined)integer(kind,1,'memory kind');send({method:'clear-memory',...(kind===undefined?{}:{kind})},timing);}
    else if(method==='write'||method==='rawWrite'){
      const [port,register,value]=message.type==='write'?[message.port,message.register,message.value]:args;
      send(rawWrite({port,register,value}),timing);
    }else if(method==='reset')send({method:'reset'},timing);
    else if(['stopVoices','clear-auditions'].includes(method)){send({method:'stop-voices'},timing);if(timing.performance===undefined)stopped();}
    else throw new Error(`Unsupported Native YM2610B operation: ${method}`);
    await synth.flush();current(token);return message.id===undefined?undefined:{id:message.id,...(type?{type}:{}),...(value===undefined?{}:{value})};
  }
  function stopped(){
    // Hardware Stop gates the SSG by writing zero levels. Keep the authored
    // level/envelope selection just as SSGSynth.keyOff does for a later keyOn.
    inspector.levels.set(client.ssg._getState().levels);
    if(client.adpcmB.registers[0]&128)inspector.adpcmRepeat=client.adpcmB.registers[0]&16;
    held.clear();inspector.held.clear();
  }
  async function auditionNoteOn(channel,block,fnum,voice){
    const token=capture();
    physicalChannel(channel);integer(block,7,'block');integer(fnum,2047,'F-NUM');
    if(!Number.isSafeInteger(voice)||voice<=0)throw new RangeError('Invalid YM2610B audition token');
    const port=channel<3?0:1,offset=channel%3,key=keyChannel(channel);
    send(identify({method:'batch',channel,voice,audition:true,action:'on',commands:[
      {method:'write',port:0,register:0x28,value:key},
      {method:'write',port,register:0xa4+offset,value:(block<<3)|(fnum>>8)},
      {method:'write',port,register:0xa0+offset,value:fnum&255},
      {method:'write',port:0,register:0x28,value:0xf0|key},
    ]}));await synth.flush();current(token);
  }
  async function auditionNoteOff(channel,voice){
    const token=capture();
    physicalChannel(channel);if(!Number.isSafeInteger(voice)||voice<=0)throw new RangeError('Invalid YM2610B audition token');
    send(identify({method:'batch',channel,voice,audition:true,action:'off',commands:[{method:'write',port:0,register:0x28,value:keyChannel(channel)}]}));await synth.flush();current(token);
  }
  async function invokeNow(method,args){
    const token=capture();await read();current(token);
    if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))throw new Error(`Unsupported Native YM2610B inspector operation: ${method}`);
    const previous=new Map(inspector.held);collecting=[];let result,commands;
    try{result=inspector.invoke(method,args);commands=collecting;}finally{collecting=null;}
    const groups=[];
    if(method==='auditionAllOff'){
      // Each lease is released independently; the callback ignores a retired
      // token even if another key replaced it before this batch was applied.
      for(const [name,lease]of previous){const channel=logicalChannel(name),key=channel<6?keyChannel(channel):null;
        const selected=commands.filter(op=>channel<6?op.port===0&&op.register===0x28&&(op.value&7)===key:channel<9?op.port===0&&op.register===8+channel-6:channel<15?op.port===1&&op.register===0&&(op.value&(1<<(channel-9))):op.port===0&&op.register===0x10);
        groups.push(identify({method:'batch',channel,audition:true,voice:lease.token,action:'off',commands:selected}));
      }
    }else{
      const channel=logicalChannel(args[0]),name=channelName(channel),lease=method==='auditionOn'?inspector.held.get(name):previous.get(name);
      if(commands.length&&lease)groups.push(identify({method:'batch',channel,audition:true,voice:lease.token,action:method==='auditionOn'?'on':'off',commands}));
    }
    for(const group of groups)send(group);await synth.flush();current(token);
    held.clear();for(const [name,lease]of inspector.held)held.set(name,lease);
    if(groups.length)await read({after:groups.at(-1).id});return result;
  }
  async function initialize(){
    const token=capture();enabled=true;if(initializedSession===token.session)return;
    rawFm.reset();await synth.flush();current(token);initializedSession=token.session;
  }
  return {client,dispatch,read,auditionNoteOn,auditionNoteOff,
    async invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=uiSerial.then(()=>{current(token);return invokeNow(method,copy);});uiSerial=result.catch(()=>{});return result;},
    async initialize(){
      const token=capture();
      if(initializing?.session===token.session&&initializing.generation===token.generation)return initializing.promise;
      const entry={...token,promise:initialize()};initializing=entry;
      try{return await entry.promise;}finally{if(initializing===entry)initializing=null;}
    },
    async loadSample(source,options={}){
      const token=capture();if(options.name!==undefined&&(typeof options.name!=='string'||!options.name.length||options.name.length>256))throw new TypeError('Sample name must contain 1..256 characters');
      if(options.kind!==undefined&&options.kind!==1&&options.kind!=='adpcm-b')throw new Error('Decoded Native YM2610/B samples support ADPCM-B; load encoded ADPCM-A with adpcmA.loadMemory');
      const sample=await client.adpcmB.loadSample(source,options);current(token);return {...sample,...(options.name===undefined?{}:{name:options.name})};
    },
    async mix(volume,pan){const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    stopped,adoptStopped(data){stopped();return adopt(data,{adoptClient:true});},
    reset(){stopped();inspector.levels.fill(0);inspector.adpcmRepeat=0;initializedSession=null;enabled=false;client._adoptState({...fmBase,clock:CHIP_CLOCKS.ym2610b,ssg:{registers:Array(16).fill(0),levels:[0,0,0]},adpcmA:{levels:Array(6).fill(0)},adpcmB:{registers:Array.from({length:16},(_,r)=>r===12||r===13?255:0)}});},
  };
}
