/** Independently owned CPU-free Native S-DSP. JavaScript authors register
 * controls; BRR, DSP execution and captured timelines remain on Native. */
import {prepareSnesBRR} from './snessynth.js?v=spc-song-js-1';
import {prepareSpcTimeline} from './spc.js?v=spc-events-1';
import {SnesVoiceInspector} from './playground_snes_inspector.js?v=y8950-adpcm-ui-1';
import {createNativeSnesShadow,nativeSnesOperations,nativeSnesControls} from './native_genesis_snes.js?v=y8950-adpcm-ui-1';
import {createNativeVoiceContext,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=ps1-deferred-release-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=scsp-native-1';

export const EXTRA_SNES_MEMORY_HELD_ERROR='Release the manually held additional SNES voices before replacing sample memory';
export const EXTRA_SNES_STATE_HELD_ERROR='Release the manually held additional SNES voices before replacing the DSP state';
export const EXTRA_SNES_ADMISSION_ERRORS=Object.freeze([EXTRA_SNES_MEMORY_HELD_ERROR,EXTRA_SNES_STATE_HELD_ERROR,
  'Native additional SNES upload batch exceeds 64 KiB','Native additional SNES pending uploads exceed 1 MiB across the shared rack',
  'Native additional SNES pending RAM snapshot limit reached (16 across shared rack)','Native additional SNES pending command limit reached (32 MiB)',
  'SNES timeline mode is exclusive; reset() before editing instruments']);
const abort=()=>new DOMException('Native additional SNES operation was cancelled','AbortError');
const emptyTimeline=()=>({loaded:false,playing:false,positionFrames:0,totalFrames:0,ended:false});
const clone=value=>structuredClone(value);
function copyShadow(target,source){target.registers.set(source.registers);const a=target.synth,b=source.synth;a.samples=clone(b.samples);a.sampleBytes=b.sampleBytes.slice();a.channels=clone(b.channels);a.nextAddress=b.nextAddress;a.koff=b.koff;a.pendingKon=b.pendingKon;a.konFrame=b.konFrame;a.core.nativeFrames=b.core.nativeFrames;a.timeline=null;}

export function createNativeGenesisExtraSnesEndpoint(synth){
  const context=createNativeVoiceContext(synth,{backend:'extra-snes',statusCommand:'native_genesis_extra_snes_status',label:'additional SNES'}),{capture,current}=context;
  const projected=createNativeSnesShadow(),applied=createNativeSnesShadow(),authors=new Map(),operations=new Set(),leases=new Map(),notes=new Map(),playing=new Set(),assigned=new Array(8).fill(false);
  let resourceSerial=Promise.resolve(),editorSerial=Promise.resolve(),collection=null,mainGroup,initialized=false,stateRevision=0,appliedRevision=-1,resourceVersion=0,timelineVersion=0,timeline=null,preparing=false,order=0,editing=0;
  projected.synth.getTimelineState=()=>timeline?{...timeline}:emptyTimeline();
  const state=()=>({...projected.synth.getState(),stateRevision,...(timeline?{timeline:{...timeline}}:{})});
  const notify=authorEdit=>{stateRevision++;synth.emit?.({type:'native-state',name:'snes',state:state(),...(authorEdit?{authorEdit}:{})});};
  const identified=message=>({...message,id:context.identity()});
  const send=(messages,timing={},group=mainGroup)=>{timing.checkCurrent?.();for(const message of messages)context.send('snes',{...(group===undefined?{}:{group}),...message},timing);};
  function operation(timing={}){if(operations.size>=256)throw new RangeError('Native additional SNES preparation request queue is full');const token=capture(),op={group:mainGroup,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(op);op.check=()=>{current(token);timing.checkCurrent?.();if(op.cancelled)throw abort();};return op;}
  function rebuild(){
    copyShadow(projected,applied);
    for(const item of [...authors.values()].sort((a,b)=>a.frame-b.frame||a.order-b.order))nativeSnesOperations(projected,item.method,item.args);
    projected.synth.timeline=timeline?{...timeline}:null;stateRevision++;
  }
  function cancel(matches){for(const op of operations)if(matches(op))op.cancelled=true;for(const [id,item]of authors)if(matches(item))authors.delete(id);for(const [id,item]of notes)if(matches(item))notes.delete(id);for(const wait of [...playing])if(matches(wait.op)){clearTimeout(wait.timer);playing.delete(wait);wait.reject(abort());}rebuild();}
  function cancelPlayback(){timelineVersion++;for(const wait of playing){clearTimeout(wait.timer);wait.reject(abort());}playing.clear();}
  function instrumentOnly(){if(preparing||timeline?.loaded)throw new Error('SNES timeline mode is exclusive; reset() before editing instruments');}
  function adopt(data){
    nativeSnapshotArray(data?.registers,128,255,'SNES registers');
    if(!Number.isSafeInteger(data.nativeFrames)||data.nativeFrames<0||!Number.isInteger(data.enabled)||data.enabled<0||data.enabled>255||!data.timeline||typeof data.timeline.loaded!=='boolean'||typeof data.timeline.playing!=='boolean'||typeof data.timeline.ended!=='boolean'||![data.timeline.positionFrames,data.timeline.totalFrames].every(v=>Number.isSafeInteger(v)&&v>=0))throw new Error('Native additional SNES returned an invalid snapshot');
    context.validateHeld(data,7);if(data.ram!==undefined)nativeSnapshotArray(data.ram,65536,255,'SNES RAM');
    if(!Number.isSafeInteger(data.revision)||data.revision<0)throw new Error('Native additional SNES returned an invalid revision');
    if(data.revision<appliedRevision)return data;
    appliedRevision=data.revision;applied.registers.set(data.registers);applied.synth.core.nativeFrames=data.nativeFrames;applied.synth.koff=data.registers[0x5c];applied.synth.pendingKon=0;applied.synth.konFrame=-1;
    applied.synth.samples=clone(projected.synth.samples);applied.synth.sampleBytes=projected.synth.sampleBytes.slice();applied.synth.nextAddress=projected.synth.nextAddress;applied.synth.timeline=data.timeline.loaded?{...data.timeline}:null;
    inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.gates=data.enabled;
    const pending=new Set(data.pendingCommands??[]),completed=[...authors.values()].filter(item=>item.accepted&&!pending.has(item.id)).sort((a,b)=>a.frame-b.frame||a.order-b.order);
    for(const item of completed){if(item.method==='reset')assigned.fill(false);else if(['setPreset','setChannel'].includes(item.method)&&item.args[1].sample!==undefined&&!data.held?.includes(item.args[0]))assigned[item.args[0]]=true;else if(item.method==='writeDsp'&&(item.args[0]&15)===4&&!data.held?.includes(item.args[0]>>4))assigned[item.args[0]>>4]=true;authors.delete(item.id);}
    for(let ch=0;ch<8;ch++){const sample=assigned[ch]?data.registers[ch*16+4]:null;applied.synth.channels[ch].sample=sample;inspector.assignedSamples.set(ch,sample);applied.synth.channels[ch]=inspector.voice(ch);}
    if(data.held&&!editing)for(const ch of leases.keys())if(!data.held.includes(ch)){leases.delete(ch);inspector.auditions.delete(ch);}
    if(!preparing){timeline=data.timeline.loaded?{...data.timeline}:null;applied.synth.timeline=timeline;}
    rebuild();return data;
  }
  async function snapshot(args={}){
    const token=capture();let result;try{result=args.after===undefined?await synth.nativeRequest('native_genesis_extra_snes_status',args):await synth.observeNativeSnapshot('native_genesis_extra_snes_status',args);}catch(error){current(token);if(EXTRA_SNES_ADMISSION_ERRORS.includes(error?.message??String(error))){const rejected=new Error(error.message??String(error));rejected.code='EXTRA_SNES_CONTROL_REJECTED';throw rejected;}throw error;}current(token);
    if(!result?.snes)throw new Error('Native additional SNES returned an invalid snapshot');return adopt({...result.snes,sampleRate:result.sampleRate??result.snes.sampleRate,frame:result.frame??result.snes.frame,revision:result.revision??result.snes.revision});
  }
  async function observed(op,args={}){try{const data=await snapshot(args);op.check();return data;}catch(error){op.check();throw error;}}
  const inspector=new SnesVoiceInspector(applied.synth,{sampleRate:synth.clock.sampleRate||48000,
    dispatch(command,owner){if(!collection)throw new Error('SNES inspector command outside an edit');collection.push({command,owner});},
    beginAudition(ch,owner){leases.set(ch,{owner,voice:context.identity()});},endAudition(){}});
  applied.synth.getTimelineState=()=>applied.synth.timeline?{...applied.synth.timeline}:emptyTimeline();
  const key=(op,ch)=>`${op.performance??'main'}:${op.owner??op.group??'main'}:${ch}`;
  function remember(method,args,messages,timing,op){
    if(authors.size>=65536)throw new RangeError('Native additional SNES author queue is full');
    const id=messages.at(-1).id;authors.set(id,{id,method,args:clone(args),frame:timing.time===undefined?0:synth.frameAt(timing.time),order:++order,accepted:false,group:op.group,performance:op.performance,owner:op.owner});return id;
  }
  async function admit(messages,timing,op){op.check();try{send(messages,timing,op.group);await synth.flush();op.check();}catch(error){op.check();throw error;}}
  function controls(method,args=[],timing={}){
    const op=operation(timing);let messages,id;
    try{
      if(method==='reset')return resetState(timing,op);
      instrumentOnly();const prepared=nativeSnesOperations(projected,method,args);
      if(['allNotesOff'].includes(method))messages=Array.from({length:8},(_,channel)=>({method:'key-off',channel}));
      else if(Number.isInteger(args[0])&&args[0]>=0&&args[0]<8&&method!=='writeDsp'){
        const ch=args[0],action=['noteOn','keyOn'].includes(method)?'on':['noteOff','keyOff'].includes(method)?'off':'edit',noteKey=key(op,ch);let voice=notes.get(noteKey)?.voice;
        if(action==='on'){voice=context.identity();notes.set(noteKey,{voice,group:op.group,performance:op.performance,owner:op.owner});}else if(action==='off')notes.delete(noteKey);
        messages=[{method:'batch',channel:ch,action,...(voice===undefined?{}:{voice}),commands:prepared}];
      }else messages=prepared;
      if(!messages.length){operations.delete(op);return Promise.resolve();}messages[messages.length-1]=identified(messages.at(-1));id=remember(method,args,messages,timing,op);
    }catch(error){operations.delete(op);throw error;}
    const result=admit(messages,timing,op).then(()=>{const item=authors.get(id);if(item)item.accepted=true;notify();},error=>{authors.delete(id);rebuild();throw error;}).finally(()=>operations.delete(op));return result;
  }
  function resetState(timing={},op=operation(timing)){
    if(leases.size){operations.delete(op);throw new Error(EXTRA_SNES_STATE_HELD_ERROR);}
    const version=++resourceVersion;cancelPlayback();preparing=false;timeline=null;projected.synth.timeline=null;
    const staged=createNativeSnesShadow();copyShadow(staged,projected);const commands=nativeSnesOperations(staged,'reset',[]),message=identified({method:'reset-state',dsp:Array.from(staged.registers),uploads:commands.filter(v=>v.method==='load-memory').map(({address,data})=>({address,data}))});
    copyShadow(projected,staged);const id=remember('reset',[],[message],timing,op);
    return (async()=>{try{await admit([message],timing,op);const item=authors.get(id);if(item)item.accepted=true;await observed(op,{after:message.id});op.check();notify();}catch(error){authors.delete(id);if(version===resourceVersion){preparing=false;timeline=applied.synth.timeline?{...applied.synth.timeline}:null;}rebuild();throw error;}finally{operations.delete(op);}})();
  }
  function loadBRR(input,options,timing={}){
    const op=operation(timing);let prepared,saved;try{instrumentOnly();prepared=prepareSnesBRR(input,options);saved=clone(options);}catch(error){operations.delete(op);return Promise.reject(error);}const version=resourceVersion;
    const result=resourceSerial.then(async()=>{
      op.check();if(version!==resourceVersion)throw abort();instrumentOnly();const staged=createNativeSnesShadow();copyShadow(staged,projected);const commands=nativeSnesOperations(staged,'loadBRR',[prepared.brr,saved]),sample={...staged.synth.samples.at(-1)};
      const message=identified({method:'load-memory-batch',uploads:commands.map(({address,data})=>({address,data}))});await admit([message],{...timing,time:undefined},op);await observed(op,{after:message.id});op.check();if(version!==resourceVersion)throw abort();
      projected.synth.samples=clone(staged.synth.samples);projected.synth.sampleBytes=staged.synth.sampleBytes.slice();projected.synth.nextAddress=staged.synth.nextAddress;
      applied.synth.samples=clone(staged.synth.samples);applied.synth.sampleBytes=staged.synth.sampleBytes.slice();applied.synth.nextAddress=staged.synth.nextAddress;notify({samples:clone(staged.synth.samples),nextAddress:staged.synth.nextAddress});return sample;
    }).finally(()=>operations.delete(op));resourceSerial=result.catch(()=>{});return result;
  }
  async function prepareTimeline(trace,timing={}){
    const op=operation(timing);let data;try{data=prepareSpcTimeline(trace);if(leases.size)throw new Error(EXTRA_SNES_STATE_HELD_ERROR);}catch(error){operations.delete(op);throw error;}
    const previous=timeline,version=++resourceVersion;cancelPlayback();preparing=true;
    try{
      const message=identified({method:'prepare-timeline',ram:Array.from(data.initialState.ram),dsp:Array.from(data.initialState.dsp),events:Array.from(data.events),durationClocks:data.durationClocks});await admit([message],{...timing,time:undefined},op);const result=await observed(op,{after:message.id});op.check();if(version!==resourceVersion)throw abort();if(!result.timeline.loaded)throw new Error('Native additional SNES timeline was not prepared');
      preparing=false;timeline={...result.timeline};projected.synth.timeline={...timeline};notify();return {...timeline};
    }catch(error){if(version===resourceVersion){preparing=false;timeline=previous;projected.synth.timeline=timeline;}throw error;}finally{operations.delete(op);}
  }
  async function playTimeline(timing={}){
    if(!timeline?.loaded||preparing)throw new Error('Prepare an SNES timeline before playback');const op=operation(timing);cancelPlayback();const version=timelineVersion,message=identified({method:'play-timeline'});
    try{await admit([message],timing,op);const data=await observed(op,{after:message.id});op.check();if(version!==timelineVersion||data.timeline.playCommandId!==undefined&&data.timeline.playCommandId!==message.id)throw abort();const generation=data.timeline.generation;
      return await new Promise((resolve,reject)=>{
        const wait={op,reject,timer:null};playing.add(wait);
        const finish=async()=>{try{op.check();if(version!==timelineVersion)throw abort();const result=await snapshot(),value=result.timeline;op.check();if(!playing.has(wait))return;if(generation!==undefined&&value.generation!==generation)throw abort();
          if(value.ended&&!value.playing){playing.delete(wait);resolve({...value});return;}if(!value.playing)throw abort();wait.timer=setTimeout(finish,Math.max(5,Math.min(1000,(value.totalFrames-value.positionFrames)/32)));
        }catch(error){playing.delete(wait);reject(error);}};
        wait.timer=setTimeout(finish,Math.max(1,(data.timeline.totalFrames-data.timeline.positionFrames)/32));
      });
    }catch(error){op.check();if(version!==timelineVersion)throw abort();throw error;}finally{operations.delete(op);}
  }
  async function stopTimeline(timing={}){const op=operation(timing);cancelPlayback();try{const message=identified({method:'stop-timeline'});await admit([message],{...timing,time:undefined},op);const result=await observed(op,{after:message.id});op.check();timeline=result.timeline.loaded?{...result.timeline}:null;notify();return {...result.timeline};}finally{operations.delete(op);}}
  async function barrier({ram=false}={},timing={}){const op=operation(timing);try{const message=identified({method:'barrier',...(ram?{ram:true}:{})});await admit([message],{...timing,time:undefined},op);const data=await observed(op,{after:message.id,...(ram?{ram:true}:{})});op.check();return data;}finally{operations.delete(op);}}
  async function readControl(method,args=[],timing={}){
    if(method==='readDsp'&&(!Number.isInteger(args[0])||args[0]<0||args[0]>127))throw new RangeError('DSP register must be0..127');
    if(method==='getPreset'){instrumentOnly();projected.synth.getPreset(args[0]);}
    const data=await barrier({ram:method==='snapshot'},timing);
    if(method==='readDsp')return data.registers[args[0]];
    if(method==='getTimelineState')return {...data.timeline};
    if(method==='getPreset')return applied.synth.getPreset(args[0]);
    if(method==='snapshot')return {ram:Uint8Array.from(data.ram),dsp:Uint8Array.from(data.registers),nativeFrames:data.nativeFrames};
    return applied.synth.getState();
  }
  const report=promise=>promise.catch(error=>{if(error?.name!=='AbortError')synth.reportAsyncError(error);});
  const client={sampleRate:synth.clock.sampleRate||48000,nativeSampleRate:32000,_getState:state,_adoptState(){return false;},
    _allocateMainOwner:()=>context.identity(),_withMainOwner(group,callback){const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}},
    _cancelMainOwner(group){cancel(op=>op.group===group);send([identified({method:'cancel-main-owner',targetGroup:group})],{},undefined);},
    async _stopVoices(){const op=operation();cancelPlayback();try{await admit([identified({method:'stop-voices'})],{},op);}finally{operations.delete(op);}},
    loadBRR,prepareTimeline,playTimeline,stopTimeline,
    getTimelineState:()=>readControl('getTimelineState'),readDsp:register=>readControl('readDsp',[register]),
    getState:()=>readControl('getState'),getPreset:ch=>readControl('getPreset',[ch]),snapshot:()=>readControl('snapshot'),dispose(){},
  };
  for(const method of nativeSnesControls)client[method]=(...args)=>{const result=controls(method,args);report(result);};
  function dispatch(message,timing={}){
    const {method,args=[]}=message;let result;
    if(method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};
    if(method==='loadBRR')result=loadBRR(args[0],args[1],timing);
    else if(method==='prepareTimeline')result=prepareTimeline(args[0],timing);
    else if(method==='playTimeline')result=playTimeline(timing);
    else if(method==='stopTimeline')result=stopTimeline(timing);
    else if(method==='stopVoices'){cancelPlayback();const op=operation(timing);result=admit([identified({method:'stop-voices'})],timing,op).finally(()=>operations.delete(op));}
    else if(['getTimelineState','readDsp','getState','getPreset','snapshot'].includes(method))result=readControl(method,args,timing);
    else result=controls(method,clone(args),timing);
    // Every resource/read can wait for a callback. Release the bridge FIFO so
    // Stop/dispose/owner cancellation can reach Native while its reply is pending.
    return {deferred:Promise.resolve(result).then(value=>message.id===undefined?undefined:{id:message.id,value})};
  }
  function invoke(method,args=[]){const token=capture(),saved=clone(args),result=editorSerial.then(async()=>{
    current(token);await snapshot();current(token);editing++;try{const previous=new Map(leases),auditions=new Map(inspector.auditions);let result,entries;collection=[];try{result=inspector.invoke(method,saved);entries=collection;}finally{collection=null;}
    const groups=[];try{
      for(const {command,owner}of entries){const ch=command.args[0],lease=leases.get(ch)??previous.get(ch),action=owner?(method==='auditionOn'?'on':'off'):'edit',commands=nativeSnesOperations(applied,command.method,command.args,{partial:action==='edit'});let group=groups.at(-1);if(!group||group.channel!==ch||group.action!==action){group=identified({method:'batch',channel:ch,action,audition:true,...(lease?{voice:lease.voice}:{}),commands:[]});groups.push(group);}group.commands.push(...commands);}
      if(groups.length){send(groups,{},undefined);await synth.flush();current(token);await snapshot({after:groups.at(-1).id});current(token);}
      if(method==='auditionOff'&&result)leases.delete(saved[0]);if(method==='auditionAllOff')leases.clear();
      if(!['auditionOn','auditionOff','auditionAllOff'].includes(method)){
        if(['setPreset','setChannel'].includes(method)&&saved[1].sample!==undefined){assigned[saved[0]]=true;applied.synth.channels[saved[0]].sample=applied.registers[saved[0]*16+4];inspector.assignedSamples.set(saved[0],applied.synth.channels[saved[0]].sample);}
        const ch=saved[0],patch=['setPreset','setChannel'].includes(method)?Object.fromEntries(Object.keys(saved[1]).map(key=>[key,applied.synth.channels[ch][key]])):{pitch:applied.synth.channels[ch].pitch};
        nativeSnesOperations(projected,'setPreset',[ch,patch],{partial:true});notify({channel:ch,preset:patch});
      }else if(groups.length)notify();return result;
    }catch(error){leases.clear();for(const [ch,lease]of previous)leases.set(ch,lease);inspector.auditions=auditions;throw error;}}finally{editing--;}
  });editorSerial=result.catch(()=>{});return result;}
  return {client,dispatch,invoke,async read(){await snapshot();return inspector.read();},
    cancelOwner:(performance,owner)=>cancel(op=>op.performance===performance&&op.owner===owner),cancelPerformance:performance=>cancel(op=>op.performance!==undefined&&(performance===null||op.performance===performance)),
    async initialize(){const token=capture();context.enable('snes');if(initialized)return;await resetState();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid SNES mix');const token=capture();send([{method:'mix',volume,pan}],{},undefined);await synth.flush();current(token);},
    reset(){cancel(()=>true);resourceVersion++;cancelPlayback();context.invalidate();context.disable('snes');initialized=false;leases.clear();inspector.resetAuditions();authors.clear();notes.clear();mainGroup=undefined;timeline=null;preparing=false;},
  };
}
export async function createNativeGenesisExtraSnes(synth,options={}){const device=await createNativeGenesisExtraChip(synth,{...options,kind:'snes',label:'SNES S-DSP',layout:{channels:8},createEndpoint:createNativeGenesisExtraSnesEndpoint});device.sampleRate=synth.clock.sampleRate;device.nativeSampleRate=32000;return device;}
