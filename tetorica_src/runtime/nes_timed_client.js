import {validateChipClock} from './playground_chip_clock.js';
import {
  buildNesOperations, validateNesOperations, compileNesOperations,
  createNesOperationResetState, validateNesOperationState, nesOperationOffsetSeconds,
} from './nes_operations.js';
import {validateNesTimedSnapshot} from './nes_timed_state.js';

/**
 * @typedef {import('./nes_operations.js').NESOperationRecorder} NESOperationRecorder
 * @typedef {import('./nes_operations.js').NESOperationProgram} NESOperationProgram
 * @typedef {import('./nes_operations.js').NESBuildOptions} NESBuildOptions
 * @typedef {import('./nes_operations.js').NESCompiledWrite} NESCompiledWrite
 * @typedef {import('./nes_timed_state.js').NESTimedSnapshot} NESStateSnapshot
 * @typedef {{initialState?:'current'|'client'|'reset'|NESStateSnapshot}} NESCompileOptions
 * @typedef {{name:string,repeatSeconds?:number}} NESScheduleOptions
 * @typedef {{name:string,startFrame?:number,sampleRate:number,entries:number,repeatSeconds?:number,staged?:boolean}} NESScheduleReceipt
 * @typedef {{
 * build(callback:(recorder:NESOperationRecorder)=>void|NESOperationRecorder,options?:NESBuildOptions):NESOperationProgram,
 * compile(operations:NESOperationProgram,options?:NESCompileOptions):Promise<NESCompiledWrite[]>,
 * captureState():Promise<NESStateSnapshot>,
 * schedule(operations:NESOperationProgram,options:NESScheduleOptions):Promise<NESScheduleReceipt>,
 * clearSchedule(name:string):Promise<boolean>,dispose():void
 * }} NESTimedApi
 */

function options(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be an object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')) {
      throw new TypeError(`Unknown or invalid ${label} field: ${String(key)}`);
    }
  }
}

function name(value) {
  if (typeof value !== 'string' || !value.length || value.length > 128) throw new TypeError('NES schedule name must contain 1..128 characters');
  return value;
}

function transaction(value) {
  if ((typeof value === 'string' && value.length > 0 && value.length <= 256) ||
      (Number.isSafeInteger(value) && value > 0)) return value;
  throw new TypeError('NES schedule transaction identity is invalid');
}

function owner(value) {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError('NES schedule owner must contain 1..256 characters');
  return value;
}

function scheduleOptions(value, program) {
  options(value, ['name', 'repeatSeconds'], 'NES schedule options');
  const result = {name: name(value.name)};
  if (value.repeatSeconds !== undefined) {
    const interval = value.repeatSeconds, last = program.operations.at(-1);
    if (!Number.isFinite(interval) || interval <= 0 || !last ||
        interval <= nesOperationOffsetSeconds(last,program.referenceSampleRate)) {
      throw new RangeError('NES repeatSeconds must exceed the last operation offset in a nonempty program');
    }
    result.repeatSeconds = interval;
  }
  return result;
}

/** Attach the additive live NES API after its acknowledged control transport.
 * Existing getters and immediate authoring methods retain their semantics.
 * The client baseline is optimistic: it excludes renderer-only scheduled edits.
 * This also supports an explicit `new NESSynth({transport})` integration;
 * pass its AudioWorklet MessagePort as the third argument.
 * @template T
 * @param {T} api
 * @param {{instanceId?:string|number,engine?:'nes-wasm',native?:boolean}} [configuration]
 * @param {MessagePort} [port]
 * @returns {T & NESTimedApi}
 */
export function attachNesTimedClient(api, configuration = {}, port) {
  let disposed = false, instanceId = configuration.instanceId;
  const errorListeners = new Set();
  const engine = 'nes-wasm';
  const native = !!configuration.native;
  const check = () => { if (disposed || api.isCurrent && !api.isCurrent()) throw new Error('NES disposed'); };
  const config = () => {
    return {clock:validateChipClock(api.clock),engine};
  };
  const requireLive = () => {
    check();
    if (native) throw new Error('NES timed scheduling and authoritative capture require an AudioWorklet; Native is not supported');
    if (typeof api._requestControl !== 'function' && !port?.postMessage) throw new Error('NES timed operations require an acknowledged AudioWorklet control transport');
  };
  const pending = new Map();
  let requestSequence = 0;
  const request = payload => {
    requireLive();
    if (typeof api._requestControl === 'function') return api._requestControl('nesTimed', [payload]);
    const id = `nes-timed-client:${++requestSequence}`;
    return new Promise((resolve,reject) => {
      pending.set(id,{resolve,reject});
      try { port.postMessage({method:'nesTimed',args:[payload],id}); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  const owned = (payload, metadata = {}) => {
    options(metadata, ['owner'], 'NES schedule metadata');
    return metadata.owner === undefined ? payload : {...payload, owner: owner(metadata.owner)};
  };
  const prepared = (operations, settings) => {
    // Only structural copying here. Backend admission validates at its actual
    // clock; local authoring may legitimately lag a renderer clock edit.
    const program = validateNesOperations(operations, {validateArguments:false});
    return {operations: program, options: scheduleOptions(settings,program)};
  };
  const reportError = event => {
    const data = event.data;
    const entry = pending.get(data?.id);
    if (entry) { pending.delete(data.id); data.error ? entry.reject(new Error(data.error)) : entry.resolve(data.value); }
    if (disposed || data?.type !== 'nes-timed-error') return;
    const diagnostic = Object.freeze({type:'nes-timed-error',message:String(data.message ?? 'NES timed operation failed'),
      owner:data.owner,session:data.session});
    if (!errorListeners.size) { console.error(`[NES timed] ${diagnostic.message}`); return; }
    for (const listener of [...errorListeners]) {
      try { listener(diagnostic); }
      catch (error) { console.error('[NES timed error observer]',error); }
    }
  };
  const previousMessage = port?.onmessage;
  let messageListener;
  if (port?.addEventListener) {
    port.addEventListener('message',reportError);
    port.start?.();
  } else if (port) {
    messageListener = event => { reportError(event); previousMessage?.call(port,event); };
    port.onmessage = messageListener;
  }

  const capability = Object.freeze({
    onError(listener) {
      check();
      if (typeof listener !== 'function') throw new TypeError('NES timed error observer must be a function');
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
    async schedule(operations, settings, metadata) {
      requireLive();
      return request(owned({action:'schedule', ...prepared(operations,settings)},metadata));
    },
    async clearSchedule(scheduleName, metadata) {
      requireLive();
      return request(owned({action:'clear', name:name(scheduleName)},metadata));
    },
    async stage(transactionId, scheduleOwner, method, args) {
      requireLive();
      if (!Array.isArray(args)) throw new TypeError('NES staged schedule args must be an array');
      let copied;
      if (method === 'schedule' && args.length === 2) {
        const value = prepared(args[0], args[1]); copied = [value.operations, value.options];
      } else if (method === 'clearSchedule' && args.length === 1) copied = [name(args[0])];
      else throw new TypeError('Unsupported NES staged scheduling method');
      return request({action:'stage',transactionId:transaction(transactionId),owner:owner(scheduleOwner),method,args:copied});
    },
    async commit(transactionId, scheduleOwner) {
      check(); if (native) return false;
      return request({action:'commit',transactionId:transaction(transactionId),owner:owner(scheduleOwner)});
    },
    async abort(transactionId, scheduleOwner) {
      check(); if (native) return false;
      return request({action:'abort',transactionId:transaction(transactionId),owner:owner(scheduleOwner)});
    },
    async cancelOwner(scheduleOwner) {
      check(); if (native) return false;
      return request({action:'cancelOwner',owner:owner(scheduleOwner)});
    },
    async releaseOwner(scheduleOwner) {
      check(); if (native) return false;
      return request({action:'releaseOwner',owner:owner(scheduleOwner)});
    },
  });

  api.build = (callback, settings) => { check(); return buildNesOperations(callback,settings); };
  api.captureState = async () => {
    requireLive();
    const value = await request({action:'capture'});
    check();
    // A renderer clock can differ from its last local acknowledgement. Return
    // the actual captured clock without silently adopting it into live state.
    const snapshot = validateNesTimedSnapshot(value,{engine,...(instanceId === undefined ? {} : {instanceId})});
    if (instanceId === undefined) instanceId = snapshot.instanceId;
    return snapshot;
  };
  api.compile = async (operations, settings = {}) => {
    check();
    options(settings, ['initialState'], 'NES compile options');
    const recorded = validateNesOperations(operations,{validateArguments:false});
    const initialState = settings.initialState === undefined ? 'current' : settings.initialState;
    let state, clock;
    if (initialState === 'current') {
      const snapshot = await api.captureState();
      state = snapshot; clock = snapshot.clock;
    } else if (initialState === 'client') {
      const current = config();
      if (api._timedClientStateComplete !== true || typeof api._getTimedState !== 'function') {
        throw new Error('Incomplete NES client state: complete register and enable shadows are unavailable');
      }
      state = validateNesOperationState(api._getTimedState()); clock = current.clock;
    } else if (initialState === 'reset') {
      clock = config().clock; state = createNesOperationResetState({clock});
    } else if (initialState && typeof initialState === 'object') {
      if (instanceId === undefined) throw new Error('NES snapshot chip identity is unknown; capture from this client first');
      state = validateNesTimedSnapshot(initialState,{...config(),instanceId}); clock = state.clock;
    } else throw new TypeError('NES initialState must be current, client, reset or a captured state snapshot');
    // Local/client/reset/supplied-snapshot paths reach here without an await or
    // RPC, so later local edits cannot alter this compilation's copied state.
    // Compilation itself validates every call through the shared resolver and
    // returns no partial trace on failure; do not run the same conversion twice.
    return compileNesOperations(recorded,state,{clock,fds:api.fdsEnabled===true});
  };
  api.schedule = (operations, settings) => capability.schedule(operations,settings);
  api.clearSchedule = scheduleName => capability.clearSchedule(scheduleName);
  Object.defineProperty(api,'_timedOperations',{value:capability});
  const dispose = api.dispose;
  api.dispose = () => {
    if (disposed) return; disposed = true;
    errorListeners.clear();
    for (const entry of pending.values()) entry.reject(new Error('NES disposed'));
    pending.clear();
    if (port?.removeEventListener) port.removeEventListener('message',reportError);
    else if (port && port.onmessage === messageListener) port.onmessage = previousMessage;
    return dispose?.call(api);
  };
  return /** @type {T & NESTimedApi} */ (api);
}
