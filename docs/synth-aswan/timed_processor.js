// SPDX-License-Identifier: BSD-3-Clause
import {validateAswanOperations, aswanOperationOffsetSeconds, validateAswanScheduledOperations, validateAswanParameterPlan} from './operations.js';
import {createAswanTimedSnapshot} from './timed_state.js';

const identity = (value, label) => {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError(`Invalid ASWAN ${label}`);
  return value;
};
const transactionKey = value => {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return identity(value, 'transaction');
};

// Keep the existing parameter budget (three); soft noteOn also sets volume.
export const aswanTimedCommandCost = command => command.method === 'applyAswanTimedOperation'
  ? (command.operation.method === 'noteOn' ? 4 : 3) : 1;

/** ASWAN-specific resolution and RPC. Time/order/storage belong to Performance Queue.
 * No user functions cross this boundary; captures occur between complete batches.
 */
export function createAswanTimedProcessor({performance: timeline, getState, getConfig, dispatch,
  nowFrame, sampleRate, leadFrames = 128, validatePlan, releaseOwner = () => {}, releasePattern = () => {}, releaseAll = () => {}}) {
  const staged = new Map();
  let nextReservation = 0;
  const freshTime = () => (nowFrame() + leadFrames) / sampleRate;
  const reportTo = (port,context) => event => {
    // Reservation failures are recoverable and must not retire the audio engine.
    const message={type:'aswan-timed-error',message:String(event.error),session:event.session,owner:context.owner};
    try { port.postMessage(message); } catch { console.error('[ASWAN timed reservation]',message.message); }
  };
  function context(payload, metadata) {
    let stats = timeline.getStats();
    if (metadata && metadata.session !== stats.activeSession) throw new Error('Performance session has expired');
    if (!stats.activeSession) {
      timeline.receive({type:'performance-start', session:stats.latestSession + 1}, () => {});
      stats = timeline.getStats();
    }
    return {session:stats.activeSession, owner:identity(metadata?.owner ?? payload.owner ?? 'aswan-timed:client', 'owner'),
      time:metadata?.time ?? freshTime()};
  }
  function admit(operations) {
    const plan = validateAswanOperations(operations, {validateArguments:false});
    // Admission is a virtual pass over authoritative authoring state and shared mode bits.
    // Actual execution resolves again, so intervening manual writes are retained.
    const state = getState();
    validatePlan?.(plan,state);
    validateAswanScheduledOperations(plan, state);
    return plan;
  }
  function specification(operations, options, ownerContext) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['name','repeatSeconds'].includes(key))) throw new TypeError('Invalid ASWAN schedule options');
    const plan = admit(operations);
    const reservation = ++nextReservation;
    return {name:identity(options.name, 'schedule name'), repeatSeconds:options.repeatSeconds,
      performance:ownerContext, entries:plan.operations.map(operation => ({
        offsetSeconds:aswanOperationOffsetSeconds(operation, plan.referenceSampleRate),
        command:{method:'applyAswanTimedOperation', operation, reservation, pattern:options.name},
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
    if (!payload || typeof payload !== 'object') throw new TypeError('Invalid ASWAN timed request');
    if(!['capture','schedule','clear','cancelOwner','releaseOwner','abort','stage','commit'].includes(payload.action))throw new TypeError('Invalid ASWAN timed action');
    if(metadata&&(!Number.isSafeInteger(metadata.session)||metadata.session<=0||
      !Number.isFinite(metadata.time)||metadata.time<0))throw new TypeError('Invalid ASWAN performance context');
    if(metadata)identity(metadata.owner,'owner');
    if (payload.action === 'capture') return createAswanTimedSnapshot(getState(), {
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
      if (!['schedule','clearSchedule'].includes(payload.method) || !Array.isArray(payload.args)) throw new TypeError('Invalid ASWAN staged operation');
      const records = new Map(staged.get(key)?.records);
      const name = payload.method === 'schedule' ? payload.args[1]?.name : payload.args[0];
      identity(name, 'schedule name');
      if (payload.method === 'schedule') {
        if (payload.args.length !== 2) throw new TypeError('Invalid ASWAN staged schedule arguments');
        records.set(name, {method:payload.method,args:[
          admit(payload.args[0]), {...payload.args[1]},
        ]});
      } else {
        if (payload.args.length !== 1) throw new TypeError('Invalid ASWAN staged clear arguments');
        records.set(name, {method:payload.method,args:[name]});
      }
      if (staged.size >= 128 && !staged.has(key)) throw new RangeError('Too many ASWAN staged transactions');
      let stored = 0;
      for (const [otherKey, transaction] of staged) if (otherKey !== key) {
        for (const record of transaction.records.values()) stored += record.args[0]?.operations?.length ?? 1;
      }
      for (const record of records.values()) stored += record.args[0]?.operations?.length ?? 1;
      if (stored > 65536) throw new RangeError('ASWAN staged operation capacity exceeded');
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
    throw new Error(`Unsupported ASWAN timed action: ${payload.action}`);
  }
  return {
    receive(data, port) {
      if (data?.method !== 'aswanTimed') return false;
      try { port.postMessage({id:data.id,value:invoke(data.args?.[0], data.timedPerformance, port)}); }
      catch (error) { port.postMessage({id:data.id,error:error.message,name:error.name}); }
      return true;
    },
    apply(command, port, frame, metadata) {
      const {operation, reservation, pattern} = command;
      // Admission already checked complete calls at the fixed Synth clock.
      // Both compiler and live dispatch invoke WonderSwanSynth methods, retaining
      // its actual-time R90 merge, validation and identical register conversion.
      // Do not dispatch raw bytes: that would replace keyboard/envelope owners.
      if (['setVolume','setPan'].includes(operation.method) && operation.args[0] === 1)
        validateAswanParameterPlan({operations:[operation]},getState());
      if (operation.method === 'noteOn' && operation.args[0] === 1)
        validateAswanScheduledOperations({version:1,chip:'wonderswan',referenceSampleRate:44100,
          operations:[{...operation,order:0}]},getState());
      return dispatch(operation, port, frame, {...metadata,reservation,pattern});
    },
    clear() { staged.clear(); releaseAll(); },
  };
}
