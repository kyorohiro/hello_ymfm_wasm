import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {validateYm2612Engine} from './playground_soundchip_options.js?v=pokey-mode-1';
import {
  buildYm2612Operations, validateYm2612Operations, compileYm2612Operations,
  createYm2612OperationResetState, validateYm2612OperationState, ym2612OperationOffsetSeconds,
} from './ym2612_operations.js?v=audio-stability-2';
import {validateYm2612TimedSnapshot} from './ym2612_timed_state.js?v=audio-stability-2';

/**
 * @typedef {import('./ym2612_operations.js?v=audio-stability-2').YM2612OperationRecorder} YM2612OperationRecorder
 * @typedef {import('./ym2612_operations.js?v=audio-stability-2').YM2612OperationProgram} YM2612OperationProgram
 * @typedef {import('./ym2612_operations.js?v=audio-stability-2').YM2612BuildOptions} YM2612BuildOptions
 * @typedef {import('./ym2612_operations.js?v=audio-stability-2').YM2612CompiledWrite} YM2612CompiledWrite
 * @typedef {import('./ym2612_timed_state.js?v=audio-stability-2').YM2612TimedSnapshot} YM2612StateSnapshot
 * @typedef {{initialState?:'current'|'client'|'reset'|YM2612StateSnapshot}} YM2612CompileOptions
 * @typedef {{name:string,repeatSeconds?:number}} YM2612ScheduleOptions
 * @typedef {{name:string,startFrame?:number,sampleRate:number,entries:number,repeatSeconds?:number,staged?:boolean}} YM2612ScheduleReceipt
 * @typedef {{
 * build(callback:(recorder:YM2612OperationRecorder)=>void|YM2612OperationRecorder,options?:YM2612BuildOptions):YM2612OperationProgram,
 * compile(operations:YM2612OperationProgram,options?:YM2612CompileOptions):Promise<YM2612CompiledWrite[]>,
 * captureState():Promise<YM2612StateSnapshot>,
 * schedule(operations:YM2612OperationProgram,options:YM2612ScheduleOptions):Promise<YM2612ScheduleReceipt>,
 * clearSchedule(name:string):Promise<boolean>,dispose():void
 * }} YM2612TimedApi
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
  if (typeof value !== 'string' || !value.length || value.length > 128) throw new TypeError('YM2612 schedule name must contain 1..128 characters');
  return value;
}

function transaction(value) {
  if ((typeof value === 'string' && value.length > 0 && value.length <= 256) ||
      (Number.isSafeInteger(value) && value > 0)) return value;
  throw new TypeError('YM2612 schedule transaction identity is invalid');
}

function owner(value) {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError('YM2612 schedule owner must contain 1..256 characters');
  return value;
}

function scheduleOptions(value, program) {
  options(value, ['name', 'repeatSeconds'], 'YM2612 schedule options');
  const result = {name: name(value.name)};
  if (value.repeatSeconds !== undefined) {
    const interval = value.repeatSeconds, last = program.operations.at(-1);
    if (!Number.isFinite(interval) || interval <= 0 || !last ||
        interval <= ym2612OperationOffsetSeconds(last,program.referenceSampleRate)) {
      throw new RangeError('YM2612 repeatSeconds must exceed the last operation offset in a nonempty program');
    }
    result.repeatSeconds = interval;
  }
  return result;
}

/** Attach the additive live YM2612 API after its acknowledged control transport.
 * Existing getters and immediate authoring methods retain their semantics.
 * The client baseline is optimistic: it excludes renderer-only scheduled edits.
 * This also supports an explicit `new YM2612Synth({transport})` integration;
 * pass its AudioWorklet MessagePort as the third argument.
 * @template T
 * @param {T} api
 * @param {{instanceId?:string|number,engine?:'ymfm'|'nuked',native?:boolean}} [configuration]
 * @param {MessagePort} [port]
 * @returns {T & YM2612TimedApi}
 */
export function attachYm2612TimedClient(api, configuration = {}, port, {
  protocol = 'ym2612Timed', errorType = 'ym2612-timed-error',
  build = buildYm2612Operations, validateOperations = validateYm2612Operations,
  compile = compileYm2612Operations, createResetState = createYm2612OperationResetState,
  validateState = validateYm2612OperationState, validateSnapshot = validateYm2612TimedSnapshot,
} = {}) {
  let disposed = false, instanceId = configuration.instanceId;
  const errorListeners = new Set();
  const engine = validateYm2612Engine(configuration.engine ?? api.engine);
  const native = !!configuration.native;
  const check = () => { if (disposed) throw new Error('YM2612 disposed'); };
  const config = () => {
    return {clock:validateChipClock(api.clock),engine,variant:configuration.variant};
  };
  const requireLive = () => {
    check();
    if (native) throw new Error('YM2612 timed scheduling and authoritative capture require an AudioWorklet; Native is not supported');
    if (typeof api._requestControl !== 'function' && !port?.postMessage) throw new Error('YM2612 timed operations require an acknowledged AudioWorklet control transport');
  };
  const pending = new Map();
  let requestSequence = 0;
  const request = payload => {
    requireLive();
    if (typeof api._requestControl === 'function') return api._requestControl(protocol, [payload]);
    const prefix = protocol === 'ym2612Timed' ? 'ym2612-timed-client' : protocol;
    const id = `${prefix}:${++requestSequence}`;
    return new Promise((resolve,reject) => {
      pending.set(id,{resolve,reject});
      try { port.postMessage({method:protocol,args:[payload],id}); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  const owned = (payload, metadata = {}) => {
    options(metadata, ['owner'], 'YM2612 schedule metadata');
    return metadata.owner === undefined ? payload : {...payload, owner: owner(metadata.owner)};
  };
  const prepared = (operations, settings) => {
    // Only structural copying here. Backend admission validates at its actual
    // clock; local authoring may legitimately lag a renderer clock edit.
    const program = validateOperations(operations, {...config(),validateArguments:false});
    return {operations: program, options: scheduleOptions(settings,program)};
  };
  const reportError = event => {
    const data = event.data;
    const entry = pending.get(data?.id);
    if (entry) { pending.delete(data.id); data.error ? entry.reject(new Error(data.error)) : entry.resolve(data.value); }
    if (disposed || data?.type !== errorType) return;
    const diagnostic = Object.freeze({type:errorType,message:String(data.message ?? 'YM2612 timed operation failed'),
      owner:data.owner,session:data.session});
    if (!errorListeners.size) { console.error(`[YM2612 timed] ${diagnostic.message}`); return; }
    for (const listener of [...errorListeners]) {
      try { listener(diagnostic); }
      catch (error) { console.error('[YM2612 timed error observer]',error); }
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
      if (typeof listener !== 'function') throw new TypeError('YM2612 timed error observer must be a function');
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
      if (!Array.isArray(args)) throw new TypeError('YM2612 staged schedule args must be an array');
      let copied;
      if (method === 'schedule' && args.length === 2) {
        const value = prepared(args[0], args[1]); copied = [value.operations, value.options];
      } else if (method === 'clearSchedule' && args.length === 1) copied = [name(args[0])];
      else throw new TypeError('Unsupported YM2612 staged scheduling method');
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

  api.build = (callback, settings) => { check(); return build(callback,settings,config()); };
  api.captureState = async () => {
    requireLive();
    const value = await request({action:'capture'});
    check();
    // A renderer clock can differ from its last local acknowledgement. Return
    // the actual captured clock without silently adopting it into live state.
    const snapshot = validateSnapshot(value,{engine,variant:configuration.variant,...(instanceId === undefined ? {} : {instanceId})});
    if (instanceId === undefined) instanceId = snapshot.instanceId;
    return snapshot;
  };
  api.compile = async (operations, settings = {}) => {
    check();
    options(settings, ['initialState'], 'YM2612 compile options');
    const recorded = validateOperations(operations,{...config(),validateArguments:false});
    const initialState = settings.initialState === undefined ? 'current' : settings.initialState;
    let state, clock;
    if (initialState === 'current') {
      const snapshot = await api.captureState();
      state = snapshot; clock = snapshot.clock;
    } else if (initialState === 'client') {
      const current = config();
      if (api._timedClientStateComplete !== true || typeof api._getTimedState !== 'function') {
        throw new Error('Incomplete YM2612 client state: complete register bytes, frequency latches and key masks are unavailable');
      }
      state = validateState(api._getTimedState()); clock = current.clock;
    } else if (initialState === 'reset') {
      clock = config().clock; state = createResetState();
    } else if (initialState && typeof initialState === 'object') {
      if (instanceId === undefined) throw new Error('YM2612 snapshot chip identity is unknown; capture from this client first');
      state = validateSnapshot(initialState,{...config(),instanceId}); clock = state.clock;
    } else throw new TypeError('YM2612 initialState must be current, client, reset or a captured state snapshot');
    // Local/client/reset/supplied-snapshot paths reach here without an await or
    // RPC, so later local edits cannot alter this compilation's copied state.
    // Compilation itself validates every call through the shared resolver and
    // returns no partial trace on failure; do not run the same conversion twice.
    return compile(recorded,state,{clock,variant:configuration.variant});
  };
  api.schedule = (operations, settings) => capability.schedule(operations,settings);
  api.clearSchedule = scheduleName => capability.clearSchedule(scheduleName);
  Object.defineProperty(api,'_timedOperations',{value:capability});
  const dispose = api.dispose;
  api.dispose = () => {
    if (disposed) return; disposed = true;
    errorListeners.clear();
    for (const entry of pending.values()) entry.reject(new Error('YM2612 disposed'));
    pending.clear();
    if (port?.removeEventListener) port.removeEventListener('message',reportError);
    else if (port && port.onmessage === messageListener) port.onmessage = previousMessage;
    dispose?.call(api);
  };
  return /** @type {T & YM2612TimedApi} */ (api);
}
