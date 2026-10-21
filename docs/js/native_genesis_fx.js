/** Native-device FX descriptors. No AudioContext, PCM bridge or AudioNodes. */
import {createNativeFXController} from './native_fx.js';

/** The same built-in descriptor API as Web Audio. Arbitrary JavaScript DSP
 * stays unavailable: it cannot execute in the native device callback.
 * send must preserve ordering with the synth's command/Stop barriers.
 */
export function createNativeGenesisFX({send, getBeatSeconds=()=>.5}={}) {
  if (typeof send !== 'function') throw new TypeError('Native FX requires an ordered sender');
  return createNativeFXController(message => {
    if (message.op === 'live-fx') {
      throw new Error('JavaScript liveFx is not supported by Native Genesis. Select Web Audio to run liveFx.');
    }
    send(message);
  }, {getBeatSeconds});
}
