import {WONDERSWAN_CLOCK} from './wonderswansynth.js';
import {createNativeGenesisWonderSwan} from './native_genesis_wonderswan.js';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js';

export function createNativeGenesisExtraWonderSwan(synth,options={}) {
  const clock=options.clock??WONDERSWAN_CLOCK;
  return createNativeGenesisExtraChip(synth,{...options,kind:'wonderswan',label:'WonderSwan',clock,
    createArgs:{clock},createEndpoint:facade=>createNativeGenesisWonderSwan(facade,{extra:true,clock})});
}
