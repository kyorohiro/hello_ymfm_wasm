import {YM2612Synth} from './ym2612synth.js?v=audio-stability-2';
import {createOpnAuditionGuard} from './playground_audition_guard.js?v=audio-numeric-bindings-1';
import {OpnKeyboardInspector} from './playground_opn_inspector.js?v=wonderswan-pcm-timeline-1';
import {validateChipClock,CHIP_CLOCKS} from './playground_chip_clock.js?v=wonderswan-pcm-timeline-1';
import {createNativeVoiceContext,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=wonderswan-pcm-timeline-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=wonderswan-pcm-timeline-1';
import {validateYm2612Engine} from './playground_soundchip_options.js?v=y8950-adpcm-ui-1';

export const EXTRA_YM2612_CLOCK_HELD_ERROR='Release the manually held additional YM2612 voices before changing the clock';
const CLOCK=CHIP_CLOCKS.ym2612;
const channel=value=>typeof value==='string'&&/^fm:[0-5]$/.test(value)?Number(value.slice(3)):integer(value,5,'FM channel');
const EDIT_METHODS=new Set(['setPreset','setOperator','setOperators','setAlgo','setPan','setFrequency','setNote','setBlockFnum','setLfo','setChannel3SpecialMode','setChannel3SpecialFrequency','setDacEnabled','writeDac']);
const GLOBAL_EDITS=new Set(['setLfo','setChannel3SpecialMode','setChannel3SpecialFrequency','setDacEnabled','writeDac']);
const unsupported=feature=>new Error(`${feature} is unavailable for additional Native YM2612 chips`);

function adoptClient(client,state){
  if(state.channels)client.channels=structuredClone(state.channels);
  if(state.modeRegister!==undefined)client._modeRegister=state.modeRegister;
  if(state.lfo)client.lfo=structuredClone(state.lfo);
  if(state.dac)Object.assign(client.dac,state.dac);
}
function appliedState(registers,base){
  const state=structuredClone(base),slots=[0,8,4,12],r0=registers[0],special=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]];
  state.modeRegister=r0[0x27];state.lfo={enabled:!!(r0[0x22]&8),frequency:r0[0x22]&7};state.dac={enabled:!!(r0[0x2b]&128),value:r0[0x2a]};
  for(let ch=0;ch<6;ch++){
    const r=registers[ch<3?0:1],n=ch%3,c=state.channels[ch],pitch=r[0xa4+n],pan=r[0xb4+n];
    Object.assign(c,{algorithm:r[0xb0+n]&7,feedback:r[0xb0+n]>>3&7,block:pitch>>3&7,fnum:(pitch&7)<<8|r[0xa0+n],left:!!(pan&128),right:!!(pan&64),ams:pan>>4&3,pms:pan&7});
    for(let op=0;op<4;op++){const s=slots[op]+n;Object.assign(c.operators[op],{dt:r[0x30+s]>>4&7,multi:r[0x30+s]&15,tl:r[0x40+s]&127,rs:r[0x50+s]>>6&3,ar:r[0x50+s]&31,am:!!(r[0x60+s]&128),d1r:r[0x60+s]&31,d2r:r[0x70+s]&31,sl:r[0x80+s]>>4,rr:r[0x80+s]&15,ssg:r[0x90+s]&15});}
    if(ch===2)c.specialFrequencies=special.map(([lo,hi])=>({block:r0[hi]>>3&7,fnum:(r0[hi]&7)<<8|r0[lo]}));
  }
  return state;
}

/** Independent FM-only endpoint. No Genesis composite/PSG is allocated. */
export function createNativeGenesisYm2612Endpoint(synth,{engine:requestedEngine}={}){
  const engine=validateYm2612Engine(requestedEngine);
  const context=createNativeVoiceContext(synth,{backend:'extra-ym2612',statusCommand:'native_genesis_extra_ym2612_status',label:'additional YM2612'});
  const {capture,current}=context;let clock=CLOCK,appliedClock=CLOCK,initialized=false,collecting=null,uiSerial=Promise.resolve(),clockSerial=Promise.resolve();
  const timed=(message,timing)=>context.timed('ym2612',message,timing);
  const send=(message,timing)=>context.send('ym2612',message,timing);
  const rawWrite=({port,register,value})=>({method:'write',port:integer(port,1,'Port'),register:integer(register,255,'Register'),value:integer(value,255,'Value')});
  const client=new YM2612Synth({clock,transport:{
    write:(port,register,value)=>send(rawWrite({port,register,value})),
    writeBatch:writes=>{const commands=writes.map(rawWrite);if(context.isEnabled('ym2612'))synth.enqueueMany(commands.map(command=>timed(command)));},
    reset:()=>send({method:'reset'}),
    dacCommand:()=>Promise.reject(unsupported('PCM DAC sample playback')),
    loadDacBank:()=>{throw unsupported('DAC bank playback');},playDacBank:()=>{throw unsupported('DAC bank playback');},
    clearDacPlayback:()=>{throw unsupported('DAC bank playback');},
  }});
  const base=client.getState();
  Object.defineProperties(client,{clock:{configurable:true,enumerable:true,get:()=>clock},
    engine:{value:engine,enumerable:true},
    _getState:{value:()=>({...client.getState(),clock,engine})},
    _adoptClock:{value:hz=>{clock=validateChipClock(hz);}},
    _adoptState:{value:state=>{if(state?.engine!==undefined&&state.engine!==engine)throw new Error('Native additional YM2612 returned an incompatible sound engine');if(state?.clock!==undefined)client._adoptClock(state.clock);if(state)adoptClient(client,state);}},
  });
  let inspector;
  const chip={writeRegister(register,value,port=0){if(!collecting)throw new Error('YM2612 inspector command outside an edit');collecting.push(rawWrite({port,register,value}));inspector?.observe(register,value,port);},reset(){}};
  const guard=createOpnAuditionGuard(chip,6);
  inspector=new OpnKeyboardInspector(chip,{kind:'ym2612',guard,clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000});
  const notify=()=>synth.emit?.({type:'native-state',name:'fm',state:client._getState()});
  function adopt(data){
    if(data.engine!==engine&&(data.engine!==undefined||engine==='nuked'))throw new Error('Native additional YM2612 returned an incompatible sound engine');
    if(!Array.isArray(data.registers)||data.registers.length!==2)throw new Error('Native additional YM2612 returned invalid registers');
    for(const row of data.registers)nativeSnapshotArray(row,256,255,'YM2612 registers');
    nativeSnapshotArray(data.keyMasks,6,15,'YM2612 key masks');context.validateHeld(data,5);
    integer(data.status,255,'Status');if(typeof data.irq!=='boolean')throw new Error('Native additional YM2612 returned invalid IRQ');
    appliedClock=validateChipClock(data.clock);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    data.registers.forEach((r,p)=>inspector.registers[p].set(r));
    return {...data,...inspector.read(),engine,registers:data.registers.map(row=>row.slice()),fmState:appliedState(data.registers,base),held:(data.held??[...inspector.held.keys()].map(channel)).map(ch=>`fm:${ch}`)};
  }
  const snapshot=async(args={})=>{const data=await context.snapshot('ym2612',args);adopt(data);return data;};
  const read=async(args={})=>adopt(await snapshot(args));
  client.read=async offset=>{integer(offset,3,'Read offset');if(offset!==0)throw new Error('Native YM2612 supports status reads at offset 0');const data=await snapshot();client._notifyRead(0,data.status);client.hooks.onIrq?.(data.irq);return data.status;};
  client.readStatus=()=>client.read(0);client.getIrq=async()=>!!(await snapshot()).irq;
  const identified=message=>({...message,id:context.identity()});
  function translate(message){
    const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('YM2612 arguments must be an array');
    if(method==='write'||method==='rawWrite')return rawWrite(message.type==='write'?message:{port:args[0],register:args[1],value:args[2]});
    if(method==='reset')return {method:'reset'};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],5,'FM channel')};
    if(method==='cancelCsm')return {method:'cancel-csm'};
    if(method==='stopVoices'||method==='clear-auditions')return {method:'stop-voices'};
    if(method==='source-mute'||method==='channel-mute')return {method,mask:integer(message.mask??args[0],method==='source-mute'?1:63,'Mute mask')};
    throw unsupported(`Operation ${method}`);
  }
  function clockCommand(hz,timing={},reply){
    const token=capture();validateChipClock(hz);timing.checkCurrent?.();
    const result=clockSerial.then(async()=>{
      current(token);timing.checkCurrent?.();await synth.flush();current(token);timing.checkCurrent?.();
      const command=identified({method:'clock',hz});send(command,timing);await synth.flush();current(token);timing.checkCurrent?.();
      const data=await snapshot({after:command.id});current(token);timing.checkCurrent?.();
      if(data.clock!==hz)throw new Error('Native additional YM2612 clock was not applied');
      client._adoptClock(hz);notify();return reply?.();
    });clockSerial=result.catch(()=>{});return result;
  }
  client.setClock=hz=>clockCommand(hz);
  async function dispatch(message,timing={}){
    const token=capture();timing.checkCurrent?.();
    if(Array.isArray(message)){
      const commands=message.map(translate);synth.enqueueMany(commands.map(command=>timed(command,timing)));await synth.flush();current(token);timing.checkCurrent?.();return;
    }
    const method=message.method??message.type,args=message.args??[];if(!Array.isArray(args))throw new TypeError('YM2612 arguments must be an array');
    if(method==='clock'||method==='chip-clock')return clockCommand(validateChipClock(method==='clock'?args[0]:message.clock),timing,()=>message.id===undefined?undefined:{id:message.id,...(method==='chip-clock'?{type:'chip-clock-result',clock:client.clock}:{})});
    let value;
    if(method==='dispose')value=true;
    else if(method==='read'||method==='readStatus'||method==='getIrq'){
      if(method==='read')integer(args[0],3,'Read offset');if(method==='read'&&args[0]!==0)throw new Error('Native YM2612 supports status reads at offset 0');
      const data=await snapshot();current(token);timing.checkCurrent?.();value=method==='getIrq'?data.irq:data.status;
    }else{send(translate(message),timing);await synth.flush();current(token);timing.checkCurrent?.();}
    return message.id===undefined?undefined:{id:message.id,...(value===undefined?{}:{value})};
  }
  client._stopVoices=()=>dispatch({method:'stopVoices'});
  client._forceKeyOff=ch=>{integer(ch,5,'FM channel');send({method:'key-off',channel:ch});if(ch===2)client._modeRegister&=~0x81;if(ch===5)client.dac.enabled=false;};
  client._cancelCsm=()=>{send({method:'cancel-csm'});client._modeRegister&=~0x81;};
  function stopped(){const previous=collecting;collecting=[];try{guard.handle({type:'clear-auditions'});}finally{collecting=previous;inspector.held.clear();}}
  function editedClient(state,method,args,commands=[]){
    const staged=new YM2612Synth({clock:appliedClock,transport:{write:(port,register,value)=>commands.push(rawWrite({port,register,value}))}});
    adoptClient(staged,state);staged[method](...args);return staged.getState();
  }
  function invoke(method,args=[]){
    const token=capture(),copy=structuredClone(args),result=uiSerial.then(async()=>{
      current(token);const applied=await read();current(token);let value,commands,groups=[],patch;
      if(EDIT_METHODS.has(method)){
        const editArgs=[...copy];if(!GLOBAL_EDITS.has(method))editArgs[0]=channel(editArgs[0]);
        commands=[];editedClient(applied.fmState,method,editArgs,commands);patch=editedClient(client.getState(),method,editArgs);
        const ch=GLOBAL_EDITS.has(method)?['setDacEnabled','writeDac'].includes(method)?5:['setChannel3SpecialFrequency','setChannel3SpecialMode'].includes(method)?2:0:editArgs[0];
        if(commands.length)groups.push(identified({method:'batch',channel:ch,audition:true,action:'edit',commands}));
      }else{
        if(!['auditionOn','auditionOff','auditionAllOff'].includes(method))throw unsupported(`Inspector operation ${method}`);
        const previous=new Map(inspector.held);collecting=[];try{value=inspector.invoke(method,copy);commands=collecting;}finally{collecting=null;}
        if(method==='auditionAllOff')for(const [name,lease]of previous)groups.push(identified({method:'batch',channel:channel(name),voice:lease.token,audition:true,action:'off',commands:[{method:'key-off',channel:channel(name)}]}));
        else{const ch=channel(copy[0]),lease=(method==='auditionOn'?inspector.held:previous).get(`fm:${ch}`);if(commands.length&&lease)groups.push(identified({method:'batch',channel:ch,voice:lease.token,audition:true,action:method==='auditionOn'?'on':'off',commands}));}
      }
      for(const group of groups)send(group);await synth.flush();current(token);
      if(groups.length){await read({after:groups.at(-1).id});current(token);if(patch){client._adoptState(patch);notify();}}
      return value;
    });uiSerial=result.catch(()=>{});return result;
  }
  return {client,dispatch,read,invoke,
    // Older Native hosts ignore unknown create arguments. Confirm Nuked before
    // publishing its client rather than silently playing their ymfm default.
    async initialize(){const token=capture();context.enable('ym2612');if(initialized)return;client.reset();await synth.flush();current(token);if(engine==='nuked'){await snapshot();current(token);}initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid YM2612 mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){context.invalidate();context.disable('ym2612');initialized=false;stopped();appliedClock=CLOCK;client._adoptState({...base,clock:CLOCK});},
  };
}

export function createNativeGenesisExtraYm2612(synth,options={}){
  const engine=validateYm2612Engine(options.engine);
  return createNativeGenesisExtraChip(synth,{...options,kind:'ym2612',label:engine==='nuked'?'YM2612 (Nuked)':'YM2612',engine,clock:CLOCK,createArgs:{engine},createEndpoint:facade=>createNativeGenesisYm2612Endpoint(facade,{engine})});
}
