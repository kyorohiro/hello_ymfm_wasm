// SPDX-License-Identifier: BSD-3-Clause
import {readYmVgmSource} from './vgm_source.js';
import {createYmVgmEngine} from './vgm_engine.js?v=live-edit-2';
import {readAtariSource,createAtariSongEngine} from './atari_engine.js?v=live-edit-2';
export async function prepareYmReference(bytes,options={}) {
  if(!(bytes instanceof Uint8Array)||bytes.length<4)throw new TypeError('Music file is too short');
  // Detect VGM/gzip by bytes; names are display metadata, never decoder authority.
  const vgm=bytes[0]===0x56&&bytes[1]===0x67&&bytes[2]===0x6d&&bytes[3]===0x20;
  const gzip=bytes[0]===0x1f&&bytes[1]===0x8b;
  return vgm||gzip?readYmVgmSource(bytes,options):readAtariSource(bytes,options);
}
export function createYmReferenceEngine(source,options={}) {
  return source.format==='vgm'?createYmVgmEngine(source,options):createAtariSongEngine(source,options);
}
