import {AY8910Synth} from './ay8910synth.js';
import {attachChipClock,CHIP_CLOCKS} from './playground_chip_clock.js';
import {attachAyTimedClient} from './ay8910_timed_client.js';
/** Register-authoring controls. Adopting a Main/Worker snapshot never writes audio.
 * @param {(method:string,args:unknown[])=>unknown} send
 * @param {{clock?:number,close?:()=>void,request?:(method:string,args:unknown[])=>unknown,sendBatch?:(commands:any[])=>void}} [options] */
export function createAy8910RegisterClient(send,{clock=CHIP_CLOCKS.ay8910,close=()=>{},request,sendBatch}={}){
  let initialized=false,disposed=false,completeState=false;
  let pending=null;
  const emit=(method,args)=>{if(pending)pending.push({method,args});else send(method,args);};
  const api=new AY8910Synth({clock,transport:{
    writeRegister(register,value){if(disposed)throw new Error('AY8910 disposed');emit('writeRegister',[register,value]);},
    reset(){if(disposed)throw new Error('AY8910 disposed');emit('reset',[]);},
  }});
  api.dispose=()=>{if(disposed)return;disposed=true;send('dispose',[]);close();};
  const getState=api._getState.bind(api),adoptState=api._adoptState.bind(api),initialize=api.initialize.bind(api),reset=api.reset.bind(api),adoptRegisters=api.adoptRegisterSnapshot.bind(api);
  api.reset=()=>{const result=reset();completeState=true;return result;};
  api.adoptRegisterSnapshot=snapshot=>{const result=adoptRegisters(snapshot);completeState=false;return result;};
  api.initialize=()=>{const result=initialize();initialized=true;return result;};
  Object.defineProperties(api,{
    _getState:{value:()=>({...getState(),clock:api.clock,initialized})},
    _timedClientStateComplete:{get:()=>completeState},
    _adoptState:{value:state=>{adoptState({registers:state.registers,...(state.levels===undefined?{}:{levels:state.levels})});completeState=state.levels!==undefined;if(state?.clock!==undefined)api._adoptClock(state.clock);if(state?.initialized!==undefined)initialized=!!state.initialized;}},
    _forceKeyOff:{value:channel=>{if(!Number.isInteger(channel)||channel<0||channel>2)throw new RangeError('AY8910 channel must be 0..2');const state=getState(),complete=completeState;state.registers[8+channel]=0;adoptState(state);completeState=complete;send('forceKeyOff',[channel]);}},
    _stopVoices:{value:()=>{const state=getState(),complete=completeState;for(let ch=0;ch<3;ch++)state.registers[8+ch]=0;adoptState(state);completeState=complete;return request?request('stopVoices',[]):api._requestControl('stopVoices',[]);}},
  });
  // Raw zero volume also represents keyOff. Carry only changed retained
  // levels on the same ordered/scheduled port, so an explicit volume zero
  // remains zero in the editor without replaying any audio registers.
  let nesting=0;
  for(const method of ['initialize','reset','writeRegister','setVoice','tone','setTone','noise','setMixer','setVolume','setNoisePeriod','setEnvelope','setTonePeriod','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','off','allNotesOff']){
    const original=api[method].bind(api);api[method]=(...args)=>{
      const before=nesting++===0?getState().levels:null;
      if(before&&sendBatch)pending=[];
      try{const value=original(...args);if(before){const after=getState().levels;for(let ch=0;ch<3;ch++)if(before[ch]!==after[ch])emit('setRetainedLevel',[ch,after[ch]]);}return value;}
      finally{nesting--;if(before&&sendBatch){const commands=pending;pending=null;if(commands.length)sendBatch(commands);}}
    };
  }
  return api;
}

export function createAy8910Client(port,options={},lifecycle={}){
  const api=createAy8910RegisterClient((method,args)=>port.postMessage({method,args}),{clock:options.clock??CHIP_CLOCKS.ay8910,close:()=>port.close(),...(!options.native?{sendBatch:commands=>port.postMessage(commands)}:{})});
  const controlled=attachChipClock(api,port,options.clock??CHIP_CLOCKS.ay8910);
  if(options.native){
    if(options.state)api._adoptState(options.state);
    const setClock=api.setClock.bind(api),dispose=api.dispose.bind(api);let disposed=false;
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{if(disposed||lifecycle.isStopped?.(context))throw new Error('Run stopped');lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    api.setClock=hz=>{const context=lifecycle.captureContext?.();return setClock(hz).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};
    api.dispose=()=>{disposed=true;dispose();};
  }
  return attachAyTimedClient(controlled,options,port);
}
