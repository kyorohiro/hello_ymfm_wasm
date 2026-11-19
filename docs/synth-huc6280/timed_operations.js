// SPDX-License-Identifier: BSD-3-Clause
import {validateHuc6280RegisterOnlyPlan} from '../js/huc6280_operations.js';

/** Synth noteOn/off also run software envelopes. Register reservations use raw
 * gates explicitly. Wave RAM transfer is separate: its hardware playback cursor
 * is not part of the sent-register mirror. R6 remains valid for direct DAC data. */
export function validateHuc6280SynthPlan(plan,state) {
  for(const operation of plan.operations){
    if(['noteOn','noteOff'].includes(operation.method))throw Error('Synth register reservations use setNote + keyOn/keyOff; immediate noteOn/noteOff retain the Software Envelope.');
  }
  validateHuc6280RegisterOnlyPlan(plan,state);
}
