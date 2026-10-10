import {NesApuSynth} from './nesapusynth.js';
import {NES_APU_CLOCK} from './nesapu.js';
/** Same register generator as the public NES API; uploads await Worklet acknowledgement. */
/** @param {MessagePort} port Ordered Worklet command/acknowledgement port, owned by the client.
 * @param {{clock?: number, fdsEnabled?: boolean}} [options={}] Clock in Hz and FDS availability.
 * @returns {NesApuSynth} Synth whose dispose closes the port and rejects pending uploads. */
export function createNesClient(port, {clock = NES_APU_CLOCK, fdsEnabled = false} = {}) {
  let disposed = false, sequence = 0;
  const pending = new Map();
  const send = (method, args = []) => {
    if (disposed) throw new Error('NES disposed');
    port.postMessage({method, args});
  };
  port.onmessage = ({data}) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.value);
  };
  port.start();
  const transport = {
    clock, fdsEnabled,
    writeRegister: (address, value) => send('writeRegister', [address, value]),
    setChannelEnabled: (channel, enabled) => send('setChannelEnabled', [channel, enabled]),
    reset: () => send('reset'),
    loadMemory: (bytes, address) => new Promise((resolve, reject) => {
      if (disposed) { reject(new Error('NES disposed')); return; }
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      try { port.postMessage({id, method: 'loadMemory', args: [bytes, address]}); }
      catch (error) { pending.delete(id); reject(error); }
    }),
  };
  const synth = new NesApuSynth({transport});
  return Object.assign(synth, {dispose() {
    if (disposed) return;
    send('dispose'); disposed = true;
    for (const request of pending.values()) request.reject(new Error('NES disposed'));
    pending.clear(); port.close();
  }});
}
