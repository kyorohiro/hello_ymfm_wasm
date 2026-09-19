import {snapshotOpmState,exportOpm} from './opm_export.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createVgiFromPreset} from '../js/vgi.js';
import {createTfiFromPreset} from '../js/tfi.js';
import {snapshotTfiPresets,extractTfiPatchesFromVgm} from './tfi_extract.js';
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


export function exportVoiceSnapshot(bytes,{format,atSeconds,channel}) {
  if (!Number.isFinite(atSeconds) || atSeconds < 0 || !Number.isSafeInteger(Math.floor(atSeconds*44100))) throw new RangeError('Snapshot time must be finite and nonnegative');
  const sample=Math.floor(atSeconds*44100);
  const h=new Ym2612VGM(bytes).header;
  const families=['ym2203','ym2608','ym2610','ym2612','ym2151'].filter(k=>h[k+'Clock']);
  if(families.length!==1) throw new Error('Snapshot requires exactly one OPN or YM2151 family');
  const kind=families[0],clock=h[kind+'Clock'];
  if(clock & (kind==='ym2610'?0x40000000:0xc0000000)) throw new Error('Snapshot dual/variant chips are not supported');
  if(['ym2413','y8950','ym3526','ym3812','ymf262','ymf278b'].some(k=>h[k+'Clock'])) throw new Error('Snapshot mixed FM families are not supported');
  const channels=kind==='ym2151'?[1,2,3,4,5,6,7,8]:kind==='ym2203'?[1,2,3]:kind==='ym2610' && !(clock & 0x80000000)?[2,3,5,6]:[1,2,3,4,5,6];
  if(!channels.includes(channel)) throw new RangeError('Snapshot channel must be one of: '+channels.join(', '));
  const warnings=['Static register snapshot; pitch, performance and envelope phase are not saved. Unwritten registers use the shared extractor defaults.'];
  if(format==='opm'){
    if(kind!=='ym2151') throw new Error('OPM snapshot requires YM2151');
    return {text:exportOpm(snapshotOpmState(bytes,sample),channel-1,'CH'+channel,{clock:clock & 0x3fffffff}),sample,channel,warnings};
  }
  if(!['tfi','vgi'].includes(format) || kind==='ym2151') throw new Error('TFI/VGI snapshots require OPN; use opm for YM2151');
  const preset=snapshotTfiPresets(bytes,sample)[channel-1];
  warnings.push('Global LFO, operator AM enable and source clock timing are not preserved; TFI also omits pan/AMS/FMS.');
  return {bytes:(format==='tfi'?createTfiFromPreset:createVgiFromPreset)(preset),sample,channel,warnings};
}
