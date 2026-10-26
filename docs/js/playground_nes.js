import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=wonderswan-mode-2';
import {NesApuSynth} from './nesapusynth.js?v=nes-wasm-1';
import {NES_APU_CLOCK} from './nesapu.js?v=nes-wasm-1';
/** Same register generator as the public NES API; uploads await Worklet acknowledgement. */
/** @param {MessagePort} port Ordered Worklet command/acknowledgement port, owned by the client.
 * @param {{clock?: number, fdsEnabled?: boolean, state?:object,native?:boolean}} [options={}] Clock in Hz, FDS availability and an optional existing device snapshot.
 * @returns {NesApuSynth & {_stopVoices:()=>Promise<void>}} Synth whose dispose closes the port and rejects pending uploads. */
export function createNesClient(port, {clock = NES_APU_CLOCK, fdsEnabled = false, state,native=false} = {}, lifecycle={}) {
  let disposed = false, sequence = 0;
  const pending = new Map();
  const check=context=>{if(disposed||native&&lifecycle.isStopped?.(context))throw new Error('NES disposed or Run stopped');};
  const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
  const scoped=(promise,context)=>native?promise.then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;})):promise;
  const send = (method, args = []) => {
    check(lifecycle.captureContext?.());
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
    loadMemory: (bytes, address) => {const context=lifecycle.captureContext?.();check(context);return scoped(request('loadMemory',[bytes,address]),context);},
    ...(native?{configureFds:(gain,master)=>send('configureFds',[gain,master])}:{}),
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
    port.postMessage({method:'dispose',args:[]}); disposed = true;
    for (const request of pending.values()) request.reject(new Error('NES disposed'));
    pending.clear(); port.close();
  }});
  const controlled=attachChipClock(client, port, clock);
  if(native){
    const setClock=controlled.setClock.bind(controlled);
    controlled.setClock=hz=>{const context=lifecycle.captureContext?.();check(context);return scoped(setClock(hz),context);};
    Object.defineProperty(client,'_applyAuthorEdit',{value:patch=>{
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['clock','registers','enabled','fdsActive','fdsGain','fdsMaster'].includes(key)))throw new TypeError('Invalid NES author edit');
      const state=client._getState();
      if(patch.clock!==undefined){if(!Number.isInteger(patch.clock)||patch.clock<100000||patch.clock>100000000)throw new RangeError('Invalid NES clock edit');state.clock=patch.clock;}
      if(patch.registers!==undefined){if(!Array.isArray(patch.registers)||patch.registers.length>1024)throw new TypeError('Invalid NES register edit');for(const entry of patch.registers){if(!Array.isArray(entry)||entry.length<2||entry.length>3||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=0x90||!Number.isInteger(entry[1])||entry[1]<0||entry[1]>255||entry[2]!==undefined&&(!Number.isInteger(entry[2])||entry[2]<0||entry[2]>255))throw new TypeError('Invalid NES register edit');const [address,value,mask=255]=entry;state.registers[address]=(state.registers[address]&~mask)|(value&mask);}}
      if(patch.enabled!==undefined){const {value,mask}=patch.enabled??{};if(!Number.isInteger(value)||value<0||value>31||!Number.isInteger(mask)||mask<0||mask>31)throw new TypeError('Invalid NES enable edit');state.enabled=(state.enabled&~mask)|(value&mask);state.registers[0x15]=(state.registers[0x15]&~mask)|(value&mask);}
      if(patch.fdsActive!==undefined){if(typeof patch.fdsActive!=='boolean')throw new TypeError('Invalid NES FDS gate edit');state.fdsActive=patch.fdsActive;}
      for(const [key,max]of [['fdsGain',32],['fdsMaster',3]])if(patch[key]!==undefined){if(!Number.isInteger(patch[key])||patch[key]<0||patch[key]>max)throw new TypeError('Invalid NES FDS configuration edit');state[key]=patch[key];}
      client._adoptState(state);
    }});
  }
  return controlled;
}
