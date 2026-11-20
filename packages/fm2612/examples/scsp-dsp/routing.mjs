// SPDX-License-Identifier: BSD-3-Clause
// Installed-package example: two-bus routing requires tetorica-fm2612 0.2.45+.
import {readFile, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
import factory from 'tetorica-fm2612/generated/scsp_wasm.js';
import {Scsp} from 'tetorica-fm2612/scsp.js';
import {ScspSynth} from 'tetorica-fm2612/scspsynth.js';
import {assembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';

export const routingSource = `
; MIXS0 -> Gain -> EFREG0; MIXS1 -> IIR -> EFREG1.
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
002: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
003: XSEL=1 YSEL=1 IRA=33 BSEL=1 COEF=2
004: TWT=1 TWA=0 EWT=1 EWA=1 ZERO=1
`;

function reference(input, codes) {
  let history = 0;
  const left = new Float32Array(input.length), right = new Float32Array(input.length);
  for (const [index, sample] of input.entries()) {
    const gained = Math.floor(sample * 256 * codes[0] / 4096);
    history = Math.max(-0x800000, Math.min(0x7fffff,
      Math.floor(history * codes[1] / 4096) + Math.floor(sample * 256 * codes[2] / 4096)));
    left[index] = Math.floor(gained / 256) / 32768;
    right[index] = Math.floor(history / 256) / 32768;
  }
  return {left, right};
}

/** Render two independent DSP paths into owned PCM, without an audio device. */
export async function runRoutingExample() {
  const wasmBinary = await readFile(runtimeAssetUrl('generated/scsp_wasm.wasm'));
  const module = await factory({wasmBinary});
  const core = await Scsp.create({moduleFactory: () => module});
  const synth = new ScspSynth(core);
  try {
    // The initial zeros avoid the first attack frame; both slots advance by one.
    const pcm = new Int16Array(512);
    pcm[8] = 8192;
    const sample = synth.loadPCM(pcm, {
      baseFrequencyHz: 44100 / pcm.length, loopStartSamples: 0,
    });
    const ram = core.readRam();
    const codes = [4095, 3840, 256];
    synth.applyDspProgram(assembleScspDsp(routingSource), {
      coefficients: {0: codes[0], 1: codes[1], 2: codes[2]},
    });
    for (const channel of [0, 1]) synth.setPreset(channel, {
      sample, frequencyHz: sample.rootFrequencyHz, totalLevel: 0,
      directLevel: 0, dspSend: 7, dspInput: channel,
    });
    synth.setDspReturn(0, {level: 7, pan: 31});
    synth.setDspReturn(1, {level: 7, pan: 15});
    synth.keyOn(0); synth.keyOn(1);
    const actual = synth.generateStereo(pcm.length), expected = reference(pcm, codes);
    const exact = actual.left.every((value, index) => value === expected.left[index]) &&
      actual.right.every((value, index) => value === expected.right[index]);
    const after = core.readRam();
    const ramUnchanged = ram.every((value, index) => value === after[index]);
    if (!exact || !ramUnchanged) throw new Error('Two-bus DSP output or PCM RAM check failed');
    const setup = synth.getDspProgram();
    synth.stopVoices();
    const stopped = synth.generateStereo(128);
    if (stopped.left.some(Boolean) || stopped.right.some(Boolean)) throw new Error('Stop left DSP output');
    return {sampleRate: 44100, source: routingSource, coefficients: codes,
      actual, reference: expected, exact, ramUnchanged, setup};
  } finally {synth.dispose();}
}

const entry = process.argv[1] && await realpath(process.argv[1]).catch(() => null);
if (entry === await realpath(fileURLToPath(import.meta.url))) {
  const result = await runRoutingExample();
  console.table([{frames: result.actual.left.length, exact: result.exact,
    ramUnchanged: result.ramUnchanged,
    leftPeak: Math.max(...result.actual.left.map(Math.abs)),
    rightPeak: Math.max(...result.actual.right.map(Math.abs))}]);
  console.log({returns: result.setup.returns, coefficients: result.setup.coefficients});
  console.log('SCSP DSP routing: PASS');
}
