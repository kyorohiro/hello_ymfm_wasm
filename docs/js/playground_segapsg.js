import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createSegaPsgApi} from './segapsg_api.js?v=audio-numeric-bindings-1';
/** Immediate ordered commands, shared by main-thread and Worker runtimes.
 * @param {MessagePort} port
 * @param {{clock?:number,stereoEnabled?:boolean}} [options] */
export function createSegaPsgClient(port, {clock = CHIP_CLOCKS.segapsg, stereoEnabled = true} = {}) {
  let disposed = false,latched=0;
  const send = (method, args = []) => {
    if (disposed) throw new Error('Sega PSG disposed');
    if(method==='write'&&(args[0]&128))latched=args[0]>>4&7;
    if(method==='reset')latched=0;
    port.postMessage({method, args,...(method==='write'&&!(args[0]&128)?{psgRegister:latched}:{})});
  };
  const client = {...createSegaPsgApi({
    get clock() { return client.clock; },
    write: value => send('write', [value]),
    ...(stereoEnabled ? {setStereo:mask => send('setStereo', [mask])} : {}),
    reset: () => send('reset'),
    resetAll: () => send('reset'),
  }), dispose() {
    if (disposed) return;
    send('dispose'); disposed = true; port.close();
  }};
  const getState = client._getState, adoptState = client._adoptState;
  client._getState = () => ({...getState(), clock:client.clock, stereoEnabled});
  client._adoptState = state => {adoptState(state);if(Number.isInteger(state?.latched))latched=state.latched&7;if (state?.clock !== undefined) client._adoptClock(state.clock);};
  Object.defineProperty(client, 'stereoEnabled', {value:stereoEnabled, enumerable:true});
  const controlled=attachChipClock(client,port,clock);
  Object.defineProperty(client,'_stopVoices',{value:()=>controlled._requestControl('stopVoices')});
  return controlled;
}
