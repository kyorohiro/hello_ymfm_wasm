// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM,rawCommandLength} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {validateNesApuClock} from '../js/nesapu.js';

export const MAX_NES_SONG_BYTES = 64 * 1024 * 1024;
const later = () => new Promise(resolve => globalThis.setTimeout(resolve,0));
const check = signal => {if (signal?.aborted) throw new DOMException('NES song operation cancelled','AbortError');};
const CLOCKS = [
  [0x0c,'Sega PSG'],[0x10,'YM2413'],[0x2c,'YM2612'],[0x30,'YM2151'],[0x38,'Sega PCM'],
  [0x40,'RF5C68'],[0x44,'YM2203'],[0x48,'YM2608'],[0x4c,'YM2610'],[0x50,'YM3812'],
  [0x54,'YM3526'],[0x58,'Y8950'],[0x5c,'YMF262'],[0x60,'YMF278B'],[0x64,'YMF271'],
  [0x68,'YMZ280B'],[0x6c,'RF5C164'],[0x70,'PWM'],[0x74,'AY8910'],[0x80,'Game Boy'],
  [0x88,'MultiPCM'],[0x8c,'uPD7759'],[0x90,'OKIM6258'],[0x98,'OKIM6295'],[0x9c,'K051649'],
  [0xa0,'K054539'],[0xa4,'HuC6280'],[0xa8,'C140'],[0xac,'K053260'],[0xb0,'POKEY'],
  [0xb4,'QSound'],[0xb8,'SCSP'],[0xc0,'WonderSwan'],[0xc4,'VSU'],[0xc8,'SAA1099'],
  [0xcc,'ES5503'],[0xd0,'ES5506'],[0xd8,'X1-010'],[0xdc,'C352'],[0xe0,'GA20'],[0xe4,'Mikey'],
  [0xe8,'K007232'],[0xec,'K005289'],[0xf0,'MSM5205'],[0xf4,'MSM5232'],[0xf8,'BSMT2000'],[0xfc,'ICS2115'],
];

/** VGM encodes FDS addresses differently from CPU-addressed public methods. */
export function nesVgmAddress(register) {
  if (Number.isInteger(register) && register >= 0 && register <= 0x17) return 0x4000 + register;
  if (register === 0x3f) return 0x4023;
  if (register >= 0x20 && register <= 0x2a) return 0x4080 + register - 0x20;
  if (register >= 0x40 && register <= 0x7f) return 0x4000 + register;
  throw new RangeError(`Unsupported NES/FDS VGM register 0x${Number(register).toString(16)}`);
}

async function decode(input,signal) {
  check(signal);
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) throw new TypeError('Choose a binary VGM or VGZ file');
  let bytes = Uint8Array.from(input instanceof Uint8Array ? input : new Uint8Array(input));
  if (bytes.length > MAX_NES_SONG_BYTES) throw new RangeError('Song file exceeds 64 MiB');
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== 'function') throw new Error('VGZ requires browser gzip support');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const cancel = () => {void reader.cancel().catch(() => {});};
  signal?.addEventListener('abort',cancel,{once:true});
  const chunks = []; let length = 0;
  try {
    for (;;) {
      check(signal); const {value,done} = await reader.read(); check(signal);
      if (done) break;
      length += value.length;
      if (length > MAX_NES_SONG_BYTES) throw new RangeError('Expanded VGZ exceeds 64 MiB');
      chunks.push(value);
    }
  } finally {signal?.removeEventListener('abort',cancel); await reader.cancel().catch(() => {}); reader.releaseLock();}
  bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.length;}
  return bytes;
}

/** Validate the complete timeline before changing the loaded song. RAM-bank
 * copies are converted to equivalent timed C2 uploads for the shared player.
 * Original imported bytes remain in Files, including their GD3 metadata. */
export async function prepareNesSongSource(input,{signal,yieldTask=later} = {}) {
  let bytes = await decode(input,signal);
  if (bytes.length < 0x88) throw new Error('Truncated VGM header: an NES APU clock is required');
  let view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const eof = view.getUint32(4,true);
  if (eof && (eof + 4 > bytes.length || eof + 4 < 0x88)) throw new Error('Invalid VGM file size');
  if (eof && eof + 4 < bytes.length) {bytes = bytes.slice(0,eof + 4); view = new DataView(bytes.buffer);}
  const parser = new Ym2612VGM(bytes,{logger:{warn:message => {throw new Error(message);}}});
  const {header} = parser;
  if (header.version < 0x161 || header.version > 0x172) throw new Error('NES reference playback supports VGM 1.61–1.72');
  if (header.dataOffset < 0x88 || header.dataOffset >= bytes.length) throw new Error('Invalid NES VGM data offset');
  const rawClock = header.nesApuClock, clock = rawClock & 0x3fffffff, fds = Boolean(rawClock & 0x80000000);
  if (!clock) throw new Error('This song contains no NES APU');
  if (rawClock & 0x40000000) throw new Error('Reference playback supports a single NES APU with optional FDS');
  validateNesApuClock(clock);
  const extraOffset = header.version >= 0x170 && header.dataOffset > 0xbf ? view.getUint32(0xbc,true) : 0;
  const headerEnd = extraOffset ? Math.min(header.dataOffset,0xbc + extraOffset) : header.dataOffset;
  const others = CLOCKS.filter(([offset]) => offset + 4 <= headerEnd && offset + 4 <= bytes.length && view.getUint32(offset,true)).map(([,name]) => name);
  if (others.length) throw new Error(`NES reference playback supports NES APU + FDS. Unsupported chip: ${others.join(', ')}`);
  const metadata = parseVgmMetadata(bytes), chunks = [];
  const bank = []; let bankSize = 0, commands = 0, burst = 0, totalSamples = 0, writes = 0, transfers = 0;
  let ended = false, normalized = false, outputSize = header.dataOffset;
  const append = chunk => {
    outputSize += chunk.length;
    if (outputSize > MAX_NES_SONG_BYTES) throw new RangeError('Expanded NES song exceeds 64 MiB');
    chunks.push(chunk);
  };
  const u24 = offset => bytes[offset] | bytes[offset+1] << 8 | bytes[offset+2] << 16;
  for (let position=header.dataOffset; position<bytes.length;) {
    check(signal);
    if (++commands > 4000000) throw new RangeError('Song exceeds four million commands');
    if (++burst > 65536) throw new RangeError('Song exceeds 65536 commands without positive time progress');
    const command = bytes[position], length = rawCommandLength(bytes,view,position);
    if (position + length > bytes.length) throw new Error('Truncated VGM command');
    let samples = 0;
    if (command === 0xb4) {
      const register = bytes[position+1];
      if (register & 128) throw new Error('Second NES chip writes are not supported');
      if (nesVgmAddress(register) >= 0x4023 && !fds) throw new Error('FDS writes require the FDS header flag');
      writes++; append(bytes.subarray(position,position+length));
    } else if (command === 0x67) {
      if (bytes[position+1] !== 0x66) throw new Error('Invalid VGM data block header');
      const type = bytes[position+2], rawSize = view.getUint32(position+3,true), size = rawSize & 0x7fffffff;
      if (rawSize & 0x80000000) throw new Error('Second NES chip memory is not supported');
      if (type === 7) {
        bank.push({start:bankSize,data:bytes.subarray(position+7,position+7+size)}); bankSize += size; normalized = true;
        if (bankSize > MAX_NES_SONG_BYTES) throw new RangeError('NES DPCM bank exceeds 64 MiB');
      } else if (type === 0xc2) {
        if (size < 2 || view.getUint16(position+7,true) + size - 2 > 65536) throw new RangeError('Invalid NES RAM block range');
        transfers += size - 2; append(bytes.subarray(position,position+length));
      } else throw new Error(`NES reference playback does not support data block 0x${type.toString(16)}`);
    } else if (command === 0x68) {
      if (bytes[position+1] !== 0x66 || bytes[position+2] !== 7) throw new Error('NES reference playback supports NES DPCM RAM copies only');
      const from = u24(position+3), address = u24(position+6), size = u24(position+9) || 0x1000000;
      if (from + size > bankSize || address + size > 65536) throw new RangeError('NES DPCM RAM copy exceeds its recorded bank or CPU RAM');
      const block = new Uint8Array(9 + size), blockView = new DataView(block.buffer);
      block.set([0x67,0x66,0xc2]); blockView.setUint32(3,size+2,true); blockView.setUint16(7,address,true);
      for (const part of bank) {
        const low = Math.max(from,part.start), high = Math.min(from+size,part.start+part.data.length);
        if (low < high) block.set(part.data.subarray(low-part.start,high-part.start),9+low-from);
      }
      transfers += size; append(block); normalized = true;
    } else if (command === 0x61 || command === 0x62 || command === 0x63 || command >= 0x70 && command <= 0x7f) {
      samples = command === 0x61 ? view.getUint16(position+1,true) : command === 0x62 ? 735 : command === 0x63 ? 882 : (command & 15) + 1;
      totalSamples += samples; if (samples) burst = 0;
      if (totalSamples > 44100 * 3600) throw new RangeError('Reference song exceeds one hour');
      append(bytes.subarray(position,position+length));
    } else if (command === 0x66) {append(bytes.subarray(position,position+1)); ended = true; break;}
    else throw new Error(`NES reference playback does not support VGM command 0x${command.toString(16).padStart(2,'0')}`);
    if (transfers > 128 * 1024 * 1024) throw new RangeError('NES memory transfers exceed 128 MiB');
    position += length;
    if (commands % 4096 === 0) await yieldTask();
  }
  check(signal);
  if (!ended) throw new Error('Song command stream has no end command');
  if (!writes || !totalSamples) throw new Error('Song contains no timed NES audio');
  if (normalized) {
    const next = new Uint8Array(outputSize); next.set(bytes.subarray(0,header.dataOffset)); let offset = header.dataOffset;
    for (const chunk of chunks) {next.set(chunk,offset); offset += chunk.length;}
    const nextView = new DataView(next.buffer); nextView.setUint32(4,next.length-4,true); nextView.setUint32(0x14,0,true); nextView.setUint32(0x1c,0,true);
    bytes = next;
  }
  return {bytes,header:new Ym2612VGM(bytes).header,clock,fds,sourceClock:clock,sourceChip:'nes',totalSamples,metadata,
    format:(input instanceof Uint8Array ? input[0] : new Uint8Array(input)[0]) === 0x1f ? 'VGZ' : 'VGM',
    warnings:[...(header.loopOffset ? ['Reference playback plays this song once; its loop is not repeated.'] : [])]};
}
