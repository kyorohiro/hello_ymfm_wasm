import {WonderSwanSynth,WONDERSWAN_CLOCK} from './wonderswansynth.js?v=pokey-prepare-1';
import {WonderSwanVoiceInspector} from './playground_wonderswan_inspector.js?v=pokey-prepare-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=pokey-mode-1';
import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray as bytes} from './native_genesis_voice_endpoint.js?v=pokey-mode-1';
import {prepareWonderSwanTimeline} from './wonderswan_timeline.js?v=pokey-prepare-1';

export const WONDERSWAN_CLOCK_HELD_ERROR='Release the manually held WonderSwan voices before changing the clock';
export const WONDERSWAN_CLOCK_PENDING_ERROR='WonderSwan clock change is scheduled; audition after it is applied';
export const WONDERSWAN_TIMELINE_BUSY_ERROR='Native WonderSwan timeline is playing or pending';
export const WONDERSWAN_TIMELINE_HELD_ERROR='Release the manually held WonderSwan voices before replacing or playing a timeline';

/** Commands and explicit snapshots only. The Native callback owns the core,
 * wave RAM, speaker centering and every sample of audio. */
export function createNativeGenesisWonderSwan(synth,{extra=false,clock:initialClock=WONDERSWAN_CLOCK}={}) {
  validateChipClock(initialClock);
  const statusCommand=`native_genesis_${extra?'extra_':''}wonderswan_status`;
  const context=createNativeVoiceContext(synth,{backend:extra?'extra-wonderswan':'wonderswan',statusCommand,label:'WonderSwan'});
  const {capture,current}=context;
  let clock=initialClock,appliedClock=clock,initialized=false,mainGroup,collection=null,serial=Promise.resolve(),clockSerial=Promise.resolve();
  let timelineSerial=Promise.resolve(),activeTimeline=null;
  const leases=new Map(),operations=new Set();
  const identified=message=>({...message,id:context.identity()});
  function send(message,timing={},group=mainGroup) {
    const token=capture();timing.checkCurrent?.();
    synth.enqueue({type:extra?'extra-wonderswan':'wonderswan',message:{...(extra?{chip:'wonderswan'}:{}),...(group===undefined?{}:{group}),...message},
      frame:timing.time===undefined?0:synth.frameAt(timing.time),...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
    current(token);
  }
  function translate(message) {
    const method=message.method??message.type,args=message.args??[];
    if(!Array.isArray(args))throw new TypeError('WonderSwan arguments must be an array');
    const channel=message.channel===undefined?{}:{channel:integer(message.channel,3,'WonderSwan channel')};
    if(method==='writeRegister') {
      const address=integer(args[0],0x9f,'WonderSwan register');if(address<0x80)throw new RangeError('WonderSwan register must be 0x80..0x9f');
      return {method:'write',address,value:integer(args[1],255,'WonderSwan value'),...channel,
        ...(message.controlMask===undefined?{}:{controlMask:integer(message.controlMask,255,'WonderSwan control mask')})};
    }
    if(method==='writeMemory')return {method:'memory',address:integer(args[0],0x3fff,'WonderSwan RAM address'),value:integer(args[1],255,'WonderSwan RAM value'),...channel};
    if(method==='keyOff')return {method:'key-off',channel:integer(args[0],3,'WonderSwan channel')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset')return {method:'reset'};
    if(method==='setSourceMuteMask')return {method:'source-mute',mask:integer(args[0],15,'WonderSwan source mute mask')};
    if(['stopVoices','allNotesOff'].includes(method))return {method:'stop-voices'};
    throw new Error(`Unsupported Native WonderSwan operation: ${method}`);
  }
  const client=new WonderSwanSynth({clock,transport:{
    writeRegister:(address,value,channel,controlMask)=>send(translate({method:'writeRegister',args:[address,value],channel,controlMask})),
    writeMemory:(address,value,channel)=>send(translate({method:'writeMemory',args:[address,value],channel})),
    reset:()=>{cancel(operation=>operation.timeline===true);send({method:'reset'});},
    prepareTimeline:trace=>prepareTimeline(trace),playTimeline:()=>playTimeline(),stopTimeline:()=>stopTimeline(),
  }});
  const disposeClient=client.dispose.bind(client);
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}}});
  if(!extra)Object.defineProperty(client,'id',{value:'wonderswan',enumerable:true});
  const inspector=new WonderSwanVoiceInspector({clock:()=>appliedClock,sampleRate:synth.clock.sampleRate,
    dispatch(command,owner,metadata){if(!collection)throw new Error('WonderSwan inspector command outside an edit');collection.push({command,owner,...metadata});}});
  const notify=authorEdit=>synth.emit?.({type:'native-state',name:'ws',state:client._getState(),...(authorEdit?{authorEdit}:{})});
  function adopt(data,{author=false}={}) {
    appliedClock=validateChipClock(data?.clock);bytes(data.registers,32,255,'WonderSwan registers');bytes(data.memory,16384,255,'WonderSwan RAM');context.validateHeld(data,3);
    inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.registers.set(data.registers);inspector.memory.set(data.memory);
    if(data.held){for(const channel of leases.keys())if(!data.held.includes(channel))leases.delete(channel);for(const channel of inspector.auditions.keys())if(!data.held.includes(channel))inspector.auditions.delete(channel);}
    if(author){if(data.authoredRegisters)bytes(data.authoredRegisters,32,255,'WonderSwan authored registers');clock=appliedClock;client._adoptState({clock,initialized:data.initialized!==false,registers:data.authoredRegisters??data.registers,memory:data.memory});}
    return {...data,...inspector.read(),held:data.held??[...leases.keys()]};
  }
  async function snapshot(args={}) {
    const token=capture();
    const result=await (args.after===undefined?synth.nativeRequest(statusCommand,args):synth.observeNativeSnapshot(statusCommand,args));
    current(token);const data=extra?result?.wonderswan:result;
    if(!data||typeof data!=='object')throw new Error('Native WonderSwan returned an invalid snapshot');
    return {...data,sampleRate:result.sampleRate??data.sampleRate,frame:result.frame??data.frame,revision:result.revision??data.revision};
  }
  const read=async(args={})=>adopt(await snapshot(args));
  const cancel=matches=>{for(const operation of operations)if(matches(operation)){operation.cancelled=true;operation.abort?.();}};
  const abort=()=>new DOMException('Native WonderSwan timeline was cancelled','AbortError');
  function timelineOperation(timing={}) {
    const token=capture(),operation={group:mainGroup,performance:timing.performance,owner:timing.owner,cancelled:false,timeline:true};
    if(operations.size>=256)throw new RangeError('Native WonderSwan preparation request queue is full');
    operations.add(operation);
    operation.check=()=>{current(token);timing.checkCurrent?.();if(operation.cancelled)throw abort();};
    return operation;
  }
  function prepareTimeline(input,timing={}) {
    let op,trace;
    try{op=timelineOperation(timing);trace=prepareWonderSwanTimeline(input,{sampleRate:synth.clock.sampleRate});}
    catch(error){if(op)operations.delete(op);return Promise.reject(error);}
    const result=timelineSerial.then(async()=>{
      op.check();if(activeTimeline)throw new Error(WONDERSWAN_TIMELINE_BUSY_ERROR);
      const edit=identified({method:'prepare-timeline',trace:{...trace,pcmData:Array.from(trace.pcmData)}});
      send(edit,{...timing,time:undefined},op.group);await synth.flush();op.check();
      const applied=await snapshot({after:edit.id});op.check();
      if(!applied.timeline?.loaded)throw new Error('Native WonderSwan timeline was not prepared');
      return {...applied.timeline};
    }).finally(()=>operations.delete(op));
    timelineSerial=result.then(()=>{},()=>{});return result;
  }
  function playTimeline(timing={}) {
    let op;
    try{op=timelineOperation(timing);if(activeTimeline)throw new Error(WONDERSWAN_TIMELINE_BUSY_ERROR);}
    catch(error){if(op)operations.delete(op);return Promise.reject(error);}
    const result=new Promise((resolve,reject)=>{
      const playing={op,timer:null,token:context.identity()};activeTimeline=playing;
      const fail=error=>{if(activeTimeline===playing)activeTimeline=null;clearTimeout(playing.timer);reject(error);};
      op.abort=()=>fail(abort());
      const poll=async()=>{try{
        op.check();const applied=await snapshot();op.check();const state=applied.timeline;
        if(state?.token!==playing.token||state.cancelled)throw abort();
        if(state.ended&&!state.playing){activeTimeline=null;resolve({...state,state:{clock:applied.clock,initialized:true,registers:applied.authoredRegisters??applied.registers,memory:applied.memory}});return;}
        if(!state.playing)throw abort();
        playing.timer=setTimeout(poll,50);
      }catch(error){fail(error);}};
      const admission=timelineSerial.then(async()=>{
        op.check();const edit=identified({method:'play-timeline',token:playing.token});
        send(edit,timing,op.group);await synth.flush();op.check();
        const applied=await snapshot({after:edit.id});op.check();
        const state=applied.timeline;if(!state?.loaded||state.token!==playing.token)throw new Error('Native WonderSwan timeline was not started');
        clock=applied.clock;client._adoptClock(clock);notify({clock});
        const remaining=Math.max(0,state.durationSamples-state.positionSamples)/44100;
        playing.timer=setTimeout(poll,Math.max(1,Math.min(2147483647,remaining*1000)));
      });
      // Completion waits remain outside the admission FIFO: Stop and another
      // endpoint must be able to cancel an already scheduled future playback.
      timelineSerial=admission.then(()=>{},()=>{});admission.catch(fail);
    }).finally(()=>operations.delete(op));return result;
  }
  async function stopTimeline(timing={}) {
    const op=timelineOperation(timing);cancel(operation=>operation!==op&&operation.timeline===true&&operation.group===op.group);
    try{op.check();const edit=identified({method:'stop-timeline'});send(edit,{...timing,time:undefined},op.group);await synth.flush();op.check();const applied=await snapshot({after:edit.id});op.check();return {...applied.timeline};}
    finally{operations.delete(op);}
  }
  function clockCommand(hz,timing={}) {
    validateChipClock(hz);const token=capture(),operation={group:mainGroup,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(operation);
    const check=()=>{current(token);timing.checkCurrent?.();if(operation.cancelled)throw new DOMException('Native WonderSwan clock was cancelled','AbortError');};
    const result=clockSerial.then(async()=>{check();await synth.flush();check();const edit=identified({method:'clock',hz});send(edit,timing,operation.group);await synth.flush();check();const applied=await snapshot({after:edit.id});check();if(applied.clock!==hz)throw new Error('Native WonderSwan clock was not applied');clock=hz;notify({clock:hz});}).finally(()=>operations.delete(operation));
    clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  client._allocateMainOwner=()=>context.identity();
  client._withMainOwner=(group,callback)=>{const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{cancel(operation=>operation.group===group);send(identified({method:'cancel-main-owner',targetGroup:group}));};
  client._stopVoices=async()=>{const token=capture();send(identified({method:'stop-voices'}));await synth.flush();current(token);};
  function dispatch(message,timing={}) {
    const token=capture(),method=message.method??message.type;timing.checkCurrent?.();
    if(method==='clock')return {deferred:clockCommand(message.args?.[0],timing).then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id,value:true};})};
    if(['prepareTimeline','playTimeline','stopTimeline'].includes(method)){
      const result=(method==='prepareTimeline'?prepareTimeline(message.args?.[0],timing):method==='playTimeline'?playTimeline(timing):stopTimeline(timing));
      const reply=result.then(value=>message.id===undefined?undefined:{id:message.id,value});
      return {deferred:reply};
    }
    if(method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};
    if(['reset','stopVoices','allNotesOff'].includes(method))cancel(operation=>operation.timeline===true&&(mainGroup===undefined||operation.group===mainGroup));
    send(translate(message),timing);return synth.flush().then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id,value:true};});
  }
  function patchClient(method,args) {
    const state=client._getState(),commands=[],author=new WonderSwanVoiceInspector({clock:()=>clock,dispatch:command=>commands.push(command)});
    author.registers.set(state.registers);author.memory.set(state.memory);author.invoke(method,args);
    const patch={registers:[],memory:[]};
    for(const command of commands) {
      if(command.method==='writeMemory'){patch.memory.push(command.args.slice());continue;}
      if(command.method!=='writeRegister')continue;
      const [address,value]=command.args,index=address-0x80;let mask=command.controlMask??255;
      if(method==='setVoice'&&address>=0x88&&address<=0x8b){const pan=args[1].pan;mask=('left'in pan?240:0)|('right'in pan?15:0);}
      if(method==='setNoise'&&address===0x8e){const p=args[0];mask=('type'in p?7:0)|('enabled'in p?16:0);}
      patch.registers.push([index,value&~(address===0x8e?8:0),mask]);
    }
    client._applyAuthorEdit(patch);return patch;
  }
  async function invoke(method,args=[]) {
    const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
      current(token);if(method==='setClock')return clockCommand(copy[0]);const applied=await read();current(token);
      if(method==='auditionOn'&&applied.pendingClocks>0)throw new Error(WONDERSWAN_CLOCK_PENDING_ERROR);
      if(method==='auditionOn'&&(applied.pendingTimelines>0||applied.timeline?.playing))throw new Error(WONDERSWAN_TIMELINE_BUSY_ERROR);
      const previous=new Map(inspector.auditions),previousLeases=new Map(leases);collection=[];let value,collected;
      try{value=inspector.invoke(method,copy);collected=collection;}finally{collection=null;}
      const nextLeases=new Map(),ownerVoices=new Map(),owner=id=>`voice-editor:${id}`;
      for(const [channel,id]of previous)if(previousLeases.has(channel))ownerVoices.set(`${channel}:${owner(id)}`,previousLeases.get(channel));
      for(const [channel,id]of inspector.auditions){const voice=previous.get(channel)===id?previousLeases.get(channel):context.identity();nextLeases.set(channel,voice);ownerVoices.set(`${channel}:${owner(id)}`,voice);}
      const groups=[];
      for(const item of collected) {
        const target=nativeVoiceChannel('wonderswan',item.command,{wonderswanRegisters:inspector.registers});let channel,action='edit',voice;
        if(item.owner){const match=[...inspector.auditions].find(([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||key===target))??[...previous].find(([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||key===target));if(!match)throw new Error('Invalid WonderSwan audition owner');channel=match[0];action=item.preserveOwner===true?'edit':inspector.auditions.get(channel)===match[1]?'on':'off';voice=ownerVoices.get(`${channel}:${item.owner}`);}
        else channel=Number.isInteger(target)?target:0;
        if(action==='off'&&!voice)continue;let group=groups.at(-1);
        if(group?.channel!==channel||group.action!==action||group.voice!==voice){group=identified({method:'batch',channel,audition:true,action,...(voice?{voice}:{}),commands:[]});groups.push(group);}
        group.commands.push(translate(item.command));
      }
      for(const group of groups)send(group);await synth.flush();current(token);
      if(groups.length){const applied=await read({after:groups.at(-1).id});current(token);leases.clear();for(const [channel,voice]of nextLeases)if(applied.held.includes(channel))leases.set(channel,voice);else inspector.auditions.delete(channel);if(!method.startsWith('audition'))notify(patchClient(method,copy));}
      return value;
    });serial=result.catch(()=>{});return result;
  }
  return {client,dispatch,read,invoke,
    cancelOwner:(performance,owner)=>cancel(operation=>operation.performance===performance&&operation.owner===owner),
    cancelPerformance:performance=>cancel(operation=>operation.performance!==undefined&&(performance===null||operation.performance===performance)),
    async initialize(){const token=capture();if(initialized)return;initialized=true;if(!extra)client.initialize();await synth.flush();current(token);},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid WonderSwan mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    stopped(){cancel(()=>true);leases.clear();inspector.resetAuditions();},
    adoptStopped(data){this.stopped();adopt(data,{author:true});},
    reset(){cancel(()=>true);context.invalidate();initialized=false;mainGroup=undefined;leases.clear();inspector.reset();if(extra)disposeClient();else{clock=appliedClock=initialClock;client._adoptState({clock,initialized:false,registers:Array(32).fill(0),memory:Array(16384).fill(0)});}},
  };
}
