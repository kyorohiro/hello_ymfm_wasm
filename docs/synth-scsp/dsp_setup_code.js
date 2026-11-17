// SPDX-License-Identifier: BSD-3-Clause
import { disassembleScspDsp } from './dsp_assembler.js';
import { validateScspDspDelayProgram } from './dsp_program.js?v=scsp-dsp-save-1';
import { EFFECT_DEFAULTS, effectSettings, validateScspDspProgramOptions } from './dsp.js?v=scsp-dsp-fir-1';

/** Generate editable Code from one acknowledged primary-Synth DSP snapshot. */
export function createScspDspSetupCode(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Expected a complete SCSP DSP setup snapshot');
  }
  const words = validateScspDspDelayProgram(snapshot.words);
  const codes = snapshot.coefficients?.codes;
  if (!Array.isArray(codes) || codes.length !== 3) {
    throw new TypeError('DSP setup snapshot requires three coefficient codes');
  }
  const options = validateScspDspProgramOptions({
    coefficients: { 0: codes[0], 1: codes[1], 2: codes[2] },
  });
  if (!snapshot.effect || !Object.keys(EFFECT_DEFAULTS).every(key => Object.hasOwn(snapshot.effect, key))) {
    throw new TypeError('DSP setup snapshot requires complete effect settings');
  }
  const effect = effectSettings(snapshot.effect);
  const coefficientFeedback = snapshot.coefficients.feedback;
  if (coefficientFeedback !== effect.feedback || Math.floor(effect.feedback * 4096) !== codes[1]) {
    throw new RangeError('DSP setup snapshot has inconsistent COEF1 and Feedback values');
  }
  const source = disassembleScspDsp(words).trimEnd()
    .replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
  return [
    '// Saved SCSP Synth DSP setup. Run this file to restore it.',
    '// Applies to the primary Synth DSP. SSF owns its separate DSP.',
    '// Uses the current PCM, voices and voice routing.',
    '// PCM, notes and live ring / TEMP history are outside this setup.',
    "const scsp = await useSoundChip('scsp');",
    '',
    'const program = scsp.compileDsp(`',
    source,
    '`);',
    'await scsp.applyDspProgram(program, {',
    '  coefficients: {',
    ...[0, 1, 2].map(index => `    ${index}: ${options.coefficients[index]},`),
    '  },',
    '});',
    'await scsp.setEffect({',
    ...Object.keys(EFFECT_DEFAULTS).map(key => `  ${key}: ${JSON.stringify(effect[key])},`),
    '});',
    '',
  ].join('\n');
}
