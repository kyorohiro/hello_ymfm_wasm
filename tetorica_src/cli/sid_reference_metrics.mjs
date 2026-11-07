// SPDX-License-Identifier: BSD-3-Clause
// Unmodified PCM stays the comparison input. These measurements never change
// either renderer's gain, timing, DC filter or output samples.
import assert from 'node:assert/strict';

export function readFloatPcm(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength % 4) throw new TypeError('Expected little-endian float32 PCM bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pcm = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < pcm.length; ++i) {
    pcm[i] = view.getFloat32(i * 4, true);
    if (!Number.isFinite(pcm[i])) throw new RangeError(`Nonfinite PCM at frame ${i}`);
  }
  return pcm;
}

/** IEEE float WAV: preserve samples, including values outside PCM16's range. */
export function floatWave(pcm, sampleRate) {
  if (!(pcm instanceof Float32Array) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new TypeError('Expected float32 mono PCM and a supported sample rate');
  if (pcm.length > sampleRate * 61) throw new RangeError('Reference WAV exceeds its bounded duration');
  const bytes = Buffer.alloc(56 + pcm.length * 4);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(32, 34);
  bytes.write('fact', 36); bytes.writeUInt32LE(4, 40); bytes.writeUInt32LE(pcm.length, 44);
  bytes.write('data', 48); bytes.writeUInt32LE(pcm.length * 4, 52);
  for (let i = 0; i < pcm.length; ++i) {
    if (!Number.isFinite(pcm[i])) throw new RangeError(`Nonfinite WAV sample at frame ${i}`);
    bytes.writeFloatLE(pcm[i], 56 + i * 4);
  }
  return bytes;
}

function spectralSummary(pcm, rate) {
  const n = 2 ** Math.floor(Math.log2(Math.min(pcm.length, 16384)));
  if (n < 32) return null;
  const real = new Float64Array(n), imaginary = new Float64Array(n);
  const offset = pcm.length - n;
  let mean = 0;
  for (let i = 0; i < n; ++i) mean += pcm[offset + i] / n;
  for (let i = 0; i < n; ++i) real[i] = (pcm[offset + i] - mean) * .5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  for (let i = 1, j = 0; i < n; ++i) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= n; length *= 2) {
    const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let ur = 1, ui = 0;
      for (let k = 0; k < length / 2; ++k) {
        const a = start + k, b = a + length / 2;
        const vr = real[b] * ur - imaginary[b] * ui, vi = real[b] * ui + imaginary[b] * ur;
        real[b] = real[a] - vr; imaginary[b] = imaginary[a] - vi;
        real[a] += vr; imaginary[a] += vi;
        const next = ur * wr - ui * wi; ui = ur * wi + ui * wr; ur = next;
      }
    }
  }
  const bands = {below200Hz: 0, from200To2000Hz: 0, above2000Hz: 0};
  let power = 0, weighted = 0, maximum = 0, peakBin = 0;
  for (let k = 1; k <= n / 2; ++k) {
    const p = real[k] ** 2 + imaginary[k] ** 2, hz = k * rate / n;
    power += p; weighted += p * hz;
    bands[hz < 200 ? 'below200Hz' : hz < 2000 ? 'from200To2000Hz' : 'above2000Hz'] += p;
    if (p > maximum) { maximum = p; peakBin = k; }
  }
  for (const key of Object.keys(bands)) bands[key] = power ? bands[key] / power : 0;
  return {window: 'last power-of-two frames, mean removed, Hann', frames: n,
    binWidthHz: rate / n, dominantBinHz: maximum ? peakBin * rate / n : null,
    centroidHz: power ? weighted / power : null, bandPowerFractions: bands};
}

export function measurePcm(pcm, sampleRate) {
  assert(pcm instanceof Float32Array && Number.isInteger(sampleRate) && sampleRate >= 8000 && sampleRate <= 96000);
  let sum = 0, squared = 0, peak = 0, overrange = 0, nonzero = 0;
  for (const sample of pcm) {
    if (!Number.isFinite(sample)) throw new RangeError('Nonfinite PCM');
    sum += sample; squared += sample * sample; peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) > 1) ++overrange;
    if (sample !== 0) ++nonzero;
  }
  const mean = pcm.length ? sum / pcm.length : 0, power = pcm.length ? squared / pcm.length : 0;
  return {frames: pcm.length, seconds: pcm.length / sampleRate, mean, rms: Math.sqrt(power),
    acRms: Math.sqrt(Math.max(0, power - mean * mean)), peak, overrange, nonzero, finite: true,
    spectrum: spectralSummary(pcm, sampleRate)};
}

/** Same-index common prefix, deliberately without resampling or phase/gain fit. */
export function comparePcm(reference, actual) {
  if (!(reference instanceof Float32Array) || !(actual instanceof Float32Array)) throw new TypeError('Expected two float32 PCM streams');
  const frames = Math.min(reference.length, actual.length);
  let error = 0, peakError = 0, a = 0, b = 0, aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < frames; ++i) {
    const x = reference[i], y = actual[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Nonfinite PCM comparison input');
    const delta = x - y; error += delta * delta; peakError = Math.max(peakError, Math.abs(delta));
    a += x; b += y; aa += x * x; bb += y * y; ab += x * y;
  }
  const varianceA = frames ? Math.max(0, aa - a * a / frames) : 0;
  const varianceB = frames ? Math.max(0, bb - b * b / frames) : 0;
  const covariance = frames ? ab - a * b / frames : 0;
  return {diagnosticOnly: true, alignment: 'same output indices; common prefix; no gain, DC or phase correction',
    commonFrames: frames, referenceExtraFrames: reference.length - frames, actualExtraFrames: actual.length - frames,
    rmse: frames ? Math.sqrt(error / frames) : null, maximumDifference: frames ? peakError : null,
    centeredCorrelation: varianceA && varianceB ? Math.max(-1, Math.min(1, covariance / Math.sqrt(varianceA * varianceB))) : null,
    rmsRatioActualToReference: aa ? Math.sqrt(bb / aa) : null};
}
