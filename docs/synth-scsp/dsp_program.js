// SPDX-License-Identifier: BSD-3-Clause
import { assembleScspDsp, disassembleScspDsp } from './dsp_assembler.js';

const WORD_COUNT = 512;
const OPAQUE_MASKS = [0x8000, 0x1000, 0, 0x0180];

function stepError(step, message) {
  const error = new RangeError(`Step ${String(step).padStart(3, '0')}: ${message}`);
  error.step = step;
  return error;
}

/** Validate an MPRO image for the Synth's existing packed Delay ring/tables.
 * The lossless assembler intentionally accepts a wider inspection format.
 * @param {Uint16Array | readonly number[]} words
 * @returns {Uint16Array} An owned, validated 512-word image.
 */
export function validateScspDspDelayProgram(words) {
  if (!(words instanceof Uint16Array) && !Array.isArray(words)) {
    throw new TypeError('SCSP DSP words must be a Uint16Array or an array of numbers');
  }
  if (words.length !== WORD_COUNT) {
    throw new RangeError(`SCSP DSP program must contain exactly ${WORD_COUNT} words`);
  }
  const program = new Uint16Array(WORD_COUNT);
  for (let index = 0; index < WORD_COUNT; index++) {
    const value = words[index];
    if (typeof value !== 'number') throw new TypeError(`SCSP DSP word ${index} must be a number`);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RangeError(`SCSP DSP word ${index} must be an integer in 0..65535`);
    }
    program[index] = value;
  }
  for (let step = 0; step < 128; step++) {
    const [word0, word1, word2, word3] = program.subarray(step * 4, step * 4 + 4);
    const instruction = [word0, word1, word2, word3];
    for (let index = 0; index < 4; index++) {
      if (instruction[index] & OPAQUE_MASKS[index]) {
        throw stepError(step, `RAW${index} contains uninterpreted bits unsupported by this execution profile`);
      }
    }
    if (((word1 >>> 6) & 0x3f) > 0x31) {
      throw stepError(step, 'IRA must be 0..49 for the pinned DSP core');
    }
    if (((word1 >>> 13) & 3) === 1 && ((word3 >>> 9) & 0x3f) > 2) {
      throw stepError(step, 'COEF must be 0..2 when YSEL=1, using the existing Delay coefficients');
    }
    if ((word2 & 0x1000) && ((word2 >>> 8) & 0x0f) !== 0) {
      throw stepError(step, 'EWA must be 0 when EWT=1, using the existing EFREG0 return');
    }
    if (word2 & 0x6000) {
      if (!(step & 1)) throw stepError(step, 'MRD / MWT require an odd physical step');
      if (word2 & 0x8000) throw stepError(step, 'TABLE must be 0 for RAM I/O inside the reserved Delay ring');
      if (word3 & 0x8000) throw stepError(step, 'NOFL must be 0 for the packed-format Delay ring');
      if (((word3 >>> 2) & 0x1f) > 1) {
        throw stepError(step, 'MASA must be 0..1 for RAM I/O, using the existing Delay addresses');
      }
    }
  }
  return program;
}

/** Assemble first, then check the narrower executable Synth profile.
 * @param {string} source
 * @returns {{words: Uint16Array, listing: string, stepCount: number, wordCount: number}}
 */
export function checkScspDspDelaySource(source) {
  let words;
  try {
    words = assembleScspDsp(source);
  } catch (error) {
    const line = /^Line (\d+):/.exec(error.message);
    if (line) error.line = Number(line[1]);
    throw error;
  }
  try {
    words = validateScspDspDelayProgram(words);
  } catch (error) {
    // Assembly already verified the grammar. Only locate its physical step.
    const lines = source.split(/\r\n|\n|\r/);
    const index = lines.findIndex(line => {
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
  return { words, listing, stepCount: listing ? listing.trimEnd().split('\n').length : 0, wordCount: WORD_COUNT };
}
