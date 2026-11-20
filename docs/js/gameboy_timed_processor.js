// SPDX-License-Identifier: BSD-3-Clause
import {validateGameboyOperations, gameboyOperationOffsetSeconds, createGameboyOperationResolver, compileGameboyOperations} from './gameboy_operations.js?v=gameboy-timed-1';
import {createGameboyTimedSnapshot} from './gameboy_timed_state.js?v=gameboy-timed-1';

const identity = (value, label) => {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError(`Invalid GAMEBOY ${label}`);
  return value;
};
const transactionKey = value => {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return identity(value, 'transaction');
};

// A Wave RAM upload is one bounded batch: DAC off plus sixteen packed bytes.
export const gameboyTimedCommandCost = command => command.method === 'applyGameboyTimedOperation' ? 17 : 1;

/** Actual Gate-affecting bytes, independent of high-level API spelling. */
export function gameboyGateEvents(register,value) {
  const channel=[4,9,14,19].indexOf(register);
  if(channel>=0 && (value&128))return [{channel,on:true}];
  if([2,7,17].includes(register) && !(value&0xf8))return [{channel:{2:0,7:1,17:3}[register],on:false}];
  if(register===10 && !(value&128))return [{channel:2,on:false}];
  if(register===22 && !(value&128))return [0,1,2,3].map(channel=>({channel,on:false}));
  return [];
}
export function gameboyOperationOffChannel(operation) {
  if(operation.method==='keyOff')return operation.args[0];
  if(operation.method==='pulse.keyOff')return operation.args[0];
  if(operation.method==='wave.keyOff')return 2;
  if(operation.method==='noise.keyOff')return 3;
  return null;
}

/** GAMEBOY-specific resolution and RPC. Time/order/storage belong to Performance Queue.
 * No user functions cross this boundary; captures occur between complete batches.
 */
export function createGameboyTimedProcessor({performance: timeline, getState, getConfig, dispatch,
  nowFrame, sampleRate, leadFrames = 128, validatePlan, retainState}) {
  const staged = new Map(), gates = new Map();
  let resolver, resolverClock;
  function release(filter = {}) {
    let released = false;
    for (const [channel, token] of [...gates]) {
      if (Object.entries(filter).some(([key,value])=>value!==undefined&&token[key]!==value)) continue;
      gates.delete(channel);
      dispatch({method:'keyOff',args:[channel]},token.port,nowFrame(),{owner:token.owner,timedOperation:true});
      released = true;
    }
    return released;
  }
  const releaseOwner = owner => release({owner});
  const releasePattern = (pattern,owner) => release({pattern,owner});
  const releaseAll = () => release();
  let nextReservation = 0;
  const freshTime = () => (nowFrame() + leadFrames) / sampleRate;
  const reportTo = (port,context) => event => {
    // Reservation failures are recoverable and must not retire the audio engine.
    const message={type:'gameboy-timed-error',message:String(event.error),session:event.session,owner:context.owner};
    try { port.postMessage(message); } catch { console.error('[GAMEBOY timed reservation]',message.message); }
  };
  function context(payload, metadata) {
    let stats = timeline.getStats();
    if (metadata && metadata.session !== stats.activeSession) throw new Error('Performance session has expired');
    if (!stats.activeSession) {
      timeline.receive({type:'performance-start', session:stats.latestSession + 1}, {postMessage(){}});
      stats = timeline.getStats();
    }
    return {session:stats.activeSession, owner:identity(metadata?.owner ?? payload.owner ?? 'gameboy-timed:client', 'owner'),
      time:metadata?.time ?? freshTime()};
  }
  function admit(operations) {
    const plan = validateGameboyOperations(operations, {validateArguments:false});
    // Admission is a virtual pass over authoritative authoring state and shared mode bits.
    // Actual execution resolves again, so intervening manual writes are retained.
    const state = getState();
    validatePlan?.(plan,state);
    compileGameboyOperations(plan,state,{clock:getConfig().clock});
    return plan;
  }
  function specification(operations, options, ownerContext) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['name','repeatSeconds'].includes(key))) throw new TypeError('Invalid GAMEBOY schedule options');
    const plan = admit(operations);
    const reservation = ++nextReservation;
    return {name:identity(options.name, 'schedule name'), repeatSeconds:options.repeatSeconds,
      performance:ownerContext, entries:plan.operations.map(operation => ({
        offsetSeconds:gameboyOperationOffsetSeconds(operation, plan.referenceSampleRate),
        command:{method:'applyGameboyTimedOperation', operation, reservation, pattern:options.name},
      }))};
  }
  function changesFor(records, ownerContext) {
    return [...records.values()].map(record => record.method === 'clearSchedule'
      ? {name:identity(record.args[0], 'schedule name'), clear:true}
      : specification(record.args[0], record.args[1], ownerContext));
  }
  function stagingKey(session, owner, transactionId) { return JSON.stringify([session,owner,transactionKey(transactionId)]); }
  function prune() {
    const session = timeline.getStats().activeSession;
    for (const [key, value] of staged) if (value.session !== session) staged.delete(key);
  }
  function invoke(payload, metadata, port) {
    if (!payload || typeof payload !== 'object') throw new TypeError('Invalid GAMEBOY timed request');
    if(!['capture','schedule','clear','cancelOwner','releaseOwner','abort','stage','commit'].includes(payload.action))throw new TypeError('Invalid GAMEBOY timed action');
    if(metadata&&(!Number.isSafeInteger(metadata.session)||metadata.session<=0||
      !Number.isFinite(metadata.time)||metadata.time<0))throw new TypeError('Invalid GAMEBOY performance context');
    if(metadata)identity(metadata.owner,'owner');
    if (payload.action === 'capture') return createGameboyTimedSnapshot(getState(), {
      ...getConfig(), frame:nowFrame(), sampleRate,
    });
    const ownerContext = context(payload, metadata);
    prune();
    const {session, owner} = ownerContext;
    if (payload.action === 'schedule') {
      const receipt = timeline.schedulePattern(specification(payload.operations, payload.options, ownerContext), reportTo(port,ownerContext));
      releasePattern(receipt.name); // also retire a completed one-shot's held note
      return receipt;
    }
    if (payload.action === 'clear') {
      const name = identity(payload.name, 'schedule name');
      const cleared = timeline.clearPattern(name, {session,owner});
      return releasePattern(name,owner) || cleared;
    }
    if (payload.action === 'cancelOwner' || payload.action === 'releaseOwner') {
      for (const [key, value] of staged) if (value.session === session && value.owner === owner) staged.delete(key);
      if(payload.action==='releaseOwner'){timeline.cancelOwner(owner);releaseOwner(owner);return true;}
      const canceled = timeline.cancelPatternOwner(owner, {session});
      releaseOwner(owner);
      return canceled;
    }
    const key = stagingKey(session, owner, payload.transactionId);
    if (payload.action === 'abort') { staged.delete(key); return true; }
    if (payload.action === 'stage') {
      if (!['schedule','clearSchedule'].includes(payload.method) || !Array.isArray(payload.args)) throw new TypeError('Invalid GAMEBOY staged operation');
      const records = new Map(staged.get(key)?.records);
      const name = payload.method === 'schedule' ? payload.args[1]?.name : payload.args[0];
      identity(name, 'schedule name');
      if (payload.method === 'schedule') {
        if (payload.args.length !== 2) throw new TypeError('Invalid GAMEBOY staged schedule arguments');
        records.set(name, {method:payload.method,args:[
          admit(payload.args[0]), {...payload.args[1]},
        ]});
      } else {
        if (payload.args.length !== 1) throw new TypeError('Invalid GAMEBOY staged clear arguments');
        records.set(name, {method:payload.method,args:[name]});
      }
      if (staged.size >= 128 && !staged.has(key)) throw new RangeError('Too many GAMEBOY staged transactions');
      let stored = 0;
      for (const [otherKey, transaction] of staged) if (otherKey !== key) {
        for (const record of transaction.records.values()) stored += record.args[0]?.operations?.length ?? 1;
      }
      for (const record of records.values()) stored += record.args[0]?.operations?.length ?? 1;
      if (stored > 65536) throw new RangeError('GAMEBOY staged operation capacity exceeded');
      const changes = changesFor(records, {...ownerContext,time:freshTime()});
      // Stage acceptance checks all arguments / projected capacity without replacing sound.
      const receipt = timeline.commitPatterns(changes, {session,owner,dryRun:true});
      staged.set(key, {session,owner,records});
      if (payload.method === 'clearSchedule') return true;
      const accepted = receipt.reservations.find(value => value.name === name);
      const {startFrame, ...details} = accepted;
      return {...details, staged:true};
    }
    if (payload.action === 'commit') {
      // Use one fresh anchor after the user evaluation has completed, not its old stage time.
      const records = staged.get(key)?.records ?? new Map();
      const receipt = timeline.commitPatterns(changesFor(records, {...ownerContext,time:Math.max(freshTime(),ownerContext.time)}), {session,owner}, reportTo(port,ownerContext));
      releaseOwner(owner);
      for (const record of records.values()) {
        const name = record.method === 'schedule' ? record.args[1].name : record.args[0];
        releasePattern(name, record.method === 'schedule' ? undefined : owner);
      }
      staged.delete(key);
      return receipt;
    }
    throw new Error(`Unsupported GAMEBOY timed action: ${payload.action}`);
  }
  return {
    receive(data, port) {
      if (data?.method !== 'gameboyTimed') return false;
      try { port.postMessage({id:data.id,value:invoke(data.args?.[0], data.timedPerformance, port)}); }
      catch (error) { port.postMessage({id:data.id,error:error.message,name:error.name}); }
      return true;
    },
    apply(command, port, frame, metadata) {
      const {operation, reservation, pattern} = command;
      const offChannel = gameboyOperationOffChannel(operation);
      if (offChannel !== null) {
        const token = gates.get(offChannel);
        if (!token || token.owner !== metadata.owner || token.reservation !== reservation) return false;
      }
      const state = getState(), clock = state.clock;
      validatePlan?.({operations:[operation]},state);
      if (resolverClock !== clock) { resolver = createGameboyOperationResolver({clock}); resolverClock = clock; }
      const {writes,state:resolvedState} = resolver.resolve(operation,state);
      let applied=true;
      for (const {register,value} of writes) {
        const accepted=dispatch({method:'writeRegister',args:[register,value]},port,frame,{
          ...metadata,reservation,pattern,timedOperation:true,
          preserveOwner:!['writeRegister','noteOn','keyOn','keyOff','pulse.noteOn','pulse.keyOn','pulse.keyOff','wave.noteOn','wave.keyOn','wave.keyOff','noise.keyOn','noise.keyOff'].includes(operation.method),
        });
        if(accepted===false)applied=false;
      }
      // Sent zeroes used by keyOff are not the configured next-trigger voice.
      if(applied)retainState?.(resolvedState);
      return applied;
    },
    // Every actually applied Gate write passes here, including manual/Worker
    // writes. A newer writer retires the old reservation token on that channel.
    observeWrite(register,value,metadata,port) {
      for (const {channel,on} of gameboyGateEvents(register,value)) {
        gates.delete(channel);
        if (on && metadata?.timedOperation && metadata.reservation !== undefined)
          gates.set(channel,{owner:metadata.owner,reservation:metadata.reservation,pattern:metadata.pattern,port});
      }
    },
    invoke,
    releaseOwner,
    releaseAll,
    discard(command,metadata) { release({owner:metadata.owner,reservation:command.reservation}); },
    clear() { timeline.clearPatterns(); staged.clear(); releaseAll(); },
  };
}
