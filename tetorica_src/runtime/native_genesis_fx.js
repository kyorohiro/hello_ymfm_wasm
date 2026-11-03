/** Native-device FX descriptors. No AudioContext, PCM bridge or AudioNodes. */
import {createNativeFXController} from './native_fx.js';
import {nativeGenesisLiveFxMessage} from './native_genesis_livefx.js';

/** The same descriptor API as Web Audio. JavaScript DSP runs in a separate
 * native worker; it never executes in the native device callback.
 * send must preserve ordering with the synth's command/Stop barriers.
 * @param {{send:(message:any)=>void, getBeatSeconds?:()=>number}} [options]
 */
export function createNativeGenesisFX({send, getBeatSeconds=()=>.5}={}) {
  if (typeof send !== 'function') throw new TypeError('Native FX requires an ordered sender');
  return createNativeFXController(message => {
    if (message.op === 'live-fx') {
      send(nativeGenesisLiveFxMessage(message));return;
    }
    send(message);
  }, {getBeatSeconds});
}
