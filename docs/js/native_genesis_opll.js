/** Shared YM2413 authoring / inspection for Native Master System and MSX. */
import {YM2413Synth} from './ym2413synth.js?v=audio-numeric-bindings-1';
import {Ym2413VoiceInspector} from './playground_ym2413_inspector.js?v=native-extra-stability-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceEndpoint,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-extra-stability-1';
const CLOCK=3579545;
const logical=key=>typeof key==='string'&&/^rhythm:[0-4]$/.test(key)?9+Number(key.slice(7)):Number(key);
const voiceKey=channel=>channel>=9?`rhythm:${channel-9}`:channel;
const physical=key=>{const ch=logical(key);return ch>=9?[6,7,8,8,7][ch-9]:ch;};
export function createNativeGenesisOpll(context){
  const {synth}=context;let clock=CLOCK,appliedClock=CLOCK,initialized=false,mode=0,notification=null;
  const notify=()=>synth.emit?.({type:'native-state',name:'opll',state:client._getState()});
  function notifyMode(){if(notification)return;let token;try{token=context.capture();}catch{return;}notification=token;queueMicrotask(()=>{if(notification!==token)return;notification=null;try{context.current(token);if(context.isEnabled('ym2413'))notify();}catch{}});}
  const client=new YM2413Synth({clock:CLOCK,transport:{writeRegister(register,value){context.send('ym2413',{method:'write',register,value});if(register===14){const changed=mode!==(value&32);mode=value&32;if(changed)notifyMode();}},reset(){context.send('ym2413',{method:'reset'});const changed=mode!==0;mode=0;if(changed)notifyMode();}}});
  Object.defineProperties(client,{id:{value:'ym2413',enumerable:true},clock:{configurable:true,enumerable:true,get:()=>clock}});client.dispose=()=>{};
  client._adoptClock=hz=>{clock=validateChipClock(hz);};
  client._getState=()=>({clock,initialized,registers:Array.from(client.getRegisterSnapshot())});
  client._adoptState=state=>{const previous=mode;if(state?.registers){client.adoptRegisterSnapshot(state.registers);mode=state.registers[14]&32;}if(state?.clock!==undefined)client._adoptClock(state.clock);if(state?.initialized!==undefined)initialized=!!state.initialized;if(previous!==mode)notifyMode();};
  const initialize=client.initialize.bind(client);client.initialize=()=>{const result=initialize();initialized=true;return result;};
  client._forceKeyOff=ch=>{integer(ch,8,'YM2413 channel');const r=client.getRegisterSnapshot();r[0x20+ch]&=239;client.adoptRegisterSnapshot(r);context.send('ym2413',{method:'key-off',channel:ch});};
  client._forceRhythmOff=index=>{integer(index,4,'YM2413 drum');const r=client.getRegisterSnapshot();r[14]&=~(16>>index);client.adoptRegisterSnapshot(r);context.send('ym2413',{method:'key-off',channel:9+index});};
  const inspector=new Ym2413VoiceInspector({clock:()=>appliedClock,sampleRate:synth.clock.sampleRate});
  function adopt(data,adoptClient,leases){nativeSnapshotArray(data.registers,64,255,'YM2413');context.validateHeld(data,13);appliedClock=validateChipClock(data.clock);inspector.registers.set(data.registers);inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;if(adoptClient)client._adoptState(data);return {...data,...inspector.read(),held:(data.held??[...leases.keys()].map(logical)).map(voiceKey)};}
  function translate(message){const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError(`${context.label} arguments must be an array`);
    if(method==='writeRegister')return {method:'write',register:integer(args[0],63,'Register'),value:integer(args[1],255,'Value')};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],8,'Channel')};
    if(method==='forceRhythmOff')return {method:'key-off',channel:9+integer(args[0],4,'Drum')};
    if(method==='auditionKeyOn')return {method:'audition-key-on',channel:integer(args[0],8,'Channel')};
    if(method==='auditionRhythmOn')return {method:'audition-key-on',channel:9+integer(args[0],4,'Drum')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset'||method==='resetAll')return {method:'reset'};
    if(method==='stopVoices'||method==='allNotesOff')return {method:'stop-voices'};
    throw new Error(`Unsupported Native ym2413 operation: ${method}`);
  }
  function patch(groups){const state=client._getState();for(const group of groups)for(const c of group.commands){if(c.method==='write')state.registers[c.register]=c.value;if(c.method==='key-off'){if(c.channel<9)state.registers[0x20+c.channel]&=239;else state.registers[14]&=~(16>>(c.channel-9));}if(c.method==='audition-key-on'){if(c.channel<9)state.registers[0x20+c.channel]|=16;else state.registers[14]|=16>>(c.channel-9);}if(c.method==='reset')state.registers.fill(0);}client._adoptState(state);}
  const endpoint=createNativeVoiceEndpoint(context,{chip:'ym2413',globalName:'opll',client,inspector,translate,adopt,patch,logical,physical,reset(){initialized=false;appliedClock=CLOCK;client._adoptState({clock:CLOCK,registers:Array(64).fill(0),initialized:false});}});
  client.readStatus=async()=>(await endpoint.read()).status;client.getIrq=async()=>!!(await endpoint.read()).irq;return endpoint;
}
