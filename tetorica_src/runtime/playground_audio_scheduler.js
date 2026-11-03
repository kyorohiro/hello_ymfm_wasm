/**
 * @file playground_audio_scheduler.js
 * 実行環境: Browser / Node.js
 * 依存: 注入された時計・送信関数、setTimeout / clearTimeout。AudioContext 自体は作らない。
 */
/**
 * Queue events by absolute audio-clock time and send batches within a lookahead window.
 * The recipient must still schedule each event at its time; send() runs ahead of playback.
 * @template {{time: number}} Entry
 * @param {{now: () => number, send: (entries: Entry[]) => void,
 *   setTimer?: typeof globalThis.setTimeout, clearTimer?: typeof globalThis.clearTimeout}} options Clock in seconds, batch sender and timer hooks (milliseconds).
 * @returns {{getTiming: () => {lookaheadSeconds: number, schedulerIntervalMs: number},
 *   setTiming: (options?: {lookaheadSeconds?: number, schedulerIntervalMs?: number}) => {lookaheadSeconds: number, schedulerIntervalMs: number},
 *   enqueue: (entries: Entry[]) => void, clear: () => void}} Queue and timing controls.
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
     * @param {Entry[]} entries Absolute times in seconds; other fields pass through unchanged.
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
