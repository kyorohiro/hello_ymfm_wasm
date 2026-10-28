// Original PCM → PS1 ADPCM loops/one-shots → actual SPU → stereo WAV.
// Usage: node examples/nodejs/main_ps1_adpcm.js [/tmp/ps1-adpcm]
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {encodePs1Adpcm} from '../../web/ps1_adpcm_encoder.js';
import {Ps1Spu} from '../../web/ps1_spu.js';
import {Ps1Synth} from '../../web/ps1synth.js';
import {encodeWav} from '../../web/wav.js';
import moduleFactory from '../../docs/generated/ps1_spu_wasm.js';

const prefix = process.argv[2] ?? fileURLToPath(new URL('./ps1-adpcm', import.meta.url));
const sampleRate = 44100, period = 112;
const loopPcm = Float32Array.from({length:period}, (_, i) =>
  0.65 * Math.sin(2 * Math.PI * i / period));
const hitPcm = Float32Array.from({length:4097}, (_, i) => {
  const time = i / sampleRate;
  // A short authored 220-Hz pluck; its nonaligned length demonstrates padding.
  return 0.5 * Math.sin(2 * Math.PI * 220 * time) * Math.exp(-time * 35) *
    Math.min(1, i / 40) * Math.min(1, (4096 - i) / 200);
});
const loop = encodePs1Adpcm(loopPcm, {loopStartSamples:0});
const hit = encodePs1Adpcm(hitPcm);
assert.equal(loop.paddingFrames, 0);
assert.equal(hit.paddingFrames, 19);
const core = await Ps1Spu.create({moduleFactory,
  moduleOptions:{wasmBinary:await readFile(new URL('../../docs/generated/ps1_spu_wasm.wasm', import.meta.url))}});
const ps1 = new Ps1Synth({core});
try {
  // Preserve explicit tuning beside the bytes: SPU ADPCM has no sample-rate header.
  const loopOptions = {baseFrequencyHz:sampleRate / period, loopStartSamples:0};
  const hitOptions = {baseFrequencyHz:220};
  const loopSample = ps1.loadADPCM(loop.adpcm, loopOptions);
  const hitSample = ps1.loadADPCM(hit.adpcm, hitOptions);
  ps1.setPreset(0, {sample:loopSample, volumeLeft:0.55, volumeRight:0.35, adsr2:8});
  ps1.setPreset(23, {sample:hitSample, volumeLeft:0.3, volumeRight:0.55, adsr2:8});
  const chunks = [];
  const render = seconds => {
    const frames = Math.round(seconds * sampleRate);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    ps1.renderInto(left, right, frames);
    chunks.push({left, right});
  };
  for (const note of ['C4', 'E4', 'G4', 'C5', 'G4', 'E4']) {
    ps1.noteOn(0, note); ps1.noteOn(23, 'A3'); render(0.25);
    ps1.keyOff(0); ps1.keyOff(23); render(0.05);
  }
  ps1.stopVoices(); // The transport fence preserves both samples but clears tails.
  render(0.2);
  const frames = chunks.reduce((total, chunk) => total + chunk.left.length, 0);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let offset = 0, peak = 0, energy = 0;
  for (const chunk of chunks) {
    left.set(chunk.left, offset); right.set(chunk.right, offset);
    offset += chunk.left.length;
    for (const channel of [chunk.left, chunk.right]) for (const value of channel) {
      assert(Number.isFinite(value), 'SPU output must remain finite');
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
  }
  assert(peak > 0.01 && peak < 1, 'Actual SPU playback must be audible and unclipped');
  const tailFrames = Math.round(0.2 * sampleRate);
  assert(left.subarray(-tailFrames).every(value => value === 0));
  assert(right.subarray(-tailFrames).every(value => value === 0));
  const conversion = ({adpcm, ...metadata}, sampleOptions, sample) =>
    ({...metadata, byteLength:adpcm.length, sampleOptions, sample});
  const metadata = {
    component:'experimental MAME-derived PS1 SPU', sampleRate,
    encoding:{resampled:false, normalized:false, inferredTuning:false},
    loop:conversion(loop, loopOptions, loopSample),
    oneShot:conversion(hit, hitOptions, hitSample),
    playback:{sampleRate, frames, seconds:frames / sampleRate, voices:[0, 23],
      peak, rms:Math.sqrt(energy / (frames * 2)), finalSilentFrames:tailFrames},
  };
  await writeFile(`${prefix}.loop.adpcm`, loop.adpcm);
  await writeFile(`${prefix}.hit.adpcm`, hit.adpcm);
  await writeFile(`${prefix}.json`, JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(`${prefix}.wav`, encodeWav({sampleRate, left, right}));
  console.log(JSON.stringify({output:`${prefix}.{loop.adpcm,hit.adpcm,json,wav}`, ...metadata}, null, 2));
} finally {
  ps1.dispose(); // Ps1Synth owns and disposes the underlying WASM instance.
}
