// SPDX-License-Identifier: BSD-3-Clause
/** PS1 register authoring and instrument metadata stay in JavaScript. The SPU,
 * sample RAM, envelopes, reverb and resampling execute on the Native callback. */
import {Ps1Synth,preparePs1ADPCM,createPs1InitSample} from './ps1synth.js?v=ps1-deferred-release-1';
import {PS1_REVERB_PRESETS,patchPs1Envelope} from './ps1_parameters.js?v=ps1-voice-editor-1';
import {Ps1VoiceInspector} from './playground_ps1_inspector.js?v=ps1-deferred-release-1';
import {createNativeVoiceContext,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=ps1-deferred-release-1';

export const PS1_MEMORY_HELD_ERROR='Release the manually held PS1 voice before replacing its sample RAM or state';
export const PS1_STATE_HELD_ERROR=PS1_MEMORY_HELD_ERROR;
export const PS1_ADMISSION_ERRORS=Object.freeze([PS1_MEMORY_HELD_ERROR,
  'Native PS1 pending command limit reached (8 MiB)','Duplicate pending Native PS1 command ID',
  'Native PS1 command was cancelled before it applied','Native PS1 state changed while reading; retry',
  'Native PS1 command was not applied within 100 ms','Invalid Native PS1 RAM upload or voice lease',
  'PS1 RAM snapshots require an applied capture barrier ID','PS1 RAM snapshots require a RAM capture barrier',
  'Expired Native PS1 RAM capture']);
export const nativePs1Controls=new Set(['setPreset','setChannel','setEnvelope','setReverb','setPitch','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','allNotesOff','reset']);
const inspectorControls=new Set(['_auditionKeyOn','_auditionKeyOff','_refreshEnvelope']);
const clone=value=>structuredClone(value);
const abort=()=>new DOMException('Native PS1 operation was cancelled','AbortError');
const volume=value=>(value&0x4000?value-0x8000:value)/0x3fff;

export function createNativePs1Shadow(){
  const registers=new Uint16Array(512);let recording=null;
  const core={nativeFrames:0,reset({clearRam=false}={}){registers.fill(0);this.nativeFrames=0;recording?.push({method:'reset',clearRam});},
    write(register,value){registers[register/2]=value;recording?.push({method:'write',register,value});},read:register=>registers[register/2],
    loadRam(data,address=0){recording?.push({method:'load-memory',address,data:Array.from(data)});},
    auditionKey(channel,on){recording?.push({method:'audition-key',channel,on});},refreshEnvelope(channel){recording?.push({method:'refresh-envelope',channel});},
    readRam(){return new Uint8Array(0);},renderInto(){throw new Error('Native PS1 does not render in JavaScript');},dispose(){}};
  const synth=new Ps1Synth({core});
  return {registers,synth,collect(method,args=[]){const commands=[];recording=commands;try{synth[method](...args);}finally{recording=null;}return commands;}};
}
function copyShadow(target,source){target.registers.set(source.registers);const a=target.synth,b=source.synth;a._adoptResources(b._getResources());a.sampleBytes=b.sampleBytes.slice();a.channels=clone(b.channels);a.gates=b.gates.slice();a.reverb={...b.reverb};a.core.nativeFrames=b.core.nativeFrames;}
/** Translate only the changed fields, so an edit cannot overwrite a separately
 * scheduled pitch, envelope or sibling reverb-send bit. */
export function nativePs1Operations(target,method,args=[],{partial=false}={}){
  if(!nativePs1Controls.has(method)&&!inspectorControls.has(method)&&!['loadADPCM','_setWaveformPrepared','stopVoices'].includes(method))throw new Error(`Unsupported Native PS1 operation: ${method}`);
  let commands=target.collect(method,args);
  if(['setPreset','setChannel','setEnvelope'].includes(method)){
    const keys=method==='setEnvelope'?['adsr1','adsr2']:Object.keys(args[1]).filter(key=>args[1][key]!==undefined),offsets=new Set();
    for(const key of keys)for(const offset of ({sample:[6,14],volumeLeft:[0],volumeRight:[2],adsr1:[8],adsr2:[10],pitch:[4],reverb:[0x198,0x19a]})[key]??[])offsets.add(offset);
    let masks;
    if(method==='setEnvelope'){
      // A named field overrides the same bits regardless of the initial word;
      // untouched bits differ between these two patches. Merge only the named
      // bits into the callback's applied registers, never projected futures.
      const zero=patchPs1Envelope(0,0,args[1]),ones=patchPs1Envelope(65535,65535,args[1]);
      masks=new Map([[8,(~(zero.adsr1^ones.adsr1))&65535],[10,(~(zero.adsr2^ones.adsr2))&65535]]);
    }
    commands=commands.filter(c=>c.method==='write'&&offsets.has(c.register<0x180?c.register%16:c.register))
      .flatMap(c=>{const mask=masks?.get(c.register%16);return mask===0?[]:[mask===undefined?c:{...c,mask}];});
    const envelopeRequested=method==='setEnvelope'?[...masks.values()].some(Boolean):keys.some(key=>key==='adsr1'||key==='adsr2');
    if(envelopeRequested&&args[2]?.live!==false)commands.push({method:'refresh-envelope',channel:args[0],ifChanged:true});
  }
  return commands;
}

export function createNativeGenesisPs1(owner,{additional=false}={}){
  const backend=additional?'extra-ps1':'ps1',statusCommand=additional?'native_genesis_extra_ps1_status':'native_genesis_ps1_status';
  const context=createNativeVoiceContext(owner,{backend,statusCommand,label:additional?'additional PS1':'PS1'}),{capture,current}=context;
  const projected=createNativePs1Shadow(),applied=createNativePs1Shadow(),authors=new Map(),operations=new Set(),leases=new Map(),notes=new Map(),assigned=Array(24).fill(false);
  let resourceSerial=Promise.resolve(),editorSerial=Promise.resolve(),collection=null,mainGroup,initialized=false,resourceVersion=0,bankVersion=0,stateRevision=0,appliedRevision=-1,order=0,editing=0;
  const state=()=>({...projected.synth.getState(),stateRevision});
  const notify=authorEdit=>{stateRevision++;owner.emit?.({type:'native-state',name:'spu',state:state(),...(authorEdit?{authorEdit}:{})});};
  const identify=message=>({...message,id:context.identity()});
  const send=(messages,timing={},group=mainGroup)=>{timing.checkCurrent?.();for(const message of messages)context.send('ps1',{...(group===undefined?{}:{group}),...message},timing);};
  function operation(timing={}){if(operations.size>=256)throw new RangeError('Native PS1 preparation request queue is full');const token=capture(),op={group:mainGroup,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(op);op.check=()=>{current(token);timing.checkCurrent?.();if(op.cancelled)throw abort();};return op;}
  function rebuild(){copyShadow(projected,applied);for(const item of [...authors.values()].sort((a,b)=>a.frame-b.frame||a.order-b.order))nativePs1Operations(projected,item.method,item.args);stateRevision++;}
  function cancel(matches){for(const op of operations)if(matches(op))op.cancelled=true;for(const [id,item]of authors)if(matches(item))authors.delete(id);for(const [id,item]of notes)if(matches(item))notes.delete(id);rebuild();}
  function remember(method,args,messages,timing,op){if(authors.size>=65536)throw new RangeError('Native PS1 author queue is full');const id=messages.at(-1).id;authors.set(id,{id,method,args:clone(args),frame:timing.time===undefined?0:owner.frameAt(timing.time),order:++order,accepted:false,group:op.group,performance:op.performance,owner:op.owner});return id;}
  async function admit(messages,timing,op){op.check();send(messages,timing,op.group);await owner.flush();op.check();}
  function adopt(data){
    nativeSnapshotArray(data?.registers,512,65535,'PS1 registers');context.validateHeld(data,23);
    if(!Number.isSafeInteger(data.nativeFrames)||data.nativeFrames<0||!Number.isInteger(data.enabled)||data.enabled<0||data.enabled>0xffffff)throw new Error('Native PS1 returned an invalid snapshot');
    if(data.ram!==undefined)nativeSnapshotArray(data.ram,524288,255,'PS1 RAM');
    if(data.revision!==undefined&&(!Number.isSafeInteger(data.revision)||data.revision<0))throw new Error('Native PS1 returned an invalid revision');
    if(data.revision!==undefined&&data.revision<appliedRevision)return data;
    appliedRevision=data.revision??appliedRevision;applied.registers.set(data.registers);applied.synth.core.nativeFrames=data.nativeFrames;
    const pending=new Set(data.pendingCommands??[]),completed=[...authors.values()].filter(v=>v.accepted&&!pending.has(v.id)).sort((a,b)=>a.frame-b.frame||a.order-b.order);
    for(const item of completed){
      if(item.method==='reset'){assigned.fill(false);applied.synth.reverb={preset:'off',volumeLeft:.25,volumeRight:.25};}
      else if(['setPreset','setChannel'].includes(item.method)&&item.args[1].sample!==undefined&&!data.held?.includes(item.args[0]))assigned[item.args[0]]=true;
      else if(item.method==='setReverb'&&!data.held?.length)Object.assign(applied.synth.reverb,item.args[0]);
      authors.delete(item.id);
    }
    for(let ch=0;ch<24;ch++){
      const b=ch*8,sample=assigned[ch]?applied.synth.samples.find(s=>(s.startAddress>>3)===data.registers[b+3]&&(s.editorChannel===undefined||s.editorChannel===ch)):null;
      applied.synth.channels[ch]={sample:sample?.id??null,volumeLeft:volume(data.registers[b]),volumeRight:volume(data.registers[b+1]),pitch:data.registers[b+2],adsr1:data.registers[b+4],adsr2:data.registers[b+5],reverb:!!(data.registers[(0x198+(ch>=16?2:0))/2]&(1<<(ch%16)))};
      applied.synth.gates[ch]=!!(data.enabled&(1<<ch));
    }
    const preset=PS1_REVERB_PRESETS.find(p=>p.registers.every((v,i)=>v===data.registers[0xe0+i]));
    if(preset){applied.synth.reverb.preset=preset.id;if(preset.id!=='off'){applied.synth.reverb.volumeLeft=data.registers[0xc2]/0x7fff;applied.synth.reverb.volumeRight=data.registers[0xc3]/0x7fff;}}
    inspector.sampleRate=data.sampleRate??owner.clock.sampleRate;client.sampleRate=inspector.sampleRate;
    if(data.held&&!editing)for(const ch of leases.keys())if(!data.held.includes(ch)){leases.delete(ch);inspector.auditions.delete(ch);}
    rebuild();return data;
  }
  async function snapshot(args={}){const token=capture(),version=resourceVersion;const result=args.after===undefined?await owner.nativeRequest(statusCommand,args):await owner.observeNativeSnapshot(statusCommand,args);current(token);if(version!==resourceVersion)throw abort();const data=additional?result?.ps1:result;if(!data)throw new Error('Native PS1 returned an invalid snapshot');return adopt({...data,sampleRate:result.sampleRate??data.sampleRate,revision:result.revision??data.revision});}
  const inspector=new Ps1VoiceInspector(applied.synth,{sampleRate:owner.clock.sampleRate||48000,
    dispatch(command,owner,options){if(!collection)throw new Error('PS1 inspector command outside an edit');collection.push({command,owner,...options});},
    beginAudition(ch,owner){leases.set(ch,{owner,voice:context.identity()});},endAudition(){}});
  const key=(op,ch)=>`${op.performance??'main'}:${op.owner??op.group??'main'}:${ch}`;
  function controls(method,args=[],timing={}){
    const op=operation(timing);let messages,id;const before=createNativePs1Shadow();copyShadow(before,projected);
    try{
      if(method==='reset'&&leases.size)throw new Error(PS1_STATE_HELD_ERROR);
      const commands=nativePs1Operations(projected,method,args);
      if(!commands.length){operations.delete(op);return Promise.resolve();}
      if(method==='reset'){resourceVersion++;if(args[0]?.clearRam)bankVersion++;messages=commands.filter(c=>c.method!=='write');messages.push({method:'batch',action:'edit',commands:commands.filter(c=>c.method==='write')});}
      else if(method==='allNotesOff')messages=[{method:'all-notes-off'}];
      else{
        const ch=Number.isInteger(args[0])?args[0]:undefined,action=['keyOn','noteOn'].includes(method)?'on':['keyOff','noteOff'].includes(method)?'off':'edit',noteKey=key(op,ch);let voice=notes.get(noteKey)?.voice;
        if(action==='on'){voice=context.identity();notes.set(noteKey,{voice,...op});}else if(action==='off')notes.delete(noteKey);
        messages=[{method:'batch',...(ch===undefined?{}:{channel:ch}),action,...(voice===undefined?{}:{voice}),commands}];
      }
      messages[messages.length-1]=identify(messages.at(-1));id=remember(method,args,messages,timing,op);
    }catch(error){copyShadow(projected,before);operations.delete(op);throw error;}
    return admit(messages,method==='reset'?{...timing,time:undefined}:timing,op).then(()=>{const item=authors.get(id);if(item)item.accepted=true;
      // Stop can precede the first inspector read. Immediate assignments have
      // already crossed the admission barrier and must survive that Stop,
      // including the 24 initial sine assignments installed during startup.
      if(method==='reset'){assigned.fill(false);applied.synth._adoptResources(projected.synth._getResources());applied.synth.sampleBytes=projected.synth.sampleBytes.slice();}
      else if(item?.frame===0&&['setPreset','setChannel'].includes(method)&&args[1].sample!==undefined)assigned[args[0]]=true;
      notify();},error=>{authors.delete(id);rebuild();throw error;}).finally(()=>operations.delete(op));
  }
  function loadADPCM(input,options,timing={}){
    const op=operation(timing);let prepared,saved;try{prepared=preparePs1ADPCM(input,options);saved=clone(options);}catch(error){operations.delete(op);return Promise.reject(error);}const version=resourceVersion;
    const bank=bankVersion,result=resourceSerial.then(async()=>{
      op.check();if(version!==resourceVersion)throw abort();
      const staged=createNativePs1Shadow();copyShadow(staged,projected);const commands=staged.collect('loadADPCM',[prepared.adpcm,saved]),sample={...staged.synth.samples.at(-1)},message=identify(commands[0]);
      op.check();send([message],{...timing,time:undefined},op.group);await owner.flush();
      // Accepted uploads belong to the bank even when Stop or a default reset
      // cancels their old continuation. Only a clear-RAM reset replaces it.
      if(bank===bankVersion)for(const target of [projected,applied]){target.synth._adoptResources(staged.synth._getResources());target.synth.sampleBytes=staged.synth.sampleBytes.slice();}
      op.check();await snapshot({after:message.id});op.check();if(version!==resourceVersion)throw abort();
      notify({resources:staged.synth._getResources()});return sample;
    }).finally(()=>operations.delete(op));resourceSerial=result.catch(()=>{});return result;
  }
  async function barrier({ram=false}={},timing={}){const op=operation(timing);try{const message=identify({method:'barrier',ram});await admit([message],{...timing,time:undefined},op);const data=await snapshot({after:message.id,...(ram?{ram:true}:{})});op.check();return data;}finally{operations.delete(op);}}
  async function readControl(method,args=[],timing={}){if(method==='getPreset')projected.synth.getPreset(args[0]);const data=await barrier({ram:method==='snapshot'},timing);if(method==='getPreset')return applied.synth.getPreset(args[0]);if(method==='snapshot')return {...applied.synth.getState(),ram:Uint8Array.from(data.ram),registers:Uint16Array.from(data.registers)};return applied.synth.getState();}
  const report=promise=>promise.catch(error=>{if(error?.name!=='AbortError')owner.reportAsyncError(error);});
  const client={id:'ps1',sampleRate:owner.clock.sampleRate||48000,nativeSampleRate:44100,channelCount:24,_getState:state,_adoptState(){return false;},
    _allocateMainOwner:()=>context.identity(),_withMainOwner(group,callback){const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}},
    _cancelMainOwner(group){cancel(op=>op.group===group);send([identify({method:'cancel-main-owner',targetGroup:group})],{},undefined);},
    async _stopVoices(){const op=operation();try{await admit([identify({method:'stop-voices'})],{},op);}finally{operations.delete(op);}},
    loadADPCM,getState:()=>readControl('getState'),getPreset:ch=>readControl('getPreset',[ch]),snapshot:()=>readControl('snapshot'),dispose(){}};
  for(const method of nativePs1Controls)client[method]=(...args)=>{const pending=controls(method,clone(args));report(pending);};
  function dispatch(message,timing={}){const {method,args=[]}=message;let result;if(method==='dispose')result=true;
    else if(method==='loadADPCM')result=loadADPCM(args[0],args[1],timing);
    else if(['getState','getPreset','snapshot'].includes(method))result=readControl(method,args,timing);
    else if(method==='stopVoices'){const op=operation(timing);result=admit([identify({method:'stop-voices'})],timing,op).finally(()=>operations.delete(op));}
    else result=controls(method,clone(args),timing);
    return {deferred:Promise.resolve(result).then(value=>message.id===undefined?undefined:{id:message.id,value})};}

  function invoke(method,args=[]){const token=capture(),saved=clone(args),bank=bankVersion,result=editorSerial.then(()=>{
    const editingResult=resourceSerial.then(async()=>{
    current(token);await snapshot();current(token);editing++;
    const previousLeases=new Map(leases),previousAuditions=new Map(inspector.auditions),staged=createNativePs1Shadow();copyShadow(staged,applied);
    try{
      // The common inspector validates against applied state. Stage its RAM
      // mutation until Native accepts the private waveform upload.
      let value,entries;collection=[];const original=inspector.synth;inspector.synth=staged.synth;
      try{value=inspector.invoke(method,saved);entries=collection;}finally{inspector.synth=original;collection=null;}
      const groups=[];
      if(method==='setWaveform'){
        const ch=saved[0],sample=value,lease=leases.get(ch),data=Array.from(staged.synth.sampleBytes[sample.id]);
        groups.push(identify({method:'load-memory',address:sample.startAddress,data,channel:ch,audition:true,...(lease?{voice:lease.voice}:{}),action:'edit'}));
      }
      for(const entry of entries){const ch=entry.command.method==='setReverb'?undefined:entry.command.args[0],held=ch===undefined?[...leases.values()][0]:leases.get(ch)??previousLeases.get(ch),action=entry.preserveOwner||!entry.owner?'edit':entry.command.method==='_auditionKeyOn'?'on':entry.command.method==='_auditionKeyOff'?'off':method==='auditionOn'?'on':method==='auditionOff'||method==='auditionAllOff'?'off':'edit';
        let group=groups.at(-1);if(group?.method!=='batch'||group.channel!==ch||group.action!==action||group.voice!==held?.voice){group=identify({method:'batch',...(ch===undefined?{}:{channel:ch}),...(held?{voice:held.voice}:{}),audition:true,action,commands:[]});groups.push(group);}
        group.commands.push(...nativePs1Operations(staged,entry.command.method,entry.command.args,{partial:action==='edit'}));
      }
      if(groups.length){send(groups,{},undefined);await owner.flush();
        // Adopt metadata before decoding the matching applied registers.
        if(bank===bankVersion)for(const target of [applied,projected]){target.synth._adoptResources(staged.synth._getResources());target.synth.sampleBytes=staged.synth.sampleBytes.slice();}
        current(token);
        if(method==='setWaveform'||['setPreset','setChannel'].includes(method)&&saved[1].sample!==undefined)assigned[saved[0]]=true;
        if(method==='setReverb')applied.synth.reverb={...staged.synth.reverb};
        await snapshot({after:groups.at(-1).id});current(token);
      }
      if(method==='auditionOff'&&value)leases.delete(saved[0]);if(method==='auditionAllOff')leases.clear();
      if(groups.length){let edit;if(method==='setWaveform')edit={resources:applied.synth._getResources(),channel:saved[0],preset:{sample:value.id}};
        else if(method==='setReverb')edit={reverb:{...applied.synth.reverb}};
        else if(!['auditionOn','auditionOff','auditionAllOff'].includes(method)){const ch=saved[0],keys=method==='setEnvelope'?['adsr1','adsr2']:['setPreset','setChannel'].includes(method)?Object.keys(saved[1]):['pitch'];edit={channel:ch,preset:Object.fromEntries(keys.map(key=>[key,applied.synth.channels[ch][key]]))};}
        notify(edit);}
      return ['auditionOn','auditionOff','auditionAllOff','setWaveform'].includes(method)?value:inspector.read();
    }catch(error){if(token.session===owner.session&&token.generation===owner.generation){leases.clear();for(const [ch,lease]of previousLeases)leases.set(ch,lease);inspector.auditions=previousAuditions;}throw error;}finally{editing--;}
    });resourceSerial=editingResult.catch(()=>{});return editingResult;
  });editorSerial=result.catch(()=>{});return result;}
  function stopped(){cancel(()=>true);leases.clear();inspector.resetAuditions();notes.clear();projected.synth.gates.fill(false);applied.synth.gates.fill(false);}
  return {client,dispatch,invoke,async read(){await snapshot();return inspector.read();},
    cancelOwner:(performance,owner)=>cancel(op=>op.performance===performance&&op.owner===owner),cancelPerformance:performance=>cancel(op=>op.performance!==undefined&&(performance===null||op.performance===performance)),
    async initialize(){const token=capture();context.enable('ps1');if(initialized)return;await controls('reset',[]);current(token);if(!additional){const init=createPs1InitSample(),sample=await loadADPCM(init.adpcm,{baseFrequencyHz:init.baseFrequencyHz,loopStartSamples:init.loopStartSamples});current(token);for(let ch=0;ch<24;ch++)await controls('setPreset',[ch,{sample}]);}initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid PS1 mix');const token=capture();send([{method:'mix',volume,pan}],{},undefined);await owner.flush();current(token);},
    stopped,adoptStopped(data){stopped();return adopt(data?.ps1??data);},
    reset(){stopped();resourceVersion++;bankVersion++;context.invalidate();context.disable('ps1');initialized=false;mainGroup=undefined;assigned.fill(false);for(const target of [projected,applied])target.synth.reset({clearRam:true});appliedRevision=-1;},
  };
}
