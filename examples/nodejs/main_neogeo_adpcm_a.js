/** Original mono drum kit → ADPCM-A ROM, conversion metadata and real YM2610/B WAV. */
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {encodeAdpcmA} from '../../web/adpcm_a_sample.js';
import {YM2610B_CLOCK} from '../../web/ym2610b.js';
import {Ym2610BAudioEngine} from '../../web/ym2610baudioengine.js';
import {YM2610BSynth, YM2610BDirectTransport} from '../../web/ym2610bsynth.js';
import moduleFactory from '../../docs/generated/ym2610b_wasm.js';
import {encodeStereoWav} from '../../docs/vgm_analyzer/vgm_wav.js';

// Usage: node examples/nodejs/main_neogeo_adpcm_a.js [/tmp/neogeo-adpcm-a] [ym2610|ym2610b]
// The optional first argument is a prefix; .adpcma, .json and .wav are appended.
const outputPrefix = process.argv[2] ?? fileURLToPath(new URL('./neogeo-adpcm-a', import.meta.url));
const variant = process.argv[3] ?? 'ym2610';
if (!['ym2610', 'ym2610b'].includes(variant)) throw new RangeError('Select ym2610 or ym2610b');
const pcmRate = YM2610B_CLOCK / 432;
const names = ['kick', 'snare', 'closed-hat', 'tom', 'wood-block', 'shaker'];
const lengths = [0.25, 0.16, 0.07, 0.21, 0.1, 0.11];
let noiseState = 0x12345678;
function makeDrum(voice) {
  const pcm = new Float32Array(Math.ceil(pcmRate * lengths[voice]));
  let phase = 0, previousNoise = 0;
  for (let i = 0; i < pcm.length; i++) {
    const time = i / pcmRate;
    noiseState ^= noiseState << 13; noiseState ^= noiseState >>> 17; noiseState ^= noiseState << 5;
    const noise = (noiseState >>> 0) / 0x80000000 - 1;
    const highNoise = (noise - previousNoise) * 0.5;
    previousNoise = noise;
    let value;
    if (voice === 0) {
      phase += 2 * Math.PI * (48 + 115 * Math.exp(-time * 35)) / pcmRate;
      value = 0.6 * Math.sin(phase) * Math.exp(-time * 18);
    } else if (voice === 1) {
      value = (0.32 * noise + 0.15 * Math.sin(2 * Math.PI * 185 * time)) * Math.exp(-time * 30);
    } else if (voice === 2) {
      value = 0.3 * highNoise * Math.exp(-time * 70);
    } else if (voice === 3) {
      phase += 2 * Math.PI * (100 + 45 * Math.exp(-time * 25)) / pcmRate;
      value = 0.48 * Math.sin(phase) * Math.exp(-time * 22);
    } else if (voice === 4) {
      value = 0.2 * (Math.sin(2 * Math.PI * 720 * time) +
        0.5 * Math.sin(2 * Math.PI * 1040 * time)) * Math.exp(-time * 55);
    } else {
      value = 0.28 * highNoise * Math.exp(-time * 35) *
        (0.65 + 0.35 * Math.sin(2 * Math.PI * 70 * time));
    }
    const fade = Math.min(1, i / (pcmRate * 0.001), (pcm.length - 1 - i) / (pcmRate * 0.008));
    pcm[i] = value * fade;
  }
  return encodeAdpcmA(pcm);
}
const encoded = names.map((_, voice) => makeDrum(voice));
const rom = new Uint8Array(encoded.reduce((total, entry) => total + entry.bytes.length, 0));
let address = 0;
const voices = encoded.map((entry, voice) => {
  const start = address;
  rom.set(entry.bytes, start);
  address += entry.bytes.length;
  const {bytes, ...conversion} = entry;
  return {voice, name:names[voice], start, end:address, byteLength:bytes.length, ...conversion};
});
// The engine actually advances/resamples the core into 48 kHz output buffers.
// This does not reinterpret the encoded ADPCM-A rate or change playback pitch.
const engine = await Ym2610BAudioEngine.create({moduleFactory, variant:variant === 'ym2610b',
  clock:YM2610B_CLOCK, outputSampleRate:48000, masterVolume:1,
  moduleOptions:{wasmBinary:await readFile(new URL('../../docs/generated/ym2610b_wasm.wasm', import.meta.url))}});
try {
  // A's six voices and memory format are identical on YM2610 and YM2610B.
  // This example does not program FM, SSG or ADPCM-B.
  const synth = new YM2610BSynth({transport:new YM2610BDirectTransport(engine.chip), clock:YM2610B_CLOCK});
  const adpcm = synth.adpcmA;
  const sampleRate = engine.sampleRate();
  await adpcm.loadMemory(rom);
  adpcm.setVolume(56);
  for (const {voice, start, end} of voices) {
    adpcm.setSample(voice, {start, end});
    adpcm.setVoice(voice, {volume:27, left:true, right:true});
  }
  const chunks = [];
  let peak = 0;
  const render = seconds => {
    const chunk = engine.processFrames(Math.round(sampleRate * seconds));
    for (const channel of [chunk.left, chunk.right]) for (const value of channel) {
      if (!Number.isFinite(value)) throw new Error('Non-finite YM2610 PCM');
      peak = Math.max(peak, Math.abs(value));
    }
    chunks.push(chunk);
    return chunk;
  };
  // Hear each voice by itself, including its automatic stop at the ROM end.
  const isolated = [];
  for (const {voice, name} of voices) {
    adpcm.keyOn(voice);
    const chunk = render(0.35);
    const energy = chunk.left.reduce((sum, value) => sum + value * value, 0);
    const tailPeak = chunk.left.slice(-128).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    if (energy <= 1e-6 || tailPeak > 1e-6) throw new Error(`Voice ${voice} must sound and then stop`);
    isolated.push({voice, name, rms:Math.sqrt(energy / chunk.left.length), tailPeak});
  }
  adpcm.keyOn([0, 1, 2, 3, 4, 5]); // Verify all six can mix without clipping.
  render(0.35);
  const steps = [
    [0, 2], [5], [2], [5], [1, 2], [5], [3, 2], [5],
    [0, 2], [5], [0, 2], [5], [1, 2, 4], [5], [3, 2], [4, 5],
  ];
  for (let bar = 0; bar < 2; bar++) for (const active of steps) {
    adpcm.keyOn(active);
    render(0.125); // 120 BPM, sixteenth note.
  }
  render(0.35); // Let the last one-shots end naturally.
  adpcm.keyOff([0, 1, 2, 3, 4, 5]);
  const tail = render(0.1);
  if (peak >= 1) throw new Error(`Clipping in rendered drums (peak ${peak})`);
  if (tail.left.some(value => value !== 0) || tail.right.some(value => value !== 0)) {
    throw new Error('ADPCM-A did not stop');
  }
  const frames = chunks.reduce((total, chunk) => total + chunk.left.length, 0);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let offset = 0;
  for (const chunk of chunks) {
    left.set(chunk.left, offset); right.set(chunk.right, offset);
    offset += chunk.left.length;
  }
  await writeFile(`${outputPrefix}.adpcma`, rom);
  await writeFile(`${outputPrefix}.json`, JSON.stringify({
    chip:variant, clock:YM2610B_CLOCK,
    sourceDecodedRate:pcmRate, nativeOutputRate:engine.chipSampleRate, outputRate:sampleRate,
    byteLength:rom.length, voices,
    // Encoder metrics compare raw ADPCM-A reconstruction with the original PCM.
    playback:{frames, seconds:frames / sampleRate, peak, isolated},
  }, null, 2) + '\n');
  await writeFile(`${outputPrefix}.wav`, encodeStereoWav(left, right, sampleRate));
  console.log(`Saved: ${outputPrefix}.{adpcma,json,wav} (${rom.length} ROM bytes, ${sampleRate} Hz, peak ${peak.toFixed(4)})`);
} finally {
  engine.dispose(); // The engine owns and disposes its chip.
}
