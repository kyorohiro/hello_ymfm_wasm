// SPDX-License-Identifier: BSD-3-Clause
import {validateSidOperations, sidOperationOffsetSeconds, createSidOperationResolver, compileSidOperations} from './sid_operations.js?v=sid-timed-1';
import {createSidTimedSnapshot} from './sid_timed_state.js?v=sid-timed-1';

const identity = (value, label) => {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError(`Invalid SID ${label}`);
  return value;
};
const transactionKey = value => {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return identity(value, 'transaction');
};

// One voice patch has at most five writes (PW low/high, AD, SR, control).
export const sidTimedCommandCost = command => command.method === 'applySidTimedOperation' ? 5 : 1;

/** Gate writes remain events even when the sent control byte is unchanged. */
export function sidGateEvents(register,value) {
  return [4,11,18].includes(register) ? [{channel:(register-4)/7,on:!!(value&1)}] : [];
}
const gateIntent = method => ['writeRegister','keyOn','keyOff','noteOn','noteOff','allNotesOff'].includes(method);

/** SID-specific resolution and RPC. Time/order/storage belong to Performance Queue.
 * No user functions cross this boundary; captures occur between complete batches.
 */
export function createSidTimedProcessor({performance: timeline, getState, getConfig, dispatch,
  nowFrame, sampleRate, leadFrames = 128, validatePlan, retainState}) {
  const staged = new Map(), gates = new Map();
  // Only three last-writer counters are retained. An Off recorded without an
  // earlier On is still a real bus write; it is stale only if a newer Gate
  // writer acquired that sounding channel after this reservation was admitted.
  const gateWrites = new Float64Array(3);
  let gateSequence = 0;
  let resolver, resolverConfig;
  function release(filter = {}) {
    let released = false, failure;
    for (const [channel, token] of [...gates]) {
      if (Object.entries(filter).some(([key,value])=>value!==undefined&&token[key]!==value)) continue;
      gates.delete(channel);
      try { dispatch({method:'keyOff',args:[channel]},token.port,nowFrame(),{owner:token.owner,timedOperation:true}); }
      catch (error) { failure ??= error; }
      released = true;
    }
    if(failure)throw failure;
    return released;
  }
  const releaseOwner = owner => release({owner});
  const releasePattern = (pattern,owner) => release({pattern,owner});
  const releaseAll = () => release();
  let nextReservation = 0;
  const freshTime = () => (nowFrame() + leadFrames) / sampleRate;
  const reportTo = (port,context) => event => {
    // Reservation failures are recoverable and must not retire the audio engine.
    const message={type:'sid-timed-error',message:String(event.error),session:event.session,owner:context.owner};
    try { port.postMessage(message); } catch { console.error('[SID timed reservation]',message.message); }
  };
  function context(payload, metadata) {
    let stats = timeline.getStats();
    if (metadata && metadata.session !== stats.activeSession) throw new Error('Performance session has expired');
    if (!stats.activeSession) {
      timeline.receive({type:'performance-start', session:stats.latestSession + 1}, {postMessage(){}});
      stats = timeline.getStats();
    }
    return {session:stats.activeSession, owner:identity(metadata?.owner ?? payload.owner ?? 'sid-timed:client', 'owner'),
      time:metadata?.time ?? freshTime()};
  }
  function admit(operations) {
    const plan = validateSidOperations(operations, {validateArguments:false});
    // Admission is a virtual pass over authoritative authoring state and shared mode bits.
    // Actual execution resolves again, so intervening manual writes are retained.
    const state = getState();
    validatePlan?.(plan,state);
    compileSidOperations(plan,state,getConfig());
    return plan;
  }
  function specification(operations, options, ownerContext) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['name','repeatSeconds'].includes(key))) throw new TypeError('Invalid SID schedule options');
    const plan = admit(operations);
    const reservation = ++nextReservation;
    return {name:identity(options.name, 'schedule name'), repeatSeconds:options.repeatSeconds,
      performance:ownerContext, entries:plan.operations.map(operation => ({
        offsetSeconds:sidOperationOffsetSeconds(operation, plan.referenceSampleRate),
        command:{method:'applySidTimedOperation', operation, reservation, gateEpoch:gateSequence, pattern:options.name},
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
    if (!payload || typeof payload !== 'object') throw new TypeError('Invalid SID timed request');
    if(!['capture','schedule','clear','cancelOwner','releaseOwner','abort','stage','commit'].includes(payload.action))throw new TypeError('Invalid SID timed action');
    if(metadata&&(!Number.isSafeInteger(metadata.session)||metadata.session<=0||
      !Number.isFinite(metadata.time)||metadata.time<0))throw new TypeError('Invalid SID performance context');
    if(metadata)identity(metadata.owner,'owner');
    if (payload.action === 'capture') return createSidTimedSnapshot(getState(), {
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
      if (!['schedule','clearSchedule'].includes(payload.method) || !Array.isArray(payload.args)) throw new TypeError('Invalid SID staged operation');
      const records = new Map(staged.get(key)?.records);
      const name = payload.method === 'schedule' ? payload.args[1]?.name : payload.args[0];
      identity(name, 'schedule name');
      if (payload.method === 'schedule') {
        if (payload.args.length !== 2) throw new TypeError('Invalid SID staged schedule arguments');
        records.set(name, {method:payload.method,args:[
          admit(payload.args[0]), {...payload.args[1]},
        ]});
      } else {
        if (payload.args.length !== 1) throw new TypeError('Invalid SID staged clear arguments');
        records.set(name, {method:payload.method,args:[name]});
      }
      if (staged.size >= 128 && !staged.has(key)) throw new RangeError('Too many SID staged transactions');
      let stored = 0;
      for (const [otherKey, transaction] of staged) if (otherKey !== key) {
        for (const record of transaction.records.values()) stored += record.args[0]?.operations?.length ?? 1;
      }
      for (const record of records.values()) stored += record.args[0]?.operations?.length ?? 1;
      if (stored > 65536) throw new RangeError('SID staged operation capacity exceeded');
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
    throw new Error(`Unsupported SID timed action: ${payload.action}`);
  }
  return {
    receive(data, port) {
      if (data?.method !== 'sidTimed') return false;
      let response;
      try { response={id:data.id,value:invoke(data.args?.[0], data.timedPerformance, port)}; }
      catch (error) { response={id:data.id,error:error.message,name:error.name}; }
      // A detached reply port must not turn a recoverable request error into
      // a fatal exception in the audio processor.
      try { port.postMessage(response); } catch {}
      return true;
    },
    apply(command, port, frame, metadata) {
      const {operation, reservation, gateEpoch, pattern} = command;
      const state = getState(), config = getConfig();
      validatePlan?.({operations:[operation]},state);
      const key = JSON.stringify([config.model,config.clock]);
      if (resolverConfig !== key) { resolver = createSidOperationResolver(config); resolverConfig = key; }
      const {writes,state:resolvedState} = resolver.resolve(operation,state);
      const preserveOwner = !gateIntent(operation.method);
      let applied=true;
      for (const {register,value} of writes) {
        // A later manual Gate retires this reservation's right to release it.
        // Check each channel independently for allNotesOff.
        if (!preserveOwner && [4,11,18].includes(register) && !(value&1)) {
          const channel=(register-4)/7,token = gates.get(channel);
          const owned=token?.owner===metadata.owner&&token.reservation===reservation;
          if ((state.registers[register]&1) && !owned && gateWrites[channel]>gateEpoch) { applied=false; continue; }
        }
        const accepted=dispatch({method:'writeRegister',args:[register,value]},port,frame,{
          ...metadata,reservation,pattern,timedOperation:true,preserveOwner,
          // The SID resolver's admission/last-writer check above is stricter
          // than a generic owner-name comparison for an explicit baseline Off.
          ...(!preserveOwner&&[4,11,18].includes(register)&&!(value&1)?{sidReleaseAllowed:true}:{}),
        });
        if(accepted===false)applied=false;
      }
      if(applied)retainState?.(resolvedState);
      return applied;
    },
    // Every actually applied Gate write passes here, including manual/Worker
    // writes. A newer writer retires the old reservation token on that channel.
    observeWrite(register,value,metadata,port) {
      if(metadata?.preserveOwner)return;
      for (const {channel,on} of sidGateEvents(register,value)) {
        gateWrites[channel]=++gateSequence;
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
