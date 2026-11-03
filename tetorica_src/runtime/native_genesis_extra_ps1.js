import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js';
import {createNativeGenesisPs1} from './native_genesis_ps1.js';
export async function createNativeGenesisExtraPs1(synth,options={}){
  const device=await createNativeGenesisExtraChip(synth,{...options,kind:'ps1',label:'PlayStation SPU',layout:{channels:24},createEndpoint:owner=>createNativeGenesisPs1(owner,{additional:true})});
  device.sampleRate=synth.clock.sampleRate;device.nativeSampleRate=44100;return device;
}
