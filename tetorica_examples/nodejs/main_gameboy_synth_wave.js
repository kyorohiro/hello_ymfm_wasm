/** Shared high-level GameboySynth → stereo WAV. Original raw example is main_gameboy_wave.js. */
import {readFile, writeFile} from 'node:fs/promises';
import {GameboyApu} from '../../web/gameboyapu.js';
import {GameboySynth, GameboyDirectTransport} from '../../web/gameboysynth.js';
import moduleFactory from '../../docs/generated/gameboy_apu_wasm.js';
import {encodeStereoWav} from '../../docs/vgm_analyzer/vgm_wav.js';

const clock = 4194304;
const chip = await GameboyApu.create({clock, sampleRate: 48000, moduleFactory,
  moduleOptions: {wasmBinary: await readFile(new URL('../../docs/generated/gameboy_apu_wasm.wasm', import.meta.url))}});
const gb = new GameboySynth({transport: new GameboyDirectTransport(chip), clock});
try {
  gb.initialize();
  const chunks = [];
  const render = seconds => chunks.push(chip.generateStereo(Math.round(seconds * chip.sampleRate())));
  for (let ch = 0; ch < 2; ch++) {
    gb.pulse.setVoice(ch, {duty: ch ? 0.25 : 0.5, volume: 10, envelope: {period: 2}});
    gb.setPan(ch, ch === 0, ch === 1);
    for (const note of ['C4', 'E4', 'G4']) {
      gb.pulse.setNote(ch, note); gb.pulse.keyOn(ch); render(0.2); gb.pulse.keyOff(ch);
    }
  }
  gb.wave.setNote('C3'); gb.wave.keyOn(); render(0.5); gb.wave.keyOff();
  for (const width of [15, 7]) {
    gb.noise.setVoice({width, envelope: {period: 2}});
    gb.noise.keyOn(); render(0.3); gb.noise.keyOff();
  }
  render(0.1);
  const frames = chunks.reduce((n, c) => n + c.left.length, 0);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let offset = 0;
  for (const c of chunks) { left.set(c.left, offset); right.set(c.right, offset); offset += c.left.length; }
  const output = process.argv[2] ?? new URL('./gameboy-synth.wav', import.meta.url);
  await writeFile(output, encodeStereoWav(left, right, chip.sampleRate()));
  console.log(`Saved: ${output} (${frames} frames)`);
} finally {
  gb.dispose(); // DirectTransport borrows chip; the caller owns native resources.
  chip.dispose();
}
