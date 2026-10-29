import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=ps1-native-1';
import {createNativeGenesisPs1} from './native_genesis_ps1.js?v=ps1-deferred-release-1';
export async function createNativeGenesisExtraPs1(synth,options={}){
  const device=await createNativeGenesisExtraChip(synth,{...options,kind:'ps1',label:'PlayStation SPU',layout:{channels:24},createEndpoint:owner=>createNativeGenesisPs1(owner,{additional:true})});
  device.sampleRate=synth.clock.sampleRate;device.nativeSampleRate=44100;return device;
}
