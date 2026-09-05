/** Shared, bounded lookahead queue for absolute AudioContext timestamps. */
export function createAudioScheduler({ now, send, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timing = { lookaheadSeconds: 0.25, schedulerIntervalMs: 10 };
  let pending = [];
  let timer = null;
  function flush() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    const horizon = now() + timing.lookaheadSeconds;
    let count = 0;
    while (count < pending.length && pending[count].time <= horizon) count++;
    if (count) send(pending.splice(0, count));
    if (pending.length) timer = setTimer(flush, timing.schedulerIntervalMs);
  }
  return {
    getTiming: () => ({ ...timing }),
    setTiming(options = {}) {
      const next = { ...timing, ...options };
      if (!Number.isFinite(next.lookaheadSeconds) || next.lookaheadSeconds < 0 ||
          !Number.isFinite(next.schedulerIntervalMs) || next.schedulerIntervalMs <= 0 ||
          next.schedulerIntervalMs > Math.max(1, next.lookaheadSeconds * 1000)) {
        throw new Error("Timing requires a non-negative lookahead and a positive interval within the lookahead window");
      }
      timing = { lookaheadSeconds: next.lookaheadSeconds, schedulerIntervalMs: next.schedulerIntervalMs };
      flush();
      return { ...timing };
    },
    enqueue(entries) {
      pending = pending.concat(entries);
      pending.sort((a, b) => a.time - b.time);
      flush();
    },
    clear() {
      pending = [];
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
