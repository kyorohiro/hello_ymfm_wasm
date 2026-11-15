// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {looksLikeS98,convertS98ToVgm} from '../js/s98_file.js';
import {convertYm2203VgmToYm2608,readYm2203CompatibilityExtraHeader} from './song_compatibility.js';

export const MAX_FM2608_SONG_BYTES = 64 * 1024 * 1024;
const MAX_SAMPLES = 44100 * 3600;
const later = () => new Promise(resolve => globalThis.setTimeout(resolve,0));
const check = signal => {if (signal?.aborted) throw new DOMException('OPNA song operation cancelled','AbortError');};
const CLOCKS = [
  [0x0c,'Sega PSG'],[0x10,'YM2413'],[0x2c,'YM2612'],[0x30,'YM2151'],
  [0x38,'Sega PCM'],[0x40,'RF5C68'],[0x44,'YM2203'],[0x4c,'YM2610'],
  [0x50,'YM3812'],[0x54,'YM3526'],[0x58,'Y8950'],[0x5c,'YMF262'],
  [0x60,'YMF278B'],[0x64,'YMF271'],[0x68,'YMZ280B'],[0x6c,'RF5C164'],
  [0x70,'PWM'],[0x74,'AY8910'],[0x80,'Game Boy'],[0x84,'NES APU'],
  [0x88,'MultiPCM'],[0x8c,'uPD7759'],[0x90,'OKIM6258'],[0x98,'OKIM6295'],
  [0x9c,'K051649'],[0xa0,'K054539'],[0xa4,'HuC6280'],[0xa8,'C140'],
  [0xac,'K053260'],[0xb0,'POKEY'],[0xb4,'QSound'],[0xb8,'SCSP'],
  [0xc0,'WonderSwan'],[0xc4,'VSU'],[0xc8,'SAA1099'],[0xcc,'ES5503'],
  [0xd0,'ES5506'],[0xd8,'X1-010'],[0xdc,'C352'],[0xe0,'GA20'],[0xe4,'Mikey'],
  [0xe8,'K007232'],[0xec,'K005289'],[0xf0,'MSM5205'],[0xf4,'MSM5232'],
  [0xf8,'BSMT2000'],[0xfc,'ICS2115'],
];

async function decode(source,signal) {
  check(signal);
  if (!(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) throw new TypeError('Choose a binary VGM, VGZ or S98 file');
  let bytes = Uint8Array.from(source instanceof Uint8Array ? source : new Uint8Array(source));
  if (bytes.length > MAX_FM2608_SONG_BYTES) throw new RangeError('Song file exceeds 64 MiB');
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
      if (length > MAX_FM2608_SONG_BYTES) throw new RangeError('Expanded VGZ exceeds 64 MiB');
      chunks.push(value);
    }
  } finally {signal?.removeEventListener('abort',cancel); await reader.cancel().catch(() => {}); reader.releaseLock();}
  bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset); offset += chunk.length;}
  return bytes;
}

/** Validate the entire single-OPNA timeline before replacing a loaded song.
 * CPU register-8 memory transfers and ADPCM-B ROM/RAM blocks use the same
 * parser/engine dispatch as Analyzer. No audio device is opened here. */
export async function prepareFm2608SongSource(source,{signal,yieldTask=later} = {}) {
  let bytes = await decode(source,signal), sourceHeader = null;
  const input = source instanceof Uint8Array ? source : new Uint8Array(source);
  const format = looksLikeS98(bytes) ? 'S98' : input[0] === 0x1f ? 'VGZ' : 'VGM';
  if (looksLikeS98(bytes)) {
    const converted = convertS98ToVgm(bytes);
    sourceHeader = converted.sourceHeader; bytes = new Uint8Array(converted.buffer);
  }
  check(signal);
  if (bytes.length < 0x48) throw new Error('Truncated VGM header: a YM2608 or YM2203 clock is required');
  let view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const eof = view.getUint32(4,true);
  if (eof && (eof + 4 > bytes.length || eof + 4 < 0x48)) throw new Error('Invalid VGM file size');
  if (eof && eof + 4 < bytes.length) {bytes = bytes.slice(0,eof + 4); view = new DataView(bytes.buffer);}
  let parser = new Ym2612VGM(bytes,{logger:{warn:message => {throw new Error(message);}}});
  let header = parser.header;
  if (header.version < 0x151 || header.version > 0x172) throw new Error('OPNA reference playback supports VGM 1.51–1.72');
  const sourceChip = header.ym2203Clock && !header.ym2608Clock ? 'ym2203' : 'ym2608';
  const sourceClock = sourceChip === 'ym2203' ? header.ym2203Clock : header.ym2608Clock;
  if (header.dataOffset < (sourceChip === 'ym2203' ? 0x48 : 0x4c) || header.dataOffset >= bytes.length) throw new Error('Invalid OPN VGM data offset');
  if (!sourceClock) throw new Error('This song contains no YM2608 or YM2203 chip');
  if (sourceClock & 0xc0000000) throw new Error('OPNA reference playback supports a single YM2608 or YM2203; dual and variant chips are unsupported');
  if (sourceClock > (sourceChip === 'ym2203' ? 12000000 : 24000000)) throw new RangeError('YM2608 playback clock exceeds the 24 MHz render budget');
  const extraHeader = readYm2203CompatibilityExtraHeader(bytes,header);
  const clockHeaderEnd = extraHeader?.mainHeaderEnd ?? header.dataOffset;
  const others = CLOCKS.filter(([offset]) => !(sourceChip === 'ym2203' && offset === 0x44) && offset + 4 <= clockHeaderEnd && offset + 4 <= bytes.length && view.getUint32(offset,true)).map(([,name]) => name);
  if (others.length) throw new Error(`OPNA reference playback supports one YM2608 or a compatible YM2203. Unsupported chip: ${others.join(', ')}`);
  const metadata = parseVgmMetadata(bytes);
  let compatibility = null;
  if (sourceChip === 'ym2203') {
    const converted = await convertYm2203VgmToYm2608(bytes,{signal,yieldTask});
    bytes = converted.bytes; compatibility = converted.compatibility;
    parser = new Ym2612VGM(bytes,{logger:{warn:message => {throw new Error(message);}}}); header = parser.header;
  }

  let commands = 0, totalSamples = 0, burst = 0, writes = 0, ended = false, memoryBytes = 0, usesRhythm = false;
  const compatibilityPrologue = compatibility ? 5 : 0;
  while (parser.position < bytes.length && !parser.ended) {
    check(signal);
    const position = parser.position, command = bytes[position];
    if (++commands > 4000000 + compatibilityPrologue) throw new RangeError('Song exceeds four million commands');
    if (++burst > 65536 + compatibilityPrologue) throw new RangeError('Song exceeds 65536 commands without positive time progress');
    if (![0x56,0x57,0x61,0x62,0x63,0x66,0x67].includes(command) && !(command >= 0x70 && command <= 0x7f)) {
      throw new Error(`OPNA reference playback does not support VGM command 0x${command.toString(16).padStart(2,'0')}`);
    }
    if (command === 0x67 && (position + 7 > bytes.length || bytes[position+1] !== 0x66 || bytes[position+2] !== 0x81)) {
      throw new Error('OPNA reference playback supports YM2608 ADPCM-B data blocks (0x81) only');
    }
    const event = parser.step();
    if (event.type === 'wait') {
      totalSamples += event.samples;
      if (event.samples > 0) burst = 0;
      if (totalSamples > MAX_SAMPLES) throw new RangeError('Reference song exceeds one hour');
    } else if (event.type === 'ym2608-write') {
      writes++;
      if (!event.port && event.register === 0x10 && !(event.value & 128) && event.value & 63) usesRhythm = true;
    }
    else if (event.type === 'ym2608-adpcm-b-data') {
      if (event.chipIndex) throw new Error('Second YM2608 ADPCM memory is unsupported');
      memoryBytes += event.data.length;
      if (memoryBytes > MAX_FM2608_SONG_BYTES) throw new RangeError('ADPCM memory transfers exceed 64 MiB');
    } else if (event.type === 'end') ended = true;
    else throw new Error(`Unsupported OPNA song event: ${event.type}`);
    if (commands % 4096 === 0) await yieldTask();
  }
  check(signal);
  if (!ended) throw new Error('Song command stream has no end command');
  if (!writes || !totalSamples) throw new Error('Song contains no timed YM2608 audio');
  return {bytes,header,totalSamples,format,sourceHeader,metadata,sourceChip,sourceClock,compatibility,extraHeader,
    warnings:[...(compatibility ? [compatibility.warning] : []),...(compatibility?.extraVolumeWarning ? [compatibility.extraVolumeWarning] : []),...(header.loopOffset ? ['Reference playback plays this song once; its loop is not repeated.'] : []),
      ...(usesRhythm ? ['Rhythm uses Tetorica’s original demonstration ROM; its percussion differs from the hardware ROM.'] : [])]};
}
