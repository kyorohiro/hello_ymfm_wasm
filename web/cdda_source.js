/**
 * CD-DA input preparation for Browser and Node.js.
 * Files stay as interleaved little-endian PCM16 bytes. No full-file Float32
 * decoding, fetching, playback clock or output device is created here.
 */
export const CDDA_SAMPLE_RATE = 44100;
export const CDDA_CHANNELS = 2;
export const CDDA_BYTES_PER_FRAME = 4;
export const CDDA_MAX_TRACK_BYTES = 256 * 1024 * 1024;

function invalid(message) {
  return new Error(`CD-DA: ${message}`);
}

function bytesOf(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  throw invalid('WAV input must be an ArrayBuffer or Uint8Array');
}

function fourCC(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Validate one complete RIFF/WAVE file containing 44.1 kHz stereo PCM16.
 * The returned PCM is a view into the supplied bytes, without a copy. Keep
 * those bytes unchanged until playback is finished. Non-audio RIFF chunks
 * are skipped, including their required odd-length padding byte.
 */
export function parseCddaWav(source) {
  const bytes = bytesOf(source);
  if (bytes.byteLength < 12) throw invalid('truncated RIFF/WAVE header');
  if (fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WAVE') {
    throw invalid('expected little-endian RIFF/WAVE; compressed audio, RIFX and RF64 are unsupported');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize < 4 || riffSize + 8 !== bytes.byteLength) {
    throw invalid('RIFF size must match the complete WAV byte length');
  }
  let format;
  let pcm;
  for (let offset = 12; offset < bytes.byteLength;) {
    if (bytes.byteLength - offset < 8) throw invalid('truncated WAV chunk header');
    const id = fourCC(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    const paddedEnd = end + (size & 1);
    if (end > bytes.byteLength || paddedEnd > bytes.byteLength) {
      throw invalid(`truncated ${id} WAV chunk or padding`);
    }
    if (id === 'fmt ') {
      if (format) throw invalid('multiple WAV fmt chunks are unsupported');
      if (size !== 16 && size !== 18) throw invalid('expected a PCM WAV fmt chunk of 16 or 18 bytes');
      if (size === 18 && view.getUint16(start + 16, true) !== 0) {
        throw invalid('PCM WAV fmt extension must be empty');
      }
      format = {
        tag: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        byteRate: view.getUint32(start + 8, true),
        blockAlign: view.getUint16(start + 12, true),
        bits: view.getUint16(start + 14, true),
      };
    } else if (id === 'data') {
      if (pcm) throw invalid('multiple WAV data chunks are unsupported');
      if (size === 0 || size % CDDA_BYTES_PER_FRAME !== 0) {
        throw invalid('WAV data must contain complete nonempty stereo PCM16 frames');
      }
      pcm = new Uint8Array(bytes.buffer, bytes.byteOffset + start, size);
    }
    offset = paddedEnd;
  }
  if (!format || !pcm) throw invalid('WAV must contain one fmt chunk and one data chunk');
  if (format.tag !== 1 || format.channels !== CDDA_CHANNELS ||
      format.sampleRate !== CDDA_SAMPLE_RATE || format.bits !== 16) {
    throw invalid('only 44100 Hz, stereo, uncompressed PCM16 WAV is supported');
  }
  if (format.blockAlign !== CDDA_BYTES_PER_FRAME ||
      format.byteRate !== CDDA_SAMPLE_RATE * CDDA_BYTES_PER_FRAME) {
    throw invalid('inconsistent WAV PCM block alignment or byte rate');
  }
  return Object.freeze({
    sampleRate: CDDA_SAMPLE_RATE,
    channels: CDDA_CHANNELS,
    frames: pcm.byteLength / CDDA_BYTES_PER_FRAME,
    pcm,
  });
}

function plainRecord(value, label, allowedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalid(`${label} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.includes(key)) throw invalid(`unknown ${label} property: ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw invalid(`${label} properties must be ordinary JSON values`);
    }
  }
}

function frameNumber(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${label} must be a nonnegative safe integer`);
  return value;
}

function trackNumber(value) {
  if (!Number.isInteger(value) || value < 1 || value > 99) throw invalid('track number must be 1..99');
  return value;
}

/**
 * Normalize {tracks:[{number,file,startFrame?,endFrame?,title?,type?:'audio'}]}.
 * Frame ranges are half-open [startFrame,endFrame) in the referenced WAV.
 * Omitted startFrame is zero; omitted endFrame is the end of that file.
 * Track numbers are explicit, unique and preserved. No pregap is inserted.
 */
export function parseCddaTrackManifest(input) {
  let manifest = input;
  if (typeof manifest === 'string') {
    try { manifest = JSON.parse(manifest); }
    catch { throw invalid('track manifest is not valid JSON'); }
  }
  plainRecord(manifest, 'manifest', ['tracks']);
  if (!Object.hasOwn(manifest, 'tracks') || !Array.isArray(manifest.tracks) ||
      manifest.tracks.length < 1 || manifest.tracks.length > 99) {
    throw invalid('manifest must contain 1..99 tracks');
  }
  if (Object.getPrototypeOf(manifest.tracks) !== Array.prototype ||
      Reflect.ownKeys(manifest.tracks).some(key => key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= manifest.tracks.length))) {
    throw invalid('manifest tracks must be an ordinary JSON array');
  }
  const numbers = new Set();
  const tracks = [];
  // Index explicitly so holes in an input array cannot silently skip tracks.
  for (let index = 0; index < manifest.tracks.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(manifest.tracks, index);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw invalid('manifest tracks must be ordinary JSON values without holes');
    }
    const track = descriptor.value;
    plainRecord(track, 'track', ['number', 'file', 'startFrame', 'endFrame', 'title', 'type']);
    if (!Object.hasOwn(track, 'number') || !Object.hasOwn(track, 'file')) throw invalid('track number and file are required');
    const number = trackNumber(track.number);
    if (numbers.has(number)) throw invalid(`duplicate track number: ${number}`);
    numbers.add(number);
    if (Object.hasOwn(track, 'type') && track.type !== 'audio') throw invalid('data tracks are unsupported; track type must be audio');
    if (typeof track.file !== 'string' || !track.file.trim() || track.file.includes('\0')) {
      throw invalid('track file must be a nonempty Virtual Files path without NUL bytes');
    }
    if (Object.hasOwn(track, 'title') && typeof track.title !== 'string') throw invalid('track title must be a string');
    const startFrame = frameNumber(Object.hasOwn(track, 'startFrame') ? track.startFrame : 0, 'startFrame');
    const spec = {number, file: track.file, title: Object.hasOwn(track, 'title') ? track.title : '', startFrame};
    if (Object.hasOwn(track, 'endFrame')) {
      spec.endFrame = frameNumber(track.endFrame, 'endFrame');
      if (spec.endFrame <= startFrame) throw invalid('endFrame must be greater than startFrame');
      if ((spec.endFrame - startFrame) * CDDA_BYTES_PER_FRAME > CDDA_MAX_TRACK_BYTES) {
        throw invalid('selected track PCM exceeds the 256 MiB limit');
      }
    }
    tracks.push(Object.freeze(spec));
  }
  return Object.freeze(tracks);
}

function checkAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('CD-DA loading aborted');
    error.name = 'AbortError';
    if (signal.reason !== undefined) error.cause = signal.reason;
    throw error;
  }
}

function selectTrack(source, spec) {
  const endFrame = spec.endFrame ?? source.frames;
  if (spec.startFrame >= source.frames || endFrame > source.frames) throw invalid(`track ${spec.number} frame range exceeds its WAV source`);
  const frames = endFrame - spec.startFrame;
  const bytes = frames * CDDA_BYTES_PER_FRAME;
  if (bytes > CDDA_MAX_TRACK_BYTES) throw invalid('selected track PCM exceeds the 256 MiB limit');
  return Object.freeze({
    ...spec,
    endFrame,
    frames,
    sourceFrames: source.frames,
    sampleRate: CDDA_SAMPLE_RATE,
    channels: CDDA_CHANNELS,
    pcm: new Uint8Array(source.pcm.buffer, source.pcm.byteOffset + spec.startFrame * CDDA_BYTES_PER_FRAME, bytes),
  });
}

/**
 * Create a lazy source. Only getTrack(number) reads PCM; this object does not
 * retain a cache of all referenced WAV files. readFile(path,{signal}) must
 * return an ArrayBuffer or Uint8Array from the caller's Virtual Files layer.
 * The optional signal applies to the whole source; getTrack can additionally
 * take {signal} for a single pending load. Cancellation is checked after the
 * file await even if readFile itself cannot cancel its work.
 * @param {unknown} manifest
 * @param {{readFile?:(path:string,options?:{signal?:AbortSignal})=>Promise<ArrayBuffer|Uint8Array>,signal?:AbortSignal}} [options]
 */
export function createCddaTrackSource(manifest, {readFile, signal} = {}) {
  checkAborted(signal);
  if (typeof readFile !== 'function') throw invalid('readFile is required for track manifests');
  const tracks = parseCddaTrackManifest(manifest);
  return Object.freeze({
    tracks,
    async getTrack(number, {signal: loadSignal} = {}) {
      checkAborted(signal);
      checkAborted(loadSignal);
      trackNumber(number);
      const spec = tracks.find(track => track.number === number);
      if (!spec) throw invalid(`unknown track number: ${number}`);
      const bytes = await readFile(spec.file, {signal: loadSignal ?? signal});
      checkAborted(signal);
      checkAborted(loadSignal);
      return selectTrack(parseCddaWav(bytes), spec);
    },
  });
}

/** One-track convenience for WAV bytes already held by the caller.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{number?:number,title?:string,signal?:AbortSignal}} [options]
 */
export function createCddaWavTrackSource(bytes, {number = 1, title = '', signal} = {}) {
  checkAborted(signal);
  trackNumber(number);
  if (typeof title !== 'string') throw invalid('track title must be a string');
  const source = parseCddaWav(bytes);
  const spec = Object.freeze({number, title, startFrame: 0});
  const track = selectTrack(source, spec);
  return Object.freeze({
    tracks: Object.freeze([spec]),
    async getTrack(selectedNumber, {signal: loadSignal} = {}) {
      checkAborted(signal);
      checkAborted(loadSignal);
      if (selectedNumber !== number) throw invalid(`unknown track number: ${selectedNumber}`);
      return track;
    },
  });
}

/** Load one selected manifest track without retaining any other source. */
export async function loadCddaTrack(manifest, number, options) {
  const input = Array.isArray(manifest) ? {tracks: manifest} : manifest;
  return createCddaTrackSource(input, options).getTrack(number);
}

/** Explicit eager convenience. Prefer createCddaTrackSource for long albums. */
export async function loadCddaTracks(manifest, options) {
  const source = createCddaTrackSource(manifest, options);
  const tracks = [];
  for (const track of source.tracks) tracks.push(await source.getTrack(track.number));
  return Object.freeze(tracks);
}
