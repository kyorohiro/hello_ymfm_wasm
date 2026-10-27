/** PCM/WAV preparation for the PC Engine's 64 KiB MSM5205 ADPCM RAM.
 * Browser, Worker and Node; no AudioContext, clock, file reader or playback.
 * The caller resolves Virtual Files paths before passing their bytes here.
 */
import {readSamplePCM} from './adpcm_b_sample.js';

export const MSM5205_MAX_SAMPLE_BYTES = 65536;
const MAX_INPUT_BYTES = 128 * 1024 * 1024;
const MAX_INPUT_VALUES = MAX_INPUT_BYTES / 4;
const shifts = [-1, -1, -1, -1, 2, 4, 6, 8];
const steps = Array.from({length: 49}, (_, i) => Math.floor(16 * 1.1 ** i));

function frameCount(length, inputRate, outputRate) {
  const frames = Math.max(1, Math.round(length * outputRate / inputRate));
  if (!Number.isSafeInteger(frames) || frames > MSM5205_MAX_SAMPLE_BYTES * 2) {
    throw new RangeError('MSM5205 sample exceeds 64 KiB ADPCM RAM; shorten or resample it first');
  }
  return frames;
}

function validatePCM(pcm, outputRate) {
  const {channels, sampleRate} = pcm ?? {};
  if (!Array.isArray(channels) || !channels.length || channels.length > 32 ||
      !Number.isFinite(sampleRate) || sampleRate <= 0) throw new TypeError('Invalid MSM5205 PCM');
  const length = channels[0]?.length;
  if (!Number.isSafeInteger(length) || !length || channels.some(channel => channel?.length !== length)) {
    throw new RangeError('Invalid MSM5205 PCM channel lengths');
  }
  if (length * channels.length > MAX_INPUT_VALUES) throw new RangeError('MSM5205 decoded PCM exceeds 128 MiB');
  return frameCount(length, sampleRate, outputRate);
}

function audioBufferPCM(source) {
  if (!Number.isInteger(source.numberOfChannels) || source.numberOfChannels < 1 || source.numberOfChannels > 32) {
    throw new TypeError('Invalid MSM5205 PCM channel count');
  }
  return {sampleRate: source.sampleRate, channels: Array.from(
    {length: source.numberOfChannels}, (_, i) => source.getChannelData(i))};
}

// Inspect PCM WAV dimensions before the shared decoder allocates Float32
// channels. Its decoder remains the authority for format and chunk validity.
function preflightWav(bytes, outputRate) {
  if (bytes.byteLength < 12) return;
  const tag = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end > bytes.length || end < 12) throw new RangeError('Truncated WAV');
  let format, dataSize;
  for (let offset = 12; offset + 8 <= end;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > end) throw new RangeError('Truncated WAV chunk');
    if (tag(offset) === 'fmt ' && size >= 16) {
      format = {type: view.getUint16(start, true), count: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true), block: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true)};
    } else if (tag(offset) === 'data' && dataSize === undefined) dataSize = size;
    offset = start + size + (size & 1);
  }
  if (!format || dataSize === undefined) return;
  const {type, count, sampleRate, block, bits} = format;
  if (!((type === 1 && [8, 16, 24, 32].includes(bits)) || (type === 3 && [32, 64].includes(bits)))) return;
  if (count < 1 || count > 32 || !sampleRate || block !== count * bits / 8 || dataSize % block) {
    throw new RangeError('Invalid WAV layout');
  }
  if (dataSize / block * count > MAX_INPUT_VALUES) throw new RangeError('MSM5205 decoded PCM exceeds 128 MiB');
  frameCount(dataSize / block, sampleRate, outputRate);
}

/** Decode and encode a short mono/stereo sample for the PCE's ADPCM player.
 * rate is the hardware register 0..15, not Hz: clock / (48 * (16 - rate)).
 * Channels are averaged, linearly resampled and greedily encoded high nibble
 * first. An odd final frame is padded by one encoded zero-target frame.
 * @param {unknown} source PCM, AudioBuffer, WAV bytes or Blob; other byte formats require decodeAudio.
 * @param {{rate?:number,clock?:number,decodeAudio?:(bytes:ArrayBuffer)=>Promise<unknown>,signal?:AbortSignal}} [options]
 */
export async function prepareMSM5205Sample(source, {rate = 12, clock = 1536000, decodeAudio, signal} = {}) {
  signal?.throwIfAborted();
  if (!Number.isInteger(rate) || rate < 0 || rate > 15) throw new RangeError('MSM5205 rate must be 0..15');
  if (!Number.isInteger(clock) || clock < 1 || clock > 0x3fffffff) throw new RangeError('Invalid MSM5205 clock');
  const sampleRate = clock / (48 * (16 - rate));
  if (typeof source === 'string' || source instanceof URL) throw new TypeError('Resolve MSM5205 sample file paths before preparation');
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (source.size > MAX_INPUT_BYTES) throw new RangeError('MSM5205 sample input exceeds 128 MiB');
    source = await source.arrayBuffer();
    signal?.throwIfAborted();
  }
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    if (bytes.byteLength > MAX_INPUT_BYTES) throw new RangeError('MSM5205 sample input exceeds 128 MiB');
    preflightWav(bytes, sampleRate);
  } else if (source?.channels) validatePCM(source, sampleRate);
  else if (typeof source?.getChannelData === 'function') validatePCM(audioBufferPCM(source), sampleRate);
  const pcm = await readSamplePCM(source, {signal, decodeAudio: decodeAudio && (async bytes => {
    const decoded = await decodeAudio(bytes);
    signal?.throwIfAborted();
    if (typeof decoded?.getChannelData === 'function') {
      validatePCM(audioBufferPCM(decoded), sampleRate);
    } else validatePCM(decoded, sampleRate);
    return decoded;
  })});
  signal?.throwIfAborted();
  const frames = validatePCM(pcm, sampleRate), {channels} = pcm, length = channels[0].length;
  // Validate the whole source, including samples skipped during downsampling.
  for (const channel of channels) for (let i = 0; i < length; i++) {
    if (!Number.isFinite(channel[i])) throw new TypeError('Nonfinite MSM5205 PCM');
  }
  const data = new Uint8Array(Math.ceil(frames / 2));
  const mono = index => channels.reduce((value, channel) => value + Math.max(-1, Math.min(1, channel[index])) / channels.length, 0);
  let predictor = 0, step = 0;
  for (let i = 0; i < data.length * 2; i++) {
    if ((i & 1023) === 0) signal?.throwIfAborted();
    let target = 0;
    if (i < frames) {
      const position = Math.min(i * pcm.sampleRate / sampleRate, length - 1);
      const first = Math.floor(position), fraction = position - first;
      target = Math.round((mono(first) * (1 - fraction) + mono(Math.min(first + 1, length - 1)) * fraction) * 2047);
    }
    let best = 0, bestValue = 0, error = Infinity;
    const size = steps[step];
    for (let nibble = 0; nibble < 16; nibble++) {
      const delta = (size >> 3) + (nibble & 1 ? size >> 2 : 0) + (nibble & 2 ? size >> 1 : 0) + (nibble & 4 ? size : 0);
      const value = Math.max(-2048, Math.min(2047, ((nibble & 8 ? -delta : delta) * 256 + predictor * 245) >> 8));
      const difference = Math.abs(value - target);
      if (difference < error) { best = nibble; bestValue = value; error = difference; }
    }
    data[i >> 1] |= best << (i & 1 ? 0 : 4);
    predictor = bestValue;
    step = Math.max(0, Math.min(48, step + shifts[best & 7]));
  }
  return {data, rate, sampleRate, frames, paddedFrames: data.length * 2, duration: frames / sampleRate};
}
