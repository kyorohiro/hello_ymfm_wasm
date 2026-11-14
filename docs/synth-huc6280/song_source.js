// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';

export const MAX_HUC6280_SONG_BYTES = 64 * 1024 * 1024;
const MAX_COMMANDS = 4_000_000, MAX_SAMPLES = 44100 * 60 * 60;
const MAX_BANK_COPY_BYTES = 256 * 1024 * 1024, MAX_STREAM_WRITES = 100_000_000;
const nativeSchedule = globalThis.setTimeout.bind(globalThis);
const task = () => new Promise(resolve => nativeSchedule(resolve, 0));
const aborted = () => new DOMException('HuC6280 song operation cancelled', 'AbortError');
const check = signal => {if (signal?.aborted) throw aborted();};
const hex = value => `0x${value.toString(16).padStart(2, '0')}`;

// Include clocks that the shared parser does not yet expose. A declared chip
// must never disappear silently from this PC Engine reference player.
const CLOCKS = [
  [0x0c,'Sega PSG'],[0x10,'YM2413'],[0x2c,'YM2612'],[0x30,'YM2151'],
  [0x38,'Sega PCM'],[0x40,'RF5C68'],[0x44,'YM2203'],[0x48,'YM2608'],
  [0x4c,'YM2610'],[0x50,'YM3812'],[0x54,'YM3526'],[0x58,'Y8950'],
  [0x5c,'YMF262'],[0x60,'YMF278B'],[0x64,'YMF271'],[0x68,'YMZ280B'],
  [0x6c,'RF5C164'],[0x70,'PWM'],[0x74,'AY8910'],[0x80,'Game Boy'],
  [0x84,'NES APU'],[0x88,'MultiPCM'],[0x8c,'uPD7759'],[0x90,'OKIM6258'],
  [0x98,'OKIM6295'],[0x9c,'K051649'],[0xa0,'K054539'],[0xa8,'C140'],
  [0xac,'K053260'],[0xb0,'POKEY'],[0xb4,'QSound'],[0xb8,'SCSP'],
  [0xc0,'WonderSwan'],[0xc4,'VSU'],[0xc8,'SAA1099'],[0xcc,'ES5503'],
  [0xd0,'ES5506'],[0xd8,'X1-010'],[0xdc,'C352'],[0xe0,'GA20'],[0xe4,'Mikey'],
  [0xe8,'K007232'],[0xec,'K005289'],[0xf4,'MSM5232'],[0xf8,'BSMT2000'],[0xfc,'ICS2115'],
];
export const MAX_MSM5205_SONG_CLOCK=20_000_000;

async function decode(source, signal) {
  check(signal);
  const input = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source) : null;
  if (!input) throw new TypeError('Choose a binary VGM or VGZ file');
  if (input.byteLength > MAX_HUC6280_SONG_BYTES) throw new RangeError('VGM/VGZ file exceeds 64 MiB');
  // Buffer.slice() is a borrowed view, unlike Uint8Array.slice(). Normalize
  // first so every caller gets owned, zero-offset bytes before EOF trimming.
  const bytes = Uint8Array.from(input);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== 'function') throw new Error('VGZ requires browser gzip support');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const cancel = () => {void reader.cancel().catch(() => {});};
  signal?.addEventListener('abort', cancel, {once:true});
  const chunks = []; let length = 0;
  try {
    for (;;) {
      check(signal); const {done, value} = await reader.read(); check(signal);
      if (done) break;
      length += value.length;
      if (length > MAX_HUC6280_SONG_BYTES) {await reader.cancel(); throw new RangeError('Expanded VGZ exceeds 64 MiB');}
      chunks.push(value);
    }
  } catch (error) {
    check(signal);
    if (error instanceof RangeError) throw error;
    throw new Error(`VGZ gzip decoding failed: ${error?.message || 'invalid compressed data'}`);
  } finally {signal?.removeEventListener('abort', cancel); reader.releaseLock();}
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.length;}
  return result;
}

/** Validate the complete one-pass HuC6280 timeline without opening audio or
 * synthesizing PCM. Accepted DAC commands use the shared player's exact byte
 * stride, start/reuse, reverse, loop and bank-block semantics. Unsupported
 * compression, destinations and malformed ranges fail before host ownership.
 * Returned bytes are owned by this result, independent of the supplied file. */
export async function prepareHuc6280SongSource(source, {signal, yieldTask = task} = {}) {
  let bytes = await decode(source, signal); check(signal);
  if (bytes.length < 0xa8) throw new Error('Truncated VGM header: a HuC6280 clock is required');
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eof = view.getUint32(4, true);
  if (eof && (eof + 4 > bytes.length || eof + 4 < 0xa8)) throw new Error('Invalid or truncated VGM file size');
  if (eof && eof + 4 < bytes.length) {bytes = bytes.slice(0, eof + 4); view = new DataView(bytes.buffer);}
  const {header} = new Ym2612VGM(bytes, {logger:null});
  if (header.version < 0x161 || header.version > 0x172) throw new Error('HuC6280 reference playback supports VGM versions 1.61–1.72');
  if (header.dataOffset < 0xa8 || header.dataOffset >= bytes.length) throw new Error('Invalid HuC6280 VGM data offset');
  const hasMsm=Boolean(header.msm5205Clock);
  if (!header.huc6280Clock&&!hasMsm) throw new Error('This VGM contains no HuC6280 or MSM5205 chip');
  if (header.huc6280Clock & 0xc0000000) throw new Error('HuC6280 song playback does not support dual or variant chips');
  if (header.huc6280Clock&&header.huc6280Clock !== HUC6280_CLOCK) throw new Error(`HuC6280 song playback requires the normal ${HUC6280_CLOCK} Hz clock`);
  if(header.dataOffset>=0xf4&&view.getUint32(0xf0,true)&&header.version<0x172)throw new Error('Unsupported chip: MSM5205 requires VGM version 1.72');
  if(hasMsm){
    if(header.version<0x172)throw new Error('MSM5205 requires VGM version 1.72');
    if(header.msm5205Clock&0xc0000000)throw new Error('MSM5205 dual chips and MSM6585 variants are unsupported');
    if(header.msm5205Clock>MAX_MSM5205_SONG_CLOCK)throw new RangeError('MSM5205 clock exceeds the 20 MHz reference render budget');
    if(header.msm5205Flags&~7)throw new Error('Unsupported MSM5205 header flags');
  }
  const others = CLOCKS.filter(([offset]) => offset + 4 <= header.dataOffset && view.getUint32(offset, true)).map(([,name]) => name);
  if (others.length) throw new Error(`PC Engine song playback supports HuC6280 + MSM5205. Unsupported chip: ${others.join(', ')}`);
  // Extra header can change per-chip clocks/volume. This first slice has no
  // alternate-clock/multi-chip mix contract, so it cannot ignore that header.
  if (header.dataOffset >= 0xc0 && view.getUint32(0xbc, true)) throw new Error('HuC6280 reference playback does not support VGM extra headers');

  const banks = new Map(), streams = new Map();
  let position = header.dataOffset, count = 0, totalSamples = 0, writes = 0, ended = false;
  let bankCopyBytes = 0, streamWrites = 0, recursiveCommands = 0;
  let burstCommands = 0, windowCommands = 0, windowStart = 0;
  const need = length => {if (position + length > bytes.length) throw new Error('Truncated HuC6280 VGM command stream');};
  const getStream = id => {
    const stream = streams.get(id);
    if (!stream) throw new Error(`DAC stream ${id} must be set up before use`);
    return stream;
  };
  const checkRates = () => {
    let rate = 0;
    for (const stream of streams.values()) if (stream.active) rate += stream.frequency;
    if (rate > 384000) throw new RangeError('HuC6280 active DAC streams exceed the combined 384000 Hz rate budget');
  };
  const advance = samples => {
    totalSamples += samples;
    if (totalSamples > MAX_SAMPLES) throw new RangeError('HuC6280 reference song exceeds one hour');
    if (samples > 0) burstCommands = 0;
    for (const stream of streams.values()) if (stream.active && stream.frequency > 0) {
      const due = Math.floor((stream.remainder + samples * stream.frequency) / 44100);
      stream.remainder = (stream.remainder + samples * stream.frequency) % 44100;
      const emitted = stream.loop ? due : Math.min(due, stream.remaining);
      streamWrites += emitted; writes += emitted;
      if (streamWrites > MAX_STREAM_WRITES) throw new RangeError('HuC6280 VGM exceeds the DAC stream write budget');
      if (!stream.loop && (stream.remaining -= emitted) === 0) stream.active = false;
    }
  };
  const start = (stream, offset, mode, length) => {
    const bank = banks.get(stream.bank);
    if (!bank || !stream.step) throw new Error('DAC stream start requires a loaded data bank and data setup');
    if (!(stream.frequency > 0)) throw new Error('DAC stream start requires a nonzero frequency');
    if (mode & ~0x93 || (mode & 15) > 3) throw new Error('Unsupported HuC6280 DAC stream length mode or flags');
    if (offset === 0xffffffff) {
      if (stream.offset === undefined) throw new Error('DAC stream cannot reuse a start offset before its first start');
      offset = stream.offset;
    } else offset += stream.base;
    const available = Math.max(0, Math.floor((bank.length - offset - 1) / stream.step) + 1);
    const kind = mode & 15;
    const commands = kind === 0 ? stream.commandCount : kind === 1 ? length : kind === 2 ? Math.floor(length * stream.frequency / 1000) : available;
    if (!Number.isSafeInteger(commands) || commands <= 0 || commands > available) throw new Error('DAC stream start has an empty or out-of-range data interval');
    stream.offset = offset; stream.commandCount = commands;
    stream.remaining = commands; stream.remainder = 44100;
    stream.loop = Boolean(mode & 0x80); stream.active = true;
  };
  while (position < bytes.length) {
    check(signal);
    if (++count > MAX_COMMANDS) throw new RangeError('VGM exceeds four million commands');
    if (++burstCommands > 4096) throw new RangeError('VGM exceeds 4096 commands without positive time progress');
    if (totalSamples - windowStart >= 256) {windowStart = totalSamples; windowCommands = 0;}
    if (++windowCommands > 32768) throw new RangeError('VGM command density exceeds 32768 commands per 256 timeline samples');
    const command = bytes[position];
    if (command === 0x66) {ended = true; break;}
    if (command === 0x67 || command >= 0x90 && command <= 0x95) {
      // Shared step() recursively skips bank/stream metadata. Bound a run of
      // metadata so a tiny malicious file cannot exhaust its JS call stack.
      if (++recursiveCommands > 256) throw new Error('VGM has too many consecutive DAC metadata commands');
    } else recursiveCommands = 0;
    if (command === 0xb9) {
      if(!header.huc6280Clock)throw new Error('VGM writes an undeclared HuC6280 chip');
      need(3); const register = bytes[position + 1];
      if (register & 128) throw new Error('Second HuC6280 chip writes are not supported');
      if (register > 9) throw new Error('VGM writes outside the HuC6280 register range');
      writes++; position += 3;
    } else if(command===0x32){
      need(2);
      if(!hasMsm)throw new Error('VGM writes an undeclared MSM5205 chip; version 1.72 clock metadata is required');
      if(bytes[position+1]&128)throw new Error('Second MSM5205 chip writes are unsupported');
      writes++;position+=2;
    } else if (command === 0x61) {need(3); advance(view.getUint16(position + 1, true)); position += 3;}
    else if (command === 0x62 || command === 0x63) {advance(command === 0x62 ? 735 : 882); position++;}
    else if (command >= 0x70 && command <= 0x7f) {advance((command & 15) + 1); position++;}
    else if (command === 0x67) {
      need(7); const type = bytes[position + 2], size = view.getUint32(position + 3, true);
      if (bytes[position + 1] !== 0x66) throw new Error('Invalid VGM data block header');
      if (type > 0x3f || size & 0x80000000) throw new Error('HuC6280 song playback supports ordinary single-chip DAC data banks only; compressed and ROM blocks are unsupported');
      need(7 + size);
      const bank = banks.get(type) ?? {length:0, blocks:[]};
      bank.blocks.push({offset:bank.length, length:size}); bank.length += size; banks.set(type, bank);
      bankCopyBytes += bank.length;
      if (bankCopyBytes > MAX_BANK_COPY_BYTES) throw new RangeError('VGM exceeds the DAC data-bank concatenation budget');
      position += 7 + size;
    } else if (command >= 0x90 && command <= 0x95) {
      need(({0x90:5,0x91:5,0x92:6,0x93:11,0x94:2,0x95:5})[command]);
      const id = bytes[position + 1];
      if (id === 255 && command !== 0x94) throw new Error('DAC stream ID 255 is reserved for Stop all');
      if (command === 0x90) {
        if(!header.huc6280Clock)throw new Error('VGM streams an undeclared HuC6280 chip');
        const type = bytes[position + 2], port = bytes[position + 3], register = bytes[position + 4];
        if (type !== 0x1b) throw new Error('HuC6280 song playback supports first HuC6280 DAC streams (type 0x1b) only');
        if (port !== 255 && port > 7 || register > 9) throw new Error('Unsupported HuC6280 DAC stream destination');
        // The shared parser preserves bank/rate/start settings on a re-setup.
        const stream = streams.get(id) ?? {bank:0,step:1,base:0,frequency:0};
        stream.active = false; streams.set(id, stream); position += 5;
      } else if (command === 0x91) {
        const stream = getStream(id), step = bytes[position + 3];
        if (stream.active) throw new Error('HuC6280 reference playback requires stopping a DAC stream before changing its data bank or byte stride');
        if (!step || bytes[position + 2] > 0x3f) throw new Error('Unsupported HuC6280 DAC stream bank or zero byte stride');
        stream.bank = bytes[position + 2]; stream.step = step; stream.base = bytes[position + 4]; position += 5;
      } else if (command === 0x92) {
        const stream = getStream(id), frequency = view.getUint32(position + 2, true);
        if (frequency > 192000) throw new RangeError('HuC6280 DAC stream frequency exceeds 192000 Hz');
        stream.frequency = frequency; position += 6;
      } else if (command === 0x93) {
        start(getStream(id), view.getUint32(position + 2, true), bytes[position + 6], view.getUint32(position + 7, true)); position += 11;
      } else if (command === 0x94) {
        if (id === 255) {for (const stream of streams.values()) stream.active = false;}
        else getStream(id).active = false;
        position += 2;
      } else {
        const stream = getStream(id), bank = banks.get(stream.bank), block = bank?.blocks[view.getUint16(position + 2, true)];
        const flags = bytes[position + 4];
        if (flags & ~0x11) throw new Error('Unsupported HuC6280 fast DAC stream flags');
        if (!block) throw new Error('Fast DAC stream start references a missing data block');
        const length = Math.max(0, Math.floor((block.length - stream.base - 1) / stream.step) + 1);
        start(stream, block.offset, 1 | ((flags & 1) << 7) | (flags & 0x10), length); position += 5;
      }
      checkRates();
    } else throw new Error(`HuC6280 song playback does not support VGM command ${hex(command)}`);
    if (count % 4096 === 0) {await yieldTask(); check(signal);}
  }
  check(signal);
  if (!ended) throw new Error('VGM command stream has no end command');
  if (!writes || !totalSamples) throw new Error('VGM contains no timed HuC6280 / MSM5205 audio');
  return {bytes, header, totalSamples, metadata:parseVgmMetadata(bytes),
    warnings:[...(header.loopOffset ? ['Reference playback plays this VGM once; its loop is not repeated.'] : []),
      ...(hasMsm?['MSM5205 ADPCM is included. Seek replays from the beginning; paired seek checkpoints are unavailable. CD-DA is not contained in this VGM.']:[]),
      ...(!header.huc6280Clock?['This file contains MSM5205 only; HuC6280 channel controls have no recorded settings.']:[])]};
}
