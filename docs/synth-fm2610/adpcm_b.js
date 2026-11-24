// SPDX-License-Identifier: BSD-3-Clause
import { encodeAdpcmB, readSamplePCM, visitAdpcmBFrames } from '../js/adpcm_b_sample.js';
import { createOfflineAudioDecoder } from '../js/audio_decode.js';
import { renderSampleEdit } from '../js/playground_sample_edit.js';
import { YM2610B_CLOCK } from '../js/ym2610b.js?v=ym2610-source-mix-1';
import { createFm2610SongAuditionChip } from './song_audition.js';

const DELTA_N_SCALE = 144 * 65536;
const MAX_DELTA_N = 65535;
const SAMPLE_ADDRESS = 0xc00000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const FM2610_ADPCM_B_MAX_BYTES = 0x200000;
export const FM2610_ADPCM_B_ROM_BYTES = 0x1000000;
export const FM2610_ADPCM_B_MAX_RATE = Math.floor(YM2610B_CLOCK * MAX_DELTA_N / DELTA_N_SCALE);

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function getFm2610AdpcmBRateLimits(clockHz) {
  if (clockHz === undefined) return {min: 1, max: FM2610_ADPCM_B_MAX_RATE};
  return {min: clockHz / DELTA_N_SCALE, max: clockHz * MAX_DELTA_N / DELTA_N_SCALE};
}

function readSettings(value) {
  const {name, sampleRate, rootNote, volume, repeat, clockHz, left, right} = value ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 1024) throw new TypeError('Invalid ADPCM-B sample name.');
  if (typeof repeat !== 'boolean') throw new TypeError('ADPCM-B Repeat must be on or off.');
  const settings = {
    name,
    sampleRate,
    rootNote: integer(rootNote, 0, 127, 'ADPCM-B root MIDI note'),
    volume: integer(volume, 0, 255, 'ADPCM-B level'),
    repeat,
  };
  if (clockHz === undefined) {
    integer(sampleRate, 1, FM2610_ADPCM_B_MAX_RATE, 'ADPCM-B base rate');
  } else {
    settings.clockHz = integer(clockHz, 100000, 24000000, 'ADPCM-B clock');
    const {min, max} = getFm2610AdpcmBRateLimits(clockHz);
    if (!Number.isFinite(sampleRate) || sampleRate < min || sampleRate > max) {
      throw new RangeError('ADPCM-B base rate is outside the chip clock range.');
    }
  }
  if (left !== undefined || right !== undefined) {
    if ((left !== undefined && typeof left !== 'boolean') || (right !== undefined && typeof right !== 'boolean')) {
      throw new TypeError('ADPCM-B pan requires left and right switches.');
    }
    Object.assign(settings, {left: left ?? true, right: right ?? true});
  }
  return settings;
}

/** Validate the saved sample and take ownership of its hardware ROM bytes. */
export function normalizeFm2610AdpcmBSample(value) {
  const settings = readSettings(value);
  const {bytes} = value;
  const maxBytes = settings.clockHz ? FM2610_ADPCM_B_ROM_BYTES : FM2610_ADPCM_B_MAX_BYTES;
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length % 256 || bytes.length > maxBytes) {
    throw new RangeError('ADPCM-B sample data must be aligned to 256 bytes and fit in its ROM bank.');
  }
  return {...settings, bytes: new Uint8Array(bytes)};
}

/** Downmix and encode at the reference rate, padding the encoder input to a
 * whole OPNB address page. ADPCM bytes filled with zeros would still play. */
export function encodeFm2610AdpcmB(audio, sampleRate) {
  integer(sampleRate, 1, FM2610_ADPCM_B_MAX_RATE, 'ADPCM-B base rate');
  const {channels: [mono]} = renderSampleEdit(audio, {}, {
    sampleRate,
    maxFrames: FM2610_ADPCM_B_MAX_BYTES * 2,
  });
  const frames = Math.ceil(mono.length / 512) * 512;
  const padded = frames === mono.length ? mono : new Float32Array(frames);
  if (padded !== mono) padded.set(mono);
  return encodeAdpcmB({channels: [padded], sampleRate}, sampleRate, FM2610_ADPCM_B_MAX_BYTES).bytes;
}

/** Min/max pairs across the first decoded pass, including the aligned tail. */
export function summarizeFm2610AdpcmB(bytes) {
  const frames = bytes.length * 2;
  const columns = Math.min(768, frames);
  const peaks = new Float32Array(columns * 2);
  if (!columns) return peaks;
  let column = 0, end = Math.floor(frames / columns), low = Infinity, high = -Infinity;
  visitAdpcmBFrames(bytes, (sample, frame) => {
    low = Math.min(low, sample);
    high = Math.max(high, sample);
    if (frame + 1 !== end) return;
    peaks[column * 2] = low;
    peaks[column * 2 + 1] = high;
    column++;
    end = Math.floor((column + 1) * frames / columns);
    low = Infinity;
    high = -Infinity;
  });
  return peaks;
}

let pluck;
function defaultSample() {
  if (!pluck) {
    const sampleRate = 12000;
    const mono = Float32Array.from({length: 4096}, (_, frame) => {
      const time = frame / sampleRate;
      const angle = 2 * Math.PI * 196 * time;
      const fade = Math.min(1, frame / 24, (4095 - frame) / 240);
      return (.62 * Math.sin(angle) + .2 * Math.sin(angle * 2) * Math.exp(-time * 18)) *
        Math.exp(-time * 9) * fade;
    });
    const {bytes} = encodeAdpcmB({channels: [mono], sampleRate}, sampleRate);
    pluck = {name: 'Built-in pluck', bytes, sampleRate, rootNote: 55, volume: 176, repeat: false};
  }
  return pluck;
}

function runSampleWorker(job, signal, transfers = []) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./adpcm_b_worker.js?v=sample-waveform-1', import.meta.url), {type: 'module'});
    function close() {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    }
    function abort() {
      close();
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, {once: true});
    worker.onmessage = ({data}) => {
      close();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = event => {
      close();
      reject(new Error(event.message || 'Could not prepare the ADPCM-B sample.'));
    };
    try {
      worker.postMessage(job, transfers);
    } catch (error) {
      close();
      reject(error);
    }
  });
}

export async function getFm2610AdpcmBWaveform(bytes, signal, {transfer = false} = {}) {
  signal.throwIfAborted();
  if (bytes.length <= 0x10000 || typeof Worker !== 'function') return summarizeFm2610AdpcmB(bytes);
  return runSampleWorker({bytes}, signal, transfer ? [bytes.buffer] : []);
}

/** One external-ROM hardware voice; the newest trigger owns its key gate. */
export function createFm2610AdpcmB({sound, getMode = () => 'ym2610b', referenceChip = createFm2610SongAuditionChip()}) {
  const decodeAudio = createOfflineAudioDecoder();
  const manualOwner = Symbol('ADPCM-B Play');
  let sample = defaultSample();
  let pendingLoad = null;
  let bank = null;
  let active = null;
  let preparationRevision = 0;

  function getSettings() {
    const {bytes, ...settings} = sample;
    return {...settings, byteLength: bytes.length};
  }

  function getSample() {
    return {...sample, bytes: sample.bytes.slice()};
  }

  function setPitch(chip, midi) {
    const rate = sample.sampleRate * 2 ** (((midi ?? sample.rootNote) - sample.rootNote) / 12);
    const requestedDeltaN = Math.round(rate * DELTA_N_SCALE / chip.clock);
    chip.setDeltaN(Math.max(1, Math.min(MAX_DELTA_N, requestedDeltaN)));
  }

  function setSettings(settings) {
    const next = readSettings({...sample, ...settings, name: sample.name, clockHz: sample.clockHz});
    const old = sample;
    sample = {...next, bytes: old.bytes};
    if (active?.chip) {
      if (next.volume !== old.volume) active.chip.setVolume(next.volume);
      if (next.left !== old.left || next.right !== old.right) active.chip.setPan(next.left ?? true, next.right ?? true);
      if (next.sampleRate !== old.sampleRate || next.rootNote !== old.rootNote) setPitch(active.chip, active.midi);
    }
    return getSettings();
  }

  function stop() {
    const note = active;
    active = null;
    note?.chip?.keyOff();
  }

  function invalidate() {
    preparationRevision++;
    bank = null;
    stop();
    void referenceChip.close()?.catch(() => {});
  }

  function install(next) {
    invalidate();
    sample = next;
    return getSettings();
  }

  function applySample(value) {
    const next = value === null ? defaultSample() : normalizeFm2610AdpcmBSample(value);
    pendingLoad?.abort();
    return install(next);
  }

  async function loadSample(source, {name = source?.name ?? 'Sample', sampleRate, signal: callerSignal} = {}) {
    callerSignal?.throwIfAborted();
    if ((source?.size ?? source?.byteLength ?? 0) > MAX_FILE_BYTES) throw new RangeError('Audio files must fit within 64 MiB.');
    if (sampleRate !== undefined) integer(sampleRate, 1, FM2610_ADPCM_B_MAX_RATE, 'ADPCM-B base rate');
    pendingLoad?.abort();
    const controller = new AbortController();
    const {signal} = controller;
    pendingLoad = controller;
    const abort = () => controller.abort(callerSignal.reason);
    callerSignal?.addEventListener('abort', abort, {once: true});
    try {
      const audio = await readSamplePCM(source, {signal, decodeAudio});
      const rate = sampleRate ?? Math.min(audio.sampleRate, FM2610_ADPCM_B_MAX_RATE);
      const ownsChannels = !source?.channels && typeof source?.getChannelData !== 'function';
      signal.throwIfAborted();
      // Keep caller-owned PCM intact while allowing file data to move to the worker.
      const transfers = ownsChannels ? [...new Set(audio.channels.map(channel => channel.buffer))] : [];
      const bytes = typeof Worker === 'function'
        ? await runSampleWorker({audio, sampleRate: rate}, signal, transfers)
        : encodeFm2610AdpcmB(audio, rate);
      signal.throwIfAborted();
      const next = normalizeFm2610AdpcmBSample({...sample, name, bytes, sampleRate: rate, clockHz: undefined});
      return install(next);
    } finally {
      callerSignal?.removeEventListener('abort', abort);
      if (pendingLoad === controller) pendingLoad = null;
    }
  }

  function upload(chip, {bytes, clockHz}) {
    const address = clockHz === undefined ? SAMPLE_ADDRESS : 0;
    if (!bank || bank.chip !== chip || bank.bytes !== bytes) {
      // The ROM can be replaced only while this one decoder is stopped.
      chip.keyOff();
      const next = {chip, bytes, address, ready: null};
      next.ready = Promise.resolve(chip.loadMemory(bytes, address)).catch(error => {
        if (bank === next) bank = null;
        throw error;
      });
      bank = next;
    }
    return bank;
  }

  async function loadReferenceChip(endpoint, clockHz) {
    const runtime = await referenceChip.load(endpoint, {variant: getMode(), clockHz});
    return (runtime.rawFm ?? runtime.fm).adpcmB;
  }

  async function prepare() {
    const {clockHz} = sample;
    if (clockHz === undefined) return;
    const revision = preparationRevision;
    try {
      const endpoint = await sound();
      if (revision !== preparationRevision) return;
      const chip = await loadReferenceChip(endpoint, clockHz);
      if (revision === preparationRevision) await upload(chip, sample).ready;
    } catch (error) {
      if (revision === preparationRevision && error?.name !== 'AbortError') throw error;
    }
  }

  async function trigger(midi, owner) {
    stop();
    const note = {midi, owner, chip: null};
    active = note;
    try {
      const endpoint = await sound();
      if (active !== note) return false;
      const chip = sample.clockHz === undefined ? endpoint.adpcmB : await loadReferenceChip(endpoint, sample.clockHz);
      if (active !== note) return false;
      const {ready, address} = upload(chip, sample);
      await ready;
      if (active !== note) return false;
      chip.setSample({start: address, end: address + sample.bytes.length});
      setPitch(chip, midi);
      chip.setVolume(sample.volume);
      chip.setPan(sample.left ?? true, sample.right ?? true);
      chip.keyOn({repeat: sample.repeat});
      note.chip = chip;
      return true;
    } catch (error) {
      if (active !== note) return false;
      active = null;
      if (error?.name === 'AbortError') return false;
      throw error;
    }
  }

  return {
    getSample, getSettings, getWaveform: signal => getFm2610AdpcmBWaveform(sample.bytes, signal),
    applySample, loadSample, setSettings, stop, invalidate, prepare, setSourceGains: referenceChip.setSourceGains,
    noteOn(midi, owner = midi) {
      return trigger(integer(midi, 0, 127, 'ADPCM-B MIDI note'), owner);
    },
    noteOff(owner) {
      if (active?.owner === owner) stop();
    },
    play() { return trigger(null, manualOwner); },
  };
}
