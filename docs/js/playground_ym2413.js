import {YM2413Synth} from './ym2413synth.js?v=msx-modes-2';
import {attachChipClock,CHIP_CLOCKS} from './playground_chip_clock.js?v=msx-modes-2';
/** Register-authoring controls shared by Main and Worker. Adoption never writes audio.
 * @param {MessagePort} port @param {{clock?:number}} [options] */
export function createYm2413Client(port,{clock=CHIP_CLOCKS.ym2413}={}){
  let initialized=false,disposed=false;
  const api=new YM2413Synth({clock,transport:{
    writeRegister(register,value){if(disposed)throw new Error('YM2413 disposed');port.postMessage({method:'writeRegister',args:[register,value]});},
    reset(){if(disposed)throw new Error('YM2413 disposed');port.postMessage({method:'reset',args:[]});},
  }});
  api.dispose=()=>{if(disposed)return;disposed=true;port.postMessage({method:'dispose',args:[]});port.close();};
  const controlled=attachChipClock(api,port,clock),initialize=api.initialize.bind(api);
  api.initialize=()=>{const result=initialize();initialized=true;return result;};
  Object.defineProperties(api,{
    _getState:{value:()=>({clock:api.clock,initialized,registers:Array.from(api.getRegisterSnapshot())})},
    _adoptState:{value:state=>{if(state?.registers)api.adoptRegisterSnapshot(state.registers);if(state?.clock!==undefined)api._adoptClock(state.clock);if(state?.initialized!==undefined)initialized=!!state.initialized;}},
    _forceKeyOff:{value:channel=>{const r=api.getRegisterSnapshot();r[0x20+channel]&=239;api.adoptRegisterSnapshot(r);port.postMessage({method:'forceKeyOff',args:[channel]});}},
    _forceRhythmOff:{value:index=>{const r=api.getRegisterSnapshot();r[0x0e]&=~(16>>index);api.adoptRegisterSnapshot(r);port.postMessage({method:'forceRhythmOff',args:[index]});}},
    _stopVoices:{value:()=>{const r=api.getRegisterSnapshot();for(let ch=0;ch<9;ch++)r[0x20+ch]&=239;r[0x0e]&=224;api.adoptRegisterSnapshot(r);return controlled._requestControl('stopVoices');}},
  });
  return controlled;
}
