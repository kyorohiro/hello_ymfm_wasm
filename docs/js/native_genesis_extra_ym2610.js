import {YM2610BSynth,NeoGeoFMSynth} from './ym2610bsynth.js?v=native-extra-spc-1';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=native-extra-spc-1';
import {validateChipClock,CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-extra-spc-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-spc-1';
import {trackSsgRetainedLevels} from './opn_ssg_retained.js?v=native-extra-spc-1';

export const EXTRA_YM2610_CLOCK_HELD_ERROR='Release the manually held additional YM2610 voices before changing the clock';
const CLOCK=CHIP_CLOCKS.ym2610,MAX_MEMORY=0x1000000,FM_MAP=[1,2,4,5];
const FM_EDITS=new Set(['setPreset','setOperator','setOperators','setAlgo','setPan','setModulation','setFrequency','setNote','setBlockFnum','setChannel3SpecialMode','setChannel3SpecialFrequency','setLfo']);
const SSG_EDITS=new Set(['write','reset','tone','setFrequency','setNote','noise','setTonePeriod','setMixer','setVolume','setEnvelope']);
const ADPCM_A_EDITS=new Set(['setSample','setVolume','setVoice','reset']);
const ADPCM_EDITS=new Set(['setSample','setDeltaN','setPlaybackRate','setVolume','setPan','reset']);
const logical=value=>{if(typeof value==='number')return FM_MAP[integer(value,3,'FM channel')];const m=/^(fm|ssg|adpcm-a|adpcm-b):(\d+)$/.exec(value);if(!m)throw new RangeError('Invalid YM2610 keyboard channel');const n=Number(m[2]),section=m[1];if(section==='fm')return FM_MAP[integer(n,3,'FM channel')];return integer(n,section==='ssg'?2:section==='adpcm-a'?5:0,'Keyboard channel')+({ssg:6,'adpcm-a':9,'adpcm-b':15})[section];};
const channelName=ch=>ch<6?`fm:${FM_MAP.indexOf(ch)}`:ch<9?`ssg:${ch-6}`:ch<15?`adpcm-a:${ch-9}`:'adpcm-b:0';
function makeClient(transport,clock){const full=new YM2610BSynth({transport,clock}),client=new NeoGeoFMSynth(full);Object.assign(client,{ssg:full.ssg,adpcmA:full.adpcmA,adpcmB:full.adpcmB,adpcm:full.adpcm});return client;}

const abort=()=>new DOMException('Native additional YM2610 operation was cancelled','AbortError');
function physical(command,fallback=1){
  if(command.method==='set-retained-level')return command.channel+6;
  if(command.method==='key-off')return command.channel;
  if(command.method!=='write')return fallback;
  const {port:p,register:r,value:v}=command;
  if(p===0){if(r<=5)return 6+(r>>1);if(r>=8&&r<=10)return 6+r-8;if(r>=0x10&&r<=0x1b)return 15;if(r===0x28)return (v&3)+(v&4?3:0);if(r>=0x24&&r<=0x27||r>=0xa8&&r<=0xae)return 2;}
  if(p===1){if(r>=8&&r<=13)return 9+r-8;for(const base of [0x10,0x18,0x20,0x28])if(r>=base&&r<base+6)return 9+r-base;if(r===0){for(let ch=0;ch<6;ch++)if(v&(1<<ch))return 9+ch;}}
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

/** Independently owned original YM2610: mapped FM4, SSG3 and separate ADPCM-A/B ROM banks. */
export function createNativeGenesisYm2610Endpoint(synth){
  const context=createNativeVoiceContext(synth,{backend:'extra-ym2610',statusCommand:'native_genesis_extra_ym2610_status',label:'additional YM2610'});
  const {capture,current}=context;let clock=CLOCK,appliedClock=CLOCK,initialized=false,collecting=null,uiSerial=Promise.resolve(),clockSerial=Promise.resolve(),mainGroup,mainCsmGroup;
  const mainSsgGroups=Array(3).fill(undefined),operations=new Set();
  const tagged=message=>{
    const value={...(mainGroup===undefined?{}:{group:mainGroup}),...message};
    if(value.method==='write'&&value.port===0){
      if(value.register===0x27)mainCsmGroup=(value.value&0x81)===0x81?value.group:undefined;
      if(value.register>=8&&value.register<=10)mainSsgGroups[value.register-8]=value.value&31?value.group:undefined;
    }return value;
  };
  const timed=(message,timing)=>context.timed('ym2610',tagged(message),timing),send=(message,timing)=>context.send('ym2610',tagged(message),timing);
  const rawWrite=({port=0,register,value})=>({method:'write',port:integer(port,1,'YM2610 port'),register:integer(register,255,'Register'),value:integer(value,255,'Value')});
  const client=makeClient({write:(port,register,value)=>send(rawWrite({port,register,value})),
    writeBatch:writes=>{const commands=writes.map(rawWrite);if(context.isEnabled('ym2610'))synth.enqueueMany(commands.map(command=>timed(command)));},
    loadAdpcmMemory:(romType,bytes,offset)=>upload(romType,bytes,offset),
    reset:()=>{cancelOperations(()=>true);send({method:'reset'});},
  },clock),full=client.fm;
  const base=full.getState();
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},
    _getState:{value:()=>({...full.getState(),clock,ssg:client.ssg._getState(),adpcmA:{levels:Array.from(client.adpcmA.levels)},adpcmB:{registers:Array.from(client.adpcmB.registers)}})},
    _adoptClock:{value:hz=>{clock=validateChipClock(hz);full.clock=clock;client.ssg.clock=clock/4;client.adpcmB.clock=clock;}},
    _adoptState:{value:state=>{if(!state)return;if(state.clock!==undefined)client._adoptClock(state.clock);if(state.channels)full.channels=structuredClone(state.channels);if(state.modeRegister!==undefined)client._modeRegister=state.modeRegister;if(state.lfo)full.lfo=structuredClone(state.lfo);if(state.ssg?.registers)client.ssg._adoptState(state.ssg);if(state.adpcmA?.levels)client.adpcmA.levels.set(state.adpcmA.levels);if(state.adpcmB?.registers)client.adpcmB.registers.set(state.adpcmB.registers);}},
  });
  Object.defineProperty(client,'_modeRegister',{get:()=>full._modeRegister,set:value=>{full._modeRegister=value;}});
  trackSsgRetainedLevels(full,(channel,level)=>send({method:'set-retained-level',channel,level}));
  let inspector;
  const chip={writeRegister(register,value,port=0){if(!collecting)throw new Error('YM2610 inspector command outside an edit');collecting.push(rawWrite({port,register,value}));inspector?.observe(register,value,port);},reset(){}};
  const guard=createOpnAuditionGuard(chip,6);
  inspector=new OpnKeyboardInspector(chip,{kind:'ym2610',guard,clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000});
  const notify=()=>synth.emit?.({type:'native-state',name:'fm',state:client._getState()});
  function adopt(data){
    if(!Array.isArray(data.registers)||data.registers.length!==2)throw new Error('Native additional YM2610 returned invalid registers');
    for(const row of data.registers)nativeSnapshotArray(row,256,255,'YM2610 registers');nativeSnapshotArray(data.keyMasks,6,15,'YM2610 key masks');nativeSnapshotArray(data.ssgLevels,3,31,'YM2610 retained SSG levels');context.validateHeld(data,15);
    if(data.variant!=='ym2610'||!Array.isArray(data.ssgGates)||data.ssgGates.length!==3||data.ssgGates.some(g=>typeof g!=='boolean')||typeof data.irq!=='boolean'||data.held?.some(ch=>ch===0||ch===3))throw new Error('Native additional YM2610 returned invalid gates or variant');
    nativeSnapshotArray(data.romBytes,2,MAX_MEMORY,'YM2610 ROM extents');nativeSnapshotArray(data.romAllocatedBytes,2,64*1024*1024,'YM2610 resident ROM bytes');
    integer(data.status,255,'Status');integer(data.statusHi,255,'High status');appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;for(let p=0;p<2;p++)inspector.registers[p].set(data.registers[p]);inspector.levels.set(data.ssgLevels);if(data.registers[0][0x10]&128)inspector.adpcmRepeat=data.registers[0][0x10]&16;
    const fmState=appliedFm(data.registers,base);fmState.channels=FM_MAP.map(ch=>fmState.channels[ch]);
    return {...data,...inspector.read(),registers:data.registers.map(row=>row.slice()),fmState,held:(data.held??[...inspector.held.keys()].map(logical)).map(channelName)};
  }
  const snapshot=async(args={})=>{const data=await context.snapshot('ym2610',args);adopt(data);return data;},read=async(args={})=>adopt(await snapshot(args));
  const identified=message=>({...message,id:context.identity()});
  function translate(message){
    const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('YM2610 arguments must be an array');
    if(method==='write'||method==='rawWrite')return rawWrite(message.type==='write'?message:{port:args[0],register:args[1],value:args[2]});
    if(method==='setRetainedLevel'||method==='ssg-retained-level')return {method:'set-retained-level',channel:integer(message.channel??args[0],2,'SSG channel'),level:integer(message.level??args[1],31,'Retained level')};
    if(method==='reset')return {method:'reset'};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],15,'YM2610 voice')};
    if(method==='cancelCsm')return {method:'cancel-csm'};
    if(method==='stopVoices'||method==='clear-auditions')return {method:'stop-voices'};
    throw new Error(`Unsupported Native additional YM2610 operation: ${method}`);
  }
  function clockCommand(hz,timing={},reply){
    const token=capture();validateChipClock(hz);timing.checkCurrent?.();
    const result=clockSerial.then(async()=>{current(token);timing.checkCurrent?.();await synth.flush();current(token);timing.checkCurrent?.();const command=identified({method:'clock',hz});send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();const data=await snapshot({after:command.id});current(token);timing.checkCurrent?.();if(data.clock!==hz)throw new Error('Native additional YM2610 clock was not applied');client._adoptClock(hz);notify();return reply?.();});clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  function cancelOperations(matches){for(const operation of operations)if(matches(operation)){operation.cancelled=true;operation.controller?.abort();}}
  function operation(timing={},group=mainGroup){
    const token=capture(),value={group,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(value);
    value.check=()=>{current(token);timing.checkCurrent?.();if(value.cancelled)throw abort();};
    value.done=()=>operations.delete(value);return value;
  }
  async function upload(romType,input,offset=0,timing={}){
    const op=operation(timing);try{op.check();integer(romType,1,'ADPCM ROM type');integer(offset,MAX_MEMORY,'ADPCM address');if(input instanceof ArrayBuffer)input=new Uint8Array(input);if(!(input instanceof Uint8Array))throw new TypeError('ADPCM ROM requires Uint8Array or ArrayBuffer');if(input.length>MAX_MEMORY-offset)throw new RangeError('ADPCM ROM range exceeds 16 MiB');const data=Array.from(input);op.check();const command=identified({method:'memory',romType,offset,data,...(op.group===undefined?{}:{group:op.group})});send(command,{...timing,time:undefined});await synth.flush();op.check();await snapshot({after:command.id});op.check();}finally{op.done();}
  }
  client._allocateMainOwner=()=>context.identity();
  client._withMainOwner=(group,fn)=>{const previous=mainGroup;mainGroup=group;try{return fn();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{
    const command=identified({method:'cancel-main-owner',targetGroup:group});send(command);cancelOperations(op=>op.group===group);
    if(mainCsmGroup===group){client._modeRegister&=~0x81;mainCsmGroup=undefined;}
    const state=client.ssg._getState();for(let ch=0;ch<3;ch++)if(mainSsgGroups[ch]===group){state.registers[8+ch]=0;mainSsgGroups[ch]=undefined;}client.ssg._adoptState(state);
  };
  async function dispatch(message,timing={}){
    const token=capture();timing.checkCurrent?.();
    if(Array.isArray(message)){const commands=message.map(translate);synth.enqueueMany(commands.map(command=>timed(command,timing)));await synth.flush();current(token);timing.checkCurrent?.();return;}
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError('YM2610 arguments must be an array');
    if(method==='memory'){await upload(args[0],args[1],args[2]??0,timing);return message.id===undefined?undefined:{id:message.id};}
    if(method==='clock'||method==='chip-clock')return clockCommand(validateChipClock(method==='clock'?args[0]:message.clock),timing,()=>message.id===undefined?undefined:{id:message.id,...(method==='chip-clock'?{type:'chip-clock-result',clock:client.clock}:{})});
    let value;
    if(method==='dispose')value=true;
    else{send(translate(message),timing);await synth.flush();current(token);timing.checkCurrent?.();}
    return message.id===undefined?undefined:{id:message.id,...(value===undefined?{}:{value})};
  }
  client._stopVoices=()=>dispatch({method:'stopVoices'});
  client._forceKeyOff=ch=>{integer(ch,15,'YM2610 voice');send({method:'key-off',channel:ch});if(ch===2)client._modeRegister&=~0x81;if(ch>=6&&ch<9){const state=client.ssg._getState();state.registers[8+ch-6]=0;client.ssg._adoptState(state);}};
  client.ssg._forceKeyOff=ch=>client._forceKeyOff(integer(ch,2,'SSG channel')+6);
  client._cancelCsm=()=>{send({method:'cancel-csm'});client._modeRegister&=~0x81;};
  function stopped(){const previous=collecting;collecting=[];try{guard.handle({type:'clear-auditions'});}finally{collecting=previous;inspector.held.clear();}}
  function staged(state,method,args,commands=[]){
    const value=makeClient({write:(port,register,data)=>commands.push(rawWrite({port,register,value:data}))},appliedClock),raw=value.fm;
    raw.channels=structuredClone(state.channels);raw._modeRegister=state.modeRegister;raw.lfo=structuredClone(state.lfo);value.ssg._adoptState(state.ssg);value.adpcmA.levels.set(state.adpcmA.levels);value.adpcmB.registers.set(state.adpcmB.registers);
    trackSsgRetainedLevels(raw,(channel,level)=>commands.push({method:'set-retained-level',channel,level}));
    const dot=method.indexOf('.'),section=dot<0?null:method.slice(0,dot),name=dot<0?method:method.slice(dot+1);(section?value[section]:value)[name](...args);
    return {...raw.getState(),ssg:value.ssg._getState(),adpcmA:{levels:Array.from(value.adpcmA.levels)},adpcmB:{registers:Array.from(value.adpcmB.registers)}};
  }
  function invoke(method,args=[]){
    const token=capture(),copy=structuredClone(args),result=uiSerial.then(async()=>{
      current(token);const applied=await read();current(token);const dot=method.indexOf('.'),section=dot<0?null:method.slice(0,dot),name=dot<0?method:method.slice(dot+1),allowed=section==='ssg'?SSG_EDITS:section==='adpcmA'?ADPCM_A_EDITS:['adpcmB','adpcm'].includes(section)?ADPCM_EDITS:section?new Set():FM_EDITS;let value,commands,patch,groups=[];
      if(allowed.has(name)){
        const editArgs=[...copy];if(!section&&!['setLfo','setChannel3SpecialMode','setChannel3SpecialFrequency'].includes(name))editArgs[0]=integer(editArgs[0],3,'FM channel');
        const state={...appliedFm(applied.registers,base),ssg:{registers:applied.registers[0].slice(0,16),levels:applied.ssgLevels},adpcmA:{levels:applied.registers[1].slice(8,14)},adpcmB:{registers:[...applied.registers[0].slice(0x10,0x1c),255,255,0,0]}};
        commands=[];staged(state,method,editArgs,commands);patch=staged(client._getState(),method,editArgs);
        const fallback=['adpcm','adpcmB'].includes(section)?15:section==='adpcmA'?9:section==='ssg'?name==='write'||name==='setEnvelope'||name==='reset'?6:6+integer(editArgs[0],2,'SSG channel'):name.startsWith('setChannel3')?2:name==='setLfo'?1:FM_MAP[editArgs[0]];
        // Each ADPCM-A mask bit declares its own physical audition lease.
        const expanded=commands.flatMap(command=>command.method==='write'&&command.port===1&&command.register===0?Array.from({length:6},(_,ch)=>command.value&(1<<ch)?{...command,value:(command.value&128)|(1<<ch)}:null).filter(Boolean):[command]);
        for(const command of expanded){const ch=physical(command,fallback);let group=groups.at(-1);if(!group||group.channel!==ch){group=identified({method:'batch',channel:ch,audition:true,action:'edit',commands:[]});groups.push(group);}group.commands.push(command);}
      }else{
        if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))throw new Error(`Unsupported Native additional YM2610 inspector operation: ${method}`);
        const previous=new Map(inspector.held),levels=[...inspector.levels];collecting=[];try{value=inspector.invoke(method,copy);commands=collecting;}finally{collecting=null;}
        if(method==='auditionAllOff')for(const [id,lease]of previous)groups.push(identified({method:'batch',channel:logical(id),voice:lease.token,audition:true,action:'off',commands:[{method:'key-off',channel:logical(id)}]}));
        else{const ch=logical(copy[0]),lease=(method==='auditionOn'?inspector.held:previous).get(channelName(ch));if(commands.length&&lease){if(method==='auditionOn'&&ch>=6&&ch<9)commands.push({method:'set-retained-level',channel:ch-6,level:levels[ch-6]});groups.push(identified({method:'batch',channel:ch,voice:lease.token,audition:true,action:method==='auditionOn'?'on':'off',commands}));}}
      }
      for(const group of groups)send(group);await synth.flush();current(token);if(groups.length){await read({after:groups.at(-1).id});current(token);if(patch){client._adoptState(patch);notify();}}return value;
    });uiSerial=result.catch(()=>{});return result;
  }
  return {client,dispatch,read,invoke,
    cancelOwner(performance,owner){cancelOperations(op=>op.performance===performance&&op.owner===owner);},
    cancelPerformance(performance){cancelOperations(op=>op.performance!==undefined&&(performance===null||op.performance===performance));},
    async initialize(){const token=capture();context.enable('ym2610');if(initialized)return;client.reset();await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid YM2610 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){cancelOperations(()=>true);context.invalidate();context.disable('ym2610');initialized=false;mainGroup=mainCsmGroup=undefined;mainSsgGroups.fill(undefined);stopped();appliedClock=CLOCK;client._adoptState({...base,clock:CLOCK,ssg:{registers:Array(16).fill(0),levels:[0,0,0]},adpcmA:{levels:Array(6).fill(0)},adpcmB:{registers:[0,0,0,0,0,0,0,0,0,0,0,0,255,255,0,0]}});},
  };
}
export function createNativeGenesisExtraYm2610(synth,options={}){
  return createNativeGenesisExtraChip(synth,{...options,kind:'ym2610',label:'YM2610',clock:CLOCK,createEndpoint:facade=>createNativeGenesisYm2610Endpoint(facade,options)});
}
