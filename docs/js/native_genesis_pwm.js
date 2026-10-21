/** Native 32X PWM command adapter. Rendering and reservations stay in C++. */
import {readPwmInspector} from './playground_chip_inspector_state.js?v=audio-numeric-bindings-1';
import {CHIP_CLOCKS,validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';

const integer=(value,max,name)=>{if(!Number.isSafeInteger(value)||value<0||value>max)throw new RangeError(`Invalid PWM ${name}`);return value;};
const abort=()=>new DOMException('Native PWM operation was cancelled','AbortError');
const apiState=snapshot=>({model:'mame',outputMode:snapshot.outputMode,clock:snapshot.clock,sampleRate:snapshot.sampleRate,currentFrame:snapshot.currentFrame,queuedWrites:snapshot.queuedWrites});

export function createNativeGenesisPwm(synth){
  let clock=CHIP_CLOCKS.pwm,nextCommand=0,nextOrder=0,serial=Promise.resolve();
  const check=()=>{if(!synth.isReady())throw new Error('Native 32X audio is not ready');if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation)throw abort();};
  const allocate=()=>{if(nextCommand>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native PWM command identity limit reached');return ++nextCommand;};
  const timed=(message,timing={},immediate=false)=>({type:'pwm',message,frame:immediate||timing.time===undefined?0:synth.frameAt(timing.time),
    ...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  function normalize(method,args=[],timing={}){
    if(!Array.isArray(args))throw new TypeError('PWM arguments must be an array');
    if(['write','writeRegister'].includes(method)){
      const register=integer(args[0],4,'register');if(!Number.isInteger(args[1]))throw new RangeError('Invalid PWM register value');
      return {method:'write',register,value:args[1]&65535};
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
    throw new Error(`Unsupported Native PWM operation: ${method}`);
  }
  function validate(snapshot){
    validateChipClock(snapshot?.clock);integer(snapshot.sampleRate,1000000,'sample rate');integer(snapshot.currentFrame,Number.MAX_SAFE_INTEGER,'current frame');integer(snapshot.queuedWrites,1000000,'queue size');
    if(snapshot.model!=='mame'||!['dac','duty'].includes(snapshot.outputMode)||!Array.isArray(snapshot.registers)||snapshot.registers.length!==5||snapshot.registers.some(value=>!Number.isInteger(value)||value<0||value>65535))throw new Error('Native PWM returned an invalid snapshot');
    return snapshot;
  }
  async function snapshot(after){const token=capture();const value=await synth.nativeRequest('native_genesis_pwm_status',after===undefined?{}:{after});current(token);return validate(value);}
  async function perform(method,args=[],timing={},wait=false){
    const token=capture();if(method==='dispose')return undefined;
    const normalized=normalize(method,args,timing),reservation=method==='scheduleWrites',reading=['read','getState','barrier'].includes(method);
    // Reserve future Worker data now. Waiting for a 300 ms lookahead event to
    // reach the callback would exceed the applied-state timeout and stall RPC.
    const barrier=reservation||reading||wait,id=barrier?allocate():undefined;
    if(nextOrder>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native PWM command ordering limit reached');
    synth.enqueue(timed({...normalized,order:++nextOrder,...(id===undefined?{}:{id})},timing,reservation||reading||wait));
    await synth.flush();current(token);
    if(normalized.method==='clock')clock=normalized.hz;
    if(!barrier)return undefined;
    const applied=await snapshot(id);current(token);
    if(reservation){if(applied.lastSchedule?.id!==id)throw new Error('Native PWM reservation result was replaced');if(applied.lastSchedule.error)throw new RangeError(applied.lastSchedule.error);return applied.lastSchedule.baseFrame;}
    if(method==='read')return Number.isInteger(args[0])&&args[0]>=0&&args[0]<=4?applied.registers[args[0]]:65535;
    if(method==='getState')return apiState(applied);
    return applied;
  }
  async function ordered(operation){const token=capture(),result=serial.then(()=>{current(token);return operation();});serial=result.catch(()=>{});return result;}
  const client={id:'pwm',
    write:(register,value)=>ordered(()=>perform('write',[register,value])),writeRegister:(register,value)=>ordered(()=>perform('writeRegister',[register,value])),
    read:register=>ordered(()=>perform('read',[register])),reset:()=>ordered(()=>perform('reset')),
    scheduleWrites:entries=>{const copy=structuredClone(entries);return ordered(()=>perform('scheduleWrites',[copy]));},
    clearSchedule:()=>ordered(()=>perform('clearSchedule')),getState:()=>ordered(()=>perform('getState')),
    setClock:hz=>ordered(()=>perform('setClock',[hz])),dispose(){},
  };
  Object.defineProperties(client,{clock:{enumerable:true,get:()=>clock},_adoptClock:{value:hz=>{clock=validateChipClock(hz);}},
    stopVoices:{value:()=>ordered(()=>perform('stopVoices'))},
    _stopVoices:{value:()=>{if(synth.stopping)return synth.stopping;if(synth.closing||!synth.isReady())return Promise.resolve();return ordered(()=>perform('stopVoices'));}}});
  return {client,
    async dispatch(message,timing={}){
      const token=capture(),args=structuredClone(message.args??[]);
      const value=await ordered(()=>perform(message.method,args,timing));current(token);
      return message.id===undefined?undefined:{id:message.id,value};
    },
    async read(){const applied=await snapshot();return readPwmInspector({read:register=>applied.registers[register],getState:()=>apiState(applied)});},
    async invoke(method,args=[]){
      const token=capture(),copy=structuredClone(args);if(!['write','writeRegister','reset'].includes(method))throw new Error('Unsupported Native PWM inspector operation');
      return ordered(async()=>{current(token);const applied=await perform(method,copy,{},true);return readPwmInspector({read:register=>applied.registers[register],getState:()=>apiState(applied)});});
    },
    mix(volume,pan){check();synth.enqueue(timed({method:'mix',volume,pan}));return synth.flush();},
    stopped(){},adoptStopped(applied){validate(applied);clock=applied.clock;},reset(){clock=CHIP_CLOCKS.pwm;},
  };
}
