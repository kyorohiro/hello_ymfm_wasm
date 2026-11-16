import {validateAyOperations, ayOperationOffsetSeconds, createAyOperationResolver} from './ay8910_operations.js';
import {createAyTimedSnapshot} from './ay8910_timed_state.js';

const gateMethods = new Set(['noteOn','keyOn','noteOff','keyOff','off','allNotesOff']);
const identity = (value, label) => {
  if (typeof value !== 'string' || !value.length || value.length > 256) throw new TypeError(`Invalid AY ${label}`);
  return value;
};
const transactionKey = value => {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return identity(value, 'transaction');
};

/** AY-specific resolution and RPC. Time/order/storage belong to Performance Queue.
 * No user functions cross this boundary; captures occur between complete batches.
 */
export function createAyTimedProcessor({performance: timeline, getState, setLevels, getConfig, dispatch,
  nowFrame, sampleRate, leadFrames = 128}) {
  const staged = new Map();
  let resolver, resolverClock;
  const freshTime = () => (nowFrame() + leadFrames) / sampleRate;
  const reportTo = (port,context) => event => {
    // Reservation failures are recoverable and must not retire the audio engine.
    const message={type:'ay-timed-error',message:String(event.error),session:event.session,owner:context.owner};
    try { port.postMessage(message); } catch { console.error('[AY timed reservation]',message.message); }
  };
  function context(payload, metadata) {
    let stats = timeline.getStats();
    if (metadata && metadata.session !== stats.activeSession) throw new Error('Performance session has expired');
    if (!stats.activeSession) {
      timeline.receive({type:'performance-start', session:stats.latestSession + 1}, {postMessage() {}});
      stats = timeline.getStats();
    }
    return {session:stats.activeSession, owner:identity(metadata?.owner ?? payload.owner ?? 'ay-timed:client', 'owner'),
      time:metadata?.time ?? freshTime()};
  }
  function specification(operations, options, ownerContext) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['name','repeatSeconds'].includes(key))) throw new TypeError('Invalid AY schedule options');
    const plan = validateAyOperations(operations, {clock:getConfig().clock});
    return {name:identity(options.name, 'schedule name'), repeatSeconds:options.repeatSeconds,
      performance:ownerContext, entries:plan.operations.map(operation => ({
        offsetSeconds:ayOperationOffsetSeconds(operation, plan.referenceSampleRate),
        command:{method:'applyTimedOperation', operation},
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
    if (!payload || typeof payload !== 'object') throw new TypeError('Invalid AY timed request');
    if(!['capture','schedule','clear','cancelOwner','releaseOwner','abort','stage','commit'].includes(payload.action))throw new TypeError('Invalid AY timed action');
    if(metadata&&(!Number.isSafeInteger(metadata.session)||metadata.session<=0||
      !Number.isFinite(metadata.time)||metadata.time<0))throw new TypeError('Invalid AY performance context');
    if(metadata)identity(metadata.owner,'owner');
    if (payload.action === 'capture') return createAyTimedSnapshot(getState(), {
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
      if (!['schedule','clearSchedule'].includes(payload.method) || !Array.isArray(payload.args)) throw new TypeError('Invalid AY staged operation');
      const records = new Map(staged.get(key)?.records);
      const name = payload.method === 'schedule' ? payload.args[1]?.name : payload.args[0];
      identity(name, 'schedule name');
      if (payload.method === 'schedule') {
        if (payload.args.length !== 2) throw new TypeError('Invalid AY staged schedule arguments');
        records.set(name, {method:payload.method,args:[
          validateAyOperations(payload.args[0], {clock:getConfig().clock}), {...payload.args[1]},
        ]});
      } else {
        if (payload.args.length !== 1) throw new TypeError('Invalid AY staged clear arguments');
        records.set(name, {method:payload.method,args:[name]});
      }
      if (staged.size >= 128 && !staged.has(key)) throw new RangeError('Too many AY staged transactions');
      let stored = 0;
      for (const [otherKey, transaction] of staged) if (otherKey !== key) {
        for (const record of transaction.records.values()) stored += record.args[0]?.operations?.length ?? 1;
      }
      for (const record of records.values()) stored += record.args[0]?.operations?.length ?? 1;
      if (stored > 65536) throw new RangeError('AY staged operation capacity exceeded');
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
    throw new Error(`Unsupported AY timed action: ${payload.action}`);
  }
  return {
    receive(data, port) {
      if (data?.method !== 'ayTimed') return false;
      try { port.postMessage({id:data.id,value:invoke(data.args?.[0], data.timedPerformance, port)}); }
      catch (error) { port.postMessage({id:data.id,error:error.message,name:error.name}); }
      return true;
    },
    apply(operation, port, frame, metadata) {
      const clock = getConfig().clock;
      if (clock !== resolverClock) { resolver = createAyOperationResolver({clock}); resolverClock = clock; }
      const result = resolver.resolve(operation, getState());
      let applied = true;
      for (const {register,value} of result.writes) {
        if (dispatch({method:'writeRegister',args:[register,value]}, port, frame,
          {...metadata,timedOperation:true,preserveOwner:!gateMethods.has(operation.method)}) === false) applied = false;
      }
      // A guarded stale release cannot overwrite a newer manual key's metadata.
      if (applied) setLevels(result.state.levels);
    },
    clear() { staged.clear(); },
  };
}
