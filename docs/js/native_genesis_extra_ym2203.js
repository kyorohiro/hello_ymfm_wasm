import {YM2203Synth} from './ym2203synth.js?v=native-extra-huc6280-1';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=native-extra-huc6280-1';
import {validateChipClock,CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-extra-huc6280-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-huc6280-1';
import {trackSsgRetainedLevels} from './opn_ssg_retained.js?v=native-extra-huc6280-1';

export const EXTRA_YM2203_CLOCK_HELD_ERROR='Release the manually held additional YM2203 voices before changing the clock';
export const EXTRA_YM2203_SCHEDULE_BUSY_ERROR='Native YM2203 schedule already playing or pending';
const CLOCK=CHIP_CLOCKS.ym2203,MAX_SCHEDULE_ENTRIES=131072;
const FM_EDITS=new Set(['setPreset','setOperator','setOperators','setAlgo','setPan','setModulation','setFrequency','setNote','setBlockFnum','setChannel3SpecialMode','setChannel3SpecialFrequency']);
const SSG_EDITS=new Set(['write','reset','tone','setFrequency','setNote','noise','setTonePeriod','setMixer','setVolume','setEnvelope']);
const logical=value=>{if(typeof value==='number')return integer(value,2,'FM channel');const m=/^(fm|ssg):([0-2])$/.exec(value);if(!m)throw new RangeError('Invalid YM2203 keyboard channel');return Number(m[2])+(m[1]==='ssg'?3:0);};
const channelName=ch=>ch<3?`fm:${ch}`:`ssg:${ch-3}`;
const abort=()=>new DOMException('Native additional YM2203 operation was cancelled','AbortError');
function physical(command,fallback=0){
  if(command.method==='set-retained-level')return command.channel+3;
  if(command.method==='key-off')return command.channel;
  if(command.method!=='write')return fallback;
  const {register:r,value:v}=command;
  if(r<=5)return 3+(r>>1);if(r>=8&&r<=10)return 3+r-8;
  if(r===0x28)return v&3;
  if(r>=0x24&&r<=0x27||r>=0xa8&&r<=0xae)return 2;
  if(r>=0x30&&r<=0xb6&&(r&3)<3)return r&3;
  return fallback;
}
function appliedFm(registers,base){
  const state=structuredClone(base),r=registers[0],slots=[0,8,4,12],special=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]];
  state.modeRegister=r[0x27];
  for(let ch=0;ch<3;ch++){
    const c=state.channels[ch],pitch=r[0xa4+ch];Object.assign(c,{algorithm:r[0xb0+ch]&7,feedback:r[0xb0+ch]>>3&7,block:pitch>>3&7,fnum:(pitch&7)<<8|r[0xa0+ch]});
    for(let op=0;op<4;op++){const n=slots[op]+ch;Object.assign(c.operators[op],{dt:r[0x30+n]>>4&7,multi:r[0x30+n]&15,tl:r[0x40+n]&127,rs:r[0x50+n]>>6&3,ar:r[0x50+n]&31,am:!!(r[0x60+n]&128),d1r:r[0x60+n]&31,d2r:r[0x70+n]&31,sl:r[0x80+n]>>4,rr:r[0x80+n]&15,ssg:r[0x90+n]&15});}
    if(ch===2)c.specialFrequencies=special.map(([lo,hi])=>({block:r[hi]>>3&7,fnum:(r[hi]&7)<<8|r[lo]}));
  }return state;
}

/** One independently owned YM2203: three FM voices and three mono SSG voices. */
export function createNativeGenesisYm2203Endpoint(synth){
  const context=createNativeVoiceContext(synth,{backend:'extra-ym2203',statusCommand:'native_genesis_extra_ym2203_status',label:'additional YM2203'});
  const {capture,current}=context;let clock=CLOCK,appliedClock=CLOCK,initialized=false,collecting=null,uiSerial=Promise.resolve(),clockSerial=Promise.resolve(),activeSchedule=null,lastScheduleFence=0,mainGroup,mainCsmGroup;
  const mainSsgGroups=Array(3).fill(undefined);
  const tagged=message=>{
    const value={...(mainGroup===undefined?{}:{group:mainGroup}),...message};
    if(value.method==='write'&&value.port===0){
      if(value.register===0x27)mainCsmGroup=(value.value&0x81)===0x81?value.group:undefined;
      if(value.register>=8&&value.register<=10)mainSsgGroups[value.register-8]=value.value&31?value.group:undefined;
    }return value;
  };
  const timed=(message,timing)=>context.timed('ym2203',tagged(message),timing),send=(message,timing)=>context.send('ym2203',tagged(message),timing);
  const rawWrite=({port=0,register,value})=>({method:'write',port:integer(port,0,'YM2203 port'),register:integer(register,255,'Register'),value:integer(value,255,'Value')});
  function cancelCompletion(reason=abort()){const pending=activeSchedule;if(!pending)return;activeSchedule=null;clearTimeout(pending.timer);pending.reject(reason);}
  const client=new YM2203Synth({clock,transport:{write:(port,register,value)=>send(rawWrite({port,register,value})),
    writeBatch:writes=>{const commands=writes.map(rawWrite);if(context.isEnabled('ym2203'))synth.enqueueMany(commands.map(command=>timed(command)));},
    reset:()=>{cancelCompletion(new Error('Schedule cancelled'));const id=context.isEnabled('ym2203')?context.identity():undefined;if(id)lastScheduleFence=id;send({method:'reset',...(id?{id}:{})});},
  }});
  const base=client.getState();
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},
    _getState:{value:()=>({...client.getState(),clock,ssg:client.ssg._getState()})},
    _adoptClock:{value:hz=>{clock=validateChipClock(hz);client.ssg.clock=clock/2;}},
    _adoptState:{value:state=>{if(!state)return;if(state.clock!==undefined)client._adoptClock(state.clock);if(state.channels)client.channels=structuredClone(state.channels);if(state.modeRegister!==undefined)client._modeRegister=state.modeRegister;if(state.ssg?.registers)client.ssg._adoptState(state.ssg);}},
  });
  trackSsgRetainedLevels(client,(channel,level)=>send({method:'set-retained-level',channel,level}));
  let inspector;
  const chip={writeRegister(register,value,port=0){if(!collecting)throw new Error('YM2203 inspector command outside an edit');collecting.push(rawWrite({port,register,value}));inspector?.observe(register,value,port);},reset(){}};
  const guard=createOpnAuditionGuard(chip,3);
  inspector=new OpnKeyboardInspector(chip,{kind:'ym2203',guard,clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000});
  const notify=()=>synth.emit?.({type:'native-state',name:'fm',state:client._getState()});
  function adopt(data){
    if(!Array.isArray(data.registers)||data.registers.length!==1)throw new Error('Native additional YM2203 returned invalid registers');
    nativeSnapshotArray(data.registers[0],256,255,'YM2203 registers');nativeSnapshotArray(data.keyMasks,3,15,'YM2203 key masks');nativeSnapshotArray(data.ssgLevels,3,31,'YM2203 retained SSG levels');context.validateHeld(data,5);
    if(![2,3,6].includes(data.prescaler)||!Array.isArray(data.ssgGates)||data.ssgGates.length!==3||data.ssgGates.some(g=>typeof g!=='boolean')||typeof data.irq!=='boolean')throw new Error('Native additional YM2203 returned invalid gates or prescaler');
    integer(data.status,255,'Status');appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.registers[0].set(data.registers[0]);inspector.levels.set(data.ssgLevels);
    return {...data,...inspector.read(),registers:data.registers.map(row=>row.slice()),fmState:appliedFm(data.registers,base),held:(data.held??[...inspector.held.keys()].map(logical)).map(channelName)};
  }
  const snapshot=async(args={})=>{const data=await context.snapshot('ym2203',args);adopt(data);return data;},read=async(args={})=>adopt(await snapshot(args));
  client.read=async offset=>{integer(offset,1,'Read offset');if(offset!==0)throw new Error('Native YM2203 supports status reads at offset 0');const data=await snapshot();client.hooks.onRead?.({offset,value:data.status});client.hooks.onIrq?.(data.irq);return data.status;};
  client.readStatus=()=>client.read(0);client.getIrq=async()=>!!(await snapshot()).irq;
  const identified=message=>({...message,id:context.identity()});
  function translate(message){
    const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('YM2203 arguments must be an array');
    if(method==='write'||method==='rawWrite')return rawWrite(message.type==='write'?message:{port:args[0],register:args[1],value:args[2]});
    if(method==='setRetainedLevel'||method==='ssg-retained-level')return {method:'set-retained-level',channel:integer(message.channel??args[0],2,'SSG channel'),level:integer(message.level??args[1],31,'Retained level')};
    if(method==='reset')return {method:'reset'};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],5,'YM2203 voice')};
    if(method==='cancelCsm')return {method:'cancel-csm'};
    if(method==='stopVoices'||method==='clear-auditions')return {method:'stop-voices'};
    if(method==='source-mute'||method==='channel-mute')return {method,mask:integer(message.mask??args[0],method==='source-mute'?3:7,'Mute mask')};
    throw new Error(`Unsupported Native additional YM2203 operation: ${method}`);
  }
  function clockCommand(hz,timing={},reply){
    const token=capture();validateChipClock(hz);timing.checkCurrent?.();
    const result=clockSerial.then(async()=>{current(token);timing.checkCurrent?.();await synth.flush();current(token);timing.checkCurrent?.();const command=identified({method:'clock',hz});send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();const data=await snapshot({after:command.id});current(token);timing.checkCurrent?.();if(data.clock!==hz)throw new Error('Native additional YM2203 clock was not applied');client._adoptClock(hz);notify();return reply?.();});clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  function scheduleRegisters(input,durationSamples,timing={}){
    let token,entries,schedule;
    try{
      token=capture();timing.checkCurrent?.();if(activeSchedule)throw new Error('Schedule already playing');
      if(!Array.isArray(input)||input.length>MAX_SCHEDULE_ENTRIES||!Number.isSafeInteger(durationSamples)||durationSamples<=0)throw new RangeError(`YM2203 schedule requires at most ${MAX_SCHEDULE_ENTRIES} entries and a positive duration`);
      let previous=0;entries=input.map(entry=>{if(!Array.isArray(entry)||entry.length!==3)throw new TypeError('Expected [sample, register, value]');const [sample,register,value]=entry;if(!Number.isSafeInteger(sample)||sample<previous||sample>durationSamples)throw new RangeError('Invalid scheduled sample position');previous=sample;return [sample,integer(register,255,'Scheduled register'),integer(value,255,'Scheduled value')];});
      const positions=entries.map(entry=>Math.ceil(entry[0]*synth.clock.sampleRate/44100));let begin=0;
      for(let i=0;i<positions.length;i++){while(positions[i]-positions[begin]>=128)begin++;if(i-begin+1>256)throw new RangeError('Native YM2203 schedule exceeds 256 writes in 128 output frames');}
      const frames=Math.ceil(durationSamples*synth.clock.sampleRate/44100),start=synth.frameAt(timing.time??synth.clock.currentTime);if(!Number.isSafeInteger(frames)||!Number.isSafeInteger(start+frames))throw new RangeError('YM2203 schedule exceeds Native frame limits');
      schedule={token:context.identity(),id:context.identity(),fence:lastScheduleFence,group:mainGroup,performance:timing.performance,owner:timing.owner,timer:null,reject:null};
    }catch(error){return Promise.reject(error);}
    const result=new Promise((resolve,reject)=>{
      schedule.reject=reject;activeSchedule=schedule;
      const valid=()=>{current(token);timing.checkCurrent?.();if(activeSchedule!==schedule)throw abort();};
      const finish=async()=>{try{
        valid();const data=await snapshot();valid();const state=data.schedule;
        if(data.pendingCommands?.includes(schedule.id)||state?.token===schedule.token&&(state.pending||state.playing)){schedule.timer=setTimeout(finish,50);return;}
        activeSchedule=null;
        if(state?.token===schedule.token&&state.ended&&!state.cancelled)resolve();else reject(new Error(state?.error??'Schedule cancelled'));
      }catch(error){if(activeSchedule===schedule)activeSchedule=null;reject(error);}};
      Promise.resolve().then(async()=>{
        valid();if(schedule.fence){await synth.flush();valid();await snapshot({after:schedule.fence});valid();}
        send({method:'schedule',entries,durationSamples,token:schedule.token,id:schedule.id,...(schedule.group===undefined?{}:{group:schedule.group})},timing);await synth.flush();valid();
        const delay=Math.max(0,(timing.time??synth.clock.currentTime)-synth.clock.currentTime)+durationSamples/44100;
        schedule.timer=setTimeout(finish,Math.max(1,Math.min(2147483647,delay*1000)));
      }).catch(error=>{if(activeSchedule===schedule)activeSchedule=null;reject(error);});
    });return result;
  }
  client.scheduleRegisters=(entries,duration)=>scheduleRegisters(entries,duration);
  client._getScheduleToken=()=>activeSchedule?.token;
  client._cancelSchedule=token=>{if(!Number.isSafeInteger(token)||token<1)return;const command=identified({method:'cancel-schedule',token});lastScheduleFence=command.id;send(command);if(activeSchedule?.token===token)cancelCompletion(new Error('Run stopped'));};
  client._allocateMainOwner=()=>context.identity();
  client._withMainOwner=(group,fn)=>{const previous=mainGroup;mainGroup=group;try{return fn();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{
    const command=identified({method:'cancel-main-owner',targetGroup:group});lastScheduleFence=command.id;send(command);
    if(mainCsmGroup===group){client._modeRegister&=~0x81;mainCsmGroup=undefined;}
    const state=client.ssg._getState();for(let ch=0;ch<3;ch++)if(mainSsgGroups[ch]===group){state.registers[8+ch]=0;mainSsgGroups[ch]=undefined;}client.ssg._adoptState(state);
    if(activeSchedule?.group===group)cancelCompletion(new Error('Run stopped'));
  };
  async function dispatch(message,timing={}){
    const token=capture();timing.checkCurrent?.();
    if(Array.isArray(message)){const commands=message.map(translate);synth.enqueueMany(commands.map(command=>timed(command,timing)));await synth.flush();current(token);timing.checkCurrent?.();return;}
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError('YM2203 arguments must be an array');
    if(method==='schedule')return {deferred:scheduleRegisters(args[0],args[1],timing).then(()=>({id:message.id}),error=>({id:message.id,error:error?.name==='AbortError'?'Run stopped':String(error.message??error),name:error.name}))};
    if(method==='clock'||method==='chip-clock')return clockCommand(validateChipClock(method==='clock'?args[0]:message.clock),timing,()=>message.id===undefined?undefined:{id:message.id,...(method==='chip-clock'?{type:'chip-clock-result',clock:client.clock}:{})});
    let value;
    if(method==='dispose')value=true;
    else if(['read','readStatus','getIrq'].includes(method)){if(method==='read'){integer(args[0],1,'Read offset');if(args[0]!==0)throw new Error('Native YM2203 supports status reads at offset 0');}const data=await snapshot();current(token);timing.checkCurrent?.();value=method==='getIrq'?data.irq:data.status;}
    else{let command=translate(message);if(method==='reset'){cancelCompletion(new Error('Schedule cancelled'));command=identified(command);lastScheduleFence=command.id;}send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();}
    return message.id===undefined?undefined:{id:message.id,...(value===undefined?{}:{value})};
  }
  client._stopVoices=()=>dispatch({method:'stopVoices'});
  client._forceKeyOff=ch=>{integer(ch,5,'YM2203 voice');send({method:'key-off',channel:ch});if(ch===2)client._modeRegister&=~0x81;if(ch>=3){const state=client.ssg._getState();state.registers[8+ch-3]=0;client.ssg._adoptState(state);}};
  client.ssg._forceKeyOff=ch=>client._forceKeyOff(integer(ch,2,'SSG channel')+3);
  client._cancelCsm=()=>{send({method:'cancel-csm'});client._modeRegister&=~0x81;};
  function stopped(){const previous=collecting;collecting=[];try{guard.handle({type:'clear-auditions'});}finally{collecting=previous;inspector.held.clear();}}
  function staged(state,method,args,commands=[]){
    const value=new YM2203Synth({clock:appliedClock,transport:{write:(port,register,data)=>commands.push(rawWrite({port,register,value:data}))}});
    value.channels=structuredClone(state.channels);value._modeRegister=state.modeRegister;value.ssg._adoptState(state.ssg);
    trackSsgRetainedLevels(value,(channel,level)=>commands.push({method:'set-retained-level',channel,level}));
    const nested=method.startsWith('ssg.'),name=nested?method.slice(4):method;(nested?value.ssg:value)[name](...args);
    return {...value.getState(),ssg:value.ssg._getState()};
  }
  function invoke(method,args=[]){
    const token=capture(),copy=structuredClone(args),result=uiSerial.then(async()=>{
      current(token);const applied=await read();current(token);const nested=method.startsWith('ssg.'),name=nested?method.slice(4):method;let value,commands,patch,groups=[];
      if(nested?SSG_EDITS.has(name):FM_EDITS.has(name)){
        const editArgs=[...copy];if(!nested&&!['setChannel3SpecialMode','setChannel3SpecialFrequency'].includes(name))editArgs[0]=integer(editArgs[0],2,'FM channel');
        const state={...applied.fmState,ssg:{registers:applied.registers[0].slice(0,16),levels:applied.ssgLevels}};
        commands=[];staged(state,method,editArgs,commands);patch=staged(client._getState(),method,editArgs);
        const fallback=nested?name==='write'?3:name==='setEnvelope'||name==='reset'?3:3+integer(editArgs[0],2,'SSG channel'):name.startsWith('setChannel3')?2:editArgs[0];
        for(const command of commands){const ch=physical(command,fallback);let group=groups.at(-1);if(!group||group.channel!==ch){group=identified({method:'batch',channel:ch,audition:true,action:'edit',commands:[]});groups.push(group);}group.commands.push(command);}
      }else{
        if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))throw new Error(`Unsupported Native additional YM2203 inspector operation: ${method}`);
        const previous=new Map(inspector.held),levels=[...inspector.levels];collecting=[];try{value=inspector.invoke(method,copy);commands=collecting;}finally{collecting=null;}
        if(method==='auditionAllOff')for(const [id,lease]of previous)groups.push(identified({method:'batch',channel:logical(id),voice:lease.token,audition:true,action:'off',commands:[{method:'key-off',channel:logical(id)}]}));
        else{const ch=logical(copy[0]),lease=(method==='auditionOn'?inspector.held:previous).get(channelName(ch));if(commands.length&&lease){if(method==='auditionOn'&&ch>=3)commands.push({method:'set-retained-level',channel:ch-3,level:levels[ch-3]});groups.push(identified({method:'batch',channel:ch,voice:lease.token,audition:true,action:method==='auditionOn'?'on':'off',commands}));}}
      }
      for(const group of groups)send(group);await synth.flush();current(token);if(groups.length){await read({after:groups.at(-1).id});current(token);if(patch){client._adoptState(patch);notify();}}return value;
    });uiSerial=result.catch(()=>{});return result;
  }
  return {client,dispatch,read,invoke,
    cancelOwner(performance,owner){if(activeSchedule?.performance===performance&&activeSchedule?.owner===owner)cancelCompletion(new Error('Run stopped'));},
    cancelPerformance(performance){if(activeSchedule&&activeSchedule.performance!==undefined&&(performance===null||activeSchedule.performance===performance))cancelCompletion(new Error('Run stopped'));},
    async initialize(){const token=capture();context.enable('ym2203');if(initialized)return;client.reset();await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid YM2203 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){cancelCompletion(new Error('Run stopped'));context.invalidate();context.disable('ym2203');initialized=false;lastScheduleFence=0;mainGroup=mainCsmGroup=undefined;mainSsgGroups.fill(undefined);stopped();appliedClock=CLOCK;client._adoptState({...base,clock:CLOCK,ssg:{registers:Array(16).fill(0),levels:[0,0,0]}});},
  };
}
export function createNativeGenesisExtraYm2203(synth,options={}){
  return createNativeGenesisExtraChip(synth,{...options,kind:'ym2203',label:'YM2203',clock:CLOCK,createEndpoint:createNativeGenesisYm2203Endpoint});
}
