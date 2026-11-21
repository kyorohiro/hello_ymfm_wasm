import {validateYm2608Operations, ym2608OperationOffsetSeconds, createYm2608OperationResolver,
  createYm2608OperationResetState, validateYm2608OperationState, observeYm2608OperationWrite} from './ym2608_operations.js';
import {createYm2608TimedSnapshot} from './ym2608_timed_state.js';

const identity = (value, label) => {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError(`Invalid YM2608 ${label}`);
  return value;
};
const transactionKey = value => {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return identity(value, 'transaction');
};

/** YM2608-specific resolution and RPC. Time/order/storage belong to Performance Queue.
 * No user functions cross this boundary; captures occur between complete batches.
 */
export function createYm2608TimedProcessor({performance: timeline, getState, getConfig, dispatch,
  nowFrame, sampleRate, leadFrames = 128}) {
  const staged = new Map();
  let resolver, resolverClock;
  const freshTime = () => (nowFrame() + leadFrames) / sampleRate;
  const reportTo = (port,context) => event => {
    // Reservation failures are recoverable and must not retire the audio engine.
    const message={type:'ym2608-timed-error',message:String(event.error),session:event.session,owner:context.owner};
    try { port.postMessage(message); } catch { console.error('[YM2608 timed reservation]',message.message); }
  };
  function context(payload, metadata) {
    let stats = timeline.getStats();
    if (metadata && metadata.session !== stats.activeSession) throw new Error('Performance session has expired');
    if (!stats.activeSession) {
      timeline.receive({type:'performance-start', session:stats.latestSession + 1}, {postMessage() {}});
      stats = timeline.getStats();
    }
    return {session:stats.activeSession, owner:identity(metadata?.owner ?? payload.owner ?? 'ym2608-timed:client', 'owner'),
      time:metadata?.time ?? freshTime()};
  }
  function specification(operations, options, ownerContext) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['name','repeatSeconds'].includes(key))) throw new TypeError('Invalid YM2608 schedule options');
    validateYm2608OperationState(getState());
    const clock=getConfig().clock;
    const plan = validateYm2608Operations(operations, {clock,validateArguments:false});
    const admissionResolver=createYm2608OperationResolver({clock});
    let admissionState=createYm2608OperationResetState();
    const entries=plan.operations.map(operation=>{
      const resolved=admissionResolver.resolve(operation,admissionState);admissionState=resolved.state;
      return {offsetSeconds:ym2608OperationOffsetSeconds(operation,plan.referenceSampleRate),
        command:{method:'applyTimedOperation',operation,writeCost:Math.max(1,resolved.writes.length)}};
    });
    return {name:identity(options.name, 'schedule name'), repeatSeconds:options.repeatSeconds,
      performance:ownerContext, entries};
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
    if (!payload || typeof payload !== 'object') throw new TypeError('Invalid YM2608 timed request');
    if(!['capture','schedule','clear','cancelOwner','releaseOwner','abort','stage','commit'].includes(payload.action))throw new TypeError('Invalid YM2608 timed action');
    if(metadata&&(!Number.isSafeInteger(metadata.session)||metadata.session<=0||
      !Number.isFinite(metadata.time)||metadata.time<0))throw new TypeError('Invalid YM2608 performance context');
    if(metadata)identity(metadata.owner,'owner');
    if (payload.action === 'capture') return createYm2608TimedSnapshot(getState(), {
      ...getConfig(), frame:nowFrame(), sampleRate,
    });
    const ownerContext = context(payload, metadata);
    prune();
    const {session, owner} = ownerContext;
    if (payload.action === 'schedule') return timeline.schedulePattern(specification(payload.operations, payload.options, ownerContext), reportTo(port,ownerContext));
    if (payload.action === 'clear') return timeline.clearPattern(identity(payload.name, 'schedule name'), {session,owner});
    if (payload.action === 'cancelOwner' || payload.action === 'releaseOwner') {
      for (const [key, value] of staged) if (value.session === session && value.owner === owner) staged.delete(key);
      if(payload.action==='releaseOwner'){timeline.cancelOwner(owner);return true;}
      return timeline.cancelPatternOwner(owner, {session});
    }
    const key = stagingKey(session, owner, payload.transactionId);
    if (payload.action === 'abort') { staged.delete(key); return true; }
    if (payload.action === 'stage') {
      if (!['schedule','clearSchedule'].includes(payload.method) || !Array.isArray(payload.args)) throw new TypeError('Invalid YM2608 staged operation');
      const records = new Map(staged.get(key)?.records);
      const name = payload.method === 'schedule' ? payload.args[1]?.name : payload.args[0];
      identity(name, 'schedule name');
      if (payload.method === 'schedule') {
        if (payload.args.length !== 2) throw new TypeError('Invalid YM2608 staged schedule arguments');
        records.set(name, {method:payload.method,args:[
          validateYm2608Operations(payload.args[0], {clock:getConfig().clock}), {...payload.args[1]},
        ]});
      } else {
        if (payload.args.length !== 1) throw new TypeError('Invalid YM2608 staged clear arguments');
        records.set(name, {method:payload.method,args:[name]});
      }
      if (staged.size >= 128 && !staged.has(key)) throw new RangeError('Too many YM2608 staged transactions');
      let stored = 0;
      for (const [otherKey, transaction] of staged) if (otherKey !== key) {
        for (const record of transaction.records.values()) stored += record.args[0]?.operations?.length ?? 1;
      }
      for (const record of records.values()) stored += record.args[0]?.operations?.length ?? 1;
      if (stored > 65536) throw new RangeError('YM2608 staged operation capacity exceeded');
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
      staged.delete(key);
      return receipt;
    }
    throw new Error(`Unsupported YM2608 timed action: ${payload.action}`);
  }
  return {
    receive(data, port) {
      if (data?.method !== 'ym2608Timed') return false;
      try { port.postMessage({id:data.id,value:invoke(data.args?.[0], data.timedPerformance, port)}); }
      catch (error) { port.postMessage({id:data.id,error:error.message,name:error.name}); }
      return true;
    },
    apply(operation, port, frame, metadata) {
      const clock = getConfig().clock;
      if (clock !== resolverClock) { resolver = createYm2608OperationResolver({clock}); resolverClock = clock; }
      const result = resolver.resolve(operation, getState());
      for (const {port:registerPort,register,value} of result.writes) {
        dispatch({type:'write',port:registerPort,register,value}, port, frame,
          {...metadata,timedOperation:true,preserveOwner:!(registerPort===0&&(register===0x28||register===0x10||register>=8&&register<=10))});
      }
      getState().ssgLevels=[...result.state.ssgLevels];
      getState().rhythmLevels=[...result.state.rhythmLevels];
    },
    clear() { staged.clear(); },
  };
}

/** Observe the accepted native bus below keyboard guards and inspectors. This
 * includes direct register pairs, raw address/data calls and legacy writes.
 * No write is added or removed and no PCM generation is performed here.
 * @param {any} chip @param {{onRhythmGate?:(value:number)=>void}} [options] */
export function observeYm2608TimedChip(chip, {onRhythmGate} = {}) {
  let state = createYm2608OperationResetState(), address = 0;
  const write = chip.write.bind(chip), reset = chip.reset.bind(chip);
  chip.write = (offset, value) => {
    const result = write(offset,value);
    const bus = offset & 3, byte = value & 255;
    if (!(bus & 1)) {address = ((bus & 2) << 7) | byte;if(bus===0&&[0x2d,0x2e,0x2f].includes(byte))state.prescaler=byte===0x2d?6:byte===0x2e?3:2;}
    else if ((address >> 8) === (bus >> 1)) {
      observeYm2608OperationWrite(state,address >> 8,address & 255,byte);
      if(address===0x10)onRhythmGate?.(byte);
    }
    return result;
  };
  chip.reset = (...args) => {
    const result = reset(...args);
    state = createYm2608OperationResetState(); address = 0; onRhythmGate?.(0xbf);
    return result;
  };
  return {getState: () => state};
}
