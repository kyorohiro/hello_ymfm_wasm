// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';
import {looksLikeGzip, parseVgmMetadata} from '../js/vgm_file.js';
import {validateAy8910} from '../js/ay8910.js';

export const YM_VGM_LIMITS = Object.freeze({
  sourceBytes: 16 * 1024 * 1024,
  expandedBytes: 32 * 1024 * 1024,
  commands: 2000000,
  writes: 1000000,
  durationFrames: 0xffffffff,
});

export function checkYmVgmAbort(signal) {
  if (signal?.aborted) throw new DOMException('YM VGM loading cancelled', 'AbortError');
}
const fail = message => { throw new Error(`YM VGM: ${message}`); };
const hex = value => `0x${value.toString(16)}`;
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

/** Read owned bytes, bounding VGZ expansion before retaining each gzip chunk. */
export async function decodeYmVgmFile(source, {signal} = {}) {
  checkYmVgmAbort(signal);
  const bytes = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source) : null;
  if (!bytes) throw new TypeError('VGM source must be an ArrayBuffer or Uint8Array');
  if (bytes.length > YM_VGM_LIMITS.sourceBytes) throw new RangeError('VGM / VGZ exceeds 16 MiB');
  if (!looksLikeGzip(bytes)) return bytes.slice();
  if (typeof DecompressionStream !== 'function') fail('VGZ requires gzip support via DecompressionStream');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, {once: true});
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      checkYmVgmAbort(signal);
      const {done, value} = await reader.read();
      checkYmVgmAbort(signal);
      if (done) break;
      length += value.length;
      if (length > YM_VGM_LIMITS.expandedBytes) {
        await reader.cancel();
        throw new RangeError('Expanded VGZ exceeds 32 MiB');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

// Full VGM chip-clock table, including declarations not exposed by the shared
// parser. An unimplemented companion must not silently disappear from playback.
const CLOCK_OFFSETS = [0x0c,0x10,0x2c,0x30,0x38,0x40,0x44,0x48,0x4c,0x50,0x54,0x58,0x5c,0x60,0x64,0x68,0x6c,0x70,0x74,0x80,0x84,0x88,0x8c,0x90,0x98,0x9c,0xa0,0xa4,0xa8,0xac,0xb0,0xb4,0xb8,0xc0,0xc4,0xc8,0xcc,0xd0,0xd8,0xdc,0xe0,0xe4,0xe8,0xec,0xf0,0xf4,0xf8,0xfc];

function validateHeader(parser) {
  const {bytes, view, header} = parser;
  const declaredEnd = view.getUint32(4, true);
  const end = declaredEnd ? declaredEnd + 4 : bytes.length;
  if (header.version < 0x151 || header.dataOffset < 0x7a || header.dataOffset >= end || end > bytes.length)
    fail('invalid AY header, data offset or EOF offset');
  if (header.ay8910Clock & 0xc0000000) fail('multiple AY chips and clock variants are unsupported');
  if (!header.ay8910Clock) fail('requires a single AY8910 / YM2149 chip clock');
  validateAy8910({clock: header.ay8910Clock, type: header.ay8910Type, flags: header.ay8910Flags});
  for (const offset of CLOCK_OFFSETS) {
    if (offset !== 0x74 && offset + 4 <= header.dataOffset && view.getUint32(offset, true))
      fail(`mixed-chip clock at header ${hex(offset)} is unsupported`);
  }
  if (0xc0 <= header.dataOffset && view.getUint32(0xbc, true))
    fail('extra-header chip clock / volume overrides are unsupported');
  return end;
}

/** Prepare one pass of raw AY register writes on the 44100 Hz VGM timeline.
 * Repeated writes, including envelope-shape restarts at R13, remain distinct.
 * DAC streams and commands for other chips are rejected before parser.step()
 * can skip them. Loading performs no audio-device operations.
 */
export async function readYmVgmSource(input, {signal, name = ''} = {}) {
  const bytes = await decodeYmVgmFile(input, {signal});
  checkYmVgmAbort(signal);
  if (bytes.length < 0x40) fail('truncated VGM header');
  const parser = new Ym2612VGM(bytes, {logger: null});
  const end = validateHeader(parser), events = [];
  let time = 0, commands = 0, ended = false;
  while (parser.position < end) {
    if (++commands > YM_VGM_LIMITS.commands) fail('command count exceeds 2000000');
    if (commands % 8192 === 0) { await yieldTask(); checkYmVgmAbort(signal); }
    const position = parser.position, command = bytes[position];
    if (![0xa0,0x61,0x62,0x63,0x66].includes(command) && !(command >= 0x70 && command <= 0x7f))
      fail(`unsupported command ${hex(command)}; reference playback supports raw AY writes and waits`);
    const length = rawCommandLength(bytes, parser.view, position);
    if (position + length > end) fail('truncated command stream');
    const event = parser.step();
    if (event.type === 'end') { ended = true; break; }
    if (event.type === 'wait') {
      time += event.samples;
      if (time > YM_VGM_LIMITS.durationFrames) fail('duration exceeds the 0xffffffff-frame limit');
    } else {
      if (event.chipIndex) fail('second AY chip writes are unsupported');
      if (event.register > 15) fail('AY register must be 0..15');
      if (events.length >= YM_VGM_LIMITS.writes) fail('write count exceeds 1000000');
      events.push({time, register: event.register, value: event.value});
    }
  }
  if (!ended) fail('missing end command');
  if (!events.length) fail('no AY register writes were found');
  checkYmVgmAbort(signal);
  const gd3 = parseVgmMetadata(bytes) ?? {};
  const metadata = {...gd3, title: gd3.trackName || gd3.trackNameOriginal || String(name).replace(/\.(vgm|vgz)$/i, '') || 'AY reference', author: gd3.author || gd3.authorOriginal || ''};
  return {
    format: 'vgm', bytes, name: String(name), clock: parser.header.ay8910Clock,
    type: parser.header.ay8910Type, flags: parser.header.ay8910Flags,
    header: {...parser.header}, trace: {events, time, clock: parser.header.ay8910Clock},
    metadata, subsongCount: 1, defaultSubsong: 1, durationFrames: time, totalSamples: time,
    warnings: ['One-pass AY playback. VGM loops are not repeated.'],
  };
}
