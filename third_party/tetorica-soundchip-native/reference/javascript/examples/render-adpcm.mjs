// SPDX-License-Identifier: BSD-3-Clause
// Offline reference rendering with synthetic data; no game ROM or audio device.
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Msm5205AudioEngine} from '../msm5205audioengine.js';
import {Oki6295AudioEngine} from '../okim6295audioengine.js';

const sampleRate = 22_050;
const frames = sampleRate * 2;
const outputDirectory = path.resolve(process.argv[2] ?? 'build/adpcm-reference');

// Alternating small positive and negative deltas keep the ADPCM step index low.
// Different half-cycle lengths make simple synthetic tones, not recorded audio.
function syntheticNibble(index, halfCycle = 16) {
  return Math.floor((index + halfCycle / 2) / halfCycle) % 2 ? 11 : 3;
}

function renderMsm5205() {
  const engine = new Msm5205AudioEngine({
    clock: 384_000,
    flags: 7, // Four-bit ADPCM with externally supplied VCLK edges.
    outputSampleRate: sampleRate,
  });
  const pcm = {left: new Float32Array(frames), right: new Float32Array(frames)};
  const nibbleRate = 4_000;
  try {
    let offset = 0;
    for (let tick = 0; offset < frames; tick++) {
      engine.writeMsm5205(1, syntheticNibble(tick));
      engine.writeMsm5205(2, 0);
      engine.writeMsm5205(2, 1);
      const end = Math.min(frames, Math.ceil((tick + 1) * sampleRate / nibbleRate));
      const block = engine.processFrames(end - offset);
      pcm.left.set(block.left, offset);
      pcm.right.set(block.right, offset);
      offset = end;
    }
    return pcm;
  } finally {
    engine.dispose();
  }
}

function writeAddress(rom, offset, address) {
  rom[offset] = address >>> 16;
  rom[offset + 1] = address >>> 8;
  rom[offset + 2] = address;
}

function renderOki6295() {
  const engine = new Oki6295AudioEngine({
    clock: 0x80000000 + 1_000_000, // One MHz with pin 7 high: clock / 132.
    outputSampleRate: sampleRate,
  });
  try {
    const rom = new Uint8Array(0x10000).fill(0xff);
    const bytesPerSample = 4_096;
    for (let voice = 0; voice < 4; voice++) {
      const start = 0x400 + voice * bytesPerSample;
      writeAddress(rom, voice * 8, start);
      writeAddress(rom, voice * 8 + 3, start + bytesPerSample - 1);
      for (let byte = 0; byte < bytesPerSample; byte++) {
        const high = syntheticNibble(byte * 2, 16 + voice * 4);
        const low = syntheticNibble(byte * 2 + 1, 16 + voice * 4);
        rom[start + byte] = (high << 4) | low;
      }
    }
    engine.loadOki6295Rom(rom);
    for (let voice = 0; voice < 4; voice++) {
      engine.writeOki6295(0, 0x80 | voice);
      engine.writeOki6295(0, (0x10 << voice) | 3);
    }
    // These finite samples finish naturally; the remaining frames are silent.
    return engine.processFrames(frames);
  } finally {
    engine.dispose();
  }
}

async function writeWave(name, pcm) {
  const channels = 2;
  const bytesPerFrame = channels * 2;
  const dataSize = frames * bytesPerFrame;
  const wave = Buffer.alloc(44 + dataSize);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(36 + dataSize, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); // Linear PCM.
  wave.writeUInt16LE(channels, 22);
  wave.writeUInt32LE(sampleRate, 24);
  wave.writeUInt32LE(sampleRate * bytesPerFrame, 28);
  wave.writeUInt16LE(bytesPerFrame, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(dataSize, 40);
  let peak = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = (channel ? pcm.right : pcm.left)[frame];
      if (!Number.isFinite(value)) throw new Error(`${name}: non-finite PCM`);
      peak = Math.max(peak, Math.abs(value));
      const bounded = Math.max(-1, Math.min(1, value));
      const integer = Math.round(bounded * (bounded < 0 ? 32_768 : 32_767));
      wave.writeInt16LE(integer, 44 + frame * bytesPerFrame + channel * 2);
    }
  }
  if (peak === 0) throw new Error(`${name}: unexpectedly silent PCM`);
  const filename = path.join(outputDirectory, name);
  await writeFile(filename, wave);
  console.log(JSON.stringify({file: filename, frames, sampleRate, channels, peak}));
}

await mkdir(outputDirectory, {recursive: true});
await writeWave('msm5205-synthetic.wav', renderMsm5205());
await writeWave('okim6295-synthetic.wav', renderOki6295());
