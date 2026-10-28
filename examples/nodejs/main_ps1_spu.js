// Original filter-zero SPU ADPCM instruments → actual PS1 SPU → stereo WAV.
// Usage: node examples/nodejs/main_ps1_spu.js [/tmp/ps1-spu]
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Ps1Spu} from '../../web/ps1_spu.js';
import {encodeWav} from '../../web/wav.js';
import moduleFactory from '../../docs/generated/ps1_spu_wasm.js';

const prefix = process.argv[2] ?? fileURLToPath(new URL('./ps1-spu', import.meta.url));
const sampleRate = 44100, period = 112;
// This local fixture authors filter-0 packets directly. It is not a general PCM encoder.
function packets(frames, sample, loop) {
  assert.equal(frames % 28, 0);
  const bytes = new Uint8Array(frames / 28 * 16);
  for (let block = 0; block < frames / 28; block++) {
    const offset = block * 16;
    bytes[offset] = 4; // Predictor 0, shift 4: signed nibble × 256.
    bytes[offset + 1] = loop ? (block === 0 ? 6 : 2) : 0;
    if (block === frames / 28 - 1) bytes[offset + 1] = loop ? 3 : 1;
    for (let i = 0; i < 28; i++) {
      const nibble = Math.max(-8, Math.min(7, Math.round(sample(block * 28 + i)))) & 15;
      bytes[offset + 2 + (i >> 1)] |= nibble << ((i & 1) * 4); // Low nibble first.
    }
  }
  return bytes;
}
const loop = packets(period, i => 7 * Math.sin(2 * Math.PI * i / period), true);
const hitFrames = 28 * 240;
let phase = 0;
const hit = packets(hitFrames, i => {
  const t = i / sampleRate;
  phase += 2 * Math.PI * (65 + 120 * Math.exp(-t * 35)) / sampleRate;
  return 7 * Math.sin(phase) * Math.exp(-t * 32);
}, false);
const loopAddress = 0x2000, hitAddress = 0x3000;
const spu = await Ps1Spu.create({moduleFactory,
  moduleOptions:{wasmBinary:await readFile(new URL('../../docs/generated/ps1_spu_wasm.wasm', import.meta.url))}});
try {
  spu.loadRam(loop, loopAddress);
  spu.loadRam(hit, hitAddress);
  spu.write(0x180, 0x3fff); spu.write(0x182, 0x3fff);
  spu.write(0x1aa, 0xc000); // SPU enabled and unmuted; reverb remains disabled.
  function voice(ch, address, left, right) {
    const base = ch * 16;
    spu.write(base, left); spu.write(base + 2, right);
    spu.write(base + 4, 0x1000);
    spu.write(base + 6, address >> 3); spu.write(base + 14, address >> 3);
    spu.write(base + 8, 0x000f); spu.write(base + 10, 8); // Fast attack, 12 ms release.
  }
  voice(0, loopAddress, 0x3fff, 0x2fff);
  voice(23, hitAddress, 0x2fff, 0x3fff); // Exercise the upper key-mask bank.
  const chunks = [];
  const render = seconds => { chunks.push(spu.generateStereo(Math.round(seconds * sampleRate))); };
  const melody = [60, 64, 67, 72, 71, 67, 64, 62];
  for (const midi of melody) {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const pitch = Math.round(4096 * frequency / (sampleRate / period));
    spu.write(4, pitch);
    spu.write(0x188, 1); spu.write(0x18a, 1 << (23 - 16));
    render(0.28);
    spu.write(0x18c, 1); spu.write(0x18e, 1 << (23 - 16));
    render(0.07);
  }
  render(0.2);
  const frames = chunks.reduce((sum, chunk) => sum + chunk.left.length, 0);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let offset = 0, peak = 0, energy = 0;
  for (const chunk of chunks) {
    left.set(chunk.left, offset); right.set(chunk.right, offset); offset += chunk.left.length;
    for (const channel of [chunk.left, chunk.right]) for (const value of channel) {
      assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
  }
  assert.ok(peak > 0 && peak < 1, 'PCM must be audible and unclipped');
  assert.ok(left.slice(-1024).every(value => value === 0) && right.slice(-1024).every(value => value === 0));
  const metadata = {component:'experimental MAME-derived PS1 SPU', sampleRate, frames,
    seconds:frames / sampleRate, voices:[0, 23], peak, rms:Math.sqrt(energy / (frames * 2)),
    loop:{address:loopAddress, bytes:loop.length, frames:period, baseFrequencyHz:sampleRate / period},
    oneShot:{address:hitAddress, bytes:hit.length, frames:hitFrames},
    format:'SPU ADPCM, filter 0, shift 4, low nibble first', final1024FramesSilent:true};
  await writeFile(`${prefix}.wav`, encodeWav({sampleRate, left, right}));
  await writeFile(`${prefix}.json`, JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(`${prefix}.loop.adpcm`, loop); await writeFile(`${prefix}.hit.adpcm`, hit);
  console.log(JSON.stringify({output:`${prefix}.wav`, ...metadata}, null, 2));
} finally { spu.dispose(); }
