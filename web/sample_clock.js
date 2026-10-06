/** Render-driven timers. No wall-clock timers, DOM or audio device dependency. */
export class SampleClock {
  #now; #rate; #timers = new Map(); #id = 0;
  constructor(sampleRate, currentFrame) {this.#rate = sampleRate; this.#now = currentFrame;}
  get pendingCount() {return this.#timers.size;}
  get nextFrame() {
    let frame = Infinity;
    for (const timer of this.#timers.values()) frame = Math.min(frame, timer.frame);
    return frame;
  }
  setTimer = (callback, delayMs) => {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError('Invalid sample timer delay');
    return this.atFrame(this.#now() + Math.round(delayMs * this.#rate / 1000), callback);
  };
  atFrame(frame, callback) {
    if (!Number.isSafeInteger(frame) || frame < this.#now()) throw new RangeError('Cannot schedule before currentFrame');
    if (typeof callback !== 'function') throw new TypeError('Timer callback must be a function');
    const id = ++this.#id; this.#timers.set(id, {frame, callback}); return id;
  }
  clearTimer = id => {this.#timers.delete(id);};
  clear() {this.#timers.clear();}
  async runDue() {
    let count = 0;
    while (true) {
      let selected;
      for (const [id, timer] of this.#timers) {
        if (timer.frame > this.#now()) continue;
        if (!selected || timer.frame < selected.timer.frame) selected = {id, timer};
      }
      if (!selected) return;
      if (++count > 10000) throw new Error('Sample timers did not advance the clock');
      this.#timers.delete(selected.id);
      await selected.timer.callback();
    }
  }
}
