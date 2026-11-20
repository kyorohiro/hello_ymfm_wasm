import {readFile, writeFile} from 'node:fs/promises';
import {basename} from 'node:path';

// Supply missing destructured-option shapes during declaration inference.
// Restore the original staged JavaScript when TypeScript finishes or fails.
const annotations = {
  'ps1_timed_client.js': [
    ['export function attachPs1TimedClient(', String.raw`/** @template T
 * @param {T} api
 * @param {any} [configuration]
 * @param {any} [port]
 * @returns {T & {build:typeof import('./ps1_operations.js').buildPs1Operations,captureState:()=>Promise<ReturnType<typeof import('./ps1_timed_state.js').createPs1TimedSnapshot>>,compile:(operations:any,options?:any)=>Promise<any[]>,schedule:(operations:any,options:any)=>Promise<any>,clearSchedule:(name:string)=>Promise<boolean>}}
 */`],
  ],
  'ps1_timed_state.js': [
    ['export function createPs1TimedSnapshot(',
      '/** @param {any} state\n * @param {{instanceId:string|number,frame:number,sampleRate:number}} [options]\n */'],
  ],
  'wonderswan_operations.js': [
    ['export function buildWonderSwanOperations(', String.raw`/**
 * @typedef {Object} WonderSwanOperationRecorder
 * @property {(offset:number)=>WonderSwanOperationRecorder} atSample
 * @property {(offset:number)=>WonderSwanOperationRecorder} atSeconds
 * @property {(channel:0|1|2|3,left:number,right?:number)=>WonderSwanOperationRecorder} setVolume
 * @property {(channel:0|1|2|3,left:number,right?:number)=>WonderSwanOperationRecorder} setPan
 * @property {(channel:0|1|2|3,hz:number)=>WonderSwanOperationRecorder} setFrequency
 * @property {(channel:0|1|2|3,note:string|number)=>WonderSwanOperationRecorder} setNote
 * @property {(options:{enabled:boolean,type?:0|1|2|3|4|5|6|7,reset?:boolean})=>WonderSwanOperationRecorder} setNoise
 * @property {(options:{enabled:boolean,step?:number,time?:number})=>WonderSwanOperationRecorder} setSweep
 * @property {(channel:0|1|2|3)=>WonderSwanOperationRecorder} keyOn
 * @property {(channel:0|1|2|3)=>WonderSwanOperationRecorder} keyOff
 */
/** @template Result
 * @param {(builder:WonderSwanOperationRecorder)=>Result & (Result extends PromiseLike<unknown>?never:unknown)} callback
 * @param {{referenceSampleRate?:number}} [options]
 * @returns {{version:1,chip:'wonderswan',referenceSampleRate:number,operations:Array<{time:{unit:'sample'|'seconds',value:number},order:number,method:string,args:unknown[]}>}}
 */`],
    ['export function compileWonderSwanOperations(', String.raw`/**
 * @param {ReturnType<typeof buildWonderSwanOperations>} plan
 * @param {any} state
 * @param {{clock?:number}} [options]
 * @returns {Array<{offsetSeconds:number,register:number,value:number,operationIndex:number,writeIndex:number,channel?:0|1|2|3,controlMask?:number}>}
 */`],
  ],
  'wonderswan_timed_client.js': [
    ['export function attachWonderSwanTimedClient(', String.raw`/**
 * @typedef {Object} WonderSwanTimedApi
 * @property {typeof import('./wonderswan_operations.js').buildWonderSwanOperations} build
 * @property {()=>Promise<ReturnType<typeof import('./wonderswan_timed_state.js').createWonderSwanTimedSnapshot>>} captureState
 * @property {(operations:ReturnType<WonderSwanTimedApi['build']>,options?:{initialState?:'current'|'client'|'reset'|Awaited<ReturnType<WonderSwanTimedApi['captureState']>>})=>Promise<ReturnType<typeof import('./wonderswan_operations.js').compileWonderSwanOperations>>} compile
 * @property {(operations:ReturnType<WonderSwanTimedApi['build']>,options:{name:string,repeatSeconds?:number})=>Promise<{name:string,entries:number,sampleRate:number,startFrame?:number,repeatSeconds?:number,staged?:boolean}>} schedule
 * @property {(name:string)=>Promise<boolean>} clearSchedule
 */
/** @template T
 * @param {T} api
 * @param {{instanceId?:string|number,native?:boolean}} [configuration]
 * @param {any} [port]
 * @returns {T & WonderSwanTimedApi}
 */`],
  ],
  'playground_wonderswan.js': [
    ['export function createWonderSwanClient(', String.raw`/** @param {any} port
 * @param {{clock?:number,instanceId?:string|number,native?:boolean}} [options]
 * @param {any} [lifecycle]
 * @returns {import('./wonderswansynth.js').WonderSwanSynth & import('./wonderswan_timed_client.js').WonderSwanTimedApi & {setClock(hz:number):Promise<unknown>}}
 */`],
    ['export function createPrimaryWonderSwanApi(', String.raw`/** @param {any} raw
 * @returns {Omit<ReturnType<typeof createWonderSwanClient>,'dispose'> & {readonly id:string}}
 */`],
  ],

  'wonderswan_timed_state.js': [
    ['export function createWonderSwanTimedSnapshot(', String.raw`/** @param {any} state
 * @param {{instanceId:string|number,frame:number,sampleRate:number}} [options]
 * @returns {Readonly<{format:'tetorica-wonderswan-state',version:1,instanceId:string|number,frame:number,sampleRate:number,state:Readonly<{clock:number,initialized:boolean,registers:readonly number[],memory:readonly number[]}>}>}
 */`],
  ],
  'huc6280_timed_state.js': [
    ['export function createHuc6280TimedSnapshot(',
      '/** @param {any} state\n' +
      ' * @param {{instanceId: string | number, frame: number, sampleRate: number}} [options]\n' +
      ' */'],
  ],
  'ay8910_timed_state.js': [
    ['export function createAyTimedSnapshot(',
      '/** @param {any} state\n' +
      ' * @param {{instanceId: string | number, clock: number, type?: number, flags?: number, frame: number, sampleRate: number}} [options]\n' +
      ' */'],
  ],
  'playground_performance_queue.js': [
    ['  function clearPattern(',
      '  /** @param {string} name\n' +
      '   * @param {{session?: number, owner?: string}} [scope]\n' +
      '   */'],
    ['  function cancelPatternOwner(',
      '  /** @param {string} owner\n' +
      '   * @param {{session?: number}} [scope]\n' +
      '   */'],
    ['  function commitPatterns(',
      '  /** @param {any} changes\n' +
      '   * @param {{session: number, owner: string, dryRun?: boolean}} [context]\n' +
      '   * @param {(message: any) => void} [reply]\n' +
      '   */'],
  ],
};

/** Infer declarations with local import URLs and complete option types. */
export async function withFm2612DeclarationSources(files, emit) {
  const originals = [];
  try {
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      let typedSource = source.replace(/(\.m?js)\?[^'"\s]+(?=['"])/g, '$1');
      for (const [signature, comment] of annotations[basename(file)] ?? []) {
        if (!typedSource.includes(signature)) {
          throw new Error(`Missing declaration annotation target in ${file}: ${signature.trim()}`);
        }
        typedSource = typedSource.replace(signature, `${comment}\n${signature}`);
      }
      if (typedSource !== source) {
        originals.push([file, source]);
        await writeFile(file, typedSource);
      }
    }
    return await emit();
  } finally {
    for (const [file, source] of originals) await writeFile(file, source);
  }
}
