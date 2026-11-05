// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';
import {parseVgmMetadata} from '../js/vgm_file.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {extractVgmDacStreams} from './vgm_dac.js';
import {extractVgmDirectPcm} from './vgm_direct_pcm.js';
import {MAX_DDA_SAMPLES} from './dda_pcm.js';

export const MAX_VGM_BYTES = 64 * 1024 * 1024;
const MAX_COMMANDS = 4_000_000, MAX_VOICES = 4096, MAX_OBSERVATIONS = 100_000;
const SCALE = [0,3,5,7,9,11,13,15,16,19,21,23,25,27,29,31];
const abort = signal => {if (signal?.aborted) throw new DOMException('VGM import cancelled', 'AbortError');};

async function decode(source, signal) {
  abort(signal);
  const bytes = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source) : null;
  if (!bytes) throw new TypeError('VGM source must be an ArrayBuffer or Uint8Array');
  if (bytes.length > MAX_VGM_BYTES) throw new RangeError('VGM/VGZ file exceeds 64 MiB');
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Uint8Array.from(bytes);
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
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {result.set(chunk, offset); offset += chunk.length;}
  return result;
}

/** Written Wave/Noise/LFO settings and supported PCM for keyboard audition, not song playback.
 * Snapshots are taken before positive waits, after all writes at that timestamp.
 * firstTime is in VGM's 44,100-sample timebase; channels are one-based CH1–CH6.
 * Wave RAM is never guessed from reset defaults or an unknown playback index.
 */
export async function extractVgmInstruments(source, {signal} = {}) {
  let bytes = await decode(source, signal); abort(signal);
  if (bytes.length < 0x40) throw new Error('Truncated VGM header');
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eof = view.getUint32(4, true);
  if (eof && (eof + 4 < 0x40 || eof + 4 > bytes.length)) throw new Error('Invalid or truncated VGM file size');
  if (eof) {bytes = bytes.subarray(0, eof + 4); view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);}
  const warnings = new Set(['Static Wave / Noise / LFO settings, complete DAC-stream PCM and uniform bounded Direct DAC PCM only: elapsed waveform / modulator phase and later software envelopes / register automation are not replayed. Wave / Noise note pitch is not imported. Recorded LFO periods and PCM rate play at C4. Imported Software Envelope is Off.']);
  const parser = new Ym2612VGM(bytes, {logger:{warn:message => warnings.add(message)}});
  if (parser.header.dataOffset < 0x40 || parser.header.dataOffset >= bytes.length) throw new Error('Invalid VGM data offset');
  const rawClock = parser.header.huc6280Clock;
  if (!(rawClock & 0x3fffffff)) throw new Error('This VGM contains no HuC6280 chip');
  if (rawClock & 0xc0000000) throw new Error('Dual or variant HuC6280 chips are not supported');
  if (rawClock !== HUC6280_CLOCK) warnings.add('This VGM uses a different HuC6280 clock; imported settings play at the normal PC Engine clock.');

  // undefined optional flags mean unrecorded reset assumptions; null means a
  // known unsupported stream made the value indeterminate and must not default.
  let selected = null, globalBalance, lfoControl, lfoFrequency, time = 0, observations = 0, hasPcmStreams = false, hasDirectPcm = false;
  const channels = Array.from({length:8}, () => ({control:null, balance:null, noise:undefined,
    frequencyLow:null, frequencyHigh:null, wave:Array(32).fill(null), index:null, last:null}));
  const streams = new Map(), voices = [], definitions = new Map();
  const warn = message => warnings.add(message);
  const clearLast = () => {for (const channel of channels) channel.last = null;};

  function write(register, value) {
    register &= 15;
    if (register === 0) {selected = value & 7; return;}
    if (register === 1) {globalBalance = value; return;}
    if (register === 8) {lfoFrequency = value; return;}
    if (register === 9) {lfoControl = value; return;}
    if (selected === null) {
      warn('HuC6280 writes without a known channel selection make the affected settings unknown.');
      streamWrite({port:255,register});
      return;
    }
    const channel = channels[selected];
    if (register === 2) channel.frequencyLow = value;
    else if (register === 3) channel.frequencyHigh = value & 15;
    else if (register === 4) {
      if (channel.control !== null && (channel.control & 64) && !(value & 64)) channel.index = 0;
      if (!(value & 128) || channel.control === null || !(channel.control & 128)) channel.last = null;
      channel.control = value;
    } else if (register === 5) channel.balance = value;
    else if (register === 7) channel.noise = value;
    else if (register === 6) {
      if (selected < 6 && (channel.control & 192) === 192) hasDirectPcm = true;
      if (channel.control === null) {
        channel.wave.fill(null); channel.index = null;
        warn('Wave writes with unknown DDA / channel control are omitted.');
      } else if (!(channel.control & 64)) {
        if (channel.index === null) {
          channel.wave.fill(null);
          warn('Wave RAM writes at an unknown playback/write index are omitted; a recorded DDA 1→0 reset and complete upload are needed.');
        } else {
          channel.wave[channel.index] = value & 31;
          if (!(channel.control & 128)) channel.index = (channel.index + 1) & 31;
        }
      }
    }
  }

  function invalidateAll() {
    selected = null; globalBalance = null; lfoControl = null; lfoFrequency = null;
    for (const channel of channels) {
      channel.control = channel.balance = channel.noise = channel.index = channel.last = null;
      channel.frequencyLow = channel.frequencyHigh = null;
      channel.wave.fill(null);
    }
  }
  function streamWrite(stream) {
    if (stream.port !== 255 && stream.register >>> 4 !== 0) {
      // The playback adapter writes the high nibble register before and after
      // the streamed write. Such a nonstandard destination can alter globals.
      invalidateAll(); return;
    }
    const register = stream.register & 15;
    if (register === 0) {selected = null; return;}
    if (register === 1) {globalBalance = null; clearLast(); return;}
    if (register === 8) {lfoFrequency = null; channels[0].last = null; return;}
    if (register === 9) {lfoControl = null; channels[0].last = channels[1].last = null; return;}
    const target = stream.port === 255 ? selected : stream.port & 7;
    const affected = target === null ? channels : [channels[target]];
    for (const channel of affected) {
      if (register === 2) channel.frequencyLow = null;
      else if (register === 3) channel.frequencyHigh = null;
      else if (register === 4) {channel.control = channel.index = channel.last = null;}
      else if (register === 5) channel.balance = channel.last = null;
      else if (register === 7) channel.noise = channel.last = null;
      else if (register === 6 && (channel.control === null || !(channel.control & 64))) {
        channel.wave.fill(null); channel.index = channel.last = null;
      }
    }
  }
  function streamCommand(command, position) {
    const id = bytes[position + 1];
    if (command === 0x94) {
      if (id === 255) {for (const stream of streams.values()) stream.active = false;}
      else if (streams.has(id)) streams.get(id).active = false;
      return;
    }
    if (id === 255) return;
    if (command === 0x90) {
      const chip = bytes[position + 2];
      if ((chip & 127) === 0x1b && (chip & 128)) throw new Error('Second HuC6280 DAC streams are not supported');
      streams.set(id, {huc:chip === 0x1b, port:bytes[position + 3], register:bytes[position + 4], active:false});
      if (chip === 0x1b) hasPcmStreams = true;
    } else if ((command === 0x93 || command === 0x95) && streams.get(id)?.huc) {
      const stream = streams.get(id);
      // A zero-length explicit count cannot write. Other starts are omitted
      // conservatively until stop/reconfiguration; we do not decompress banks.
      stream.active = !(command === 0x93 && (bytes[position + 6] & 15) === 1 && view.getUint32(position + 7, true) === 0);
      if (stream.active) warn('DAC streams are analyzed separately for PCM. Streamed hardware settings are treated as unknown until restored after stream stop / reconfiguration.');
    }
  }

  function balanceNotes() {
    const notes = [];
    if (globalBalance === undefined) notes.push('Global balance was not recorded; this audition assumes full global balance.');
    else if (globalBalance !== 255) notes.push('Recorded global balance is not applied; this audition retains channel level / balance and uses full global balance.');
    return notes;
  }
  function audible(channel, balance) {
    if (channel.control === null || !(channel.control & 128) || channel.balance === null) return false;
    const attenuation = shift => 31 - SCALE[balance >> shift & 15] + 31 - (channel.control & 31) + 31 - SCALE[channel.balance >> shift & 15];
    return attenuation(4) < 31 || attenuation(0) < 31;
  }
  function record(kind, index, key, notes, configure) {
    const channel = channels[index];
    for (const note of notes) warn(note);
    if (key === channel.last) {
      const existing = definitions.get(key);
      existing.warnings = [...new Set([...existing.warnings, ...notes])];
      return;
    }
    channel.last = key;
    if (++observations > MAX_OBSERVATIONS) throw new Error('VGM import exceeds 100,000 voice observations');
    const existing = definitions.get(key);
    if (existing) {existing.occurrences++; existing.warnings = [...new Set([...existing.warnings, ...notes])]; return;}
    if (voices.length >= MAX_VOICES) throw new Error('VGM import exceeds 4,096 different voices');
    const preset = createDefaultPreset(); preset.envelope.enabled = false; configure(preset);
    const id = voices.length + 1;
    preset.name = `${kind === 'lfo' ? 'LFO CH1 + CH2' : `${kind === 'wave' ? 'Wave' : 'Noise'} CH${index + 1}`} · ${id}`;
    const voice = {id,kind,channel:index + 1,firstTime:time,occurrences:1,preset:readPreset(preset),warnings:notes};
    definitions.set(key, voice); voices.push(voice);
  }
  function snapshotLfo() {
    const carrier = channels[0], modulator = channels[1];
    const omit = message => {warn(message); carrier.last = null;};
    if (carrier.control === null || !(carrier.control & 128)) {carrier.last = null; return;}
    if (carrier.control & 64) {omit('Hardware LFO carrier DDA / PCM intervals are omitted; a static CH1 wavetable is required.'); return;}
    if (globalBalance === null) {omit('LFO intervals with global balance changed by an unsupported stream are omitted.'); return;}
    if (carrier.balance === null || modulator.control === null) {omit('Hardware LFO pairs with unknown channel balance / modulator control are omitted.'); return;}
    if (lfoFrequency === undefined || lfoFrequency === null) {omit('Hardware LFO pairs with an unrecorded or unknown rate register are omitted.'); return;}
    if ([carrier, modulator].some(channel => channel.frequencyLow === null || channel.frequencyHigh === null)) {
      omit('Hardware LFO pairs with unrecorded or unknown carrier / modulator period bytes are omitted.'); return;
    }
    if ([carrier, modulator].some(channel => channel.wave.some(value => value === null))) {
      omit('Hardware LFO pairs with incomplete or unknown CH1 / CH2 Wave RAM are omitted; all 32 samples of each wave are required.'); return;
    }
    const outputEnabled = Boolean(modulator.control & 128), outputVolume = modulator.control & 31;
    if (outputEnabled && outputVolume > 0 && modulator.balance === null) {omit('Hardware LFO pairs with unknown audible CH2 balance are omitted.'); return;}
    const balance = globalBalance ?? 255;
    const carrierAudible = audible(carrier, balance), modulatorAudible = audible(modulator, balance);
    // Global attenuation is not stored in this preset. Even a DDA output muted
    // by the recorded global balance could become audible at audition gain.
    if (audible(modulator, 255) && (modulator.control & 64)) {omit('Hardware LFO pairs with audible CH2 DDA / PCM output are omitted; that direct DAC output is not a wavetable.'); return;}
    if (!carrierAudible && !modulatorAudible) {carrier.last = null; return;}
    // A constant modulation table is valid: it adds a fixed period offset.
    // Constant carrier data can also accompany an audible varying CH2 output.
    const carrierOscillates = carrierAudible && carrier.wave.some(value => value !== carrier.wave[0]);
    const modulatorOscillates = modulatorAudible && !(lfoControl & 128) && modulator.wave.some(value => value !== modulator.wave[0]);
    if (!carrierOscillates && !modulatorOscillates) {
      omit('Constant LFO pair output intervals are omitted because they contain no oscillating waveform.'); return;
    }
    const period = channel => (channel.frequencyHigh << 8 | channel.frequencyLow) || 4096;
    const pan = {left:carrier.balance >> 4, right:carrier.balance & 15};
    const outputPan = modulator.balance === null ? {left:15, right:15}
      : {left:modulator.balance >> 4, right:modulator.balance & 15};
    const settings = {enabled:true, frequency:lfoFrequency, depth:lfoControl & 3, wave:[...modulator.wave],
      mode:'recorded', carrierPeriod:period(carrier), modulatorPeriod:period(modulator), reset:Boolean(lfoControl & 128),
      output:{enabled:outputEnabled, volume:outputVolume, pan:outputPan}};
    const notes = balanceNotes();
    notes.push('Recorded LFO periods are preserved at C4. Other keys / Pitch transpose CH1; CH2 keeps its recorded period. Elapsed waveform / LFO phase is not reconstructed.');
    if (modulator.balance === null) notes.push('CH2 balance was not recorded; the inaudible / disabled CH2 output stores full balance.');
    const key = JSON.stringify(['lfo', carrier.control & 31, pan, carrier.wave, settings]);
    record('lfo', 0, key, notes, preset => {
      preset.source = 'wave'; preset.wave = [...carrier.wave]; preset.volume = carrier.control & 31; preset.pan = pan; preset.lfo = settings;
    });
  }

  function snapshot() {
    for (const stream of streams.values()) if (stream.active) streamWrite(stream);
    const hasLfo = Boolean(lfoControl & 3);
    if (hasLfo) snapshotLfo();
    for (let index = 0; index < 6; index++) {
      const channel = channels[index], control = channel.control;
      if (index < 2 && hasLfo) {if (index === 1) channel.last = null; continue;}
      if (control === null || !(control & 128)) {channel.last = null; continue;}
      if (channel.balance === null) {warn('Audible HuC6280 intervals with unknown channel balance are omitted.'); channel.last = null; continue;}
      if (globalBalance === null) {warn('Intervals with global balance changed by an unsupported stream are omitted.'); channel.last = null; continue;}
      const notes = balanceNotes(), balance = globalBalance ?? 255;
      const volume = control & 31, pan = {left:channel.balance >> 4, right:channel.balance & 15};
      const attenuation = shift => 31 - SCALE[balance >> shift & 15] + 31 - volume + 31 - SCALE[channel.balance >> shift & 15];
      if (attenuation(4) >= 31 && attenuation(0) >= 31) {channel.last = null; continue;}
      let kind = 'wave';
      if (index >= 4) {
        if (channel.noise === null) {warn('Intervals with Noise state changed by an unsupported stream are omitted.'); channel.last = null; continue;}
        if (channel.noise === undefined) notes.push('Noise control was not recorded; this Wave audition assumes the reset state, Noise off.');
        else if (channel.noise & 128) kind = 'noise';
      }
      if (kind === 'wave') {
        if (control & 64) {warn('DDA / PCM intervals are analyzed separately; incomplete or unsupported regions are omitted.'); channel.last = null; continue;}
        if (index < 2) {
          if (lfoControl === null) {warn('CH1 / CH2 intervals with unknown LFO state are omitted.'); channel.last = null; continue;}
          if (lfoControl === undefined) notes.push('LFO control was not recorded; this audition assumes the reset state, LFO off.');
        }
        if (channel.wave.some(value => value === null)) {warn('Incomplete or unknown HuC6280 Wave RAM is omitted; all 32 samples must be recorded at known write positions.'); channel.last = null; continue;}
        if (channel.wave.every(value => value === channel.wave[0])) {warn('Constant Wave RAM intervals are omitted because they contain no oscillating waveform.'); channel.last = null; continue;}
      }
      const key = JSON.stringify([kind,index,volume,pan,kind === 'wave' ? channel.wave : channel.noise & 31]);
      record(kind, index, key, notes, preset => {
        preset.source = kind; preset.volume = volume; preset.pan = pan;
        if (kind === 'wave') preset.wave = [...channel.wave];
        else preset.noise.frequency = channel.noise & 31;
      });
    }
  }
  function advance(samples) {
    if (!samples) return;
    snapshot();
    // Playing waveforms and the hardware LFO advance their internal RAM index.
    // RAM itself remains known until a later write uses that unknown position.
    for (let index = 0; index < channels.length; index++) {
      const channel = channels[index], control = channel.control;
      if (control !== null && (control & 128) && !(control & 64) && !(index >= 4 && (channel.noise & 128))) channel.index = null;
    }
    const carrier = channels[0].control;
    if ((lfoControl === null || (lfoControl & 3)) &&
        (carrier === null || ((carrier & 128) && !(carrier & 64)))) channels[1].index = null;
    time += samples;
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
    if (command === 0x66) break;
    if (command === 0xb9) {
      const event = parser.step();
      if (event.chipIndex) throw new Error('Second HuC6280 chip writes are not supported');
      write(event.register, event.value);
    } else {
      parser.position += length;
      if (command === 0x61) advance(view.getUint16(position + 1, true));
      else if (command === 0x62) advance(735);
      else if (command === 0x63) advance(882);
      else if (command >= 0x70 && command <= 0x7f) advance((command & 15) + 1);
      else if (command >= 0x80 && command <= 0x8f) advance(command & 15);
      else if (command >= 0x90 && command <= 0x95) streamCommand(command, position);
    }
    if (count % 4096 === 4095) await new Promise(resolve => setTimeout(resolve, 0));
  }
  abort(signal);
  if (hasPcmStreams || hasDirectPcm) {
    const results=[];
    if (hasPcmStreams) {
      const pcm=await extractVgmDacStreams(bytes,{signal});
      for (const voice of pcm.voices) voice.origin='stream';
      results.push(pcm);
    }
    if (hasDirectPcm) results.push(await extractVgmDirectPcm(bytes,{signal}));
    const assets=new Map();let totalSamples=0;
    for (const result of results) {
      for (const message of result.warnings) warn(message);
      for (const voice of result.voices) {
        const p=voice.preset, key=JSON.stringify([p.dda.data,p.dda.sampleRate,p.dda.loop,p.volume,p.pan]);
        const previous=assets.get(key);
        if (previous) {
          previous.occurrences+=voice.occurrences;
          previous.origins=[...new Set([...previous.origins,voice.origin])];
          previous.warnings=[...new Set([...previous.warnings,...voice.warnings])];
          if (voice.firstTime<previous.firstTime) {previous.firstTime=voice.firstTime;previous.channel=voice.channel;}
        } else {
          const data=p.dda.data;
          totalSamples+=data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0);
          if (totalSamples>MAX_DDA_SAMPLES) throw new Error('PCM import exceeds 16,777,216 combined DAC samples');
          voice.origins=[voice.origin];assets.set(key,voice);
        }
      }
    }
    voices.push(...assets.values());
    if (voices.length > MAX_VOICES) throw new Error('VGM import exceeds 4,096 different voices');
    if (voices.reduce((sum, voice) => sum + voice.occurrences, 0) > MAX_OBSERVATIONS) throw new Error('VGM import exceeds 100,000 voice observations');
    voices.sort((a,b) => a.firstTime-b.firstTime || a.channel-b.channel);
    for (let index=0;index<voices.length;index++) {
      const voice=voices[index];voice.id=index+1;
      voice.preset.name=`${voice.kind==='lfo'?'LFO CH1 + CH2':`${voice.kind==='pcm'?'PCM':voice.kind==='wave'?'Wave':'Noise'} CH${voice.channel}`} · ${voice.id}`;
      if (voice.kind==='pcm') voice.preset.dda.name=voice.preset.name;
    }
  }
  abort(signal);
  if (!voices.length) {
    const reasons = [...warnings].filter(message => /omitted|unknown|DAC streams/i.test(message));
    const error = new Error(`No complete, audible HuC6280 Wave / Noise / LFO / PCM voices found in this VGM.${reasons.length ? ' ' + reasons.join(' ') : ''}`);
    error.warnings = [...warnings];
    throw error;
  }
  return {voices,warnings:[...warnings],metadata:parseVgmMetadata(bytes),timebase:44100};
}
