import {preparePokeyTimeline} from './pokey_timeline.js?v=pokey-prepare-1';
import {PokeySynth,POKEY_CLOCK} from './pokeysynth.js?v=pokey-mode-1';
import {createPokeyRegisterClient} from './playground_pokey.js?v=pokey-prepare-1';
import {PokeyVoiceInspector} from './playground_pokey_inspector.js?v=ps1-deferred-release-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=ps1-deferred-release-1';
import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray as array} from './native_genesis_voice_endpoint.js?v=ps1-deferred-release-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=ps1-native-1';

export const POKEY_TIMELINE_BUSY_ERROR='Native POKEY timeline is playing or pending';
export const POKEY_TIMELINE_HELD_ERROR='Release the manually held POKEY voices before replacing or playing a timeline';
export const EXTRA_POKEY_CLOCK_HELD_ERROR='Release the manually held additional POKEY voices before changing the clock';
/** Callback-owned four-channel POKEY. This endpoint only transfers controls;
 * the raw DSP and speaker DC boundary run entirely in the Native callback. */
export function createNativeGenesisPokeyEndpoint(synth,{clock:initialClock=POKEY_CLOCK,globalName='pokey',primary=false}={}){
  validateChipClock(initialClock);
  const context=createNativeVoiceContext(synth,{backend:'extra-pokey',statusCommand:'native_genesis_extra_pokey_status',label:'additional POKEY'});
  const {capture,current}=context;let timelineSerial=Promise.resolve(),activeTimeline=null,pendingTimelineBytes=0;const operations=new Set();let clock=initialClock,mainGroup,serial=Promise.resolve(),initialized=false,collect=null;
  const leases=new Map(),identified=message=>({...message,id:context.identity()});
  const send=(message,timing={},group=mainGroup)=>{context.send('pokey',{...(group===undefined?{}:{group}),...message},timing);};
  const client=createPokeyRegisterClient((method,args,channel)=>{if(['reset','stopVoices','allNotesOff'].includes(method))cancel(()=>true);if(method!=='dispose')send(translate({method,args,channel}));},{clock,request:(method,args)=>{const result=dispatch({method,args,id:'local-pokey-request'});return Promise.resolve(result?.deferred??result).then(reply=>reply?.value);}});
  const inspector=new PokeyVoiceInspector({clock:()=>clock,sampleRate:synth.clock.sampleRate,dispatch(command,owner,metadata){if(!collect)throw new Error('POKEY inspector outside edit');collect.push({command,owner,...metadata});}});
  const disposeClient=client.dispose.bind(client);
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}}});
  const notify=()=>synth.emit?.({type:'native-state',name:globalName,state:client._getState()});
  function translate(message){
    const method=message.method??message.type,args=message.args??[];
    if(!Array.isArray(args))throw new TypeError('POKEY arguments must be an array');
    if(method==='writeRegister')return{method:'write',register:integer(args[0],15,'POKEY register'),value:integer(args[1],255,'POKEY value'),...(message.channel===undefined?{}:{channel:integer(message.channel,3,'POKEY channel')})};
    if(method==='keyOff'||method==='forceKeyOff')return{method:'key-off',channel:integer(args[0],3,'POKEY channel')};
    if(method==='setRetainedLevel')return {method:'set-retained-level',channel:integer(args[0],3,'POKEY channel'),level:integer(args[1],15,'POKEY retained level')};
    if(method==='setChannelMuted'){if(typeof args[1]!=='boolean')throw new TypeError('Expected POKEY boolean mute');return {method:'channel-mute',channel:integer(args[0],3,'POKEY channel'),muted:args[1]};}
    if(method==='clock')return{method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset')return{method:'reset'};
    if(['stopVoices','allNotesOff'].includes(method))return{method:'stop-voices'};
    if(method==='setSourceMuteMask')return{method:'source-mute',mask:integer(args[0],15,'POKEY source mute mask')};
    throw new Error(`Unsupported Native POKEY operation: ${method}`);
  }
  function adopt(data){
    inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;validateChipClock(data.clock);array(data.registers,16,255,'POKEY registers');array(data.readRegisters,16,255,'POKEY hardware reads');context.validateHeld(data,3);
    array(data.levels,4,15,'POKEY retained levels');inspector.registers.set(data.registers);inspector.levels=[...data.levels];
    if(data.held)for(const [ch]of leases)if(!data.held.includes(ch)){leases.delete(ch);inspector.auditions.delete(ch);}
    return{...data,...inspector.read(),held:data.held??[...leases.keys()]};
  }
  async function snapshot(args={}){const token=capture();const result=await(args.after===undefined?synth.nativeRequest('native_genesis_extra_pokey_status',args):synth.observeNativeSnapshot('native_genesis_extra_pokey_status',args));current(token);if(!result?.pokey)throw new Error('Native POKEY returned an invalid snapshot');return adopt({...result.pokey,frame:result.frame,sampleRate:result.sampleRate,revision:result.revision});}
  async function clockCommand(hz,timing={}){validateChipClock(hz);timing.checkCurrent?.();capture();if(hz!==clock)throw new Error('Create a new POKEY instance to change its clock');}


  const abort=()=>new DOMException('Native POKEY timeline was cancelled','AbortError');
  const cancel=matches=>{for(const operation of operations)if(matches(operation)){operation.cancelled=true;operation.abort?.();}};
  function timelineOperation(timing={}) {
    const token=capture(),operation={group:mainGroup,performance:timing.performance,owner:timing.owner,cancelled:false};
    if(operations.size>=256)throw new RangeError('Native POKEY preparation request queue is full');
    operations.add(operation);operation.check=()=>{current(token);timing.checkCurrent?.();if(operation.cancelled)throw abort();};return operation;
  }
  const timelineState=applied=>({...applied.timeline,currentFrame:applied.frame,sampleRate:applied.sampleRate??synth.clock.sampleRate});
  function prepareTimeline(input,timing={}) {
    let op,trace;try {trace=preparePokeyTimeline(input,{sampleRate:synth.clock.sampleRate});if(trace.clock!==clock)throw new Error('Create a new POKEY instance to change its clock');if(pendingTimelineBytes+trace.data.length>32*1024*1024)throw new RangeError('Native POKEY timeline preparation queue is full');op=timelineOperation(timing);pendingTimelineBytes+=trace.data.length;}catch(error){return Promise.reject(error);}
    const result=timelineSerial.then(async()=>{op.check();if(activeTimeline)throw new Error(POKEY_TIMELINE_BUSY_ERROR);
      const edit=identified({method:'prepare-timeline',trace:{version:1,clock:trace.clock,durationSamples:trace.durationSamples,data:Array.from(trace.data)}});
      send(edit,{...timing,time:undefined},op.group);await synth.flush();op.check();const applied=await snapshot({after:edit.id});op.check();if(!applied.timeline?.loaded)throw new Error('Native POKEY timeline was not prepared');return timelineState(applied);
    }).finally(()=>{pendingTimelineBytes-=trace.data.length;operations.delete(op);});timelineSerial=result.then(()=>{},()=>{});return result;
  }
  async function getTimelineState(timing={}) {const token=capture();timing.checkCurrent?.();const applied=await snapshot();current(token);timing.checkCurrent?.();return timelineState(applied);}
  function playTimeline(options={},timing={}) {
    let op;try {if(options===null||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='startFrame'))throw new TypeError('POKEY timeline playback options must contain only startFrame');if(options.startFrame!==undefined&&(!Number.isSafeInteger(options.startFrame)||options.startFrame<0))throw new RangeError('Invalid POKEY timeline startFrame');op=timelineOperation(timing);if(activeTimeline)throw new Error(POKEY_TIMELINE_BUSY_ERROR);}catch(error){if(op)operations.delete(op);return Promise.reject(error);}
    const result=new Promise((resolve,reject)=>{
      const playing={op,timer:null,token:context.identity()};activeTimeline=playing;
      const fail=error=>{if(activeTimeline===playing)activeTimeline=null;clearTimeout(playing.timer);reject(error);};op.abort=()=>fail(abort());
      const poll=async()=>{try {op.check();const applied=await snapshot();op.check();const state=applied.timeline;if(state?.token!==playing.token||state.cancelled)throw abort();
        if(state.ended&&!state.playing){activeTimeline=null;const stateImage={clock:applied.clock,initialized:true,registers:applied.registers,levels:applied.levels};client._adoptState(stateImage);notify();resolve({...timelineState(applied),state:stateImage});return;}
        if(!state.playing)throw abort();playing.timer=setTimeout(poll,50);
      }catch(error){fail(error);}};
      const admission=timelineSerial.then(async()=>{op.check();const edit=identified({method:'play-timeline',token:playing.token,...(options.startFrame===undefined?{}:{startFrame:options.startFrame})});send(edit,{...timing,time:undefined},op.group);await synth.flush();op.check();const applied=await snapshot({after:edit.id});op.check();const state=applied.timeline;if(!state?.loaded||state.token!==playing.token)throw new Error('Native POKEY timeline was not started');
        const wait=(Math.max(0,(state.startFrame??applied.frame)-applied.frame)/(applied.sampleRate??synth.clock.sampleRate)+Math.max(0,state.durationSamples-state.positionSamples)/44100)*1000;playing.timer=setTimeout(poll,Math.max(1,Math.min(2147483647,wait)));
      });timelineSerial=admission.then(()=>{},()=>{});admission.catch(fail);
    }).finally(()=>operations.delete(op));return result;
  }
  async function stopTimeline(timing={}) {const op=timelineOperation(timing);cancel(operation=>operation!==op&&operation.group===op.group);try {op.check();const edit=identified({method:'stop-timeline'});send(edit,{...timing,time:undefined},op.group);await synth.flush();op.check();const applied=await snapshot({after:edit.id});op.check();return timelineState(applied);}finally{operations.delete(op);}}


  client.setClock=hz=>clockCommand(hz);
  client._allocateMainOwner=()=>context.identity();client._withMainOwner=(group,callback)=>{const old=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=old;}};
  client._cancelMainOwner=group=>{cancel(operation=>operation.group===group);send(identified({method:'cancel-main-owner',targetGroup:group}));};
  function dispatch(message,timing={}){
    const method=message.method??message.type;if(['prepareTimeline','getTimelineState','playTimeline','stopTimeline'].includes(method)){const result=method==='prepareTimeline'?prepareTimeline(message.args?.[0],timing):method==='getTimelineState'?getTimelineState(timing):method==='playTimeline'?playTimeline(message.args?.[0],timing):stopTimeline(timing);return {deferred:result.then(value=>message.id===undefined?undefined:{id:message.id,value})};}return dispatchControl(message,timing);
  }
  async function dispatchControl(message,timing={}){
    const token=capture(),method=message.method??message.type;timing.checkCurrent?.();
    if(['reset','stopVoices','allNotesOff'].includes(method))cancel(operation=>mainGroup===undefined||operation.group===mainGroup);
    if(method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};
    if(method==='clock'){await clockCommand(message.args?.[0],timing);return message.id===undefined?undefined:{id:message.id,value:true};}
    if(method==='readRegister'){
      const register=integer(message.args?.[0],15,'POKEY register'),m=identified({method:'barrier'});send(m,timing);await synth.flush();current(token);const data=await snapshot({after:m.id});current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id,value:data.readRegisters[register]};
    }
    send(translate(message),timing);await synth.flush();current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id,value:true};
  }
  async function invoke(method,args=[]){const token=capture(),copy=structuredClone(args);const result=serial.then(async()=>{
    current(token);if(method==='setClock')return clockCommand(copy[0]);const applied=await snapshot();current(token);if(method==='auditionOn'&&(applied.pendingTimelines>0||applied.timeline?.playing))throw new Error(POKEY_TIMELINE_BUSY_ERROR);
    const previous=new Map(inspector.auditions),previousLeases=new Map(leases);collect=[];let value,items;
    try{value=inspector.invoke(method,copy);items=collect;}finally{collect=null;}
    const nextLeases=new Map(),voiceFor=new Map(),owner=id=>`voice-editor:${id}`;
    for(const [ch,id]of previous)if(previousLeases.has(ch))voiceFor.set(`${ch}:${owner(id)}`,previousLeases.get(ch));
    for(const [ch,id]of inspector.auditions){const voice=previous.get(ch)===id?previousLeases.get(ch):context.identity();nextLeases.set(ch,voice);voiceFor.set(`${ch}:${owner(id)}`,voice);}
    const groups=[];for(const item of items){const target=nativeVoiceChannel('pokey',item.command);let channel,voice,action='edit';
      if(item.owner){const match=[...inspector.auditions].find(([ch,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||ch===target))??[...previous].find(([ch,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||ch===target));if(!match)throw new Error('Invalid POKEY audition owner');channel=match[0];voice=voiceFor.get(`${channel}:${item.owner}`);action=item.preserveOwner?'edit':inspector.auditions.get(channel)===match[1]?'on':'off';}
      else channel=Number.isInteger(target)?target:0;
      if(action==='off'&&!voice)continue;let group=groups.at(-1);if(!group||group.channel!==channel||group.action!==action||group.voice!==voice){group=identified({method:'batch',channel,...(voice?{voice}:{}),action,audition:true,commands:[]});groups.push(group);}group.commands.push(translate(item.command));
    }
    for(const group of groups)send(group);if(method==='setVolume')send(identified({method:'set-retained-level',channel:Number(copy[0]),level:copy[1]}));await synth.flush();current(token);
    if(groups.length){await snapshot({after:groups.at(-1).id});current(token);leases.clear();for(const [ch,voice]of nextLeases)leases.set(ch,voice);}
    if(!['auditionOn','auditionOff','auditionAllOff'].includes(method)){
      const author=new PokeySynth({clock,transport:{writeRegister(){},reset(){}}});author._adoptState(client._getState());author[method](...copy);client._adoptState(author._getState());author.dispose();notify();
    }
    return value;
  });serial=result.catch(()=>{});return result;}

  return{client,dispatch,read:snapshot,invoke,
    cancelOwner:(performance,owner)=>cancel(operation=>operation.performance===performance&&operation.owner===owner),
    cancelPerformance:performance=>cancel(operation=>operation.performance!==undefined&&(performance===null||operation.performance===performance)),
    async initialize(){const token=capture();context.enable('pokey');await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid POKEY mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    stopped(){cancel(()=>true);context.invalidate();leases.clear();inspector.resetAuditions();initialized=false;},
    reset(){cancel(()=>true);context.invalidate();context.disable('pokey');leases.clear();inspector.reset();initialized=false;if(!primary)disposeClient();},
    adoptStopped(){const state=client._getState();for(let ch=0;ch<4;ch++)state.registers[ch*2+1]&=240;client._adoptState(state);notify();},
    get initialized(){return initialized;},
  };
}
export function createNativeGenesisExtraPokey(synth,options={}){
  const clock=validateChipClock(options.clock??POKEY_CLOCK);
  return createNativeGenesisExtraChip(synth,{...options,kind:'pokey',label:'POKEY',clock,createArgs:{clock},createEndpoint:facade=>createNativeGenesisPokeyEndpoint(facade,{clock})});
}
