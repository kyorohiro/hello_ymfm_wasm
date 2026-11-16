// SPDX-License-Identifier: BSD-3-Clause
// Main-thread transport. Native parsing/replay stays inside deadline-limited Workers.
export const ATARI_PLAYER_LIMITS = Object.freeze({
  maximumFileBytes: 8 * 1024 * 1024,
  maximumRenderFrames: 4096,
  maximumWorkers: 4,
  requestDeadlineMs: 10000,
  sampleRate: 44100,
});
let workerCount = 0;

function abortError() {
  return new DOMException('Atari replay operation was aborted', 'AbortError');
}

class AtariWorkerClient {
  constructor(signal) {
    if (signal?.aborted) throw abortError();
    if (typeof Worker !== 'function') throw new Error('Atari replay requires browser Worker support');
    if (workerCount >= ATARI_PLAYER_LIMITS.maximumWorkers) throw new Error('Too many active Atari replay Workers');
    this.worker = new Worker(new URL('./atari_worker.js', import.meta.url), { type: 'module', name: 'ym2149-atari-reference' });
    ++workerCount;
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.signal = signal;
    this.onAbort = () => this.close(abortError());
    signal?.addEventListener('abort', this.onAbort, { once: true });
    this.worker.onmessage = event => {
      const { id, result, error } = event.data || {};
      const request = this.pending.get(id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(id);
      if (error) {
        const failure = new Error(error);
        request.reject(failure);
        this.close(failure);
      } else {
        request.resolve(result);
      }
    };
    this.worker.onerror = event => {
      event.preventDefault?.();
      this.close(new Error(event.message || 'Atari replay Worker failed'));
    };
    this.worker.onmessageerror = () => this.close(new Error('Atari replay Worker returned an unreadable response'));
  }

  request(operation, payload = {}, transfer = []) {
    if (this.closed) return Promise.reject(new Error('Atari replay Worker has been disposed'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.close(new Error(`Atari ${operation} exceeded its ${ATARI_PLAYER_LIMITS.requestDeadlineMs / 1000}s deadline`));
      }, ATARI_PLAYER_LIMITS.requestDeadlineMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, operation, payload }, transfer);
      } catch (error) {
        this.close(error);
      }
    });
  }

  close(error = new Error('Atari replay Worker has been disposed')) {
    if (this.closed) return;
    this.closed = true;
    this.signal?.removeEventListener('abort', this.onAbort);
    this.worker.terminate();
    --workerCount;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

function inputBytes(value) {
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  if (!bytes || bytes.length < 18 || bytes.length > ATARI_PLAYER_LIMITS.maximumFileBytes) throw new Error('Atari file must be between 18 bytes and 8 MiB');
  return bytes.slice();
}

export async function readAtariSource(value, { signal, name = '' } = {}) {
  const bytes = inputBytes(value);
  const client = new AtariWorkerClient(signal);
  try {
    const transfer = bytes.slice();
    const info = await client.request('inspect', { bytes: transfer }, [transfer.buffer]);
    return { ...info, bytes, metadata: { ...info.metadata, name } };
  } finally {
    client.close();
  }
}

export async function createAtariSongEngine(source, { subsong = source?.defaultSubsong, signal } = {}) {
  const bytes = inputBytes(source?.bytes);
  if (!Number.isInteger(subsong) || subsong < 1 || subsong > source.subsongCount) throw new Error('Invalid Atari subsong');
  const client = new AtariWorkerClient(signal);
  let info;
  try {
    info = await client.request('open', { bytes, subsong }, [bytes.buffer]);
  } catch (error) {
    client.close(error);
    throw error;
  }
  let frame = info.snapshot.frame;
  let ended = false;
  return {
    clock: info.clock,
    durationFrames: info.durationFrames,
    sampleRate: () => ATARI_PLAYER_LIMITS.sampleRate,
    get frame() { return frame; },
    get ended() { return ended; },
    async processFrames(frames) {
      if (!Number.isInteger(frames) || frames < 1 || frames > ATARI_PLAYER_LIMITS.maximumRenderFrames) throw new Error('Render request must contain 1..4096 frames');
      const block = await client.request('render', { frames });
      frame = block.frame;
      ended = block.ended;
      return block;
    },
    snapshot: () => client.request('snapshot'),
    dispose: () => client.close(),
  };
}
