import {OPLSynth} from './opl_synth.js?v=msx-modes-2';
import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=msx-modes-2';

export const OPL_CHIPS = Object.freeze(['ym3526','ym3812','y8950','ymf262']);
/** A register-authoring client; Main and Worker use the same Synth and shadow.
 * Construction and adoption never replay registers into the audio processor.
 * @param {MessagePort} port
 * @param {{chip?:'ym3526'|'ym3812'|'y8950'|'ymf262',clock?:number}} [options] */
export function createOplClient(port, {chip = 'ym3812', clock = CHIP_CLOCKS[chip]} = {}) {
  let initialized = false, disposed = false;
  const synth = new OPLSynth({chip, clock, transport:{
    writeRegister(register,value,bank=0) {if(disposed)throw new Error('OPL disposed');port.postMessage({method:'writeRegister',args:[register,value,bank]});},
    reset() {if(disposed)throw new Error('OPL disposed');port.postMessage({method:'reset',args:[]});},
    dispose() {port.postMessage({method:'dispose',args:[]});port.close();},
  }});
  synth.dispose = () => {if(disposed)return;synth.transport.dispose();disposed=true;};
  const controlled = attachChipClock(synth,port,clock);
  const initialize = synth.initialize.bind(synth);
  synth.initialize = () => {const result = initialize();initialized=true;return result;};
  Object.defineProperties(synth, {
    _getState:{value:() => ({chip,clock:synth.clock,initialized,registers:Array.from(synth.getRegisterSnapshot())})},
    _adoptState:{value:state => {
      if (state?.registers) synth.adoptRegisterSnapshot(state.registers);
      if (state?.clock !== undefined) synth._adoptClock(state.clock);
      if (state?.initialized !== undefined) initialized = !!state.initialized;
    }},
    _forceKeyOff:{value:channel => {
      const registers=synth.getRegisterSnapshot(),address=(channel>=9?256:0)+0xb0+channel%9;
      registers[address]&=223;if(synth.isFourOp(channel))registers[address+3]&=223;synth.adoptRegisterSnapshot(registers);port.postMessage({method:'forceKeyOff',args:[channel]});
    }},
    _stopVoices:{value:() => {
      const registers = synth.getRegisterSnapshot();
      for (let channel=0;channel<synth.channels;channel++) registers[(channel>=9?256:0)+0xb0+channel%9]&=223;
      registers[0xbd]&=224;synth.adoptRegisterSnapshot(registers);
      return controlled._requestControl('stopVoices');
    }},
  });
  return controlled;
}
