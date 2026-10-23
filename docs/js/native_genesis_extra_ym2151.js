import {createYm2151RegisterClient} from './playground_ym2151.js?v=native-extra-gameboy-1';
import {Ym2151VoiceInspector} from './playground_ym2151_inspector.js?v=audio-numeric-bindings-1';
import {validateChipClock,CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-msx-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-gameboy-1';

export const EXTRA_YM2151_CLOCK_HELD_ERROR='Release the manually held additional YM2151 voices before changing the clock';
const CLOCK=CHIP_CLOCKS.ym2151;

/** Independent OPM. Public operators retain the register order M1,C1,M2,C2;
 * the shared voice inspector presents the algorithm order M1,M2,C1,C2. */
export function createNativeGenesisYm2151Endpoint(synth){
  const context=createNativeVoiceContext(synth,{backend:'extra-ym2151',statusCommand:'native_genesis_extra_ym2151_status',label:'additional YM2151'});
  const {capture,current}=context;let clock=CLOCK,appliedClock=CLOCK,initialized=false,collection=null,serial=Promise.resolve(),clockSerial=Promise.resolve(),mainGroup,mainCsmGroup;
  const leases=new Map();
  function tagged(message){const value={...(mainGroup===undefined?{}:{group:mainGroup}),...message};if(value.method==='write'&&value.register===0x14)mainCsmGroup=(value.value&0x81)===0x81?value.group:undefined;return value;}
  const send=(message,timing)=>context.send('ym2151',tagged(message),timing),timed=(message,timing)=>context.timed('ym2151',tagged(message),timing);
  const identified=message=>({...message,id:context.identity()});
  function translate(message){
    const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('YM2151 arguments must be an array');
    if(method==='writeRegister')return {method:'write',register:integer(args[0],255,'Register'),value:integer(args[1],255,'Value')};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],7,'YM2151 channel')};
    if(method==='auditionKeyOn')return {method:'audition-key-on',channel:integer(args[0],7,'YM2151 channel'),mask:integer(args[1],15,'Operator mask')};
    if(method==='allNotesOff')return {method:'all-notes-off'};
    if(method==='reset')return {method:'reset'};
    if(method==='stopVoices')return {method:'stop-voices'};
    throw new Error(`Unsupported Native additional YM2151 operation: ${method}`);
  }
  const client=createYm2151RegisterClient((method,args)=>send(translate({method,args})),{clock:CLOCK});
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}}});
  const notify=()=>synth.emit?.({type:'native-state',name:'opm',state:client._getState()});
  const inspector=new Ym2151VoiceInspector({clock:()=>appliedClock,sampleRate:synth.clock.sampleRate,dispatch(command){if(!collection)throw new Error('YM2151 inspector command outside an edit');collection.push(command);}});
  function adopt(data){
    nativeSnapshotArray(data.registers,256,255,'YM2151 registers');nativeSnapshotArray(data.keyMasks,8,15,'YM2151 key masks');context.validateHeld(data,7);
    if(typeof data.irq!=='boolean')throw new Error('Native additional YM2151 returned invalid IRQ');integer(data.status,255,'Status');
    appliedClock=validateChipClock(data.clock);inspector.registers.set(data.registers);inspector.keyMasks.set(data.keyMasks);inspector.amDepth=integer(data.amDepth,127,'AM depth');inspector.pmDepth=integer(data.pmDepth,127,'PM depth');inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    return {...data,...inspector.read(),held:data.held??[...leases.keys()]};
  }
  const snapshot=async(args={})=>{const data=await context.snapshot('ym2151',args);adopt(data);return data;},read=async(args={})=>adopt(await snapshot(args));
  function clockCommand(hz,timing={},reply){
    const token=capture();validateChipClock(hz);timing.checkCurrent?.();
    const result=clockSerial.then(async()=>{current(token);timing.checkCurrent?.();await synth.flush();current(token);timing.checkCurrent?.();const command=identified({method:'clock',hz});send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();const data=await snapshot({after:command.id});current(token);timing.checkCurrent?.();if(data.clock!==hz)throw new Error('Native additional YM2151 clock was not applied');client._adoptClock(hz);notify();return reply?.();});clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  client._stopVoices=()=>dispatch({method:'stopVoices'});
  client._allocateMainOwner=()=>context.identity();
  client._withMainOwner=(group,callback)=>{const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}};
  client._cancelMainOwner=group=>{send(identified({method:'cancel-main-owner',targetGroup:group}));if(mainCsmGroup===group){const state=client._getState();state.registers[0x14]&=~0x81;client._adoptState(state);mainCsmGroup=undefined;}};
  async function dispatch(message,timing={}){
    const token=capture();timing.checkCurrent?.();
    if(Array.isArray(message)){const commands=message.map(translate);synth.enqueueMany(commands.map(command=>timed(command,timing)));await synth.flush();current(token);timing.checkCurrent?.();return;}
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError('YM2151 arguments must be an array');
    if(method==='clock')return clockCommand(args[0],timing,()=>message.id===undefined?undefined:{id:message.id});
    if(method!=='dispose'){send(translate(message),timing);await synth.flush();current(token);timing.checkCurrent?.();}
    return message.id===undefined?undefined:{id:message.id,...(method==='dispose'?{value:true}:{})};
  }
  function authorPatch(method,args){
    const state=client._getState();let staged;
    staged=new Ym2151VoiceInspector({clock:()=>clock,dispatch(command){if(command.method==='writeRegister')staged.observeWrite(...command.args);}});staged.registers.set(state.registers);staged.invoke(method,args);return {...state,registers:Array.from(staged.registers)};
  }
  function invoke(method,args=[]){
    const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
      current(token);await read();current(token);const previous=new Map(inspector.auditions),previousLeases=new Map(leases);let value,commands;collection=[];
      try{value=inspector.invoke(method,copy);commands=collection;}finally{collection=null;}
      const groups=[],nextLeases=new Map(leases),audition=['auditionOn','auditionOff','auditionAllOff'].includes(method),patch=audition?null:authorPatch(method,copy);
      if(method==='auditionAllOff')for(const [channel]of previous){const voice=previousLeases.get(channel);if(voice)groups.push(identified({method:'batch',channel,voice,audition:true,action:'off',commands:[{method:'key-off',channel}]}));nextLeases.delete(channel);}
      else if(method==='auditionOn'||method==='auditionOff'){
        const channel=integer(copy[0],7,'YM2151 channel');if(commands.length){const voice=method==='auditionOn'?context.identity():previousLeases.get(channel);if(voice){groups.push(identified({method:'batch',channel,voice,audition:true,action:method==='auditionOn'?'on':'off',commands:commands.map(translate)}));if(method==='auditionOn')nextLeases.set(channel,voice);else nextLeases.delete(channel);}}
      }else for(const command of commands){const target=nativeVoiceChannel('ym2151',command),channel=Number.isInteger(target)?target:method==='setNoise'?7:0;let group=groups.at(-1);if(!group||group.channel!==channel){group=identified({method:'batch',channel,audition:true,action:'edit',commands:[]});groups.push(group);}group.commands.push(translate(command));}
      for(const group of groups)send(group);await synth.flush();current(token);if(groups.length){await read({after:groups.at(-1).id});current(token);leases.clear();for(const [ch,voice]of nextLeases)leases.set(ch,voice);if(patch){client._adoptState(patch);notify();}}return value;
    });serial=result.catch(()=>{});return result;
  }
  return {client,read,invoke,dispatch,
    async initialize(){const token=capture();context.enable('ym2151');if(initialized)return;await synth.flush();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid YM2151 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){context.invalidate();context.disable('ym2151');initialized=false;mainGroup=mainCsmGroup=undefined;leases.clear();inspector.reset();appliedClock=CLOCK;client._adoptState({clock:CLOCK,registers:Array(256).fill(0)});},
  };
}
export function createNativeGenesisExtraYm2151(synth,options={}){
  return createNativeGenesisExtraChip(synth,{...options,kind:'ym2151',label:'YM2151',clock:CLOCK,createEndpoint:createNativeGenesisYm2151Endpoint});
}
