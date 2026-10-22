/** MSX register authoring stays in JS; YM2413 and AY audio render in Native. */
import {AY8910Synth} from './ay8910synth.js?v=audio-numeric-bindings-1';
import {Ay8910VoiceInspector} from './playground_ay8910_inspector.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext,createNativeVoiceEndpoint,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-msx-1';
import {createNativeGenesisOpll} from './native_genesis_opll.js?v=native-msx-1';
const AY_CLOCK=1789773;
function createNativeAy8910(context){
  const {synth}=context;let clock=AY_CLOCK,appliedClock=AY_CLOCK,initialized=false;
  const client=new AY8910Synth({clock,transport:{writeRegister(register,value){context.send('ay8910',{method:'write',register,value});},reset(){context.send('ay8910',{method:'reset'});}}});
  const getState=client._getState.bind(client),adoptState=client._adoptState.bind(client),initialize=client.initialize.bind(client);
  Object.defineProperties(client,{id:{value:'ay8910',enumerable:true},clock:{configurable:true,enumerable:true,get:()=>clock}});client.dispose=()=>{};
  client._adoptClock=hz=>{clock=validateChipClock(hz);};
  client._getState=()=>({...getState(),clock,initialized});
  client._adoptState=state=>{adoptState({registers:state.registers,...(state.levels===undefined?{}:{levels:state.levels})});if(state?.clock!==undefined)client._adoptClock(state.clock);if(state?.initialized!==undefined)initialized=!!state.initialized;};
  client.initialize=()=>{const result=initialize();initialized=true;return result;};
  client._forceKeyOff=ch=>{integer(ch,2,'AY8910 channel');const state=getState();state.registers[8+ch]=0;adoptState(state);context.send('ay8910',{method:'key-off',channel:ch});};
  // Use the same retained-level metadata as the Web / Worker client. A raw
  // zero write may be keyOff; an explicitly authored zero must stay zero.
  let nesting=0;
  for(const method of ['initialize','reset','writeRegister','setVoice','tone','setTone','noise','setMixer','setVolume','setNoisePeriod','setEnvelope','setTonePeriod','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','off','allNotesOff']){
    const original=client[method].bind(client);client[method]=(...args)=>{const before=nesting++===0?getState().levels:null;try{const value=original(...args);if(before){const after=getState().levels;for(let ch=0;ch<3;ch++)if(before[ch]!==after[ch])context.send('ay8910',{method:'set-retained-level',channel:ch,level:after[ch]});}return value;}finally{nesting--;}};
  }
  const inspector=new Ay8910VoiceInspector({clock:()=>appliedClock,sampleRate:synth.clock.sampleRate});
  const inspect=inspector.invoke.bind(inspector);inspector.invoke=(method,args)=>{const before=[...inspector.levels],result=inspect(method,args);for(let ch=0;ch<3;ch++)if(before[ch]!==inspector.levels[ch])inspector.dispatch({method:'setRetainedLevel',args:[ch,inspector.levels[ch]]},undefined,{preserveOwner:true});return result;};
  function adopt(data,adoptClient,leases){nativeSnapshotArray(data.registers,16,255,'AY8910');nativeSnapshotArray(data.levels,3,31,'AY8910 retained levels');context.validateHeld(data,2);if(data.gates!==undefined&&(!Array.isArray(data.gates)||data.gates.length!==3||data.gates.some(v=>typeof v!=='boolean')))throw new Error('Native AY8910 returned invalid gates');
    appliedClock=validateChipClock(data.clock);inspector.registers.set(data.registers);inspector.levels=[...data.levels];inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;if(adoptClient)client._adoptState(data);const state=inspector.read();if(data.gates)for(let ch=0;ch<3;ch++)state.channels[ch].active=state.channels[ch].active&&data.gates[ch];return {...data,...state,held:data.held??[...leases.keys()]};
  }
  function translate(message){const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('MSX arguments must be an array');
    if(method==='writeRegister')return {method:'write',register:integer(args[0],15,'Register'),value:integer(args[1],255,'Value')};
    if(method==='setRetainedLevel')return {method:'set-retained-level',channel:integer(args[0],2,'Channel'),level:integer(args[1],31,'Retained level')};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],2,'Channel')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset'||method==='resetAll')return {method:'reset'};
    if(method==='stopVoices'||method==='allNotesOff')return {method:'stop-voices'};
    throw new Error(`Unsupported Native ay8910 operation: ${method}`);
  }
  function patch(groups){const state=client._getState();for(const group of groups)for(const c of group.commands){if(c.method==='write')state.registers[c.register]=c.value;if(c.method==='set-retained-level')state.levels[c.channel]=c.level;if(c.method==='key-off')state.registers[8+c.channel]=0;if(c.method==='reset'){state.registers.fill(0);state.levels.fill(9);}}client._adoptState(state);}
  const endpoint=createNativeVoiceEndpoint(context,{chip:'ay8910',globalName:'ay',client,inspector,translate,adopt,patch,reset(){clock=appliedClock=AY_CLOCK;initialized=false;client._adoptState({clock:AY_CLOCK,registers:Array(16).fill(0),levels:[9,9,9],initialized:false});}});
  client._stopVoices=()=>{const state=getState();for(let ch=0;ch<3;ch++)state.registers[8+ch]=0;adoptState(state);return endpoint.dispatch({method:'stopVoices'});};return endpoint;
}
export function createNativeGenesisMsx(synth){
  const context=createNativeVoiceContext(synth,{backend:'msx',statusCommand:'native_genesis_msx_status',label:'MSX'});
  return {ym2413:createNativeGenesisOpll(context),ay8910:createNativeAy8910(context)};
}
