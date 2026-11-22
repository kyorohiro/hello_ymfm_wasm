export const PERFORMANCE_PATTERN_LIMITS = Object.freeze({
  maxPatterns: 128,
  maxPatternEntries: 4096,
  maxPatternRate: 48000,
});

function copyPatternData(value, seen, budget, depth = 0) {
  if (--budget.remaining < 0 || depth > 32) {
    throw new RangeError('Performance pattern data exceeds its size limit');
  }
  if (value === null || value === undefined || typeof value === 'string' ||
      typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('Performance pattern commands must contain serializable data');
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Performance pattern commands require plain objects and arrays');
  }
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) {
    if (value.length > budget.remaining) {
      throw new RangeError('Performance pattern array exceeds its size limit');
    }
    result.length = value.length;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('Performance pattern commands cannot contain accessors or symbols');
    }
    Object.defineProperty(result, key, {
      value: copyPatternData(descriptor.value, seen, budget, depth + 1),
      enumerable: true, configurable: true, writable: true,
    });
  }
  seen.delete(value);
  return result;
}

/** AudioWorklet performance reservations. Time is absolute audio-clock seconds.
 * Ordinary untagged messages remain the caller's immediate path. A batch is
 * validated on arrival and applied atomically, in submission order, at its frame.
 */
export function createPerformanceQueue({
  apply,
  nowFrame,
  sampleRate,
  maxCommands = 65536,
  maxPatterns = PERFORMANCE_PATTERN_LIMITS.maxPatterns,
  maxPatternEntries = PERFORMANCE_PATTERN_LIMITS.maxPatternEntries,
  maxPatternRate = PERFORMANCE_PATTERN_LIMITS.maxPatternRate,
  patternCommandCost,
  validate,
  prepare,
  onDiscard,
  onCancelOwner,
  onReleasePattern,
}) {
  if (typeof apply !== 'function' || typeof nowFrame !== 'function' ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(maxCommands) || maxCommands < 1 ||
      !Number.isSafeInteger(maxPatterns) || maxPatterns < 1 ||
      !Number.isSafeInteger(maxPatternEntries) || maxPatternEntries < 1 ||
      !Number.isFinite(maxPatternRate) || maxPatternRate <= 0 ||
      (patternCommandCost !== undefined && typeof patternCommandCost !== 'function')) {
    throw new TypeError('Invalid performance queue configuration');
  }
  let heap = [], queuedCommands = 0, serial = 0;
  let activeSession = 0, latestSession = 0;
  const canceledOwners = new Set();
  const canceledPatternOwners = new Set();
  const patterns = new Map();
  let storedPatternCommands = 0, patternRate = 0;
  let storedPatternCost = 0, patternCostRate = 0;
  let lateCommands = 0, maxLateFrames = 0, rejectedBatches = 0, discardedCommands = 0;
  const validSession = session => Number.isSafeInteger(session) && session > 0;
  const validOwner = owner => typeof owner === 'string' && owner.length > 0 && owner.length <= 256;
  const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 128;
  const before = (a, b) => a.frame < b.frame || (a.frame === b.frame && a.serial < b.serial);
  const sendError = (reply, performance, error) => reply?.({
    type: 'performance-error', session: performance?.session,
    error: String(error?.message ?? error),
  });
  function discard(event) {
    discardedCommands += event.commands.length;
    if (!onDiscard) return;
    for (const command of event.commands) {
      try { onDiscard(command, event.performance); }
      catch (error) { sendError(event.reply, event.performance, error); }
    }
  }
  function clear() {
    for (const event of heap) if (!event.pattern) discard(event);
    for (const pattern of [...patterns.values()]) discardPattern(pattern);
    releasePattern();
    heap.length = 0;
    queuedCommands = 0;
  }
  function push(event) {
    let index = heap.length;
    heap.push(event);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!before(event, heap[parent])) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = event;
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
        if (!before(heap[child], last)) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = last;
    }
    return first;
  }
  function validatePattern(spec) {
    if (!spec || typeof spec !== 'object' || !validName(spec.name)) {
      throw new TypeError('Performance pattern name must contain 1..128 characters');
    }
    const performance = spec.performance;
    if (!performance || !validSession(performance.session) ||
        !validOwner(performance.owner) || !Number.isFinite(performance.time) ||
        performance.time < 0) {
      throw new TypeError('Invalid performance pattern timestamp, session or owner');
    }
    if (performance.session !== activeSession || canceledOwners.has(performance.owner) ||
        canceledPatternOwners.has(performance.owner)) {
      throw new Error('Performance session or owner is no longer active');
    }
    const startFrame = Math.round(performance.time * sampleRate);
    if (!Number.isSafeInteger(startFrame) || startFrame < nowFrame()) {
      throw new RangeError('Performance pattern start precedes the current frame or exceeds the timeline');
    }
    if (!Array.isArray(spec.entries) || spec.entries.length < 1 ||
        spec.entries.length > maxPatternEntries) {
      throw new RangeError('Performance pattern entry limit exceeded or empty pattern');
    }
    const budget = {remaining: 262144};
    let previous = 0, cost = 0;
    const entries = Array.from(spec.entries, entry => {
      if (!entry || typeof entry !== 'object' ||
          !Number.isFinite(entry.offsetSeconds) || entry.offsetSeconds < previous) {
        throw new TypeError('Performance pattern offsets must be finite, nonnegative and ordered');
      }
      previous = entry.offsetSeconds;
      if (!Number.isSafeInteger(startFrame + Math.round(previous * sampleRate))) {
        throw new RangeError('Performance pattern offset exceeds the audio timeline');
      }
      const command = copyPatternData(entry.command, new Set(), budget);
      if (!command || typeof command !== 'object' || Array.isArray(command) ||
          (!Object.hasOwn(command, 'type') && !Object.hasOwn(command, 'op') && !Object.hasOwn(command, 'method')) ||
          String(command.type ?? '').startsWith('performance-') || command.id !== undefined) {
        throw new TypeError('Invalid performance pattern command');
      }
      validate?.(command, performance);
      const commandCost = patternCommandCost?.(command) ?? 1;
      if (!Number.isSafeInteger(commandCost) || commandCost < 1 || commandCost > maxCommands) {
        throw new RangeError('Invalid performance pattern command cost');
      }
      cost += commandCost;
      return {offsetSeconds: entry.offsetSeconds, command};
    });
    const repeatSeconds = spec.repeatSeconds;
    if (repeatSeconds !== undefined && (!Number.isFinite(repeatSeconds) ||
        repeatSeconds <= previous || cost / repeatSeconds > maxPatternRate)) {
      throw new RangeError('Performance repeat interval is invalid or exceeds the operation rate limit');
    }
    return {name: spec.name, entries, repeatSeconds, startFrame, cost,
      performance: {session: performance.session, owner: performance.owner, time: performance.time,
        patternName: spec.name}};
  }
  function releasePattern(name, context, reply) {
    // Transport cancellation and voice release are independent. The chip
    // checks that the note still belongs to this reservation before releasing.
    try { return Boolean(onReleasePattern?.(name, context)); }
    catch (error) { sendError(reply, context, error); return false; }
  }
  function discardPattern(pattern) {
    if (patterns.get(pattern.name) !== pattern) return;
    patterns.delete(pattern.name);
    storedPatternCommands -= pattern.entries.length;
    storedPatternCost -= pattern.cost;
    patternRate -= pattern.rate; patternCostRate -= pattern.costRate;
    if (patterns.size === 0) patternRate = patternCostRate = 0;
    discard({commands: pattern.entries.map(entry => entry.command),
      performance: pattern.performance, reply: pattern.reply});
    releasePattern(pattern.name, pattern.performance, pattern.reply);
  }
  function rebuildWithout(removed) {
    const retained = heap.filter(event => !removed.has(event.pattern));
    heap = [];
    for (const event of retained) push(event);
  }
  function patternReceipt(pattern) {
    return {name: pattern.name, startFrame: pattern.startFrame, sampleRate,
      entries: pattern.entries.length, repeatSeconds: pattern.repeatSeconds};
  }
  function nextPatternEvent(pattern) {
    const entry = pattern.entries[pattern.index];
    const offset = pattern.cycle * (pattern.repeatSeconds ?? 0) + entry.offsetSeconds;
    const frame = pattern.startFrame + Math.round(offset * sampleRate);
    if (!Number.isSafeInteger(frame)) throw new RangeError('Performance pattern exceeded the audio timeline');
    return {frame, serial: pattern.serial, performance: pattern.performance,
      commands: [entry.command], reply: pattern.reply, pattern};
  }
  function checkPatternCapacity(prepared, removed) {
    let count = patterns.size - removed.size, commands = storedPatternCost, rate = patternCostRate;
    for (const pattern of removed) {
      commands -= pattern.cost;
      rate -= pattern.costRate;
    }
    for (const pattern of prepared) {
      count++;
      commands += pattern.cost;
      rate += pattern.repeatSeconds === undefined ? 0 : pattern.cost / pattern.repeatSeconds;
    }
    if (count > maxPatterns || commands + queuedCommands > maxCommands ||
        rate > maxPatternRate + Number.EPSILON * maxPatternRate) {
      throw new RangeError('Performance pattern capacity or aggregate operation rate exceeded');
    }
  }
  function installPatterns(prepared, removed, reply) {
    for (const pattern of removed) discardPattern(pattern);
    if (removed.size) rebuildWithout(removed);
    const receipts = [];
    for (const spec of prepared) {
      // A completed one-shot can still own a held note with this name.
      releasePattern(spec.name, {session: spec.performance.session}, reply);
      const pattern = {...spec, reply, index: 0, cycle: 0, serial: serial++,
        rate: spec.repeatSeconds === undefined ? 0 : spec.entries.length / spec.repeatSeconds,
        costRate: spec.repeatSeconds === undefined ? 0 : spec.cost / spec.repeatSeconds};
      patterns.set(pattern.name, pattern);
      storedPatternCommands += pattern.entries.length; storedPatternCost += pattern.cost;
      patternRate += pattern.rate; patternCostRate += pattern.costRate;
      push(nextPatternEvent(pattern));
      receipts.push(patternReceipt(pattern));
    }
    return receipts;
  }
  function schedulePattern(spec, reply) {
    const prepared = validatePattern(spec);
    const previous = patterns.get(prepared.name);
    const removed = new Set(previous ? [previous] : []);
    checkPatternCapacity([prepared], removed);
    return installPatterns([prepared], removed, reply)[0];
  }
  // Reset a chip's register reservations without dropping ordinary commands
  // already ordered after a queued initialize/reset operation.
  function clearPatterns() {
    const removed = new Set(patterns.values());
    for (const pattern of removed) discardPattern(pattern);
    if (removed.size) rebuildWithout(removed);
    releasePattern();
  }
  function clearPattern(name, {session, owner} = {}) {
    if (!validName(name)) throw new TypeError('Invalid performance pattern name');
    if (session !== undefined && !validSession(session)) throw new TypeError('Invalid performance session');
    if (owner !== undefined && !validOwner(owner)) throw new TypeError('Invalid performance owner');
    const pattern = patterns.get(name);
    if (session !== undefined && session !== activeSession) return false;
    if (!pattern || (owner !== undefined && owner !== pattern.performance.owner))
      return releasePattern(name, {session, owner});
    discardPattern(pattern);
    rebuildWithout(new Set([pattern]));
    return true;
  }
  function cancelPatternOwner(owner, {session} = {}) {
    if (!validOwner(owner)) throw new TypeError('Invalid performance owner');
    if (session !== undefined && !validSession(session)) throw new TypeError('Invalid performance session');
    if (!activeSession || (session !== undefined && session !== activeSession)) return false;
    canceledPatternOwners.add(owner);
    const removed = new Set([...patterns.values()].filter(pattern => pattern.performance.owner === owner));
    for (const pattern of removed) discardPattern(pattern);
    if (removed.size) rebuildWithout(removed);
    releasePattern(undefined, {session, owner});
    return true;
  }
  function commitPatterns(changes, {session, owner, dryRun = false} = {}, reply) {
    if (!validSession(session) || !validOwner(owner) || typeof dryRun !== 'boolean') {
      throw new TypeError('Invalid performance pattern transaction context');
    }
    if (session !== activeSession || canceledOwners.has(owner) || canceledPatternOwners.has(owner)) {
      throw new Error('Performance session or owner is no longer active');
    }
    if (!Array.isArray(changes) || changes.length > maxPatterns) {
      throw new RangeError('Invalid performance pattern transaction size');
    }
    const removed = new Set([...patterns.values()].filter(pattern => pattern.performance.owner === owner));
    const prepared = [], names = new Set();
    for (const change of changes) {
      if (!change || !validName(change.name) || names.has(change.name)) {
        throw new TypeError('Pattern transaction names must be valid and unique');
      }
      names.add(change.name);
      if (change.clear === true) continue;
      const pattern = validatePattern(change);
      if (pattern.performance.session !== session || pattern.performance.owner !== owner) {
        throw new TypeError('Pattern transaction does not match its session and owner');
      }
      const previous = patterns.get(pattern.name);
      if (previous) removed.add(previous);
      prepared.push(pattern);
    }
    checkPatternCapacity(prepared, removed);
    const cleared = [...removed].map(pattern => pattern.name);
    if (!dryRun) releasePattern(undefined, {session, owner}, reply);
    const reservations = dryRun ? prepared.map(patternReceipt) : installPatterns(prepared, removed, reply);
    return {session, owner, reservations, cleared};
  }
  function cancelOwner(owner, reply) {
    if (!validOwner(owner)) throw new TypeError('Invalid performance owner');
    if (canceledOwners.has(owner)) return;
    canceledOwners.add(owner);
    for (const pattern of [...patterns.values()]) {
      if (pattern.performance.owner === owner) discardPattern(pattern);
    }
    const retained = [];
    for (const event of heap) {
      if (event.pattern) {
        if (patterns.get(event.pattern.name) === event.pattern) retained.push(event);
      } else if (event.performance.owner === owner) {
        queuedCommands -= event.commands.length; discard(event);
      }
      else retained.push(event);
    }
    heap = [];
    for (const event of retained) push(event);
    try { onCancelOwner?.(owner, activeSession); }
    catch (error) { sendError(reply, {session: activeSession}, error); }
  }
  function control(data, reply) {
    const action = data.type.slice('performance-'.length);
    const result = {type: 'performance-result', action, id: data.id, session: data.session};
    if (!validSession(data.session)) {
      reply?.({...result, error: 'Performance session must be a positive safe integer'});
      return;
    }
    if (action === 'start') {
      if (data.session === activeSession) { reply?.(result); return; }
      if (data.session <= latestSession) { reply?.({...result, error: 'Performance session has expired'}); return; }
      clear(); canceledOwners.clear(); canceledPatternOwners.clear();
      latestSession = activeSession = data.session;
      lateCommands = maxLateFrames = rejectedBatches = discardedCommands = 0;
    } else if (action === 'stop') {
      if (data.session < latestSession) { reply?.({...result, ignored: true}); return; }
      clear(); canceledOwners.clear(); canceledPatternOwners.clear();
      latestSession = data.session; activeSession = 0;
    } else {
      if (!validOwner(data.owner)) { reply?.({...result, error: 'Invalid performance owner'}); return; }
      if (data.session !== activeSession) { reply?.({...result, ignored: true}); return; }
      cancelOwner(data.owner, reply);
    }
    reply?.(result);
  }
  function enqueue(data, reply) {
    const performance = data.performance;
    try {
      if (!performance || typeof performance !== 'object' ||
          !validSession(performance.session) || !validOwner(performance.owner) ||
          !Number.isFinite(performance.time) || performance.time < 0) {
        throw new TypeError('Invalid performance timestamp, session or owner');
      }
      const frame = Math.round(performance.time * sampleRate);
      if (!Number.isSafeInteger(frame)) throw new RangeError('Performance time exceeds the audio timeline');
      if (!Array.isArray(data.commands) || data.commands.length < 1 ||
          data.commands.length > maxCommands ||
          queuedCommands + storedPatternCost + data.commands.length > maxCommands) {
        throw new RangeError('Performance queue capacity exceeded or empty command batch');
      }
      for (const command of data.commands) {
        if (!command || typeof command !== 'object' || Array.isArray(command) ||
            (!Object.hasOwn(command, 'type') && !Object.hasOwn(command, 'op') && !Object.hasOwn(command, 'method')) ||
            String(command.type ?? '').startsWith('performance-')) {
          throw new TypeError('Invalid performance command');
        }
        validate?.(command, performance);
      }
      // Old and canceled batches cannot reserve resources or acknowledge an RPC.
      if (performance.session !== activeSession || canceledOwners.has(performance.owner)) {
        rejectedBatches++;
        if (data.commands.some(command => command.id !== undefined)) {
          sendError(reply, performance, new Error('Performance session or owner is no longer active'));
        }
        return;
      }
      const commands = [];
      try {
        for (const command of data.commands) {
          const deferred = prepare ? prepare(command, reply, performance) : command;
          if (deferred != null) {
            if (typeof deferred !== 'object' || typeof deferred.then === 'function') {
              throw new TypeError('Performance preparation must return a command or null synchronously');
            }
            commands.push(deferred);
          }
        }
      } catch (error) {
        discard({commands, performance, reply});
        throw error;
      }
      if (!commands.length) return;
      queuedCommands += commands.length;
      push({frame, serial: serial++, performance, commands, reply});
    } catch (error) {
      rejectedBatches++;
      sendError(reply, performance, error);
    }
  }
  return {
    /** True means recognized; invalid and stale envelopes never fall through. */
    receive(data, reply) {
      if (!data || typeof data !== 'object') return false;
      if (['performance-start', 'performance-stop', 'performance-cancel-owner'].includes(data.type)) {
        control(data, reply); return true;
      }
      if (Object.hasOwn(data, 'performance')) { enqueue(data, reply); return true; }
      return false;
    },
    nextFrame: () => heap[0]?.frame ?? Infinity,
    advance(frame = nowFrame()) {
      if (!Number.isSafeInteger(frame) || frame < 0) return;
      while (heap.length && heap[0].frame <= frame) {
        const event = pop();
        const pattern = event.pattern;
        if (pattern) {
          if (patterns.get(pattern.name) !== pattern) continue;
        } else queuedCommands -= event.commands.length;
        const late = frame - event.frame;
        if (late > 0) { lateCommands += event.commands.length; maxLateFrames = Math.max(maxLateFrames, late); }
        let failed = false;
        for (const command of event.commands) {
          try { apply(command, event.reply, frame, event.performance); }
          catch (error) { sendError(event.reply, event.performance, error); failed = true; }
        }
        if (pattern && patterns.get(pattern.name) === pattern) {
          if (failed) {
            discardPattern(pattern);
            continue;
          }
          pattern.index++;
          if (pattern.index === pattern.entries.length) {
            if (pattern.repeatSeconds === undefined) {
              patterns.delete(pattern.name);
              storedPatternCommands -= pattern.entries.length; storedPatternCost -= pattern.cost;
              continue;
            }
            pattern.index = 0;
            pattern.cycle++;
          }
          try { push(nextPatternEvent(pattern)); }
          catch (error) {
            sendError(event.reply, event.performance, error);
            discardPattern(pattern);
          }
        }
      }
    },
    validatePattern,
    schedulePattern,
    clearPattern,
    clearPatterns,
    commitPatterns,
    cancelPatternOwner,
    clear,
    cancelOwner,
    getStats: () => ({activeSession, latestSession, queuedCommands, queuedBatches: heap.length,
      patternCount: patterns.size, storedPatternCommands, patternRate, storedPatternCost, patternCostRate,
      lateCommands, maxLateFrames, rejectedBatches, discardedCommands}),
  };
}

/** Applied primary-chip voice ownership. Cancellation releases a loop's current
 * voices without sending an old loop's finally-block key off to a newer voice.
 * writeFm goes through the audition guard, so a held manual key keeps priority.
 */
export function createPerformanceChipOwnership({writeFm, writePsg, channelCount = 6}) {
  const fmOwners = new Array(channelCount).fill(null), fmActive = new Array(channelCount).fill(false), psgOwners = new Array(4).fill(null);
  let psgLatch = 0;
  const reset = () => {fmOwners.fill(null); fmActive.fill(false); psgOwners.fill(null); psgLatch = 0;};
  function releaseWhere(matches) {
    let released = false;
    for (let channel = 0; channel < fmOwners.length; channel++) {
      if (!fmOwners[channel] || !matches(fmOwners[channel])) continue;
      fmOwners[channel] = null; fmActive[channel] = false;
      writeFm(0x28, channel < 3 ? channel : channel + 1, 0);
      released = true;
    }
    for (let channel = 0; channel < psgOwners.length; channel++) {
      if (!psgOwners[channel] || !matches(psgOwners[channel])) continue;
      psgOwners[channel] = null;
      writePsg?.(0x90 | (channel << 5) | 15);
      psgLatch = channel * 2 + 1;
      released = true;
    }
    return released;
  }
  return {
    observe(command, performance) {
      const owner = performance?.owner == null ? null : {
        owner: performance.owner, session: performance.session, patternName: performance.patternName,
      };
      if (command.type === 'reset') {reset(); return;}
      if (command.type === 'write' && command.register === 0x28 && (command.port ?? 0) === 0) {
        const code = command.value & 7, channel = (code & 3) + (code & 4 ? 3 : 0);
        if ((code & 3) !== 3 && channel < channelCount) {
          fmActive[channel] = !!(command.value & 0xf0);
          fmOwners[channel] = fmActive[channel] ? owner : null;
        }
      }
      if (command.type === 'psg-reset') {psgOwners.fill(null); psgLatch = 0;}
      if (command.type === 'psg-write') {
        const value = command.value;
        if (value & 0x80) psgLatch = (value >> 4) & 7;
        const channel = psgLatch >> 1;
        // Frequency-only modulation does not create a replacement voice.
        if (psgLatch & 1) psgOwners[channel] = (value & 15) === 15 ? null : owner;
      }
    },
    // Only the new explicit timed path consults this guard. Existing immediate
    // and legacy scheduling behavior is unchanged. A later Gate owns its Off,
    // while parameter-only edits never acquire or discard a voice owner.
    canApplyTimed(command, performance) {
      if (command.type !== 'write' || command.register !== 0x28 ||
          (command.port ?? 0) !== 0 || (command.value & 0xf0 && !performance?.releasingGate)) return true;
      const code = command.value & 7, channel = (code & 3) + (code & 4 ? 3 : 0);
      if ((code & 3) === 3 || channel >= channelCount || !fmActive[channel]) return true;
      const previous = fmOwners[channel];
      return (previous?.owner ?? null) === (performance?.owner ?? null) &&
        (previous?.patternName === undefined || performance?.patternName === undefined ||
          previous.patternName === performance.patternName);
    },
    cancel(owner) { return releaseWhere(entry => entry.owner === owner); },
    releasePattern(name, {owner,session} = {}) {
      return releaseWhere(entry => entry.patternName !== undefined &&
        (name === undefined || entry.patternName === name) &&
        (owner === undefined || entry.owner === owner) &&
        (session === undefined || entry.session === session));
    },
    reset,
  };
}
