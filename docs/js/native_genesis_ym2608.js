/** PC-98 authoring stays in the shared YM2608 helpers; Native owns synthesis. */
import {YM2608Synth, YM2608AdpcmSynth} from './ym2608synth.js?v=wonderswan-pcm-timeline-1';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=wonderswan-pcm-timeline-1';
import {CHIP_CLOCKS, validateChipClock} from './playground_chip_clock.js?v=wonderswan-pcm-timeline-1';
import {createOfflineAudioDecoder} from './audio_decode.js';
import {decodeNativeGenesisPCM} from './native_genesis_media.js';

const MAX_MEMORY=0x200000, CHUNK=65536;
const abort=()=>new DOMException('Native YM2608 operation was cancelled','AbortError');
const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`Invalid YM2608 ${label}`);return value;};
const keyChannel=channel=>channel<3?channel:channel+1;
const logicalChannel=value=>{
  if(typeof value==='number')return integer(value,5,'FM channel');
  const match=/^(fm|ssg|rhythm|adpcm-b):(\d+)$/.exec(value);
  if(!match)throw new RangeError('Invalid YM2608 keyboard channel');
  const channel=Number(match[2]),section=match[1],max=section==='fm'||section==='rhythm'?5:section==='ssg'?2:0;
  integer(channel,max,'keyboard channel');return channel+({fm:0,ssg:6,rhythm:9,'adpcm-b':15})[section];
};
const channelName=channel=>channel<6?`fm:${channel}`:channel<9?`ssg:${channel-6}`:channel<15?`rhythm:${channel-9}`:'adpcm-b:0';
const copyBytes=input=>{
  if(input instanceof ArrayBuffer)input=new Uint8Array(input);
  if(!(input instanceof Uint8Array))throw new TypeError('YM2608 memory requires Uint8Array or ArrayBuffer');
  if(input.byteLength>MAX_MEMORY)throw new RangeError('ADPCM-B memory exceeds 2 MiB');
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

export function createNativeGenesisYm2608(synth,{
  fetcher=globalThis.fetch?.bind(globalThis),
  decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>synth.clock.sampleRate}),
  rhythmRomUrl=new URL('./tetorica_ym2608_adpcm_rom.bin',import.meta.url),
}={}){
  let clock=CHIP_CLOCKS.ym2608,appliedClock=clock,enabled=false,nextCommand=0,collecting=null,uiSerial=Promise.resolve(),romBytes=null,romRequest=null,initializedSession=null,initializing=null;
  const registers=[new Uint8Array(256),new Uint8Array(256)],held=new Map();
  const check=()=>{if(!synth.isReady())throw new Error('Native PC-98 audio is not ready');if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation)throw abort();};
  const identify=message=>{if(nextCommand>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native YM2608 command identity limit reached');return {...message,id:++nextCommand};};
  const timed=(message,timing={})=>({type:'ym2608',message,frame:timing.time===undefined?0:synth.frameAt(timing.time),...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  const send=(message,timing={})=>{check();synth.enqueue(timed(message,timing));};
  const write=(port,register,value)=>{
    integer(port,1,'port');integer(register,255,'register');integer(value,255,'value');
    if(!enabled)return;
    const message={method:'write',port,register,value};if(collecting)collecting.push(message);else send(message);
  };
  const client=new YM2608Synth({transport:{write,
    writeBatch:writes=>{for(const entry of writes)write(entry.port,entry.register,entry.value);},
    reset(){if(enabled){if(collecting)collecting.push({method:'reset'});else send({method:'reset'});}},
    loadRhythmRom:bytes=>upload('rom',bytes,0),loadAdpcmMemory:(bytes,offset)=>upload('memory',bytes,offset),
  },clock});
  const fmBase=client.getState();
  const adoptClock=hz=>{clock=validateChipClock(hz);client.ssg.clock=clock/4;client.adpcm.clock=clock;};
  Object.defineProperties(client,{id:{value:'ym2608',enumerable:true},clock:{configurable:true,enumerable:true,get:()=>clock},
    _adoptClock:{value:adoptClock},_getState:{value:()=>({...client.getState(),clock,ssg:client.ssg._getState(),rhythm:{levels:Array.from(client.rhythm.levels)},adpcm:{registers:Array.from(client.adpcm.registers)}})},
    _adoptState:{value:state=>{
      if(!state)return;if(state.clock!==undefined)adoptClock(state.clock);
      if(state.channels)client.channels=structuredClone(state.channels);if(state.lfo)client.lfo=structuredClone(state.lfo);if(state.modeRegister!==undefined)client._modeRegister=state.modeRegister;
      if(state.ssg?.registers)client.ssg._adoptState(state.ssg);
      if(state.rhythm?.levels)client.rhythm.levels.set(state.rhythm.levels);
      if(state.adpcm?.registers)client.adpcm.registers.set(state.adpcm.registers);
    }},
    _stopVoices:{value:()=>dispatch({method:'stopVoices'})},
  });
  client.dispose=()=>{};
  client.setClock=async hz=>{validateChipClock(hz);const token=capture();send({method:'clock',hz});await synth.flush();current(token);adoptClock(hz);};
  // Reads explicitly cross IPC; no sync facade fabricates register values.
  client.read=async offset=>{integer(offset,3,'read offset');const data=await snapshot();if(offset===0)return data.status;if(offset===2)return data.statusHi;throw new Error('Native YM2608 supports status reads at offsets 0 and 2');};
  client.readStatus=async()=>client.read(0);client.getIrq=async()=>!!(await snapshot()).irq;

  async function upload(method,input,offset=0,timing={}){
    const token=capture();timing.checkCurrent?.();const bytes=copyBytes(input);integer(offset,MAX_MEMORY,'memory address');
    if(method==='rom'&&(offset!==0||bytes.length!==8192))throw new RangeError('Rhythm ROM must be an 8192-byte Uint8Array');
    if(method==='memory'&&bytes.length>MAX_MEMORY-offset)throw new RangeError('ADPCM-B memory exceeds 2 MiB');
    for(let start=0;start<bytes.length;start+=CHUNK){current(token);timing.checkCurrent?.();send({method,offset:offset+start,data:Array.from(bytes.subarray(start,start+CHUNK))},{...timing,time:undefined});await synth.flush();current(token);timing.checkCurrent?.();}
  }
  // Reuse the public sample encoder and range setup, staging its operations so
  // cancellation during decoding cannot key off or reconfigure a new session.
  client.adpcm.loadSample=async(source,options={})=>{
    const token=capture(),{address=0,signal}=options;integer(address,MAX_MEMORY-1,'sample address');if(address%32)throw new RangeError('ADPCM-B address must be 32-byte aligned');signal?.throwIfAborted();
    const pcm=await decodeNativeGenesisPCM(source,{decodeAudio:options.decodeAudio??decodeAudio,fetcher});current(token);signal?.throwIfAborted();
    const operations=[],staged=new YM2608AdpcmSynth({write:(register,value)=>operations.push({method:'write',port:1,register,value}),loadMemory:(bytes,offset)=>operations.push({method:'memory',bytes,offset})},clock);
    staged.registers.set(client.adpcm.registers);
    const sample=await staged.loadSample(pcm,{...options,signal});current(token);signal?.throwIfAborted();
    for(const operation of operations){current(token);signal?.throwIfAborted();if(operation.method==='memory')await upload('memory',operation.bytes,operation.offset);else send(operation);}
    await synth.flush();current(token);signal?.throwIfAborted();client.adpcm.registers.set(staged.registers);return sample;
  };

  let inspector;
  const chip={writeRegister(register,value,port=0){if(!collecting)throw new Error('Native YM2608 inspector command outside an edit');collecting.push({method:'write',port,register,value});inspector?.observe(register,value,port);},reset(){}};
  const guard=createOpnAuditionGuard(chip,6);
  inspector=new OpnKeyboardInspector(chip,{kind:'ym2608',guard,clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000});

  function adopt(data,{adoptClient=false}={}){
    if(!Array.isArray(data?.registers)||data.registers.length!==2||data.registers.some(row=>!Array.isArray(row)||row.length!==256||row.some(v=>!Number.isInteger(v)||v<0||v>255))||!Array.isArray(data.pendingCommands)||data.pendingCommands.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('Native YM2608 returned an invalid snapshot');
    validateChipClock(data.clock);appliedClock=data.clock;inspector.sampleRate=synth.clock.sampleRate;
    for(let port=0;port<2;port++){registers[port].set(data.registers[port]);inspector.registers[port].set(data.registers[port]);}
    for(let ch=0;ch<3;ch++)if(registers[0][8+ch]&31)inspector.levels[ch]=registers[0][8+ch]&31;
    if(registers[1][0]&128)inspector.adpcmRepeat=registers[1][0]&16;
    const fmState=appliedFm(registers,fmBase);
    if(adoptClient)client._adoptState({...fmState,clock:data.clock,ssg:{registers:data.registers[0].slice(0,16),levels:Array.from(inspector.levels)},rhythm:{levels:data.registers[0].slice(0x18,0x1e)},adpcm:{registers:data.registers[1].slice(0,16)}});
    return {...data,...inspector.read(),registers:data.registers.map(row=>row.slice()),fmState,held:Array.isArray(data.held)?data.held.map(channelName):[...held.keys()]};
  }
  async function snapshot(args={}){const token=capture(),data=await synth.nativeRequest('native_genesis_ym2608_status',args);current(token);adopt(data);return data;}
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
        throw new Error('Unsupported Native YM2608 register batch operation');
      });
      synth.enqueueMany(commands.map(command=>timed(command,timing)));await synth.flush();current(token);return;
    }
    if(!Array.isArray(args))throw new TypeError('YM2608 arguments must be an array');
    const method=message.method??message.type;
    if(method==='dispose')value=true;
    else if(['rom','loadRhythmRom'].includes(method)){await upload('rom',method==='rom'?args[0]:message.bytes,0,timing);type=method==='loadRhythmRom'?'rhythm-rom-loaded':undefined;}
    else if(['memory','loadAdpcmMemory'].includes(method)){await upload('memory',method==='memory'?args[0]:message.bytes,method==='memory'?(args[1]??0):(message.address??0),timing);type=method==='loadAdpcmMemory'?'adpcm-memory-loaded':undefined;}
    else if(['clock','chip-clock'].includes(method)){const hz=validateChipClock(method==='clock'?args[0]:message.clock);send({method:'clock',hz},timing);await synth.flush();current(token);adoptClock(hz);if(method==='chip-clock')return {type:'chip-clock-result',id:message.id,clock:hz};}
    else if(['clear-scheduled-writes','clear-dac-playback'].includes(method))value=true;
    else if(method==='write'||method==='rawWrite'){
      const [port,register,value]=message.type==='write'?[message.port,message.register,message.value]:args;
      send(rawWrite({port,register,value}),timing);
    }else if(method==='reset')send({method:'reset'},timing);
    else if(['stopVoices','clear-auditions'].includes(method)){send({method:'stop-voices'},timing);if(timing.performance===undefined)stopped();}
    else throw new Error(`Unsupported Native YM2608 operation: ${method}`);
    await synth.flush();current(token);return message.id===undefined?undefined:{id:message.id,...(type?{type}:{}),...(value===undefined?{}:{value})};
  }
  function stopped(){
    // Hardware Stop gates the SSG by writing zero levels. Keep the authored
    // level/envelope selection just as SSGSynth.keyOff does for a later keyOn.
    inspector.levels.set(client.ssg._getState().levels);
    held.clear();inspector.held.clear();
  }
  async function auditionNoteOn(channel,block,fnum,voice){
    const token=capture();
    integer(channel,5,'FM channel');integer(block,7,'block');integer(fnum,2047,'F-NUM');
    if(!Number.isSafeInteger(voice)||voice<=0)throw new RangeError('Invalid YM2608 audition token');
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
    integer(channel,5,'FM channel');if(!Number.isSafeInteger(voice)||voice<=0)throw new RangeError('Invalid YM2608 audition token');
    send(identify({method:'batch',channel,voice,audition:true,action:'off',commands:[{method:'write',port:0,register:0x28,value:keyChannel(channel)}]}));await synth.flush();current(token);
  }
  async function invokeNow(method,args){
    const token=capture();await read();current(token);
    if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))throw new Error(`Unsupported Native YM2608 inspector operation: ${method}`);
    const previous=new Map(inspector.held);collecting=[];let result,commands;
    try{result=inspector.invoke(method,args);commands=collecting;}finally{collecting=null;}
    const groups=[];
    if(method==='auditionAllOff'){
      // Each lease is released independently; the callback ignores a retired
      // token even if another key replaced it before this batch was applied.
      for(const [name,lease]of previous){const channel=logicalChannel(name),key=channel<6?keyChannel(channel):null;
        const selected=commands.filter(op=>channel<6?op.port===0&&op.register===0x28&&(op.value&7)===key:channel<9?op.port===0&&op.register===8+channel-6:channel<15?op.port===0&&op.register===0x10&&(op.value&(1<<(channel-9))):op.port===1&&op.register===0);
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
    if(!romBytes){if(!romRequest){romRequest=(async()=>{if(!fetcher)throw new Error('YM2608 rhythm ROM requires fetch support');const response=await fetcher(rhythmRomUrl);if(!response.ok)throw new Error(`YM2608 rhythm ROM HTTP ${response.status}`);const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==8192)throw new RangeError('Expected 8192-byte rhythm ROM');return bytes;})();}
      try{romBytes=await romRequest;}finally{romRequest=null;}current(token);
    }
    await upload('rom',romBytes);current(token);client.reset();await synth.flush();current(token);initializedSession=token.session;
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
      const sample=await client.adpcm.loadSample(source,options);current(token);return {...sample,...(options.name===undefined?{}:{name:options.name})};
    },
    async mix(volume,pan){const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    stopped,adoptStopped(data){stopped();return adopt(data,{adoptClient:true});},
    reset(){stopped();inspector.levels.fill(0);inspector.adpcmRepeat=0;initializedSession=null;enabled=false;client._adoptState({...fmBase,clock:CHIP_CLOCKS.ym2608,ssg:{registers:Array(16).fill(0),levels:[0,0,0]},rhythm:{levels:Array(6).fill(0)},adpcm:{registers:Array.from({length:16},(_,r)=>r===12||r===13?255:0)}});},
  };
}
