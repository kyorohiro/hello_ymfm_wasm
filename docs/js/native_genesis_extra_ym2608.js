import {YM2608Synth, YM2608AdpcmSynth} from './ym2608synth.js?v=native-extra-opl3-1';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=native-extra-opl3-1';
import {validateChipClock,CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-msx-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-opl3-1';
import {createOfflineAudioDecoder} from './audio_decode.js';
import {decodeNativeGenesisPCM} from './native_genesis_media.js';
import {trackSsgRetainedLevels} from './opn_ssg_retained.js?v=native-extra-opl3-1';

// Host ROM loading must stay outside Run's user-code network guard.
const hostFetch=globalThis.fetch?.bind(globalThis);

export const EXTRA_YM2608_CLOCK_HELD_ERROR='Release the manually held additional YM2608 voices before changing the clock';
export const EXTRA_YM2608_TIMELINE_BUSY_ERROR='Native YM2608 timeline already playing or pending';
const CLOCK=CHIP_CLOCKS.ym2608,MAX_TIMELINE_EVENTS=131072,MAX_MEMORY=0x200000,MAX_TIMELINE_BYTES=8*1024*1024;
const FM_EDITS=new Set(['setPreset','setOperator','setOperators','setAlgo','setPan','setModulation','setFrequency','setNote','setBlockFnum','setChannel3SpecialMode','setChannel3SpecialFrequency','setLfo']);
const SSG_EDITS=new Set(['write','reset','tone','setFrequency','setNote','noise','setTonePeriod','setMixer','setVolume','setEnvelope']);
const RHYTHM_EDITS=new Set(['setVolume','setVoice','reset']);
const ADPCM_EDITS=new Set(['setSample','setDeltaN','setPlaybackRate','setVolume','setPan','reset']);
const logical=value=>{if(typeof value==='number')return integer(value,5,'FM channel');const m=/^(fm|ssg|rhythm|adpcm-b):(\d+)$/.exec(value);if(!m)throw new RangeError('Invalid YM2608 keyboard channel');const n=Number(m[2]),max=m[1]==='fm'||m[1]==='rhythm'?5:m[1]==='ssg'?2:0;return integer(n,max,'Keyboard channel')+({fm:0,ssg:6,rhythm:9,'adpcm-b':15})[m[1]];};
const channelName=ch=>ch<6?`fm:${ch}`:ch<9?`ssg:${ch-6}`:ch<15?`rhythm:${ch-9}`:'adpcm-b:0';
const abort=()=>new DOMException('Native additional YM2608 operation was cancelled','AbortError');
function physical(command,fallback=0){
  if(command.method==='set-retained-level')return command.channel+6;
  if(command.method==='key-off')return command.channel;
  if(command.method!=='write')return fallback;
  const {port:p,register:r,value:v}=command;
  if(p===1&&r<16)return 15;
  if(p===0){if(r<=5)return 6+(r>>1);if(r>=8&&r<=10)return 6+r-8;if(r>=0x18&&r<=0x1d)return 9+r-0x18;if(r===0x10){for(let ch=0;ch<6;ch++)if(v&(1<<ch))return 9+ch;}if(r===0x28)return (v&3)+(v&4?3:0);if(r>=0x24&&r<=0x27||r>=0xa8&&r<=0xae)return 2;}
  if(r>=0x30&&r<=0xb6&&(r&3)<3)return (r&3)+p*3;
  return fallback;
}
function appliedFm(registers,base){
  const state=structuredClone(base),slots=[0,8,4,12],special=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]];
  state.modeRegister=registers[0][0x27];state.lfo={enabled:!!(registers[0][0x22]&8),frequency:registers[0][0x22]&7};
  for(let ch=0;ch<6;ch++){
    const r=registers[ch<3?0:1],n=ch%3,c=state.channels[ch],pitch=r[0xa4+n],pan=r[0xb4+n];Object.assign(c,{algorithm:r[0xb0+n]&7,feedback:r[0xb0+n]>>3&7,block:pitch>>3&7,fnum:(pitch&7)<<8|r[0xa0+n],left:!!(pan&128),right:!!(pan&64),ams:pan>>4&3,pms:pan&7});
    for(let op=0;op<4;op++){const k=slots[op]+n;Object.assign(c.operators[op],{dt:r[0x30+k]>>4&7,multi:r[0x30+k]&15,tl:r[0x40+k]&127,rs:r[0x50+k]>>6&3,ar:r[0x50+k]&31,am:!!(r[0x60+k]&128),d1r:r[0x60+k]&31,d2r:r[0x70+k]&31,sl:r[0x80+k]>>4,rr:r[0x80+k]&15,ssg:r[0x90+k]&15});}
    if(ch===2)c.specialFrequencies=special.map(([lo,hi])=>({block:r[hi]>>3&7,fnum:(r[hi]&7)<<8|r[lo]}));
  }return state;
}

/** Independently owned OPNA: FM6, SSG3, fixed rhythm6 and ADPCM-B. */
export function createNativeGenesisYm2608Endpoint(synth,{fetcher=hostFetch,decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>synth.clock.sampleRate}),rhythmRomUrl=new URL('./tetorica_ym2608_adpcm_rom.bin',import.meta.url)}={}){
  const context=createNativeVoiceContext(synth,{backend:'extra-ym2608',statusCommand:'native_genesis_extra_ym2608_status',label:'additional YM2608'});
  const {capture,current}=context;let clock=CLOCK,appliedClock=CLOCK,initialized=false,collecting=null,uiSerial=Promise.resolve(),clockSerial=Promise.resolve(),activeTimeline=null,preparedTimeline=null,lastTimelineFence=0,mainGroup,mainCsmGroup,romController=null;
  const mainSsgGroups=Array(3).fill(undefined),operations=new Set();
  const tagged=message=>{
    const value={...(mainGroup===undefined?{}:{group:mainGroup}),...message};
    if(value.method==='write'&&value.port===0){
      if(value.register===0x27)mainCsmGroup=(value.value&0x81)===0x81?value.group:undefined;
      if(value.register>=8&&value.register<=10)mainSsgGroups[value.register-8]=value.value&31?value.group:undefined;
    }return value;
  };
  const timed=(message,timing)=>context.timed('ym2608',tagged(message),timing),send=(message,timing)=>context.send('ym2608',tagged(message),timing);
  const rawWrite=({port=0,register,value})=>({method:'write',port:integer(port,1,'YM2608 port'),register:integer(register,255,'Register'),value:integer(value,255,'Value')});
  function cancelCompletion(reason=abort()){const pending=activeTimeline;if(!pending)return;activeTimeline=null;clearTimeout(pending.timer);pending.reject(reason);}
  const client=new YM2608Synth({clock,transport:{write:(port,register,value)=>send(rawWrite({port,register,value})),
    writeBatch:writes=>{const commands=writes.map(rawWrite);if(context.isEnabled('ym2608'))synth.enqueueMany(commands.map(command=>timed(command)));},
    loadRhythmRom:bytes=>upload('rom',bytes),loadAdpcmMemory:(bytes,offset)=>upload('memory',bytes,offset),
    reset:()=>{cancelOperations(()=>true);cancelCompletion(new Error('Timeline cancelled'));const id=context.isEnabled('ym2608')?context.identity():undefined;if(id)lastTimelineFence=id;send({method:'reset',...(id?{id}:{})});},
  }});
  const base=client.getState();
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},
    _getState:{value:()=>({...client.getState(),clock,ssg:client.ssg._getState(),rhythm:{levels:Array.from(client.rhythm.levels)},adpcm:{registers:Array.from(client.adpcm.registers)}})},
    _adoptClock:{value:hz=>{clock=validateChipClock(hz);client.ssg.clock=clock/4;client.adpcm.clock=clock;}},
    _adoptState:{value:state=>{if(!state)return;if(state.clock!==undefined)client._adoptClock(state.clock);if(state.channels)client.channels=structuredClone(state.channels);if(state.modeRegister!==undefined)client._modeRegister=state.modeRegister;if(state.lfo)client.lfo=structuredClone(state.lfo);if(state.ssg?.registers)client.ssg._adoptState(state.ssg);if(state.rhythm?.levels)client.rhythm.levels.set(state.rhythm.levels);if(state.adpcm?.registers)client.adpcm.registers.set(state.adpcm.registers);}},
  });
  trackSsgRetainedLevels(client,(channel,level)=>send({method:'set-retained-level',channel,level}));
  let inspector;
  const chip={writeRegister(register,value,port=0){if(!collecting)throw new Error('YM2608 inspector command outside an edit');collecting.push(rawWrite({port,register,value}));inspector?.observe(register,value,port);},reset(){}};
  const guard=createOpnAuditionGuard(chip,6);
  inspector=new OpnKeyboardInspector(chip,{kind:'ym2608',guard,clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000});
  const notify=()=>synth.emit?.({type:'native-state',name:'fm',state:client._getState()});
  function adopt(data){
    if(!Array.isArray(data.registers)||data.registers.length!==2)throw new Error('Native additional YM2608 returned invalid registers');
    for(const row of data.registers)nativeSnapshotArray(row,256,255,'YM2608 registers');nativeSnapshotArray(data.keyMasks,6,15,'YM2608 key masks');nativeSnapshotArray(data.ssgLevels,3,31,'YM2608 retained SSG levels');context.validateHeld(data,15);
    if(![2,3,6].includes(data.prescaler)||!Array.isArray(data.ssgGates)||data.ssgGates.length!==3||data.ssgGates.some(g=>typeof g!=='boolean')||typeof data.irq!=='boolean')throw new Error('Native additional YM2608 returned invalid gates or prescaler');
    integer(data.status,255,'Status');integer(data.statusHi,255,'High status');appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;for(let p=0;p<2;p++)inspector.registers[p].set(data.registers[p]);inspector.levels.set(data.ssgLevels);if(data.registers[1][0]&128)inspector.adpcmRepeat=data.registers[1][0]&16;
    return {...data,...inspector.read(),registers:data.registers.map(row=>row.slice()),fmState:appliedFm(data.registers,base),held:(data.held??[...inspector.held.keys()].map(logical)).map(channelName)};
  }
  const snapshot=async(args={})=>{const data=await context.snapshot('ym2608',args);adopt(data);return data;},read=async(args={})=>adopt(await snapshot(args));
  client.read=async offset=>{integer(offset,3,'Read offset');if(offset!==0&&offset!==2)throw new Error('Native YM2608 supports status reads at offsets 0 and 2');const data=await snapshot();return offset===0?data.status:data.statusHi;};
  client.readStatus=()=>client.read(0);client.getIrq=async()=>!!(await snapshot()).irq;
  const identified=message=>({...message,id:context.identity()});
  function translate(message){
    const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('YM2608 arguments must be an array');
    if(method==='write'||method==='rawWrite')return rawWrite(message.type==='write'?message:{port:args[0],register:args[1],value:args[2]});
    if(method==='setRetainedLevel'||method==='ssg-retained-level')return {method:'set-retained-level',channel:integer(message.channel??args[0],2,'SSG channel'),level:integer(message.level??args[1],31,'Retained level')};
    if(method==='reset')return {method:'reset'};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],15,'YM2608 voice')};
    if(method==='cancelCsm')return {method:'cancel-csm'};
    if(method==='stopVoices'||method==='clear-auditions')return {method:'stop-voices'};
    throw new Error(`Unsupported Native additional YM2608 operation: ${method}`);
  }
  function clockCommand(hz,timing={},reply){
    const token=capture();validateChipClock(hz);timing.checkCurrent?.();
    const result=clockSerial.then(async()=>{current(token);timing.checkCurrent?.();await synth.flush();current(token);timing.checkCurrent?.();const command=identified({method:'clock',hz});send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();const data=await snapshot({after:command.id});current(token);timing.checkCurrent?.();if(data.clock!==hz)throw new Error('Native additional YM2608 clock was not applied');client._adoptClock(hz);notify();return reply?.();});clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  function cancelOperations(matches){for(const operation of operations)if(matches(operation)){operation.cancelled=true;operation.controller?.abort();}}
  function operation(timing={},group=mainGroup){
    const token=capture(),value={group,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(value);
    value.check=()=>{current(token);timing.checkCurrent?.();if(value.cancelled)throw abort();};
    value.done=()=>operations.delete(value);return value;
  }
  function bytesCopy(input){if(input instanceof ArrayBuffer)input=new Uint8Array(input);if(!(input instanceof Uint8Array))throw new TypeError('YM2608 memory requires Uint8Array or ArrayBuffer');if(input.length>MAX_MEMORY)throw new RangeError('ADPCM-B memory exceeds 2 MiB');return input.slice();}
  async function upload(method,input,offset=0,timing={},existing){
    const op=existing??operation(timing);try{op.check();const bytes=bytesCopy(input);integer(offset,MAX_MEMORY,'Memory address');
      if(method==='rom'&&(offset!==0||bytes.length!==8192))throw new RangeError('Rhythm ROM must be an 8192-byte Uint8Array');
      if(method==='memory'&&bytes.length>MAX_MEMORY-offset)throw new RangeError('ADPCM-B memory exceeds 2 MiB');
      op.check();send({method,offset,data:Array.from(bytes),...(op.group===undefined?{}:{group:op.group})},{...timing,time:undefined});await synth.flush();op.check();
    }finally{if(!existing)op.done();}
  }
  // Stage decoding and range writes. A cancelled decode cannot reconfigure a
  // replacement owner or upload more chunks after its cancellation fence.
  client.adpcm.loadSample=async(source,options={})=>{
    const op=operation(),{address=0,signal}=options;try{
      integer(address,MAX_MEMORY-1,'Sample address');if(address%32)throw new RangeError('ADPCM-B address must be 32-byte aligned');signal?.throwIfAborted();op.check();
      const pcm=await decodeNativeGenesisPCM(source,{decodeAudio:options.decodeAudio??decodeAudio,fetcher});op.check();signal?.throwIfAborted();
      const commands=[],staged=new YM2608AdpcmSynth({write:(register,value)=>commands.push(rawWrite({port:1,register,value})),loadMemory:(bytes,offset)=>commands.push({method:'memory',bytes,offset})},clock);
      staged.registers.set(client.adpcm.registers);const result=await staged.loadSample(pcm,options);op.check();signal?.throwIfAborted();
      for(const command of commands){op.check();signal?.throwIfAborted();if(command.method==='memory')await upload('memory',command.bytes,command.offset,{},op);else send({...command,...(op.group===undefined?{}:{group:op.group})});}
      await synth.flush();op.check();signal?.throwIfAborted();client.adpcm.registers.set(staged.registers);return result;
    }finally{op.done();}
  };
  let prepareSerial=Promise.resolve();
  function prepareTimeline(input,sourceBlocks,durationSamples,timing={}){
    let events,blocks,op;
    try{
      op=operation(timing);op.check();if(activeTimeline)throw new Error('YM2608 timeline is playing');
      if(!Array.isArray(input)||input.length>MAX_TIMELINE_EVENTS||!Array.isArray(sourceBlocks)||!Number.isSafeInteger(durationSamples)||durationSamples<=0)throw new RangeError('Invalid YM2608 timeline or event limit (131072)');
      let total=input.length*32+sourceBlocks.length*24+256;blocks=sourceBlocks.map(block=>{if(!(block instanceof Uint8Array)||block.length>MAX_MEMORY)throw new TypeError('Invalid ADPCM block');total+=block.length;if(total>MAX_TIMELINE_BYTES)throw new RangeError('Native YM2608 timeline payload exceeds 8 MiB');return block.slice();});
      let previous=0;events=input.map(entry=>{if(!Array.isArray(entry)||entry.length!==4||!entry.every(Number.isSafeInteger))throw new TypeError('Invalid timeline event');const [sample,port,r,v]=entry;if(sample<previous||sample>durationSamples||port<0||port>2)throw new RangeError('Invalid timeline position');previous=sample;if(port===2){if(!blocks[r]||v<0||v+blocks[r].length>MAX_MEMORY)throw new RangeError('Invalid ADPCM range');}else{integer(r,255,'Register');integer(v,255,'Value');}return [...entry];});
      const positions=events.map(e=>Math.ceil(e[0]*synth.clock.sampleRate/44100));let begin=0,writes=0,memory=0;
      for(let i=0;i<events.length;i++){writes+=events[i][1]===2?0:1;memory+=events[i][1]===2?blocks[events[i][2]].length:0;while(positions[i]-positions[begin]>=128){writes-=events[begin][1]===2?0:1;memory-=events[begin][1]===2?blocks[events[begin][2]].length:0;begin++;}if(writes>256||memory>4*1024*1024)throw new RangeError('Native YM2608 timeline exceeds 256 writes or 4194304 memory bytes in 128 output frames');}
      if(!Number.isSafeInteger(Math.ceil(durationSamples*synth.clock.sampleRate/44100)))throw new RangeError('YM2608 timeline exceeds Native frame limits');
    }catch(error){op?.done();return Promise.reject(error);}
    const fence=lastTimelineFence,result=prepareSerial.then(async()=>{try{op.check();if(fence){await synth.flush();op.check();await snapshot({after:fence});op.check();}const command=identified({method:'prepare-timeline',events,blocks:blocks.map(b=>Array.from(b)),durationSamples,...(op.group===undefined?{}:{group:op.group})});send(command,{...timing,time:undefined});await synth.flush();op.check();await snapshot({after:command.id});op.check();preparedTimeline={durationSamples};}finally{op.done();}});prepareSerial=result.catch(()=>{});return result;
  }
  function playTimeline(timing={}){
    let entry,token;
    try{token=capture();timing.checkCurrent?.();if(activeTimeline)throw new Error('YM2608 timeline unavailable or already playing');entry={token:context.identity(),id:context.identity(),fence:lastTimelineFence,group:mainGroup,performance:timing.performance,owner:timing.owner,timer:null,reject:null};}catch(error){return Promise.reject(error);}
    return new Promise((resolve,reject)=>{
      entry.reject=reject;activeTimeline=entry;
      const valid=()=>{current(token);timing.checkCurrent?.();if(activeTimeline!==entry)throw abort();};
      const finish=async()=>{try{valid();const data=await snapshot();valid();const state=data.timeline;
        if(data.pendingCommands?.includes(entry.id)||state?.token===entry.token&&(state.pending||state.playing)){entry.timer=setTimeout(finish,50);return;}
        activeTimeline=null;if(state?.token===entry.token&&state.ended&&!state.cancelled)resolve();else reject(new Error(state?.error??'Timeline cancelled'));
      }catch(error){if(activeTimeline===entry)activeTimeline=null;reject(error);}};
      Promise.resolve().then(async()=>{
        await prepareSerial;valid();await synth.flush();valid();const state=(await snapshot(entry.fence?{after:entry.fence}:{})).timeline;valid();if(!state?.prepared||!Number.isSafeInteger(state.durationSamples)||state.durationSamples<=0)throw new Error('YM2608 timeline unavailable or already playing');
        const duration=state.durationSamples,frames=Math.ceil(duration*synth.clock.sampleRate/44100),start=synth.frameAt(timing.time??synth.clock.currentTime);if(!Number.isSafeInteger(start+frames))throw new RangeError('YM2608 timeline exceeds Native frame limits');
        send({method:'play-timeline',token:entry.token,id:entry.id,...(entry.group===undefined?{}:{group:entry.group})},timing);await synth.flush();valid();
        const delay=Math.max(0,(timing.time??synth.clock.currentTime)-synth.clock.currentTime)+duration/44100;entry.timer=setTimeout(finish,Math.max(1,Math.min(2147483647,delay*1000)));
      }).catch(error=>{if(activeTimeline===entry)activeTimeline=null;reject(error);});
    });
  }
  client.prepareTimeline=prepareTimeline;client.playTimeline=()=>playTimeline();
  client.resetRegisters=()=>{cancelOperations(()=>true);cancelCompletion(new Error('Timeline cancelled'));const command=identified({method:'reset'});lastTimelineFence=command.id;send(command);client.ssg.resetState();client.rhythm.resetState();client.adpcm.resetState();};
  client._allocateMainOwner=()=>context.identity();
  client._withMainOwner=(group,fn)=>{const previous=mainGroup;mainGroup=group;try{return fn();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{
    const command=identified({method:'cancel-main-owner',targetGroup:group});lastTimelineFence=command.id;send(command);cancelOperations(op=>op.group===group);
    if(mainCsmGroup===group){client._modeRegister&=~0x81;mainCsmGroup=undefined;}
    const state=client.ssg._getState();for(let ch=0;ch<3;ch++)if(mainSsgGroups[ch]===group){state.registers[8+ch]=0;mainSsgGroups[ch]=undefined;}client.ssg._adoptState(state);
    if(activeTimeline?.group===group)cancelCompletion(new Error('Run stopped'));
  };
  async function dispatch(message,timing={}){
    const token=capture();timing.checkCurrent?.();
    if(Array.isArray(message)){const commands=message.map(translate);synth.enqueueMany(commands.map(command=>timed(command,timing)));await synth.flush();current(token);timing.checkCurrent?.();return;}
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError('YM2608 arguments must be an array');
    if(method==='playTimeline')return {deferred:playTimeline(timing).then(()=>({id:message.id}),error=>({id:message.id,error:error?.name==='AbortError'?'Run stopped':String(error.message??error),name:error.name}))};
    if(method==='prepareTimeline'){await prepareTimeline(args[0],args[1],args[2],timing);return {id:message.id};}
    if(method==='rom'||method==='memory'){await upload(method,args[0],args[1]??0,timing);return message.id===undefined?undefined:{id:message.id};}
    if(method==='clock'||method==='chip-clock')return clockCommand(validateChipClock(method==='clock'?args[0]:message.clock),timing,()=>message.id===undefined?undefined:{id:message.id,...(method==='chip-clock'?{type:'chip-clock-result',clock:client.clock}:{})});
    let value;
    if(method==='dispose')value=true;
    else if(['read','readStatus','getIrq'].includes(method)){if(method==='read'){integer(args[0],3,'Read offset');if(args[0]!==0&&args[0]!==2)throw new Error('Native YM2608 supports status reads at offsets 0 and 2');}const data=await snapshot();current(token);timing.checkCurrent?.();value=method==='getIrq'?data.irq:method==='read'&&args[0]===2?data.statusHi:data.status;}
    else{let command=translate(message);if(method==='reset'){cancelCompletion(new Error('Timeline cancelled'));command=identified(command);lastTimelineFence=command.id;}send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();}
    return message.id===undefined?undefined:{id:message.id,...(value===undefined?{}:{value})};
  }
  client._stopVoices=()=>dispatch({method:'stopVoices'});
  client._forceKeyOff=ch=>{integer(ch,15,'YM2608 voice');send({method:'key-off',channel:ch});if(ch===2)client._modeRegister&=~0x81;if(ch>=6&&ch<9){const state=client.ssg._getState();state.registers[8+ch-6]=0;client.ssg._adoptState(state);}};
  client.ssg._forceKeyOff=ch=>client._forceKeyOff(integer(ch,2,'SSG channel')+6);
  client._cancelCsm=()=>{send({method:'cancel-csm'});client._modeRegister&=~0x81;};
  function stopped(){const previous=collecting;collecting=[];try{guard.handle({type:'clear-auditions'});}finally{collecting=previous;inspector.held.clear();}}
  function staged(state,method,args,commands=[]){
    const value=new YM2608Synth({clock:appliedClock,transport:{write:(port,register,data)=>commands.push(rawWrite({port,register,value:data}))}});
    value.channels=structuredClone(state.channels);value._modeRegister=state.modeRegister;value.lfo=structuredClone(state.lfo);value.ssg._adoptState(state.ssg);value.rhythm.levels.set(state.rhythm.levels);value.adpcm.registers.set(state.adpcm.registers);
    trackSsgRetainedLevels(value,(channel,level)=>commands.push({method:'set-retained-level',channel,level}));
    const dot=method.indexOf('.'),section=dot<0?null:method.slice(0,dot),name=dot<0?method:method.slice(dot+1);(section?value[section]:value)[name](...args);
    return {...value.getState(),ssg:value.ssg._getState(),rhythm:{levels:Array.from(value.rhythm.levels)},adpcm:{registers:Array.from(value.adpcm.registers)}};
  }
  function invoke(method,args=[]){
    const token=capture(),copy=structuredClone(args),result=uiSerial.then(async()=>{
      current(token);const applied=await read();current(token);const dot=method.indexOf('.'),section=dot<0?null:method.slice(0,dot),name=dot<0?method:method.slice(dot+1),allowed=section==='ssg'?SSG_EDITS:section==='rhythm'?RHYTHM_EDITS:section==='adpcm'?ADPCM_EDITS:section?new Set():FM_EDITS;let value,commands,patch,groups=[];
      if(allowed.has(name)){
        const editArgs=[...copy];if(!section&&!['setLfo','setChannel3SpecialMode','setChannel3SpecialFrequency'].includes(name))editArgs[0]=integer(editArgs[0],5,'FM channel');
        const state={...applied.fmState,ssg:{registers:applied.registers[0].slice(0,16),levels:applied.ssgLevels},rhythm:{levels:applied.registers[0].slice(0x18,0x1e)},adpcm:{registers:applied.registers[1].slice(0,16)}};
        commands=[];staged(state,method,editArgs,commands);patch=staged(client._getState(),method,editArgs);
        const fallback=section==='adpcm'?15:section==='rhythm'?9:section==='ssg'?name==='write'||name==='setEnvelope'||name==='reset'?6:6+integer(editArgs[0],2,'SSG channel'):name.startsWith('setChannel3')?2:name==='setLfo'?0:editArgs[0];
        // A rhythm mask can touch six leases; each callback batch declares the
        // exact voice it edits, including rhythm.reset()'s all-voice release.
        const expanded=commands.flatMap(command=>command.method==='write'&&command.port===0&&command.register===0x10?Array.from({length:6},(_,ch)=>command.value&(1<<ch)?{...command,value:(command.value&128)|(1<<ch)}:null).filter(Boolean):[command]);
        for(const command of expanded){const ch=physical(command,fallback);let group=groups.at(-1);if(!group||group.channel!==ch){group=identified({method:'batch',channel:ch,audition:true,action:'edit',commands:[]});groups.push(group);}group.commands.push(command);}
      }else{
        if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))throw new Error(`Unsupported Native additional YM2608 inspector operation: ${method}`);
        const previous=new Map(inspector.held),levels=[...inspector.levels];collecting=[];try{value=inspector.invoke(method,copy);commands=collecting;}finally{collecting=null;}
        if(method==='auditionAllOff')for(const [id,lease]of previous)groups.push(identified({method:'batch',channel:logical(id),voice:lease.token,audition:true,action:'off',commands:[{method:'key-off',channel:logical(id)}]}));
        else{const ch=logical(copy[0]),lease=(method==='auditionOn'?inspector.held:previous).get(channelName(ch));if(commands.length&&lease){if(method==='auditionOn'&&ch>=6&&ch<9)commands.push({method:'set-retained-level',channel:ch-6,level:levels[ch-6]});groups.push(identified({method:'batch',channel:ch,voice:lease.token,audition:true,action:method==='auditionOn'?'on':'off',commands}));}}
      }
      for(const group of groups)send(group);await synth.flush();current(token);if(groups.length){await read({after:groups.at(-1).id});current(token);if(patch){client._adoptState(patch);notify();}}return value;
    });uiSerial=result.catch(()=>{});return result;
  }
  return {client,dispatch,read,invoke,
    cancelOwner(performance,owner){cancelOperations(op=>op.performance===performance&&op.owner===owner);if(activeTimeline?.performance===performance&&activeTimeline?.owner===owner)cancelCompletion(new Error('Run stopped'));},
    cancelPerformance(performance){cancelOperations(op=>op.performance!==undefined&&(performance===null||op.performance===performance));if(activeTimeline&&activeTimeline.performance!==undefined&&(performance===null||activeTimeline.performance===performance))cancelCompletion(new Error('Run stopped'));},
    async initialize(){const token=capture();context.enable('ym2608');if(initialized)return;romController=new AbortController();try{if(!fetcher)throw new Error('YM2608 rhythm ROM requires fetch support');const response=await fetcher(rhythmRomUrl,{signal:romController.signal});current(token);if(!response.ok)throw new Error(`YM2608 rhythm ROM HTTP ${response.status}`);const bytes=new Uint8Array(await response.arrayBuffer());current(token);await upload('rom',bytes);current(token);client.reset();await synth.flush();current(token);initialized=true;}finally{romController=null;}},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid YM2608 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){romController?.abort(new DOMException('Run stopped','AbortError'));cancelOperations(()=>true);preparedTimeline=null;cancelCompletion(new Error('Run stopped'));context.invalidate();context.disable('ym2608');initialized=false;lastTimelineFence=0;mainGroup=mainCsmGroup=undefined;mainSsgGroups.fill(undefined);stopped();appliedClock=CLOCK;client._adoptState({...base,clock:CLOCK,ssg:{registers:Array(16).fill(0),levels:[0,0,0]},rhythm:{levels:Array(6).fill(0)},adpcm:{registers:[0,0,0,0,0,0,0,0,0,0,0,0,255,255,0,0]}});},
  };
}
export function createNativeGenesisExtraYm2608(synth,options={}){
  return createNativeGenesisExtraChip(synth,{...options,kind:'ym2608',label:'YM2608',clock:CLOCK,createEndpoint:facade=>createNativeGenesisYm2608Endpoint(facade,options)});
}
