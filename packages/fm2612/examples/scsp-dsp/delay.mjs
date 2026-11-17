// SPDX-License-Identifier: BSD-3-Clause
// Unpublished source-build example: npm 0.2.43 does not include setDspDelay().
import {readFile, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
import factory from 'tetorica-fm2612/generated/scsp_wasm.js';
import {Scsp} from 'tetorica-fm2612/scsp.js';
import {ScspSynth} from 'tetorica-fm2612/scspsynth.js';
import {disassembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';

/** Render an original short note and its hardware-DSP echoes without a device. */
export async function runDelayExample() {
  const wasmBinary = await readFile(runtimeAssetUrl('generated/scsp_wasm.wasm'));
  const module = await factory({wasmBinary});
  const core = await Scsp.create({moduleFactory: () => module});
  const synth = new ScspSynth(core);
  try {
    const pcm = Int16Array.from({length: 64}, (_, i) =>
      Math.round(4096 * Math.sin(2 * Math.PI * i / 64)));
    const sample = synth.loadPCM(pcm, {baseFrequencyHz: 44100 / 64, loopStartSamples: 0});
    const original = core.readRam(sample.address, sample.byteLength);
    synth.setPreset(0, {
      sample, totalLevel: 0, directLevel: 0, dspSend: 7,
      envelope: {attackRate: 31, releaseRate: 31},
    });
    synth.setDspDelay({enabled: true, timeMs: 240, feedback: 0.35});
    synth.setDspReturn({level: 7, pan: 0});
    synth.noteOn(0, 'A3');
    const held = synth.generateStereo(2205); // 50 ms of input, initially wet-silent.
    synth.noteOff(0);
    const tail = synth.generateStereo(44100);
    const setup = synth.getDspProgram();
    const after = core.readRam(sample.address, sample.byteLength);
    const pcmUnchanged = original.every((value, index) => value === after[index]);
    const tailPeak = tail.left.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    if (!pcmUnchanged || !tailPeak) throw new Error('Delay output or PCM preservation failed');
    return {
      sampleRate: 44100, held, tail, tailPeak, pcmUnchanged,
      delay: setup.delay, ram: setup.ram,
      source: disassembleScspDsp(setup.words),
    };
  } finally {
    synth.dispose();
  }
}

const entry = process.argv[1] && await realpath(process.argv[1]).catch(() => null);
if (entry === await realpath(fileURLToPath(import.meta.url))) {
  const result = await runDelayExample();
  console.table([{sampleRate: result.sampleRate, tailFrames: result.tail.left.length,
    tailPeak: result.tailPeak, pcmUnchanged: result.pcmUnchanged,
    timeMs: result.delay.timeMs, feedback: result.delay.feedback,
    ringBytes: result.ram.byteLength}]);
  console.log(result.source);
  console.log('SCSP DSP Delay: PASS');
}
