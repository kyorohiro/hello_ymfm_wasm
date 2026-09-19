import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createVgiFromPreset} from '../js/vgi.js';
import {createTfiFromPreset} from '../js/tfi.js';
import {extractTfiPatchesFromVgm} from './tfi_extract.js';
import {createOpmTfiFiles,OPM_TFI_NOTICE} from './opm_tfi.js';
import {createStoredZipBytes} from './stored_zip.js';

export const exportTfiZip = (bytes, options) => exportVoiceZip(bytes, 'tfi', options);
export const exportVgiZip = (bytes, options) => exportVoiceZip(bytes, 'vgi', options);

function exportVoiceZip(bytes,format,{fileName='VGM'}={}) {
  const label = format.toUpperCase()+' ZIP';
  const h=new Ym2612VGM(bytes).header;
  const families=['ym2203','ym2608','ym2610','ym2612','ym2151'].filter(k=>h[k+'Clock']);
  if(families.length!==1)throw new Error(`${label} requires exactly one OPN or YM2151 chip family`);
  const kind=families[0],clock=h[kind+'Clock'];
  if (format==='vgi' && kind==='ym2151') throw new Error('YM2151 VGI conversion is not supported; use tfi-zip or the Browser OPM export');
  if(clock & (kind==='ym2610'?0x40000000:0xc0000000))throw new Error(`${label} dual/variant chips are not supported`);
  // Reject additional FM families: the OPN extractor has a single register state.
  if(['ym2413','y8950','ym3526','ym3812','ymf262','ymf278b'].some(k=>h[k+'Clock']))throw new Error(`${label} mixed FM families are not supported`);
  const result=kind==='ym2151'?createOpmTfiFiles({buffer:bytes,fileName}):(()=>{
    const patches=extractTfiPatchesFromVgm(bytes);
    return {count:patches.length,files:patches.map(p=>({name:p.label+'.'+format,data:(format==='vgi'?createVgiFromPreset:createTfiFromPreset)(p.preset)}))};
  })();
  if(!result.count)throw new Error(`No keyed tones found for ${label}`);
  return {bytes:createStoredZipBytes(result.files),count:result.count,warnings:kind==='ym2151'?[OPM_TFI_NOTICE]:format==='vgi'?['VGI preserves B4 (pan/AMS/FMS), but not global LFO settings, AM enable or source clock timing.']:['TFI stores FM voice parameters only; pan, modulation and source clock timing are not reproduced.']};
}
