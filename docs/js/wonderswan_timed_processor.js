// SPDX-License-Identifier: BSD-3-Clause
import {validateWonderSwanOperations, wonderswanOperationOffsetSeconds, createWonderSwanOperationResolver, compileWonderSwanOperations, validateWonderSwanParameterPlan} from './wonderswan_operations.js';
import {createWonderSwanTimedSnapshot} from './wonderswan_timed_state.js';

const identity = (value, label) => {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError(`Invalid WONDERSWAN ${label}`);
  return value;
};
const transactionKey = value => {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return identity(value, 'transaction');
};

// Sweep is the largest supported register operation (three writes).
export const wonderswanTimedCommandCost = command => command.method === 'applyWonderSwanTimedOperation' ? 3 : 1;

/** WONDERSWAN-specific resolution and RPC. Time/order/storage belong to Performance Queue.
 * No user functions cross this boundary; captures occur between complete batches.
 */
export function createWonderSwanTimedProcessor({performance: timeline, getState, getConfig, dispatch,
  nowFrame, sampleRate, leadFrames = 128, validatePlan}) {
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
    const message={type:'wonderswan-timed-error',message:String(event.error),session:event.session,owner:context.owner};
    try { port.postMessage(message); } catch { console.error('[WONDERSWAN timed reservation]',message.message); }
  };
  function context(payload, metadata) {
    let stats = timeline.getStats();
    if (metadata && metadata.session !== stats.activeSession) throw new Error('Performance session has expired');
    if (!stats.activeSession) {
      timeline.receive({type:'performance-start', session:stats.latestSession + 1}, {postMessage(){}});
      stats = timeline.getStats();
    }
    return {session:stats.activeSession, owner:identity(metadata?.owner ?? payload.owner ?? 'wonderswan-timed:client', 'owner'),
      time:metadata?.time ?? freshTime()};
  }
  function admit(operations) {
    const plan = validateWonderSwanOperations(operations, {validateArguments:false});
    // Admission is a virtual pass over authoritative authoring state and shared mode bits.
    // Actual execution resolves again, so intervening manual writes are retained.
    const state = getState();
    validatePlan?.(plan,state);
    compileWonderSwanOperations(plan,state,{clock:getConfig().clock});
    return plan;
  }
  function specification(operations, options, ownerContext) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['name','repeatSeconds'].includes(key))) throw new TypeError('Invalid WONDERSWAN schedule options');
    const plan = admit(operations);
    const reservation = ++nextReservation;
    return {name:identity(options.name, 'schedule name'), repeatSeconds:options.repeatSeconds,
      performance:ownerContext, entries:plan.operations.map(operation => ({
        offsetSeconds:wonderswanOperationOffsetSeconds(operation, plan.referenceSampleRate),
        command:{method:'applyWonderSwanTimedOperation', operation, reservation, pattern:options.name},
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
    if (!payload || typeof payload !== 'object') throw new TypeError('Invalid WONDERSWAN timed request');
    if(!['capture','schedule','clear','cancelOwner','releaseOwner','abort','stage','commit'].includes(payload.action))throw new TypeError('Invalid WONDERSWAN timed action');
    if(metadata&&(!Number.isSafeInteger(metadata.session)||metadata.session<=0||
      !Number.isFinite(metadata.time)||metadata.time<0))throw new TypeError('Invalid WONDERSWAN performance context');
    if(metadata)identity(metadata.owner,'owner');
    if (payload.action === 'capture') return createWonderSwanTimedSnapshot(getState(), {
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
      if (!['schedule','clearSchedule'].includes(payload.method) || !Array.isArray(payload.args)) throw new TypeError('Invalid WONDERSWAN staged operation');
      const records = new Map(staged.get(key)?.records);
      const name = payload.method === 'schedule' ? payload.args[1]?.name : payload.args[0];
      identity(name, 'schedule name');
      if (payload.method === 'schedule') {
        if (payload.args.length !== 2) throw new TypeError('Invalid WONDERSWAN staged schedule arguments');
        records.set(name, {method:payload.method,args:[
          admit(payload.args[0]), {...payload.args[1]},
        ]});
      } else {
        if (payload.args.length !== 1) throw new TypeError('Invalid WONDERSWAN staged clear arguments');
        records.set(name, {method:payload.method,args:[name]});
      }
      if (staged.size >= 128 && !staged.has(key)) throw new RangeError('Too many WONDERSWAN staged transactions');
      let stored = 0;
      for (const [otherKey, transaction] of staged) if (otherKey !== key) {
        for (const record of transaction.records.values()) stored += record.args[0]?.operations?.length ?? 1;
      }
      for (const record of records.values()) stored += record.args[0]?.operations?.length ?? 1;
      if (stored > 65536) throw new RangeError('WONDERSWAN staged operation capacity exceeded');
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
    throw new Error(`Unsupported WONDERSWAN timed action: ${payload.action}`);
  }
  return {
    receive(data, port) {
      if (data?.method !== 'wonderswanTimed') return false;
      try { port.postMessage({id:data.id,value:invoke(data.args?.[0], data.timedPerformance, port)}); }
      catch (error) { port.postMessage({id:data.id,error:error.message,name:error.name}); }
      return true;
    },
    apply(command, port, frame, metadata) {
      const {operation, reservation, pattern} = command;
      if (operation.method === 'keyOff') {
        const token = gates.get(operation.args[0]);
        if (!token || token.owner !== metadata.owner || token.reservation !== reservation) return false;
      }
      const state = getState(), clock = state.clock;
      validatePlan?.({operations:[operation]},state);
      validateWonderSwanParameterPlan({operations:[operation]},state);
      if (resolverClock !== clock) { resolver = createWonderSwanOperationResolver({clock}); resolverClock = clock; }
      const {writes} = resolver.resolve(operation,state);
      for (const {register,value,channel,controlMask} of writes) {
        dispatch({method:'writeRegister',args:[register,value],channel,controlMask},port,frame,{
          ...metadata,reservation,pattern,timedOperation:true,
          preserveOwner:!['keyOn','keyOff'].includes(operation.method),
        });
      }
      return true;
    },
    // Every actually applied Gate write passes here, including manual/Worker
    // writes. A newer writer retires the old reservation token on that channel.
    observeWrite(register,value,controlMask,metadata,port) {
      if (register !== 0x90) return;
      const mask = (controlMask ?? 255) & 15;
      for (let channel=0;channel<4;channel++) if(mask&(1<<channel)) {
        gates.delete(channel);
        if ((value&(1<<channel)) && metadata?.timedOperation && metadata.reservation !== undefined)
          gates.set(channel,{owner:metadata.owner,reservation:metadata.reservation,pattern:metadata.pattern,port});
      }
    },
    discard(command,metadata) { release({owner:metadata.owner,reservation:command.reservation}); },
    clear() { timeline.clearPatterns(); staged.clear(); releaseAll(); },
  };
}
