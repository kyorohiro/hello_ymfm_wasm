/** Media preparation shared by browser and native playback. Importing this
 * module creates no audio context and opens no output device. */
export function decodeAudioBuffer(context, bytes) {
  return new Promise((resolve,reject) => {
    const failed = error => reject(error && typeof error.message === 'string'
      ? error : new Error(error == null ? 'Unable to decode audio data' : String(error)));
    // Decoders may detach their argument. Preserve the caller's selected bytes.
    const decoding = context.decodeAudioData(bytes.slice(0),resolve,failed);
    // WebKit can use callbacks and return a Promise for the same request.
    decoding?.then(resolve,failed);
  });
}

/** Lazy preparation-only decoder. Never render, connect nodes, or open a live
 * AudioContext just to decode a compressed sample for native playback. */
export function createOfflineAudioDecoder({getSampleRate = () => 48000} = {}) {
  let context, rate;
  return bytes => {
    const Type = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
    if (typeof Type !== 'function') throw new Error('Compressed samples require a browser audio decoder. Use PCM/WAV in this environment.');
    const nextRate = getSampleRate();
    if (!context || rate !== nextRate) {
      context = new Type(2,1,nextRate); rate = nextRate;
    }
    return decodeAudioBuffer(context,bytes);
  };
}

export function normalizeLocalMediaUrl(url) {
  let value = String(url);
  if (value.startsWith('sonic-pi/') && !value.includes('://')) {
    value = `./samples/sonic-pi/${value.slice('sonic-pi/'.length).replaceAll('-','_')}.flac`;
  }
  if (value.startsWith('data:') || value.startsWith('blob:') || typeof location === 'undefined' || !location?.href) return value;
  const resolved = new URL(value,location.href);
  if (resolved.origin !== location.origin) throw new Error('Only same-origin media URLs are allowed in MegaSynth.sample/stream');
  return resolved.href;
}
