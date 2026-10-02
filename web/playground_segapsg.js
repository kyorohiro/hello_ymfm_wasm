import {createSegaPsgApi} from './segapsg_api.js';
/** Immediate ordered commands, shared by main-thread and Worker runtimes. */
export function createSegaPsgClient(port) {
  let disposed = false;
  const send = (method, args = []) => {
    if (disposed) throw new Error('Sega PSG disposed');
    port.postMessage({method, args});
  };
  return {...createSegaPsgApi({
    write: value => send('write', [value]),
    reset: () => send('reset'),
    resetAll: () => send('reset'),
  }), dispose() {
    if (disposed) return;
    send('dispose'); disposed = true; port.close();
  }};
}
