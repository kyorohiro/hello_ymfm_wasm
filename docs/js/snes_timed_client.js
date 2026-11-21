import {validateChipClock} from './playground_chip_clock.js';
import {
  buildSnesOperations, validateSnesOperations, compileSnesOperations,
  createSnesOperationResetState, validateSnesOperationState, snesOperationOffsetSeconds,
} from './snes_operations.js';
import {validateSnesTimedSnapshot} from './snes_timed_state.js';

/**
 * @typedef {import('./snes_operations.js').SNESOperationRecorder} SNESOperationRecorder
 * @typedef {import('./snes_operations.js').SNESOperationProgram} SNESOperationProgram
 * @typedef {import('./snes_operations.js').SNESBuildOptions} SNESBuildOptions
 * @typedef {import('./snes_operations.js').SNESCompiledWrite} SNESCompiledWrite
 * @typedef {import('./snes_timed_state.js').SNESTimedSnapshot} SNESStateSnapshot
 * @typedef {{initialState?:'current'|'client'|'reset'|SNESStateSnapshot}} SNESCompileOptions
 * @typedef {{name:string,repeatSeconds?:number}} SNESScheduleOptions
 * @typedef {{name:string,startFrame?:number,sampleRate:number,entries:number,repeatSeconds?:number,staged?:boolean}} SNESScheduleReceipt
 * @typedef {{
 * build(callback:(recorder:SNESOperationRecorder)=>void|SNESOperationRecorder,options?:SNESBuildOptions):SNESOperationProgram,
 * compile(operations:SNESOperationProgram,options?:SNESCompileOptions):Promise<SNESCompiledWrite[]>,
 * captureState():Promise<SNESStateSnapshot>,
 * schedule(operations:SNESOperationProgram,options:SNESScheduleOptions):Promise<SNESScheduleReceipt>,
 * clearSchedule(name:string):Promise<boolean>,dispose():void
 * }} SNESTimedApi
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
  if (typeof value !== 'string' || !value.length || value.length > 128) throw new TypeError('SNES schedule name must contain 1..128 characters');
  return value;
}

function transaction(value) {
  if ((typeof value === 'string' && value.length > 0 && value.length <= 256) ||
      (Number.isSafeInteger(value) && value > 0)) return value;
  throw new TypeError('SNES schedule transaction identity is invalid');
}

function owner(value) {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError('SNES schedule owner must contain 1..256 characters');
  return value;
}

function scheduleOptions(value, program) {
  options(value, ['name', 'repeatSeconds'], 'SNES schedule options');
  const result = {name: name(value.name)};
  if (value.repeatSeconds !== undefined) {
    const interval = value.repeatSeconds, last = program.operations.at(-1);
    if (!Number.isFinite(interval) || interval <= 0 || !last ||
        interval <= snesOperationOffsetSeconds(last,program.referenceSampleRate)) {
      throw new RangeError('SNES repeatSeconds must exceed the last operation offset in a nonempty program');
    }
    result.repeatSeconds = interval;
  }
  return result;
}

/** Attach the additive live SNES API after its acknowledged control transport.
 * Existing getters and immediate authoring methods retain their semantics.
 * The client baseline is optimistic: it excludes renderer-only scheduled edits.
 * This also supports an explicit `new SNESSynth({transport})` integration;
 * pass its AudioWorklet MessagePort as the third argument.
 * @template T
 * @param {T} api
 * @param {{instanceId?:string|number,engine?:'snes-wasm',native?:boolean}} [configuration]
 * @param {MessagePort} [port]
 * @returns {T & SNESTimedApi}
 */
export function attachSnesTimedClient(api, configuration = {}, port) {
  let disposed = false, instanceId = configuration.instanceId;
  const errorListeners = new Set();
  const engine = 'snes-wasm';
  const native = !!configuration.native;
  const check = () => { if (disposed || api.isCurrent && !api.isCurrent()) throw new Error('SNES disposed'); };
  const config = () => {
    return {clock:32000,engine};
  };
  const requireLive = () => {
    check();
    if (native) throw new Error('SNES timed scheduling and authoritative capture require an AudioWorklet; Native is not supported');
    if (typeof api._requestControl !== 'function' && !port?.postMessage) throw new Error('SNES timed operations require an acknowledged AudioWorklet control transport');
  };
  const pending = new Map();
  let requestSequence = 0;
  const request = payload => {
    requireLive();
    if (typeof api._requestControl === 'function') return api._requestControl('snesTimed', [payload]);
    const id = `snes-timed-client:${++requestSequence}`;
    return new Promise((resolve,reject) => {
      pending.set(id,{resolve,reject});
      try { port.postMessage({method:'snesTimed',args:[payload],id}); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  const owned = (payload, metadata = {}) => {
    options(metadata, ['owner'], 'SNES schedule metadata');
    return metadata.owner === undefined ? payload : {...payload, owner: owner(metadata.owner)};
  };
  const prepared = (operations, settings) => {
    // Only structural copying here. Backend admission validates at its actual
    // clock; local authoring may legitimately lag a renderer clock edit.
    const program = validateSnesOperations(operations, {validateArguments:false});
    return {operations: program, options: scheduleOptions(settings,program)};
  };
  const reportError = event => {
    const data = event.data;
    const entry = pending.get(data?.id);
    if (entry) { pending.delete(data.id); data.error ? entry.reject(new Error(data.error)) : entry.resolve(data.value); }
    if (disposed || data?.type !== 'snes-timed-error') return;
    const diagnostic = Object.freeze({type:'snes-timed-error',message:String(data.message ?? 'SNES timed operation failed'),
      owner:data.owner,session:data.session});
    if (!errorListeners.size) { console.error(`[SNES timed] ${diagnostic.message}`); return; }
    for (const listener of [...errorListeners]) {
      try { listener(diagnostic); }
      catch (error) { console.error('[SNES timed error observer]',error); }
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
      if (typeof listener !== 'function') throw new TypeError('SNES timed error observer must be a function');
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
      if (!Array.isArray(args)) throw new TypeError('SNES staged schedule args must be an array');
      let copied;
      if (method === 'schedule' && args.length === 2) {
        const value = prepared(args[0], args[1]); copied = [value.operations, value.options];
      } else if (method === 'clearSchedule' && args.length === 1) copied = [name(args[0])];
      else throw new TypeError('Unsupported SNES staged scheduling method');
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

  api.build = (callback, settings) => { check(); return buildSnesOperations(callback,settings); };
  api.captureState = async () => {
    requireLive();
    const value = await request({action:'capture'});
    check();
    // A renderer clock can differ from its last local acknowledgement. Return
    // the actual captured clock without silently adopting it into live state.
    const snapshot = validateSnesTimedSnapshot(value,{engine,...(instanceId === undefined ? {} : {instanceId})});
    if (instanceId === undefined) instanceId = snapshot.instanceId;
    return snapshot;
  };
  api.compile = async (operations, settings = {}) => {
    check();
    options(settings, ['initialState'], 'SNES compile options');
    const recorded = validateSnesOperations(operations,{validateArguments:false});
    const initialState = settings.initialState === undefined ? 'current' : settings.initialState;
    let state, clock;
    if (initialState === 'current') {
      const snapshot = await api.captureState();
      state = snapshot; clock = snapshot.clock;
    } else if (initialState === 'client') {
      const current = config();
      if (api._timedClientStateComplete !== true || typeof api._getTimedState !== 'function') {
        throw new Error('Incomplete SNES client state: complete register and enable shadows are unavailable');
      }
      state = validateSnesOperationState(api._getTimedState()); clock = current.clock;
    } else if (initialState === 'reset') {
      clock = config().clock; state = createSnesOperationResetState({clock});
    } else if (initialState && typeof initialState === 'object') {
      if (instanceId === undefined) throw new Error('SNES snapshot chip identity is unknown; capture from this client first');
      state = validateSnesTimedSnapshot(initialState,{...config(),instanceId}); clock = state.clock;
    } else throw new TypeError('SNES initialState must be current, client, reset or a captured state snapshot');
    // Local/client/reset/supplied-snapshot paths reach here without an await or
    // RPC, so later local edits cannot alter this compilation's copied state.
    // Compilation itself validates every call through the shared resolver and
    // returns no partial trace on failure; do not run the same conversion twice.
    return compileSnesOperations(recorded,state,{clock});
  };
  api.schedule = (operations, settings) => capability.schedule(operations,settings);
  api.clearSchedule = scheduleName => capability.clearSchedule(scheduleName);
  Object.defineProperty(api,'_timedOperations',{value:capability});
  const dispose = api.dispose;
  api.dispose = () => {
    if (disposed) return; disposed = true;
    errorListeners.clear();
    for (const entry of pending.values()) entry.reject(new Error('SNES disposed'));
    pending.clear();
    if (port?.removeEventListener) port.removeEventListener('message',reportError);
    else if (port && port.onmessage === messageListener) port.onmessage = previousMessage;
    return dispose?.call(api);
  };
  return /** @type {T & SNESTimedApi} */ (api);
}
