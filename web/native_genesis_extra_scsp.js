import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js';
import {createNativeGenesisScsp} from './native_genesis_scsp.js';
export async function createNativeGenesisExtraScsp(synth,options={}) {
  const device=await createNativeGenesisExtraChip(synth,{...options,kind:'scsp',label:'Saturn SCSP',layout:{channels:32},createEndpoint:owner=>createNativeGenesisScsp(owner,{additional:true})});
  device.sampleRate=synth.clock.sampleRate;device.nativeSampleRate=44100;return device;
}
