/** Original mono PCM → BRR, JSON metrics and real S-DSP stereo WAV. */
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {encodeBrr} from '../../web/snes_brr_encoder.js';
import {SnesDspCore} from '../../web/spc.js';
import {SnesSynth} from '../../web/snessynth.js';
import moduleFactory from '../../docs/generated/spc_wasm.js';
import {encodeStereoWav} from '../../docs/vgm_analyzer/vgm_wav.js';

// Usage: node examples/nodejs/main_snes_pcm_brr.js [/tmp/snes-pcm-brr]
// The optional argument is a prefix; .brr, .json and .wav are appended.
const outputPrefix = process.argv[2] ?? fileURLToPath(new URL('./snes-pcm-brr', import.meta.url));
const sampleRate = 32000;
const pcm = Float32Array.from({length:128}, (_, i) =>
  0.75 * Math.sin(2 * Math.PI * i / 128));
// encodeBrr does not resample. One 128-frame cycle is 250 Hz at native PITCH=4096.
const baseFrequencyHz = sampleRate / pcm.length;
const loopStartSamples = 0;
const encoded = encodeBrr(pcm, {loopStartSamples});
const core = await SnesDspCore.create({moduleFactory,
  moduleOptions:{wasmBinary:await readFile(new URL('../../docs/generated/spc_wasm.wasm', import.meta.url))}});
const snes = new SnesSynth({core});
try {
  // Raw BRR contains no tuning metadata; retain these options beside the file.
  const sampleOptions = {baseFrequencyHz, loopStartSamples};
  const sample = snes.loadBRR(encoded.brr, sampleOptions);
  snes.setPreset(0, {
    sample, adsr1:0x8f, adsr2:0xe0, gain:127,
    volumeLeft:80, volumeRight:80,
  });
  const chunks = [];
  const render = seconds => {
    const frames = Math.round(seconds * sampleRate);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    snes.renderInto(left, right, frames);
    chunks.push({left, right});
  };
  for (const note of ['C4', 'E4', 'G4', 'C5', 'G4', 'E4']) {
    snes.setNote(0, note);
    snes.keyOn(0); render(0.25);
    snes.keyOff(0); render(0.05);
  }
  render(0.2); // Include the hardware KOFF release and a quiet tail.
  const frames = chunks.reduce((total, chunk) => total + chunk.left.length, 0);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let offset = 0;
  for (const chunk of chunks) {
    left.set(chunk.left, offset); right.set(chunk.right, offset);
    offset += chunk.left.length;
  }
  const {brr, ...conversion} = encoded;
  await writeFile(`${outputPrefix}.brr`, brr);
  await writeFile(`${outputPrefix}.json`, JSON.stringify({
    sampleRate, sampleOptions, byteLength:brr.length, ...conversion,
    // Conversion errors compare raw decoded BRR with PCM, before S-DSP playback.
    playback:{sampleRate, frames, seconds:frames / sampleRate},
  }, null, 2) + '\n');
  await writeFile(`${outputPrefix}.wav`, encodeStereoWav(left, right, sampleRate));
  console.log(`Saved: ${outputPrefix}.{brr,json,wav} (${brr.length} BRR bytes, ${frames} DSP frames)`);
} finally {
  snes.dispose(); // SnesSynth owns and disposes this core.
}
