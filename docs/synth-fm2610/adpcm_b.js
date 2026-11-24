// SPDX-License-Identifier: BSD-3-Clause
import { encodeAdpcmB, readSamplePCM, visitAdpcmBFrames } from '../js/adpcm_b_sample.js';
import { createOfflineAudioDecoder } from '../js/audio_decode.js';
import { renderSampleEdit } from '../js/playground_sample_edit.js';
import { encodeWav } from '../js/wav.js';
import { YM2610B_CLOCK } from '../js/ym2610b.js?v=ym2610-source-mix-1';
import { createFm2610SongAuditionChip } from './song_audition.js';

const DELTA_N_SCALE = 144 * 65536;
const MAX_DELTA_N = 65535;
const SAMPLE_ADDRESS = 0xc00000;
const PAGE_BYTES = 256;
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
  const {name, sampleRate, rootNote, volume, repeat, clockHz, left, right, deltaN} = value ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 1024) throw new TypeError('Invalid ADPCM-B sample name.');
  if (typeof repeat !== 'boolean') throw new TypeError('ADPCM-B Repeat must be on or off.');
  const settings = {
    name,
    sampleRate,
    rootNote: integer(rootNote, 0, 127, 'ADPCM-B root MIDI note'),
    volume: integer(volume, 0, 255, 'ADPCM-B level'),
    repeat,
  };
  if (clockHz !== undefined) settings.clockHz = integer(clockHz, 100000, 24000000, 'ADPCM-B clock');
  if (deltaN !== undefined) {
    settings.deltaN = integer(deltaN, 1, MAX_DELTA_N, 'ADPCM-B Delta-N');
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid ADPCM-B base rate.');
    settings.sampleRate = deltaN * (clockHz ?? YM2610B_CLOCK) / DELTA_N_SCALE;
  } else if (clockHz === undefined) {
    integer(sampleRate, 1, FM2610_ADPCM_B_MAX_RATE, 'ADPCM-B base rate');
  } else {
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

const isPageAligned = address => Number.isInteger(address) && address % PAGE_BYTES === 0;

function sampleWindow({bytes, address, clockHz, start, end}) {
  const sampleStart = address === undefined ? (clockHz === undefined ? SAMPLE_ADDRESS : 0) : address;
  const sampleEnd = sampleStart + bytes.length;
  const from = start === undefined ? sampleStart : start;
  const to = end === undefined ? sampleEnd : end;
  if (!isPageAligned(sampleStart) || !isPageAligned(from) || !isPageAligned(to) ||
      sampleStart < 0 || sampleEnd > FM2610_ADPCM_B_ROM_BYTES ||
      from < sampleStart || to > sampleEnd || to <= from) {
    throw new RangeError('ADPCM-B range must be nonempty, aligned to 256 bytes, and inside the loaded ROM sample.');
  }
  return {sampleStart, sampleEnd, start: from, end: to};
}

/** Validate the saved sample and take ownership of its hardware ROM bytes. */
export function normalizeFm2610AdpcmBSample(value) {
  const settings = readSettings(value);
  const {bytes} = value;
  const maxBytes = settings.clockHz ? FM2610_ADPCM_B_ROM_BYTES : FM2610_ADPCM_B_MAX_BYTES;
  if (!(bytes instanceof Uint8Array) || !bytes.length || !isPageAligned(bytes.length) || bytes.length > maxBytes) {
    throw new RangeError('ADPCM-B sample data must be aligned to 256 bytes and fit in its ROM bank.');
  }
  const window = sampleWindow(value);
  if (value.address !== undefined) settings.address = window.sampleStart;
  if (window.start !== window.sampleStart) settings.start = window.start;
  if (window.end !== window.sampleEnd) settings.end = window.end;
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

function decodeFm2610AdpcmB(bytes) {
  const samples = new Float32Array(bytes.length * 2);
  visitAdpcmBFrames(bytes, (value, frame) => { samples[frame] = value; });
  return samples;
}

/** Paint a stroke in the full sample, keeping the existing 256-byte pages. */
export function drawFm2610AdpcmB(bytes, points) {
  const samples = decodeFm2610AdpcmB(bytes);
  let previous, changed = false;
  for (const {position, amplitude} of points) {
    if (!Number.isFinite(position) || position < 0 || position > 1 ||
        !Number.isFinite(amplitude) || amplitude < -1 || amplitude > 1) {
      throw new RangeError('ADPCM-B drawing points must be inside the waveform.');
    }
    const frame = Math.round(position * (samples.length - 1));
    const start = previous ?? {frame, amplitude};
    for (let index = Math.min(frame, start.frame); index <= Math.max(frame, start.frame); index++) {
      const amount = frame === start.frame ? 1 : (index - start.frame) / (frame - start.frame);
      const next = Math.fround(start.amplitude + (amplitude - start.amplitude) * amount);
      if (samples[index] !== next) {
        samples[index] = next;
        changed = true;
      }
    }
    previous = {frame, amplitude};
  }
  if (!changed) return null;
  // Both rates are equal: the drawing changes amplitude, never sample length or timing.
  const {bytes: encoded} = encodeAdpcmB({channels: [samples], sampleRate: 1}, 1, bytes.length);
  return encoded.some((value, index) => value !== bytes[index]) ? encoded : null;
}

export function exportFm2610AdpcmBWav(bytes, rate) {
  return encodeWav({sampleRate: Math.max(1, Math.round(rate)), channels: [decodeFm2610AdpcmB(bytes)]});
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
    const worker = new Worker(new URL('./adpcm_b_worker.js?v=sample-edit-2', import.meta.url), {type: 'module'});
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
export function createFm2610AdpcmB({
  sound, getMode = () => 'ym2610b', referenceChip = createFm2610SongAuditionChip(), onKeyLatchChange = () => {},
}) {
  const decodeAudio = createOfflineAudioDecoder();
  const manualOwner = Symbol('ADPCM-B Play');
  let sample = defaultSample();
  let pendingLoad = null;
  let bank = null;
  let active = null;
  let preparationRevision = 0;

  // The key latch tracks local commands. A one-shot can reach EOS while it is on.
  function getSettings() {
    const {bytes, ...settings} = sample;
    const baseClock = sample.clockHz ?? YM2610B_CLOCK;
    const currentClock = active?.chip?.clock ?? baseClock;
    const deltaN = pitchDeltaN(null, baseClock), keyed = Boolean(active?.chip);
    const activeDeltaN = keyed ? pitchDeltaN(active.midi, currentClock) : deltaN;
    return {...settings, ...sampleWindow(sample), byteLength: bytes.length, deltaN,
      activeDeltaN, playbackRate: activeDeltaN * currentClock / DELTA_N_SCALE, keyed};
  }

  function getSample() {
    return {...sample, bytes: sample.bytes.slice()};
  }

  function pitchDeltaN(midi, clock) {
    const rate = sample.sampleRate * 2 ** (((midi ?? sample.rootNote) - sample.rootNote) / 12);
    return Math.max(1, Math.min(MAX_DELTA_N, Math.round(rate * DELTA_N_SCALE / clock)));
  }

  function setPitch(chip, midi) {
    chip.setDeltaN(pitchDeltaN(midi, chip.clock));
  }

  function setSettings(settings) {
    const deltaN = Object.hasOwn(settings, 'sampleRate') ? undefined : sample.deltaN;
    return applySettings(readSettings({...sample, ...settings, name: sample.name, clockHz: sample.clockHz, deltaN}));
  }

  function applySettings(next) {
    const old = sample;
    sample = {...old, ...next};
    if (next.deltaN === undefined) delete sample.deltaN;
    if (active?.chip) {
      if (next.volume !== old.volume) active.chip.setVolume(next.volume);
      if (next.left !== old.left || next.right !== old.right) active.chip.setPan(next.left ?? true, next.right ?? true);
      if (next.sampleRate !== old.sampleRate || next.rootNote !== old.rootNote) setPitch(active.chip, active.midi);
    }
    return getSettings();
  }

  function setRange(window) {
    const current = sampleWindow(sample);
    const {start = current.start, end = current.end} = window;
    const next = {...sample, start, end};
    sampleWindow(next);
    if (start === current.sampleStart) delete next.start;
    if (end === current.sampleEnd) delete next.end;
    sample = next;
    return getSettings();
  }

  function setDeltaN(deltaN) {
    integer(deltaN, 1, MAX_DELTA_N, 'ADPCM-B Delta-N');
    return applySettings(readSettings({...sample, deltaN}));
  }

  function stop() {
    const note = active;
    active = null;
    if (note?.chip) {
      note.chip.keyOff();
      onKeyLatchChange(false);
    }
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
      const {rootNote, volume, repeat, left, right} = sample;
      const next = normalizeFm2610AdpcmBSample({name, bytes, sampleRate: rate, rootNote, volume, repeat, left, right});
      return install(next);
    } finally {
      callerSignal?.removeEventListener('abort', abort);
      if (pendingLoad === controller) pendingLoad = null;
    }
  }

  async function drawWave(points, signal) {
    signal.throwIfAborted();
    const {bytes} = sample;
    const encoded = typeof Worker === 'function'
      ? await runSampleWorker({bytes, points}, signal)
      : drawFm2610AdpcmB(bytes, points);
    signal.throwIfAborted();
    if (!encoded || sample.bytes !== bytes) return false;
    // The current decoder may be reading the original ROM. The next trigger
    // uploads these bytes before enabling ADPCM-B, without disturbing that voice.
    sample = {...sample, bytes: encoded};
    return true;
  }

  async function exportWave(signal) {
    signal.throwIfAborted();
    const {bytes, sampleRate} = sample;
    const {start, end, sampleStart} = sampleWindow(sample);
    const selected = bytes.subarray(start - sampleStart, end - sampleStart);
    const wav = selected.length > 0x10000 && typeof Worker === 'function'
      ? await runSampleWorker({bytes: selected.slice(), wavRate: sampleRate}, signal)
      : exportFm2610AdpcmBWav(selected, sampleRate);
    signal.throwIfAborted();
    return wav;
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
      const {sampleStart, start, end} = sampleWindow(sample);
      chip.setSample({start: address + start - sampleStart, end: address + end - sampleStart});
      setPitch(chip, midi);
      chip.setVolume(sample.volume);
      chip.setPan(sample.left ?? true, sample.right ?? true);
      chip.keyOn({repeat: sample.repeat});
      note.chip = chip;
    } catch (error) {
      if (active !== note) return false;
      active = null;
      if (error?.name === 'AbortError') return false;
      throw error;
    }
    onKeyLatchChange(true);
    return true;
  }

  return {
    getSample, getSettings, getWaveform: signal => getFm2610AdpcmBWaveform(sample.bytes, signal),
    applySample, loadSample, drawWave, exportWave, setSettings, setRange, setDeltaN, stop, invalidate, prepare,
    setSourceGains: referenceChip.setSourceGains,
    noteOn(midi, owner = midi) {
      return trigger(integer(midi, 0, 127, 'ADPCM-B MIDI note'), owner);
    },
    noteOff(owner) {
      if (active?.owner === owner) stop();
    },
    play() { return trigger(null, manualOwner); },
  };
}
