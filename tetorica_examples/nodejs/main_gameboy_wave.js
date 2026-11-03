/** Game Boy DMG: two pulse channels, wave RAM and noise → 48 kHz stereo WAV. */
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {GameboyApu} from '../../web/gameboyapu.js';
import moduleFactory from '../../docs/generated/gameboy_apu_wasm.js';
import {encodeStereoWav} from '../../docs/vgm_analyzer/vgm_wav.js';

async function main() {
  const chip = await GameboyApu.create({moduleFactory, sampleRate: 48000,
    moduleOptions: {wasmBinary: await readFile(new URL('../../docs/generated/gameboy_apu_wasm.wasm', import.meta.url))},
  });
  try {
    // Register offsets are relative to 0xFF10, not absolute Game Boy addresses.
    const write = (offset, value) => chip.writeRegister(offset, value);
    const chunks = [];
    const render = seconds => chunks.push(chip.generateStereo(Math.round(chip.sampleRate() * seconds)));
    const silence = () => { write(0x02, 0); write(0x07, 0); write(0x0a, 0); write(0x11, 0); };
    const pan = (channel, left, right) => write(0x15, (left ? 1 << (channel + 4) : 0) | (right ? 1 << channel : 0));
    function pulse(channel, hz, duty, sweep = 0) {
      const frequency = Math.max(0, Math.min(2047, Math.round(2048 - 131072 / hz)));
      const base = channel === 0 ? 0 : 5;
      if (channel === 0) write(0, sweep); // NR10: only pulse 1 has sweep.
      write(base + 1, duty << 6);
      write(base + 2, 0xa0); // Initial volume 10, constant envelope.
      write(base + 3, frequency & 255);
      write(base + 4, 0x80 | (frequency >> 8)); // Trigger; length counter disabled.
    }
    function wave(hz) {
      const frequency = Math.max(0, Math.min(2047, Math.round(2048 - 65536 / hz)));
      write(0x0a, 0); // Disable wave DAC before replacing wave RAM.
      // Original 32-sample, 4-bit triangle; two samples packed into each byte.
      const triangle = i => i < 16 ? i : 31 - i;
      for (let i = 0; i < 16; i++) write(0x20 + i, (triangle(i * 2) << 4) | triangle(i * 2 + 1));
      write(0x0a, 0x80); write(0x0b, 0); write(0x0c, 0x40); // Half volume.
      write(0x0d, frequency & 255); write(0x0e, 0x80 | (frequency >> 8));
    }
    function noise(short = false) {
      write(0x10, 0); write(0x11, 0xa2); // Volume 10, decaying envelope.
      write(0x12, 0x43 | (short ? 8 : 0)); // Compare 15-bit and 7-bit LFSR.
      write(0x13, 0x80);
    }
    chip.reset();
    write(0x16, 0x80); // NR52: power on before setting other registers.
    write(0x14, 0x33); // NR50: moderate left/right master volume.
    const voices = [() => pulse(0, 440, 2, 0x16), () => pulse(1, 660, 1), () => wave(220), () => noise()];
    for (let channel = 0; channel < 4; channel++) {
      silence(); pan(channel, channel !== 1, channel !== 0);
      voices[channel](); render(0.45); silence(); render(0.15);
    }
    // Mix all four physical channels: pulse melody/harmony, wave bass, noise beat.
    write(0x15, 0xff);
    const melody = [440, 523.25, 659.25, 587.33, 523.25, 440, 392, 440];
    for (let step = 0; step < melody.length; step++) {
      pulse(0, melody[step], 2); pulse(1, melody[step] / 2, 1);
      wave(110); noise(step % 2 === 1); render(0.2);
    }
    silence(); render(0.3);
    const frames = chunks.reduce((n, chunk) => n + chunk.left.length, 0);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let offset = 0;
    for (const chunk of chunks) { left.set(chunk.left, offset); right.set(chunk.right, offset); offset += chunk.left.length; }
    const output = process.argv[2] ?? new URL('./gameboy.wav', import.meta.url);
    await writeFile(output, encodeStereoWav(left, right, chip.sampleRate()));
    console.log(`Saved: ${output instanceof URL ? fileURLToPath(output) : output}`);
    console.log(`Game Boy DMG: ${chip.sampleRate()} Hz, ${frames} frames (4.3 seconds)`);
  } finally { chip.dispose(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
