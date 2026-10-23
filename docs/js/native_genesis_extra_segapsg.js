import {createNativeVoiceContext} from './native_genesis_voice_endpoint.js?v=native-extra-stability-1';
import {createNativeGenesisSegaPsg} from './native_genesis_segapsg.js?v=native-extra-stability-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-stability-1';

export const EXTRA_PSG_CLOCK_HELD_ERROR='Release the manually held additional PSG voices before changing the clock';
export function createNativeGenesisExtraSegaPsg(synth,options={}){
  return createNativeGenesisExtraChip(synth,{...options,kind:'segapsg',label:'Sega PSG',clock:3579545,stereoEnabled:true,
    createEndpoint:facade=>createNativeGenesisSegaPsg(createNativeVoiceContext(facade,{backend:'extra-psg',statusCommand:'native_genesis_extra_psg_status',label:'additional PSG'}),{stereoEnabled:true,acknowledgeClock:true}),
  });
}
