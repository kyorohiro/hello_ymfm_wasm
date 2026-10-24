import {Oki6258Synth,OKIM6258_CLOCK,OKIM6258_DIVIDERS,oki6258Rate,encodeOki6258,summarizeOki6258} from './okim6258synth.js?v=extra-ym2610b-1';
import {Oki6258VoiceInspector} from './playground_okim6258_inspector.js?v=extra-ym2610b-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {decodeNativeGenesisPCM} from './native_genesis_media.js';
import {createOfflineAudioDecoder} from './audio_decode.js';
import {createNativeVoiceContext,nativeInteger as integer} from './native_genesis_voice_endpoint.js?v=extra-ym2610b-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=extra-ym2610b-1';

export const EXTRA_OKIM6258_MEMORY_HELD_ERROR='Release the manually held additional OKIM6258 voices before replacing their sample';
export const EXTRA_OKIM6258_CLOCK_HELD_ERROR='Release the manually held additional OKIM6258 voices before changing the clock';
const MAX_MEMORY=0x1000000;
const abort=()=>new DOMException('Native additional OKIM6258 operation was cancelled','AbortError');

/** An independent ADPCM decoder and immutable encoded sample. Reads only fetch
 * applied controls and bounded sample metadata, never sample RAM or audio. */
export function createNativeGenesisExtraOkim6258Endpoint(synth,{decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>synth.clock.sampleRate}),fetcher=globalThis.fetch?.bind(globalThis)}={}){
  const context=createNativeVoiceContext(synth,{backend:'extra-okim6258',statusCommand:'native_genesis_extra_okim6258_status',label:'additional OKIM6258'});
  const {capture,current}=context;let initialized=false,mainGroup,collection,lease,serial=Promise.resolve(),uploadSerial=Promise.resolve(),clockSerial=Promise.resolve(),pendingUploads=0,pendingBytes=0;
  const operations=new Set(),identified=message=>({...message,id:context.identity()});
  const send=(message,timing,...scope)=>{const group=scope.length?scope[0]:mainGroup;context.send('okim6258',{...(group===undefined?{}:{group}),...message},timing);};
  const clockHz=hz=>{validateChipClock(hz);if(hz/512/synth.clock.sampleRate>14)throw new RangeError('OKIM6258 VCLK exceeds the output stream rate');return hz;};
  function operation(timing={},group=mainGroup,signal){const token=capture(),op={group,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(op);op.check=()=>{current(token);timing.checkCurrent?.();signal?.throwIfAborted();if(op.cancelled)throw abort();};op.done=()=>operations.delete(op);return op;}
  const cancelOperations=matches=>{for(const op of operations)if(matches(op))op.cancelled=true;};
  function command(method,args=[]){
    if(!Array.isArray(args))throw new TypeError('OKIM6258 arguments must be an array');
    if(method==='writeRegister')return {method:'write',register:integer(args[0],12,'OKIM6258 register'),value:integer(args[1],255,'OKIM6258 value')};
    if(method==='clock')return {method:'clock',hz:clockHz(args[0])};
    if(method==='play'){const repeat=args[0]?.repeat??false;if(typeof repeat!=='boolean')throw new TypeError('Repeat must be boolean');return {method:'play',repeat};}
    if(method==='setRepeat'){if(typeof args[0]!=='boolean')throw new TypeError('Repeat must be boolean');return {method:'set-repeat',repeat:args[0]};}
    if(['stop','reset'].includes(method))return {method};
    if(['stopVoices','allNotesOff'].includes(method))return {method:'stop-voices'};
    throw new Error(`Unsupported Native additional OKIM6258 operation: ${method}`);
  }
  const client=new Oki6258Synth({transport:{writeRegister:(r,v)=>send(identified(command('writeRegister',[r,v]))),loadMemory:()=>{},play:options=>send(identified(command('play',[options]))),stop:()=>send(identified({method:'stop'})),reset:()=>send(identified({method:'reset'}))}});
  const stream={clock:OKIM6258_CLOCK,divider:512,pan:0,bytes:{length:0},playing:false,streaming:false,repeat:false,position:0,fedBytes:0,_validateRate(clock,divider){if(clock/512/synth.clock.sampleRate>14)throw new RangeError('OKIM6258 VCLK exceeds the output stream rate');}};
  const inspector=new Oki6258VoiceInspector(stream,{sampleRate:synth.clock.sampleRate,dispatch(message){if(!collection)throw new Error('OKIM6258 inspector command outside an edit');collection.push(command(message.method,message.args));}});
  const notify=authorEdit=>synth.emit?.({type:'native-state',name:'okim6258',state:client._getState(),...(authorEdit?{authorEdit}:{})});
  function adopt(data){
    validateChipClock(data.clock);context.validateHeld(data,0);
    if(!OKIM6258_DIVIDERS.includes(data.divider)||!Number.isInteger(data.pan)||data.pan<0||data.pan>3||!Number.isSafeInteger(data.positionFrames??0)||(data.positionFrames??0)<0||!Number.isSafeInteger(data.fedBytes??0)||(data.fedBytes??0)<0)throw new Error('Native additional OKIM6258 returned an invalid snapshot');
    if(data.sample){const s=data.sample;if(!Number.isInteger(s.bytes)||s.bytes<1||s.bytes>MAX_MEMORY||s.frames!==s.bytes*2||!Number.isFinite(s.sampleRate)||s.sampleRate<=0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<=0||s.waveform!=null&&(!Array.isArray(s.waveform)||s.waveform.length>512||s.waveform.some(v=>!Number.isFinite(v)||Math.abs(v)>1)))throw new Error('Native additional OKIM6258 returned invalid sample metadata');}
    Object.assign(stream,{clock:data.clock,divider:data.divider,pan:data.pan,bytes:{length:data.sample?.bytes??0},playing:!!data.playing,streaming:!!data.streaming,repeat:!!data.repeat,position:data.positionFrames??0,fedBytes:data.fedBytes??0});
    inspector.sample=data.sample?structuredClone(data.sample):null;inspector.memoryRevision=data.memoryRevision??0;inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    return {...data,...inspector.read(),held:data.held??(lease?[0]:[])};
  }
  async function snapshot(args={}){let data;if(args.after===undefined)data=await context.snapshot('okim6258',args);else{const token=capture(),result=await synth.observeNativeSnapshot('native_genesis_extra_okim6258_status',args);current(token);if(!result?.okim6258||typeof result.okim6258!=='object')throw new Error('Native additional OKIM6258 returned an invalid snapshot');data={...result.okim6258,sampleRate:result.sampleRate??result.okim6258.sampleRate,frame:result.frame??result.okim6258.frame,revision:result.revision??result.okim6258.revision};}adopt(data);return data;}
  const read=async(args={})=>adopt(await snapshot(args));
  function metadataFor(input,metadata={}){
    const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
    if(!(bytes instanceof Uint8Array))throw new TypeError('OKIM6258 memory requires Uint8Array or ArrayBuffer');
    if(!bytes.length||bytes.length>MAX_MEMORY)throw new RangeError('Expected 1 byte to 16 MiB of OKI ADPCM');
    if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).some(k=>!['name','frames','sampleRate','waveform','source'].includes(k)))throw new TypeError('Invalid OKIM6258 sample metadata');
    const name=metadata.name??'OKI ADPCM stream',frames=metadata.frames??bytes.length*2,sampleRate=metadata.sampleRate??client.playbackRate,source=metadata.source??'raw',waveform=metadata.waveform??summarizeOki6258(bytes).waveform;
    if(typeof name!=='string'||name.length>256)throw new TypeError('Sample name must be at most 256 characters');
    if(frames!==bytes.length*2&&frames!==bytes.length*2-1)throw new RangeError('Invalid OKIM6258 sample frames');
    if(!Number.isFinite(sampleRate)||sampleRate<1||sampleRate>1000000)throw new RangeError('Invalid OKIM6258 sample rate');
    if(!['raw','sample'].includes(source)||!Array.isArray(waveform)||!waveform.length||waveform.length>512||waveform.some(v=>!Number.isFinite(v)||Math.abs(v)>1))throw new TypeError('Invalid OKIM6258 sample preview');
    return {bytes:bytes.slice(),metadata:{name,frames:bytes.length*2,sampleRate,waveform:waveform.slice(),source}};
  }
  function queueUpload(op,staged,timing={},audition=false){
    if(pendingUploads>=256||pendingBytes+staged.bytes.length>32*1024*1024)throw new RangeError('Native OKIM6258 upload queue is full');
    pendingUploads++;pendingBytes+=staged.bytes.length;
    const result=uploadSerial.then(async()=>{
      op.check();const sampleId=context.identity(),edit=identified({method:'load-memory',sampleId,data:Array.from(staged.bytes),metadata:staged.metadata,...(op.group===undefined?{}:{group:op.group}),...(audition?{audition:true}:{})});
      send(edit,{...timing,time:undefined},op.group);await synth.flush();op.check();const applied=await snapshot({after:edit.id});op.check();
      if(applied.sampleId!==sampleId)throw new Error('OKIM6258 sample replacement was blocked by a manual audition');
      client.sample={...staged.metadata,bytes:staged.bytes.length,durationSeconds:staged.bytes.length*2/staged.metadata.sampleRate};inspector.resetAudition();lease=undefined;notify({sample:{...client.sample}});return {...client.sample};
    }).finally(()=>{pendingUploads--;pendingBytes-=staged.bytes.length;});uploadSerial=result.catch(()=>{});return result;
  }
  async function upload(input,metadata={},timing={},group=mainGroup,signal,audition=false){const op=operation(timing,group,signal);try{op.check();return await queueUpload(op,metadataFor(input,metadata),timing,audition);}finally{op.done();}}
  client.loadMemory=async(input,{sampleRate}={})=>{const op=operation();try{op.check();const staged=metadataFor(input);if(sampleRate!==undefined)client.setPlaybackRate(sampleRate);staged.metadata.sampleRate=client.playbackRate;await queueUpload(op,staged);}finally{op.done();}};
  async function sample(source,options={},audition=false){
    const op=operation({},mainGroup,options.signal);try{
      op.check();const pcm=await decodeNativeGenesisPCM(source,{decodeAudio:options.decodeAudio??decodeAudio,fetcher});op.check();
      const rate=oki6258Rate(client.clock,options.sampleRate??client.playbackRate),encoded=encodeOki6258(pcm,rate.sampleRate),staged=metadataFor(encoded.bytes,{...summarizeOki6258(encoded.bytes),name:options.name??'Sample',sampleRate:rate.sampleRate,source:'sample'});
      await queueUpload(op,staged,{},audition);op.check();send(identified({method:'write',register:12,value:OKIM6258_DIVIDERS.indexOf(rate.divider),...(op.group===undefined?{}:{group:op.group}),...(audition?{audition:true}:{})}),undefined,op.group);await synth.flush();op.check();client.divider=rate.divider;notify({divider:rate.divider});return {...encoded,bytes:encoded.bytes.length,...(options.name===undefined?{}:{name:options.name})};
    }finally{op.done();}
  }
  client.loadSample=(source,options)=>sample(source,options);
  async function clockCommand(hz,timing={},audition=false){
    clockHz(hz);const op=operation(timing),result=clockSerial.then(async()=>{try{op.check();await synth.flush();op.check();const edit=identified({method:'clock',hz,...(op.group===undefined?{}:{group:op.group}),...(audition?{audition:true}:{})});send(edit,timing,op.group);await synth.flush();op.check();const data=await snapshot({after:edit.id});op.check();if(data.clock!==hz)throw new Error('Native additional OKIM6258 clock was not applied');client._adoptHardwareClock(hz);notify({clock:hz});}finally{op.done();}});clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  Object.defineProperties(client,{_adoptClock:{value:hz=>client._adoptHardwareClock(hz)},_allocateMainOwner:{value:()=>context.identity()},_withMainOwner:{value:(group,fn)=>{const before=mainGroup;mainGroup=group;try{return fn();}finally{mainGroup=before;}}},_cancelMainOwner:{value:group=>{cancelOperations(op=>op.group===group);send(identified({method:'cancel-main-owner',targetGroup:group}));}},_stopVoices:{value:async()=>{const token=capture();send(identified({method:'stop-voices'}));await synth.flush();current(token);}}});
  function dispatch(message,timing={}){
    const token=capture(),method=message.method??message.type,args=message.args??[];timing.checkCurrent?.();if(!Array.isArray(args))throw new TypeError('OKIM6258 arguments must be an array');
    if(method==='clock'||method==='loadMemory'){
      const task=method==='clock'?clockCommand(args[0],timing):upload(args[0],args[1]??{},timing);
      return {deferred:task.then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id};})};
    }
    if(method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};
    send(identified(command(method,args)),timing);return synth.flush().then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id};});
  }
  function invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
    current(token);await read();current(token);const previous=inspector.audition;collection=[];let value,commands;
    try{value=inspector.invoke(method,copy);commands=collection;}finally{collection=null;}
    if(!commands.length)return value;if(commands.length===1&&commands[0].method==='clock'){await clockCommand(commands[0].hz,{},true);current(token);return value;}let action='edit',voice=lease;
    if(inspector.audition!==previous&&inspector.audition){action='on';voice=context.identity();}else if(previous&&!inspector.audition)action='off';
    const edit=identified({method:'batch',channel:0,audition:true,action,...(voice?{voice}:{}),commands});send(edit);await synth.flush();current(token);const applied=await snapshot({after:edit.id});current(token);lease=action==='off'?undefined:voice;
    const patch={};for(const c of commands){if(c.method==='write'&&c.register===12)patch.divider=[1024,768,512,512][c.value&3];if(c.method==='write'&&c.register===2)patch.pan=c.value&3;}
    client._adoptState({...client._getState(),...patch});if(!applied.held?.length&&action==='off')inspector.resetAudition();notify(patch);return value;
  });serial=result.catch(()=>{});return result;}
  return {client,dispatch,read,invoke,loadSample:(source,options)=>sample(source,options,true),
    cancelOwner:(performance,owner)=>cancelOperations(op=>op.performance===performance&&op.owner===owner),cancelPerformance:performance=>cancelOperations(op=>op.performance!==undefined&&(performance===null||op.performance===performance)),
    async initialize(){const token=capture();context.enable('okim6258');if(initialized)return;await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid OKIM6258 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){cancelOperations(()=>true);context.invalidate();context.disable('okim6258');initialized=false;mainGroup=undefined;lease=undefined;inspector.resetAudition();inspector.sample=null;inspector.memoryRevision=0;client.disposed=true;},
  };
}
export function createNativeGenesisExtraOkim6258(synth,options={}){return createNativeGenesisExtraChip(synth,{...options,kind:'okim6258',label:'OKIM6258',clock:OKIM6258_CLOCK,createEndpoint:value=>createNativeGenesisExtraOkim6258Endpoint(value,options)});}
