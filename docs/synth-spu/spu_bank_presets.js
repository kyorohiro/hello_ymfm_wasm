// SPDX-License-Identifier: BSD-3-Clause
// Portable presets from an opened bank, without loading it into an audio core.
import {prepareVabTone} from './spu_synth_vab.js?v=ps1-vab-api-1';
import {writeSpuInstrument} from './spu_synth_instrument.js?v=spu-split-vab-1';

const defaultReverb=()=>({preset:'off',volumeLeft:.25,volumeRight:.25});

export function vabTonePresetName(name,tone) {
  const suffix=` P${tone.program} T${tone.index}`;
  return (String(name).trim()||'VAB').slice(0,80-suffix.length)+suffix;
}
function documentFromTone(prepared,{name='VAB',reverb=defaultReverb()}={}) {
  return writeSpuInstrument(vabTonePresetName(name,prepared.tone),{
    preset:prepared.preset,sample:{adpcm:prepared.adpcm,...prepared.options},reverb:{...reverb},
    waveform:null,pmon:{enabled:false},noise:{enabled:false},morph:{enabled:false},
  });
}
export function prepareVabTonePreset(bank,index,options={}) {
  return documentFromTone(prepareVabTone(bank,index),options);
}
/** Bank samples can be shared by many Tones; JSON embeds each sample. Bound
 * the serialized total while preparing so a large bank cannot expand without
 * limit before Files performs its final, atomic project-capacity check. */
export function prepareVabBankPresets(bank,{maxBytes,...options}={}) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new RangeError('A bank preset byte budget is required.');
  const instruments=[],unavailable=[],encoder=new TextEncoder();let bytes=0;
  for(let index=0;index<bank.tones.length;index++) {
    let prepared;
    try {prepared=prepareVabTone(bank,index);}
    catch(error) {
      const tone=bank.tones[index];
      unavailable.push({tone:index,program:tone.program,index:tone.index,sample:tone.sample,reason:error.message});
      continue;
    }
    const instrument=documentFromTone(prepared,options);
    bytes+=encoder.encode(JSON.stringify(instrument,null,2)+'\n').byteLength;
    if(bytes>maxBytes)throw new RangeError('Bank presets exceed the free space in the 16 MiB project. Save individual Tones or use a fresh project. No presets were saved.');
    instruments.push(instrument);
  }
  return {instruments,unavailable,bytes};
}
