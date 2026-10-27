import {PokeySynth,POKEY_CLOCK} from './pokeysynth.js?v=pokey-mode-1';
import {attachChipClock} from './playground_chip_clock.js?v=pokey-mode-1';

/** Applied snapshots are adopted without replaying register writes.
 * @param {(method:string,args:any[],channel?:number)=>void} send
 * @param {{clock?:number,close?:()=>void,request?:(method:string,args?:any[])=>Promise<any>}} [options] */
export function createPokeyRegisterClient(send,{clock=POKEY_CLOCK,close=()=>{},request}={}){
  let disposed=false;
  const api=new PokeySynth({clock,transport:{
    writeRegister(register,value,channel){if(disposed)throw new Error('POKEY disposed');send('writeRegister',[register,value],channel);},
    reset(){if(disposed)throw new Error('POKEY disposed');send('reset',[]);},
  }});
  const getState=api._getState.bind(api),adoptState=api._adoptState.bind(api),disposeSynth=api.dispose.bind(api);
  api.dispose=()=>{if(disposed)return;disposed=true;try{disposeSynth();send('dispose',[]);}finally{close();}};
  const control=(method,args=[])=>{if(disposed)throw new Error('POKEY disposed');return request?request(method,args):api._requestControl(method,args);};
  Object.defineProperties(api,{
    _adoptState:{value:state=>{if(state.clock!==undefined&&state.clock!==api.clock)api._adoptClock?.(state.clock);adoptState({...state,initialized:state.initialized??true,levels:state.levels??getState().levels});}},
    _forceKeyOff:{value:channel=>{if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('POKEY channel must be 0..3');const state=getState();state.registers[channel*2+1]&=240;adoptState(state);send('forceKeyOff',[channel],channel);}},
    _stopVoices:{value:()=>{const state=getState();for(let ch=0;ch<4;ch++)state.registers[ch*2+1]&=240;adoptState(state);return control('stopVoices');}},
  });
  api.readRegister=register=>{if(!Number.isInteger(register)||register<0||register>15)throw new RangeError('POKEY register must be 0..15');return control('readRegister',[register]);};
  api.setChannelMuted=(ch,muted)=>{if(!Number.isInteger(ch)||ch<0||ch>3||typeof muted!=='boolean')throw new TypeError('Expected POKEY channel 0..3 and boolean mute');return control('setChannelMuted',[ch,muted]);};
  let nesting=0;
  for(const method of ['initialize','reset','writeRegister','setFrequency','setNote','setVolume','setDistortion','setVolumeOnly','setHighClock','setJoined','setBaseClock','setPoly9','keyOn','keyOff','noteOn','allNotesOff']){
    const original=api[method].bind(api);api[method]=(...args)=>{
      if(disposed)throw new Error('POKEY disposed');
      const before=nesting++===0?getState().levels:null;
      try{const result=original(...args);if(before){const after=getState().levels;for(let ch=0;ch<4;ch++)if(before[ch]!==after[ch])send('setRetainedLevel',[ch,after[ch]],ch);}return result;}
      finally{nesting--;}
    };
  }
  return api;
}

export function createPokeyClient(port,options={},lifecycle={}){
  const api=createPokeyRegisterClient((method,args,channel)=>port.postMessage({method,args,...(channel===undefined?{}:{channel})}),{
    clock:options.clock??POKEY_CLOCK,close:()=>port.close(),
  });
  const controlled=attachChipClock(api,port,options.clock??POKEY_CLOCK);
  if(options.state)api._adoptState(options.state);
  return controlled;
}
