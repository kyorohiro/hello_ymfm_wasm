// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Standard Sony VAB v6/v7. Layout references:
// https://github.com/vgmtrans/vgmtrans/blob/master/src/main/formats/PS1/Vab.cpp
// https://psx-spx.consoledev.net/cdromfileformats/#vab-header-vh
// libsnd tuning and body prefix checked against:
// https://github.com/Xeeynamo/sotn-decomp/blob/master/src/main/psxsdk/libsnd/vmanager.c
// https://github.com/Xeeynamo/sotn-decomp/blob/master/src/main/psxsdk/libsnd/vs_vh.c
import {preparePs1ADPCM} from '../js/ps1synth.js?v=ps1-deferred-release-1';

export const MAX_VAB_FILE_BYTES = 1024 * 1024;
const bytesOf = input => {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected VAB bytes');
};
const fail = message => {throw new RangeError(`VAB: ${message}`);};
const midi = (value, name) => {if (value > 127) fail(`${name} must be 0–127`); return value;};

/** Parse a complete VAB, or a VH header plus its explicitly supplied VB body.
 * Counts are actual counts (not count minus one). Tone tables are packed by
 * nonempty program, while the 128-entry program table may have holes.
 * No file names, code execution or live RAM are involved. */
export function readVab(headerInput, bodyInput) {
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
  const samples = [];
  // Entry zero is a leading body reservation (usually zero), not sample #1.
  let offset = u16(sizeTable) * 8;
  if (offset > body.length) fail('sample body prefix exceeds VB size');
  for (let index = 1; index <= sampleCount; index++) {
    const size = u16(sizeTable + index * 2) * 8;
    if (size < 16 || offset + size > body.length) fail(`invalid size or boundary for sample ${index}`);
    samples.push({index, bytes:body.slice(offset, offset + size)});
    offset += size;
  }
  // Padding after the last sample is allowed; each sample is still bounded by
  // the size table, never by a search into the next sample.
  const programs = [], tones = [];
  let packed = 0;
  for (let index = 0; index < 128; index++) {
    const at = 0x20 + index * 16, count = header[at];
    if (!count) continue;
    if (count > 16 || packed >= programCount) fail(`invalid tone count in program ${index}`);
    const volume = midi(header[at+1], 'program volume'), pan = midi(header[at+4], 'program pan');
    const program = {index, volume, pan, tones:[]};
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
  return {version, id:u32(8), masterVolume, masterPan, programs, tones, samples};
}

/** Prepare one Tone for the existing Synth/preset API. ADPCM payload is never
 * decoded or re-encoded. Trim only bytes after the first hardware END packet.
 * Unsupported flag patterns fail instead of silently rewriting game data. */
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
  if (!loop && marker !== null) fail('one-shot sample contains a loop-start marker; this flag pattern is not supported yet');
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
