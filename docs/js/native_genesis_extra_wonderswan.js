import {WONDERSWAN_CLOCK} from './wonderswansynth.js?v=wonderswan-native-1';
import {createNativeGenesisWonderSwan} from './native_genesis_wonderswan.js?v=wonderswan-native-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=wonderswan-native-1';

export function createNativeGenesisExtraWonderSwan(synth,options={}) {
  const clock=options.clock??WONDERSWAN_CLOCK;
  return createNativeGenesisExtraChip(synth,{...options,kind:'wonderswan',label:'WonderSwan',clock,
    createArgs:{clock},createEndpoint:facade=>createNativeGenesisWonderSwan(facade,{extra:true,clock})});
}
