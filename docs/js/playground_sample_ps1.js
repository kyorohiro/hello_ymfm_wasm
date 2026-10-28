// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
/** Browser / Worker / Node: non-destructive Sample Editor to PS1 SPU ADPCM.
 * This is the canonical conversion used by the editor and instrument loader.
 * No native instance, AudioContext, device or live chip is created here.
 */
import {normalizeSampleEdit, renderSampleEdit} from './playground_sample_edit.js?v=audio-numeric-bindings-1';
import {encodePs1Adpcm, DEFAULT_PS1_ADPCM_MAX_BYTES} from './ps1_adpcm_encoder.js?v=ps1-adpcm-encoder-1';

const SAMPLE_RATE = 44100;
const BLOCK_FRAMES = 28;
const DISPLAY_POINTS = 256;
const FILTERS = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];

/** Raw packet reconstruction, before SPU pitch interpolation, ADSR and mixing.
 * Arithmetic follows the pinned BSD decoder in third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/spu.cpp. Encoder
 * packets never depend on signed-short overflow, but retain its wrap semantics.
 */
function decodePackets(adpcm) {
  const output = new Float32Array(adpcm.length / 16 * BLOCK_FRAMES);
  let previous = 0, previous2 = 0;
  for (let offset = 0, frame = 0; offset < adpcm.length; offset += 16) {
    const header = adpcm[offset], [a, b] = FILTERS[header >> 4], shift = header & 15;
    for (let i = 0; i < BLOCK_FRAMES; i++, frame++) {
      const packed = adpcm[offset + 2 + (i >> 1)], nibble = (packed >> ((i & 1) * 4)) & 15;
      const signed = nibble < 8 ? nibble : nibble - 16;
      const sum = ((signed << 12) >> shift) + ((previous * a + previous2 * b + 32) >> 6);
      const decoded = (sum << 16) >> 16;
      output[frame] = decoded / 32768;
      previous2 = previous; previous = decoded;
    }
  }
  return output;
}

function byteBudget(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Reflect.ownKeys(options).some(key => key !== 'maxBytes')) throw new TypeError('Invalid PS1 sample conversion options');
  const {maxBytes = DEFAULT_PS1_ADPCM_MAX_BYTES} = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 16 || maxBytes > DEFAULT_PS1_ADPCM_MAX_BYTES) {
    throw new RangeError(`PS1 sample maxBytes must be an integer from 16 to ${DEFAULT_PS1_ADPCM_MAX_BYTES}`);
  }
  return maxBytes;
}

/** Render edited mono PCM at 44,100 Hz, then encode complete SPU packets.
 * Root MIDI and cents describe the input frequency at hardware PITCH 4096;
 * they never resample the recording. All edit positions refer to original PCM.
 *
 * Loop boundaries are first converted to native-rate crop-relative frames,
 * then moved INWARD to 28-frame packet boundaries. The complete intro before
 * the loop is retained; data after the applied loop end is omitted. A loop
 * with no complete packet is rejected. Requested/applied positions are always
 * returned, even when equal, so the caller can explain alignment explicitly.
 * One-shots retain every edited frame and zero-pad their last ADPCM packet.
 *
 * maxBytes is the available contiguous sample-RAM budget, not total SPU RAM.
 * The whole edited selection must fit that budget before resampling, even when
 * its loop end would discard a long tail. This bounds the temporary native-rate
 * PCM allocation; the caller can shorten the selection without losing source.
 * Oversized results are rejected before encoding and never silently truncated.
 * Channels, ADPCM and decodedChannels are independent owned copies.
 * @param {any} audio
 * @param {any} [settings]
 * @param {{maxBytes?:number}} [options]
 */
export function renderPs1Sample(audio, settings = {}, options = {}) {
  const maxBytes = byteBudget(options), edit = normalizeSampleEdit(audio, settings);
  const nativeFrames = Math.max(1, Math.round((edit.endFrame - edit.startFrame) * SAMPLE_RATE / audio.sampleRate));
  const maxNativeFrames = Math.floor(maxBytes / 16) * BLOCK_FRAMES;
  if (nativeFrames > maxNativeFrames) {
    throw new RangeError(`PS1 edited selection needs ${nativeFrames} native frames; the available sample RAM allows ${maxNativeFrames}. Shorten the selection; the original recording is preserved.`);
  }
  const requestedStart = Math.max(0, Math.min(nativeFrames - 1,
    Math.round((edit.loopStartFrame - edit.startFrame) * SAMPLE_RATE / audio.sampleRate)));
  const requestedEnd = Math.max(requestedStart + 1, Math.min(nativeFrames,
    Math.round((edit.loopEndFrame - edit.startFrame) * SAMPLE_RATE / audio.sampleRate)));
  const appliedStart = edit.loopEnabled ? Math.ceil(requestedStart / BLOCK_FRAMES) * BLOCK_FRAMES : 0;
  const appliedEnd = edit.loopEnabled ? Math.floor(requestedEnd / BLOCK_FRAMES) * BLOCK_FRAMES : nativeFrames;
  if (edit.loopEnabled && appliedEnd - appliedStart < BLOCK_FRAMES) {
    throw new RangeError('PS1 ADPCM loop must contain a complete 28-frame packet after inward alignment. Widen the loop range.');
  }
  const requiredBytes = Math.ceil(appliedEnd / BLOCK_FRAMES) * 16;
  if (requiredBytes > maxBytes) throw new RangeError(`PS1 ADPCM needs ${requiredBytes} bytes; maxBytes is ${maxBytes}. Shorten the selection or loop end.`);

  const rendered = renderSampleEdit(audio, edit, {sampleRate: SAMPLE_RATE, mono: true});
  const pcm = edit.loopEnabled ? rendered.channels[0].slice(0, appliedEnd) : rendered.channels[0];
  const encoded = encodePs1Adpcm(pcm, {maxBytes, loopStartSamples: edit.loopEnabled ? appliedStart : null});
  const baseFrequencyHz = 440 * 2 ** ((edit.rootMidi - 69 + edit.tuneCents / 100) / 12);
  return {...rendered, channels: [pcm], baseFrequencyHz,
    loopStartFrame: appliedStart, loopEndFrame: appliedEnd,
    ...encoded, decodedChannels: [decodePackets(encoded.adpcm)],
    alignment: {blockFrames: BLOCK_FRAMES,
      changed: edit.loopEnabled && (requestedStart !== appliedStart || requestedEnd !== appliedEnd),
      requested: {startFrame: requestedStart, endFrame: requestedEnd},
      applied: {startFrame: appliedStart, endFrame: appliedEnd},
      discardedTailFrames: edit.loopEnabled ? nativeFrames - appliedEnd : 0}};
}

function displayCopy(input) {
  const count = Math.min(DISPLAY_POINTS, input.length);
  return Float32Array.from({length: count}, (_, i) => input[count === 1 ? 0
    : Math.round(i * (input.length - 1) / (count - 1))]);
}

/** Bounded display payload: no full PCM, ADPCM or source-buffer aliases.
 * The source display spans the actual encoded (possibly loop-trimmed) PCM;
 * decoded display includes the final one-shot packet's explicit zero padding.
 */
export function renderPs1SampleComparison(audio, settings = {}, options = {}) {
  const {channels, decodedChannels, adpcm, ...metadata} = renderPs1Sample(audio, settings, options);
  return {...metadata, sourceDisplay: displayCopy(channels[0]), decodedDisplay: displayCopy(decodedChannels[0]),
    sourceFrameCount: channels[0].length, decodedFrameCount: decodedChannels[0].length, byteLength: adpcm.length};
}
