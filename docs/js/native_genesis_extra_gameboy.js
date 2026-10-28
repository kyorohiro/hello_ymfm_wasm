import {GameboySynth} from './gameboysynth.js?v=audio-stability-2';
import {GAMEBOY_APU_CLOCK} from './gameboyapu.js?v=audio-stability-2';
import {GameboyVoiceInspector} from './playground_native_voice_inspector.js?v=ps1-mode-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=ps1-voice-editor-1';
import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=ps1-mode-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=ps1-native-1';

export const EXTRA_GAMEBOY_CLOCK_HELD_ERROR='Release the manually held additional Game Boy voices before changing the clock';
const TRIGGERS=[4,9,14,19],DACS=[2,7,10,17];
/** Independent callback-owned APU. Public writes retain authoring state; explicit
 * reads inspect applied state without replaying triggers or changing that cache. */
export function createNativeGenesisExtraGameboyEndpoint(synth){
  const context=createNativeVoiceContext(synth,{backend:'extra-gameboy',statusCommand:'native_genesis_extra_gameboy_status',label:'additional Game Boy'});
  const {capture,current}=context;let clock=GAMEBOY_APU_CLOCK,appliedClock=clock,initialized=false,mainGroup,collection=null,serial=Promise.resolve(),clockSerial=Promise.resolve();
  const leases=new Map(),owners=new Map(),clockRequests=new Set();
  const identified=message=>({...message,id:context.identity()});
  const send=(message,timing)=>{
    const tagged={...(mainGroup===undefined?{}:{group:mainGroup}),...message};
    if(tagged.method==='write'){
      const channel=TRIGGERS.indexOf(tagged.address),dac=DACS.indexOf(tagged.address);
      if(channel>=0&&(tagged.value&128))owners.set(channel,tagged.group);
      if(dac>=0&&!(tagged.value&(dac===2?128:248))&&(tagged.group===undefined||owners.get(dac)===tagged.group))owners.delete(dac);
      if(tagged.address===22&&!(tagged.value&128))owners.clear();
    }else if(tagged.method==='reset'||tagged.method==='stop-voices')owners.clear();
    context.send('gameboy',tagged,timing);
  };
  function translate(message){
    const method=message.method??message.type,args=message.args??[];
    if(!Array.isArray(args))throw new TypeError('Game Boy arguments must be an array');
    if(method==='writeRegister')return {method:'write',address:integer(args[0],47,'Game Boy register'),value:integer(args[1],255,'Game Boy value')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset')return {method:'reset'};
    if(['stopVoices','allNotesOff'].includes(method))return {method:'stop-voices'};
    if(method==='setSourceMuteMask')return {method:'source-mute',mask:integer(args[0],15,'Game Boy source mute mask')};
    throw new Error(`Unsupported Native additional Game Boy operation: ${method}`);
  }
  const client=new GameboySynth({clock,transport:{writeRegister:(address,value)=>send({method:'write',address,value}),reset:()=>send({method:'reset'})}});
  const disposeClient=client.dispose.bind(client);
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}}});
  const inspector=new GameboyVoiceInspector({writeRegister(){},reset(){}},{clock:()=>appliedClock,sampleRate:synth.clock.sampleRate,dispatch(command,owner){if(!collection)throw new Error('Game Boy inspector command outside an edit');collection.push({command,owner});}});
  const notify=authorEdit=>synth.emit?.({type:'native-state',name:'gameboy',state:client._getState(),...(authorEdit?{authorEdit}:{})});
  function adopt(data){
    nativeSnapshotArray(data.registers,48,255,'Game Boy registers');nativeSnapshotArray(data.voice,48,255,'Game Boy voice');context.validateHeld(data,3);
    if(!Array.isArray(data.gates)||data.gates.length!==4||data.gates.some(value=>typeof value!=='boolean'))throw new Error('Native additional Game Boy returned invalid gates');
    appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.registers.set(data.registers);inspector.voice.set(data.voice);inspector.gates=data.gates.slice();
    if(data.held)for(const channel of leases.keys())if(!data.held.includes(channel)){leases.delete(channel);inspector.auditions.delete(channel);}
    return {...data,...inspector.read(),held:data.held??[...leases.keys()]};
  }
  async function snapshot(args={}){
    let data;if(args.after===undefined)data=await context.snapshot('gameboy',args);else{const token=capture(),result=await synth.observeNativeSnapshot('native_genesis_extra_gameboy_status',args);current(token);if(!result?.gameboy||typeof result.gameboy!=='object')throw new Error('Native additional Game Boy returned an invalid snapshot');data={...result.gameboy,sampleRate:result.sampleRate??result.gameboy.sampleRate,frame:result.frame??result.gameboy.frame,revision:result.revision??result.gameboy.revision};}
    adopt(data);return data;
  }
  const read=async(args={})=>adopt(await snapshot(args));
  function clockCommand(hz,timing={},reply){
    validateChipClock(hz);const token=capture(),request={group:mainGroup,performance:timing.performance,owner:timing.owner,cancelled:false};timing.checkCurrent?.();clockRequests.add(request);
    const check=()=>{current(token);timing.checkCurrent?.();if(request.cancelled)throw new DOMException('Native additional Game Boy clock was cancelled','AbortError');};
    const result=clockSerial.then(async()=>{check();await synth.flush();check();const edit=identified({method:'clock',hz,...(request.group===undefined?{}:{group:request.group})});send(edit,timing);await synth.flush();check();const applied=await snapshot({after:edit.id});check();if(applied.clock!==hz)throw new Error('Native additional Game Boy clock was not applied');client._adoptClock(hz);notify({clock:hz});return reply?.();}).finally(()=>clockRequests.delete(request));clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  client._allocateMainOwner=()=>context.identity();
  client._withMainOwner=(group,callback)=>{const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{for(const request of clockRequests)if(request.group===group)request.cancelled=true;send(identified({method:'cancel-main-owner',targetGroup:group}));const state=client._getState();for(const [channel,owner]of owners)if(owner===group){state.registers[DACS[channel]]=0;owners.delete(channel);}client._adoptState(state);};
  client._stopVoices=async()=>{const token=capture();send(identified({method:'stop-voices'}));await synth.flush();current(token);};
  function dispatch(message,timing={}){
    const token=capture(),method=message.method??message.type;timing.checkCurrent?.();
    if(method==='clock')return {deferred:clockCommand(message.args?.[0],timing,()=>message.id===undefined?undefined:{id:message.id})};
    if(method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};
    send(translate(message),timing);return synth.flush().then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id};});
  }
  function patchClient(_collected,method,args){
    const state=client._getState(),patch={registers:[],voice:[]},authored=[];
    const author=new GameboyVoiceInspector({writeRegister(){},reset(){}},{clock:()=>clock,dispatch:command=>authored.push(command)});
    author.registers.set(state.registers);author.voice.set(state.voice);if(!(author.registers[22]&128)&&(inspector.registers[22]&128))author.registers[22]=128;author.invoke(method,args);
    const maskFor=address=>{
      if(method==='setMasterVolume')return 0x77;
      if(method==='setFrequency')return address===args[0]*5+4?7:255;
      if(method!=='setVoice')return 255;
      const [channel,value]=args,base=channel*5;
      if(address===21)return (1<<channel)|(16<<channel);
      if(address>=32)return 255;
      if(address===10&&channel===2)return 128;
      let mask=0;
      if(address===base+1){if('duty'in value)mask|=0xc0;if('lengthCount'in value&&channel!==2)mask|=63;}
      if(address===11&&channel===2&&'lengthCount'in value)mask|=255;
      if(address===base+2){if('volume'in value)mask|=0xf0;if(value.envelope){if('direction'in value.envelope)mask|=8;if('period'in value.envelope)mask|=7;}if(channel===2&&'level'in value)mask|=0x60;}
      if(address===0&&value.sweep){if('direction'in value.sweep)mask|=8;if('period'in value.sweep)mask|=0x70;if('shift'in value.sweep)mask|=7;}
      if(address===18){if('divisor'in value)mask|=7;if('shift'in value)mask|=0xf0;if('width'in value)mask|=8;}
      if('frequency'in value){if(address===base+3)mask|=255;if(address===base+4)mask|=7;}
      if('lengthEnabled'in value&&address===base+4)mask|=0xc0;
      return mask||255;
    };
    for(const command of authored){if(command.method!=='writeRegister')continue;const [address,value]=command.args;
      if(address===22&&!(value&128)){state.initialized=false;state.registers.fill(0,0,23);state.voice.fill(0,0,23);for(let i=0;i<23;i++){patch.registers.push([i,0]);patch.voice.push([i,0]);}patch.initialized=false;}
      else{const mask=maskFor(address),register=TRIGGERS.includes(address)?value&127:value;state.registers[address]=(state.registers[address]&~mask)|(register&mask);state.voice[address]=(state.voice[address]&~mask)|(author.voice[address]&mask);patch.registers.push([address,state.registers[address],mask]);patch.voice.push([address,state.voice[address],mask]);if(address===22)patch.initialized=state.initialized=!!(value&128);}
    }
    client._adoptState(state);return patch;
  }
  function invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
    current(token);await read();current(token);const previous=new Map(inspector.auditions),previousLeases=new Map(leases);collection=[];let value,collected;
    try{if(method==='setPower'&&copy[0]===false)inspector.invoke('auditionAllOff');value=inspector.invoke(method,copy);collected=collection;}finally{collection=null;}
    const nextLeases=new Map(),ownerVoices=new Map(),owner=id=>`voice-editor:${id}`;
    for(const [channel,id]of previous)if(previousLeases.has(channel))ownerVoices.set(`${channel}:${owner(id)}`,previousLeases.get(channel));
    for(const [channel,id]of inspector.auditions){const voice=previous.get(channel)===id?previousLeases.get(channel):context.identity();nextLeases.set(channel,voice);ownerVoices.set(`${channel}:${owner(id)}`,voice);}
    const groups=[];
    for(const item of collected){const target=nativeVoiceChannel('gameboy',item.command);let channel,action='edit',voice;
      if(item.owner){const matches=([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||key===target),match=[...inspector.auditions].find(matches)??[...previous].find(matches);if(!match)throw new Error('Invalid Game Boy audition owner');channel=match[0];action=inspector.auditions.get(channel)===match[1]?'on':'off';voice=ownerVoices.get(`${channel}:${item.owner}`);}
      else channel=Number.isInteger(target)?target:Number.isInteger(copy[0])&&method==='setVoice'?copy[0]:0;
      if(action==='off'&&!voice)continue;
      const command=translate(item.command);
      // NR52 is a global power edit. Do not hide it inside a channel lease.
      if(command.method==='write'&&command.address===22){groups.push(identified({...command,audition:true}));continue;}
      let group=groups.at(-1);if(group?.method!=='batch'||group.channel!==channel||group.action!==action||group.voice!==voice){group=identified({method:'batch',channel,audition:true,action,...(voice?{voice}:{}),commands:[]});groups.push(group);}group.commands.push(command);
    }
    for(const group of groups)send(group);await synth.flush();current(token);
    if(groups.length){const applied=await read({after:groups.at(-1).id});current(token);leases.clear();for(const [channel,voice]of nextLeases)if(applied.held.includes(channel))leases.set(channel,voice);else inspector.auditions.delete(channel);if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))notify(patchClient(collected,method,copy));}
    return value;
  });serial=result.catch(()=>{});return result;}
  const cancel=matches=>{for(const request of clockRequests)if(matches(request))request.cancelled=true;};
  return {client,dispatch,read,invoke,cancelOwner:(performance,owner)=>cancel(request=>request.performance===performance&&request.owner===owner),cancelPerformance:performance=>cancel(request=>request.performance!==undefined&&(performance===null||request.performance===performance)),
    async initialize(){const token=capture();context.enable('gameboy');if(initialized)return;await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid Game Boy mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){cancel(()=>true);context.invalidate();context.disable('gameboy');initialized=false;mainGroup=undefined;leases.clear();owners.clear();inspector.reset();disposeClient();},
  };
}
export function createNativeGenesisExtraGameboy(synth,options={}){return createNativeGenesisExtraChip(synth,{...options,kind:'gameboy',label:'Game Boy',clock:GAMEBOY_APU_CLOCK,createEndpoint:createNativeGenesisExtraGameboyEndpoint});}
