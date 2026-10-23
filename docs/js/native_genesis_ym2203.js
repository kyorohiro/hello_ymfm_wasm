/** PC-98 YM2203 authoring shares the Web FM/SSG helpers; Native renders mono. */
import {YM2203Synth} from './ym2203synth.js?v=native-extra-spc-1';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=native-extra-spc-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-extra-spc-1';

const CLOCK=4000000;
const abort=()=>new DOMException('Native YM2203 operation was cancelled','AbortError');
function logicalChannel(value){
  if(typeof value==='number')return integer(value,2,'FM channel');
  const match=/^(fm|ssg):([0-2])$/.exec(value);
  if(!match)throw new RangeError('Invalid YM2203 keyboard channel');
  return Number(match[2])+(match[1]==='ssg'?3:0);
}
const channelName=channel=>channel<3?`fm:${channel}`:`ssg:${channel-3}`;
function appliedFm(registers,base){
  const state=structuredClone(base),r=registers[0],slots=[0,8,4,12],special=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]];
  state.modeRegister=r[0x27];
  for(let channel=0;channel<3;channel++){
    const c=state.channels[channel],pitch=r[0xa4+channel];
    Object.assign(c,{algorithm:r[0xb0+channel]&7,feedback:r[0xb0+channel]>>3&7,block:pitch>>3&7,fnum:(pitch&7)<<8|r[0xa0+channel]});
    for(let op=0;op<4;op++){const n=slots[op]+channel;Object.assign(c.operators[op],{dt:r[0x30+n]>>4&7,multi:r[0x30+n]&15,tl:r[0x40+n]&127,rs:r[0x50+n]>>6&3,ar:r[0x50+n]&31,am:!!(r[0x60+n]&128),d1r:r[0x60+n]&31,d2r:r[0x70+n]&31,sl:r[0x80+n]>>4,rr:r[0x80+n]&15,ssg:r[0x90+n]&15});}
    if(channel===2)c.specialFrequencies=special.map(([low,high])=>({block:r[high]>>3&7,fnum:(r[high]&7)<<8|r[low]}));
  }
  return state;
}

export function createNativeGenesisYm2203(synth){
  let clock=CLOCK,appliedClock=CLOCK,enabled=false,version=0,nextIdentity=0,initializedSession,collecting=null,uiSerial=Promise.resolve(),clockSerial=Promise.resolve();
  const check=()=>{if(!synth.isReady())throw new Error('Native YM2203 audio is not ready');if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation,version};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation||token.version!==version)throw abort();};
  const identify=message=>{if(nextIdentity>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native YM2203 command identity limit reached');return {...message,id:++nextIdentity};};
  const timed=(message,timing={})=>({type:'ym2203',message,frame:timing.time===undefined?0:synth.frameAt(timing.time),...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  const send=(message,timing={})=>{check();timing.checkCurrent?.();synth.enqueue(timed(message,timing));};
  const rawWrite=({port=0,register,value})=>({method:'write',port:integer(port,0,'YM2203 port'),register:integer(register,255,'Register'),value:integer(value,255,'Value')});
  const author=message=>{if(!enabled)return;if(collecting)collecting.push(message);else send(message);};
  const write=(port,register,value)=>author(rawWrite({port,register,value}));
  const client=new YM2203Synth({clock,transport:{write,writeBatch:writes=>{const commands=writes.map(rawWrite);for(const command of commands)author(command);},reset:()=>author({method:'reset'}),setRetainedLevel:(channel,level)=>author({method:'set-retained-level',channel,level})}});
  const fmBase=client.getState();
  const adoptClock=hz=>{clock=validateChipClock(hz);client.ssg.clock=clock/2;};
  Object.defineProperties(client,{id:{value:'ym2203',enumerable:true},clock:{configurable:true,enumerable:true,get:()=>clock}});
  client.dispose=()=>{};
  client._adoptClock=adoptClock;
  client._getState=()=>({...client.getState(),clock,ssg:client.ssg._getState()});
  client._adoptState=state=>{if(!state)return;if(state.clock!==undefined)adoptClock(state.clock);if(state.channels)client.channels=structuredClone(state.channels);if(state.modeRegister!==undefined)client._modeRegister=state.modeRegister;if(state.ssg?.registers)client.ssg._adoptState(state.ssg);};
  // The same bus zero can be a temporary key-off or an explicitly authored
  // silent level. Emit retained-level metadata only after the outer API call.
  let nesting=0;
  function track(object,names){for(const name of names){if(typeof object[name]!=='function'||name.startsWith('_')||name==='constructor')continue;const original=object[name].bind(object);object[name]=(...args)=>{const before=nesting++===0?client.ssg._getState().levels:null;try{return original(...args);}finally{nesting--;if(before){const after=client.ssg._getState().levels;for(let ch=0;ch<3;ch++)if(before[ch]!==after[ch])client.transport.setRetainedLevel?.(ch,after[ch]&31);}}};}}
  track(client,['reset','write','rawWrite','writeRegister','writeAddress','writeData','setPreset','setOperator','setAlgo','setFrequency','setNote','setBlockFnum','keyOn','keyOff','noteOn','noteOnRaw','noteOff','setChannel3SpecialMode','setChannel3SpecialFrequency']);
  track(client.ssg,Object.getOwnPropertyNames(Object.getPrototypeOf(client.ssg)));

  let inspector;
  const chip={writeRegister(register,value,port=0){if(!collecting)throw new Error('YM2203 inspector command outside an edit');collecting.push(rawWrite({port,register,value}));inspector?.observe(register,value,port);},reset(){}};
  const guard=createOpnAuditionGuard(chip,3);
  inspector=new OpnKeyboardInspector(chip,{kind:'ym2203',guard,clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000});
  function adopt(data,adoptClient=false){
    if(!Array.isArray(data?.registers)||data.registers.length!==1)throw new Error('Native YM2203 returned invalid registers');
    nativeSnapshotArray(data.registers[0],256,255,'YM2203 registers');nativeSnapshotArray(data.keyMasks,3,15,'YM2203 key masks');nativeSnapshotArray(data.ssgLevels,3,31,'YM2203 retained SSG levels');
    if(!Array.isArray(data.ssgGates)||data.ssgGates.length!==3||data.ssgGates.some(g=>typeof g!=='boolean')||!Array.isArray(data.pendingCommands)||data.pendingCommands.some(id=>!Number.isSafeInteger(id)||id<1)||data.held!==undefined&&(!Array.isArray(data.held)||data.held.some(ch=>!Number.isInteger(ch)||ch<0||ch>5)))throw new Error('Native YM2203 returned invalid gates or commands');
    appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.registers[0].set(data.registers[0]);inspector.levels.set(data.ssgLevels);
    const fmState=appliedFm(data.registers,fmBase);
    if(adoptClient)client._adoptState({...fmState,clock:data.clock,ssg:{registers:data.registers[0].slice(0,16),levels:data.ssgLevels}});
    return {...data,...inspector.read(),registers:data.registers.map(row=>row.slice()),fmState,held:(data.held??[...inspector.held.keys()].map(logicalChannel)).map(channelName)};
  }
  async function snapshot(args={}){const token=capture(),data=await synth.nativeRequest('native_genesis_ym2203_status',args);current(token);adopt(data);return data;}
  async function read(args={}){return adopt(await snapshot(args));}
  const notify=()=>synth.emit?.({type:'native-state',name:'fm',state:client._getState()});
  function clockCommand(hz,timing={},reply){
    const token=capture();validateChipClock(hz);timing.checkCurrent?.();
    const result=clockSerial.then(async()=>{current(token);timing.checkCurrent?.();await synth.flush();current(token);timing.checkCurrent?.();const command=identify({method:'clock',hz});send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();const state=await snapshot({after:command.id});current(token);timing.checkCurrent?.();if(state.clock!==hz)throw new Error('Native YM2203 clock was not applied');adoptClock(hz);notify();return reply?.();});
    clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=async hz=>clockCommand(hz);
  client.read=async offset=>{integer(offset,1,'Read offset');if(offset!==0)throw new Error('Native YM2203 supports status reads at offset 0');return (await snapshot()).status;};
  client.readStatus=()=>client.read(0);client.getIrq=async()=>!!(await snapshot()).irq;
  client._stopVoices=()=>dispatch({method:'stopVoices'});
  function translate(message){
    const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('YM2203 arguments must be an array');
    if(method==='write'||method==='rawWrite')return rawWrite(message.type==='write'?message:{port:args[0],register:args[1],value:args[2]});
    if(method==='ssg-retained-level'||method==='setRetainedLevel')return {method:'set-retained-level',channel:integer(message.channel??args[0],2,'SSG channel'),level:integer(message.level??args[1],31,'Retained level')};
    if(method==='reset')return {method:'reset'};
    if(method==='stopVoices'||method==='clear-auditions')return {method:'stop-voices'};
    throw new Error(`Unsupported Native YM2203 operation: ${method}`);
  }
  async function dispatch(message,timing={}){
    const token=capture();timing.checkCurrent?.();
    if(Array.isArray(message)){const commands=message.map(translate);for(const command of commands)send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();return;}
    const method=message.method??message.type;
    if(method==='clock'||method==='chip-clock'){const hz=validateChipClock(method==='clock'?message.args?.[0]:message.clock);return clockCommand(hz,timing,()=>message.id===undefined?undefined:{id:message.id,...(method==='chip-clock'?{type:'chip-clock-result',clock:hz}:{})});}
    if(['dispose','clear-scheduled-writes','clear-dac-playback'].includes(method))return message.id===undefined?undefined:{id:message.id,value:true};
    const command=translate(message);send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();if(command.method==='stop-voices'&&timing.performance===undefined)stopped();return message.id===undefined?undefined:{id:message.id};
  }
  function stopped(){const previous=collecting;collecting=[];try{guard.handle({type:'clear-auditions'});}finally{collecting=previous;inspector.held.clear();}}
  function stage(method,args){const previous=new Map(inspector.held),retained=Array.from(inspector.levels);collecting=[];let value,commands;try{value=inspector.invoke(method,args);commands=collecting;}finally{collecting=null;}
    const groups=[];
    if(method==='auditionAllOff'){for(const [name,lease]of previous){const channel=logicalChannel(name);groups.push(identify({method:'batch',channel,voice:lease.token,audition:true,action:'off',commands:[{method:'key-off',channel}]}));}}
    else{const channel=logicalChannel(args[0]),name=channelName(channel),lease=method==='auditionOn'?inspector.held.get(name):previous.get(name);if(commands.length&&lease){if(method==='auditionOn'&&channel>=3)commands.push({method:'set-retained-level',channel:channel-3,level:retained[channel-3]});groups.push(identify({method:'batch',channel,voice:lease.token,audition:true,action:method==='auditionOn'?'on':'off',commands}));}}
    return {value,groups};
  }
  function invoke(method,args=[]){const token=capture(),copy=structuredClone(args);const result=uiSerial.then(async()=>{current(token);await read();current(token);if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))throw new Error(`Unsupported Native YM2203 inspector operation: ${method}`);const {value,groups}=stage(method,copy);for(const group of groups)send(group);await synth.flush();current(token);if(groups.length)await read({after:groups.at(-1).id});current(token);return value;});uiSerial=result.catch(()=>{});return result;}
  async function auditionNoteOn(channel,block,fnum,voice){const token=capture();integer(channel,2,'FM channel');integer(block,7,'Block');integer(fnum,2047,'F-NUM');if(!Number.isSafeInteger(voice)||voice<=0)throw new RangeError('Invalid audition token');send(identify({method:'batch',channel,voice,audition:true,action:'on',commands:[{method:'write',port:0,register:0x28,value:channel},{method:'write',port:0,register:0xa4+channel,value:block<<3|fnum>>8},{method:'write',port:0,register:0xa0+channel,value:fnum&255},{method:'write',port:0,register:0x28,value:0xf0|channel}]}));await synth.flush();current(token);}
  async function auditionNoteOff(channel,voice){const token=capture();integer(channel,2,'FM channel');if(!Number.isSafeInteger(voice)||voice<=0)throw new RangeError('Invalid audition token');send(identify({method:'batch',channel,voice,audition:true,action:'off',commands:[{method:'key-off',channel}]}));await synth.flush();current(token);}
  return {client,dispatch,read,invoke,auditionNoteOn,auditionNoteOff,
    async initialize(){const token=capture();enabled=true;if(initializedSession===token.session)return;client.reset();await synth.flush();current(token);initializedSession=token.session;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid YM2203 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    stopped,adoptStopped(data){stopped();return adopt(data,true);},
    reset(){version++;enabled=false;initializedSession=undefined;stopped();inspector.levels.fill(0);appliedClock=CLOCK;client._adoptState({...fmBase,clock:CLOCK,ssg:{registers:Array(16).fill(0),levels:[0,0,0]}});},
  };
}
