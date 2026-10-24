import {YM2413Synth} from './ym2413synth.js?v=audio-numeric-bindings-1';
import {attachChipClock,CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
/** Register-authoring controls shared by Main and Worker. Adoption never writes audio.
 * @param {(method:string,args:unknown[],metadata?:{intentMask:number})=>unknown} send
 * @param {{clock?:number,close?:()=>void,request?:(method:string,args:unknown[])=>unknown}} [options] */
export function createYm2413RegisterClient(send,{clock=CHIP_CLOCKS.ym2413,close=()=>{},request}={}){
  let initialized=false,disposed=false,rhythmIntent;
  const api=new YM2413Synth({clock,transport:{
    writeRegister(register,value){if(disposed)throw new Error('YM2413 disposed');send('writeRegister',[register,value],register===14&&rhythmIntent!==undefined?{intentMask:rhythmIntent}:undefined);},
    reset(){if(disposed)throw new Error('YM2413 disposed');send('reset',[]);},
  }});
  api.dispose=()=>{if(disposed)return;disposed=true;send('dispose',[]);close();};
  const initialize=api.initialize.bind(api);
  api.initialize=()=>{const result=initialize();initialized=true;return result;};
  const setRhythm=api.setRhythm.bind(api),allNotesOff=api.allNotesOff.bind(api);
  api.setRhythm=settings=>{const previous=rhythmIntent;rhythmIntent=['bassDrum','snare','tom','cymbal','hiHat'].reduce((mask,key,index)=>mask|(Object.hasOwn(settings??{},key)?16>>index:0),0);try{return setRhythm(settings);}finally{rhythmIntent=previous;}};
  api.allNotesOff=()=>{const previous=rhythmIntent;rhythmIntent=31;try{return allNotesOff();}finally{rhythmIntent=previous;}};
  Object.defineProperties(api,{
    _getState:{value:()=>({clock:api.clock,initialized,registers:Array.from(api.getRegisterSnapshot())})},
    _adoptState:{value:state=>{if(state?.registers)api.adoptRegisterSnapshot(state.registers);if(state?.clock!==undefined)api._adoptClock(state.clock);if(state?.initialized!==undefined)initialized=!!state.initialized;}},
    _forceKeyOff:{value:channel=>{const r=api.getRegisterSnapshot();r[0x20+channel]&=239;api.adoptRegisterSnapshot(r);send('forceKeyOff',[channel]);}},
    _forceRhythmOff:{value:index=>{const r=api.getRegisterSnapshot();r[0x0e]&=~(16>>index);api.adoptRegisterSnapshot(r);send('forceRhythmOff',[index]);}},
    _stopVoices:{value:()=>{const r=api.getRegisterSnapshot();for(let ch=0;ch<9;ch++)r[0x20+ch]&=239;r[0x0e]&=224;api.adoptRegisterSnapshot(r);return request?request('stopVoices',[]):api._requestControl('stopVoices',[]);}},
  });
  return api;
}

export function createYm2413Client(port,options={},lifecycle={}){
  const api=createYm2413RegisterClient((method,args,metadata)=>port.postMessage({method,args,...(options.native?metadata:{})}),{clock:options.clock??CHIP_CLOCKS.ym2413,close:()=>port.close()});
  const controlled=attachChipClock(api,port,options.clock??CHIP_CLOCKS.ym2413);
  if(options.native){
    if(options.state)api._adoptState(options.state);
    const setClock=api.setClock.bind(api),dispose=api.dispose.bind(api);let disposed=false;
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{if(disposed||lifecycle.isStopped?.(context))throw new Error('Run stopped');lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    api.setClock=hz=>{const context=lifecycle.captureContext?.();return setClock(hz).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};
    api.dispose=()=>{disposed=true;dispose();};
  }
  return controlled;
}
