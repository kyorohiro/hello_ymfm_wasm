/** Device-free test adapter. Runs in the actual Node Worker. */
export async function createOutput({sampleRate, bufferFrames: frames, onDrain, onError,
  failOpen, failWrite, initDelay = 0, lateErrorOnClose = false}) {
  if (initDelay) await new Promise(resolve => setTimeout(resolve, initDelay));
  if (failOpen) throw new Error('Test output unavailable');
  let queuedFrames = 0, consumedFrames = 0, timer, peak = 0, writes = 0;
  return {
    frames,
    get queuedFrames() {return queuedFrames;},
    write({left, right}) {
      if (failWrite && ++writes > (typeof failWrite === 'number' ? failWrite : 2)) throw new Error('Test write failed');
      if (left.length !== frames || right.length !== frames) throw new Error('Invalid test block');
      for (const channel of [left, right]) for (const value of channel) {
        if (!Number.isFinite(value)) throw new Error('Non-finite test output');
        peak = Math.max(peak, Math.abs(value));
      }
      queuedFrames += frames;
    },
    start() {
      timer = setInterval(() => {
        if (queuedFrames) {queuedFrames -= frames; consumedFrames += frames; onDrain();}
      }, frames * 1000 / sampleRate);
    },
    stop() {clearInterval(timer); timer = null; queuedFrames = 0;},
    close() {
      clearInterval(timer); timer = null; queuedFrames = 0;
      if (lateErrorOnClose) setTimeout(() => onError(new Error('Old output callback')), 5);
    },
    getState() {return {consumedFrames, queuedFrames, peak, bufferFrames: frames};},
  };
}
