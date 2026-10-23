/** X68000 control helpers shared with Web Audio; Native owns both renderers. */
import {noteToHz,opmPitchFromHz} from './soundchip_pitch.js';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Ym2151VoiceInspector} from './playground_ym2151_inspector.js?v=audio-numeric-bindings-1';
import {Oki6258VoiceInspector} from './playground_okim6258_inspector.js?v=native-chip-comparison-1';
import {Oki6258Synth,OKIM6258_DIVIDERS,oki6258Rate,encodeOki6258,summarizeOki6258} from './okim6258synth.js?v=native-chip-comparison-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
import {decodeNativeGenesisPCM} from './native_genesis_media.js';
import {createOfflineAudioDecoder} from './audio_decode.js';

const MAX_MEMORY=0x1000000,CHUNK=65536;
const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);return value;};
const abort=()=>new DOMException('Native X68000 operation was cancelled','AbortError');
const fields={dt1:[0x40,4,7],mul:[0x40,0,15],tl:[0x60,0,127],ks:[0x80,6,3],ar:[0x80,0,31],am:[0xa0,7,1],d1r:[0xa0,0,31],dt2:[0xc0,6,3],d2r:[0xc0,0,31],d1l:[0xe0,4,15],rr:[0xe0,0,15]};

/** Preserve createYm2151Client's register-order operator API without inventing a MessagePort. */
function createOpmClient(send){
  let clock=4000000;const registers=new Uint8Array(256),channel=ch=>integer(ch,7,'YM2151 channel');
  const writeRegister=(register,value)=>{integer(register,255,'Register');integer(value,255,'Value');send({method:'write',register,value});registers[register]=value;};
  const client={id:'ym2151',get clock(){return clock;},_adoptClock(hz){clock=validateChipClock(hz);},
    _getState(){return {clock,registers:Array.from(registers)};},
    _adoptState(state){if(state?.registers)registers.set(state.registers);if(state?.clock!==undefined)client._adoptClock(state.clock);},
    writeRegister,reset(){send({method:'reset'});registers.fill(0);},
    setOperator(ch,operator,options){channel(ch);integer(operator,3,'Operator');const updates=Object.entries(options).map(([field,value])=>{if(!fields[field])throw new Error(`Unknown YM2151 operator field: ${field}`);const [base,shift,max]=fields[field];integer(value,max,field);return [base+operator*8+ch,shift,max,value];});for(const [r,shift,max,value]of updates)writeRegister(r,(registers[r]&~(max<<shift))|(value<<shift));},
    setAlgo(ch,algorithm,feedback=0){channel(ch);integer(algorithm,7,'Algorithm');integer(feedback,7,'Feedback');writeRegister(0x20+ch,(registers[0x20+ch]&0xc0)|(feedback<<3)|algorithm);},
    setPan(ch,left,right){channel(ch);writeRegister(0x20+ch,(registers[0x20+ch]&63)|(left?64:0)|(right?128:0));},
    setNote(ch,note){return client.setFrequency(ch,noteToHz(note)).keyCode;},
    setFrequency(ch,hz){channel(ch);const pitch=opmPitchFromHz(hz,clock);client.setPitch(ch,pitch.keyCode,pitch.keyFraction);return pitch;},
    setPitch(ch,keyCode,keyFraction=0){channel(ch);integer(keyCode,127,'Key code');integer(keyFraction,63,'Key fraction');writeRegister(0x28+ch,keyCode);writeRegister(0x30+ch,keyFraction<<2);},
    noteOn(ch,note){client.setNote(ch,note);client.keyOn(ch);},
    keyOn(ch,mask=15){channel(ch);integer(mask,15,'Operator mask');writeRegister(8,ch|(mask<<3));},keyOff(ch){channel(ch);writeRegister(8,ch);},
    _forceKeyOff(ch){channel(ch);send({method:'key-off',channel:ch});},allNotesOff(){for(let ch=0;ch<8;ch++)writeRegister(8,ch);},
    setNoise(enabled,frequency=0){integer(frequency,31,'Noise frequency');writeRegister(15,(enabled?128:0)|frequency);},dispose(){},
  };return client;
}

export function createNativeGenesisX68000(synth,{
  fetcher=globalThis.fetch?.bind(globalThis),decodeAudio=createOfflineAudioDecoder({getSampleRate:()=>synth.clock.sampleRate}),
}={}){
  let nextIdentity=0,version=0;const enabled=new Set(),initialized=new Map();
  const check=()=>{if(!synth.isReady())throw new Error('Native X68000 audio is not ready');if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation,version};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation||token.version!==version)throw abort();};
  const identity=()=>{if(nextIdentity>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native X68000 command identity limit reached');return ++nextIdentity;};
  const timed=(chip,message,timing={})=>({type:'x68000',message:{chip,...message},frame:timing.time===undefined?0:synth.frameAt(timing.time),...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  const send=(chip,message,timing={})=>{check();if(enabled.has(chip))synth.enqueue(timed(chip,message,timing));};
  async function snapshot(chip,args={}){const token=capture(),data=await synth.nativeRequest('native_genesis_x68000_status',args);current(token);const result=data?.[chip];if(!result||typeof result!=='object')throw new Error('Native X68000 returned an invalid snapshot');return {...result,sampleRate:data.sampleRate??result.sampleRate,frame:data.frame??result.frame,revision:data.revision??result.revision};}
  function validatePending(data){if(data.pendingCommands!==undefined&&(!Array.isArray(data.pendingCommands)||data.pendingCommands.some(id=>!Number.isSafeInteger(id)||id<1)))throw new Error('Native X68000 returned invalid pending commands');}
  function validHeld(data,max){if(data.held!==undefined&&(!Array.isArray(data.held)||data.held.some(ch=>!Number.isInteger(ch)||ch<0||ch>max)))throw new Error('Native X68000 returned invalid held channels');validatePending(data);}
  function initialize(chip,client){return async()=>{const token=capture();enabled.add(chip);if(initialized.get(chip)===token.session)return;client.reset();await synth.flush();current(token);initialized.set(chip,token.session);};}
  function mix(chip){return async(volume=1,pan=0)=>{if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid X68000 mix');const token=capture();synth.enqueue(timed(chip,{method:'mix',volume,pan}));await synth.flush();current(token);};}
  function serialize(callback){let serial=Promise.resolve();return async(method,args=[])=>{const token=capture(),copy=structuredClone(args),result=serial.then(()=>{current(token);return callback(method,copy);});serial=result.catch(()=>{});return result;};}

  const opmClient=createOpmClient(message=>send('ym2151',message));
  let opmClock=4000000,opmCollect=null;const opmLeases=new Map();
  const opmInspector=new Ym2151VoiceInspector({clock:()=>opmClock,sampleRate:synth.clock.sampleRate,dispatch(command){if(!opmCollect)throw new Error('YM2151 edit outside collection');opmCollect.push(command);}});
  function adoptOpm(data,adoptClient=false){
    if(!Array.isArray(data.registers)||data.registers.length!==256||data.registers.some(v=>!Number.isInteger(v)||v<0||v>255)||!Array.isArray(data.keyMasks)||data.keyMasks.length!==8||data.keyMasks.some(v=>!Number.isInteger(v)||v<0||v>15))throw new Error('Native YM2151 returned an invalid snapshot');
    validHeld(data,7);opmClock=validateChipClock(data.clock);opmInspector.registers.set(data.registers);opmInspector.keyMasks.set(data.keyMasks);opmInspector.amDepth=integer(data.amDepth??0,127,'AM depth');opmInspector.pmDepth=integer(data.pmDepth??0,127,'PM depth');opmInspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    if(adoptClient)opmClient._adoptState(data);return {...data,...opmInspector.read(),held:data.held??[...opmLeases.keys()]};
  }
  const readOpm=async(args={})=>adoptOpm(await snapshot('ym2151',args));
  const notifyOpm=()=>synth.emit?.({type:'native-state',name:'opm',state:opmClient._getState()});
  async function dispatchOpm(message,timing={}){
    const token=capture(),args=message.args??[];if(!Array.isArray(args))throw new TypeError('YM2151 arguments must be an array');let command,value;
    const method=message.method??message.type;
    if(method==='writeRegister'){command={method:'write',register:integer(args[0],255,'Register'),value:integer(args[1],255,'Value')};}
    else if(method==='clock'){command={method:'clock',hz:validateChipClock(args[0])};}
    else if(method==='forceKeyOff'){command={method:'key-off',channel:integer(args[0],7,'YM2151 channel')};}
    else if(method==='allNotesOff'){for(let ch=0;ch<8;ch++)send('ym2151',{method:'write',register:8,value:ch},timing);}
    else if(method==='reset')command={method:'reset'};
    else if(method==='stopVoices')command={method:'stop-voices'};
    else if(method==='dispose')value=true;
    else throw new Error(`Unsupported Native YM2151 operation: ${method}`);
    if(command)send('ym2151',command,timing);await synth.flush();current(token);
    if(command?.method==='clock'){opmClient._adoptClock(command.hz);notifyOpm();}
    return message.id===undefined?undefined:{id:message.id,...(value===undefined?{}:{value})};
  }
  function opmCommand(command){const [a,b]=command.args??[];if(command.method==='writeRegister')return {method:'write',register:a,value:b};if(command.method==='forceKeyOff')return {method:'key-off',channel:a};if(command.method==='auditionKeyOn')return {method:'write',register:8,value:a|(b<<3)};throw new Error('Invalid YM2151 inspector command');}
  async function invokeOpm(method,args){
    const token=capture();await readOpm();current(token);const previous=new Map(opmInspector.auditions);opmCollect=[];let result,commands;
    try{result=opmInspector.invoke(method,args);commands=opmCollect;}finally{opmCollect=null;}
    const groups=[];
    if(method==='auditionAllOff')for(const [ch]of previous){const lease=opmLeases.get(ch);if(lease)groups.push({method:'batch',channel:ch,voice:lease,audition:true,action:'off',commands:[{method:'key-off',channel:ch}]});opmLeases.delete(ch);}
    else if(method==='auditionOn'||method==='auditionOff'){
      const ch=args[0];if(commands.length){const voice=method==='auditionOn'?identity():opmLeases.get(ch);if(voice){groups.push({method:'batch',channel:ch,voice,audition:true,action:method==='auditionOn'?'on':'off',commands:commands.map(opmCommand)});if(method==='auditionOn')opmLeases.set(ch,voice);else opmLeases.delete(ch);}}
    }else if(commands.length){const channels=new Set(commands.map(command=>nativeVoiceChannel('ym2151',command)).filter(ch=>Number.isInteger(ch)));groups.push({method:'batch',channel:channels.values().next().value??(method==='setNoise'?7:0),audition:true,action:'edit',commands:commands.map(opmCommand)});}
    let last;for(const group of groups){last=identity();send('ym2151',{...group,id:last});}await synth.flush();current(token);if(last){await readOpm({after:last});const state=opmClient._getState();for(const group of groups)for(const command of group.commands)if(command.method==='write')state.registers[command.register]=command.value;opmClient._adoptState(state);notifyOpm();}return result;
  }
  opmClient.setClock=hz=>dispatchOpm({method:'clock',args:[hz]});opmClient._stopVoices=()=>dispatchOpm({method:'stopVoices'});
  opmClient.read=async offset=>{integer(offset,1,'Read offset');return (await readOpm()).status;};opmClient.readStatus=()=>opmClient.read(1);opmClient.getIrq=async()=>!!(await readOpm()).irq;
  const stoppedOpm=()=>{opmInspector.auditions.clear();opmInspector.keyMasks.fill(0);opmLeases.clear();};
  const ym2151={client:opmClient,initialize:initialize('ym2151',opmClient),mix:mix('ym2151'),dispatch:dispatchOpm,read:readOpm,invoke:serialize(invokeOpm),stopped:stoppedOpm,
    adoptStopped(data){stoppedOpm();adoptOpm(data?.ym2151??data,true);},
    reset(){version++;enabled.delete('ym2151');initialized.delete('ym2151');stoppedOpm();opmClock=4000000;opmClient._adoptState({clock:4000000,registers:Array(256).fill(0)});opmInspector.reset();},
  };

  let okiCollect=null,okiClock=8000000,uploadRevision=0;const okiStream={clock:okiClock,divider:512,pan:0,bytes:{length:0},playing:false,streaming:false,repeat:false,position:0,fedBytes:0,_validateRate(clock,divider){if(clock/divider/synth.clock.sampleRate>14)throw new RangeError('OKIM6258 VCLK exceeds the output stream rate');}};
  const okiInspector=new Oki6258VoiceInspector(okiStream,{sampleRate:synth.clock.sampleRate,dispatch(command){if(!okiCollect)throw new Error('OKIM6258 edit outside collection');okiCollect.push(command);}});let okiLease=null;
  const okiClient=new Oki6258Synth({clock:okiClock,transport:{writeRegister(register,value){send('okim6258',{method:'write',register,value});},loadMemory:(bytes,metadata)=>uploadMemory(bytes,metadata),play:options=>send('okim6258',{method:'play',repeat:options.repeat}),stop:()=>send('okim6258',{method:'stop'}),reset:()=>send('okim6258',{method:'reset'})}});
  Object.defineProperty(okiClient,'id',{value:'okim6258',enumerable:true});okiClient.dispose=()=>{};okiClient._adoptClock=hz=>okiClient._adoptHardwareClock(hz);
  const metadataFor=(input,metadata={})=>{
    const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_MEMORY)throw new RangeError('Expected 1 byte to 16 MiB of OKI ADPCM');
    if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new TypeError('Invalid OKIM6258 sample metadata');for(const key of Object.keys(metadata))if(!['name','frames','sampleRate','waveform','source'].includes(key))throw new TypeError('Unknown OKIM6258 sample metadata');
    const name=metadata.name??'OKI ADPCM stream',frames=metadata.frames??bytes.length*2,sampleRate=metadata.sampleRate??okiClient.playbackRate,source=metadata.source??'raw';
    if(typeof name!=='string'||name.length>256)throw new TypeError('Sample name must be at most 256 characters');if(frames!==bytes.length*2&&frames!==bytes.length*2-1)throw new RangeError('Invalid OKIM6258 sample frames');if(!Number.isFinite(sampleRate)||sampleRate<1||sampleRate>1000000)throw new RangeError('Invalid OKIM6258 sample rate');if(!['raw','sample'].includes(source))throw new TypeError('Invalid OKIM6258 sample source');
    const waveform=metadata.waveform??null;if(waveform!==null&&(!Array.isArray(waveform)||!waveform.length||waveform.length>512||waveform.some(v=>!Number.isFinite(v)||Math.abs(v)>1)))throw new RangeError('Invalid OKIM6258 sample waveform');
    return {bytes:bytes.slice(),metadata:{name,frames:bytes.length*2,sampleRate,waveform:waveform?.slice()??[],source}};
  };
  async function uploadMemory(input,metadata={},timing={},signal){
    const token=capture();timing.checkCurrent?.();signal?.throwIfAborted();const staged=metadataFor(input,metadata),sampleId=identity(),revision=++uploadRevision;
    const stillCurrent=()=>{current(token);timing.checkCurrent?.();signal?.throwIfAborted();if(revision!==uploadRevision)throw abort();};
    const prepare={...timing,time:undefined},audition=timing.audition===true;send('okim6258',{method:'memory-begin',sampleId,byteLength:staged.bytes.length,metadata:staged.metadata,...(audition?{audition:true}:{})},prepare);await synth.flush();stillCurrent();
    for(let offset=0;offset<staged.bytes.length;offset+=CHUNK){send('okim6258',{method:'memory-chunk',sampleId,offset,data:Array.from(staged.bytes.subarray(offset,offset+CHUNK)),...(audition?{audition:true}:{})},prepare);await synth.flush();stillCurrent();}
    const commitId=identity();send('okim6258',{method:'memory-commit',sampleId,id:commitId,...(audition?{audition:true}:{})},prepare);await synth.flush();stillCurrent();
    const committed=await snapshot('okim6258',{after:commitId});stillCurrent();if(committed.sampleId!==sampleId)throw new Error('OKIM6258 sample replacement was blocked by a manual audition');
    const sample={...staged.metadata,bytes:staged.bytes.length,frames:staged.bytes.length*2,durationSeconds:staged.bytes.length*2/staged.metadata.sampleRate};okiClient.sample={...sample};okiInspector.resetAudition();okiLease=null;notifyOki();return sample;
  }
  function adoptOki(data,adoptClient=false){
    const clock=validateChipClock(data.clock);if(!OKIM6258_DIVIDERS.includes(data.divider)||!Number.isInteger(data.pan)||data.pan<0||data.pan>3||!Number.isSafeInteger(data.positionFrames??0)||(data.positionFrames??0)<0||!Number.isSafeInteger(data.fedBytes??0)||(data.fedBytes??0)<0)throw new Error('Native OKIM6258 returned an invalid snapshot');validHeld(data,0);
    if(data.sample!==null&&data.sample!==undefined){const sample=data.sample;if(!Number.isInteger(sample.bytes)||sample.bytes<1||sample.bytes>MAX_MEMORY||sample.frames!==sample.bytes*2||!Number.isFinite(sample.sampleRate)||sample.sampleRate<=0||!Number.isFinite(sample.durationSeconds)||sample.durationSeconds<=0||sample.waveform!==null&&sample.waveform!==undefined&&(!Array.isArray(sample.waveform)||sample.waveform.length>512||sample.waveform.some(v=>!Number.isFinite(v)||Math.abs(v)>1)))throw new Error('Native OKIM6258 returned invalid sample metadata');}
    okiClock=clock;Object.assign(okiStream,{clock,divider:data.divider,pan:data.pan,bytes:{length:data.sample?.bytes??0},playing:!!data.playing,streaming:!!data.streaming,repeat:!!data.repeat,position:data.positionFrames??0,fedBytes:data.fedBytes??0});okiInspector.sample=data.sample?structuredClone(data.sample):null;okiInspector.memoryRevision=data.memoryRevision??0;okiInspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    if(adoptClient)okiClient._adoptState({clock,divider:data.divider,pan:data.pan,sample:data.sample??null});return {...data,...okiInspector.read(),held:data.held??(okiLease?[0]:[])};
  }
  const readOki=async(args={})=>adoptOki(await snapshot('okim6258',args));
  const notifyOki=()=>synth.emit?.({type:'native-state',name:'adpcm',state:okiClient._getState()});
  function okiCommand(message){const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('OKIM6258 arguments must be an array');
    if(method==='writeRegister')return {method:'write',register:integer(args[0],12,'Register'),value:integer(args[1],255,'Value')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='play'){const repeat=args[0]?.repeat??false;if(typeof repeat!=='boolean')throw new TypeError('Repeat must be boolean');return {method:'play',repeat};}
    if(method==='setRepeat'){if(typeof args[0]!=='boolean')throw new TypeError('Repeat must be boolean');return {method:'set-repeat',repeat:args[0]};}
    if(['stop','reset'].includes(method))return {method};if(['stopVoices','allNotesOff'].includes(method))return {method:'stop-voices'};
    throw new Error(`Unsupported Native OKIM6258 operation: ${method}`);
  }
  async function dispatchOki(message,timing={}){const token=capture(),method=message.method??message.type,args=message.args??[];let value;
    if(method==='dispose')value=true;
    else if(method==='loadMemory'){if(!Array.isArray(args))throw new TypeError('OKIM6258 arguments must be an array');await uploadMemory(args[0],args[1]??{},timing);}
    else{const command=okiCommand(message);send('okim6258',command,timing);await synth.flush();current(token);if(command.method==='clock'){okiClient._adoptHardwareClock(command.hz);notifyOki();}}
    current(token);return message.id===undefined?undefined:{id:message.id,...(value===undefined?{}:{value})};
  }
  async function invokeOki(method,args){
    const token=capture();await readOki();current(token);const previous=okiInspector.audition;okiCollect=[];let result,commands;
    try{result=okiInspector.invoke(method,args);commands=okiCollect;}finally{okiCollect=null;}
    if(!commands.length)return result;let action='edit',voice=okiLease;
    if(okiInspector.audition!==previous&&okiInspector.audition){action='on';voice=identity();okiLease=voice;}else if(previous&&!okiInspector.audition){action='off';okiLease=null;}
    const id=identity();send('okim6258',{method:'batch',channel:0,audition:true,action,...(voice?{voice}:{}),id,commands:commands.map(okiCommand)});await synth.flush();current(token);await readOki({after:id});const state=okiClient._getState();for(const command of commands.map(okiCommand)){if(command.method==='clock')state.clock=command.hz;if(command.method==='write'&&command.register===2)state.pan=command.value&3;if(command.method==='write'&&command.register===12)state.divider=[1024,768,512,512][command.value&3];}okiClient._adoptState(state);notifyOki();return result;
  }
  okiClient.setClock=hz=>dispatchOki({method:'clock',args:[hz]});okiClient._stopVoices=()=>dispatchOki({method:'stopVoices'});
  const loadSample=async(source,options={},audition=false)=>{
    const token=capture(),{signal}=options;signal?.throwIfAborted();const pcm=await decodeNativeGenesisPCM(source,{fetcher,decodeAudio:options.decodeAudio??decodeAudio});current(token);signal?.throwIfAborted();
    const rate=oki6258Rate(okiClient.clock,options.sampleRate??okiClient.playbackRate),encoded=encodeOki6258(pcm,rate.sampleRate),preview=summarizeOki6258(encoded.bytes);
    // Complete encoding and validation before replacing RAM or the sounding voice.
    const metadata={...preview,name:options.name??'Sample',sampleRate:rate.sampleRate,source:'sample'};metadataFor(encoded.bytes,metadata);signal?.throwIfAborted();
    await uploadMemory(encoded.bytes,metadata,{audition},signal);current(token);signal?.throwIfAborted();okiClient.setDivider(rate.divider);await synth.flush();current(token);notifyOki();return {...encoded,bytes:encoded.bytes.length,name:metadata.name};
  };
  okiClient.loadSample=(source,options)=>loadSample(source,options);
  const stoppedOki=()=>{uploadRevision++;okiInspector.resetAudition();okiLease=null;okiStream.playing=okiStream.streaming=false;};
  const okim6258={client:okiClient,initialize:initialize('okim6258',okiClient),mix:mix('okim6258'),dispatch:dispatchOki,read:readOki,invoke:serialize(invokeOki),loadSample:(source,options)=>loadSample(source,options,true),stopped:stoppedOki,
    adoptStopped(data){stoppedOki();adoptOki(data?.okim6258??data,true);},
    reset(){version++;enabled.delete('okim6258');initialized.delete('okim6258');stoppedOki();okiClock=8000000;okiClient._adoptState({clock:8000000,divider:512,pan:0,sample:null});Object.assign(okiStream,{clock:8000000,divider:512,pan:0,bytes:{length:0},repeat:false,position:0,fedBytes:0});okiInspector.sample=null;okiInspector.memoryRevision=0;},
  };
  return {ym2151,okim6258};
}
