import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {NesApuSynth} from './nesapusynth.js?v=audio-numeric-bindings-1';
import {NES_APU_CLOCK} from './nesapu.js';
/** Same register generator as the public NES API; uploads await Worklet acknowledgement. */
/** @param {MessagePort} port Ordered Worklet command/acknowledgement port, owned by the client.
 * @param {{clock?: number, fdsEnabled?: boolean, state?:object}} [options={}] Clock in Hz, FDS availability and an optional existing device snapshot.
 * @returns {NesApuSynth & {_stopVoices:()=>Promise<void>}} Synth whose dispose closes the port and rejects pending uploads. */
export function createNesClient(port, {clock = NES_APU_CLOCK, fdsEnabled = false, state} = {}) {
  let disposed = false, sequence = 0;
  const pending = new Map();
  const send = (method, args = []) => {
    if (disposed) throw new Error('NES disposed');
    port.postMessage({method, args});
  };
  const request=(method,args=[])=>new Promise((resolve,reject)=>{
    if(disposed){reject(new Error('NES disposed'));return;}
    const id=++sequence;pending.set(id,{resolve,reject});
    try{port.postMessage({id,method,args});}catch(error){pending.delete(id);reject(error);}
  });
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
    loadMemory: (bytes, address) => request('loadMemory',[bytes,address]),
  };
  const synth = new NesApuSynth({transport,initialize:!state});
  if(state)synth._adoptState(state);
  const client=Object.assign(synth, {_stopVoices() {
    // The admin editor can change FDS pitch on the Worklet independently of
    // this thread's shadow. Stop must use applied registers at the processor.
    const state=synth._getState();state.enabled=0;state.fdsActive=false;
    state.registers[0x15]=0;state.registers[0x83]|=128;state.registers[0x80]=128;
    synth._adoptState(state);
    return request('stopVoices').then(()=>{});
  },dispose() {
    if (disposed) return;
    send('dispose'); disposed = true;
    for (const request of pending.values()) request.reject(new Error('NES disposed'));
    pending.clear(); port.close();
  }});
  return attachChipClock(client, port, clock);
}
