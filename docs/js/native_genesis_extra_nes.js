import {NesApuSynth} from './nesapusynth.js?v=nes-wasm-1';
import {NES_APU_CLOCK,validateNesApuClock} from './nesapu.js?v=nes-wasm-1';
import {NesVoiceInspector} from './playground_native_voice_inspector.js?v=y8950-adpcm-ui-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=y8950-adpcm-ui-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=y8950-adpcm-ui-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=y8950-adpcm-ui-1';

export const EXTRA_NES_CLOCK_HELD_ERROR='Release the manually held additional NES voices before changing the clock';
export const EXTRA_NES_ADMISSION_ERRORS=Object.freeze(['Native additional NES upload batch exceeds 64 KiB','Native additional NES pending uploads exceed 1 MiB across the shared rack','Native NES pending command limit reached (8 MiB)']);
export const EXTRA_NES_MEMORY_HELD_ERROR='Release the manually held additional NES DMC voice before replacing sample memory';
const abort=()=>new DOMException('Native additional NES operation was cancelled','AbortError');
const validClock=hz=>{if(Number.isInteger(hz))return validateChipClock(hz);validateNesApuClock(hz);return hz;};
const register=value=>{integer(value,0x408a,'NES address');if(!((value>=0x4000&&value<=0x4017)||value===0x4023||(value>=0x4040&&value<=0x408a)))throw new RangeError('Unsupported NES address');return value;};

/** Independent APU, DMC RAM and optional FDS. Applied reads never overwrite the
 * author's projected future registers or issue another trigger. */
export function createNativeGenesisExtraNesEndpoint(synth,{clock:initialClock=NES_APU_CLOCK,fds=false}={}){
  validateNesApuClock(initialClock);if(typeof fds!=='boolean')throw new TypeError('fds must be boolean');
  const context=createNativeVoiceContext(synth,{backend:'extra-nes',statusCommand:'native_genesis_extra_nes_status',label:'additional NES'});
  const {capture,current}=context;let clock=initialClock,appliedClock=clock,initialized=false,mainGroup,collection=null,serial=Promise.resolve(),clockSerial=Promise.resolve(),memorySerial=Promise.resolve(),pendingBytes=0,pendingUploads=0;
  const leases=new Map(),operations=new Set(),identified=message=>({...message,id:context.identity()});
  const send=(message,timing,...scope)=>context.send('nes',{...((scope.length?scope[0]:mainGroup)===undefined?{}:{group:scope.length?scope[0]:mainGroup}),...message},timing);
  function translate(message){
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError('NES arguments must be an array');
    if(method==='writeRegister')return {method:'write',address:register(args[0]),value:integer(args[1],255,'NES value')};
    if(method==='setChannelEnabled'){if(typeof args[1]!=='boolean')throw new TypeError('NES enabled must be boolean');return {method:'enable',channel:integer(args[0],4,'NES channel'),enabled:args[1]};}
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='configureFds')return {method:'batch',channel:5,action:'edit',commands:[],fdsGain:integer(args[0],32,'FDS gain'),fdsMaster:integer(args[1],3,'FDS master')};
    if(method==='reset')return {method:'reset'};
    if(['stopVoices','allNotesOff'].includes(method))return {method:'stop-voices'};
    if(method==='setSourceMuteMask')return {method:'source-mute',mask:integer(args[0],63,'NES source mute mask')};
    throw new Error(`Unsupported Native additional NES operation: ${method}`);
  }
  function operation(timing={},group=mainGroup){const token=capture(),op={group,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(op);op.check=()=>{current(token);timing.checkCurrent?.();if(op.cancelled)throw abort();};return op;}
  const cancel=matches=>{for(const op of operations)if(matches(op))op.cancelled=true;};
  const client=new NesApuSynth({clock,fds,initialize:false,transport:{clock,fdsEnabled:fds,writeRegister:(...args)=>send(translate({method:'writeRegister',args})),setChannelEnabled:(...args)=>send(translate({method:'setChannelEnabled',args})),configureFds:(...args)=>send(translate({method:'configureFds',args})),reset:()=>send({method:'reset'}),loadMemory:(bytes,address)=>memory(bytes,address)}});
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validClock(hz);}}});
  const inspector=new NesVoiceInspector({clock:initialClock,fdsEnabled:fds,writeRegister(){},reset(){},loadMemory(){}},{clock:()=>appliedClock,sampleRate:synth.clock.sampleRate,dispatch(command,owner){if(!collection)throw new Error('NES inspector command outside an edit');collection.push({command,owner});}});
  const notify=authorEdit=>synth.emit?.({type:'native-state',name:'nes',state:client._getState(),...(authorEdit?{authorEdit}:{})});
  function adopt(data){
    validClock(data.clock);nativeSnapshotArray(data.registers,0x90,255,'NES registers');nativeSnapshotArray(data.modulation,32,7,'FDS modulation');context.validateHeld(data,fds?5:4);
    if(!Number.isInteger(data.enabled)||data.enabled<0||data.enabled>31||!Number.isInteger(data.fdsGain)||data.fdsGain<0||data.fdsGain>32||!Number.isInteger(data.fdsMaster)||data.fdsMaster<0||data.fdsMaster>3||!Array.isArray(data.memoryRanges)||data.memoryRanges.length>65536||data.memoryRanges.some(range=>!Number.isInteger(range?.address)||!Number.isInteger(range.end)||range.address<0||range.end<range.address||range.end>65536))throw new Error('Native additional NES returned an invalid snapshot');
    appliedClock=data.clock;inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.registers.set(data.registers);inspector.enabled=data.enabled;inspector.fdsGain=data.fdsGain;inspector.fdsMaster=data.fdsMaster;inspector.modTable.set(data.modulation);inspector.memoryRanges=data.memoryRanges.map(range=>({...range}));
    if(data.held)for(const channel of leases.keys())if(!data.held.includes(channel)){leases.delete(channel);inspector.auditions.delete(channel);}
    const result={...data,...inspector.read(),held:data.held??[...leases.keys()]};if(typeof data.dmcActive==='boolean')result.channels[4].active=result.dmc.active=data.dmcActive;if(fds&&typeof data.fdsActive==='boolean')result.channels[5].active=result.fds.active=data.fdsActive;
    if(Array.isArray(data.gates))for(let i=0;i<Math.min(data.gates.length,result.channels.length);i++)if(typeof data.gates[i]==='boolean')result.channels[i].active=data.gates[i];return result;
  }
  async function snapshot(args={}){let data;if(args.after===undefined)data=await context.snapshot('nes',args);else{const token=capture(),result=await synth.observeNativeSnapshot('native_genesis_extra_nes_status',args);current(token);if(!result?.nes||typeof result.nes!=='object')throw new Error('Native additional NES returned an invalid snapshot');data={...result.nes,sampleRate:result.sampleRate??result.nes.sampleRate,frame:result.frame??result.nes.frame,revision:result.revision??result.nes.revision};}adopt(data);return data;}
  const read=async(args={})=>adopt(await snapshot(args));
  function memory(input,address=0,timing={}){
    const op=operation(timing),bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
    try{op.check();if(!(bytes instanceof Uint8Array)||!Number.isInteger(address)||address<0||address+bytes.length>65536)throw new RangeError('Invalid NES RAM range');if(pendingUploads>=256||pendingBytes+bytes.length>32*1024*1024)throw new RangeError('Native NES upload queue is full');}catch(error){operations.delete(op);return Promise.reject(error);}
    const data=Array.from(bytes);pendingUploads++;pendingBytes+=data.length;
    const result=memorySerial.then(async()=>{op.check();const edit=identified({method:'memory',offset:address,data,...(op.group===undefined?{}:{group:op.group})});send(edit,{...timing,time:undefined},op.group);await synth.flush();op.check();await snapshot({after:edit.id});op.check();}).finally(()=>{operations.delete(op);pendingUploads--;pendingBytes-=data.length;});memorySerial=result.catch(()=>{});return result;
  }
  function clockCommand(hz,timing={}){validateChipClock(hz);const op=operation(timing),result=clockSerial.then(async()=>{op.check();await synth.flush();op.check();const edit=identified({method:'clock',hz,...(op.group===undefined?{}:{group:op.group})});send(edit,timing,op.group);await synth.flush();op.check();const applied=await snapshot({after:edit.id});op.check();if(applied.clock!==hz)throw new Error('Native additional NES clock was not applied');client._adoptClock(hz);notify({clock:hz});}).finally(()=>operations.delete(op));clockSerial=result.catch(()=>{});return result;}
  client.setClock=hz=>clockCommand(hz);client.dispose=()=>{};
  client._allocateMainOwner=()=>context.identity();client._withMainOwner=(group,callback)=>{const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{cancel(op=>op.group===group);send(identified({method:'cancel-main-owner',targetGroup:group}));};
  client._stopVoices=async()=>{const token=capture();send(identified({method:'stop-voices'}));await synth.flush();current(token);};
  function dispatch(message,timing={}){const token=capture(),method=message.method??message.type,args=message.args??[];timing.checkCurrent?.();if(method==='clock'||method==='loadMemory')return {deferred:(method==='clock'?clockCommand(args[0],timing):memory(args[0],args[1]??0,timing)).then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id};})};if(method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};send(translate(message),timing);return synth.flush().then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id};});}
  function patchClient(method,args){
    const state=client._getState(),author=new NesVoiceInspector({clock:initialClock,fdsEnabled:fds,writeRegister(){},reset(){},loadMemory(){}},{clock:()=>clock,dispatch:command=>commands.push(command)}),commands=[];
    author.registers.set(state.registers);author.enabled=state.enabled;author.fdsGain=state.fdsGain;author.fdsMaster=state.fdsMaster;author.modTable.set(inspector.modTable);author.memoryRanges=inspector.memoryRanges.map(range=>({...range}));author.invoke(method,args);
    const patch={registers:[]};for(const command of commands){if(command.method==='writeRegister'){const [address,value]=command.args,index=address-0x4000;let mask=255;
      const valuePatch=args[method==='setPulseVoice'?1:0]??{};
      if(method==='setPulseVoice'){const base=args[0]*4;if(index===base){mask=0;if('duty'in valuePatch)mask|=0xc0;if('volume'in valuePatch)mask|=0x1f;if('envelope'in valuePatch)mask|=0x3f;if('lengthHalt'in valuePatch)mask|=0x20;}else if(index===base+1&&valuePatch.sweep){mask=0;for(const [key,bits]of [['enabled',128],['period',112],['negate',8],['shift',7]])if(key in valuePatch.sweep)mask|=bits;}else if(index===base+3)mask=('frequency'in valuePatch?7:0)|('lengthIndex'in valuePatch?248:0);}
      else if(method==='setTriangleVoice'){if(index===8)mask=('linearReload'in valuePatch?127:0)|('lengthHalt'in valuePatch?128:0);if(index===11)mask=('frequency'in valuePatch?7:0)|('lengthIndex'in valuePatch?248:0);}
      else if(method==='setNoiseVoice'){if(index===12)mask=('volume'in valuePatch?31:0)|('envelope'in valuePatch?63:0)|('lengthHalt'in valuePatch?32:0);if(index===14)mask=('period'in valuePatch?15:0)|('shortMode'in valuePatch?128:0);if(index===15)mask='lengthIndex'in valuePatch?248:0;}
      else if(method==='setFrequency'&&index===(args[0]===5?0x83:args[0]*4+3))mask=args[0]===5?15:7;
      else if(method==='setDmcVoice'&&index===16){mask=('rate'in valuePatch?15:0)|('loop'in valuePatch?64:0);}
      else if(method==='setFdsVolume'&&index===0x89)mask=3;
      if(method==='setFdsModulation'){if(index===0x87)mask=('rate'in valuePatch?15:0)|('enabled'in valuePatch?128:0)|('table'in valuePatch?143:0);if(index===0x85)mask=127;}
      if(index===0x23)mask=2;
      if(index===0x89&&method==='setFdsWave')mask=0;
      if(index===0x83&&method==='setFdsWave')mask=0;
      if(!mask)continue;state.registers[index]=(state.registers[index]&~mask)|(value&mask);patch.registers.push([index,state.registers[index],mask]);
      if(address===0x4015){state.enabled=value&31;patch.enabled={value:state.enabled,mask:31};}if(address===0x4083){state.fdsActive=!(state.registers[index]&128);if(mask&128)patch.fdsActive=state.fdsActive;}
    }else if(command.method==='setChannelEnabled'){const [channel,enabled]=command.args,bit=1<<channel;state.enabled=enabled?state.enabled|bit:state.enabled&~bit;state.registers[0x15]=(state.registers[0x15]&~bit)|(state.enabled&bit);patch.enabled={value:state.enabled,mask:(patch.enabled?.mask??0)|bit};}}
    if(method==='setFdsVolume'){const value=args[0];if(typeof value!=='object'||'gain'in value){state.fdsGain=author.fdsGain;patch.fdsGain=state.fdsGain;}if(typeof value!=='object'||'master'in value){state.fdsMaster=author.fdsMaster;patch.fdsMaster=state.fdsMaster;}}client._adoptState(state);return patch;
  }
  function invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
    current(token);await read();current(token);const previous=new Map(inspector.auditions),previousLeases=new Map(leases);collection=[];let value,collected;try{value=inspector.invoke(method,copy);collected=collection;}finally{collection=null;}
    const nextLeases=new Map(),ownerVoices=new Map(),owner=id=>`voice-editor:${id}`;for(const [channel,id]of previous)if(previousLeases.has(channel))ownerVoices.set(`${channel}:${owner(id)}`,previousLeases.get(channel));for(const [channel,id]of inspector.auditions){const voice=previous.get(channel)===id?previousLeases.get(channel):context.identity();nextLeases.set(channel,voice);ownerVoices.set(`${channel}:${owner(id)}`,voice);}
    const groups=[];for(const item of collected){const target=nativeVoiceChannel('nes',item.command);let channel,action='edit',voice;if(item.owner){const match=[...inspector.auditions].find(([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||key===target))??[...previous].find(([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||key===target));if(!match)throw new Error('Invalid NES audition owner');channel=match[0];action=inspector.auditions.get(channel)===match[1]?'on':'off';voice=ownerVoices.get(`${channel}:${item.owner}`);}else channel=Number.isInteger(target)?target:method.startsWith('setFds')?5:0;if(action==='off'&&!voice)continue;let group=groups.at(-1);if(group?.method!=='batch'||group.channel!==channel||group.action!==action||group.voice!==voice){group=identified({method:'batch',channel,audition:true,action,...(voice?{voice}:{}),commands:[],...(channel===5?{fdsGain:inspector.fdsGain,fdsMaster:inspector.fdsMaster}:{})});groups.push(group);}group.commands.push(translate(item.command));}
    for(const group of groups)send(group);await synth.flush();current(token);if(groups.length){const applied=await read({after:groups.at(-1).id});current(token);leases.clear();for(const [channel,voice]of nextLeases)if(applied.held.includes(channel))leases.set(channel,voice);else inspector.auditions.delete(channel);if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))notify(patchClient(method,copy));}return value;
  });serial=result.catch(()=>{});return result;}
  return {client,dispatch,read,invoke,cancelOwner:(performance,owner)=>cancel(op=>op.performance===performance&&op.owner===owner),cancelPerformance:performance=>cancel(op=>op.performance!==undefined&&(performance===null||op.performance===performance)),async initialize(){const token=capture();context.enable('nes');if(initialized)return;client.reset();await synth.flush();current(token);initialized=true;},async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid NES mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},reset(){cancel(()=>true);context.invalidate();context.disable('nes');initialized=false;mainGroup=undefined;leases.clear();inspector.reset();}};
}
export function createNativeGenesisExtraNes(synth,options={}){const {clock=NES_APU_CLOCK,fds=false}=options;validateNesApuClock(clock);if(typeof fds!=='boolean')throw new TypeError('fds must be boolean');return createNativeGenesisExtraChip(synth,{...options,kind:'nes',label:fds?'NES + FDS':'NES',clock,createArgs:{clock,fds},layout:{fdsEnabled:fds},createEndpoint:value=>createNativeGenesisExtraNesEndpoint(value,{clock,fds})}).then(device=>{device.fdsEnabled=fds;return device;});}
