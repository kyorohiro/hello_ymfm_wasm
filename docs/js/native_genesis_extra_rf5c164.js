import {RF5C164Synth} from './rf5c164synth.js?v=audio-stability-2';
import {sampleBytes,encodeRf5c164} from './rf5c164_pcm.js';
import {RfInspectorState,rfSampleMetadata} from './playground_chip_inspector_state.js?v=pokey-mode-1';
import {CHIP_CLOCKS,validateChipClock} from './playground_chip_clock.js?v=pokey-mode-1';
import {decodeNativeGenesisPCM} from './native_genesis_media.js';
import {createOfflineAudioDecoder} from './audio_decode.js';
import {createNativeVoiceContext,nativeInteger as integer} from './native_genesis_voice_endpoint.js?v=pokey-mode-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=pokey-mode-1';

export const EXTRA_RF5C164_CLOCK_HELD_ERROR='Release the manually held additional RF5C164 voices before changing the clock';
const CLOCK=CHIP_CLOCKS.rf5c164;
const abort=()=>new DOMException('Native additional RF5C164 operation was cancelled','AbortError');

/** Independent PCM RAM and voices. Only authored uploads and applied register
 * snapshots cross IPC; reading the inspector never downloads waveform RAM. */
export function createNativeGenesisExtraRf5c164Endpoint(synth,{decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>synth.clock.sampleRate}),fetcher=globalThis.fetch?.bind(globalThis)}={}){
  const context=createNativeVoiceContext(synth,{backend:'extra-rf5c164',statusCommand:'native_genesis_extra_rf5c164_status',label:'additional RF5C164'});
  const {capture,current}=context;let clock=CLOCK,appliedClock=CLOCK,initialized=false,mainGroup,serial=Promise.resolve(),clockSerial=Promise.resolve(),uploadSerial=Promise.resolve(),pendingUploads=0,pendingUploadBytes=0,collection;
  const operations=new Set(),leases=new Map();
  const tagged=message=>({...(mainGroup===undefined?{}:{group:mainGroup}),...message});
  const send=(message,timing)=>context.send('rf5c164',tagged(message),timing);
  const identified=message=>({...message,id:context.identity()});
  // Reuse the public Synth's complete validation without retaining a stale
  // author-side channel mask or selected channel.
  const validate=new RF5C164Synth({transport:{write(){},loadMemory(){},reset(){}}});
  function translate(method,args=[]){
    if(!Array.isArray(args))throw new TypeError('RF5C164 arguments must be an array');
    if(method==='setChannel'||method==='setPitch'){
      const channel=integer(args[0],7,'RF5C164 channel'),options=method==='setPitch'?{step:args[1]}:structuredClone(args[1]);
      if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('RF5C164 channel options must be an object');
      validate.setChannel(channel,options);const normalized=Object.fromEntries(['start','loopStart','step','volume','pan'].filter(key=>options[key]!==undefined).map(key=>[key,key==='pan'?{left:options.pan.left,right:options.pan.right}:options[key]]));return {method:'set-channel',channel,options:normalized};
    }
    if(method==='writeRegister'){validate.writeRegister(...args);return {method:'write',register:args[0],value:args[1]};}
    if(method==='keyOn'||method==='keyOff')return {method:method==='keyOn'?'key-on':'key-off',channel:integer(args[0],7,'RF5C164 channel')};
    if(method==='reset')return {method:'reset'};
    if(method==='stopVoices')return {method:'stop-voices'};
    throw new Error(`Unsupported Native additional RF5C164 operation: ${method}`);
  }
  const inspector=new RfInspectorState({writeRegister(){},loadMemory(){},reset(){}},{clock:()=>appliedClock,sampleRate:synth.clock.sampleRate,
    dispatch(command){if(!collection)throw new Error('RF5C164 inspector command outside an edit');collection.push(translate(command.method,command.args));}});
  const notify=()=>synth.emit?.({type:'native-state',name:'rf5c164',state:{clock}});
  function adopt(data){
    if(!Array.isArray(data.channels)||data.channels.length!==8||typeof data.enabled!=='boolean')throw new Error('Native additional RF5C164 returned an invalid snapshot');
    integer(data.mask,255,'RF5C164 mask');integer(data.selected,7,'RF5C164 selected channel');context.validateHeld(data,7);
    for(let index=0;index<8;index++){
      const ch=data.channels[index];if(ch.channel!==index)throw new Error('Native additional RF5C164 returned invalid channels');
      for(const key of ['start','loopStart','step'])integer(ch[key],65535,`RF5C164 ${key}`);
      integer(ch.volume,255,'RF5C164 volume');integer(ch.pan?.left,15,'RF5C164 left pan');integer(ch.pan?.right,15,'RF5C164 right pan');
      inspector.configuredSteps[index]=integer(ch.configuredStep??ch.step,65535,'RF5C164 configured step');
    }
    appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    inspector.channels=data.channels.map(ch=>({...ch,pan:{...ch.pan}}));inspector.mask=data.mask;inspector.selected=data.selected;inspector.enabled=data.enabled;
    if(data.knownMemoryRanges!==undefined){
      if(!Array.isArray(data.knownMemoryRanges))throw new Error('Native additional RF5C164 returned invalid memory ranges');
      inspector.memoryRanges=data.knownMemoryRanges.map(range=>{const address=integer(range.start??range.address,65536,'RF5C164 range start'),end=integer(range.end,65536,'RF5C164 range end');if(end<address)throw new Error('Invalid RF5C164 memory range');return {address,end};});
    }
    if(data.memoryRevision!==undefined)inspector.memoryRevision=data.memoryRevision;
    return {...inspector.read(),...data,kind:'rf5c164',samples:inspector.read().samples,memoryRanges:inspector.memoryRanges.map(range=>({...range}))};
  }
  const snapshot=async(args={})=>{
    let data;if(args.after===undefined)data=await context.snapshot('rf5c164',args);
    else{const token=capture(),result=await synth.observeNativeSnapshot('native_genesis_extra_rf5c164_status',args);current(token);if(!result?.rf5c164||typeof result.rf5c164!=='object')throw new Error('Native additional RF5C164 returned an invalid snapshot');data={...result.rf5c164,sampleRate:result.sampleRate??result.rf5c164.sampleRate,frame:result.frame??result.rf5c164.frame,revision:result.revision??result.rf5c164.revision};}
    adopt(data);return data;
  };
  const read=async(args={})=>adopt(await snapshot(args));
  function operation(timing={},group=mainGroup){const token=capture(),op={group,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(op);op.check=()=>{current(token);timing.checkCurrent?.();if(op.cancelled)throw abort();};op.done=()=>operations.delete(op);return op;}
  const cancelOperations=matches=>{for(const op of operations)if(matches(op))op.cancelled=true;};
  function queueUpload(bytes,callback){
    if(pendingUploads>=256||pendingUploadBytes+bytes>4*1024*1024)throw new RangeError('Native RF5C164 upload queue is full');
    pendingUploads++;pendingUploadBytes+=bytes;const result=uploadSerial.then(callback).finally(()=>{pendingUploads--;pendingUploadBytes-=bytes;});uploadSerial=result.catch(()=>{});return result;
  }
  async function commitUpload(op,bytes,address,metadata,timing={},group=op.group){
    op.check();validate.loadMemory(bytes,address);if(metadata)rfSampleMetadata(bytes,metadata);
    const command=identified({method:'load-memory',offset:address,data:Array.from(bytes),...(group===undefined?{}:{group})});
    send(command,{...timing,time:undefined});await synth.flush();op.check();await snapshot({after:command.id});op.check();
    // Commit the exact upload's metadata in the same order as its RAM writes.
    // No audio-thread RAM download or future author state is involved.
    inspector.memoryWrite(address,bytes.length);const sample=metadata?inspector.addSample(address,bytes,metadata):undefined;notify();return {command,sample};
  }
  async function upload(input,address=0,metadata,timing={},group=mainGroup){
    const op=operation(timing,group);try{
      op.check();const bytes=sampleBytes(input).slice();validate.loadMemory(bytes,address);if(metadata)rfSampleMetadata(bytes,metadata);
      return await queueUpload(bytes.length,()=>commitUpload(op,bytes,address,metadata,timing,group));
    }finally{op.done();}
  }
  async function perform(method,args=[],timing={},group=mainGroup){
    const op=operation(timing,group);try{op.check();const command=identified({...translate(method,args),...(group===undefined?{}:{group})});send(command,timing);await synth.flush();op.check();const data=await snapshot({after:command.id});op.check();if(method==='reset'&&!data.held?.length){inspector.resetAuditions();leases.clear();}}finally{op.done();}
  }
  async function clockCommand(hz,timing={},reply){
    validateChipClock(hz);const op=operation(timing);
    const result=clockSerial.then(async()=>{try{op.check();await synth.flush();op.check();const command=identified({method:'clock',hz,...(op.group===undefined?{}:{group:op.group})});send(command,timing);await synth.flush();op.check();const data=await snapshot({after:command.id});op.check();if(data.clock!==hz)throw new Error('Native additional RF5C164 clock was not applied');clock=hz;notify();return reply?.();}finally{op.done();}});clockSerial=result.catch(()=>{});return result;
  }
  async function sample(source,options={},allocate=false){
    const op=operation();try{
      const {address:requested=allocate?undefined:0,loopStart,endGuardBytes=0,name='Sample'}=options;
      if(requested!==undefined&&(integer(requested,65535,'address')%256))throw new RangeError('Start must be 256-byte aligned');integer(endGuardBytes,65536,'endGuardBytes');
      if(typeof name!=='string'||!name.length||name.length>256)throw new TypeError('Sample name must contain 1..256 characters');
      const data=encodeRf5c164(source?.channels&&source.sampleRate?source:await decodeNativeGenesisPCM(source,{decodeAudio,fetcher}));op.check();
      let bytes=data.bytes;if(endGuardBytes){bytes=new Uint8Array(data.frames+Math.max(3,endGuardBytes));bytes.set(data.bytes.subarray(0,data.frames));bytes.fill(255,data.frames);}
      const relativeLoop=loopStart===undefined?data.frames+1:integer(loopStart,data.frames-1,'loopStart');
      if(bytes.length>65536||requested!==undefined&&requested+bytes.length>65536)throw new RangeError('Sample exceeds RAM');
      return await queueUpload(bytes.length,async()=>{
        op.check();if(allocate){await read();op.check();}
        const address=allocate?inspector.allocate(bytes.length,requested):requested,loop=address+relativeLoop;
        const step=Math.max(1,Math.min(65535,Math.round(data.step*CLOCK/clock))),metadata={frames:data.frames,step,loopStart:loop,name,...(endGuardBytes?{endGuardBytes}:{})};
        const uploaded=await commitUpload(op,bytes,address,metadata);op.check();return allocate?{...uploaded.sample,start:address}:{start:address,loopStart:loop,step};
      });
    }finally{op.done();}
  }
  const client={
    loadMemory:(bytes,address=0)=>upload(bytes,address),loadSample:(source,options)=>sample(source,options),
    setChannel:(ch,options)=>perform('setChannel',[ch,options]),setPitch:(ch,step)=>perform('setPitch',[ch,step]),
    keyOn:ch=>perform('keyOn',[ch]),keyOff:ch=>perform('keyOff',[ch]),writeRegister:(r,v)=>perform('writeRegister',[r,v]),reset:()=>perform('reset'),
    setClock:hz=>clockCommand(hz),dispose(){},
  };
  Object.defineProperties(client,{clock:{enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}},_getState:{value:()=>({clock})},
    _allocateMainOwner:{value:()=>context.identity()},_withMainOwner:{value:(group,fn)=>{const previous=mainGroup;mainGroup=group;try{return fn();}finally{mainGroup=previous;}}},
    _cancelMainOwner:{value:group=>{cancelOperations(op=>op.group===group);send(identified({method:'cancel-main-owner',targetGroup:group}));}},
    _stopVoices:{value:()=>perform('stopVoices')},
  });
  function dispatch(message,timing={}){
    const token=capture();timing.checkCurrent?.();const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError('RF5C164 arguments must be an array');
    // A performance RPC acknowledges its audible application, while the bridge
    // FIFO remains free to cancel its owner or stop that pending command.
    const task=method==='clock'?clockCommand(args[0],timing):method==='loadMemory'?upload(args[0],args[1]??0,args[2],timing):method==='dispose'?Promise.resolve():perform(method,args,timing);
    return {deferred:task.then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id,...(method==='dispose'?{value:true}:{})};})};
  }
  function invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
    current(token);await read();current(token);let groups=[],value;
    if(['auditionOn','auditionOff','auditionAllOff'].includes(method)){
      const before=new Map(inspector.auditions),oldLeases=new Map(leases);collection=[];try{value=inspector.invoke(method,copy);}finally{const commands=collection;collection=null;
        if(method==='auditionAllOff')for(const [channel]of before){const voice=oldLeases.get(channel);if(voice)groups.push(identified({method:'batch',channel,voice,audition:true,action:'off',commands:[{method:'key-off',channel},{method:'set-channel',channel,options:{step:inspector.configuredSteps[channel]}}]}));}
        else if(commands.length){const channel=integer(copy[0],7,'RF5C164 channel'),voice=method==='auditionOn'?context.identity():oldLeases.get(channel);if(voice)groups.push(identified({method:'batch',channel,voice,audition:true,action:method==='auditionOn'?'on':'off',commands:method==='auditionOff'?[...commands,{method:'set-channel',channel,options:{step:inspector.configuredSteps[channel]}}]:commands}));if(method==='auditionOn')leases.set(channel,voice);else leases.delete(channel);}
      }
    }else{
      const command=translate(method,copy),channel=command.channel??inspector.selected;
      // Raw parameter edits target the channel that this applied view displays,
      // even if a queued script selects another channel before the edit runs.
      // Global register/reset edits remain explicit inspector operations.
      groups=command.method==='write'&&command.register<7?[identified({method:'batch',channel,audition:true,action:'edit',commands:[{method:'write',register:7,value:0xc0|channel},command]})]
        :['reset','stop-voices'].includes(command.method)||command.method==='write'?[identified({...command,audition:true})]
        :[identified({method:'batch',channel,audition:true,action:'edit',commands:[command]})];value=true;
    }
    for(const group of groups)send(group);await synth.flush();current(token);if(groups.length){const applied=await read({after:groups.at(-1).id});current(token);if(method==='auditionAllOff')leases.clear();if(method==='reset'&&!applied.held?.length){inspector.resetAuditions();leases.clear();}notify();}return value;
  });serial=result.catch(()=>{});return result;}
  return {client,dispatch,read,invoke,
    loadSample(source,options){const result=serial.then(()=>sample(source,options,true));serial=result.catch(()=>{});return result;},
    cancelOwner:(performance,owner)=>cancelOperations(op=>op.performance===performance&&op.owner===owner),cancelPerformance:performance=>cancelOperations(op=>op.performance!==undefined&&(performance===null||op.performance===performance)),
    async initialize(){const token=capture();context.enable('rf5c164');if(initialized)return;await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid RF5C164 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){cancelOperations(()=>true);context.invalidate();context.disable('rf5c164');initialized=false;mainGroup=undefined;leases.clear();inspector.reset();inspector.samples=[];inspector.memoryRanges=[];inspector.memoryRevision=0;clock=appliedClock=CLOCK;},
  };
}
export function createNativeGenesisExtraRf5c164(synth,options={}){return createNativeGenesisExtraChip(synth,{...options,kind:'rf5c164',label:'RF5C164',clock:CLOCK,createEndpoint:value=>createNativeGenesisExtraRf5c164Endpoint(value,options)});}
