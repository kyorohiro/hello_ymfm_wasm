/** Shared Sega PSG authoring / inspection for Native Master System and Game Gear. */
import {createSegaPsgApi} from './segapsg_api.js?v=audio-numeric-bindings-1';
import {PsgInspectorState} from './playground_chip_inspector_state.js?v=pokey-prepare-1';
import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {createNativeVoiceEndpoint,nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=pokey-mode-1';
const CLOCK=3579545;
export function createNativeGenesisSegaPsg(context,{stereoEnabled=false,acknowledgeClock=false}={}){
  const {synth}=context;let clock=CLOCK,appliedClock=CLOCK,latch=0,appliedStereo=255;
  const client={...createSegaPsgApi({get clock(){return clock;},write(value){if(value&128)latch=value>>4&7;context.send('segapsg',{method:'write',register:0,value,...(!(value&128)?{psgRegister:latch}:{})});},...(stereoEnabled?{setStereo:mask=>context.send('segapsg',{method:'stereo',mask})}:{}),reset(){latch=0;context.send('segapsg',{method:'reset'});},resetAll(){latch=0;context.send('segapsg',{method:'reset'});}}),id:'segapsg',stereoEnabled,get clock(){return clock;},dispose(){}};
  const getState=client._getState,adoptState=client._adoptState;
  client._adoptClock=hz=>{clock=validateChipClock(hz);};client._getState=()=>({...getState(),clock,stereoEnabled});
  client._adoptState=state=>{adoptState(state);if(Number.isInteger(state?.latched))latch=state.latched&7;if(state?.clock!==undefined)client._adoptClock(state.clock);};
  client._forceKeyOff=ch=>{integer(ch,3,'PSG channel');context.send('segapsg',{method:'key-off',channel:ch});};
  const inspector=new PsgInspectorState({write(){},reset(){}},{clock:()=>appliedClock,sampleRate:synth.clock.sampleRate});
  const invoke=inspector.invoke.bind(inspector);inspector.invoke=(method,args=[])=>{if(method==='setStereo'&&stereoEnabled){const mask=integer(args[0],255,'Stereo mask');inspector.dispatch({method:'setStereo',args:[mask]},undefined,{preserveOwner:true});return;}return invoke(method,args);};
  function adopt(data,adoptClient,leases){const attenuations=data.attenuations??data.attenuation,levels=data.lastVolumes??data.levels??attenuations,latched=data.latched??data.latchedRegister;
    nativeSnapshotArray(data.periods,3,1023,'PSG');nativeSnapshotArray(attenuations,4,15,'PSG');nativeSnapshotArray(levels,4,15,'PSG');integer(latched,7,'PSG latch');integer(data.mode,7,'PSG noise mode');context.validateHeld(data,3);
    appliedStereo=integer(data.stereo??(stereoEnabled?undefined:255),255,'Stereo mask');appliedClock=validateChipClock(data.clock);inspector.periods=[...data.periods];inspector.attenuations=[...attenuations];inspector.lastVolumes=[...levels];inspector.latched=latched;inspector.mode=data.mode;inspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    if(adoptClient)client._adoptState({clock:appliedClock,latched,attenuations:levels,stereo:appliedStereo});const view=inspector.read();const pan=ch=>({left:!stereoEnabled||!!(appliedStereo&(16<<ch)),right:!stereoEnabled||!!(appliedStereo&(1<<ch))});return {...data,...view,stereo:appliedStereo,stereoEnabled,channels:view.channels.map(c=>({...c,pan:pan(c.channel)})),noise:{...view.noise,pan:pan(3)},held:data.held??[...leases.keys()]};
  }
  function translate(message){const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError(`${context.label} arguments must be an array`);
    if(method==='write')return {method:'write',register:0,value:integer(args[0],255,'PSG value'),...(message.psgRegister===undefined?{}:{psgRegister:integer(message.psgRegister,7,'PSG register')})};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],3,'Channel')};
    if(method==='setStereo'&&stereoEnabled)return {method:'stereo',mask:integer(args[0],255,'Stereo mask')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset'||method==='resetAll')return {method:'reset'};
    if(method==='stopVoices'||method==='allNotesOff')return {method:'stop-voices'};
    throw new Error(`Unsupported Native segapsg operation: ${method}`);
  }
  function patch(groups){const state=client._getState();for(const group of groups){let latched=state.latched;for(const c of group.commands){if(c.method==='write'){const v=c.value;latched=v&128?v>>4&7:c.psgRegister??latched;if(group.action==='edit'&&(latched&1))state.attenuations[latched>>1]=v&15;}if(c.method==='stereo')state.stereo=c.mask;if(c.method==='reset'){latched=0;state.attenuations.fill(0);state.stereo=255;}}state.latched=latched;}client._adoptState(state);}
  const segapsg=createNativeVoiceEndpoint(context,{chip:'segapsg',globalName:'psg',client,inspector,translate,adopt,patch,initialize:()=>client.reset(),
    async resetInspector(method,{identity,send,read,token,current,stopped,notify}){if(method!=='reset'&&method!=='resetAll')return false;const id=identity();send({method:'reset',audition:true,id});await synth.flush();current(token);await read({after:id});current(token);stopped();client._adoptState({attenuations:[0,0,0,0],latched:0,stereo:255});notify();return true;},
    reset(){clock=appliedClock=CLOCK;latch=0;appliedStereo=255;client._adoptState({clock:CLOCK,attenuations:[0,0,0,0],latched:0,stereo:255});},
  });
  if(acknowledgeClock){
    const dispatch=segapsg.dispatch;let clocks=Promise.resolve();
    segapsg.dispatch=(message,timing={})=>{
      if((message.method??message.type)!=='clock')return dispatch(message,timing);
      let token,hz;
      try{token=context.capture();timing.checkCurrent?.();hz=translate(message).hz;}catch(error){return Promise.reject(error);}
      const result=clocks.then(async()=>{
        context.current(token);timing.checkCurrent?.();await synth.flush();context.current(token);timing.checkCurrent?.();
        const id=context.identity();context.send('segapsg',{method:'clock',hz,id},timing);await synth.flush();context.current(token);timing.checkCurrent?.();
        const state=await context.snapshot('segapsg',{after:id});context.current(token);timing.checkCurrent?.();
        if(validateChipClock(state.clock)!==hz)throw new Error('Native Game Gear clock was not applied; a voice may be held by a manual audition');
        client._adoptClock(hz);synth.emit?.({type:'native-state',name:'psg',state:client._getState()});return message.id===undefined?undefined:{id:message.id};
      });clocks=result.catch(()=>{});return result;
    };
    client.setClock=hz=>segapsg.dispatch({method:'clock',args:[hz]});
  }
  return segapsg;
}
