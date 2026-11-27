// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {applyRomBlock} from './song.js';
import {demoRom} from './demo.js';

export const isPresetPath=path=>/^\/presets\/[^/]+\.pcm\.json$/i.test(path);

export function readPreset(text){
  const p=JSON.parse(text);
  if(p?.format!=='qsound-pcm-1' || !/^[a-f0-9]{64}$/.test(p.bankHash))
    throw Error('Invalid QSound PCM preset.');
  for(const [key,min,max] of [['bank',0,32767],['start',0,65535],['end',0,65535],['loop',0,65535],
    ['clock',1,8000000],['rate',0,65535],['pan',0,65535],['volume',-32768,32767],['send',-32768,32767]]){
    if(!Number.isInteger(p[key]) || p[key]<min || p[key]>max)throw Error('Invalid PCM preset '+key+'.');
  }
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

export async function presetRom(preset,bytes){
  const {rom,clock}=resolveRom(preset.source,bytes);
  const begin=preset.bank*65536;
  if(clock!==preset.clock || begin>=rom.length ||
    await bankHash(rom.subarray(begin,begin+65536))!==preset.bankHash)
    throw Error('Sample ROM or clock differs from the saved preset.');
  return rom;
}
