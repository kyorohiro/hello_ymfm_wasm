// SPDX-License-Identifier: BSD-3-Clause
import {
	validateVsuOperations, validateVsuScheduleName, validateVsuScheduleOptions,
	validateVsuScheduleOwner, validateVsuScheduleTransaction,
} from './timed-operations.js?v=vsu-note-gate';
import {createRegisterTimedProcessor} from '../js/register_timed_processor.js';
export function createVsuTimedProcessor(options){
  return createRegisterTimedProcessor({...options,defaultOwner:'vsu:client',checkAvailable(){
    if(options.vgmOwnsOutput())throw Error('Stop the VGM before scheduling the Synth.');
  }},{
    validateOperations:validateVsuOperations,
    validateScheduleName:validateVsuScheduleName,
    validateScheduleOptions:validateVsuScheduleOptions,
    validateScheduleOwner:validateVsuScheduleOwner,
    validateScheduleTransaction:validateVsuScheduleTransaction,
  });
}
