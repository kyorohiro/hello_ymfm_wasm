import type {SidSynth,SidModel,SidState} from './sidsynth.js';

export interface SidRecordedOperation {
  readonly time:{readonly unit:'sample'|'seconds';readonly value:number};
  readonly order:number;
  readonly method:string;
  readonly args:readonly unknown[];
}
/** Serializable operations, without a captured SID state or JavaScript callback. */
export interface SidOperationProgram {
  readonly version:1;
  readonly chip:'sid';
  readonly referenceSampleRate:number;
  readonly operations:readonly SidRecordedOperation[];
}
type SidRecordedCalls<T>={readonly [K in keyof T]:T[K] extends (...args:infer A)=>unknown?(...args:A)=>SidOperationRecorder:never};
/** Absolute offsets from reservation start. Lifecycle methods remain immediate. */
export interface SidOperationRecorder extends SidRecordedCalls<Pick<SidSynth,
  'writeRegister'|'setVoice'|'setFilter'|'setFrequency'|'setNote'|'noteOn'|'keyOn'|'keyOff'|'noteOff'|'allNotesOff'>> {
  atSample(offset:number):SidOperationRecorder;
  atSeconds(offset:number):SidOperationRecorder;
}
export interface SidCompiledWrite {
  readonly offsetSeconds:number;
  readonly register:number;
  readonly value:number;
  readonly operationIndex:number;
  readonly writeIndex:number;
}
/** Write-side resolver metadata, not oscillator/envelope/C64 machine save state. */
export interface SidOperationState {
  readonly clock:number;
  readonly model:SidModel;
  readonly initialized:boolean;
  readonly registers:readonly number[];
}
export interface SidStateSnapshot {
  readonly format:'tetorica-sid-state';
  readonly version:1;
  readonly instanceId:string|number;
  readonly frame:number;
  readonly sampleRate:number;
  readonly state:SidOperationState;
}
export interface SidCompileOptions {
  /** current captures the renderer; client uses the authored shadow without RPC
   * and excludes later scheduled/renderer edits. reset is uninitialized hardware
   * state. A supplied snapshot is reusable and must match this instance/model. */
  initialState?:'current'|'client'|'reset'|SidStateSnapshot;
}
export interface SidScheduleOptions {name:string;repeatSeconds?:number;}
export interface SidScheduleReceipt {
  name:string;entries:number;sampleRate:number;startFrame?:number;repeatSeconds?:number;staged?:boolean;
}
export interface SidTimedApi {
  /** Run the callback once to record data; no SID reads, writes or scheduling. */
  build<Result>(callback:(builder:SidOperationRecorder)=>Result & (Result extends PromiseLike<unknown>?never:unknown),options?:{referenceSampleRate?:number}):SidOperationProgram;
  /** Coherent renderer resolver state without stopping audio. Web Audio only. */
  captureState():Promise<SidStateSnapshot>;
  /** Generate predicted writes on isolated state; this is not a playback trace. */
  compile(operations:SidOperationProgram,options?:SidCompileOptions):Promise<SidCompiledWrite[]>;
  /** Execute on the AudioWorklet sample clock; reject invalid replacement atomically. */
  schedule(operations:SidOperationProgram,options:SidScheduleOptions):Promise<SidScheduleReceipt>;
  clearSchedule(name:string):Promise<boolean>;
}
export interface SidTimedClientConfiguration {
  instanceId?:string|number;
  native?:boolean;
  getConfig?():{clock:number;model:SidModel};
  getClientState?():SidOperationState|SidState;
  request?(method:string,args:unknown[]):unknown|Promise<unknown>;
  validatePlan?(program:SidOperationProgram,state:SidOperationState):void;
}
/** Attach after the acknowledged control transport. No new audio graph/state sync. */
export function attachSidTimedClient<T extends {readonly clock:number;readonly model:SidModel}>(
  api:T,configuration?:SidTimedClientConfiguration,port?:MessagePort,
):T & SidTimedApi;
