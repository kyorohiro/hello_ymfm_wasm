// SPDX-License-Identifier: BSD-3-Clause
import {createHuc6280OperationResolver} from '../js/huc6280_operations.js';

/** Synth noteOn/off also run software envelopes. Register reservations use raw
 * gates explicitly. Wave RAM transfer is separate: its hardware playback cursor
 * is not part of the sent-register mirror. R6 remains valid for direct DAC data. */
export function validateHuc6280SynthPlan(plan,state) {
  const resolver=createHuc6280OperationResolver({clock:state.clock});
  let work=state;
  for(const operation of plan.operations){
    if(['noteOn','noteOff'].includes(operation.method))throw Error('Synth register reservations use setNote + keyOn/keyOff; immediate noteOn/noteOff retain the Software Envelope.');
    if(operation.method==='writeRegister'&&operation.args[0]===6&&!(work.registers[work.selectedChannel][4]&64))throw Error('Scheduled Wave RAM transfer is not supported; use setWaveform immediately, or enable DDA before writing R6.');
    work=resolver.resolve(operation,work).state;
  }
}
