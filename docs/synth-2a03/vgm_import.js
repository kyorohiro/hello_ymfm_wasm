// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {createDmcCapture} from './vgm_dmc.js';

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
 * are CH1/2 Pulse, CH3 Triangle, CH4 Noise, CH5 DMC and CH6 FDS. */
export async function extractVgmInstruments(source, {signal} = {}) {
  let bytes = await decode(source, signal); abort(signal);
  if (bytes.length < 0x40) throw new Error('Truncated VGM header');
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eof = view.getUint32(4, true);
  if (eof && (eof + 4 < 0x40 || eof + 4 > bytes.length)) throw new Error('Invalid or truncated VGM file size');
  if (eof) {bytes = bytes.subarray(0, eof + 4); view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);}
  const warnings = new Set(['Initial settings only: original note pitch, elapsed counters / frame phase and later register changes are not replayed.']);
  const parser = new Ym2612VGM(bytes, {logger:{warn:message => warnings.add(message)}});
  if (parser.header.dataOffset < 0x40 || parser.header.dataOffset >= bytes.length) throw new Error('Invalid VGM data offset');
  const rawClock = parser.header.nesApuClock, clock = rawClock & 0x3fffffff, hasFds = Boolean(rawClock & 0x80000000);
  if (!clock) throw new Error('This VGM contains no NES APU');
  if (rawClock & 0x40000000) throw new Error('Dual NES chips are not supported');
  if (clock !== 1789773) warnings.add('This VGM uses a different NES clock; imported voices play at the normal NTSC clock.');
  const regs = Array(0x80).fill(null), voices = [], definitions = new Map(), triggered = Array(4).fill(false);
  const wave = Array(64).fill(null);
  let modTable = Array(32).fill(null), modIndex = 0, modIndexKnown = true, modRun = [], phaseApproximate = false;
  let fixedGain = null, gainProgressed = false, fixedDepth = null, depthProgressed = false, time = 0, observations = 0, dmcSnapshotBytes = 0;
  const dmc = createDmcCapture({clock, onVoice:(settings, notes) => add('dmc', 5, settings, notes),
    onWarning:message => warnings.add(message), onVoiceWarning:(voice, message) => {
      if (!voice.warnings.includes(message)) voice.warnings.push(message);
    }});
  const dpcmChunks = [], streamTargets = new Map(), activeNesStreams = new Set();
  let dpcmBankSize = 0, dpcmBankUnknown = false;
  function add(kind, channel, settings, notes = []) {
    if (++observations > MAX_OBSERVATIONS) throw new Error('VGM import exceeds 100,000 voice observations');
    const preset = createDefaultPreset(); preset.source = kind;
    preset[kind] = settings;
    const key = JSON.stringify([kind, channel, preset[kind]]);
    const existing = definitions.get(key);
    for (const note of notes) warnings.add(note);
    if (existing) {
      existing.occurrences++;
      existing.warnings = [...new Set([...existing.warnings, ...notes])]; return existing;
    }
    if (voices.length >= MAX_VOICES) throw new Error('VGM import exceeds 4,096 different voices');
    if (kind === 'dmc') {
      dmcSnapshotBytes += settings.data.length;
      if (dmcSnapshotBytes > 8 * 1024 * 1024) throw new Error('VGM import exceeds 8 MiB of different DMC sample data');
    }
    const id = voices.length + 1;
    preset.name = `${kind === 'fds' ? 'FDS' : kind === 'dmc' ? 'DMC CH5' : kind[0].toUpperCase() + kind.slice(1) + ' CH' + channel} · ${id}`;
    const voice = {id, kind, channel, firstTime:time, occurrences:1, preset:readPreset(preset), warnings:[...new Set(notes)]};
    definitions.set(key, voice); voices.push(voice); return voice;
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
      notes.push('Pulse Length Counter restarts from the recorded length-table index on each keyboard note; original elapsed counter state / frame phase is not replayed.');
      add('pulse', channel + 1, {
        duty:DUTIES[control >> 6], volume:usesEnvelope ? 15 : level,
        lengthHalt:Boolean(control & 32), lengthIndex:regs[register] >> 3,
        envelope:{enabled:usesEnvelope, period:level, loop:Boolean(control & 32)},
        sweep:sweep === null ? {enabled:false, period:0, negate:true, shift:0}
          : {enabled:Boolean(sweep & 128), period:(sweep >> 4) & 7, negate:Boolean(sweep & 8), shift:sweep & 7},
      }, notes);
    } else if (channel === 2) {
      if (!(control & 127)) return;
      notes.push('Triangle counters restart from the recorded reload settings on each keyboard note; original elapsed counter state / frame phase is not replayed.');
      add('triangle', 3, {control:Boolean(control & 128), linearReload:control & 127, lengthIndex:regs[0x0b] >> 3}, notes);
    } else {
      const usesEnvelope = !(control & 16), parameter = control & 15;
      if (!usesEnvelope && !parameter) return;
      notes.push('Noise Length Counter restarts from the recorded length-table index on each keyboard note; original elapsed counter state / frame phase is not replayed.');
      add('noise', 4, {
        volume:usesEnvelope ? 15 : parameter, period:regs[0x0e] & 15, shortMode:Boolean(regs[0x0e] & 128),
        lengthHalt:Boolean(control & 32), lengthIndex:regs[0x0f] >> 3,
        envelope:{enabled:usesEnvelope, period:parameter, loop:Boolean(control & 32)},
      }, notes);
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
    const volume = Math.min(fixedGain ?? 32, 32), envelopeEnabled = !(regs[0x20] & 128), increase = Boolean(regs[0x20] & 64);
    const initialGain = fixedGain ?? (increase ? 0 : 32);
    if (envelopeEnabled && fixedGain === null) notes.push(gainProgressed
      ? `FDS volume Envelope clock had already run; audition restarts from approximate gain ${initialGain} instead of its unknown current gain / timer phase.`
      : `FDS volume Envelope initial gain was not recorded; audition starts from approximate gain ${initialGain}.`);
    const envelope = {enabled:envelopeEnabled, increase, period:regs[0x20] & 63, initialGain};
    const envelopeClock = {masterSpeed:regs[0x2a] ?? 232,halt:Boolean(regs[0x23] & 64)};
    const master = regs[0x29] === null ? 0 : regs[0x29] & 3;
    if (regs[0x29] === null) notes.push('FDS master scale was not recorded; imported voices use 100%.');
    const modulationEnabled = regs[0x27] !== null && !(regs[0x27] & 128);
    const depthEnvelope = regs[0x24] === null ? {enabled:false,increase:true,period:8,initialGain:0}
      : {enabled:!(regs[0x24]&128),increase:Boolean(regs[0x24]&64),period:regs[0x24]&63,
        initialGain:fixedDepth??(regs[0x24]&64?0:32)};
    if (depthEnvelope.enabled && fixedDepth === null) notes.push(depthProgressed
      ? `FDS modulation Envelope clock had already run; audition restarts from approximate gain ${depthEnvelope.initialGain} instead of its unknown current gain / timer phase.`
      : `FDS modulation Envelope initial gain was not recorded; audition starts from approximate gain ${depthEnvelope.initialGain}.`);
    if ((envelope.enabled||depthEnvelope.enabled)&&regs[0x2a]===null) notes.push('FDS master Envelope speed was not recorded; imported envelopes use 232.');
    let modulation = {enabled:false, table:Array(32).fill(0), rate:0, depth:0, bias:0,envelope:depthEnvelope};
    if (regs[0x27] === null) notes.push('FDS modulation enable state was not recorded; imported modulation is disabled.');
    if (modulationEnabled) {
      if (modTable.some(value => value === null) || regs[0x26] === null || regs[0x24] === null) {
        warnings.add('FDS voices with enabled but incomplete modulation settings / table are omitted.'); return;
      }
      const depth = fixedDepth ?? 32;
      if (regs[0x25] === null) notes.push('FDS modulation bias was not recorded; imported bias starts at zero.');
      notes.push('FDS modulation phase / counter progress is restarted for audition; the last recorded bias is used.');
      if (phaseApproximate) notes.push('FDS modulation-table starting phase was unknown; a complete halted write cycle is imported in its written order.');
      modulation = {enabled:true, table:[...modTable], rate:regs[0x26] | ((regs[0x27] & 15) << 8), depth, bias:regs[0x25] === null ? 0 : signed7(regs[0x25]),envelope:depthEnvelope};
      if (regs[0x27] & 64) notes.push('FDS forced modulation stepping is not represented by the imported preset.');
    } else if (modTable.every(value => value !== null)) {
      // Retain an authored table and settings even while disabled, so users
      // can enable the recorded effect rather than a factory waveform.
      modulation = {enabled:false, table:[...modTable], rate:(regs[0x26] ?? 0) | (((regs[0x27] ?? 0) & 15) << 8), depth:fixedDepth ?? 0, bias:regs[0x25] === null ? 0 : signed7(regs[0x25]),envelope:depthEnvelope};
    } else notes.push('FDS modulation table was not completely recorded while disabled; the imported disabled effect uses a neutral table.');
    add('fds', 6, {wave:[...wave], volume, master, envelope,envelopeClock, modulation}, notes);
  }
  function apply(register, value) {
    if (register < 0x20) {
      const channel = [0,4,8,12].includes(register) ? register / 4 : -1;
      const previous = regs[register]; regs[register] = value;
      dmc.write(register, value);
      if (register === 0x15) for (let ch = 0; ch < 4; ch++) if (!(value & (1 << ch))) triggered[ch] = false;
      if ([3, 7, 0x0b, 0x0f].includes(register)) {
        const ch = (register - 3) / 4;
        triggered[ch] = regs[0x15] === null || Boolean(regs[0x15] & (1 << ch));
        captureApu(register);
      // Control writes can change the shared Envelope-loop / Length-halt bit
      // without retriggering. Keep those authored settings after a recorded
      // enabled trigger; captureApu still rejects unknown or silent setups.
      } else if (channel >= 0 && previous !== value) captureApu(channel * 4 + 3);
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
    if (register === 0x20 && value & 128) {fixedGain = value & 63; gainProgressed = false;}
    if (register === 0x24 && value & 128) {fixedDepth = value & 63;depthProgressed = false;}
    if (register === 0x27 && previous !== null && (previous & 128) !== (value & 128)) modRun = [];
    // A frequency-high write marks the next note/setup. Gate restoration and
    // zero-to-audible software attacks are also useful capture boundaries.
    if (register === 0x20 || register === 0x24 || register === 0x2a || register === 0x23 || register === 0x29 && !(value & 128)
        || !wasAudible && fdsAudible()
        || register === 0x27 && !(value & 128) && (previous === null || previous & 128)) captureFds();
  }
  function advance(samples) {
    time += samples;
    dmc.advance(samples);
    // Keep explicitly seeded gains exact while frozen or at an invariant
    // endpoint. Without emulating the Envelope divider, any elapsed running
    // Envelope otherwise makes its current gain / timer phase unknown.
    if (samples&&hasFds&&(regs[0x23]===null||!(regs[0x23]&64))&&regs[0x2a]!==0) {
      if(regs[0x20]!==null&&!(regs[0x20]&128)&&(fixedGain===null||(regs[0x20]&64?fixedGain<32:fixedGain>0))) {
        fixedGain=null;gainProgressed=true;
      }
      if(regs[0x24]!==null&&!(regs[0x24]&128)&&(fixedDepth===null||(regs[0x24]&64?fixedDepth<32:fixedDepth>0))) {
        fixedDepth=null;depthProgressed=true;
      }
    }
    // Modulation clocks independently of output gain, wave-write mode and
    // base pitch. With no cycle emulation the write pointer becomes unknown,
    // including during DAC+wait commands and inaudible note setup.
    if (samples && hasFds && (regs[0x23] === null || !(regs[0x23] & 128)) && regs[0x27] !== null && !(regs[0x27] & 128)
        && (regs[0x26] === null || (regs[0x26] | ((regs[0x27] & 15) << 8)) || regs[0x27] & 64)) {
      modIndexKnown = false; phaseApproximate = true; modRun = [];
    }
  }
  function dataBlock(position) {
    const type = bytes[position + 2];
    if (![0x07, 0x47, 0xc2].includes(type)) return;
    const rawSize = view.getUint32(position + 3, true), size = rawSize & 0x7fffffff;
    if (rawSize & 0x80000000) throw new Error('Second NES chip sample data is not supported');
    if (type === 0xc2) {
      if (size < 2) throw new Error('Invalid NES RAM block header');
      const address = view.getUint16(position + 7, true);
      if (address + size - 2 > 65536) throw new Error('Invalid NES RAM block range');
      dmc.loadRam(address, bytes.subarray(position + 9, position + 7 + size));
    } else if (type === 0x47) {
      // A compressed chunk changes concatenated bank offsets. Without its
      // decoder, even earlier raw chunks cannot stand in for the whole bank.
      dpcmBankUnknown = true; dpcmChunks.length = 0;
      warnings.add('Compressed NES DPCM banks are not decoded; RAM copies from this bank are omitted.');
    } else if (size && !dpcmBankUnknown) {
      if (dpcmChunks.length >= 65536) throw new Error('VGM import exceeds 65,536 NES DPCM bank blocks');
      dpcmChunks.push({start:dpcmBankSize, end:dpcmBankSize + size, data:bytes.subarray(position + 7, position + 7 + size)});
      dpcmBankSize += size;
    }
  }
  function ramCopy(position) {
    const type = bytes[position + 2];
    if ((type & 0x7f) !== 7) return;
    if (type & 0x80) throw new Error('Second NES chip RAM copies are not supported');
    const u24 = offset => bytes[position + offset] | (bytes[position + offset + 1] << 8) | (bytes[position + offset + 2] << 16);
    const source = u24(3), address = u24(6), length = u24(9) || 0x1000000;
    if (address + length > 65536) throw new Error('Invalid NES RAM copy destination range');
    if (dpcmBankUnknown || source + length > dpcmBankSize) {
      dmc.invalidateRam(address, length);
      warnings.add('NES RAM copies with missing or compressed DPCM-bank bytes are omitted; their destination RAM becomes unknown.');
      return;
    }
    const data = new Uint8Array(length);
    let low = 0, high = dpcmChunks.length;
    while (low < high) {const middle = (low + high) >>> 1; if (dpcmChunks[middle].end <= source) low = middle + 1; else high = middle;}
    let copied = 0, index = low;
    while (copied < length) {
      const chunk = dpcmChunks[index++], from = source + copied - chunk.start;
      const count = Math.min(length - copied, chunk.data.length - from);
      data.set(chunk.data.subarray(from, from + count), copied); copied += count;
    }
    dmc.loadRam(address, data);
  }
  function streamCommand(position, command) {
    const id = bytes[position + 1];
    if (command === 0x90) {
      const target = bytes[position + 2], nes = (target & 0x7f) === 0x14;
      if (nes && target & 0x80) throw new Error('Second NES chip DAC streams are not supported');
      const stopped = activeNesStreams.delete(id); streamTargets.set(id, nes);
      if (stopped) dmc.setStreamActive(activeNesStreams.size > 0);
      if (nes) warnings.add('NES DAC stream writes are not imported; only recorded DMC sample playback is extracted.');
    } else if ((command === 0x93 || command === 0x95) && streamTargets.get(id)) {
      activeNesStreams.add(id); dmc.setStreamActive(true);
    } else if (command === 0x94) {
      const wasActive = activeNesStreams.size > 0;
      if (id === 0xff) activeNesStreams.clear(); else activeNesStreams.delete(id);
      if (wasActive) dmc.setStreamActive(activeNesStreams.size > 0);
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
    if (command === 0x67) dataBlock(position);
    if (command === 0x68) ramCopy(position);
    if (command >= 0x80 && command <= 0x8f) {parser.position++; advance(command & 15);}
    else if (command !== 0xb4 && command !== 0x61 && command !== 0x62 && command !== 0x63 && command !== 0x66 && !(command >= 0x70 && command <= 0x7f)) {
      if (command >= 0x90 && command <= 0x95) streamCommand(position, command);
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
  if (!voices.length) {
    const reason = [...warnings].find(message => /DMC triggers|NES DAC streams|NES RAM copies/.test(message));
    throw new Error(`No complete, playable NES / FDS voices found in this VGM. ${reason ?? 'DMC requires recorded sample RAM, rate / address / length setup and a playback trigger; direct-DAC PCM is not imported.'}`);
  }
  return {voices, warnings:[...warnings], metadata:parseVgmMetadata(bytes), timebase:44100};
}
