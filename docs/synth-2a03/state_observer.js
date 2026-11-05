// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

/** Observe an already-created audio engine without issuing performance commands.
 * Only one read may be outstanding, including across target replacements. The
 * next interval begins after a reply, so a slow Worklet never builds a backlog.
 * Status: idle / waiting / live / unavailable / disposed.
 */
export function createStateObserver({read = engine => engine.read(), onState = () => {}, onStatus = () => {},
  intervalMs = 100, schedule = setTimeout, cancel = clearTimeout} = {}) {
  for (const callback of [read, onState, onStatus, schedule, cancel]) {
    if (typeof callback !== 'function') throw new TypeError('State observer callbacks must be functions');
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('State observer interval must be positive');
  let engine = null, active = false, disposed = false, failed = false;
  let generation = 0, timer = null, pending = false, status;

  function notify(callback, ...args) {
    try {
      const result = callback(...args);
      // UI callbacks are normally synchronous. A rejected asynchronous callback
      // must not become an unhandled rejection or stop passive observation.
      if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
    } catch {}
  }
  function setStatus(next) {
    if (status === next) return;
    status = next; notify(onStatus, next);
  }
  function clearScheduled() {
    if (timer === null) return;
    const previous = timer; timer = null;
    try {cancel(previous);} catch {}
  }
  const current = (token, target) => !disposed && active && !failed && generation === token && engine === target;
  function scheduleNext(token, target) {
    if (!current(token, target) || pending || timer !== null) return;
    let handle;
    try {
      handle = schedule(() => {
        if (timer !== handle) return;
        timer = null;
        if (current(token, target)) void sample();
      }, intervalMs);
      timer = handle;
    } catch {
      if (current(token, target)) {failed = true; setStatus('unavailable');}
    }
  }
  async function sample() {
    if (disposed || !active || failed || pending || timer !== null) return;
    pending = true;
    const token = generation, target = engine;
    try {
      const state = await read(target);
      if (current(token, target)) {
        setStatus('live');
        if (current(token, target)) notify(onState, state, target);
      }
    } catch {
      if (current(token, target)) {failed = true; setStatus('unavailable');}
    } finally {
      pending = false;
      if (current(token, target)) scheduleNext(token, target);
      // A newer lease waits for the old read to settle, then starts promptly.
      else if (!disposed && active && !failed) void sample();
    }
  }
  function restart() {
    generation++; failed = false; clearScheduled();
    setStatus(active ? 'waiting' : 'idle');
    if (active) void sample();
  }
  return {
    update({engine: nextEngine = null, active: nextActive = false} = {}) {
      if (disposed) return;
      nextActive = Boolean(nextActive && nextEngine);
      if (engine === nextEngine && active === nextActive) {
        if (status === undefined) setStatus(nextActive ? 'waiting' : 'idle');
        return;
      }
      engine = nextEngine; active = nextActive; restart();
    },
    /** Discard any pending snapshot after a UI/source transition. This is an
     * explicit lease restart; an unchanged update never retries failed reads. */
    invalidate() {if (!disposed) restart();},
    dispose() {
      if (disposed) return;
      disposed = true; generation++; active = false; engine = null;
      clearScheduled(); setStatus('disposed');
    },
  };
}
