// SPDX-License-Identifier: BSD-3-Clause
// Run this installed example with Node to render owned stereo PCM arrays.
import {readFile, realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
import factory from 'tetorica-fm2612/generated/scsp_wasm.js';
import {Scsp} from 'tetorica-fm2612/scsp.js';
import {ScspSynth} from 'tetorica-fm2612/scspsynth.js';
import {assembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';

const gainSource = `
; Multiply MIXS0 by COEF0. The next step emits the preceding accumulator.
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
`;
const iirSource = `
; y[n] = a*y[n-1] + b*x[n], with signed Q12 coefficients.
000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
002: TWT=1 TWA=0 EWT=1 EWA=0 ZERO=1
`;

// Independent integer arithmetic for the fixed core's 24-bit DSP path.
function expectedPCM(kind, input, codes) {
  let previous = 0;
  return Float32Array.from(input, sample => {
    const value = kind === 'gain'
      ? Math.floor(sample * 256 * codes[0] / 4096)
      : Math.floor(previous * codes[1] / 4096) + Math.floor(sample * 256 * codes[2] / 4096);
    previous = Math.max(-0x800000, Math.min(0x7fffff, value));
    return Math.floor(previous / 256) / 32768;
  });
}

async function renderExample(module, kind) {
  const core = await Scsp.create({moduleFactory: () => module});
  const synth = new ScspSynth(core);
  try {
    // The impulse follows the initial attack. Its native source advance is 1.
    const input = new Int16Array(512);
    input[8] = 8192;
    const sample = synth.loadPCM(input, {
      baseFrequencyHz: 44100 / input.length,
      loopStartSamples: 0,
    });
    const ram = core.readRam();
    const source = kind === 'gain' ? gainSource : iirSource;
    const codes = kind === 'gain' ? [2048, 0, 0] : [0, 3840, 256];
    synth.applyDspProgram(assembleScspDsp(source), {
      coefficients: {0: codes[0], 1: codes[1], 2: codes[2]},
    });
    synth.setPreset(0, {
      sample, frequencyHz: sample.rootFrequencyHz,
      totalLevel: 0, directLevel: 0, dspSend: 7,
    });
    synth.setDspReturn({level: 7, pan: 0});
    synth.keyOn(0);
    const {left: actual, right} = synth.generateStereo(input.length);
    const reference = expectedPCM(kind, input, codes);
    const maxError = actual.reduce((error, value, index) =>
      Math.max(error, Math.abs(value - reference[index])), 0);
    const exact = maxError === 0 && actual.every((value, index) => value === right[index]);
    const after = core.readRam();
    const ramUnchanged = ram.every((value, index) => value === after[index]);
    if (!exact || !ramUnchanged) throw new Error(`${kind} output or PCM RAM check failed`);
    return {
      kind, source, frames: actual.length, coefficients: codes,
      actual, reference, exact, maxError, ramUnchanged,
      peak: actual.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
    };
  } finally {
    synth.dispose();
  }
}

/** Render both effects from the installed package, with an independent reference. */
export async function runDspExamples() {
  const wasmBinary = await readFile(runtimeAssetUrl('generated/scsp_wasm.wasm'));
  const module = await factory({wasmBinary});
  const gain = await renderExample(module, 'gain');
  const iir = await renderExample(module, 'iir');
  return {sampleRate: 44100, gain, iir};
}

// Node resolves module paths through symlinks. Normalize the CLI path as well.
const entryPath = process.argv[1] && await realpath(process.argv[1]).catch(() => null);
const modulePath = await realpath(fileURLToPath(import.meta.url));
if (entryPath === modulePath) {
  const results = await runDspExamples();
  console.table([results.gain, results.iir].map(result => ({
    effect: result.kind, frames: result.frames, peak: result.peak,
    maxError: result.maxError, exact: result.exact, ramUnchanged: result.ramUnchanged,
  })));
  console.log('SCSP DSP execution: PASS');
}
