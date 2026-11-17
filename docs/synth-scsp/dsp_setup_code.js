// SPDX-License-Identifier: BSD-3-Clause
import { disassembleScspDsp } from './dsp_assembler.js';
import { validateScspSynthDspProgram } from './dsp_program.js?v=scsp-dsp-ui-routing-1';
import { EFFECT_DEFAULTS, effectSettings, validateScspDspProgramOptions } from './dsp.js?v=scsp-dsp-ui-routing-1';

function pair(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Reflect.ownKeys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)))
    throw new TypeError('DSP setup requires complete routing pairs');
  const result = Object.fromEntries(fields.map(key => [key, value[key]]));
  for (const key of fields) {
    const maximum = key === 'input' ? 1 : key === 'pan' ? 31 : 7;
    if (!Number.isInteger(result[key]) || result[key] < 0 || result[key] > maximum)
      throw new RangeError(`DSP ${key} must be 0..${maximum}`);
  }
  return result;
}
function routingArray(values, length, nullable = false) {
  if (!Array.isArray(values) || values.length !== length ||
      Array.from({length}, (_, index) => index).some(index => !Object.hasOwn(values, index)))
    throw new TypeError('DSP setup has incomplete routing arrays');
  return values.map(value => nullable && value === null ? null : pair(value, ['input', 'level']));
}
function routingSnapshot(snapshot, effect) {
  const fields = ['dspRouting', 'dspRoutingOverrides', 'dspReturns'];
  if (!fields.some(key => Object.hasOwn(snapshot, key))) return null;
  if (!fields.every(key => Object.hasOwn(snapshot, key))) throw new TypeError('DSP setup has incomplete two-bus routing');
  const route = snapshot.dspRouting, overrides = snapshot.dspRoutingOverrides;
  for (const value of [route, overrides]) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Reflect.ownKeys(value).length !== 2 || !Object.hasOwn(value, 'sources') || !Object.hasOwn(value, 'slots'))
      throw new TypeError('DSP setup requires source and physical-slot routing');
  }
  const effective = {sources: routingArray(route.sources, 6), slots: routingArray(route.slots, 32)};
  const saved = {sources: routingArray(overrides.sources, 6, true), slots: routingArray(overrides.slots, 32, true)};
  for (const key of ['sources', 'slots']) for (let index = 0; index < saved[key].length; index++) {
    const value = saved[key][index];
    if (value && (value.input !== effective[key][index].input || value.level !== effective[key][index].level))
      throw new RangeError('DSP routing and its override disagree');
  }
  if (!Array.isArray(snapshot.dspReturns) || snapshot.dspReturns.length !== 2 ||
      !Object.hasOwn(snapshot.dspReturns, 0) || !Object.hasOwn(snapshot.dspReturns, 1))
    throw new TypeError('DSP setup requires both effect returns');
  const returns = snapshot.dspReturns.map(value => pair(value, ['level', 'pan']));
  if (returns[0].level !== effect.returnLevel) throw new RangeError('DSP output 0 and legacy Return disagree');
  return {overrides: saved, returns};
}

/** Generate editable Code from one acknowledged primary-Synth DSP snapshot. */
export function createScspDspSetupCode(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Expected a complete SCSP DSP setup snapshot');
  }
  const words = validateScspSynthDspProgram(snapshot.words);
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
  const routing = routingSnapshot(snapshot, effect);
  const coefficientFeedback = snapshot.coefficients.feedback;
  if (coefficientFeedback !== effect.feedback || Math.floor(effect.feedback * 4096) !== codes[1]) {
    throw new RangeError('DSP setup snapshot has inconsistent COEF1 and Feedback values');
  }
  const source = disassembleScspDsp(words).trimEnd()
    .replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
  return [
    '// Saved SCSP Synth DSP setup. Run this file to restore it.',
    '// Applies to the primary Synth DSP. SSF owns its separate DSP.',
    '// Uses the current PCM and voices; restores included DSP send / return settings.',
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
    ...(routing ? [
      '',
      '// Synth Auto source templates and physical slots are separate routing targets.',
      ...routing.overrides.sources.map((value, index) => `await scsp.setDspSourceSend(${index}, ${JSON.stringify(value)});`),
      ...routing.overrides.slots.map((value, index) => `await scsp.setDspSend(${index}, ${JSON.stringify(value)});`),
      ...routing.returns.map((value, index) => `await scsp.setDspReturn(${index}, ${JSON.stringify(value)});`),
    ] : []),
    '',
  ].join('\n');
}
