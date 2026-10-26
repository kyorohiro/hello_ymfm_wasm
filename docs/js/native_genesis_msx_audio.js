/** MSX Audio reuses the MSX pair and adds its Y8950 FM/rhythm endpoint. */
import {createNativeGenesisMsx} from './native_genesis_msx.js?v=wonderswan-native-1';
import {createNativeGenesisOpl} from './native_genesis_opl.js?v=wonderswan-native-1';

export function createNativeGenesisMsxAudio(synth) {
  const pair = createNativeGenesisMsx(synth);
  return {y8950: createNativeGenesisOpl(synth, {chip: 'y8950', msxAudio: true}), ...pair};
}
