/** Master System borrows one mono PSG and one OPLL authoring endpoint. */
import {createNativeVoiceContext} from './native_genesis_voice_endpoint.js?v=native-msx-1';
import {createNativeGenesisSegaPsg} from './native_genesis_segapsg.js?v=native-game-gear-1';
import {createNativeGenesisOpll} from './native_genesis_opll.js?v=native-extra-opl-1';

export function createNativeGenesisMasterSystem(synth) {
  const context = createNativeVoiceContext(synth, {
    backend: 'master-system', statusCommand: 'native_genesis_master_system_status', label: 'Master System',
  });
  return {segapsg: createNativeGenesisSegaPsg(context), ym2413: createNativeGenesisOpll(context)};
}
