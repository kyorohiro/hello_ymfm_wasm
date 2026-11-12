// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Standard Sony VAB v6/v7. Layout references:
// https://github.com/vgmtrans/vgmtrans/blob/master/src/main/formats/PS1/Vab.cpp
// https://psx-spx.consoledev.net/cdromfileformats/#vab-header-vh
// libsnd tuning and body prefix checked against:
// https://github.com/Xeeynamo/sotn-decomp/blob/master/src/main/psxsdk/libsnd/vmanager.c
// https://github.com/Xeeynamo/sotn-decomp/blob/master/src/main/psxsdk/libsnd/vs_vh.c
import {preparePs1ADPCM} from './ps1synth.js';

export const MAX_VAB_FILE_BYTES = 1024 * 1024;

/** One complete sample bounded by the VAB size table. Bytes may include
 * padding after the first hardware END; prepareVabTone trims that padding.
 * @typedef {Object} Ps1VabSample
 * @property {number} index Original one-based VAB sample number.
 * @property {Uint8Array} bytes Owned raw sample bytes; no decoding or encoding.
 */
/** One Tone's recorded libsnd settings. Key ranges, vibrato, portamento and
 * bend fields are metadata; preparing a Tone does not implement a sequencer.
 * @typedef {Object} Ps1VabTone
 * @property {number} program Original Program number, 0..127.
 * @property {number} index Tone index within that Program, 0..15.
 * @property {number} sample One-based sample number; 0 is unassigned and 255 is libsnd Noise.
 * @property {number} mode Raw Tone mode flags, including bit 2 reverb send.
 * @property {number} volume Tone volume code, 0..127.
 * @property {number} pan Tone pan code, 0..127.
 * @property {number} center Center MIDI note, 0..127.
 * @property {number} shift Positive playback fine tuning in 1/128 semitone units.
 * @property {number} keyLow Minimum key code, 0..127.
 * @property {number} keyHigh Maximum key code, 0..127.
 * @property {number} adsr1 Raw ADSR1 register.
 * @property {number} adsr2 Raw ADSR2 register.
 * @property {number} vibratoWidth Recorded vibrato width code.
 * @property {number} vibratoTime Recorded vibrato time code.
 * @property {number} portamentoWidth Recorded portamento width code.
 * @property {number} portamentoTime Recorded portamento time code.
 * @property {number} bendMin Recorded downward pitch bend range.
 * @property {number} bendMax Recorded upward pitch bend range.
 */
/** @typedef {Object} Ps1VabProgram
 * @property {number} index Original Program number, 0..127; sparse numbers are retained.
 * @property {number} volume Program volume code, 0..127.
 * @property {number} pan Program pan code, 0..127.
 * @property {Ps1VabTone[]} tones Tones in their original Program order.
 */
/** Parsed source bank. Raw VH/VB provenance is private, not an enumerable
 * field. exportVab requires this original, unchanged object from readVab.
 * @typedef {Object} Ps1VabBank
 * @property {6|7} version Supported standard VAB version.
 * @property {number} id Original VAB identifier.
 * @property {number} masterVolume Bank volume code, 0..127.
 * @property {number} masterPan Bank pan code, 0..127.
 * @property {Ps1VabProgram[]} programs Nonempty Programs in table order.
 * @property {Ps1VabTone[]} tones All Tones in packed Program/Tone order.
 * @property {Ps1VabSample[]} samples Samples in one-based VAB number order.
 */
/** Prepared ordinary ADPCM Tone for Ps1Synth.loadADPCM and setPreset.
 * Shared reverb, key zones/layers and driver modulation are not applied.
 * Volume/pan use a static libsnd-style approximation.
 * @typedef {Object} Ps1VabPreparedTone
 * @property {Uint8Array} adpcm Owned original bytes through the first END packet.
 * @property {{baseFrequencyHz:number,loopStartSamples?:number}} options Explicit sample tuning and optional packet-aligned loop start.
 * @property {{adsr1:number,adsr2:number,pitch:number,reverb:boolean,volumeLeft:number,volumeRight:number}} preset Voice settings, excluding the uploaded sample ID.
 * @property {Ps1VabTone} tone The selected source Tone metadata.
 * @property {number} trimmedBytes Original bounded bytes omitted after END.
 */
/** @typedef {Object} Ps1VabExportOptions
 * @property {number} [toneNumber] Index in bank.tones. Omit for a byte-exact full source bank.
 */

const bytesOf = input => {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected VAB bytes');
};
const fail = message => {throw new RangeError(`VAB: ${message}`);};
const midi = (value, name) => {if (value > 127) fail(`${name} must be 0–127`); return value;};
// Keep raw source bytes private: parser results remain the same enumerable
// data model used by existing inspectors, snapshots and JSON diagnostics.
const vabSources = new WeakMap();
const bankMetadata = bank => {
  const {samples,...metadata}=bank;
  return JSON.stringify({...metadata,samples:samples.map(({bytes,...sample})=>({...sample,byteLength:bytes?.byteLength}))});
};

/** Parse a complete VAB, or a VH header plus its explicitly supplied VB body.
 * Counts are actual counts (not count minus one). Tone tables are packed by
 * nonempty program, while the 128-entry program table may have holes.
 * No file names, code execution, AudioContext or live RAM are involved.
 * @param {ArrayBuffer|ArrayBufferView} headerInput Complete VAB or VH bytes.
 * @param {ArrayBuffer|ArrayBufferView} [bodyInput] Matching VB bytes for split input.
 * @returns {Ps1VabBank} */
export function readVab(headerInput, bodyInput) {
  return parseVab(headerInput,bodyInput,true);
}
/** @param {ArrayBuffer|ArrayBufferView} headerInput
 * @param {ArrayBuffer|ArrayBufferView|undefined} bodyInput
 * @param {boolean} retainSource
 * @returns {Ps1VabBank} */
function parseVab(headerInput, bodyInput, retainSource) {
  const header = bytesOf(headerInput), split = bodyInput !== undefined;
  if (header.length > MAX_VAB_FILE_BYTES || header.length < 0x820 || String.fromCharCode(...header.subarray(0,4)) !== 'pBAV') fail('expected a standard pBAV header');
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const u16 = offset => view.getUint16(offset, true), u32 = offset => view.getUint32(offset, true);
  const version = u32(4), programCount = u16(0x12), toneCount = u16(0x14), sampleCount = u16(0x16);
  if (![6,7].includes(version)) fail(`version ${version} is unsupported (initial support: 6 and 7)`);
  if (!programCount || programCount > 128 || !toneCount || toneCount > programCount * 16 || sampleCount > 255) fail('invalid program, tone or sample count');
  const masterVolume = midi(header[0x18], 'master volume'), masterPan = midi(header[0x19], 'master pan');
  const sizeTable = 0x820 + programCount * 0x200, bodyOffset = sizeTable + 0x200;
  if (header.length < bodyOffset) fail('truncated tone or sample-size table');
  const body = split ? bytesOf(bodyInput) : header.subarray(bodyOffset);
  if (body.length > 524288) fail('sample body exceeds 512 KiB');
  const declaredSize = u32(0x0c);
  if (declaredSize !== bodyOffset + body.length || split && header.length !== bodyOffset) fail('declared file size does not match VH + VB (choose the matching pair)');
  /** @type {Ps1VabSample[]} */ const samples = [];
  const sampleRanges = [];
  // Entry zero is a leading body reservation (usually zero), not sample #1.
  let offset = u16(sizeTable) * 8;
  if (offset > body.length) fail('sample body prefix exceeds VB size');
  for (let index = 1; index <= sampleCount; index++) {
    const size = u16(sizeTable + index * 2) * 8;
    if (size < 16 || offset + size > body.length) fail(`invalid size or boundary for sample ${index}`);
    samples.push({index, bytes:body.slice(offset, offset + size)});
    sampleRanges.push({offset,size});
    offset += size;
  }
  // Padding after the last sample is allowed; each sample is still bounded by
  // the size table, never by a search into the next sample.
  /** @type {Ps1VabProgram[]} */ const programs = [];
  /** @type {Ps1VabTone[]} */ const tones = [];
  let packed = 0;
  for (let index = 0; index < 128; index++) {
    const at = 0x20 + index * 16, count = header[at];
    if (!count) continue;
    if (count > 16 || packed >= programCount) fail(`invalid tone count in program ${index}`);
    const volume = midi(header[at+1], 'program volume'), pan = midi(header[at+4], 'program pan');
    /** @type {Ps1VabProgram} */ const program = {index, volume, pan, tones:[]};
    for (let toneIndex = 0; toneIndex < count; toneIndex++) {
      const t = 0x820 + packed * 0x200 + toneIndex * 32;
      const tone = {program:index, index:toneIndex, sample:u16(t+22), mode:header[t+1],
        volume:midi(header[t+2], 'tone volume'), pan:midi(header[t+3], 'tone pan'),
        center:midi(header[t+4], 'center note'), shift:midi(header[t+5], 'fine tuning'),
        keyLow:midi(header[t+6], 'key minimum'), keyHigh:midi(header[t+7], 'key maximum'),
        adsr1:u16(t+16), adsr2:u16(t+18), vibratoWidth:header[t+8], vibratoTime:header[t+9],
        portamentoWidth:header[t+10], portamentoTime:header[t+11], bendMin:header[t+12], bendMax:header[t+13]};
      if (tone.keyLow > tone.keyHigh || tone.sample > sampleCount && tone.sample!==255) fail(`invalid key range or sample reference in program ${index}, tone ${toneIndex}`);
      program.tones.push(tone); tones.push(tone);
    }
    packed++; programs.push(program);
  }
  if (packed !== programCount || tones.length !== toneCount) fail('program/tone counts disagree with the tables');
  /** @type {Ps1VabBank} */ const bank={version:/** @type {6|7} */(version), id:u32(8), masterVolume, masterPan, programs, tones, samples};
  if(retainSource)vabSources.set(bank,{header:header.slice(0,bodyOffset),body:body.slice(),sampleRanges});
  return bank;
}

/** Export an opened, unchanged standard VAB without an audio core or encoder.
 * Full-bank output preserves the original VH + VB bytes, including padding.
 * A selected Tone keeps its original Program number and raw attributes, but
 * becomes the only Tone (index 0) and references the only sample (number 1).
 * This exports source banks, not arbitrary edited Synth instruments.
 * @param {Ps1VabBank} bank
 * @param {Ps1VabExportOptions} [options]
 * @returns {Uint8Array} */
export function exportVab(bank,options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options)||Reflect.ownKeys(options).some(key=>key!=='toneNumber'))throw new TypeError('Expected VAB export options {toneNumber?}');
  const source=vabSources.get(bank);
  if(!source)fail('export requires the original bank returned by readVab');
  let unchanged=false;
  try {
    // Source comparison is export-only. PSF bank searches do not serialize
    // metadata or scan every sample again merely to retain an export source.
    const original=parseVab(source.header,source.body,false);
    unchanged=bankMetadata(bank)===bankMetadata(original)&&bank.samples.every((sample,index)=>{
      const range=source.sampleRanges[index],bytes=sample.bytes;
      return bytes instanceof Uint8Array&&bytes.length===range.size&&bytes.every((value,at)=>value===source.body[range.offset+at]);
    });
  }catch{}
  if(!unchanged)fail('source bank changed; reopen it before exporting its original VAB');
  if(options.toneNumber===undefined) {
    const result=new Uint8Array(source.header.length+source.body.length);
    result.set(source.header);result.set(source.body,source.header.length);return result;
  }
  // Availability validation neither trims nor rewrites the raw exported
  // sample. Bytes after its first END remain inside the original size bound.
  const {tone}=prepareVabTone(bank,options.toneNumber);
  const packed=bank.programs.findIndex(program=>program.index===tone.program),range=source.sampleRanges[tone.sample-1];
  const raw=new DataView(source.header.buffer,source.header.byteOffset,source.header.byteLength);
  const originalSizeTable=0x820+bank.programs.length*0x200,prefix=raw.getUint16(originalSizeTable,true)*8;
  const sizeTable=0xa20,bodyOffset=0xc20,result=new Uint8Array(bodyOffset+prefix+range.size),view=new DataView(result.buffer);
  result.set(source.header.subarray(0,0x20));
  view.setUint32(0x0c,result.length,true);view.setUint16(0x12,1,true);view.setUint16(0x14,1,true);view.setUint16(0x16,1,true);
  const programAt=0x20+tone.program*16;
  result.set(source.header.subarray(programAt,programAt+16),programAt);result[programAt]=1;
  const toneAt=0x820+packed*0x200+tone.index*32;
  result.set(source.header.subarray(toneAt,toneAt+32),0x820);view.setUint16(0x820+22,1,true);
  view.setUint16(sizeTable,prefix/8,true);view.setUint16(sizeTable+2,range.size/8,true);
  result.set(source.body.subarray(0,prefix),bodyOffset);
  result.set(source.body.subarray(range.offset,range.offset+range.size),bodyOffset+prefix);
  return result;
}

/** Prepare one Tone for the existing Synth/preset API. ADPCM payload is never
 * decoded or re-encoded. Trim only bytes after the first hardware END packet.
 * Unsupported flag patterns fail instead of silently rewriting game data.
 * @param {Ps1VabBank} bank
 * @param {number} toneNumber Index in bank.tones, not a Program number.
 * @returns {Ps1VabPreparedTone} */
export function prepareVabTone(bank, toneNumber) {
  if (!Number.isInteger(toneNumber) || !bank?.tones?.[toneNumber]) fail('choose a tone');
  const tone = bank.tones[toneNumber], program = bank.programs.find(item => item.index === tone.program);
  if (tone.sample===0) fail('this Tone has no assigned sample');
  if (tone.sample===255) fail('libsnd Noise tone (sample 255) is not supported by this importer yet');
  const bytes = bank.samples[tone.sample-1].bytes;
  let end = -1, marker = null;
  for (let at = 0; at + 16 <= bytes.length; at += 16) {
    if (bytes[at+1] & 4) {if (marker !== null) fail('multiple loop-start markers are not supported yet'); marker = at / 16 * 28;}
    if (bytes[at+1] & 1) {end = at + 16; break;}
  }
  if (end < 0) fail(`sample ${tone.sample} has no END packet`);
  const adpcm = bytes.slice(0, end), loop = Boolean(adpcm[end-15] & 2);
  // Positive shift raises playback pitch; therefore it lowers the effective
  // root frequency. See libsnd note2pitch2 (shift / 8, 16 steps/semitone).
  const options = {baseFrequencyHz:440 * 2 ** ((tone.center - tone.shift/128 - 69)/12),
    ...(loop ? {loopStartSamples:marker ?? 0} : {})};
  preparePs1ADPCM(adpcm, options);
  // Static libsnd-style volume/pan approximation. Game driver dynamics and
  // controller values are unavailable from VAB alone.
  const level = bank.masterVolume/127 * program.volume/127 * tone.volume/127;
  const pans=[bank.masterPan,program.pan,tone.pan];
  const left=pans.reduce((gain, pan) => gain*(pan<64 ? 1 : (127-pan)/63),1);
  const right=pans.reduce((gain, pan) => gain*(pan<64 ? pan/63 : 1),1);
  const preset = {adsr1:tone.adsr1, adsr2:tone.adsr2, pitch:4096, reverb:Boolean(tone.mode & 4),
    volumeLeft:(level*left)**2, volumeRight:(level*right)**2};
  return {adpcm, options, preset, tone, trimmedBytes:bytes.length-end};
}
