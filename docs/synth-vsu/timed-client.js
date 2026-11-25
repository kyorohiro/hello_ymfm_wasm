// SPDX-License-Identifier: BSD-3-Clause
import {
	buildVsuOperations,
	validateVsuOperations,
	validateVsuScheduleName,
	validateVsuScheduleOptions,
	validateVsuScheduleOwner,
	validateVsuScheduleTransaction,
	validateVsuTimedFields,
} from './timed-operations.js?v=vsu-note-gate';
import {attachRegisterTimedClient} from '../js/register_timed_client.js';
export function attachVsuTimedClient(api, request){
  return attachRegisterTimedClient(api, request,{
    buildOperations:buildVsuOperations,
    validateOperations:validateVsuOperations,
    validateScheduleName:validateVsuScheduleName,
    validateScheduleOptions:validateVsuScheduleOptions,
    validateScheduleOwner:validateVsuScheduleOwner,
    validateScheduleTransaction:validateVsuScheduleTransaction,
    validateTimedFields:validateVsuTimedFields,
  });
}
