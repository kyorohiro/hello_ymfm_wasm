/** Loop-owned asynchronous failures. No clock or sound-chip knowledge. */
export function createLoopAsyncTasks({getLoop, cancelWaits, isActive = loop => !loop.stopped}) {
  const states = new Map();
  function state(loop) {
    if (!loop) throw new Error('trackAsync requires a liveLoop');
    let s = states.get(loop);
    if (!s) { s = {pending: new Set(), wake: new Set()}; states.set(loop, s); }
    return s;
  }
  function notify(s) { for (const wake of s.wake) wake(); }
  return {
    track(promise) {
      const loop = getLoop(), s = state(loop);
      const pending = Promise.resolve(promise).then(() => {}, error => {
        if (states.get(loop) === s && isActive(loop)) {
          loop.interruptError ??= error instanceof Error ? error : new Error(String(error));
          cancelWaits(loop);
        }
      }).finally(() => { s.pending.delete(pending); notify(s); });
      s.pending.add(pending);
    },
    async finish(loop) {
      const s = states.get(loop);
      if (!s) return;
      while (s.pending.size && states.get(loop) === s && isActive(loop) && !loop.interruptError) {
        await new Promise(resolve => { const wake = () => { s.wake.delete(wake); resolve(); }; s.wake.add(wake); });
      }
      if (loop.interruptError && isActive(loop)) throw loop.interruptError;
    },
    releaseName(name) {
      for (const [loop, s] of states) if (name === undefined || loop.name === name) {
        loop.stopped = true; states.delete(loop); notify(s);
      }
    },
    release(loop) { const s = states.get(loop); states.delete(loop); if (s) notify(s); },
    clear() { for (const s of states.values()) notify(s); states.clear(); },
  };
}
