import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612DirectTransport} from 'tetorica-fm2612/ym2612synth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';

// Browser or Node.js 22+. Render offline; no AudioContext is needed.
export async function run({signal} = {}) {
  signal?.throwIfAborted();
  const chip = await createSoundChip('ym2612');
  try {
    signal?.throwIfAborted();
    const transport = new YM2612DirectTransport(chip);
    const synth = new YM2612Synth({transport});
    synth.setPreset(0, FM_PRESETS.sine);
    synth.noteOn(0, 4, 553);
    const sampleRate = chip.sampleRate();
    const {left, right} = transport.generateStereo(sampleRate);
    synth.noteOff(0);
    return encodeWav(left, right, sampleRate);
  } finally {
    chip.dispose();
  }
}

// Stereo, 16-bit little-endian PCM WAV.
function encodeWav(left, right, sampleRate) {
  const dataSize = left.length * 4;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, dataSize, true);
  for (let i = 0; i < left.length; i++) {
    for (const [channel, samples] of [left, right].entries()) {
      const value = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 4 + channel * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
  }
  return new Blob([buffer], {type: 'audio/wav'});
}
