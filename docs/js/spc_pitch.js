/** Pure BRR pitch hints, before envelopes/interpolation/noise/echo. These are
 * heuristic confidence labels, not probabilities or recovered musical notes.
 * The period search uses an FFT autocorrelation and a normalized difference
 * test, informed by de Cheveigne / Kawahara's YIN paper (2002), sections II B–E:
 * https://doi.org/10.1121/1.1458024 . This is an independent bounded estimator,
 * not the complete YIN algorithm or its reference implementation.
 */
import {decodeBrr} from './snes_brr.js?v=spc-pitch-comments-1';

const RATE = 32000, METHOD = 'brr-fft-periodicity-v1';
const MAX_BYTES = 65536, STEADY_FRAMES = 8192, WARM_FRAMES = 2048;
const MAX_DECODED_FRAMES = 360448, MIN_LAG = 4, MAX_LAG = 1024;
const result = (referenceHz, confidence, reason) => ({referenceHz, confidence, reason, method:METHOD});

// Radix-2 transform of owned scratch arrays. No application audio is changed.
function fft(real, imag, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    const stepR = Math.cos(angle), stepI = Math.sin(angle), half = size >> 1;
    for (let start = 0; start < n; start += size) {
      let wr = 1, wi = 0;
      for (let j = 0; j < half; j++) {
        const a = start + j, b = a + half;
        const br = real[b] * wr - imag[b] * wi, bi = real[b] * wi + imag[b] * wr;
        real[b] = real[a] - br; imag[b] = imag[a] - bi;
        real[a] += br; imag[a] += bi;
        const next = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR; wr = next;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {real[i] /= n; imag[i] /= n;}
}

function analyzeWindow(pcm, start, length) {
  let size = 1;
  while (size < length * 2) size *= 2;
  const real = new Float64Array(size), imag = new Float64Array(size);
  const prefix = new Float64Array(length + 1);
  let mean = 0;
  for (let i = 0; i < length; i++) mean += pcm[start + i];
  mean /= length;
  for (let i = 0; i < length; i++) {
    const value = pcm[start + i] - mean;
    real[i] = value; prefix[i + 1] = prefix[i] + value * value;
  }
  const energy = prefix[length] / length;
  if (energy < (2 / 32768) ** 2) return {energy, reason:'Silence or DC; no measurable periodic pitch.'};
  fft(real, imag);
  let totalPower = 0, peakPower = 0;
  for (let i = 0; i < size; i++) {
    const power = real[i] * real[i] + imag[i] * imag[i];
    real[i] = power; imag[i] = 0;
    if (i > 0 && i < size / 2) {totalPower += power; peakPower = Math.max(peakPower, power);}
  }
  const peakFraction = totalPower ? peakPower / totalPower : 0;
  fft(real, imag, true);
  const limit = Math.min(MAX_LAG, Math.floor(length / 2));
  const difference = new Float64Array(limit + 1), normalized = new Float64Array(limit + 1);
  normalized[0] = 1;
  let sum = 0;
  for (let lag = 1; lag <= limit; lag++) {
    difference[lag] = Math.max(0, (prefix[length - lag] + prefix[length] - prefix[lag] - 2 * real[lag]) / (length - lag));
    sum += difference[lag];
    normalized[lag] = sum > 0 ? difference[lag] * lag / sum : 1;
  }
  if (Array.from(normalized.subarray(1, MIN_LAG)).some(value => value < .1)) {
    return {energy, reason:'Periodic pitch is above the supported 8,000 Hz search range.'};
  }
  let selected = 0, best = Infinity;
  for (let lag = MIN_LAG; lag < limit; lag++) {
    if (normalized[lag] > normalized[lag - 1] || normalized[lag] >= normalized[lag + 1]) continue;
    if (normalized[lag] < best) {best = normalized[lag]; selected = lag;}
    // Prefer the first credible period over its integer multiples.
    if (normalized[lag] < .1) {selected = lag; break;}
  }
  if (!selected || normalized[selected] > .25 || peakFraction < .015) {
    return {energy, reason:'No clear periodic component (noise or an inharmonic sample).'};
  }
  // A dominant overtone can hide a weaker fundamental. Accept an integer
  // multiple only for a material improvement, avoiding pure-tone subharmonics.
  for (let multiple = 2; multiple <= 4; multiple++) {
    const center = selected * multiple;
    if (center >= limit - 1) break;
    let candidate = center;
    for (let lag = center - 1; lag <= center + 1; lag++) if (normalized[lag] < normalized[candidate]) candidate = lag;
    if (normalized[selected] - normalized[candidate] > .025 && normalized[candidate] < normalized[selected] * .3) {
      selected = candidate; break;
    }
  }
  const a = difference[selected - 1], b = difference[selected], c = difference[selected + 1];
  const curvature = a - 2 * b + c;
  const correction = curvature > 0 ? Math.max(-.5, Math.min(.5, (a - c) / (2 * curvature))) : 0;
  const period = selected + correction, hz = RATE / period;
  return {energy, hz, error:normalized[selected], cycles:length / period, peakFraction};
}

function sampleBytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('BRR data must be binary');
}

/** Estimate an acoustic reference at native 32,000 Hz / raw PITCH 4096.
 * BRR contains no musical root note; octave errors and complex/noisy samples
 * remain possible. Only high confidence is suitable for an automatic default.
 * Low confidence returns a candidate for inspection; none returns null.
 * Search range is about 31.25–8,000 Hz, with at most three 4096-frame windows.
 * Decoder work is capped separately; loop predictor history is carried across
 * warm-up passes, rather than resetting each repetition to zero.
 * @param {{brr:ArrayBuffer|ArrayBufferView,loop?:boolean,loopStartSamples?:number|null}} sample
 * @returns {{referenceHz:number|null,confidence:'high'|'low'|'none',reason:string,method:string}}
 */
export function estimateBrrPitch(sample) {
  let decoded, brr;
  try {
    brr = sampleBytes(sample?.brr);
    if (brr.byteLength > MAX_BYTES) return result(null, 'none', 'BRR exceeds the bounded 64 KiB analysis input.');
    decoded = decodeBrr(brr);
    if (!decoded.endReached || decoded.blockCount * 9 !== brr.length) return result(null, 'none', 'BRR must end once, without trailing blocks.');
    if (sample.loop !== undefined && (typeof sample.loop !== 'boolean' || sample.loop !== decoded.loop)) {
      return result(null, 'none', 'Loop metadata disagrees with the BRR END block.');
    }
  } catch {
    return result(null, 'none', 'Invalid or incomplete BRR data.');
  }
  let pcm;
  if (decoded.loop) {
    const start = sample.loopStartSamples;
    if (!Number.isInteger(start) || start < 0 || start % 16 || start >= decoded.pcm.length) {
      return result(null, 'none', 'A valid block-aligned loop position is required.');
    }
    const loopBytes = brr.subarray(start / 16 * 9), steady = new Float32Array(STEADY_FRAMES);
    let history = decoded.finalHistory, warmed = 0, written = 0, work = decoded.pcm.length;
    for (let pass = 0; written < steady.length && pass < 1024; pass++) {
      const frames = loopBytes.length / 9 * 16;
      if (work + frames > MAX_DECODED_FRAMES) return result(null, 'none', 'Loop decoding exceeded the bounded analysis budget.');
      const next = decodeBrr(loopBytes, {history}); history = next.finalHistory; work += frames;
      const skip = Math.min(WARM_FRAMES - warmed, next.pcm.length); warmed += skip;
      const count = Math.min(steady.length - written, next.pcm.length - skip);
      steady.set(next.pcm.subarray(skip, skip + count), written); written += count;
    }
    if (written !== steady.length) return result(null, 'none', 'Insufficient steady loop data within the analysis budget.');
    pcm = steady;
  } else {
    if (decoded.pcm.length < 256) return result(null, 'none', 'One-shot sample is too short to establish a stable pitch.');
    // Skip up to the first 10 ms of attack and retain separated windows so
    // decays, sweeps and percussion cannot pass on one favorable moment alone.
    const skip = Math.min(320, Math.floor(decoded.pcm.length / 10));
    pcm = decoded.pcm.subarray(skip);
  }
  const length = Math.min(4096, Math.floor(pcm.length / 2));
  const starts = [0, Math.floor((pcm.length - length) / 2), pcm.length - length];
  const windows = starts.map(start => analyzeWindow(pcm, start, length));
  const pitches = windows.filter(window => window.hz !== undefined);
  if (pitches.length !== windows.length) return result(null, 'none', windows.find(window => !window.hz)?.reason ?? 'No stable pitch across the sample.');
  const min = Math.min(...pitches.map(window => window.hz)), max = Math.max(...pitches.map(window => window.hz));
  const cents = 1200 * Math.log2(max / min);
  if (cents > 80) return result(null, 'none', 'Pitch changes across the sample; choose a reference manually.');
  const energies = pitches.map(window => window.energy), decay = Math.max(...energies) / Math.min(...energies);
  if (decay > 16) return result(null, 'none', 'Transient or strongly decaying sample; no stable reference assigned.');
  const referenceHz = pitches.map(window => window.hz).sort((a,b) => a - b)[1];
  const high = cents <= 25 && decay <= 4 && pitches.every(window => window.error < .07 && window.cycles >= 4 && window.peakFraction >= .03);
  return result(referenceHz, high ? 'high' : 'low', high
    ? 'Consistent periodic pitch across three steady windows; verify the octave by ear.'
    : 'Possible pitch, but periodicity, duration or stability is insufficient for automatic tuning.');
}
