/** Game Gear owns a stereo PSG without a hidden Genesis FM or Master System OPLL. */
import {createNativeVoiceContext} from './native_genesis_voice_endpoint.js?v=y8950-adpcm-ui-1';
import {createNativeGenesisSegaPsg} from './native_genesis_segapsg.js?v=y8950-adpcm-ui-1';

export function createNativeGenesisGameGear(synth) {
  const context = createNativeVoiceContext(synth, {
    backend: 'master-system', statusCommand: 'native_genesis_game_gear_status', label: 'Game Gear',
  });
  return {segapsg: createNativeGenesisSegaPsg(context, {stereoEnabled: true, acknowledgeClock: true})};
}
