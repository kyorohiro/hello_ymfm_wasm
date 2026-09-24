/**
 * @file Single-tone preview resampling. Browser / Node.js; no audio device needed.
 * Box-average downsampling for these 440 Hz examples. This is not a high-quality
 * general-purpose music resampler; use a band-limited converter for full-band audio.
 */

/**
 * Average input samples over each output frame, preserving duration and amplitude.
 * @param {Float32Array} input One native-rate channel.
 * @param {number} inputRate Native frames/second.
 * @param {number} outputRate Preview frames/second (must not exceed inputRate).
 * @returns {Float32Array} New preview channel.
 */
export function downsamplePreview(input, inputRate, outputRate) {
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate) ||
      outputRate <= 0 || inputRate < outputRate) throw new RangeError('Invalid downsampling rates');
  const step = inputRate / outputRate;
  const output = new Float32Array(Math.floor(input.length / step));
  for (let i = 0; i < output.length; i++) {
    const start = i * step, end = Math.min(input.length, (i + 1) * step);
    let total = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) {
      const weight = Math.min(end, j + 1) - Math.max(start, j);
      if (weight > 0) total += input[j] * weight;
    }
    output[i] = total / (end - start);
  }
  return output;
}
