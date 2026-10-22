/** Shared PSG / OPLL controls; Native owns the Master System audio renderers. */
import {createSegaPsgApi} from './segapsg_api.js?v=audio-numeric-bindings-1';
import {PsgInspectorState} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext,createNativeVoiceEndpoint,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-msx-1';
import {createNativeGenesisOpll} from './native_genesis_opll.js?v=native-msx-1';
const CLOCK=3579545;
export function createNativeGenesisMasterSystem(synth){
  const context=createNativeVoiceContext(synth,{backend:'master-system',statusCommand:'native_genesis_master_system_status',label:'Master System'});let clock=CLOCK,appliedClock=CLOCK,latch=0;
  const client={...createSegaPsgApi({get clock(){return clock;},write(value){if(value&128)latch=value>>4&7;context.send('segapsg',{method:'write',register:0,value,...(!(value&128)?{psgRegister:latch}:{})});},reset(){latch=0;context.send('segapsg',{method:'reset'});},resetAll(){latch=0;context.send('segapsg',{method:'reset'});}}),id:'segapsg',stereoEnabled:false,get clock(){return clock;},dispose(){}};
  const getState=client._getState,adoptState=client._adoptState;
  client._adoptClock=hz=>{clock=validateChipClock(hz);};client._getState=()=>({...getState(),clock,stereoEnabled:false});
  client._adoptState=state=>{adoptState(state);if(Number.isInteger(state?.latched))latch=state.latched&7;if(state?.clock!==undefined)client._adoptClock(state.clock);};
  client._forceKeyOff=ch=>{integer(ch,3,'PSG channel');context.send('segapsg',{method:'key-off',channel:ch});};
  const inspector=new PsgInspectorState({write(){},reset(){}},{clock:()=>appliedClock,sampleRate:synth.clock.sampleRate});
  function adopt(data,adoptClient,leases){const attenuations=data.attenuations??data.attenuation,levels=data.lastVolumes??data.levels??attenuations,latched=data.latched??data.latchedRegister;
    nativeSnapshotArray(data.periods,3,1023,'PSG');nativeSnapshotArray(attenuations,4,15,'PSG');nativeSnapshotArray(levels,4,15,'PSG');integer(latched,7,'PSG latch');integer(data.mode,7,'PSG noise mode');context.validateHeld(data,3);
    appliedClock=validateChipClock(data.clock);inspector.periods=[...data.periods];inspector.attenuations=[...attenuations];inspector.lastVolumes=[...levels];inspector.latched=latched;inspector.mode=data.mode;inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    if(adoptClient)client._adoptState({clock:appliedClock,latched,attenuations:levels});return {...data,...inspector.read(),held:data.held??[...leases.keys()]};
  }
  function translate(message){const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('Master System arguments must be an array');
    if(method==='write')return {method:'write',register:0,value:integer(args[0],255,'PSG value'),...(message.psgRegister===undefined?{}:{psgRegister:integer(message.psgRegister,7,'PSG register')})};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],3,'Channel')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset'||method==='resetAll')return {method:'reset'};
    if(method==='stopVoices'||method==='allNotesOff')return {method:'stop-voices'};
    throw new Error(`Unsupported Native segapsg operation: ${method}`);
  }
  function patch(groups){const state=client._getState();for(const group of groups){let latched=state.latched;for(const c of group.commands){if(c.method==='write'){const v=c.value;latched=v&128?v>>4&7:c.psgRegister??latched;if(group.action==='edit'&&(latched&1))state.attenuations[latched>>1]=v&15;}if(c.method==='reset'){latched=0;state.attenuations.fill(0);}}state.latched=latched;}client._adoptState(state);}
  const segapsg=createNativeVoiceEndpoint(context,{chip:'segapsg',globalName:'psg',client,inspector,translate,adopt,patch,initialize:()=>client.reset(),
    async resetInspector(method,{identity,send,read,token,current,stopped,notify}){if(method!=='reset'&&method!=='resetAll')return false;const id=identity();send({method:'reset',audition:true,id});await synth.flush();current(token);await read({after:id});current(token);stopped();client._adoptState({attenuations:[0,0,0,0],latched:0,stereo:255});notify();return true;},
    reset(){clock=appliedClock=CLOCK;latch=0;client._adoptState({clock:CLOCK,attenuations:[0,0,0,0],latched:0,stereo:255});},
  });
  return {segapsg,ym2413:createNativeGenesisOpll(context)};
}
