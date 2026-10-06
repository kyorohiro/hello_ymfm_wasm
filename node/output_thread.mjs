/** Owns native device lifetime; Node addons may retain event-loop references. */
import {Worker} from 'node:worker_threads';
export async function createThreadOutput(options) {
  const {onDrain, onError, ...workerData} = options;
  const worker = new Worker(new URL('./pcm_output_worker.mjs', import.meta.url), {workerData});
  let queuedFrames = 0, state, frames, sequence = 0, closed = false, failure, closing;
  const pending = new Map();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
  const fail = error => {
    failure = error; rejectReady(error);
    for (const request of pending.values()) request.reject(error); pending.clear();
    if (!closed) onError(error);
  };
  worker.on('message', message => {
    if (message.type === 'ready') {frames = message.frames; state = message.state; resolveReady();}
    else if (message.type === 'consumed') {
      state = message.state; queuedFrames = Math.max(0, queuedFrames - frames); if (!closed) onDrain();
    } else if (message.type === 'reply') {
      state = message.state; const request = pending.get(message.id); pending.delete(message.id); request?.resolve();
    } else if (message.type === 'fatal') fail(new Error(message.error));
  });
  worker.on('error', fail);
  worker.on('exit', code => {if (!closed) fail(new Error(`Audio output Worker exited (${code})`));});
  const command = op => {
    if (closed && op !== 'close') return Promise.reject(new Error('Audio output is closed'));
    if (failure) return Promise.reject(failure);
    const id = ++sequence;
    return new Promise((resolve, reject) => {pending.set(id, {resolve, reject}); worker.postMessage({id, op});});
  };
  try {
    await ready;
    if (!Number.isSafeInteger(frames) || frames < 1 || frames > 8192) throw new Error('Invalid audio output frame size');
  } catch (error) {closed = true; await worker.terminate(); throw error;}
  return {
    frames, get queuedFrames() {return queuedFrames;},
    write(pcm) {if (closed || failure) throw failure ?? new Error('Audio output is closed'); queuedFrames += frames;
      worker.postMessage({op: 'write', pcm}, [pcm.left.buffer, pcm.right.buffer]);},
    start: () => command('start'),
    async stop() {await command('stop'); queuedFrames = 0;},
    getState: () => ({...state, queuedFrames}),
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        let timer;
        try {await Promise.race([command('close'), new Promise(resolve => {timer = setTimeout(resolve, 2000);})]);}
        finally {clearTimeout(timer); await worker.terminate(); for (const request of pending.values()) request.reject(new Error('Output closed')); pending.clear();}
      })();
      return closing;
    },
  };
}
