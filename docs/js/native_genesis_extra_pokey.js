import {PokeySynth,POKEY_CLOCK} from './pokeysynth.js?v=pokey-mode-1';
import {createPokeyRegisterClient} from './playground_pokey.js?v=pokey-mode-1';
import {PokeyVoiceInspector} from './playground_pokey_inspector.js?v=pokey-mode-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=pokey-mode-1';
import {validateChipClock} from './playground_chip_clock.js?v=pokey-mode-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray as array} from './native_genesis_voice_endpoint.js?v=pokey-mode-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=pokey-mode-1';

export const EXTRA_POKEY_CLOCK_HELD_ERROR='Release the manually held additional POKEY voices before changing the clock';
/** Callback-owned four-channel POKEY. This endpoint only transfers controls;
 * the raw DSP and speaker DC boundary run entirely in the Native callback. */
export function createNativeGenesisPokeyEndpoint(synth,{clock:initialClock=POKEY_CLOCK,globalName='pokey',primary=false}={}){
  validateChipClock(initialClock);
  const context=createNativeVoiceContext(synth,{backend:'extra-pokey',statusCommand:'native_genesis_extra_pokey_status',label:'additional POKEY'});
  const {capture,current}=context;let clock=initialClock,mainGroup,serial=Promise.resolve(),initialized=false,collect=null;
  const leases=new Map(),identified=message=>({...message,id:context.identity()});
  const send=(message,timing={})=>{context.send('pokey',{...(mainGroup===undefined?{}:{group:mainGroup}),...message},timing);};
  const client=createPokeyRegisterClient((method,args,channel)=>{if(method!=='dispose')send(translate({method,args,channel}));},{clock,request:(method,args)=>dispatch({method,args,id:'local-pokey-request'}).then(reply=>reply?.value)});
  const inspector=new PokeyVoiceInspector({clock:()=>clock,sampleRate:synth.clock.sampleRate,dispatch(command,owner,metadata){if(!collect)throw new Error('POKEY inspector outside edit');collect.push({command,owner,...metadata});}});
  const disposeClient=client.dispose.bind(client);
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}}});
  const notify=()=>synth.emit?.({type:'native-state',name:globalName,state:client._getState()});
  function translate(message){
    const method=message.method??message.type,args=message.args??[];
    if(!Array.isArray(args))throw new TypeError('POKEY arguments must be an array');
    if(method==='writeRegister')return{method:'write',register:integer(args[0],15,'POKEY register'),value:integer(args[1],255,'POKEY value'),...(message.channel===undefined?{}:{channel:integer(message.channel,3,'POKEY channel')})};
    if(method==='keyOff'||method==='forceKeyOff')return{method:'key-off',channel:integer(args[0],3,'POKEY channel')};
    if(method==='setRetainedLevel')return {method:'set-retained-level',channel:integer(args[0],3,'POKEY channel'),level:integer(args[1],15,'POKEY retained level')};
    if(method==='setChannelMuted'){if(typeof args[1]!=='boolean')throw new TypeError('Expected POKEY boolean mute');return {method:'channel-mute',channel:integer(args[0],3,'POKEY channel'),muted:args[1]};}
    if(method==='clock')return{method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset')return{method:'reset'};
    if(['stopVoices','allNotesOff'].includes(method))return{method:'stop-voices'};
    if(method==='setSourceMuteMask')return{method:'source-mute',mask:integer(args[0],15,'POKEY source mute mask')};
    throw new Error(`Unsupported Native POKEY operation: ${method}`);
  }
  function adopt(data){
    validateChipClock(data.clock);array(data.registers,16,255,'POKEY registers');array(data.readRegisters,16,255,'POKEY hardware reads');context.validateHeld(data,3);
    array(data.levels,4,15,'POKEY retained levels');inspector.registers.set(data.registers);inspector.levels=[...data.levels];
    if(data.held)for(const [ch]of leases)if(!data.held.includes(ch)){leases.delete(ch);inspector.auditions.delete(ch);}
    return{...data,...inspector.read(),held:data.held??[...leases.keys()]};
  }
  async function snapshot(args={}){const token=capture();const result=await(args.after===undefined?synth.nativeRequest('native_genesis_extra_pokey_status',args):synth.observeNativeSnapshot('native_genesis_extra_pokey_status',args));current(token);if(!result?.pokey)throw new Error('Native POKEY returned an invalid snapshot');return adopt({...result.pokey,frame:result.frame,revision:result.revision});}
  async function clockCommand(hz,timing={}){validateChipClock(hz);timing.checkCurrent?.();capture();if(hz!==clock)throw new Error('Create a new POKEY instance to change its clock');}

  client.setClock=hz=>clockCommand(hz);
  client._allocateMainOwner=()=>context.identity();client._withMainOwner=(group,callback)=>{const old=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=old;}};
  client._cancelMainOwner=group=>send(identified({method:'cancel-main-owner',targetGroup:group}));
  async function dispatch(message,timing={}){
    const token=capture(),method=message.method??message.type;timing.checkCurrent?.();
    if(method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};
    if(method==='clock'){await clockCommand(message.args?.[0],timing);return message.id===undefined?undefined:{id:message.id,value:true};}
    if(method==='readRegister'){
      const register=integer(message.args?.[0],15,'POKEY register'),m=identified({method:'barrier'});send(m,timing);await synth.flush();current(token);const data=await snapshot({after:m.id});current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id,value:data.readRegisters[register]};
    }
    send(translate(message),timing);await synth.flush();current(token);timing.checkCurrent?.();return message.id===undefined?undefined:{id:message.id,value:true};
  }
  function invoke(method,args=[]){const token=capture(),copy=structuredClone(args);const result=serial.then(async()=>{
    current(token);if(method==='setClock')return clockCommand(copy[0]);await snapshot();current(token);
    const previous=new Map(inspector.auditions),previousLeases=new Map(leases);collect=[];let value,items;
    try{value=inspector.invoke(method,copy);items=collect;}finally{collect=null;}
    const nextLeases=new Map(),voiceFor=new Map(),owner=id=>`voice-editor:${id}`;
    for(const [ch,id]of previous)if(previousLeases.has(ch))voiceFor.set(`${ch}:${owner(id)}`,previousLeases.get(ch));
    for(const [ch,id]of inspector.auditions){const voice=previous.get(ch)===id?previousLeases.get(ch):context.identity();nextLeases.set(ch,voice);voiceFor.set(`${ch}:${owner(id)}`,voice);}
    const groups=[];for(const item of items){const target=nativeVoiceChannel('pokey',item.command);let channel,voice,action='edit';
      if(item.owner){const match=[...inspector.auditions].find(([ch,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||ch===target))??[...previous].find(([ch,id])=>owner(id)===item.owner&&(!Number.isInteger(target)||ch===target));if(!match)throw new Error('Invalid POKEY audition owner');channel=match[0];voice=voiceFor.get(`${channel}:${item.owner}`);action=item.preserveOwner?'edit':inspector.auditions.get(channel)===match[1]?'on':'off';}
      else channel=Number.isInteger(target)?target:0;
      if(action==='off'&&!voice)continue;let group=groups.at(-1);if(!group||group.channel!==channel||group.action!==action||group.voice!==voice){group=identified({method:'batch',channel,...(voice?{voice}:{}),action,audition:true,commands:[]});groups.push(group);}group.commands.push(translate(item.command));
    }
    for(const group of groups)send(group);if(method==='setVolume')send(identified({method:'set-retained-level',channel:Number(copy[0]),level:copy[1]}));await synth.flush();current(token);
    if(groups.length){await snapshot({after:groups.at(-1).id});current(token);leases.clear();for(const [ch,voice]of nextLeases)leases.set(ch,voice);}
    if(!['auditionOn','auditionOff','auditionAllOff'].includes(method)){
      const author=new PokeySynth({clock,transport:{writeRegister(){},reset(){}}});author._adoptState(client._getState());author[method](...copy);client._adoptState(author._getState());author.dispose();notify();
    }
    return value;
  });serial=result.catch(()=>{});return result;}

  return{client,dispatch,read:snapshot,invoke,
    async initialize(){const token=capture();context.enable('pokey');await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid POKEY mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    stopped(){context.invalidate();leases.clear();inspector.resetAuditions();initialized=false;},
    reset(){context.invalidate();context.disable('pokey');leases.clear();inspector.reset();initialized=false;if(!primary)disposeClient();},
    adoptStopped(){const state=client._getState();for(let ch=0;ch<4;ch++)state.registers[ch*2+1]&=240;client._adoptState(state);notify();},
    get initialized(){return initialized;},
  };
}
export function createNativeGenesisExtraPokey(synth,options={}){
  const clock=validateChipClock(options.clock??POKEY_CLOCK);
  return createNativeGenesisExtraChip(synth,{...options,kind:'pokey',label:'POKEY',clock,createArgs:{clock},createEndpoint:facade=>createNativeGenesisPokeyEndpoint(facade,{clock})});
}
