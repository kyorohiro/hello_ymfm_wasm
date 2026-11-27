// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {applyRomBlock} from './song.js';
import {demoRom} from './demo.js';

export const isPresetPath=path=>/^\/presets\/[^/]+\.(?:adpcm|pcm)\.json$/i.test(path);

export function readPreset(text){
  const p=JSON.parse(text);
  if(!['qsound-pcm-1','qsound-adpcm-1'].includes(p?.format) || !/^[a-f0-9]{64}$/.test(p.bankHash))
    throw Error('Invalid QSound preset.');
  for(const [key,min,max] of [['bank',0,32767],['start',0,65535],['end',0,65535],
    ['clock',1,8000000],['pan',0,65535],['volume',-32768,32767],...(p.format==='qsound-pcm-1'?[['loop',0,65535],['rate',0,65535],['send',-32768,32767]]:[])]){
    if(!Number.isInteger(p[key]) || p[key]<min || p[key]>max)throw Error('Invalid PCM preset '+key+'.');
  }
  if(p.projectRange!==undefined && (p.source!==null || !Array.isArray(p.projectRange) || p.projectRange.length!==2 ||
    !p.projectRange.every(Number.isInteger) || p.projectRange[0]<0 || p.projectRange[1]>65536 ||
    p.projectRange[0]>=p.projectRange[1]))throw Error('Invalid project ROM range.');
  const s=p.source;
  if(s!==null && (!s || !/^\/songs\/[^/]+\.vg[mz]$/i.test(s.path) ||
    !Number.isSafeInteger(s.position) || s.position<0 || typeof s.looped!=='boolean'))throw Error('Invalid preset ROM source.');
  return p;
}

export async function bankHash(bytes){
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}

// Rebuild only the ROM blocks seen by the player, without rendering song audio.
export function resolveRom(source,bytes){
  if(!source)return {rom:demoRom(),clock:4000000};
  const parser=new Ym2612VGM(bytes);
  let rom=new Uint8Array();
  function advance(){
    const e=parser.step();
    if(e.type==='qsound-rom-data')rom=applyRomBlock(rom,e);
  }
  if(source.looped){
    if(!parser.header.loopOffset)throw Error('Preset expects a looping song.');
    while(!parser.ended)advance();
    parser.position=parser.header.loopOffset;parser.ended=false;
  }
  while(!parser.ended && parser.position<source.position)advance();
  if(parser.position!==source.position)throw Error('Preset ROM position differs from the song.');
  return {rom,clock:parser.header.qsoundClock};
}

export async function presetRom(preset,bytes,projectRom){
  const {rom,clock}=preset.projectRange?{rom:projectRom,clock:4000000}:resolveRom(preset.source,bytes);
  const begin=preset.bank*65536;
  const [first,last]=preset.projectRange??[0,65536];
  if(!rom || clock!==preset.clock || begin>=rom.length ||
    await bankHash(rom.subarray(begin+first,begin+last))!==preset.bankHash)
    throw Error('Sample ROM or clock differs from the saved preset.');
  return rom;
}
