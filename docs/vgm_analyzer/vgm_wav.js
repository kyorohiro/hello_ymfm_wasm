// Offline-renders a VgmPlayer to a 16-bit stereo WAV file by pulling
// process() the same way the AudioWorklet output stream does, just without
// real-time pacing.

function wavHeader(totalFrames, sampleRate) {
  const bytes = new Uint8Array(44), v = new DataView(bytes.buffer);
  const tag = (offset, text) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  const dataBytes = totalFrames * 4;
  tag(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, dataBytes, true);
  return bytes;
}

function encodePcm16(left, right, frames) {
  const bytes = new Uint8Array(frames * 4), v = new DataView(bytes.buffer);
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i])), r = Math.max(-1, Math.min(1, right[i]));
    v.setInt16(i * 4, Math.round(l * (l < 0 ? 32768 : 32767)), true);
    v.setInt16(i * 4 + 2, Math.round(r * (r < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

/**
 * Render a playing VgmPlayer to a 16-bit stereo WAV file.
 *
 * Call `player.play()` (after `player.stop()` / `player.reset()` for a clean
 * start) before calling this. Rendering runs as fast as the engine allows,
 * capped at `maxSeconds` of output audio so a looped track still terminates,
 * and yields to the event loop periodically so a caller-supplied
 * `onProgress` can update UI without freezing the page. Rendering advances
 * in `blockFrames`-sized steps, so a natural track end may pad up to
 * `blockFrames - 1` trailing silent samples (negligible at the default size).
 *
 * @param {import('../js/vgmplayer.js').VgmPlayer} player
 * @param {{maxSeconds?: number, startSeconds?: number, blockFrames?: number, onProgress?: (fraction: number) => void}} [options]
 * @returns {Promise<{bytes: Uint8Array, seconds: number, truncated: boolean}>}
 */
export async function renderVgmToWav(player, { maxSeconds = 120, blockFrames = 8192, onProgress, startSeconds = 0 } = {}) {
  if (!Number.isFinite(maxSeconds) || !(maxSeconds > 0)) throw new RangeError('maxSeconds must be finite and positive');
  if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds + maxSeconds > 600) throw new RangeError('startSeconds must be nonnegative; startSeconds + maxSeconds must be <= 600');
  if (!Number.isSafeInteger(blockFrames) || blockFrames < 1 || blockFrames > 1048576) throw new RangeError('Invalid blockFrames');
  const sampleRate = player.sampleRate();
  const maxFrames = Math.max(1, Math.round(maxSeconds * sampleRate));
  const startFrame = Math.round(startSeconds * sampleRate);
  const parts = [];
  const left = new Float32Array(blockFrames), right = new Float32Array(blockFrames);
  let framesRendered = 0, framesProcessed = 0, blocksSinceYield = 0;
  while (framesRendered < maxFrames && (player.isPlaying() || player.queuedFrames > 0)) {
    player.process(left, right, blockFrames);
    const from = Math.min(blockFrames, Math.max(0, startFrame - framesProcessed));
    const frames = Math.min(blockFrames - from, maxFrames - framesRendered);
    if(frames) parts.push(encodePcm16(left.subarray(from), right.subarray(from), frames));
    framesRendered += frames;
    framesProcessed += blockFrames;
    onProgress?.(Math.min(1, framesRendered / maxFrames));
    if (++blocksSinceYield >= 16) {
      blocksSinceYield = 0;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if(startFrame > 0 && framesRendered === 0) throw new RangeError('Start time exceeds rendered track end');
  const truncated = player.isPlaying() || player.queuedFrames > 0;
  onProgress?.(1);
  const header = wavHeader(framesRendered, sampleRate);
  const bytes = new Uint8Array(header.length + framesRendered * 4);
  bytes.set(header, 0);
  let offset = header.length;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return { bytes, seconds: framesRendered / sampleRate, truncated };
}


export function encodeStereoWav(left,right,sampleRate) {
  const data=encodePcm16(left,right,left.length),bytes=new Uint8Array(44+data.length);
  bytes.set(wavHeader(left.length,sampleRate));bytes.set(data,44);return bytes;
}
