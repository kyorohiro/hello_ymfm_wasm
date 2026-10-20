import {AY8910Synth} from './ay8910synth.js?v=msx-modes-2';
import {attachChipClock,CHIP_CLOCKS} from './playground_chip_clock.js?v=msx-modes-2';
/** Register-authoring controls. Adopting a Main/Worker snapshot never writes audio.
 * @param {MessagePort} port @param {{clock?:number}} [options] */
export function createAy8910Client(port,{clock=CHIP_CLOCKS.ay8910}={}){
  let initialized=false,disposed=false;
  const api=new AY8910Synth({clock,transport:{
    writeRegister(register,value){if(disposed)throw new Error('AY8910 disposed');port.postMessage({method:'writeRegister',args:[register,value]});},
    reset(){if(disposed)throw new Error('AY8910 disposed');port.postMessage({method:'reset',args:[]});},
  }});
  api.dispose=()=>{if(disposed)return;disposed=true;port.postMessage({method:'dispose',args:[]});port.close();};
  const getState=api._getState.bind(api),adoptState=api._adoptState.bind(api),controlled=attachChipClock(api,port,clock),initialize=api.initialize.bind(api);
  api.initialize=()=>{const result=initialize();initialized=true;return result;};
  Object.defineProperties(api,{
    _getState:{value:()=>({...getState(),clock:api.clock,initialized})},
    _adoptState:{value:state=>{adoptState({registers:state.registers,...(state.levels===undefined?{}:{levels:state.levels})});if(state?.clock!==undefined)api._adoptClock(state.clock);if(state?.initialized!==undefined)initialized=!!state.initialized;}},
    _forceKeyOff:{value:channel=>{if(!Number.isInteger(channel)||channel<0||channel>2)throw new RangeError('AY8910 channel must be 0..2');const state=getState();state.registers[8+channel]=0;adoptState(state);port.postMessage({method:'forceKeyOff',args:[channel]});}},
    _stopVoices:{value:()=>{const state=getState();for(let ch=0;ch<3;ch++)state.registers[8+ch]=0;adoptState(state);return controlled._requestControl('stopVoices');}},
  });
  // Raw zero volume also represents keyOff. Carry only changed retained
  // levels on the same ordered/scheduled port, so an explicit volume zero
  // remains zero in the editor without replaying any audio registers.
  let nesting=0;
  for(const method of ['initialize','reset','writeRegister','setVoice','tone','setTone','noise','setMixer','setVolume','setNoisePeriod','setEnvelope','setTonePeriod','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','off','allNotesOff']){
    const original=api[method].bind(api);api[method]=(...args)=>{
      const before=nesting++===0?getState().levels:null;
      try{const value=original(...args);if(before){const after=getState().levels;for(let ch=0;ch<3;ch++)if(before[ch]!==after[ch])port.postMessage({method:'setRetainedLevel',args:[ch,after[ch]]});}return value;}
      finally{nesting--;}
    };
  }
  return controlled;
}
