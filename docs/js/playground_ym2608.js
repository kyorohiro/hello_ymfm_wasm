/** Shared main-thread / Worker facade; register writes and memory transfers share one ordered port. */
import {YM2608Synth} from './ym2608synth.js';

export function createYm2608Client(port) {
  let disposed = false, sequence = 0;
  const pending = new Map();
  port.onmessage = ({data}) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    data.error ? request.reject(new Error(data.error)) : request.resolve();
  };
  port.start?.();
  const send = (method, args = []) => {
    if (disposed) throw new Error('YM2608 disposed');
    port.postMessage({method, args});
  };
  const transfer = (method, args) => {
    if (disposed) return Promise.reject(new Error('YM2608 disposed'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      try { port.postMessage({id, method, args}); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };
  const synth = new YM2608Synth({transport: {
    write: (port, register, value) => send('write', [port, register, value]),
    reset: () => send('reset'),
    loadRhythmRom: bytes => transfer('rom', [bytes]),
    loadAdpcmMemory: (bytes, offset) => transfer('memory', [bytes, offset]),
  }});
  synth.dispose = () => {
    if (disposed) return;
    send('dispose'); disposed = true;
    for (const request of pending.values()) request.reject(new Error('YM2608 disposed'));
    pending.clear(); port.close();
  };
  return synth;
}
