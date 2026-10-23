/** Independent Native 32X PWM. Only controls and applied snapshots cross this
 * endpoint; FIFO playback and output-frame reservations stay on the callback. */
import {readPwmInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {CHIP_CLOCKS,validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext} from './native_genesis_voice_endpoint.js?v=native-extra-snes-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-snes-1';

export const EXTRA_PWM_ADMISSION_ERRORS=Object.freeze([
  'Native additional PWM write queue limit reached (1000000 entries / 1024 batches)',
  'Native additional PWM pending command limit reached (64 MiB)',
]);
const integer=(value,max,name)=>{if(!Number.isSafeInteger(value)||value<0||value>max)throw new RangeError(`Invalid PWM ${name}`);return value;};
const abort=()=>new DOMException('Native additional PWM operation was cancelled','AbortError');
const apiState=value=>({model:'mame',outputMode:value.outputMode,clock:value.clock,sampleRate:value.sampleRate,currentFrame:value.currentFrame,queuedWrites:value.queuedWrites});

export function createNativeGenesisExtraPwmEndpoint(synth){
  const context=createNativeVoiceContext(synth,{backend:'extra-pwm',statusCommand:'native_genesis_extra_pwm_status',label:'additional PWM'}),{capture,current}=context;
  let clock=CHIP_CLOCKS.pwm,serial=Promise.resolve(),nextOrder=0,mainGroup,initialized=false,appliedRevision=-1;
  let applied={model:'mame',outputMode:'duty',clock,sampleRate:synth.clock.sampleRate||48000,currentFrame:0,queuedWrites:0,registers:[0,0,16384,16384,16384]};
  const operations=new Set();
  const notify=()=>synth.emit?.({type:'native-state',name:'pwm',state:apiState(applied)});
  function validate(value){
    validateChipClock(value?.clock);integer(value.sampleRate,1000000,'sample rate');integer(value.currentFrame,Number.MAX_SAFE_INTEGER,'current frame');integer(value.queuedWrites,1000000,'queue size');
    if(value.model!=='mame'||!['dac','duty'].includes(value.outputMode)||!Array.isArray(value.registers)||value.registers.length!==5||value.registers.some(v=>!Number.isInteger(v)||v<0||v>65535))throw new Error('Native additional PWM returned an invalid snapshot');
    return value;
  }
  async function snapshot(after){
    const token=capture(),args=after===undefined?{}:{after};
    const data=after===undefined?await synth.nativeRequest('native_genesis_extra_pwm_status',args):await synth.observeNativeSnapshot('native_genesis_extra_pwm_status',args);
    current(token);const value=validate({...data?.pwm,sampleRate:data?.sampleRate??data?.pwm?.sampleRate});integer(data?.revision,Number.MAX_SAFE_INTEGER,'snapshot revision');
    // Explicit completion observers run independently. A delayed older reply
    // still answers its request, while a newer applied clock remains visible.
    if(data.revision>=appliedRevision){applied=value;clock=value.clock;appliedRevision=data.revision;}return value;
  }
  function normalize(method,args=[],timing={}){
    if(!Array.isArray(args))throw new TypeError('PWM arguments must be an array');
    if(['write','writeRegister'].includes(method)){
      const register=integer(args[0],4,'register');if(!Number.isInteger(args[1]))throw new RangeError('Invalid PWM register value');return {method:'write',register,value:args[1]&65535};
    }
    if(['setClock','clock'].includes(method))return {method:'clock',hz:validateChipClock(args[0])};
    if(method==='reset')return {method:'reset'};
    if(method==='clearSchedule')return {method:'clear-schedule'};
    if(['stopVoices','allNotesOff'].includes(method))return {method:'stop-voices'};
    if(method==='scheduleWrites'){
      const source=args[0];if(!Array.isArray(source)||source.length>1000000)throw new RangeError('Invalid PWM write queue');
      const entries=source.map(write=>({frame:integer(write?.frame,Number.MAX_SAFE_INTEGER,'scheduled frame'),register:integer(write?.register,4,'scheduled register'),value:integer(write?.value,65535,'scheduled value')}));
      const baseFrame=timing.time===undefined?undefined:integer(synth.frameAt(timing.time),Number.MAX_SAFE_INTEGER,'schedule base');
      if(baseFrame!==undefined&&entries.some(write=>write.frame>Number.MAX_SAFE_INTEGER-baseFrame))throw new RangeError('Invalid PWM scheduled frame');
      return {method:'schedule-writes',entries,...(baseFrame===undefined?{}:{baseFrame})};
    }
    if(['read','getState','barrier'].includes(method))return {method:'barrier'};
    throw new Error(`Unsupported Native additional PWM operation: ${method}`);
  }
  function operation(timing){
    if(operations.size>=256)throw new RangeError('Native additional PWM preparation request queue is full');
    const token=capture(),op={group:mainGroup,performance:timing.performance,owner:timing.owner,cancelled:false};operations.add(op);
    op.check=()=>{current(token);timing.checkCurrent?.();if(op.cancelled)throw abort();};return op;
  }
  function cancel(matches){for(const op of operations)if(matches(op))op.cancelled=true;}
  function send(message,timing={},group){context.send('pwm',{...(group===undefined?{}:{group}),...message},timing);}
  function dispatch(method,args=[],timing={},wait=false){
    const op=operation(timing);let prepared;
    try{prepared=method==='dispose'?undefined:normalize(method,args,timing);}catch(error){operations.delete(op);return Promise.reject(error);}
    const reading=['read','getState','barrier'].includes(method),reservation=method==='scheduleWrites',completion=reading||reservation||wait||prepared?.method==='clock',register=args[0];
    const admission=serial.then(async()=>{
      op.check();if(method==='dispose')return {};
      if(nextOrder>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native additional PWM command ordering limit reached');
      const id=completion?context.identity():undefined;
      send({...prepared,order:++nextOrder,...(id===undefined?{}:{id})},{...timing,...(reading||reservation||wait?{time:undefined}:{})},op.group);
      await synth.flush();op.check();if(!reading)notify();return {id};
    });
    // Serialize preparation/admission, never a future applied-state wait. Stop
    // and another port must remain able to cancel a pending clock or reservation.
    serial=admission.then(()=>{},()=>{});
    return admission.then(async({id})=>{
      if(id===undefined)return undefined;
      let value;try{value=await snapshot(id);}catch(error){op.check();throw error;}op.check();
      if(prepared.method==='clock')notify();
      if(reservation){if(value.lastSchedule?.id!==id)throw new Error('Native additional PWM reservation result was replaced');if(value.lastSchedule.error)throw new RangeError(value.lastSchedule.error);return value.lastSchedule.baseFrame;}
      if(method==='read')return Number.isInteger(register)&&register>=0&&register<=4?value.registers[register]:65535;
      if(method==='getState')return apiState(value);
      return value;
    }).finally(()=>operations.delete(op));
  }
  const client={
    get clock(){return clock;},_getState:()=>apiState(applied),_adoptClock:hz=>{clock=validateChipClock(hz);},
    _allocateMainOwner:()=>context.identity(),_withMainOwner(group,callback){const previous=mainGroup;mainGroup=group;try{return callback();}finally{mainGroup=previous;}},
    _cancelMainOwner(group){cancel(op=>op.group===group);send({method:'cancel-main-owner',targetGroup:group,id:context.identity()});},
    write:(register,value)=>dispatch('write',[register,value]),writeRegister:(register,value)=>dispatch('writeRegister',[register,value]),
    read:register=>dispatch('read',[register]),reset:()=>dispatch('reset'),scheduleWrites:entries=>dispatch('scheduleWrites',[entries]),clearSchedule:()=>dispatch('clearSchedule'),
    getState:()=>dispatch('getState'),setClock:hz=>dispatch('setClock',[hz]),stopVoices:()=>dispatch('stopVoices'),_stopVoices:()=>dispatch('stopVoices'),dispose(){},
  };
  return {client,dispatch(message,timing={}){
      const result=dispatch(message.method,message.args??[],timing).then(value=>message.id===undefined?undefined:{id:message.id,value});
      // The Worker bridge has its own control FIFO. An applied-state observer
      // must release that FIFO too, so another port can cancel its future frame.
      return ['clock','setClock','scheduleWrites','read','getState','barrier'].includes(message.method)?{deferred:result}:result;
    },
    async read(){await serial;const value=await snapshot();return readPwmInspector({read:register=>value.registers[register],getState:()=>apiState(value)});},
    async invoke(method,args=[]){if(!['write','writeRegister','reset'].includes(method))throw new Error('Unsupported Native additional PWM inspector operation');const value=await dispatch(method,args,{},true);return readPwmInspector({read:register=>value.registers[register],getState:()=>apiState(value)});},
    cancelOwner:(performance,owner)=>cancel(op=>op.performance===performance&&op.owner===owner),cancelPerformance:performance=>cancel(op=>op.performance!==undefined&&(performance===null||op.performance===performance)),
    async initialize(){const token=capture();context.enable('pwm');if(initialized)return;await snapshot();current(token);initialized=true;},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid PWM mix');const token=capture();send({method:'mix',volume,pan});await synth.flush();current(token);},
    reset(){cancel(()=>true);context.invalidate();context.disable('pwm');initialized=false;mainGroup=undefined;clock=CHIP_CLOCKS.pwm;},
  };
}
export function createNativeGenesisExtraPwm(synth,options={}){return createNativeGenesisExtraChip(synth,{...options,kind:'pwm',label:'32X PWM',clock:CHIP_CLOCKS.pwm,createEndpoint:createNativeGenesisExtraPwmEndpoint});}
