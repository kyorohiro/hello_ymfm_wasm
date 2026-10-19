/** Browser / Worker / Node: non-destructive sample editing. No devices, DOM or playback. */
import {readSamplePCM} from './adpcm_b_sample.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function finite(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
function audioShape(audio) {
  if (!audio || !Array.isArray(audio.channels) || !audio.channels.length ||
      !Number.isInteger(audio.sampleRate) || audio.sampleRate < 1 || audio.sampleRate > 768000) throw new TypeError('Expected decoded PCM with a valid sample rate');
  const frames = audio.channels[0]?.length;
  if (!Number.isSafeInteger(frames) || frames < 1 || audio.channels.some(channel => !ArrayBuffer.isView(channel) || channel.length !== frames)) throw new RangeError('PCM channels must have equal, nonempty lengths');
  return frames;
}

function normalizeDrawPoints(input, frames) {
  if (!Array.isArray(input)) throw new TypeError('Drawing points must be an array');
  const points = new Map();
  for (const point of input) {
    if (!Array.isArray(point) || point.length !== 2) throw new TypeError('Each drawn point requires [sourceFrame, value]');
    const frame = clamp(Math.round(finite(point[0], NaN, 'draw frame')), 0, frames - 1);
    const value = clamp(finite(point[1], NaN, 'draw value'), -1, 1);
    if (!Number.isFinite(frame) || !Number.isFinite(value)) throw new TypeError('Drawn points must be finite');
    points.set(frame, value);
  }
  return [...points].sort((a, b) => a[0] - b[0]);
}

/** Frame ends are exclusive. All edit/loop/draw positions refer to the original source. */
export function normalizeSampleEdit(audio, settings = {}) {
  const frames = audioShape(audio);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Expected sample edit settings');
  const startFrame = clamp(Math.round(finite(settings.startFrame, 0, 'startFrame')), 0, frames - 1);
  const endFrame = clamp(Math.round(finite(settings.endFrame, frames, 'endFrame')), startFrame + 1, frames);
  const duration = (endFrame - startFrame) / audio.sampleRate;
  const loopStartFrame = clamp(Math.round(finite(settings.loopStartFrame, startFrame, 'loopStartFrame')), startFrame, endFrame - 1);
  const loopEndFrame = clamp(Math.round(finite(settings.loopEndFrame, endFrame, 'loopEndFrame')), loopStartFrame + 1, endFrame);
  if (settings.loopEnabled !== undefined && typeof settings.loopEnabled !== 'boolean') throw new TypeError('loopEnabled must be boolean');
  if (settings.drawStrokes !== undefined && !Array.isArray(settings.drawStrokes)) throw new TypeError('drawStrokes must be an array');
  return {
    startFrame, endFrame,
    gainDb: clamp(finite(settings.gainDb, 0, 'gainDb'), -60, 24),
    fadeInSeconds: clamp(finite(settings.fadeInSeconds, 0, 'fadeInSeconds'), 0, duration),
    fadeOutSeconds: clamp(finite(settings.fadeOutSeconds, 0, 'fadeOutSeconds'), 0, duration),
    rootMidi: clamp(Math.round(finite(settings.rootMidi, 60, 'rootMidi')), 0, 127),
    tuneCents: clamp(finite(settings.tuneCents, 0, 'tuneCents'), -100, 100),
    loopEnabled: settings.loopEnabled ?? false,
    loopStartFrame, loopEndFrame,
    drawPoints: normalizeDrawPoints(settings.drawPoints ?? [], frames),
    drawStrokes: (settings.drawStrokes ?? []).map(stroke => normalizeDrawPoints(stroke, frames)),
  };
}

export function createSampleEdit(audio, {settings = {}} = {}) {
  return normalizeSampleEdit(audio, settings);
}

function cropChannels(audio, edit, mono) {
  const frames = edit.endFrame - edit.startFrame;
  const output = Array.from({length: mono ? 1 : audio.channels.length}, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    const frame = edit.startFrame + i;
    for (let ch = 0; ch < audio.channels.length; ch++) {
      const value = audio.channels[ch][frame];
      if (!Number.isFinite(value)) throw new TypeError('PCM samples must be finite');
      if (mono) output[0][i] += value / audio.channels.length;
      else output[ch][i] = value;
    }
  }
  // Independent gestures never connect across untouched source frames.
  for (const points of [edit.drawPoints, ...edit.drawStrokes]) {
    if (!points.length) continue;
    const start = Math.max(edit.startFrame, points[0][0]);
    const end = Math.min(edit.endFrame - 1, points.at(-1)[0]);
    let pointIndex = 0;
    for (let frame = start; frame <= end; frame++) {
      while (pointIndex + 1 < points.length && points[pointIndex + 1][0] < frame) pointIndex++;
      const a = points[pointIndex], b = points[Math.min(pointIndex + 1, points.length - 1)];
      const value = a[0] === b[0] ? a[1] : a[1] + (b[1] - a[1]) * (frame - a[0]) / (b[0] - a[0]);
      for (const channel of output) channel[frame - edit.startFrame] = value;
    }
  }
  return output;
}

/** Windowed-sinc interpolation, with a reduced cutoff before downsampling. */
function resample(input, frames, sourceRate, targetRate, circular = false) {
  if (sourceRate === targetRate && frames === input.length) return input.slice();
  const output = new Float32Array(frames), ratio = sourceRate / targetRate;
  const cutoff = Math.min(1, 1 / ratio) * .9, radius = 12 / cutoff;
  for (let i = 0; i < frames; i++) {
    const position = Math.min(input.length - 1, i * ratio);
    let value = 0, sum = 0;
    const start = circular ? Math.ceil(position - radius) : Math.max(0, Math.ceil(position - radius));
    const end = circular ? position + radius : Math.min(input.length, position + radius);
    for (let j = start; j < end; j++) {
      const distance = j - position, x = Math.PI * distance * cutoff;
      const weight = (x === 0 ? 1 : Math.sin(x) / x) * (.5 + .5 * Math.cos(Math.PI * distance / radius));
      value += input[circular ? (j % input.length + input.length) % input.length : j] * weight; sum += weight;
    }
    output[i] = sum ? value / sum : 0;
  }
  return output;
}

/** Render an owned PCM copy. rootMidi/tuneCents are instrument metadata, not destructive resampling. */
export function renderSampleEdit(audio, settings, {sampleRate = audio.sampleRate, mono = true, maxFrames} = {}) {
  const edit = normalizeSampleEdit(audio, settings);
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 768000) throw new RangeError('Invalid output sample rate');
  if (typeof mono !== 'boolean') throw new TypeError('mono must be boolean');
  const frames = Math.max(1, Math.round((edit.endFrame - edit.startFrame) * sampleRate / audio.sampleRate));
  if (!Number.isSafeInteger(frames) || maxFrames !== undefined && (!Number.isSafeInteger(maxFrames) || maxFrames < 1)) throw new RangeError('Invalid output frame limit');
  if (maxFrames !== undefined && frames > maxFrames) throw new RangeError(`Edited sample needs ${frames} frames; the target allows ${maxFrames}. Shorten it or lower the sample rate.`);
  const gain = 10 ** (edit.gainDb / 20);
  let peakBeforeClip = 0, clippedSamples = 0;
  const channels = cropChannels(audio, edit, mono).map(input => {
    const channel = resample(input, frames, audio.sampleRate, sampleRate);
    for (let i = 0; i < frames; i++) {
      const fadeIn = edit.fadeInSeconds ? i / (edit.fadeInSeconds * sampleRate) : 1;
      const fadeOut = edit.fadeOutSeconds ? (frames - 1 - i) / (edit.fadeOutSeconds * sampleRate) : 1;
      const value = channel[i] * gain * Math.min(1, fadeIn, fadeOut);
      peakBeforeClip = Math.max(peakBeforeClip, Math.abs(value));
      if (Math.abs(value) > 1) clippedSamples++;
      channel[i] = clamp(value, -1, 1);
    }
    return channel;
  });
  const loopStartFrame = clamp(Math.round((edit.loopStartFrame - edit.startFrame) * sampleRate / audio.sampleRate), 0, frames - 1);
  const loopEndFrame = clamp(Math.round((edit.loopEndFrame - edit.startFrame) * sampleRate / audio.sampleRate), loopStartFrame + 1, frames);
  return {channels, sampleRate, loopEnabled: edit.loopEnabled, loopStartFrame, loopEndFrame,
    rootMidi: edit.rootMidi, tuneCents: edit.tuneCents, sourceStartFrame: edit.startFrame, sourceEndFrame: edit.endFrame,
    peakBeforeClip, clippedSamples};
}

/** Absolute gain for a chosen peak; ignores the previous gain and fade handles. */
export function sampleNormalizationGainDb(audio, settings, {peak = .95, mono = true} = {}) {
  if (!Number.isFinite(peak) || peak <= 0 || peak > 1) throw new RangeError('Normalization peak must be in (0, 1]');
  if (typeof mono !== 'boolean') throw new TypeError('mono must be boolean');
  const channels = cropChannels(audio, normalizeSampleEdit(audio, settings), mono);
  let measured = 0;
  for (const channel of channels) for (const value of channel) measured = Math.max(measured, Math.abs(value));
  return measured ? clamp(20 * Math.log10(peak / measured), -60, 24) : 0;
}

/** The selection is one user-chosen cycle, not an automatic extraction from a recording. */
export function renderGameboyWave(audio, settings) {
  const edit = normalizeSampleEdit(audio, settings);
  const input = renderSampleEdit(audio, edit).channels[0];
  const samples = resample(input, 32, input.length, 32, true);
  return Uint8Array.from(samples, value => Math.round((clamp(value, -1, 1) + 1) * 7.5));
}

/** Project audio asset: IEEE float32 RIFF WAV preserves original Float32 PCM exactly. */
export function encodeSampleWav(audio) {
  const frames = audioShape(audio), count = audio.channels.length, dataSize = frames * count * 4;
  if (count > 32 || dataSize > 0xffffffff - 50 || audio.sampleRate * count * 4 > 0xffffffff) throw new RangeError('PCM exceeds WAV format limits');
  const bytes = new Uint8Array(58 + dataSize), view = new DataView(bytes.buffer);
  const text = (offset, value) => {for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);};
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 18, true); view.setUint16(20, 3, true);
  view.setUint16(22, count, true); view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * count * 4, true); view.setUint16(32, count * 4, true); view.setUint16(34, 32, true);
  text(38, 'fact'); view.setUint32(42, 4, true); view.setUint32(46, frames, true);
  text(50, 'data'); view.setUint32(54, dataSize, true);
  for (let i = 0; i < frames; i++) for (let ch = 0; ch < count; ch++) {
    const value = audio.channels[ch][i];
    if (!Number.isFinite(value)) throw new TypeError('PCM samples must be finite');
    view.setFloat32(58 + (i * count + ch) * 4, value, true);
  }
  return bytes;
}
/** Binary-only wrapper: never loads paths, URLs or devices. */
export async function decodeSampleWav(bytes) {
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) throw new TypeError('Expected WAV bytes');
  const pcm = await readSamplePCM(bytes);
  audioShape(pcm);
  for (const channel of pcm.channels) for (const value of channel) if (!Number.isFinite(value)) throw new TypeError('PCM samples must be finite');
  return pcm;
}

// Bounded FFT periodicity estimator, independent of the BRR decoder/state.
// Uses the same normalized difference criterion as spc_pitch.js.
function fft(real, imag, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {[real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]];}
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / size, stepR = Math.cos(angle), stepI = Math.sin(angle), half = size >> 1;
    for (let start = 0; start < n; start += size) {
      let wr = 1, wi = 0;
      for (let j = 0; j < half; j++) {
        const a = start + j, b = a + half, br = real[b] * wr - imag[b] * wi, bi = real[b] * wi + imag[b] * wr;
        real[b] = real[a] - br; imag[b] = imag[a] - bi; real[a] += br; imag[a] += bi;
        const next = wr * stepR - wi * stepI; wi = wr * stepI + wi * stepR; wr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {real[i] /= n; imag[i] /= n;}
}

function periodicity(pcm, rate) {
  const length = pcm.length;
  let size = 1;
  while (size < length * 2) size *= 2;
  const real = new Float64Array(size), imag = new Float64Array(size), prefix = new Float64Array(length + 1);
  const mean = pcm.reduce((sum, value) => sum + value, 0) / length;
  for (let i = 0; i < length; i++) {const value = pcm[i] - mean; real[i] = value; prefix[i + 1] = prefix[i] + value * value;}
  const energy = prefix[length] / length;
  if (energy < 1e-10) return {reason: 'Silence or DC has no measurable periodic pitch.'};
  fft(real, imag);
  let total = 0, peak = 0, highBandPower = 0;
  for (let i = 0; i < size; i++) {
    const power = real[i] ** 2 + imag[i] ** 2; real[i] = power; imag[i] = 0;
    if (i > 0 && i < size / 2) {
      total += power; peak = Math.max(peak, power);
      if (i * rate / size > 4000) highBandPower += power;
    }
  }
  const peakFraction = total ? peak / total : 0;
  if (total && highBandPower / total > .995) return {reason: 'Periodic energy is above the supported 4,000 Hz analysis range.'};
  fft(real, imag, true);
  const minLag = Math.max(2, Math.floor(rate / 4000)), limit = Math.min(Math.floor(rate / 30), Math.floor(length / 2));
  const difference = new Float64Array(limit + 1), normalized = new Float64Array(limit + 1);
  normalized[0] = 1;
  let sum = 0;
  for (let lag = 1; lag <= limit; lag++) {
    difference[lag] = Math.max(0, (prefix[length - lag] + prefix[length] - prefix[lag] - 2 * real[lag]) / (length - lag));
    sum += difference[lag]; normalized[lag] = sum > 0 ? difference[lag] * lag / sum : 1;
  }
  let selected = 0, best = Infinity;
  for (let lag = minLag; lag < limit; lag++) {
    if (normalized[lag] > normalized[lag - 1] || normalized[lag] >= normalized[lag + 1]) continue;
    if (normalized[lag] < best) {best = normalized[lag]; selected = lag;}
    if (normalized[lag] < .1) {selected = lag; break;}
  }
  if (!selected || normalized[selected] > .25 || peakFraction < .015) return {reason: 'No clear periodic component; this may be noise or an inharmonic sound.'};
  for (let multiple = 2; multiple <= 4; multiple++) {
    const center = selected * multiple;
    if (center >= limit - 1) break;
    let candidate = center;
    for (let lag = center - 1; lag <= center + 1; lag++) if (normalized[lag] < normalized[candidate]) candidate = lag;
    if (normalized[selected] - normalized[candidate] > .025 && normalized[candidate] < normalized[selected] * .3) {selected = candidate; break;}
  }
  const a = difference[selected - 1], b = difference[selected], c = difference[selected + 1], curvature = a - 2 * b + c;
  const correction = curvature > 0 ? clamp((a - c) / (2 * curvature), -.5, .5) : 0, period = selected + correction;
  return {hz: rate / period, energy, error: normalized[selected], cycles: length / period, peakFraction};
}

/** Pitch is a heuristic hint, not pitch detection for arbitrary speech/chords/percussion. */
export function estimateSamplePitch(audio, settings) {
  const edit = normalizeSampleEdit(audio, settings), rate = Math.min(audio.sampleRate, 16000);
  const none = reason => ({hz: null, midi: null, cents: null, confidence: 'none', reason});
  const available = edit.endFrame - edit.startFrame;
  const length = Math.min(4096, Math.floor(available * rate / audio.sampleRate / 2));
  if (length < 256) return none('The selection is too short to establish a stable pitch.');
  const sourceLength = Math.min(available, Math.round(length * audio.sampleRate / rate));
  const skip = Math.min(Math.round(.01 * audio.sampleRate), Math.floor((available - sourceLength) / 10));
  const start = edit.startFrame + skip, end = edit.endFrame - sourceLength;
  const windows = [start, Math.round((start + end) / 2), end].map(first => {
    const pcm = renderSampleEdit(audio, {...edit, startFrame: first, endFrame: first + sourceLength,
      gainDb: 0, fadeInSeconds: 0, fadeOutSeconds: 0}, {sampleRate: rate});
    return periodicity(pcm.channels[0], rate);
  });
  if (windows.some(window => !window.hz)) return none(windows.find(window => !window.hz).reason);
  const low = Math.min(...windows.map(window => window.hz)), high = Math.max(...windows.map(window => window.hz));
  const drift = 1200 * Math.log2(high / low), energies = windows.map(window => window.energy), decay = Math.max(...energies) / Math.min(...energies);
  if (drift > 80) return none('Pitch changes across the selection; choose its root note manually.');
  if (decay > 16) return none('A transient or strongly decaying sound has no stable reference here.');
  const hz = windows.map(window => window.hz).sort((a, b) => a - b)[1], note = 69 + 12 * Math.log2(hz / 440), midi = Math.round(note);
  const reliable = drift <= 25 && decay <= 4 && windows.every(window => window.error < .07 && window.cycles >= 4 && window.peakFraction >= .03);
  return {hz, midi, cents: (note - midi) * 100, confidence: reliable ? 'high' : 'low', reason: reliable
    ? 'Consistent periodic pitch across three windows; verify the octave by ear.'
    : 'Possible pitch; duration, periodicity or stability is insufficient for automatic tuning.'};
}
