import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-extra-lifetime-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';

/** Shared lifecycle for OPL/OPLL/AY register-authoring clients. The audio thread
 * owns hardware state; applied readback never rewrites an author's cache. */
export function createNativeExtraRegisterVoice(synth,{kind,label,clock:initialClock,registerCount,voiceCount,createClient,createInspector,logical=Number,physical=Number,voiceKey=Number,validate,adoptInspector,track,cancelAuthor,editChannel,melodicChannels=kind==='ym2413'?9:3,rhythmBase=kind==='ym2413'?9:undefined,layoutRegister=kind==='ym2413'?14:undefined,layoutRegisters=layoutRegister===undefined?[]:[layoutRegister],readLayout,physicalMatches,patchAuthor,readFields,describeAuthorEdit}){
  const context=createNativeVoiceContext(synth,{backend:`extra-${kind}`,statusCommand:`native_genesis_extra_${kind}_status`,label:`additional ${label}`});
  const {capture,current}=context;let clock=initialClock,appliedClock=clock,initialized=false,mainGroup,collection=null,serial=Promise.resolve(),clockSerial=Promise.resolve();
  const leases=new Map(),authoredOwners=new Map(),sentRegisters=new Uint8Array(registerCount),clockRequests=new Set();let layout=false,layoutRevision=0,layoutGeneration=0,layoutPending=false,layoutObserver,layoutMetadata='{"rhythmEnabled":false}';
  function applyLayout(data){if(layoutRegister===undefined)return;if(!Number.isSafeInteger(data.layoutRevision)||data.layoutRevision<0||typeof data.layoutPending!=='boolean')throw new Error(`Native additional ${label} returned invalid layout progress`);if(data.layoutRevision<layoutRevision)return;layoutRevision=data.layoutRevision;const next=readLayout?readLayout(data):{rhythmEnabled:!!(data.registers[layoutRegister]&32)},metadata=JSON.stringify(next);layout=!!next.rhythmEnabled;if(layoutMetadata!==metadata){layoutMetadata=metadata;synth.notifyLayout?.(next);}}
  // A single completion fence observes queued mode transitions. The authoring
  // shadow may be ahead of the renderer, so it never controls Keyboard layout.
  function observeLayout(){
    if(layoutObserver||!layoutPending)return;const token=capture();
    layoutObserver=Promise.resolve().then(async()=>{while(layoutPending){const generation=layoutGeneration;await synth.flush();current(token);const result=await synth.observeNativeSnapshot(`native_genesis_extra_${kind}_status`,{afterLayoutRevision:layoutRevision});current(token);const data=result?.[kind];nativeSnapshotArray(data?.registers,registerCount,255,`${label} registers`);applyLayout(data);layoutPending=data.layoutPending||layoutGeneration!==generation;}}).catch(error=>{layoutPending=false;if(error?.name!=='AbortError'&&synth.isReady())synth.reportAsyncError?.(error);}).finally(()=>{layoutObserver=undefined;if(layoutPending&&synth.isReady())observeLayout();});
  }
  function tagged(message,timing={}){
    const value={...(mainGroup===undefined?{}:{group:mainGroup}),...message};
    if(value.method==='write'){
      track?.(sentRegisters,authoredOwners,value);sentRegisters[value.register]=value.value;
      if(layoutRegister!==undefined&&layoutRegisters.includes(value.register)){value.id??=context.identity();layoutGeneration++;if(timing.time!==undefined||layoutPending||value.register!==layoutRegister||layout!==!!(value.value&32))layoutPending=true;}
    }else if(value.method==='reset'){
      sentRegisters.fill(0);authoredOwners.clear();if(layoutRegister!==undefined){value.id??=context.identity();layoutGeneration++;if(timing.time!==undefined||layout||layoutPending||layoutRegisters.length>1)layoutPending=true;}
    }return value;
  }
  const send=(message,timing)=>{context.send(kind,tagged(message,timing),timing);observeLayout();},timed=(message,timing)=>context.timed(kind,tagged(message,timing),timing),identified=message=>({...message,id:context.identity()});
  function translate(message){
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError(`${label} arguments must be an array`);
    if(method==='writeRegister'){const register=integer(args[0],registerCount-1,'Register'),bank=integer(args[2]??0,kind==='ymf262'?1:0,'Bank');if(register>255&&bank)throw new RangeError('Use a flattened register or a bank, not both');return {method:'write',register:register|(bank<<8),value:integer(args[1],255,'Value'),...(rhythmBase!==undefined&&message.intentMask!==undefined?{intentMask:integer(message.intentMask,31,'Rhythm intent mask')}:{})};}
    if(method==='setRetainedLevel'&&kind==='ay8910')return {method:'set-retained-level',channel:integer(args[0],2,'Channel'),level:integer(args[1],31,'Retained level')};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],melodicChannels-1,'Channel')};
    if(method==='forceRhythmOff'&&rhythmBase!==undefined)return {method:'key-off',channel:rhythmBase+integer(args[0],4,'Drum')};
    if(method==='auditionKeyOn'&&rhythmBase!==undefined)return {method:'audition-key-on',channel:integer(args[0],melodicChannels-1,'Channel')};
    if(method==='auditionRhythmOn'&&rhythmBase!==undefined)return {method:'audition-key-on',channel:rhythmBase+integer(args[0],4,'Drum')};
    if(method==='reset')return {method:'reset'};
    if(method==='allNotesOff')return {method:'all-notes-off'};
    if(method==='stopVoices')return {method:'stop-voices'};
    throw new Error(`Unsupported Native additional ${label} operation: ${method}`);
  }
  const client=createClient((method,args,metadata)=>send(translate({method,args,...metadata})),{clock,request:(method,args)=>dispatch({method,args})});
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}}});
  const inspector=createInspector({clock:()=>appliedClock,sampleRate:synth.clock.sampleRate,dispatch(command,owner,options){if(!collection)throw new Error(`${label} inspector command outside an edit`);collection.push({command,owner,...options});}});
  const notify=(method,args)=>synth.emit?.({type:'native-state',name:kind,state:client._getState(),...(describeAuthorEdit&&method?{authorEdit:describeAuthorEdit(method,args)}:{})});
  function adopt(data){
    nativeSnapshotArray(data.registers,registerCount,255,`${label} registers`);context.validateHeld(data,voiceCount-1);validate?.(data);applyLayout(data);appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.registers.set(data.registers);adoptInspector?.(inspector,data);
    return {...data,...inspector.read(),...readFields?.(data),held:(data.held??[...leases.keys()].map(logical)).map(voiceKey)};
  }
  const snapshot=async(args={})=>{const data=await context.snapshot(kind,args);adopt(data);return data;},read=async(args={})=>adopt(await snapshot(args));
  function clockCommand(hz,timing={},reply){
    const token=capture(),request={group:mainGroup,cancelled:false};validateChipClock(hz);timing.checkCurrent?.();clockRequests.add(request);
    const check=()=>{current(token);timing.checkCurrent?.();if(request.cancelled)throw new DOMException(`Native additional ${label} clock was cancelled`,'AbortError');};
    const result=clockSerial.then(async()=>{check();await synth.flush();check();const command=identified({method:'clock',hz,...(request.group===undefined?{}:{group:request.group})});send(command,timing);await synth.flush();check();const data=await snapshot({after:command.id});check();if(data.clock!==hz)throw new Error(`Native additional ${label} clock was not applied`);client._adoptClock(hz);notify('clock',[hz]);return reply?.();}).finally(()=>clockRequests.delete(request));clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  client._allocateMainOwner=()=>context.identity();
  client._withMainOwner=(group,callback)=>{const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{for(const request of clockRequests)if(request.group===group)request.cancelled=true;send(identified({method:'cancel-main-owner',targetGroup:group}));const state=client._getState();cancelAuthor?.(state,authoredOwners,group);client._adoptState(state);};
  async function dispatch(message,timing={}){
    const token=capture();timing.checkCurrent?.();
    if(Array.isArray(message)){const commands=message.map(translate);synth.enqueueMany(commands.map(command=>timed(command,timing)));observeLayout();await synth.flush();current(token);timing.checkCurrent?.();return;}
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError(`${label} arguments must be an array`);
    if(method==='clock')return clockCommand(args[0],timing,()=>message.id===undefined?undefined:{id:message.id});
    if(method!=='dispose'){send(translate(message),timing);await synth.flush();current(token);timing.checkCurrent?.();}
    return message.id===undefined?undefined:{id:message.id,...(method==='dispose'?{value:true}:{})};
  }
  function authorPatch(method,args){if(patchAuthor)return patchAuthor(method,args,client._getState(),clock);const value=createClient(()=>{}, {clock});value._adoptClock=hz=>{value.clock=validateChipClock(hz);};value._adoptState(client._getState());value[method](...args);return value._getState();}
  function invoke(method,args=[]){
    const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
      current(token);await read();current(token);const previous=new Map(inspector.auditions),previousLeases=new Map(leases);collection=[];let value,collected;
      try{value=inspector.invoke(method,copy);collected=collection;}finally{collection=null;}
      const nextLeases=new Map(),ownerVoices=new Map(),owner=id=>`voice-editor:${id}`,ownerKey=(key,id)=>`${logical(key)}:${owner(id)}`;
      for(const [key,id]of previous){const voice=previousLeases.get(key);if(voice)ownerVoices.set(ownerKey(key,id),voice);}
      for(const [key,id]of inspector.auditions){const voice=previous.get(key)===id?previousLeases.get(key):context.identity();nextLeases.set(key,voice);ownerVoices.set(ownerKey(key,id),voice);}
      const groups=[],stagedRegisters=Array.from(inspector.registers);
      for(const item of collected){const edit=item.preserveOwner===true||!item.owner;let key,action,voice;
        const target=nativeVoiceChannel(kind,item.command);
        if(edit){action='edit';key=editChannel?.(method,copy,item.command,stagedRegisters)??(Number.isInteger(target)?target:0);}
        else{const matches=([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||(physicalMatches?physicalMatches(key,target):physical(key)===target)),match=[...inspector.auditions].find(matches)??[...previous].find(matches);if(!match)throw new Error(`Invalid ${label} audition owner`);key=match[0];action=inspector.auditions.get(key)===match[1]?'on':'off';voice=ownerVoices.get(ownerKey(key,match[1]));}
        if(item.command.method==='writeRegister')stagedRegisters[item.command.args[0]|((item.command.args[2]??0)<<8)]=item.command.args[1];
        if(action==='off'&&!voice)continue;const channel=logical(key);let group=groups.at(-1);if(!group||group.channel!==channel||group.action!==action||group.voice!==voice){group=identified({method:'batch',channel,...(voice?{voice}:{}),audition:true,action,commands:[]});groups.push(group);}group.commands.push(translate(item.command));
      }
      const patch=['auditionOn','auditionOff','auditionAllOff'].includes(method)?null:authorPatch(method,copy);
      for(const group of groups)send(group);await synth.flush();current(token);if(groups.length){await read({after:groups.at(-1).id});current(token);leases.clear();for(const [key,voice]of nextLeases)leases.set(key,voice);if(patch){client._adoptState(patch);notify(method,copy);}}return value;
    });serial=result.catch(()=>{});return result;
  }
  return {client,dispatch,read,invoke,
    async initialize(){const token=capture();context.enable(kind);if(initialized)return;client.initialize();await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError(`Invalid ${label} mix`);const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){context.invalidate();context.disable(kind);initialized=false;mainGroup=undefined;layoutPending=false;layout=false;layoutRevision=0;layoutMetadata='{"rhythmEnabled":false}';for(const request of clockRequests)request.cancelled=true;leases.clear();authoredOwners.clear();sentRegisters.fill(0);inspector.reset();appliedClock=initialClock;client._adoptState({clock:initialClock,initialized:false,registers:Array(registerCount).fill(0),...(kind==='ay8910'?{levels:[9,9,9]}:{})});},
  };
}
