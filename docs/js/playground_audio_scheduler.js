/**
 * @file playground_audio_scheduler.js
 * 実行環境: Browser / Node.js
 * 依存: 注入された時計・送信関数、setTimeout / clearTimeout。AudioContext 自体は作らない。
 */
/**
 * Queue events by absolute audio-clock time and send batches within a lookahead window.
 * The recipient must still schedule each event at its time; send() runs ahead of playback.
 * @param {Object} options Clock, destination and optional timer hooks.
 * @param {function(): number} options.now Current audio-clock time in seconds.
 * @param {Function} options.send Receives a time-sorted array of due entries.
 * @param {Function} [options.setTimer=setTimeout] Schedule a callback after a delay in milliseconds.
 * @param {Function} [options.clearTimer=clearTimeout] Cancel the returned timer handle.
 * @returns {Object} getTiming/setTiming, enqueue and clear operations.
 */
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
    /**
     * Merge entries and immediately dispatch those within the lookahead horizon.
     * @param {Object[]} entries Each entry has an absolute time in seconds; other fields pass through.
     * @returns {void}
     */
    enqueue(entries) {
      pending = pending.concat(entries);
      pending.sort((a, b) => a.time - b.time);
      flush();
    },
    /**
     * Cancel pending queue entries and the timer. Already sent events are unaffected.
     * @returns {void}
     */
    clear() {
      pending = [];
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
