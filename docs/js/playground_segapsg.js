import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-stability-2';
import {createSegaPsgApi} from './segapsg_api.js?v=audio-stability-2';
/** Immediate ordered commands, shared by main-thread and Worker runtimes. */
/** @param {MessagePort} port */
export function createSegaPsgClient(port) {
  let disposed = false;
  const send = (method, args = []) => {
    if (disposed) throw new Error('Sega PSG disposed');
    port.postMessage({method, args});
  };
  const client = {...createSegaPsgApi({
    get clock() { return client.clock; },
    write: value => send('write', [value]),
    reset: () => send('reset'),
    resetAll: () => send('reset'),
  }), dispose() {
    if (disposed) return;
    send('dispose'); disposed = true; port.close();
  }};
  return attachChipClock(client, port, CHIP_CLOCKS.segapsg);
}
