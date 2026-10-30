// SPDX-License-Identifier: BSD-3-Clause
// Only authored controls and owned PCM copies live here. DSP runs in Native.
import {ScspSynth,createScspInitSample} from './scspsynth.js?v=scsp-fm-1';
import {SCSP_CONTROLS,scspCommandArgs,createScspValidation} from './playground_scsp.js?v=scsp-fm-1';
import {ScspVoiceInspector} from './playground_scsp_inspector.js?v=scsp-fm-1';
import {createNativeVoiceContext,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=ps1-deferred-release-1';
export const SCSP_MEMORY_HELD_ERROR='Stop SCSP voices before replacing protected sample RAM or state';
export const SCSP_ADMISSION_ERRORS=['Native SCSP note exceeds supported PCM RAM or loop bounds',SCSP_MEMORY_HELD_ERROR,'Native SCSP pending command limit reached (8 MiB)','Duplicate pending Native SCSP command ID','Native SCSP command was cancelled before it applied','Native SCSP state changed while reading; retry','Native SCSP command was not applied within 100 ms'];
const clone=structuredClone,abort=()=>new DOMException('Native SCSP operation was cancelled','AbortError');
export function createNativeScspShadow(){
  const registers=new Uint16Array(513);let recording,memory;const ram=()=>memory??=new Uint8Array(524288);
  const core={sampleRate:44100,nativeFrames:0,reset({clearRam=false}={}){registers.fill(0);if(clearRam)memory?.fill(0);this.nativeFrames=0;recording?.push({method:'reset',clearRam});},
    write(register,value,mask=65535){registers[register/2]=(registers[register/2]&~mask)|(value&mask);recording?.push({method:'write',register,value,mask});},
    read:register=>registers[register/2],loadRam(bytes,address=0){ram().set(bytes,address);recording?.push({method:'load-memory',address,data:Array.from(bytes)});},
    readRam:(address,length)=>ram().slice(address,address+length),renderInto(){throw new Error('SCSP audio renders in Native');},dispose(){}};
  const synth=new ScspSynth(core);
  return {synth,core,registers,get ram(){return ram();},collect(method,args=[]){const commands=[];recording=commands;try{const value=synth[method](...scspCommandArgs(synth,method,args));return {commands,value};}finally{recording=null;}}};
}
function copy(target,source,includeMemory=true){target.synth._copyTransportState(source.synth);target.registers.set(source.registers);if(includeMemory)target.ram.set(source.ram);target.core.nativeFrames=source.core.nativeFrames;}
export function createNativeGenesisScsp(owner,{additional=false}={}){
  const context=createNativeVoiceContext(owner,{backend:additional?'extra-scsp':'scsp',statusCommand:additional?'native_genesis_extra_scsp_status':'native_genesis_scsp_status',label:'SCSP'});
  const projected=createNativeScspShadow(),applied=createNativeScspShadow(),authors=new Map(),operations=new Set(),activeGroups=new Set(),leases=new Map(),notes=new Map();
  let serial=Promise.resolve(),version=0,bankGeneration=0,group,initialized=false,order=0,revision=0,appliedRevision=-1,collection,editorSerial=Promise.resolve();
  const state=()=>({...projected.synth.getState(),stateRevision:revision});
  const notify=authorEdit=>{revision++;owner.emit?.({type:'native-state',name:'scsp',state:state(),...(authorEdit?{authorEdit}:{})});};
  const identify=message=>({...message,id:context.identity()});
  const send=(message,timing={},...groups)=>{const scope=groups.length?groups[0]:group;context.send('scsp',{...(scope===undefined?{}:{group:scope}),...message},timing);};
  const report=promise=>{promise.catch(error=>{if(error?.name!=='AbortError'&&!['RangeError','TypeError'].includes(error?.name)&&!SCSP_ADMISSION_ERRORS.includes(error?.message))owner.reportAsyncError(error);});return promise;};
  function rebuild(){copy(projected,applied);for(const item of [...authors.values()].sort((a,b)=>a.frame-b.frame||a.order-b.order))projected.collect(item.method,item.args);}
  function cancel(matches){for(const op of operations)if(matches(op))op.cancelled=true;for(const [id,a]of authors)if(matches(a))authors.delete(id);for(const [key,n]of notes)if(matches(n))notes.delete(key);rebuild();}
  function enqueue(task,timing={}){
    if(operations.size>=256)throw new RangeError('Native SCSP preparation request queue is full');
    const token=context.capture(),scope=group,op={group:scope,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(op);
    const check=()=>{context.current(token);timing.checkCurrent?.();if(op.cancelled)throw abort();};
    const result=serial.then(()=>{check();return task(check,scope);}).finally(()=>operations.delete(op));serial=result.catch(()=>{});return result;
  }

  function adopt(result){
    const data=additional?result?.scsp:result;
    nativeSnapshotArray(data?.registers,513,65535,'SCSP registers');context.validateHeld(data,31);
    if(!Number.isSafeInteger(data.nativeFrames)||data.nativeFrames<0||!Number.isInteger(data.enabled)||data.enabled<0||data.enabled>0xffffffff)throw new Error('Invalid Native SCSP snapshot');
    const nextRevision=result.revision??0;if(nextRevision<appliedRevision)return data;appliedRevision=nextRevision;
    const pending=new Set(data.pendingCommands??[]);
    for(const item of [...authors.values()].filter(a=>a.accepted&&!pending.has(a.id)).sort((a,b)=>a.frame-b.frame||a.order-b.order)){
      // The callback rejects a foreign/manual slot atomically. Snapshot held
      // state prevents ordinary authored metadata from claiming that edit.
      if(item.audition||!data.held?.includes(item.args[0]))applied.collect(item.method,item.args);
      authors.delete(item.id);
    }
    applied.registers.set(data.registers);applied.core.nativeFrames=data.nativeFrames;
    const s=applied.synth.getState();
    if(data.playingAddresses!==undefined){if(!Array.isArray(data.playingAddresses)||data.playingAddresses.length!==32||data.playingAddresses.some(a=>a!==null&&(!Number.isInteger(a)||a<0||a>=524288)))throw new Error('Invalid Native SCSP source references');s.playingSampleIds=data.playingAddresses.map(a=>a===null?null:s.samples.find(w=>w.address===a)?.id??null);}
    s.slots.forEach((v,ch)=>v.gate=!!(data.enabled&(2**ch)));applied.synth._adoptState(s);
    inspector.sampleRate=result.sampleRate??owner.clock.sampleRate;rebuild();return data;
  }
  async function snapshot(args={}){const token=context.capture(),result=args.after===undefined?await owner.nativeRequest(contextCommand(),args):await owner.observeNativeSnapshot(contextCommand(),args);context.current(token);return adopt(result);}
  function contextCommand(){return additional?'native_genesis_extra_scsp_status':'native_genesis_scsp_status';}
  async function barrier(ram=false){const message=identify({method:'barrier',ram});send(message,{},undefined);await owner.flush();return snapshot({after:message.id,...(ram?{ram:true}:{})});}
  function control(method,args=[],timing={},manual){
    const saved=clone(args),bank=bankGeneration;
    return enqueue(async(check,capturedScope)=>{
      if(timing.time===undefined&&['setFrequency','setNote','setLfo','setModulation'].includes(method)){await snapshot();check();}
      if(method==='reset'&&leases.size)throw new Error(SCSP_MEMORY_HELD_ERROR);
      if(authors.size>=65536)throw new RangeError('Native SCSP author queue is full');
      const before=createNativeScspShadow(),copiesMemory=method==='reset'&&saved[0]?.clearRam;copy(before,projected,copiesMemory);
      if(timing.time===undefined&&['setFrequency','setNote','setLfo','setModulation'].includes(method)){const next=projected.synth.getState();const actual=applied.synth.getState();next.playingSampleIds=actual.playingSampleIds;next.playingLfos=actual.playingLfos;next.playingModulations=actual.playingModulations;next.playingFrequencies=actual.playingFrequencies;projected.synth._adoptState(next);}
      let {commands}=projected.collect(method,saved);
      if(method==='setMix'){const patch=saved[1];commands=commands.flatMap(c=>{const mask=c.register%32===12?('totalLevel'in patch?255:0):('directLevel'in patch?0xe000:0)|('pan'in patch?0x1f00:0);return mask?[{...c,mask}]:[];});}
      const channel=Number.isInteger(saved[0])?saved[0]:undefined,action=['keyOn','noteOn'].includes(method)?'on':['keyOff','noteOff'].includes(method)?'off':'edit';
      const key=`${timing.performance??'main'}:${timing.owner??capturedScope??'main'}:${channel}`;
      let voice=manual?.voice??notes.get(key)?.voice;
      if(action==='on'&&!manual){voice=context.identity();notes.set(key,{voice,group:capturedScope,...timing});}
      const id=context.identity(),messages=[],effectiveTiming=method==='reset'?{}:timing;let committedReset=false;
      if(method==='reset')messages.push({method:'reset',clearRam:!!saved[0]?.clearRam});
      else if(method==='allNotesOff')messages.push({method:'all-notes-off'});
      else messages.push({method:'batch',action,...(channel===undefined?{}:{channel}),...(voice===undefined?{}:{voice}),...(manual?{audition:true}:{}),commands});
      messages.at(-1).id=id;
      const item={id,method,args:saved,group:capturedScope,...timing,frame:effectiveTiming.time===undefined?0:owner.frameAt(effectiveTiming.time),order:++order,accepted:false,audition:!!manual};authors.set(id,item);
      try{check();for(const m of messages)send(m,effectiveTiming,method==='reset'?undefined:capturedScope);await owner.flush();
        if(method==='reset'&&bank===bankGeneration){applied.collect('reset',saved);authors.clear();notes.clear();activeGroups.clear();version++;committedReset=true;rebuild();}
        check();item.accepted=true;
        if(action==='off'&&!manual)notes.delete(key);notify();
      }catch(error){authors.delete(id);if(!committedReset)copy(projected,before,copiesMemory);rebuild();throw error;}
    },timing);
  }
  function loadPCM(input,options,timing={}){
    const validation=createScspValidation();try{validation.loadPCM(input,options);}finally{validation.dispose();}
    const pcm=input.slice(),saved=clone(options);
    return enqueue(async(check,scope)=>{
      const staged=createNativeScspShadow();copy(staged,projected);const {commands,value}=staged.collect('loadPCM',[pcm,saved]);
      const message=identify(commands[0]);check();send(message,{...timing,time:undefined},scope);await owner.flush();check();await snapshot({after:message.id});check();
      // Resource adoption must preserve pending author changes.
      for(const target of [applied,projected]){target.synth._adoptResources(staged.synth.getState());target.ram.set(staged.ram);}
      notify({resources:staged.synth.getState()});return value;
    },timing);
  }
  const inspector=new ScspVoiceInspector(applied.synth,{sampleRate:owner.clock.sampleRate||48000,
    readPCM:sample=>{const bytes=applied.ram.slice(sample.address,sample.address+sample.length*sample.bits/8),view=new DataView(bytes.buffer);return sample.bits===8?new Int8Array(bytes.buffer):Int16Array.from({length:sample.length},(_,i)=>view.getInt16(i*2,false));},
    dispatch:(command,leaseOwner)=>{collection.push({command,leaseOwner});},
    validate:command=>{const check=createNativeScspShadow();copy(check,applied,false);check.collect(command.method,command.args);},
    beginAudition:(ch,leaseOwner)=>leases.set(ch,{owner:leaseOwner,voice:context.identity()}),endAudition:()=>{}});
  function invoke(method,args=[]){const token=context.capture(),epoch=version,saved=clone(args),result=editorSerial.then(()=>{context.current(token);if(epoch!==version)throw abort();return invokeNow(method,saved);});editorSerial=result.catch(()=>{});return result;}
  async function invokeNow(method,args=[]){
    if(method==='getPCM'){await client.getState();return inspector.invoke(method,args);}
    if(method==='applyPCM')return enqueue(async check=>{
      await snapshot();check();if(authors.size||activeGroups.size||owner.activePerformance)throw new Error('Stop scheduled playback before applying PCM. The waveform draft is retained.');
      const staged=createNativeScspShadow();copy(staged,applied);const {commands,value}=staged.collect('_editPCM',clone(args));
      const message=identify(commands[0]);send(message,{},undefined);await owner.flush();check();await snapshot({after:message.id});check();
      copy(applied,staged);rebuild();notify({resources:applied.synth.getState(),editedSlot:args[0]});return value;
    });
    await client.getState();const previous=new Map(leases),auditions=new Map(inspector.auditions);collection=[];
    let value,entries;try{value=inspector.invoke(method,clone(args));entries=collection;}finally{collection=null;}
    try{for(const {command,leaseOwner}of entries){const ch=command.args[0],lease=leases.get(ch)??previous.get(ch);await control(command.method,command.args,{},lease??{voice:undefined});}
      await barrier();if(method==='auditionOff'&&value)leases.delete(args[0]);if(method==='auditionAllOff')leases.clear();
      if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))notify({preset:{method,args:clone(args)}});return value;
    }catch(error){leases.clear();for(const [ch,l]of previous)leases.set(ch,l);inspector.auditions=auditions;throw error;}
  }
  const client={id:'scsp',sampleRate:owner.clock.sampleRate||48000,nativeSampleRate:44100,channelCount:32,
    _getState:state,_adoptState(){},_allocateMainOwner:()=>{const id=context.identity();activeGroups.add(id);return id;},_withMainOwner(scope,callback){activeGroups.add(scope);const previous=group;group=scope;try{return callback();}finally{group=previous;}},
    _cancelMainOwner(scope){activeGroups.delete(scope);cancel(a=>a.group===scope);send(identify({method:'cancel-main-owner',targetGroup:scope}),{},undefined);},
    _stopVoices:()=>{cancel(()=>true);activeGroups.clear();return enqueue(async check=>{const m=identify({method:'stop-voices',audition:true});send(m,{},undefined);await owner.flush();check();await snapshot({after:m.id});applied.synth.stopVoices();rebuild();});},
    loadPCM,getState:()=>enqueue(async check=>{await barrier();check();return applied.synth.getState();}),dispose(){}};
  for(const method of SCSP_CONTROLS)client[method]=(...args)=>{report(control(method,args));};
  function stopped(){version++;activeGroups.clear();cancel(()=>true);leases.clear();inspector.resetAuditions();notes.clear();applied.synth.stopVoices();rebuild();}
  return {client,invoke,read(){return enqueue(async check=>{await snapshot();check();return inspector.read();});},
    dispatch(message,timing={}){const {method,args=[]}=message;const work=method==='dispose'?Promise.resolve(true):method==='loadPCM'?loadPCM(...args,timing):method==='getState'?client.getState():method==='stopVoices'?client._stopVoices():control(method,args,timing);
      return {deferred:Promise.resolve(work).then(value=>message.id===undefined?undefined:{id:message.id,value,...(method==='loadPCM'?{state:state()}:{} )})};},
    async initialize(){context.enable('scsp');if(initialized)return;await control('reset',[]);{const init=createScspInitSample(),wave=await loadPCM(init.pcm,init.options);for(let ch=0;ch<32;ch++)await control('setPreset',[ch,{sample:wave,totalLevel:12}]);}initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid SCSP mix');send({method:'mix',volume,pan},{},undefined);await owner.flush();},
    cancelOwner:(performance,owner)=>cancel(a=>a.performance===performance&&a.owner===owner),cancelPerformance:performance=>cancel(a=>a.performance!==undefined&&(performance===null||a.performance===performance)),
    stopped,adoptStopped(data){stopped();return adopt(data);},reset(){bankGeneration++;stopped();context.invalidate();context.disable('scsp');initialized=false;group=undefined;authors.clear();for(const t of [applied,projected])t.synth.reset({clearRam:true});appliedRevision=-1;}};
}
