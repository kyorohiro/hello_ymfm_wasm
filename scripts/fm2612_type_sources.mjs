import {readFile, writeFile} from 'node:fs/promises';
import {basename} from 'node:path';

// Supply missing destructured-option shapes during declaration inference.
// Restore the original staged JavaScript when TypeScript finishes or fails.
const annotations = {
  'sid_operations.js': [
    ['export function buildSidOperations(', String.raw`/** @template Result
 * @param {(builder:import('./sid_timed_client.js').SidOperationRecorder)=>Result & (Result extends PromiseLike<unknown>?never:unknown)} callback
 * @param {{referenceSampleRate?:number}} [options]
 * @returns {import('./sid_timed_client.js').SidOperationProgram}
 */`],
    ['export function compileSidOperations(', String.raw`/**
 * @param {import('./sid_timed_client.js').SidOperationProgram} plan
 * @param {any} state
 * @param {{clock?:number,model?:'6581'|'8580'}} [options]
 * @returns {import('./sid_timed_client.js').SidCompiledWrite[]}
 */`],
  ],
  'sid_timed_state.js': [
    ['export function createSidTimedSnapshot(', String.raw`/** @param {any} state
 * @param {{instanceId:string|number,frame:number,sampleRate:number}} [options]
 * @returns {import('./sid_timed_client.js').SidStateSnapshot}
 */`],
  ],
  'gameboy_operations.js': [
    ['export function buildGameboyOperations(', String.raw`/**
 * @typedef {Object} GameboyOperationRecorder
 * @property {(offset:number)=>GameboyOperationRecorder} atSample
 * @property {(offset:number)=>GameboyOperationRecorder} atSeconds
 * @property {(register:number,value:number)=>GameboyOperationRecorder} writeRegister
 * @property {(channel:0|1|2,hz:number)=>GameboyOperationRecorder} setFrequency
 * @property {(channel:0|1|2,note:string|number)=>GameboyOperationRecorder} setNote
 * @property {(channel:0|1|2,note:string|number)=>GameboyOperationRecorder} noteOn
 * @property {(channel:0|1|2|3)=>GameboyOperationRecorder} keyOn
 * @property {(channel:0|1|2|3)=>GameboyOperationRecorder} keyOff
 * @property {(channel:0|1|2|3,left:boolean,right:boolean)=>GameboyOperationRecorder} setPan
 * @property {(left:number,right:number)=>GameboyOperationRecorder} setMasterVolume
 * @property {{setVoice:(channel:0|1,voice:import('./gameboysynth.js').GameboyPulseVoice)=>GameboyOperationRecorder,setDuty:(channel:0|1,duty:0.125|0.25|0.5|0.75)=>GameboyOperationRecorder,setEnvelope:(channel:0|1,options:import('./gameboysynth.js').GameboyEnvelopeSettings)=>GameboyOperationRecorder,setSweep:(options:import('./gameboysynth.js').GameboySweep)=>GameboyOperationRecorder,setFrequency:(channel:0|1,hz:number)=>GameboyOperationRecorder,setNote:(channel:0|1,note:string|number)=>GameboyOperationRecorder,noteOn:(channel:0|1,note:string|number)=>GameboyOperationRecorder,keyOn:(channel:0|1)=>GameboyOperationRecorder,keyOff:(channel:0|1)=>GameboyOperationRecorder}} pulse
 * @property {{setWaveform:(samples:readonly number[]|Uint8Array)=>GameboyOperationRecorder,stopAndSetWaveform:(samples:readonly number[]|Uint8Array)=>GameboyOperationRecorder,setLevel:(level:0|0.25|0.5|1)=>GameboyOperationRecorder,setFrequency:(hz:number)=>GameboyOperationRecorder,setNote:(note:string|number)=>GameboyOperationRecorder,noteOn:(note:string|number)=>GameboyOperationRecorder,keyOn:()=>GameboyOperationRecorder,keyOff:()=>GameboyOperationRecorder}} wave
 * @property {{setVoice:(voice:import('./gameboysynth.js').GameboyNoiseVoice)=>GameboyOperationRecorder,setEnvelope:(options:import('./gameboysynth.js').GameboyEnvelopeSettings)=>GameboyOperationRecorder,setParameters:(options:Pick<import('./gameboysynth.js').GameboyNoiseVoice,'divisor'|'shift'|'width'>)=>GameboyOperationRecorder,keyOn:()=>GameboyOperationRecorder,keyOff:()=>GameboyOperationRecorder}} noise
 */
/** @template Result
 * @param {(builder:GameboyOperationRecorder)=>Result & (Result extends PromiseLike<unknown>?never:unknown)} callback
 * @param {{referenceSampleRate?:number}} [options]
 * @returns {Readonly<{version:1,chip:'gameboy',referenceSampleRate:number,operations:ReadonlyArray<{time:{unit:'sample'|'seconds',value:number},order:number,method:string,args:ReadonlyArray<unknown>}>}>}
 */`],
    ['export function compileGameboyOperations(', String.raw`/**
 * @param {ReturnType<typeof buildGameboyOperations>} plan
 * @param {any} state
 * @param {{clock?:number}} [options]
 * @returns {Array<{offsetSeconds:number,register:number,value:number,operationIndex:number,writeIndex:number}>}
 */`],
  ],
  'gameboy_timed_state.js': [
    ['export function createGameboyTimedSnapshot(', String.raw`/** @param {any} state
 * @param {{instanceId:string|number,frame:number,sampleRate:number}} [options]
 * @returns {Readonly<{format:'tetorica-gameboy-state',version:1,instanceId:string|number,frame:number,sampleRate:number,state:Readonly<{clock:number,initialized:boolean,registers:readonly number[],voice:readonly number[]}>}>}
 */`],
  ],
  'gameboy_timed_client.js': [
    ['export function attachGameboyTimedClient(', String.raw`/**
 * @typedef {Object} GameboyTimedApi
 * @property {typeof import('./gameboy_operations.js').buildGameboyOperations} build
 * @property {()=>Promise<ReturnType<typeof import('./gameboy_timed_state.js').createGameboyTimedSnapshot>>} captureState
 * @property {(operations:ReturnType<GameboyTimedApi['build']>,options?:{initialState?:'current'|'client'|'reset'|Awaited<ReturnType<GameboyTimedApi['captureState']>>})=>Promise<ReturnType<typeof import('./gameboy_operations.js').compileGameboyOperations>>} compile
 * @property {(operations:ReturnType<GameboyTimedApi['build']>,options:{name:string,repeatSeconds?:number})=>Promise<{name:string,entries:number,sampleRate:number,startFrame?:number,repeatSeconds?:number,staged?:boolean}>} schedule
 * @property {(name:string)=>Promise<boolean>} clearSchedule
 */
/** @template T
 * @param {T} api
 * @param {{instanceId?:string|number,native?:boolean,getClientState?:()=>any,validatePlan?:(program:any,state:any)=>unknown}} [configuration]
 * @param {any} [port]
 * @returns {T & GameboyTimedApi}
 */`],
  ],
  'playground_gameboy.js': [
    ['export function createGameboyClient(', String.raw`/** @param {any} port
 * @param {{clock?:number,instanceId?:string|number,native?:boolean,primary?:boolean}} [options]
 * @param {any} [lifecycle]
 * @returns {import('./gameboysynth.js').GameboySynth & import('./gameboy_timed_client.js').GameboyTimedApi & {setClock(hz:number):Promise<unknown>}}
 */`],
    ['export function createPrimaryGameboyApi(', String.raw`/** @param {any} raw
 * @returns {Omit<ReturnType<typeof createGameboyClient>,'dispose'> & {readonly id:string}}
 */`],
  ],
  'segapsg_operations.js': [
    ['export function buildPsgOperations(', String.raw`/**
 * @typedef {Object} PsgOperationRecorder
 * @property {(offset:number)=>PsgOperationRecorder} atSample
 * @property {(offset:number)=>PsgOperationRecorder} atSeconds
 * @property {(channel:0|1|2,period:number)=>PsgOperationRecorder} setPeriod
 * @property {(channel:0|1|2,hz:number)=>PsgOperationRecorder} setFrequency
 * @property {(channel:0|1|2,note:string|number)=>PsgOperationRecorder} setNote
 * @property {(channel:0|1|2,note:string|number)=>PsgOperationRecorder} noteOn
 * @property {(channel:0|1|2,options:{period?:number,frequency?:number,note?:string,volume?:number,attenuation?:number})=>PsgOperationRecorder} tone
 * @property {(channel:0|1|2)=>PsgOperationRecorder} keyOn
 * @property {(channel:0|1|2)=>PsgOperationRecorder} keyOff
 * @property {(channel:0|1|2)=>PsgOperationRecorder} off
 * @property {(channel:0|1|2|3,attenuation:number)=>PsgOperationRecorder} setAttenuation
 * @property {(options?:{type?:'white'|'periodic',rate?:'low'|'medium'|'high'|'tone3'})=>PsgOperationRecorder} setNoise
 * @property {(options?:{type?:'white'|'periodic',rate?:'low'|'medium'|'high'|'tone3',volume?:number,attenuation?:number})=>PsgOperationRecorder} noise
 * @property {(volume:number)=>PsgOperationRecorder} noiseVolume
 * @property {()=>PsgOperationRecorder} noiseOff
 * @property {(mask:number)=>PsgOperationRecorder} setStereo
 * @property {(value:number)=>PsgOperationRecorder} write
 */
/** @template Result
 * @param {(builder:PsgOperationRecorder)=>Result & (Result extends PromiseLike<unknown>?never:unknown)} callback
 * @param {{referenceSampleRate?:number}} [options]
 * @returns {Readonly<{version:1,chip:'segapsg',referenceSampleRate:number,operations:ReadonlyArray<{time:{unit:'sample'|'seconds',value:number},order:number,method:string,args:ReadonlyArray<unknown>}>}>}
 */`],
    ['export function compilePsgOperations(', String.raw`/** @param {ReturnType<typeof buildPsgOperations>} plan
 * @param {any} state
 * @param {{clock?:number,stereoEnabled?:boolean}} [options]
 * @returns {Array<{offsetSeconds:number,operationIndex:number,writeIndex:number}&({value:number,register:number,channel:number}|{stereo:number})>}
 */`],
    ['export function createPsgOperationResetState(', String.raw`/** @param {{clock?:number,stereoEnabled?:boolean}} [options] */`],
  ],
  'segapsg_timed_state.js': [
    ['export function createPsgTimedSnapshot(', String.raw`/** @param {any} state
 * @param {{instanceId:string|number,frame:number,sampleRate:number}} [options]
 * @returns {Readonly<{format:'tetorica-psg-state',version:1,instanceId:string|number,frame:number,sampleRate:number,state:Readonly<{clock:number,stereoEnabled:boolean,periods:readonly number[],attenuations:readonly number[],latched:number,noiseMode:number,stereo:number}>}>}
 */`],
  ],
  'segapsg_timed_client.js': [
    ['export function attachPsgTimedClient(', String.raw`/**
 * @typedef {Object} PsgTimedApi
 * @property {typeof import('./segapsg_operations.js').buildPsgOperations} build
 * @property {()=>Promise<ReturnType<typeof import('./segapsg_timed_state.js').createPsgTimedSnapshot>>} captureState
 * @property {(operations:ReturnType<PsgTimedApi['build']>,options?:{initialState?:'current'|'client'|'reset'|Awaited<ReturnType<PsgTimedApi['captureState']>>})=>Promise<ReturnType<typeof import('./segapsg_operations.js').compilePsgOperations>>} compile
 * @property {(operations:ReturnType<PsgTimedApi['build']>,options:{name:string,repeatSeconds?:number})=>Promise<{name:string,entries:number,sampleRate:number,startFrame?:number,repeatSeconds?:number,staged?:boolean}>} schedule
 * @property {(name:string)=>Promise<boolean>} clearSchedule
 */
/** @template T
 * @param {T} api
 * @param {any} [configuration]
 * @param {any} [port]
 * @returns {T & PsgTimedApi}
 */`],
  ],
  'ym2413_operations.js': [
    ['export function buildOpllOperations(', String.raw`/**
 * @typedef {0|1|2|3|4|5|6|7|8} OpllOperationChannel
 * @typedef {{label?:string,feedback?:number,operators?:[import('./ym2413synth.js').YM2413UserOperatorParams?,Omit<import('./ym2413synth.js').YM2413UserOperatorParams,'tl'>?]}} OpllOperationUserPatch
 * @typedef {Object} OpllOperationRecorder
 * @property {(offset:number)=>OpllOperationRecorder} atSample
 * @property {(offset:number)=>OpllOperationRecorder} atSeconds
 * @property {(register:number,value:number)=>OpllOperationRecorder} writeRegister
 * @property {(patch:OpllOperationUserPatch|number[])=>OpllOperationRecorder} setUserPatch
 * @property {((operator:0,params:import('./ym2413synth.js').YM2413UserOperatorParams)=>OpllOperationRecorder)&((operator:1,params:Omit<import('./ym2413synth.js').YM2413UserOperatorParams,'tl'>)=>OpllOperationRecorder)} setUserOperator
 * @property {(channel:OpllOperationChannel,voice:import('./ym2413synth.js').YM2413Voice)=>OpllOperationRecorder} setVoice
 * @property {(channel:OpllOperationChannel,preset:number|(import('./ym2413synth.js').YM2413Voice&{userPatch?:OpllOperationUserPatch|number[]}))=>OpllOperationRecorder} setPreset
 * @property {(channel:OpllOperationChannel,instrument:number,attenuation?:number)=>OpllOperationRecorder} setInstrument
 * @property {(channel:OpllOperationChannel,attenuation:number)=>OpllOperationRecorder} setAttenuation
 * @property {(channel:OpllOperationChannel,enabled:boolean)=>OpllOperationRecorder} setSustain
 * @property {(channel:OpllOperationChannel,fnum:number,block?:number)=>OpllOperationRecorder} setPitch
 * @property {(channel:OpllOperationChannel,hz:number)=>OpllOperationRecorder} setFrequency
 * @property {(channel:OpllOperationChannel,note:string|number)=>OpllOperationRecorder} setNote
 * @property {(channel:OpllOperationChannel)=>OpllOperationRecorder} keyOn
 * @property {(channel:OpllOperationChannel)=>OpllOperationRecorder} keyOff
 * @property {(channel:OpllOperationChannel,note:string|number)=>OpllOperationRecorder} noteOn
 * @property {(channel:OpllOperationChannel)=>OpllOperationRecorder} noteOff
 * @property {(settings:import('./ym2413synth.js').YM2413Rhythm)=>OpllOperationRecorder} setRhythm
 * @property {(levels:import('./ym2413synth.js').YM2413RhythmLevels)=>OpllOperationRecorder} setRhythmLevels
 * @property {(drum:import('./ym2413synth.js').YM2413Drum,attenuation:number)=>OpllOperationRecorder} setRhythmLevel
 */
/** @template Result
 * @param {(builder:OpllOperationRecorder)=>Result & (Result extends PromiseLike<unknown>?never:unknown)} callback
 * @param {{referenceSampleRate?:number}} [options]
 * @returns {Readonly<{version:1,chip:'ym2413',referenceSampleRate:number,operations:ReadonlyArray<{time:{unit:'sample'|'seconds',value:number},order:number,method:string,args:ReadonlyArray<unknown>}>}>}
 */`],
    ['export function compileOpllOperations(', String.raw`/** @param {ReturnType<typeof buildOpllOperations>} plan
 * @param {any} state
 * @param {{clock?:number}} [options]
 * @returns {Array<{offsetSeconds:number,register:number,value:number,operationIndex:number,writeIndex:number,intentMask?:number}>}
 */`],
    ['export function createOpllOperationResetState(', String.raw`/** @param {{clock?:number}} [options] */`],
  ],
  'ym2413_timed_state.js': [
    ['export function createOpllTimedSnapshot(', String.raw`/** @param {any} state
 * @param {{instanceId:string|number,frame:number,sampleRate:number}} [options]
 * @returns {Readonly<{format:'tetorica-opll-state',version:1,instanceId:string|number,frame:number,sampleRate:number,state:Readonly<{clock:number,registers:readonly number[]}>}>}
 */`],
  ],
  'ym2413_timed_client.js': [
    ['export function attachOpllTimedClient(', String.raw`/**
 * @typedef {Object} OpllTimedApi
 * @property {typeof import('./ym2413_operations.js').buildOpllOperations} build
 * @property {()=>Promise<ReturnType<typeof import('./ym2413_timed_state.js').createOpllTimedSnapshot>>} captureState
 * @property {(operations:ReturnType<OpllTimedApi['build']>,options?:{initialState?:'current'|'client'|'reset'|Awaited<ReturnType<OpllTimedApi['captureState']>>})=>Promise<ReturnType<typeof import('./ym2413_operations.js').compileOpllOperations>>} compile
 * @property {(operations:ReturnType<OpllTimedApi['build']>,options:{name:string,repeatSeconds?:number})=>Promise<{name:string,entries:number,sampleRate:number,startFrame?:number,repeatSeconds?:number,staged?:boolean}>} schedule
 * @property {(name:string)=>Promise<boolean>} clearSchedule
 */
/** @template T
 * @param {T} api
 * @param {any} [configuration]
 * @param {any} [port]
 * @returns {T & OpllTimedApi}
 */`],
  ],
  'playground_segapsg.js': [
    ['export function createSegaPsgClient(', String.raw`/** @param {any} port
 * @param {{clock?:number,stereoEnabled?:boolean,native?:boolean,instanceId?:string|number}} [options]
 * @returns {ReturnType<typeof import('./segapsg_api.js').createSegaPsgApi> & import('./segapsg_timed_client.js').PsgTimedApi & {readonly clock:number,readonly stereoEnabled:boolean,setClock(hz:number):Promise<unknown>}}
 */`],
  ],
  'playground_ym2413.js': [
    ['export function createYm2413Client(', String.raw`/** @param {any} port
 * @param {{clock?:number,native?:boolean,state?:any,instanceId?:string|number}} [options]
 * @param {any} [lifecycle]
 * @returns {import('./ym2413synth.js').YM2413Synth & import('./ym2413_timed_client.js').OpllTimedApi & {readonly clock:number,setClock(hz:number):Promise<unknown>}}
 */`],
  ],
  'native_genesis_segapsg.js': [
    ['export function createNativeGenesisSegaPsg(', String.raw`/** @param {any} context
 * @param {{stereoEnabled?:boolean,acknowledgeClock?:boolean}} [options]
 * @returns {Omit<ReturnType<typeof import('./native_genesis_voice_endpoint.js').createNativeVoiceEndpoint>,'client'> & {client:ReturnType<typeof import('./playground_segapsg.js').createSegaPsgClient>}}
 */`],
  ],
  'native_genesis_opll.js': [
    ['export function createNativeGenesisOpll(', String.raw`/** @param {any} context
 * @returns {Omit<ReturnType<typeof import('./native_genesis_voice_endpoint.js').createNativeVoiceEndpoint>,'client'> & {client:ReturnType<typeof import('./playground_ym2413.js').createYm2413Client>}}
 */`],
  ],
  'native_genesis_extra_ym2413.js': [
    ['export function createNativeGenesisYm2413Endpoint(', String.raw`/** @param {any} synth
 * @returns {Omit<ReturnType<typeof import('./native_genesis_extra_register_voice.js').createNativeExtraRegisterVoice>,'client'> & {client:ReturnType<typeof import('./playground_ym2413.js').createYm2413Client>}}
 */`],
  ],
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
  'fm21290.js': [
    ['  writeRegister(address, data)', '/** @param {number} address @param {number} data */'],
    ['  renderInto(buffer)', '/** @param {Float32Array} buffer */'],
  ],
  'playground_fm21290.js': [
    ['    writeRegister(address, value)', '/** @param {number} address @param {number} value */'],
  ],
  'playground_performance_queue.js': [
    ['    releasePattern(name, {owner,session}', '/** @param {string|undefined} name @param {{owner?:string,session?:number}} [scope] */'],
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
