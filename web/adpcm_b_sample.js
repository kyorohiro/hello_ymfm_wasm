/** Browser / Worker / Node: decode PCM WAV and encode Yamaha ADPCM-B.
 * No AudioContext is created. Other formats can use an injected decodeAudio.
 */
/** @param {unknown} source @param {{signal?: AbortSignal, decodeAudio?: (bytes: ArrayBuffer) => Promise<AudioBuffer | import("./wav.js").ChannelPCM>}} [options] */
export async function readSamplePCM(source, {signal, decodeAudio} = {}) {
  signal?.throwIfAborted();
  if (source?.channels) return source;
  if (typeof source?.getChannelData === 'function') {
    return {sampleRate: source.sampleRate, channels: Array.from(
      {length: source.numberOfChannels}, (_, i) => source.getChannelData(i))};
  }
  if (typeof source === 'string' || source instanceof URL) {
    const node = typeof process !== 'undefined' && process.versions?.node;
    if (node && (source instanceof URL ? source.protocol === 'file:' :
        !/^(https?:|data:|blob:)/i.test(source))) {
      const {readFile} = await import('node:fs/promises');
      source = await readFile(typeof source === 'string' && source.startsWith('file:') ? new URL(source) : source, {signal});
    } else {
      const response = await fetch(source, {signal});
      if (!response.ok) throw new Error(`Sample: HTTP ${response.status}`);
      source = await response.arrayBuffer();
    }
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) source = await source.arrayBuffer();
  signal?.throwIfAborted();
  if (source instanceof Uint8Array) source = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  if (!(source instanceof ArrayBuffer)) throw new TypeError('Expected decoded PCM, AudioBuffer, WAV bytes, Blob, path or URL');
  const view = new DataView(source);
  const text = (offset, length) => Array.from({length}, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('');
  if (view.byteLength < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') {
    if (!decodeAudio) throw new TypeError('Expected PCM/Float RIFF WAV; other formats require decodeAudio');
    return readSamplePCM(await decodeAudio(source), {signal});
  }
  const end = view.getUint32(4, true) + 8;
  if (end > view.byteLength || end < 12) throw new RangeError('Truncated WAV');
  let format, data;
  for (let offset = 12; offset + 8 <= end;) {
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + size > end) throw new RangeError('Truncated WAV chunk');
    const tag = text(offset, 4);
    if (tag === 'fmt ') {
      if (size < 16) throw new RangeError('Invalid WAV format');
      format = {type: view.getUint16(start, true), count: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true), block: view.getUint16(start + 12, true),
        bits: view.getUint16(start + 14, true)};
    } else if (tag === 'data' && !data) data = {start, size};
    offset = start + size + (size & 1);
  }
  if (!format || !data) throw new TypeError('WAV requires fmt and data chunks');
  const {type, count, sampleRate, block, bits} = format;
  if (!((type === 1 && [8, 16, 24, 32].includes(bits)) || (type === 3 && [32, 64].includes(bits)))) {
    if (decodeAudio) return readSamplePCM(await decodeAudio(source), {signal});
    throw new TypeError('Supported WAV: PCM 8/16/24/32-bit or float 32/64-bit');
  }
  if (count < 1 || count > 32 || !sampleRate || block !== count * bits / 8 || data.size % block) throw new RangeError('Invalid WAV layout');
  const frames = data.size / block;
  const channels = Array.from({length: count}, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < count; channel++) {
    const offset = data.start + i * block + channel * bits / 8;
    let value;
    if (type === 3) value = bits === 32 ? view.getFloat32(offset, true) : view.getFloat64(offset, true);
    else if (bits === 8) value = (view.getUint8(offset) - 128) / 128;
    else if (bits === 16) value = view.getInt16(offset, true) / 32768;
    else if (bits === 32) value = view.getInt32(offset, true) / 2147483648;
    else {
      let raw = view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2) << 16;
      if (raw & 0x800000) raw -= 0x1000000;
      value = raw / 8388608;
    }
    channels[channel][i] = value;
  }
  return {channels, sampleRate};
}

/** Greedy encoder matching ymfm ADPCM-B: high nibble first, signed 16-bit
 * predictor, initial step 127 and Yamaha's multiplicative step adjustment.
 * Linear interpolation handles rate conversion; pad with encoded silence to
 * the chip's 32-byte addressing boundary (64 decoded frames).
 * @param {import('./wav.js').ChannelPCM} pcm Mono/multichannel PCM; channels are averaged before encoding.
 * @param {number} outputRate Target decoded samples per second.
 * @param {number} [maxBytes=0x200000] Maximum encoded size in bytes.
 * @returns Encoded ADPCM-B bytes and playback metadata.
 */
export function encodeAdpcmB({channels, sampleRate}, outputRate, maxBytes = 0x200000) {
  if (!Array.isArray(channels) || !channels.length || channels.length > 32 ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) throw new TypeError('Invalid PCM');
  const length = channels[0]?.length;
  if (!Number.isSafeInteger(length) || !length || channels.some(c => c.length !== length)) throw new RangeError('Invalid PCM channel lengths');
  const frames = Math.max(1, Math.round(length * outputRate / sampleRate));
  const byteLength = Math.ceil(frames / 64) * 32;
  if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) throw new RangeError('Sample exceeds ADPCM-B memory');
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (const channel of channels) {
      if (!Number.isFinite(channel[i])) throw new TypeError('Nonfinite PCM');
      value += Math.max(-1, Math.min(1, channel[i])) / channels.length;
    }
    mono[i] = value;
  }
  const bytes = new Uint8Array(byteLength), scales = [57, 57, 57, 57, 77, 102, 128, 153];
  let predictor = 0, step = 127;
  for (let i = 0; i < byteLength * 2; i++) {
    let target = 0;
    if (i < frames) {
      const position = Math.min(i * sampleRate / outputRate, length - 1);
      const first = Math.floor(position), fraction = position - first;
      const value = mono[first] * (1 - fraction) + mono[Math.min(first + 1, length - 1)] * fraction;
      target = Math.round(value * (value < 0 ? 32768 : 32767));
    }
    let best = 0, bestValue = 0, error = Infinity;
    for (let code = 0; code < 16; code++) {
      const delta = Math.floor((2 * (code & 7) + 1) * step / 8) * (code & 8 ? -1 : 1);
      const value = Math.max(-32768, Math.min(32767, predictor + delta));
      if (Math.abs(value - target) < error) { best = code; bestValue = value; error = Math.abs(value - target); }
    }
    bytes[i >> 1] |= best << (i & 1 ? 0 : 4);
    predictor = bestValue;
    step = Math.max(127, Math.min(24576, Math.floor(step * scales[best & 7] / 64)));
  }
  return {bytes, frames, paddedFrames: byteLength * 2, sampleRate: outputRate};
}
