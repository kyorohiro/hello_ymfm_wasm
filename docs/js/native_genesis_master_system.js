/** Shared PSG / OPLL controls; Native owns the Master System audio renderers. */
import {createSegaPsgApi} from './segapsg_api.js?v=audio-numeric-bindings-1';
import {PsgInspectorState} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {YM2413Synth} from './ym2413synth.js?v=audio-numeric-bindings-1';
import {Ym2413VoiceInspector} from './playground_ym2413_inspector.js?v=audio-numeric-bindings-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';

const CLOCK=3579545;
const integer=(value,max,label)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);return value;};
const abort=()=>new DOMException('Native Master System operation was cancelled','AbortError');
const logical=key=>typeof key==='string'&&/^rhythm:[0-4]$/.test(key)?9+Number(key.slice(7)):Number(key);
const voiceKey=channel=>channel>=9?`rhythm:${channel-9}`:channel;
const inspectorOwner=id=>`voice-editor:${id}`;
const physical=key=>{const channel=logical(key);return channel>=9?[6,7,8,8,7][channel-9]:channel;};

export function createNativeGenesisMasterSystem(synth){
  let version=0,nextIdentity=0;const enabled=new Set(),initialized=new Map();
  const check=()=>{if(!synth.isReady())throw new Error('Native Master System audio is not ready');if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation,version};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation||token.version!==version)throw abort();};
  const identity=()=>{if(nextIdentity>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native Master System command identity limit reached');return ++nextIdentity;};
  const timed=(chip,message,timing={})=>({type:'master-system',message:{chip,...message},frame:timing.time===undefined?0:synth.frameAt(timing.time),...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  const send=(chip,message,timing={})=>{check();timing.checkCurrent?.();if(enabled.has(chip))synth.enqueue(timed(chip,message,timing));};
  async function snapshot(chip,args={}){const token=capture(),data=await synth.nativeRequest('native_genesis_master_system_status',args);current(token);const state=data?.[chip];if(!state||typeof state!=='object')throw new Error('Native Master System returned an invalid snapshot');return {...state,sampleRate:data.sampleRate??state.sampleRate,frame:data.frame??state.frame,revision:data.revision??state.revision};}
  function validateArray(values,length,max,label){if(!Array.isArray(values)||values.length!==length||values.some(v=>!Number.isInteger(v)||v<0||v>max))throw new Error(`Native ${label} returned an invalid snapshot`);}
  function validateHeld(data,max){if(data.held!==undefined&&(!Array.isArray(data.held)||data.held.some(v=>!Number.isInteger(v)||v<0||v>max))||data.pendingCommands!==undefined&&(!Array.isArray(data.pendingCommands)||data.pendingCommands.some(id=>!Number.isSafeInteger(id)||id<1)))throw new Error('Native Master System returned invalid held channels or pending commands');}

  let psgClock=CLOCK,appliedPsgClock=CLOCK,opllClock=CLOCK,appliedOpllClock=CLOCK,psgLatch=0,psgCollection=null,opllCollection=null,opllInitialized=false,opllMode=0,opllNotification=null;
  function notifyOpllMode(){
    if(opllNotification)return;const token={session:synth.session,generation:synth.generation,version};opllNotification=token;
    queueMicrotask(()=>{if(opllNotification!==token)return;opllNotification=null;if(token.session===synth.session&&token.generation===synth.generation&&token.version===version&&synth.isReady()&&!synth.stopping&&!synth.closing&&enabled.has('ym2413'))notify('ym2413');});
  }
  const psgLeases=new Map(),opllLeases=new Map();
  const psgClient={...createSegaPsgApi({get clock(){return psgClock;},write(value){if(value&128)psgLatch=value>>4&7;send('segapsg',{method:'write',register:0,value,...(!(value&128)?{psgRegister:psgLatch}:{})});},reset(){psgLatch=0;send('segapsg',{method:'reset'});},resetAll(){psgLatch=0;send('segapsg',{method:'reset'});}}),id:'segapsg',stereoEnabled:false,get clock(){return psgClock;},dispose(){}};
  const psgGetState=psgClient._getState,psgAdoptState=psgClient._adoptState;
  psgClient._adoptClock=hz=>{psgClock=validateChipClock(hz);};
  psgClient._getState=()=>({...psgGetState(),clock:psgClock,stereoEnabled:false});
  psgClient._adoptState=state=>{psgAdoptState(state);if(Number.isInteger(state?.latched))psgLatch=state.latched&7;if(state?.clock!==undefined)psgClient._adoptClock(state.clock);};
  psgClient._forceKeyOff=channel=>{integer(channel,3,'PSG channel');send('segapsg',{method:'key-off',channel});};
  const psgInspector=new PsgInspectorState({write(){},reset(){}},{clock:()=>appliedPsgClock,sampleRate:synth.clock.sampleRate,dispatch(command,owner,options){if(!psgCollection)throw new Error('PSG edit outside collection');psgCollection.push({command,owner,...options});}});
  const opllClient=new YM2413Synth({clock:CLOCK,transport:{writeRegister(register,value){send('ym2413',{method:'write',register,value});if(register===14){const changed=opllMode!==(value&32);opllMode=value&32;if(changed)notifyOpllMode();}},reset(){send('ym2413',{method:'reset'});const changed=opllMode!==0;opllMode=0;if(changed)notifyOpllMode();}}});
  Object.defineProperty(opllClient,'id',{value:'ym2413',enumerable:true});opllClient.dispose=()=>{};
  Object.defineProperty(opllClient,'clock',{configurable:true,enumerable:true,get:()=>opllClock});
  opllClient._adoptClock=hz=>{opllClock=validateChipClock(hz);};
  opllClient._getState=()=>({clock:opllClient.clock,initialized:opllInitialized,registers:Array.from(opllClient.getRegisterSnapshot())});
  opllClient._adoptState=state=>{const previousMode=opllMode;if(state?.registers){opllClient.adoptRegisterSnapshot(state.registers);opllMode=state.registers[14]&32;}if(state?.clock!==undefined)opllClient._adoptClock(state.clock);if(state?.initialized!==undefined)opllInitialized=!!state.initialized;if(previousMode!==opllMode)notifyOpllMode();};
  const initializeOpll=opllClient.initialize.bind(opllClient);opllClient.initialize=()=>{const result=initializeOpll();opllInitialized=true;return result;};
  const opllInspector=new Ym2413VoiceInspector({clock:()=>appliedOpllClock,sampleRate:synth.clock.sampleRate,dispatch(command,owner,options){if(!opllCollection)throw new Error('OPLL edit outside collection');opllCollection.push({command,owner,...options});}});
  opllClient._forceKeyOff=channel=>{integer(channel,8,'YM2413 channel');const r=opllClient.getRegisterSnapshot();r[0x20+channel]&=239;opllClient.adoptRegisterSnapshot(r);send('ym2413',{method:'key-off',channel});};
  opllClient._forceRhythmOff=index=>{integer(index,4,'YM2413 drum');const r=opllClient.getRegisterSnapshot();r[0x0e]&=~(16>>index);opllClient.adoptRegisterSnapshot(r);send('ym2413',{method:'key-off',channel:9+index});};

  function adoptPsg(data,adoptClient=false){
    const attenuations=data.attenuations??data.attenuation,lastVolumes=data.lastVolumes??data.levels??attenuations,latched=data.latched??data.latchedRegister;
    validateArray(data.periods,3,1023,'PSG');validateArray(attenuations,4,15,'PSG');validateArray(lastVolumes,4,15,'PSG');integer(latched,7,'PSG latch');integer(data.mode,7,'PSG noise mode');validateHeld(data,3);
    appliedPsgClock=validateChipClock(data.clock);psgInspector.periods=[...data.periods];psgInspector.attenuations=[...attenuations];psgInspector.lastVolumes=[...lastVolumes];psgInspector.latched=latched;psgInspector.mode=data.mode;psgInspector.sampleRate=data.sampleRate??synth.clock.sampleRate;
    // Native Stop restores the applied last-audible levels, matching the PSG
    // inspector and core. This retires projected Worker edits cancelled by Stop;
    // the hardware remains silent until a later explicit keyOn/audition.
    if(adoptClient)psgClient._adoptState({clock:appliedPsgClock,latched,attenuations:lastVolumes});return {...data,...psgInspector.read(),held:data.held??[...psgLeases.keys()]};
  }
  function adoptOpll(data,adoptClient=false){validateArray(data.registers,64,255,'YM2413');validateHeld(data,13);appliedOpllClock=validateChipClock(data.clock);opllInspector.registers.set(data.registers);opllInspector.sampleRate=data.sampleRate??synth.clock.sampleRate;if(adoptClient)opllClient._adoptState(data);return {...data,...opllInspector.read(),held:(data.held??[...opllLeases.keys()].map(logical)).map(voiceKey)};}
  const readers={segapsg:async(args={})=>adoptPsg(await snapshot('segapsg',args)),ym2413:async(args={})=>adoptOpll(await snapshot('ym2413',args))};
  const notify=chip=>synth.emit?.({type:'native-state',name:chip==='segapsg'?'psg':'opll',state:(chip==='segapsg'?psgClient:opllClient)._getState()});
  function translate(chip,message){const args=message.args??[],method=message.method??message.type;if(!Array.isArray(args))throw new TypeError('Master System arguments must be an array');
    if(method==='write'&&chip==='segapsg')return {method:'write',register:0,value:integer(args[0],255,'PSG value'),...(message.psgRegister===undefined?{}:{psgRegister:integer(message.psgRegister,7,'PSG register')})};
    if(method==='writeRegister'&&chip==='ym2413')return {method:'write',register:integer(args[0],63,'Register'),value:integer(args[1],255,'Value')};
    if(method==='forceKeyOff')return {method:'key-off',channel:integer(args[0],chip==='segapsg'?3:8,'Channel')};
    if(method==='forceRhythmOff'&&chip==='ym2413')return {method:'key-off',channel:9+integer(args[0],4,'Drum')};
    if(method==='auditionKeyOn'&&chip==='ym2413')return {method:'audition-key-on',channel:integer(args[0],8,'Channel')};
    if(method==='auditionRhythmOn'&&chip==='ym2413')return {method:'audition-key-on',channel:9+integer(args[0],4,'Drum')};
    if(method==='clock')return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset'||method==='resetAll')return {method:'reset'};
    if(method==='stopVoices'||method==='allNotesOff')return {method:'stop-voices'};
    throw new Error(`Unsupported Native ${chip} operation: ${method}`);
  }
  async function dispatch(chip,message,timing={}){const token=capture();timing.checkCurrent?.();let value;if((message.method??message.type)==='dispose')value=true;else{const command=translate(chip,message);send(chip,command,timing);await synth.flush();current(token);timing.checkCurrent?.();if(command.method==='clock'){(chip==='segapsg'?psgClient:opllClient)._adoptClock(command.hz);notify(chip);}}return message.id===undefined?undefined:{id:message.id,...(value===undefined?{}:{value})};}
  psgClient.setClock=hz=>dispatch('segapsg',{method:'clock',args:[hz]});opllClient.setClock=hz=>dispatch('ym2413',{method:'clock',args:[hz]});
  for(const [chip,client]of [['segapsg',psgClient],['ym2413',opllClient]])client._stopVoices=()=>dispatch(chip,{method:'stopVoices'});
  opllClient.readStatus=async()=> (await readers.ym2413()).status;opllClient.getIrq=async()=>!!(await readers.ym2413()).irq;

  function patchClient(chip,groups){
    if(chip==='segapsg'){
      const state=psgClient._getState();for(const group of groups){let latch=state.latched;for(const command of group.commands){if(command.method==='write'){const value=command.value;latch=value&128?value>>4&7:command.psgRegister??latch;if(group.action==='edit'&&(latch&1))state.attenuations[latch>>1]=value&15;}if(command.method==='reset'){latch=0;state.attenuations.fill(0);}}state.latched=latch;}psgClient._adoptState(state);
    }else{
      const state=opllClient._getState();for(const group of groups)for(const command of group.commands){if(command.method==='write')state.registers[command.register]=command.value;if(command.method==='key-off'){if(command.channel<9)state.registers[0x20+command.channel]&=239;else state.registers[0x0e]&=~(16>>(command.channel-9));}if(command.method==='audition-key-on'){if(command.channel<9)state.registers[0x20+command.channel]|=16;else state.registers[0x0e]|=16>>(command.channel-9);}if(command.method==='reset')state.registers.fill(0);}opllClient._adoptState(state);
    }
    notify(chip);
  }
  function invoker(chip,inspector,leases){let serial=Promise.resolve();return (method,args=[])=>{const token=capture(),copy=structuredClone(args),result=serial.then(async()=>{
      current(token);await readers[chip]();current(token);
      if(chip==='segapsg'&&(method==='reset'||method==='resetAll')){
        const id=identity();send(chip,{method:'reset',audition:true,id});await synth.flush();current(token);await readers[chip]({after:id});current(token);inspector.auditions.clear();leases.clear();psgClient._adoptState({attenuations:[0,0,0,0],latched:0,stereo:255});notify(chip);return;
      }
      const previous=new Map(inspector.auditions),previousLeases=new Map(leases);let collected,result;
      if(chip==='segapsg')psgCollection=[];else opllCollection=[];
      try{result=inspector.invoke(method,copy);collected=chip==='segapsg'?psgCollection:opllCollection;}finally{if(chip==='segapsg')psgCollection=null;else opllCollection=null;}
      const nextLeases=new Map(),ownerVoices=new Map(),ownerKey=(key,id)=>`${logical(key)}:${inspectorOwner(id)}`;for(const [key,id]of previous){const voice=previousLeases.get(key);if(voice)ownerVoices.set(ownerKey(key,id),voice);}for(const [key,id]of inspector.auditions){const voice=previous.get(key)===id?previousLeases.get(key):identity();nextLeases.set(key,voice);ownerVoices.set(ownerKey(key,id),voice);}
      const groups=[];for(const item of collected){const isEdit=item.preserveOwner===true||!item.owner;let key,action,voice;
        if(isEdit){action='edit';const target=nativeVoiceChannel(chip,item.command);key=Number.isInteger(target)?target:0;}
        else{const target=nativeVoiceChannel(chip,item.command),matches=([key,id])=>inspectorOwner(id)===item.owner&&(!Number.isInteger(target)||physical(key)===target),match=[...inspector.auditions].find(matches)??[...previous].find(matches);if(!match)throw new Error('Invalid Master System audition owner');key=match[0];action=inspector.auditions.get(key)===match[1]?'on':'off';voice=ownerVoices.get(ownerKey(key,match[1]));}
        if(action==='off'&&!voice)continue;
        let group=groups.at(-1);if(!group||group.action!==action||group.channel!==logical(key)||group.voice!==voice){group={method:'batch',channel:logical(key),...(voice?{voice}:{}),audition:true,action,commands:[]};groups.push(group);}group.commands.push(translate(chip,item.command));
      }
      let last;for(const group of groups){last=identity();send(chip,{...group,id:last});}
      await synth.flush();current(token);if(last){await readers[chip]({after:last});current(token);leases.clear();for(const [key,voice]of nextLeases)leases.set(key,voice);patchClient(chip,groups);}return result;
    });serial=result.catch(()=>{});return result;};}
  const stoppedPsg=()=>{psgInspector.auditions.clear();psgLeases.clear();};
  const stoppedOpll=()=>{opllInspector.auditions.clear();opllLeases.clear();};
  function endpoint(chip,client,inspector,stopped,adopt,leases){return {client,
    async initialize(){const token=capture();enabled.add(chip);if(initialized.get(chip)===token.session)return;if(chip==='ym2413')client.initialize();else client.reset();await synth.flush();current(token);initialized.set(chip,token.session);},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid Master System mix');const token=capture();synth.enqueue(timed(chip,{method:'mix',volume,pan}));await synth.flush();current(token);},
    dispatch:(message,timing)=>dispatch(chip,message,timing),read:readers[chip],invoke:invoker(chip,inspector,leases),stopped,
    adoptStopped(data){stopped();adopt(data?.[chip]??data,true);},
    reset(){version++;enabled.delete(chip);initialized.delete(chip);stopped();inspector.reset();if(chip==='segapsg'){psgClock=appliedPsgClock=CLOCK;psgLatch=0;psgClient._adoptState({clock:CLOCK,attenuations:[0,0,0,0],latched:0,stereo:255});}else{opllInitialized=false;appliedOpllClock=CLOCK;opllClient._adoptState({clock:CLOCK,registers:Array(64).fill(0),initialized:false});}},
  };}
  return {segapsg:endpoint('segapsg',psgClient,psgInspector,stoppedPsg,adoptPsg,psgLeases),ym2413:endpoint('ym2413',opllClient,opllInspector,stoppedOpll,adoptOpll,opllLeases)};
}
