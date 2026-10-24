import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=y8950-adpcm-ui-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=y8950-adpcm-ui-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {copyY8950AdpcmMemory,Y8950_ADPCM_MEMORY_BYTES} from './y8950_adpcm.js?v=y8950-adpcm-ui-1';
import {validateY8950AdpcmPreview} from './y8950_adpcm_preview.js?v=y8950-adpcm-ui-1';
import {createNativeY8950AdpcmInspection,createNativeY8950SampleLoader} from './native_genesis_y8950_inspector.js?v=y8950-adpcm-ui-1';

/** Preparation uploads apply immediately; musical writes keep their existing
 * performance clock. Every resolved upload has crossed an applied-state fence.
 * @template [Group=unknown]
 * @template [AuthorVersion=unknown]
 * @param {ReturnType<typeof createNativeVoiceContext>} context
 * @param {{send?:(message:Record<string,unknown>,timing?:{time?:number,performance?:number,owner?:number|string,checkCurrent?:()=>void})=>unknown,
 * getGroup?:()=>Group,withGroup?:(group:Group,callback:()=>unknown)=>unknown,
 * clearAuthor?:(version:AuthorVersion)=>void,getAuthorVersion?:()=>AuthorVersion,
 * decodeAudio?:import('./y8950_adpcm.js?v=y8950-adpcm-ui-1').Y8950AdpcmDecoder,
 * onMemoryApplied?:(state:Record<string,unknown>,preview:import('./y8950_adpcm.js?v=y8950-adpcm-ui-1').Y8950AdpcmPreview|null)=>void}} [options] */
export function createNativeY8950AdpcmTransport(context,{send,getGroup=()=>undefined,withGroup=(_group,callback)=>callback(),clearAuthor=()=>{},getAuthorVersion=()=>undefined,decodeAudio,onMemoryApplied=()=>{}}={}){
  const {synth,capture,current}=context,cancelledGroups=new Map(),cancelledOwners=new Map(),cancelledPerformances=new Map();let generation=0,memoryOperation=0;
  const abort=()=>new DOMException('Native Y8950 ADPCM operation was cancelled','AbortError');
  function captureContext(){const group=getGroup();return {token:capture(),group,generation,version:cancelledGroups.get(group)??0};}
  function checkCurrent(scope){if(!scope){capture();return;}current(scope.token);if(scope.generation!==generation||(cancelledGroups.get(scope.group)??0)!==scope.version||scope.performance!==undefined&&((cancelledOwners.get(`${scope.performance}:${scope.owner}`)??0)!==scope.ownerVersion||(cancelledPerformances.get(scope.performance)??0)!==scope.performanceVersion))throw abort();}
  function withContext(scope,callback){checkCurrent(scope);return withGroup(scope.group,callback);}
  async function control(method,input,address=0,timing={},scope=captureContext(),preview){
    const bytes=method==='adpcm-memory'?copyY8950AdpcmMemory(input,address):undefined;
    preview=bytes?validateY8950AdpcmPreview(preview,address,bytes.length):null;
    if(timing.performance!==undefined){scope={...scope,performance:timing.performance,owner:timing.owner,ownerVersion:cancelledOwners.get(`${timing.performance}:${timing.owner}`)??0,performanceVersion:cancelledPerformances.get(timing.performance)??0};}
    checkCurrent(scope);timing.checkCurrent?.();
    const operation=++memoryOperation,authorVersion=getAuthorVersion(),id=context.identity(),message={method,id,...(bytes?{address,bytes:Array.from(bytes)}:{}),...(scope.group===undefined?{}:{group:scope.group})};
    withContext(scope,()=>send(message,{...timing,time:undefined}));
    await synth.flush();checkCurrent(scope);timing.checkCurrent?.();
    const state=await context.snapshot('y8950',{after:id});checkCurrent(scope);timing.checkCurrent?.();
    if(state.adpcmMemorySize!==undefined&&(!Number.isSafeInteger(state.adpcmMemorySize)||state.adpcmMemorySize<0||state.adpcmMemorySize>Y8950_ADPCM_MEMORY_BYTES))throw new Error('Native Y8950 returned invalid ADPCM memory size');
    if(operation===memoryOperation)onMemoryApplied(state,method==='adpcm-clear'?null:preview);
    withContext(scope,()=>clearAuthor(authorVersion));
  }
  return {captureContext,checkCurrent,withContext,
    ...(decodeAudio?{decodeAudio}:{}),
    loadMemory:(bytes,address,scope,preview)=>control('adpcm-memory',bytes,address,{},scope,preview),
    clearMemory:scope=>control('adpcm-clear',undefined,0,{},scope),
    request(method,args,timing={},scope){return method==='loadAdpcmMemory'?control('adpcm-memory',args[0],args[1]??0,timing,scope,args[2]):control('adpcm-clear',undefined,0,timing,scope);},
    cancelGroup:group=>cancelledGroups.set(group,(cancelledGroups.get(group)??0)+1),
    cancelOwner(performance,owner){const key=`${performance}:${owner}`;cancelledOwners.set(key,(cancelledOwners.get(key)??0)+1);},
    cancelPerformance(performance){cancelledPerformances.set(performance,(cancelledPerformances.get(performance)??0)+1);},
    reset(){generation++;memoryOperation++;cancelledGroups.clear();cancelledOwners.clear();cancelledPerformances.clear();},
  };
}

/** Shared lifecycle for OPL/OPLL/AY register-authoring clients. The audio thread
 * owns hardware state; applied readback never rewrites an author's cache. */
export function createNativeExtraRegisterVoice(synth,{kind,label,clock:initialClock,registerCount,voiceCount,createClient,createInspector,logical=Number,physical=Number,voiceKey=Number,validate,adoptInspector,track,cancelAuthor,editChannel,melodicChannels=kind==='ym2413'?9:3,rhythmBase=kind==='ym2413'?9:undefined,layoutRegister=kind==='ym2413'?14:undefined,layoutRegisters=layoutRegister===undefined?[]:[layoutRegister],readLayout,physicalMatches,patchAuthor,readFields,describeAuthorEdit}){
  const context=createNativeVoiceContext(synth,{backend:`extra-${kind}`,statusCommand:`native_genesis_extra_${kind}_status`,label:`additional ${label}`});
  const {capture,current}=context;let clock=initialClock,appliedClock=clock,initialized=false,mainGroup,collection=null,serial=Promise.resolve(),clockSerial=Promise.resolve();
  const leases=new Map(),authoredOwners=new Map(),sentRegisters=new Uint8Array(registerCount),clockRequests=new Set();let adpcmAuthorVersion=0,layout=false,layoutRevision=0,layoutGeneration=0,layoutPending=false,layoutObserver,layoutMetadata='{"rhythmEnabled":false}';
  const adpcmInspection=kind==='y8950'?createNativeY8950AdpcmInspection():null;
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
      if(kind==='y8950'&&value.register===7)adpcmAuthorVersion++;
      track?.(sentRegisters,authoredOwners,value);sentRegisters[value.register]=value.value;
      if(layoutRegister!==undefined&&layoutRegisters.includes(value.register)){value.id??=context.identity();layoutGeneration++;if(timing.time!==undefined||layoutPending||value.register!==layoutRegister||layout!==!!(value.value&32))layoutPending=true;}
    }else if(value.method==='reset'){
      adpcmAuthorVersion++;sentRegisters.fill(0);authoredOwners.clear();if(layoutRegister!==undefined){value.id??=context.identity();layoutGeneration++;if(timing.time!==undefined||layout||layoutPending||layoutRegisters.length>1)layoutPending=true;}
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
    if(kind==='y8950'&&method==='forceAdpcmOff')return {method:'key-off',channel:23};
    if(kind==='y8950'&&method==='auditionAdpcmOn')return {method:'audition-key-on',channel:23};
    if(method==='reset')return {method:'reset'};
    if(method==='allNotesOff')return {method:'all-notes-off'};
    if(method==='stopVoices')return {method:'stop-voices'};
    throw new Error(`Unsupported Native additional ${label} operation: ${method}`);
  }
  const adpcm=kind==='y8950'?createNativeY8950AdpcmTransport(context,{send,getGroup:()=>mainGroup,withGroup:(group,callback)=>{const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}},getAuthorVersion:()=>adpcmAuthorVersion,clearAuthor:version=>{if(version!==adpcmAuthorVersion)return;const state=client._getState();state.registers[7]=1;client._adoptState(state);authoredOwners.delete('adpcm');sentRegisters[7]=1;},onMemoryApplied:(state,preview)=>adpcmInspection.applied(state,preview)}):null;
  const client=createClient((method,args,metadata)=>send(translate({method,args,...metadata})),{clock,adpcmContext:adpcm??undefined,request:(method,args,scope)=>dispatch({method,args}, {},scope)});
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}}});
  const inspector=createInspector({clock:()=>appliedClock,sampleRate:synth.clock.sampleRate,dispatch(command,owner,options){if(!collection)throw new Error(`${label} inspector command outside an edit`);collection.push({command,owner,...options});}});
  const notify=(method,args)=>synth.emit?.({type:'native-state',name:kind,state:client._getState(),...(describeAuthorEdit&&method?{authorEdit:describeAuthorEdit(method,args)}:{})});
  function adopt(data){
    nativeSnapshotArray(data.registers,registerCount,255,`${label} registers`);context.validateHeld(data,voiceCount-1);validate?.(data);applyLayout(data);appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.registers.set(data.registers);adpcmInspection?.adopt(inspector,data);adoptInspector?.(inspector,data);
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
  client._cancelMainOwner=group=>{adpcm?.cancelGroup(group);for(const request of clockRequests)if(request.group===group)request.cancelled=true;send(identified({method:'cancel-main-owner',targetGroup:group}));const state=client._getState();cancelAuthor?.(state,authoredOwners,group);client._adoptState(state);};
  async function dispatch(message,timing={},scope){
    const token=capture();timing.checkCurrent?.();
    if(Array.isArray(message)){const commands=message.map(translate);synth.enqueueMany(commands.map(command=>timed(command,timing)));observeLayout();await synth.flush();current(token);timing.checkCurrent?.();return;}
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError(`${label} arguments must be an array`);
    if(adpcm&&['loadAdpcmMemory','clearAdpcmMemory'].includes(method)){await adpcm.request(method,args,timing,scope);return message.id===undefined?undefined:{id:message.id};}
    if(method==='clock')return clockCommand(args[0],timing,()=>message.id===undefined?undefined:{id:message.id});
    if(method!=='dispose'){send(translate(message),timing);await synth.flush();current(token);timing.checkCurrent?.();}
    return message.id===undefined?undefined:{id:message.id,...(method==='dispose'?{value:true}:{})};
  }
  function authorPatch(method,args){if(patchAuthor)return patchAuthor(method,args,client._getState(),clock);const value=createClient(()=>{}, {clock});value._adoptClock=hz=>{value.clock=validateChipClock(hz);};value._adoptState(client._getState());value[method](...args);return value._getState();}
  function invoke(method,args=[],options={}){
    const token=capture(),copy=structuredClone(args),check=()=>{current(token);options.checkCurrent?.();},result=serial.then(async()=>{
      check();const initial=await read();check();options.checkState?.(initial);const previous=new Map(inspector.auditions),previousLeases=new Map(leases);collection=[];let value,collected;
      try{value=inspector.invoke(method,copy);collected=collection;}finally{collection=null;}
      const nextLeases=new Map(),ownerVoices=new Map(),owner=id=>`voice-editor:${id}`,ownerKey=(key,id)=>`${logical(key)}:${owner(id)}`;
      for(const [key,id]of previous){const voice=previousLeases.get(key);if(voice)ownerVoices.set(ownerKey(key,id),voice);}
      for(const [key,id]of inspector.auditions){const voice=previous.get(key)===id?previousLeases.get(key):context.identity();nextLeases.set(key,voice);ownerVoices.set(ownerKey(key,id),voice);}
      const groups=[],stagedRegisters=Array.from(inspector.registers);
      for(const item of collected){const edit=item.preserveOwner===true||!item.owner;let key,action,voice;
        const rawTarget=nativeVoiceChannel(kind,item.command),target=kind==='y8950'&&rawTarget==='adpcm'?23:rawTarget;
        if(edit){action='edit';key=kind==='y8950'&&method.startsWith('adpcm.')?23:editChannel?.(method,copy,item.command,stagedRegisters)??(Number.isInteger(target)?target:0);}
        else{const matches=([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||(physicalMatches?physicalMatches(key,target):physical(key)===target)),match=[...inspector.auditions].find(matches)??[...previous].find(matches);if(!match)throw new Error(`Invalid ${label} audition owner`);key=match[0];action=inspector.auditions.get(key)===match[1]?'on':'off';voice=ownerVoices.get(ownerKey(key,match[1]));}
        if(item.command.method==='writeRegister')stagedRegisters[item.command.args[0]|((item.command.args[2]??0)<<8)]=item.command.args[1];
        if(action==='off'&&!voice)continue;const channel=logical(key);let group=groups.at(-1);if(!group||group.channel!==channel||group.action!==action||group.voice!==voice){group=identified({method:'batch',channel,...(voice?{voice}:{}),audition:true,action,commands:[]});groups.push(group);}group.commands.push(translate(item.command));
      }
      let patch=null;
      if(!['auditionOn','auditionOff','auditionAllOff'].includes(method)){
        if(kind==='y8950'&&method.startsWith('adpcm.')){
          patch=client._getState();
          for(const {command}of collected)if(command.method==='writeRegister')patch.registers[command.args[0]|((command.args[2]??0)<<8)]=command.args[1];
        }else patch=authorPatch(method,copy);
      }
      check();for(const group of groups)send(group);await synth.flush();check();if(groups.length){const applied=await read({after:groups.at(-1).id});check();leases.clear();for(const [key,voice]of nextLeases)leases.set(key,voice);if(patch){client._adoptState(patch);notify(method,copy);}options.checkState?.(applied);}return value;
    });serial=result.catch(()=>{});return result;
  }
  return {client,dispatch,read,invoke,
    ...(adpcm?{loadSample:createNativeY8950SampleLoader({context,transport:adpcm,read,invoke})}:{}),
    cancelOwner(performance,owner){adpcm?.cancelOwner(performance,owner);},
    cancelPerformance(performance){adpcm?.cancelPerformance(performance);},
    async initialize(){const token=capture();context.enable(kind);if(initialized)return;client.initialize();await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError(`Invalid ${label} mix`);const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){adpcm?.reset();adpcmInspection?.reset();context.invalidate();context.disable(kind);initialized=false;mainGroup=undefined;layoutPending=false;layout=false;layoutRevision=0;layoutMetadata='{"rhythmEnabled":false}';for(const request of clockRequests)request.cancelled=true;leases.clear();authoredOwners.clear();sentRegisters.fill(0);inspector.reset();appliedClock=initialClock;client._adoptState({clock:initialClock,initialized:false,registers:Array(registerCount).fill(0),...(kind==='ay8910'?{levels:[9,9,9]}:{})});},
  };
}
