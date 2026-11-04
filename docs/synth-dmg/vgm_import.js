// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {createGameboyVoices} from '../vgm_analyzer/gameboy_voices.js';
import {createGameboyWaves} from '../vgm_analyzer/gameboy_waves.js';
import {createDefaultPreset, readPreset} from './preset.js';

export const MAX_VGM_BYTES = 64 * 1024 * 1024;
const MAX_COMMANDS = 4_000_000, MAX_VOICES = 4096, MAX_TRIGGERS = 100_000;
const checkAbort = signal => {if (signal?.aborted) throw new DOMException('VGM import cancelled', 'AbortError');};

async function decode(source, signal) {
  checkAbort(signal);
  const bytes = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source) : null;
  if (!bytes) throw new TypeError('VGM source must be an ArrayBuffer or Uint8Array');
  if (bytes.length > MAX_VGM_BYTES) throw new RangeError('VGM/VGZ file exceeds 64 MiB');
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== 'function') throw new Error('VGZ requires browser gzip support');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const cancel = () => {void reader.cancel().catch(() => {});};
  signal?.addEventListener('abort', cancel, {once: true});
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      checkAbort(signal);
      const {value, done} = await reader.read();
      checkAbort(signal);
      if (done) break;
      length += value.length;
      if (length > MAX_VGM_BYTES) {
        await reader.cancel();
        throw new RangeError('Expanded VGZ exceeds 64 MiB');
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {result.set(chunk, position); position += chunk.length;}
  return result;
}

/** Extract initial Game Boy trigger settings. Notes, length counters, master
 * volume and later automation are intentionally left to the performer.
 * firstTime is in VGM's 44,100-sample timebase; channel numbers are CH1–CH4. */
export async function extractVgmInstruments(source, {signal} = {}) {
  let bytes = await decode(source, signal);
  checkAbort(signal);
  if (bytes.length < 0x40) throw new Error('Truncated VGM header');
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eof = view.getUint32(4, true);
  if (eof && (eof + 4 > bytes.length || eof + 4 < 0x40)) throw new Error('Invalid or truncated VGM file size');
  if (eof) {bytes = bytes.subarray(0, eof + 4); view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);}
  const warnings = new Set();
  const parser = new Ym2612VGM(bytes, {logger: {warn: message => warnings.add(message)}});
  if (parser.header.dataOffset < 0x40 || parser.header.dataOffset >= bytes.length) throw new Error('Invalid VGM data offset');
  const clock = parser.header.gameBoyDmgClock;
  if (!(clock & 0x3fffffff)) throw new Error('This VGM contains no Game Boy DMG chip');
  if (clock & 0xc0000000) throw new Error('Dual or variant Game Boy chips are not supported');
  if (clock !== 4194304) warnings.add('This file uses a different Game Boy clock; imported settings play at the normal DMG clock.');
  const pulseNoise = createGameboyVoices(), waves = createGameboyWaves();
  const registers = Array(23).fill(null), voices = [], definitions = new Map();
  let time = 0, triggers = 0;
  function add(kind, channel, settings, sweep = null) {
    if (registers[22] !== null && !(registers[22] & 0x80)) return;
    if (registers[22] === null) warnings.add('APU power was not recorded; imported voices assume it is enabled.');
    const pan = registers[21] === null ? {left: true, right: true}
      : {left: Boolean(registers[21] & (1 << (channel + 3))), right: Boolean(registers[21] & (1 << (channel - 1)))};
    if (!pan.left && !pan.right) return;
    if (registers[21] === null) warnings.add('Stereo routing was not recorded; imported voices use both outputs.');
    const preset = createDefaultPreset();
    preset.source = kind; preset.pan = pan;
    if (kind === 'pulse') {
      Object.assign(preset.pulse, settings);
      preset.pulse.sweep = sweep ? {...sweep, enabled: sweep.period !== 0 || sweep.shift !== 0}
        : {enabled: false, direction: 'up', period: 0, shift: 0};
      if (channel === 1 && !sweep) warnings.add('CH1 Sweep was not recorded; imported voices disable Sweep.');
    } else if (kind === 'noise') preset.noise = settings;
    else preset.wave = settings;
    const key = JSON.stringify([channel, kind, preset[kind], pan]);
    const existing = definitions.get(key);
    if (existing) {existing.occurrences++; return;}
    if (voices.length >= MAX_VOICES) throw new Error('VGM import exceeds 4,096 different voices');
    const id = voices.length + 1;
    preset.name = `${kind[0].toUpperCase() + kind.slice(1)} CH${channel} · ${id}`;
    const voice = {id, kind, channel, firstTime: time, occurrences: 1, preset: readPreset(preset)};
    voices.push(voice); definitions.set(key, voice);
  }
  for (let count = 0; ; count++) {
    checkAbort(signal);
    if (count >= MAX_COMMANDS) throw new Error('VGM import exceeds four million commands');
    const position = parser.position, command = bytes[position];
    if (position >= bytes.length) throw new Error('Unexpected end of VGM data');
    // Only DMG writes and waits are needed. Skip other chips and their sample
    // blocks by validated raw length, avoiding unrelated PCM decompression and
    // the parser's recursive handling of long runs of ignored commands.
    let length;
    try {length = rawCommandLength(bytes, view, position);}
    catch (error) {
      if (error instanceof RangeError) throw new Error('Truncated VGM command', {cause: error});
      throw error;
    }
    if (position + length > bytes.length) throw new Error('Truncated VGM command');
    if ((command === 0x67 || command === 0x68) && bytes[position + 1] !== 0x66) throw new Error('Invalid VGM data block header');
    if (command >= 0x80 && command <= 0x8f) {parser.position++; time += command & 15;}
    else if (command !== 0xb3 && command !== 0x61 && command !== 0x62 && command !== 0x63 && command !== 0x66 && !(command >= 0x70 && command <= 0x7f)) {
      if (command === 0x90 && (bytes[position + 2] & 0x7f) === 0x13) warnings.add('Game Boy DAC stream writes are not imported; only direct register writes are supported.');
      parser.position += length;
    } else {
      const event = parser.step();
      if (event.type === 'end') break;
      if (event.type === 'wait') time += event.samples;
      else {
        if (event.chipIndex) throw new Error('Second Game Boy chip writes are not supported');
        const {register, value} = event;
        if (register < registers.length) registers[register] = value;
        if (register === 22 && !(value & 0x80)) registers.fill(null, 0, 22);
        pulseNoise.apply(event, time);
        waves.apply(event, time);
        const isTrigger = [4, 9, 14, 19].includes(register) && Boolean(value & 0x80);
        if (isTrigger) {
          if (++triggers > MAX_TRIGGERS) throw new Error('VGM import exceeds 100,000 triggers');
          for (const occurrence of pulseNoise.events.splice(0)) {
            if (!occurrence.dacEnabled) continue;
            const sample = pulseNoise.samples[occurrence.sampleId - 1];
            add(sample.kind, sample.channel, sample.voice, sample.sweep);
          }
          // End unused interval tracking immediately: we import settings only,
          // so later writes must not accumulate per-note automation in memory.
          pulseNoise.finish(time);
          for (const observation of waves.events.splice(0)) {
            if (registers[10] !== null && !(registers[10] & 0x80)) continue;
            if (registers[12] === null) {warnings.add('Wave triggers with unknown output level are omitted.'); continue;}
            const level = [0, 1, 0.5, 0.25][(registers[12] >> 5) & 3];
            if (!level) continue;
            if (registers[10] === null) warnings.add('Wave DAC state was not recorded; imported voices assume it is enabled.');
            const sample = waves.samples[observation.sampleId - 1];
            add('wave', 3, {samples: sample.waveform, level});
          }
          if (pulseNoise.samples.length > MAX_VOICES || waves.samples.length > MAX_VOICES) throw new Error('VGM import exceeds 4,096 different voice definitions');
        }
      }
    }
    if (count % 4096 === 4095) await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkAbort(signal);
  for (const message of [...pulseNoise.warnings, ...waves.warnings]) warnings.add(message);
  if (!voices.length) throw new Error('No complete, audible Game Boy voices found in this VGM');
  return {voices, warnings: [...warnings], metadata: parseVgmMetadata(bytes), timebase: 44100};
}
