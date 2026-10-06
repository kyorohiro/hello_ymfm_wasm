/** Browser / Worker / Node: decoded mono/stereo PCM -> PCM16 RIFF WAV bytes.
 * Does not create AudioContext, save a file or play audio.
 */
export function encodeWav(pcm, {gain = 1} = {}) {
  const sampleRate = pcm?.sampleRate;
  const channels = typeof pcm?.getChannelData === 'function'
    ? Array.from({length: pcm.numberOfChannels}, (_, i) => pcm.getChannelData(i))
    : pcm?.channels ?? (pcm?.right ? [pcm.left, pcm.right] : [pcm?.left]);
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff) throw new RangeError('WAV sampleRate must be a positive integer');
  if (!Array.isArray(channels) || ![1, 2].includes(channels.length)) throw new TypeError('WAV requires mono or stereo PCM');
  const frames = channels[0]?.length;
  if (!Number.isSafeInteger(frames) || frames < 1 || channels.some(channel => channel?.length !== frames)) throw new RangeError('WAV channel lengths must match and be nonempty');
  if (!Number.isFinite(gain) || gain < 0) throw new RangeError('WAV gain must be finite and nonnegative');
  const blockAlign = channels.length * 2, dataSize = frames * blockAlign;
  if (dataSize > 0xffffffff - 36 || sampleRate * blockAlign > 0xffffffff) throw new RangeError('PCM exceeds RIFF WAV limits');
  const bytes = new Uint8Array(44 + dataSize), view = new DataView(bytes.buffer);
  const writeText = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE'); writeText(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  writeText(36, 'data'); view.setUint32(40, dataSize, true);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < channels.length; channel++) {
    const input = channels[channel][i];
    if (!Number.isFinite(input)) throw new TypeError('WAV PCM must contain finite samples');
    const value = Math.max(-1, Math.min(1, input * gain));
    view.setInt16(44 + i * blockAlign + channel * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
