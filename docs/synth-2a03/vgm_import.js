// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {createDefaultPreset, readPreset} from './preset.js';

export const MAX_VGM_BYTES = 64 * 1024 * 1024;
const MAX_COMMANDS = 4_000_000, MAX_VOICES = 4096, MAX_OBSERVATIONS = 100_000;
const DUTIES = [.125, .25, .5, .75];
const abort = signal => {if (signal?.aborted) throw new DOMException('VGM import cancelled', 'AbortError');};
const signed7 = value => ((value & 127) ^ 64) - 64;

async function decode(source, signal) {
  abort(signal);
  const bytes = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source) : null;
  if (!bytes) throw new TypeError('VGM source must be an ArrayBuffer or Uint8Array');
  if (bytes.length > MAX_VGM_BYTES) throw new RangeError('VGM/VGZ file exceeds 64 MiB');
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream !== 'function') throw new Error('VGZ requires browser gzip support');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const cancel = () => {void reader.cancel().catch(() => {});};
  signal?.addEventListener('abort', cancel, {once:true});
  const chunks = []; let size = 0;
  try {
    for (;;) {
      abort(signal); const {done, value} = await reader.read(); abort(signal);
      if (done) break;
      size += value.length;
      if (size > MAX_VGM_BYTES) {await reader.cancel(); throw new RangeError('Expanded VGZ exceeds 64 MiB');}
      chunks.push(value);
    }
  } finally {signal?.removeEventListener('abort', cancel); reader.releaseLock();}
  const result = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) {result.set(chunk, position); position += chunk.length;}
  return result;
}

/** Written start settings for keyboard audition, not a reconstruction of song
 * timing/counters. firstTime uses VGM's 44,100-sample timebase. Channel numbers
 * are CH1/2 Pulse, CH3 Triangle, CH4 Noise and CH6 FDS (DMC is not imported). */
export async function extractVgmInstruments(source, {signal} = {}) {
  let bytes = await decode(source, signal); abort(signal);
  if (bytes.length < 0x40) throw new Error('Truncated VGM header');
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eof = view.getUint32(4, true);
  if (eof && (eof + 4 < 0x40 || eof + 4 > bytes.length)) throw new Error('Invalid or truncated VGM file size');
  if (eof) {bytes = bytes.subarray(0, eof + 4); view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);}
  const warnings = new Set(['Initial settings only: original note pitch, length / linear counters and later register changes are not replayed.']);
  const parser = new Ym2612VGM(bytes, {logger:{warn:message => warnings.add(message)}});
  if (parser.header.dataOffset < 0x40 || parser.header.dataOffset >= bytes.length) throw new Error('Invalid VGM data offset');
  const rawClock = parser.header.nesApuClock, clock = rawClock & 0x3fffffff, hasFds = Boolean(rawClock & 0x80000000);
  if (!clock) throw new Error('This VGM contains no NES APU');
  if (rawClock & 0x40000000) throw new Error('Dual NES chips are not supported');
  if (clock !== 1789773) warnings.add('This VGM uses a different NES clock; imported voices play at the normal NTSC clock.');
  const regs = Array(0x80).fill(null), voices = [], definitions = new Map(), triggered = Array(4).fill(false);
  const wave = Array(64).fill(null);
  let modTable = Array(32).fill(null), modIndex = 0, modIndexKnown = true, modRun = [], phaseApproximate = false;
  let fixedGain = null, fixedDepth = null, time = 0, observations = 0;
  const dmcWarning = () => warnings.add('Recorded DMC sample / direct PCM data is not imported by this version.');
  function add(kind, channel, settings, notes = []) {
    if (++observations > MAX_OBSERVATIONS) throw new Error('VGM import exceeds 100,000 voice observations');
    const preset = createDefaultPreset(); preset.source = kind;
    if (kind !== 'triangle') preset[kind] = settings;
    const key = JSON.stringify([kind, channel, kind === 'triangle' ? null : preset[kind]]);
    const existing = definitions.get(key);
    for (const note of notes) warnings.add(note);
    if (existing) {
      existing.occurrences++;
      existing.warnings = [...new Set([...existing.warnings, ...notes])]; return;
    }
    if (voices.length >= MAX_VOICES) throw new Error('VGM import exceeds 4,096 different voices');
    const id = voices.length + 1;
    preset.name = `${kind === 'fds' ? 'FDS' : kind[0].toUpperCase() + kind.slice(1) + ' CH' + channel} · ${id}`;
    const voice = {id, kind, channel, firstTime:time, occurrences:1, preset:readPreset(preset), warnings:[...new Set(notes)]};
    definitions.set(key, voice); voices.push(voice);
  }
  function enabled(channel, notes) {
    if (regs[0x15] === null) {notes.push('NES channel enable state was not recorded; this voice assumes it is enabled.'); return true;}
    return Boolean(regs[0x15] & (1 << channel));
  }
  function captureApu(register) {
    const channel = register === 3 ? 0 : register === 7 ? 1 : register === 0x0b ? 2 : 3, notes = [];
    if (!triggered[channel]) return;
    if (!enabled(channel, notes)) return;
    const base = channel * 4, control = regs[base];
    if (control === null || (channel === 3 && regs[0x0e] === null)) {
      warnings.add('NES triggers with unknown voice settings are omitted.'); return;
    }
    if (channel < 3 && regs[base + 2] !== null && (regs[base + 2] | ((regs[register] & 7) << 8)) < 8) return;
    if (channel < 2) {
      const usesEnvelope = !(control & 16), level = control & 15;
      if (!usesEnvelope && !level) return;
      const sweep = regs[base + 1];
      if (sweep === null) notes.push('Pulse Sweep was not recorded; imported Sweep is disabled.');
      add('pulse', channel + 1, {
        duty:DUTIES[control >> 6], volume:usesEnvelope ? 15 : level,
        envelope:{enabled:usesEnvelope, period:level, loop:Boolean(control & 32)},
        sweep:sweep === null ? {enabled:false, period:0, negate:true, shift:0}
          : {enabled:Boolean(sweep & 128), period:(sweep >> 4) & 7, negate:Boolean(sweep & 8), shift:sweep & 7},
      }, notes);
    } else if (channel === 2) {
      if (!(control & 127)) return;
      notes.push('Triangle length / linear-counter timing is replaced by the Synth keyboard gate.');
      add('triangle', 3, null, notes);
    } else {
      const usesEnvelope = !(control & 16), level = usesEnvelope ? 15 : control & 15;
      if (!level) return;
      if (usesEnvelope) notes.push('Noise hardware Envelope is approximated by fixed volume 15; its timed decay / loop is not imported.');
      add('noise', 4, {volume:level, period:regs[0x0e] & 15, shortMode:Boolean(regs[0x0e] & 128)}, notes);
    }
  }
  function fdsAudible() {
    if (regs[0x3f] !== null && !(regs[0x3f] & 2)) return false;
    if (regs[0x23] === null || regs[0x23] & 128 || regs[0x29] !== null && regs[0x29] & 128) return false;
    if (regs[0x22] === null || !(regs[0x22] | ((regs[0x23] & 15) << 8))) return false;
    if (regs[0x20] === null) return false;
    if (regs[0x20] & 128) return fixedGain > 0;
    const envelopeRuns = !(regs[0x23] & 64) && regs[0x2a] !== 0;
    return Boolean(fixedGain > 0 || fixedGain === null || regs[0x20] & 64 && envelopeRuns);
  }
  function captureFds() {
    if (!fdsAudible()) return;
    if (wave.some(value => value === null)) {warnings.add('FDS voices with incomplete or unwritten Wave RAM are omitted.'); return;}
    if (wave.every(value => value === wave[0])) {warnings.add('Constant FDS Wave RAM produces no pitched waveform and is omitted.'); return;}
    const notes = [];
    if (regs[0x3f] === null) notes.push('FDS I/O enable state was not recorded; this voice assumes it is enabled.');
    let volume = Math.min(fixedGain ?? 32, 32);
    if (!(regs[0x20] & 128)) {
      if (!volume && regs[0x20] & 64) volume = 32;
      notes.push(`FDS volume Envelope is approximated by fixed volume ${volume}; Envelope timing is not replayed.`);
    }
    if (!volume) return;
    const master = regs[0x29] === null ? 0 : regs[0x29] & 3;
    if (regs[0x29] === null) notes.push('FDS master scale was not recorded; imported voices use 100%.');
    const modulationEnabled = regs[0x27] !== null && !(regs[0x27] & 128);
    let modulation = {enabled:false, table:Array(32).fill(0), rate:0, depth:0, bias:0};
    if (regs[0x27] === null) notes.push('FDS modulation enable state was not recorded; imported modulation is disabled.');
    if (modulationEnabled) {
      if (modTable.some(value => value === null) || regs[0x26] === null || regs[0x24] === null) {
        warnings.add('FDS voices with enabled but incomplete modulation settings / table are omitted.'); return;
      }
      let depth = fixedDepth ?? 32;
      if (!(regs[0x24] & 128)) {
        if (!depth && regs[0x24] & 64) depth = 32;
        notes.push(`FDS modulation Envelope is approximated by fixed depth ${depth}; Envelope timing is not replayed.`);
      }
      if (regs[0x25] === null) notes.push('FDS modulation bias was not recorded; imported bias starts at zero.');
      notes.push('FDS modulation phase / counter progress is restarted for audition; the last recorded bias is used.');
      if (phaseApproximate) notes.push('FDS modulation-table starting phase was unknown; a complete halted write cycle is imported in its written order.');
      modulation = {enabled:true, table:[...modTable], rate:regs[0x26] | ((regs[0x27] & 15) << 8), depth, bias:regs[0x25] === null ? 0 : signed7(regs[0x25])};
      if (regs[0x27] & 64) notes.push('FDS forced modulation stepping is not represented by the imported preset.');
    } else if (modTable.every(value => value !== null)) {
      // Retain an authored table and settings even while disabled, so users
      // can enable the recorded effect rather than a factory waveform.
      modulation = {enabled:false, table:[...modTable], rate:(regs[0x26] ?? 0) | (((regs[0x27] ?? 0) & 15) << 8), depth:fixedDepth ?? 0, bias:regs[0x25] === null ? 0 : signed7(regs[0x25])};
    } else notes.push('FDS modulation table was not completely recorded while disabled; the imported disabled effect uses a neutral table.');
    add('fds', 6, {wave:[...wave], volume, master, modulation}, notes);
  }
  function apply(register, value) {
    if (register < 0x20) {
      const channel = [0,4,8,12].includes(register) ? register / 4 : -1;
      const wasAudible = channel >= 0 && apuAudible(channel);
      regs[register] = value;
      if (register >= 0x10 && register <= 0x13 || register === 0x15 && value & 16) dmcWarning();
      if (register === 0x15) for (let ch = 0; ch < 4; ch++) if (!(value & (1 << ch))) triggered[ch] = false;
      if ([3, 7, 0x0b, 0x0f].includes(register)) {
        const ch = (register - 3) / 4;
        triggered[ch] = regs[0x15] === null || Boolean(regs[0x15] & (1 << ch));
        captureApu(register);
      } else if (channel >= 0 && !wasAudible && apuAudible(channel)) captureApu(channel * 4 + 3);
      return;
    }
    if (!hasFds) throw new Error('FDS writes require the FDS header flag');
    const wasAudible = fdsAudible();
    if (register === 0x3f) {regs[register] = value; if (value & 2) captureFds(); return;}
    if (regs[0x3f] !== null && !(regs[0x3f] & 2)) return;
    if (register >= 0x40 && register <= 0x7f) {
      if (regs[0x29] !== null && regs[0x29] & 128) wave[register - 0x40] = value & 63;
      else warnings.add('FDS Wave RAM writes without a recorded enabled write gate are ignored.');
      return;
    }
    if (register < 0x20 || register > 0x2a) return;
    if (register === 0x28) {
      if (regs[0x27] !== null && regs[0x27] & 128) {
        if (modIndexKnown) {modTable[modIndex] = value & 7; modIndex = (modIndex + 1) % 32;}
        else {
          if (!modRun.length) modTable.fill(null);
          modRun.push(value & 7);
          if (modRun.length === 32) {modTable = modRun; modRun = []; modIndex = 0; modIndexKnown = true; phaseApproximate = true;}
        }
      } else warnings.add('FDS modulation-table writes without a recorded halted modulation clock are ignored.');
      return;
    }
    const previous = regs[register]; regs[register] = value;
    if (register === 0x20 && value & 128) fixedGain = value & 63;
    if (register === 0x24 && value & 128) fixedDepth = value & 63;
    if (register === 0x27 && previous !== null && (previous & 128) !== (value & 128)) modRun = [];
    // A frequency-high write marks the next note/setup. Gate restoration and
    // zero-to-audible software attacks are also useful capture boundaries.
    if (register === 0x23 || register === 0x29 && !(value & 128)
        || !wasAudible && fdsAudible()
        || register === 0x27 && !(value & 128) && (previous === null || previous & 128)) captureFds();
  }
  function apuAudible(channel) {
    if (!triggered[channel] || regs[0x15] !== null && !(regs[0x15] & (1 << channel))) return false;
    const control = regs[channel * 4];
    if (control === null) return false;
    return channel === 2 ? Boolean(control & 127) : !(control & 16) || Boolean(control & 15);
  }
  function advance(samples) {
    time += samples;
    // Modulation clocks independently of output gain, wave-write mode and
    // base pitch. With no cycle emulation the write pointer becomes unknown,
    // including during DAC+wait commands and inaudible note setup.
    if (samples && hasFds && (regs[0x23] === null || !(regs[0x23] & 128)) && regs[0x27] !== null && !(regs[0x27] & 128)
        && (regs[0x26] === null || (regs[0x26] | ((regs[0x27] & 15) << 8)) || regs[0x27] & 64)) {
      modIndexKnown = false; phaseApproximate = true; modRun = [];
    }
  }
  for (let count = 0; ; count++) {
    abort(signal);
    if (count >= MAX_COMMANDS) throw new Error('VGM import exceeds four million commands');
    const position = parser.position, command = bytes[position];
    if (position >= bytes.length) throw new Error('Unexpected end of VGM data');
    let length;
    try {length = rawCommandLength(bytes, view, position);}
    catch (error) {if (error instanceof RangeError) throw new Error('Truncated VGM command', {cause:error}); throw error;}
    if (position + length > bytes.length) throw new Error('Truncated VGM command');
    if ((command === 0x67 || command === 0x68) && bytes[position + 1] !== 0x66) throw new Error('Invalid VGM data block header');
    if (command === 0x67 && bytes[position + 2] === 0xc2) {
      const rawSize = view.getUint32(position + 3, true), size = rawSize & 0x7fffffff;
      if (rawSize & 0x80000000) throw new Error('Second NES chip sample data is not supported');
      if (size < 2) throw new Error('Invalid NES RAM block header');
      if (view.getUint16(position + 7, true) + size - 2 > 65536) throw new Error('Invalid NES RAM block range');
      dmcWarning();
    }
    if (command >= 0x80 && command <= 0x8f) {parser.position++; advance(command & 15);}
    else if (command !== 0xb4 && command !== 0x61 && command !== 0x62 && command !== 0x63 && command !== 0x66 && !(command >= 0x70 && command <= 0x7f)) {
      if (command === 0x90 && (bytes[position + 2] & 0x7f) === 0x14) warnings.add('NES DAC stream writes are not imported; only direct register writes are supported.');
      parser.position += length;
    }
    else {
      const event = parser.step();
      if (event.type === 'end') break;
      if (event.type === 'wait') advance(event.samples);
      else {
        if (event.chipIndex) throw new Error('Second NES chip writes are not supported');
        apply(event.register, event.value);
      }
    }
    if (count % 4096 === 4095) await new Promise(resolve => setTimeout(resolve, 0));
  }
  abort(signal);
  if (!voices.length) throw new Error('No complete, playable NES / FDS voices found in this VGM; DMC-only data is not imported.');
  return {voices, warnings:[...warnings], metadata:parseVgmMetadata(bytes), timebase:44100};
}
