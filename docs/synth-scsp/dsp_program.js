// SPDX-License-Identifier: BSD-3-Clause
// The Synth and Playground share the same executable instruction validation.
export {validateScspDspDelayProgram, checkScspDspDelaySource} from '../js/scsp_dsp_program.js';
import {validateScspDspDelayProgram, validateScspDspRegisterProgram} from '../js/scsp_dsp_program.js';
import {assembleScspDsp, disassembleScspDsp} from './dsp_assembler.js';

/** Synth owns its existing packed Delay ring plus two RAM-free effect returns.
 * Keep the mono Delay validator unchanged; RAM programs cannot use EFREG1. */
export function validateScspSynthDspProgram(words) {
  // Both profiles inspect the same owned image. In particular, a caller's
  // array getter must not run again when the mono profile rejects EWA=1.
  let candidate = words;
  if ((words instanceof Uint16Array || Array.isArray(words)) && words.length === 512) {
    candidate = new Array(512);
    for (let index = 0; index < 512; index++) candidate[index] = words[index];
  }
  try { return validateScspDspDelayProgram(candidate); }
  catch (delayError) {
    try { return validateScspDspRegisterProgram(candidate); }
    catch { throw delayError; }
  }
}

/** Parse without touching the audio owner, retaining source line diagnostics. */
export function checkScspSynthDspSource(source) {
  let words;
  try { words = assembleScspDsp(source); }
  catch (error) {
    const line = /^Line (\d+):/.exec(error.message);
    if (line) error.line = Number(line[1]);
    throw error;
  }
  try { words = validateScspSynthDspProgram(words); }
  catch (error) {
    const index = source.split(/\r\n|\n|\r/).findIndex(line => {
      const match = /^\s*(\d+)\s*:/.exec(line);
      return match && Number(match[1]) === error.step;
    });
    if (index >= 0) {
      error.line = index + 1;
      error.message = `Line ${error.line}: ${error.message}`;
    }
    throw error;
  }
  const listing = disassembleScspDsp(words);
  return {words, listing, stepCount: listing ? listing.trimEnd().split('\n').length : 0, wordCount: 512};
}
