import {Huc6280Synth,HUC6280_CLOCK} from './huc6280synth.js?v=audio-stability-2';
import {Huc6280VoiceInspector} from './playground_huc6280_inspector.js?v=audio-numeric-bindings-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-extra-stability-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-stability-1';

export const EXTRA_HUC6280_CLOCK_HELD_ERROR='Release the manually held additional HuC6280 voices before changing the clock';
const matrix=(value,rows,columns,max,label)=>{if(!Array.isArray(value)||value.length!==rows)throw new Error(`Native additional HuC6280 returned invalid ${label}`);for(const row of value)nativeSnapshotArray(row,columns,max,label);};
/** Independent six-channel PSG, wave RAM and LFO. Applied reads never replace
 * the author's future register projection or advance hardware pointers. */
export function createNativeGenesisExtraHuc6280Endpoint(synth,{clock:initialClock=HUC6280_CLOCK}={}){
  validateChipClock(initialClock);
  const context=createNativeVoiceContext(synth,{backend:'extra-huc6280',statusCommand:'native_genesis_extra_huc6280_status',label:'additional HuC6280'});
  const {capture,current}=context;let clock=initialClock,appliedClock=clock,initialized=false,mainGroup,collection=null,serial=Promise.resolve(),clockSerial=Promise.resolve();
  const leases=new Map(),operations=new Set(),identified=message=>({...message,id:context.identity()});
  const send=(message,timing,...scope)=>context.send('huc6280',{...((scope.length?scope[0]:mainGroup)===undefined?{}:{group:scope.length?scope[0]:mainGroup}),...message},timing);
  function translate(message){
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError('HuC6280 arguments must be an array');
    if(method==='writeRegister')return {method:'write',register:integer(args[0],9,'HuC6280 register'),value:integer(args[1],255,'HuC6280 value'),...(message.channel===undefined?{}:{channel:integer(message.channel,7,'HuC6280 channel')})};
    if(method==='setWaveform'){const samples=Array.from(args[1]??[]);nativeSnapshotArray(samples,32,31,'HuC6280 waveform');return {method:'waveform',channel:integer(args[0],5,'HuC6280 channel'),samples};}
    if(method==='keyOff')return {method:'key-off',channel:integer(args[0],5,'HuC6280 channel')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset')return {method:'reset'};
    if(['stopVoices','allNotesOff'].includes(method))return {method:'stop-voices'};
    if(method==='setSourceMuteMask')return {method:'source-mute',mask:integer(args[0],63,'HuC6280 source mute mask')};
    throw new Error(`Unsupported Native additional HuC6280 operation: ${method}`);
  }
  const client=new Huc6280Synth({clock,transport:{writeRegister:(register,value,channel)=>send({method:'write',register,value,channel}),reset:()=>send({method:'reset'})}});
  const disposeClient=client.dispose.bind(client);
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}}});
  const inspector=new Huc6280VoiceInspector({clock:()=>appliedClock,sampleRate:synth.clock.sampleRate,dispatch(command,owner,options){if(!collection)throw new Error('HuC6280 inspector command outside an edit');collection.push({command,owner,...options});}});
  const notify=authorEdit=>synth.emit?.({type:'native-state',name:'pce',state:client._getState(),...(authorEdit?{authorEdit}:{})});
  function adopt(data){
    appliedClock=validateChipClock(data.clock);integer(data.selectedChannel,7,'HuC6280 selected channel');nativeSnapshotArray(data.globals,10,255,'HuC6280 globals');matrix(data.registers,8,8,255,'HuC6280 registers');matrix(data.waveforms,8,32,31,'HuC6280 waveforms');nativeSnapshotArray(data.indices,8,31,'HuC6280 indices');nativeSnapshotArray(data.ddaValues,8,31,'HuC6280 DDA');context.validateHeld(data,5);
    inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;inspector.selected=data.selectedChannel;inspector.globals.set(data.globals);inspector.indices.set(data.indices);inspector.ddaValues.set(data.ddaValues);
    for(let ch=0;ch<8;ch++){inspector.registers[ch].set(data.registers[ch]);inspector.waveforms[ch].set(data.waveforms[ch]);}
    for(const field of ['pointerKnown','waveformKnown']){if(data[field]!==undefined&&(!Array.isArray(data[field])||data[field].length!==8||data[field].some(value=>typeof value!=='boolean')))throw new Error(`Native additional HuC6280 returned invalid ${field}`);inspector[field].set(data[field]?.map(Number)??Array(8).fill(1));}
    if(data.knownSamples!==undefined){nativeSnapshotArray(data.knownSamples,8,0xffffffff,'HuC6280 known samples');inspector.knownSamples.set(data.knownSamples);}
    if(data.held)for(const channel of leases.keys())if(!data.held.includes(channel)){leases.delete(channel);inspector.auditions.delete(channel);}
    return {...data,...inspector.read(),held:data.held??[...leases.keys()]};
  }
  async function snapshot(args={}){let data;if(args.after===undefined)data=await context.snapshot('huc6280',args);else{const token=capture(),result=await synth.observeNativeSnapshot('native_genesis_extra_huc6280_status',args);current(token);if(!result?.huc6280||typeof result.huc6280!=='object')throw new Error('Native additional HuC6280 returned an invalid snapshot');data={...result.huc6280,sampleRate:result.sampleRate??result.huc6280.sampleRate,frame:result.frame??result.huc6280.frame,revision:result.revision??result.huc6280.revision};}adopt(data);return data;}
  const read=async(args={})=>adopt(await snapshot(args));
  const cancel=matches=>{for(const operation of operations)if(matches(operation))operation.cancelled=true;};
  function clockCommand(hz,timing={}){
    validateChipClock(hz);const token=capture(),operation={group:mainGroup,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(operation);
    const check=()=>{current(token);timing.checkCurrent?.();if(operation.cancelled)throw new DOMException('Native additional HuC6280 clock was cancelled','AbortError');};
    const result=clockSerial.then(async()=>{check();await synth.flush();check();const edit=identified({method:'clock',hz,...(operation.group===undefined?{}:{group:operation.group})});send(edit,timing,operation.group);await synth.flush();check();const applied=await snapshot({after:edit.id});check();if(applied.clock!==hz)throw new Error('Native additional HuC6280 clock was not applied');client._adoptClock(hz);notify({clock:hz});}).finally(()=>operations.delete(operation));clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  client._allocateMainOwner=()=>context.identity();client._withMainOwner=(group,callback)=>{const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{cancel(operation=>operation.group===group);send(identified({method:'cancel-main-owner',targetGroup:group}));};
  client._stopVoices=async()=>{const token=capture();send(identified({method:'stop-voices'}));await synth.flush();current(token);};
  function dispatch(message,timing={}){const token=capture(),method=message.method??message.type;timing.checkCurrent?.();if(method==='clock')return {deferred:clockCommand(message.args?.[0],timing).then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id};})};if(method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};send(translate(message),timing);return synth.flush().then(()=>{current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id};});}
  function patchClient(method,args){
    const state=client._getState(),commands=[],author=new Huc6280VoiceInspector({clock:()=>clock,dispatch:command=>commands.push(command)});
    author.selected=state.selectedChannel;author.globals.set(state.globals);author.indices.set(state.indices);for(let ch=0;ch<8;ch++){author.registers[ch].set(state.registers[ch]);author.waveforms[ch].set(state.waveforms[ch]);}author.invoke(method,args);
    const patch={globals:[],registers:[],waveforms:[],indices:[]},valuePatch=method==='setVoice'?args[1]:args[0];
    for(const command of commands){
      if(command.method==='setWaveform'){const [channel,samples]=command.args;state.waveforms[channel]=Array.from(samples);state.indices[channel]=0;patch.waveforms.push([channel,Array.from(samples)]);patch.indices.push([channel,0]);continue;}
      if(command.method!=='writeRegister')continue;const [register,value]=command.args,channel=command.channel;let mask=255;
      if(method==='setMasterVolume')mask=('left'in valuePatch?240:0)|('right'in valuePatch?15:0);
      if(method==='setLfo'&&register===9)mask=('depth'in valuePatch?3:0)|('reset'in valuePatch?128:0);
      if((method==='setFrequency'||method==='setNote')&&register===3)mask=15;
      if(method==='setVoice'){
        if(register===4)mask=('volume'in valuePatch?31:0)|('dda'in valuePatch?192:0)|('ddaValue'in valuePatch?128:0);
        if(register===5)mask=('left'in valuePatch.pan?240:0)|('right'in valuePatch.pan?15:0);
        if(register===3)mask=15;
        if(register===7)mask=('enabled'in valuePatch.noise?128:0)|('frequency'in valuePatch.noise?31:0);
      }
      if([1,8,9].includes(register)){state.globals[register]=(state.globals[register]&~mask)|(value&mask);patch.globals.push([register,state.globals[register],mask]);}
      else if(Number.isInteger(channel)){state.registers[channel][register]=(state.registers[channel][register]&~mask)|(value&mask);patch.registers.push([channel,register,state.registers[channel][register],mask]);}
    }
    client._adoptState(state);return patch;
  }
  function invoke(method,args=[]){const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
    current(token);if(method==='setClock')return clockCommand(copy[0]);await read();current(token);const previous=new Map(inspector.auditions),previousLeases=new Map(leases);collection=[];let value,collected;
    try{value=inspector.invoke(method,copy);collected=collection;}finally{collection=null;}
    const nextLeases=new Map(),ownerVoices=new Map(),owner=id=>`voice-editor:${id}`;for(const [channel,id]of previous)if(previousLeases.has(channel))ownerVoices.set(`${channel}:${owner(id)}`,previousLeases.get(channel));for(const [channel,id]of inspector.auditions){const voice=previous.get(channel)===id?previousLeases.get(channel):context.identity();nextLeases.set(channel,voice);ownerVoices.set(`${channel}:${owner(id)}`,voice);}
    const groups=[];for(const item of collected){const target=nativeVoiceChannel('huc6280',item.command);let channel,action='edit',voice;
      if(item.owner){const match=[...inspector.auditions].find(([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||key===target))??[...previous].find(([key,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||key===target));if(!match)throw new Error('Invalid HuC6280 audition owner');channel=match[0];action=item.preserveOwner===true?'edit':inspector.auditions.get(channel)===match[1]?'on':'off';voice=ownerVoices.get(`${channel}:${item.owner}`);}else channel=Number.isInteger(target)?target:0;
      if(action==='off'&&!voice)continue;let group=groups.at(-1);if(group?.method!=='batch'||group.channel!==channel||group.action!==action||group.voice!==voice){group=identified({method:'batch',channel,audition:true,action,...(voice?{voice}:{}),commands:[]});groups.push(group);}group.commands.push(translate(item.command));
    }
    for(const group of groups)send(group);await synth.flush();current(token);if(groups.length){const applied=await read({after:groups.at(-1).id});current(token);leases.clear();for(const [channel,voice]of nextLeases)if(applied.held.includes(channel))leases.set(channel,voice);else inspector.auditions.delete(channel);if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))notify(patchClient(method,copy));}return value;
  });serial=result.catch(()=>{});return result;}
  return {client,dispatch,read,invoke,cancelOwner:(performance,owner)=>cancel(operation=>operation.performance===performance&&operation.owner===owner),cancelPerformance:performance=>cancel(operation=>operation.performance!==undefined&&(performance===null||operation.performance===performance)),
    async initialize(){const token=capture();context.enable('huc6280');if(initialized)return;await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid HuC6280 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){cancel(()=>true);context.invalidate();context.disable('huc6280');initialized=false;mainGroup=undefined;leases.clear();inspector.reset();disposeClient();},
  };
}
export function createNativeGenesisExtraHuc6280(synth,options={}){return createNativeGenesisExtraChip(synth,{...options,kind:'huc6280',label:'HuC6280',clock:HUC6280_CLOCK,createEndpoint:createNativeGenesisExtraHuc6280Endpoint});}
