/** Game Boy / PC Engine controls for callback-owned Native cores; no audio graph. */
import {GameboySynth} from './gameboysynth.js?v=audio-stability-2';
import {GAMEBOY_APU_CLOCK} from './gameboyapu.js?v=audio-stability-2';
import {Huc6280Synth,HUC6280_CLOCK} from './huc6280synth.js?v=audio-stability-2';
import {GameboyVoiceInspector} from './playground_native_voice_inspector.js?v=ps1-deferred-release-1';
import {Huc6280VoiceInspector} from './playground_huc6280_inspector.js?v=ps1-deferred-release-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=scsp-native-1';
import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';

const integer=(v,max,name)=>{if(!Number.isInteger(v)||v<0||v>max)throw new RangeError(`Invalid Native ${name}`);return v;};
const bytes=(values,length,max,name)=>{if(!Array.isArray(values)||values.length!==length||values.some(v=>!Number.isInteger(v)||v<0||v>max))throw new Error(`Native console returned invalid ${name}`);return values;};
const matrix=(value,rows,columns,max,name)=>{if(!Array.isArray(value)||value.length!==rows)throw new Error(`Native console returned invalid ${name}`);for(const row of value)bytes(row,columns,max,name);return value;};

export function createNativeGenesisConsole(synth,kind){
  if(!['gameboy','huc6280'].includes(kind))throw new Error('Unsupported Native console');
  const gameboy=kind==='gameboy',baseClock=gameboy?GAMEBOY_APU_CLOCK:HUC6280_CLOCK;
  let clock=baseClock,appliedClock=baseClock,nextVoice=0,nextCommand=0,collecting=null,phase='edit',uiSerial=Promise.resolve();
  const held=new Map();
  const abort=()=>new DOMException(`Native ${kind} operation was cancelled`,'AbortError');
  const check=()=>{if(!synth.isReady())throw new Error(`Native ${kind} audio is not ready`);if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation)throw abort();};
  const timed=(message,timing={})=>({type:kind,message,frame:timing.time===undefined?0:synth.frameAt(timing.time),
    ...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  function normalize(method,args=[],metadata={}){
    if(!Array.isArray(args))throw new TypeError(`${kind} arguments must be an array`);
    if(method==='writeRegister'){
      const register=integer(args[0],gameboy?47:9,`${kind} register`),value=integer(args[1],255,`${kind} value`);
      if(gameboy)return {method:'write',address:register,value};
      return {method:'write',register,value,...(metadata.channel===undefined?{}:{channel:integer(metadata.channel,7,'HuC6280 channel')})};
    }
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset')return {method:'reset'};
    if(['stopVoices','allNotesOff'].includes(method))return {method:'stop-voices'};
    if(!gameboy&&method==='keyOff')return {method:'key-off',channel:integer(args[0],5,'HuC6280 channel')};
    if(!gameboy&&method==='setWaveform'){
      const samples=Array.from(args[1]??[]);bytes(samples,32,31,'HuC6280 waveform');
      return {method:'waveform',channel:integer(args[0],5,'HuC6280 channel'),samples};
    }
    throw new Error(`Unsupported Native ${kind} operation: ${method}`);
  }
  function send(method,args=[],timing={},metadata={}){check();const message=normalize(method,args,metadata);synth.enqueue(timed(message,timing));return message;}
  const notify=()=>synth.emit({type:'native-state',name:gameboy?'gameboy':'pce',state:client._getState()});
  const transport={writeRegister:(register,value,channel)=>send('writeRegister',[register,value],{},{channel}),reset:()=>send('reset')};
  const client=gameboy?new GameboySynth({transport,clock}):new Huc6280Synth({transport,clock});
  Object.defineProperties(client,{id:{value:kind,enumerable:true},clock:{configurable:true,enumerable:true,get:()=>clock},
    _adoptClock:{value:value=>{clock=validateChipClock(value);}},
    _stopVoices:{value:async()=>{if(synth.stopping)return synth.stopping;if(synth.closing||!synth.isReady())return;await dispatch({method:'stopVoices'});}},
  });
  client.setClock=async hz=>{const token=capture();send('clock',[hz]);await synth.flush();current(token);clock=hz;notify();};
  client.dispose=()=>{};
  const options={clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000,
    dispatch:(command,owner)=>{if(!collecting)throw new Error(`Native ${kind} inspector command outside an edit`);collecting.push({command,owner,action:!gameboy&&phase==='edit'&&command.method==='keyOff'?'off':phase});},
    beginAudition:(channel,owner)=>{if(nextVoice>=Number.MAX_SAFE_INTEGER)throw new RangeError(`Native ${kind} audition lease limit reached`);held.set(channel,{owner,voice:++nextVoice});},endAudition(){},
  };
  const inspector=gameboy?new GameboyVoiceInspector({writeRegister(){},reset(){}},options):new Huc6280VoiceInspector(options);
  function adopt(snapshot,{adoptClient=false}={}){
    validateChipClock(snapshot?.clock);appliedClock=snapshot.clock;inspector.sampleRate=synth.clock.sampleRate;
    if(gameboy){
      bytes(snapshot.registers,48,255,'Game Boy registers');bytes(snapshot.voice,48,255,'Game Boy voice');
      if(!Array.isArray(snapshot.gates)||snapshot.gates.length!==4||snapshot.gates.some(v=>typeof v!=='boolean'))throw new Error('Native console returned invalid Game Boy gates');
      inspector.registers.set(snapshot.registers);inspector.voice.set(snapshot.voice);inspector.gates=snapshot.gates.slice();
      if(adoptClient){clock=snapshot.clock;client._adoptState({clock,initialized:!!(snapshot.registers[22]&128),registers:snapshot.registers,voice:snapshot.voice});notify();}
    }else{
      integer(snapshot.selectedChannel,7,'HuC6280 selected channel');bytes(snapshot.globals,10,255,'HuC6280 globals');matrix(snapshot.registers,8,8,255,'HuC6280 registers');matrix(snapshot.waveforms,8,32,31,'HuC6280 waveforms');bytes(snapshot.indices,8,31,'HuC6280 indices');bytes(snapshot.ddaValues,8,31,'HuC6280 DDA');
      for(const field of ['pointerKnown','waveformKnown'])if(!Array.isArray(snapshot[field])||snapshot[field].length!==8||snapshot[field].some(v=>typeof v!=='boolean'))throw new Error(`Native console returned invalid HuC6280 ${field}`);
      bytes(snapshot.knownSamples,8,0xffffffff,'HuC6280 known samples');
      inspector.selected=snapshot.selectedChannel;inspector.globals.set(snapshot.globals);inspector.indices.set(snapshot.indices);inspector.ddaValues.set(snapshot.ddaValues);inspector.pointerKnown.set(snapshot.pointerKnown.map(Number));inspector.waveformKnown.set(snapshot.waveformKnown.map(Number));inspector.knownSamples.set(snapshot.knownSamples);
      for(let channel=0;channel<8;channel++){inspector.registers[channel].set(snapshot.registers[channel]);inspector.waveforms[channel].set(snapshot.waveforms[channel]);}
      if(adoptClient){clock=snapshot.clock;client._adoptState({...snapshot,clock,initialized:snapshot.initialized!==false});notify();}
    }
    return inspector.read();
  }
  /** @param {{after?:number}} [options] */
  async function read({after}={}){const token=capture(),snapshot=await synth.nativeRequest(`native_genesis_${kind}_status`,after===undefined?{}:{after});current(token);return adopt(snapshot);}
  async function dispatch(message,timing={}){
    const token=capture();if(message.method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};
    const normalized=send(message.method,message.args??[],timing,message);await synth.flush();current(token);
    if(normalized.method==='clock')clock=normalized.hz;
    if(normalized.method==='stop-voices'&&timing.performance===undefined){held.clear();inspector.resetAuditions();if(!gameboy){const state=client._getState();for(const row of state.registers)row[4]&=127;client._adoptState(state);}}
    return message.id===undefined?undefined:{id:message.id,value:true};
  }
  function targetFor(method,args){if(['auditionOn','auditionOff','setVoice','setFrequency','setNote','setWaveform'].includes(method))return args[0];return null;}
  function patchClient(commands,method,args){
    const state=client._getState();
    if(gameboy){
      for(const {command}of commands)if(command.method==='writeRegister'){
        const [address,value]=command.args;
        if(address===22&&!(value&128)){state.initialized=false;state.registers.fill(0,0,23);state.voice.fill(0,0,23);}
        else if(address===21&&method==='setVoice'){
          const mask=(1<<args[0])|(16<<args[0]);state.registers[21]=(state.registers[21]&~mask)|(value&mask);state.voice[21]=(state.voice[21]&~mask)|(inspector.voice[21]&mask);
        }else{state.registers[address]=[4,9,14,19].includes(address)?value&127:value;state.voice[address]=inspector.voice[address];if(address===22)state.initialized=!!(value&128);}
      }
    }else{
      for(const {command}of commands){
        if(command.method==='writeRegister'){
          const [register,value]=command.args,channel=command.channel;
          if([1,8,9].includes(register))state.globals[register]=value;
          else if(register===0){state.selectedChannel=value&7;state.globals[0]=value;}
          else if(Number.isInteger(channel)){state.registers[channel][register]=value;if(register===6&&!(state.registers[channel][4]&64)){state.waveforms[channel]=Array.from(inspector.waveforms[channel]);state.indices[channel]=inspector.indices[channel];}}
        }else if(command.method==='setWaveform'){const[channel,samples]=command.args;state.waveforms[channel]=Array.from(samples);state.indices[channel]=inspector.indices[channel];}
        else if(command.method==='keyOff')state.registers[command.args[0]][4]&=127;
      }
    }
    client._adoptState(state);
  }
  async function invoke(method,args){
    const token=capture();await read();current(token);const commands=[],leases=new Map(held);collecting=commands;let result;
    try{
      // Explicit power-off also ends manual UI notes. Script/global writes keep
      // the callback's normal protection of held voices.
      if(gameboy&&method==='setPower'&&args[0]===false){phase='off';inspector.invoke('auditionAllOff');}
      phase=method==='auditionOn'?'on':['auditionOff','auditionAllOff'].includes(method)?'off':'edit';result=inspector.invoke(method,args);
    }finally{collecting=null;phase='edit';}
    const selected=targetFor(method,args),groups=[];
    for(const {command,owner,action}of commands){
      const normalized=normalize(command.method,command.args,command);let channel=nativeVoiceChannel(kind,command);
      if(channel==='all')channel=selected??[...held].find(([,lease])=>lease.owner===owner)?.[0]??[...leases].find(([,lease])=>lease.owner===owner)?.[0];
      if(!Number.isInteger(channel)||(gameboy&&normalized.method==='write'&&normalized.address===22)||!['write','waveform','key-off'].includes(normalized.method)){groups.push(normalized);continue;}
      const lease=held.get(channel)??leases.get(channel),manual=!!lease&&lease.owner===owner;
      const previous=groups.at(-1),voice=manual?lease.voice:undefined;
      if(previous?.method==='batch'&&previous.channel===channel&&previous.voice===voice&&previous.action===action)previous.commands.push(normalized);
      else groups.push({method:'batch',commands:[normalized],channel,...(manual?{audition:true,voice}:{}),action});
    }
    if(nextCommand+groups.length>Number.MAX_SAFE_INTEGER)throw new RangeError(`Native ${kind} command identity limit reached`);
    for(const message of groups)message.id=++nextCommand;
    synth.enqueueMany(groups.map(message=>timed(message)));await synth.flush();current(token);
    for(const [channel,lease]of held)if(`voice-editor:${inspector.auditions.get(channel)}`!==lease.owner)held.delete(channel);
    const snapshot=await read({after:groups.at(-1)?.id});
    if(commands.length){patchClient(commands,method,args);if(commands.some(({command})=>command.method==='clock')){clock=appliedClock;client._adoptClock(clock);notify();}}
    return ['auditionOn','auditionOff','auditionAllOff'].includes(method)?result:snapshot;
  }
  return {client,dispatch,read,
    async invoke(method,args=[]){const token=capture(),copy=structuredClone(args);const result=uiSerial.then(()=>{current(token);return invoke(method,copy);});uiSerial=result.catch(()=>{});return result;},
    initialize(){client.initialize();},
    mix(volume,pan){check();synth.enqueue(timed({method:'mix',volume,pan}));return synth.flush();},
    stopped(){held.clear();inspector.resetAuditions();},
    adoptStopped(snapshot){this.stopped();return adopt(snapshot,{adoptClient:true});},
    reset(){this.stopped();clock=appliedClock=baseClock;inspector.reset();if(gameboy)client._adoptState({clock,initialized:false,registers:Array(48).fill(0),voice:Array(48).fill(0)});else client._adoptState({clock,initialized:false,selectedChannel:0,globals:Array(10).fill(0),registers:Array.from({length:8},()=>Array(8).fill(0)),waveforms:Array.from({length:8},()=>Array(32).fill(0)),indices:Array(8).fill(0)});},
  };
}
