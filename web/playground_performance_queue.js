/** AudioWorklet performance reservations. Time is absolute audio-clock seconds.
 * Ordinary untagged messages remain the caller's immediate path. A batch is
 * validated on arrival and applied atomically, in submission order, at its frame.
 */
export function createPerformanceQueue({
  apply,
  nowFrame,
  sampleRate,
  maxCommands = 65536,
  validate,
  prepare,
  onDiscard,
  onCancelOwner,
}) {
  if (typeof apply !== 'function' || typeof nowFrame !== 'function' ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(maxCommands) || maxCommands < 1) {
    throw new TypeError('Invalid performance queue configuration');
  }
  let heap = [], queuedCommands = 0, serial = 0;
  let activeSession = 0, latestSession = 0;
  const canceledOwners = new Set();
  let lateCommands = 0, maxLateFrames = 0, rejectedBatches = 0, discardedCommands = 0;
  const validSession = session => Number.isSafeInteger(session) && session > 0;
  const validOwner = owner => typeof owner === 'string' && owner.length > 0 && owner.length <= 256;
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
    for (const event of heap) discard(event);
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
  function cancelOwner(owner, reply) {
    if (!validOwner(owner)) throw new TypeError('Invalid performance owner');
    if (canceledOwners.has(owner)) return;
    canceledOwners.add(owner);
    const retained = [];
    for (const event of heap) {
      if (event.performance.owner === owner) { queuedCommands -= event.commands.length; discard(event); }
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
      clear(); canceledOwners.clear();
      latestSession = activeSession = data.session;
      lateCommands = maxLateFrames = rejectedBatches = discardedCommands = 0;
    } else if (action === 'stop') {
      if (data.session < latestSession) { reply?.({...result, ignored: true}); return; }
      clear(); canceledOwners.clear();
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
          data.commands.length > maxCommands || queuedCommands + data.commands.length > maxCommands) {
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
        const event = pop(); queuedCommands -= event.commands.length;
        const late = frame - event.frame;
        if (late > 0) { lateCommands += event.commands.length; maxLateFrames = Math.max(maxLateFrames, late); }
        for (const command of event.commands) {
          try { apply(command, event.reply, frame, event.performance); }
          catch (error) { sendError(event.reply, event.performance, error); }
        }
      }
    },
    clear,
    cancelOwner,
    getStats: () => ({activeSession, latestSession, queuedCommands, queuedBatches: heap.length,
      lateCommands, maxLateFrames, rejectedBatches, discardedCommands}),
  };
}

/** Applied primary-chip voice ownership. Cancellation releases a loop's current
 * voices without sending an old loop's finally-block key off to a newer voice.
 * writeFm goes through the audition guard, so a held manual key keeps priority.
 */
export function createPerformanceChipOwnership({writeFm, writePsg, channelCount = 6}) {
  const fmOwners = new Array(channelCount).fill(null), psgOwners = new Array(4).fill(null);
  let psgLatch = 0;
  const reset = () => {fmOwners.fill(null); psgOwners.fill(null); psgLatch = 0;};
  return {
    observe(command, performance) {
      const owner = performance?.owner ?? null;
      if (command.type === 'reset') {reset(); return;}
      if (command.type === 'write' && command.register === 0x28 && (command.port ?? 0) === 0) {
        const code = command.value & 7, channel = (code & 3) + (code & 4 ? 3 : 0);
        if ((code & 3) !== 3 && channel < channelCount) fmOwners[channel] = command.value & 0xf0 ? owner : null;
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
    cancel(owner) {
      for (let channel = 0; channel < fmOwners.length; channel++) {
        if (fmOwners[channel] !== owner) continue;
        fmOwners[channel] = null;
        writeFm(0x28, channel < 3 ? channel : channel + 1, 0);
      }
      for (let channel = 0; channel < psgOwners.length; channel++) {
        if (psgOwners[channel] !== owner) continue;
        psgOwners[channel] = null;
        writePsg?.(0x90 | (channel << 5) | 15);
        psgLatch = channel * 2 + 1;
      }
    },
    reset,
  };
}
