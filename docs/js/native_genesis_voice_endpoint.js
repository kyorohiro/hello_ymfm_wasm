/** Ordered Native controls shared by console voice editors. No audio runs here. */
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';

export const nativeInteger=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);return value;};
export function nativeSnapshotArray(values,length,max,label){if(!Array.isArray(values)||values.length!==length||values.some(v=>!Number.isInteger(v)||v<0||v>max))throw new Error(`Native ${label} returned an invalid snapshot`);}
export function createNativeVoiceContext(synth,{backend,statusCommand,label}){
  let version=0,nextIdentity=0;const enabled=new Set();
  const abort=()=>new DOMException(`Native ${label} operation was cancelled`,'AbortError');
  const check=()=>{if(!synth.isReady())throw new Error(`Native ${label} audio is not ready`);if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation,version};};
  // Disposal invalidates the token before its facade stops reporting ready.
  // An accepted write finishing afterward is cancellation, not an audio fault.
  const current=token=>{if(token.session!==synth.session||token.generation!==synth.generation||token.version!==version)throw abort();check();};
  const identity=()=>{if(nextIdentity>=Number.MAX_SAFE_INTEGER)throw new RangeError(`Native ${label} command identity limit reached`);return ++nextIdentity;};
  const timed=(chip,message,timing={})=>({type:backend,message:{chip,...message},frame:timing.time===undefined?0:synth.frameAt(timing.time),...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  const send=(chip,message,timing={})=>{check();timing.checkCurrent?.();if(enabled.has(chip))synth.enqueue(timed(chip,message,timing));};
  async function snapshot(chip,args={}){const token=capture(),data=await synth.nativeRequest(statusCommand,args);current(token);const state=data?.[chip];if(!state||typeof state!=='object')throw new Error(`Native ${label} returned an invalid snapshot`);return {...state,sampleRate:data.sampleRate??state.sampleRate,frame:data.frame??state.frame,revision:data.revision??state.revision};}
  function validateHeld(data,max){if(data.held!==undefined&&(!Array.isArray(data.held)||data.held.some(v=>!Number.isInteger(v)||v<0||v>max))||data.pendingCommands!==undefined&&(!Array.isArray(data.pendingCommands)||data.pendingCommands.some(id=>!Number.isSafeInteger(id)||id<1)))throw new Error(`Native ${label} returned invalid held channels or pending commands`);}
  return {synth,label,capture,current,identity,timed,send,snapshot,validateHeld,enable:chip=>enabled.add(chip),disable:chip=>enabled.delete(chip),isEnabled:chip=>enabled.has(chip),invalidate:()=>{version++;}};
}

/** The inspector stages ordinary public API writes before one atomic lease batch. */
export function createNativeVoiceEndpoint(context,{chip,globalName,client,inspector,translate,adopt,patch,reset,initialize=()=>client.initialize(),logical=Number,physical=Number,resetInspector}){
  const {synth,capture,current,identity,send}=context;let initializedSession,collection=null,serial=Promise.resolve();const leases=new Map();
  inspector.dispatch=(command,owner,options)=>{if(!collection)throw new Error(`${chip} edit outside collection`);collection.push({command,owner,...options});};
  const notify=()=>synth.emit?.({type:'native-state',name:globalName,state:client._getState()});
  const read=async(args={})=>adopt(await context.snapshot(chip,args),false,leases);
  const stopped=()=>{inspector.auditions.clear();leases.clear();};
  async function dispatch(message,timing={}){const token=capture();timing.checkCurrent?.();let value;if((message.method??message.type)==='dispose')value=true;else{const command=translate(message);send(chip,command,timing);await synth.flush();current(token);timing.checkCurrent?.();if(command.method==='clock'){client._adoptClock(command.hz);notify();}}return message.id===undefined?undefined:{id:message.id,...(value===undefined?{}:{value})};}
  function invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
    current(token);await read();current(token);
    if(resetInspector){const handled=await resetInspector(method,{identity,send:message=>send(chip,message),read,token,current,stopped,notify});current(token);if(handled)return;}
    const previous=new Map(inspector.auditions),previousLeases=new Map(leases);let collected,value;collection=[];
    try{value=inspector.invoke(method,copy);collected=collection;}finally{collection=null;}
    const nextLeases=new Map(),ownerVoices=new Map(),owner=id=>`voice-editor:${id}`,ownerKey=(key,id)=>`${logical(key)}:${owner(id)}`;
    for(const [key,id]of previous){const voice=previousLeases.get(key);if(voice)ownerVoices.set(ownerKey(key,id),voice);}
    for(const [key,id]of inspector.auditions){const voice=previous.get(key)===id?previousLeases.get(key):identity();nextLeases.set(key,voice);ownerVoices.set(ownerKey(key,id),voice);}
    const groups=[];for(const item of collected){const isEdit=item.preserveOwner===true||!item.owner;let key,action,voice;
      if(isEdit){action='edit';const target=nativeVoiceChannel(chip,item.command);key=Number.isInteger(target)?target:0;}
      else{const target=nativeVoiceChannel(chip,item.command),matches=([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||physical(key)===target),match=[...inspector.auditions].find(matches)??[...previous].find(matches);if(!match)throw new Error(`Invalid ${context.label} audition owner`);key=match[0];action=inspector.auditions.get(key)===match[1]?'on':'off';voice=ownerVoices.get(ownerKey(key,match[1]));}
      if(action==='off'&&!voice)continue;
      let group=groups.at(-1);if(!group||group.action!==action||group.channel!==logical(key)||group.voice!==voice){group={method:'batch',channel:logical(key),...(voice?{voice}:{}),audition:true,action,commands:[]};groups.push(group);}group.commands.push(translate(item.command));
    }
    let last;for(const group of groups){last=identity();send(chip,{...group,id:last});}
    await synth.flush();current(token);if(last){await read({after:last});current(token);leases.clear();for(const [key,voice]of nextLeases)leases.set(key,voice);patch(groups);notify();}return value;
  });serial=result.catch(()=>{});return result;}
  client.setClock=hz=>dispatch({method:'clock',args:[hz]});client._stopVoices=()=>dispatch({method:'stopVoices'});
  return {client,
    async initialize(){const token=capture();context.enable(chip);if(initializedSession===token.session)return;initialize();await synth.flush();current(token);initializedSession=token.session;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError(`Invalid ${context.label} mix`);const token=capture();synth.enqueue(context.timed(chip,{method:'mix',volume,pan}));await synth.flush();current(token);},
    dispatch,read,invoke,stopped,adoptStopped(data){stopped();adopt(data?.[chip]??data,true,leases);},
    reset(){context.invalidate();context.disable(chip);initializedSession=undefined;stopped();inspector.reset();reset();},
  };
}
