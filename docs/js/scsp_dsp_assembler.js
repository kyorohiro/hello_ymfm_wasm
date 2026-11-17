// SPDX-License-Identifier: BSD-3-Clause
// Provisional field assembly for the pinned SCSP DSP instruction layout.

const STEP_COUNT = 128;
const WORDS_PER_STEP = 4;
const PROGRAM_WORD_COUNT = STEP_COUNT * WORDS_PER_STEP;

// Field positions follow the pinned mame-scsp/scspdsp.cpp instruction decoder.
// The word order is the logical MPRO order used by the JavaScript SCSP API.
const FIELDS = [
  {name: 'TRA', word: 0, shift: 8, maximum: 0x7f},
  {name: 'TWT', word: 0, shift: 7, maximum: 1},
  {name: 'TWA', word: 0, shift: 0, maximum: 0x7f},
  {name: 'XSEL', word: 1, shift: 15, maximum: 1},
  {name: 'YSEL', word: 1, shift: 13, maximum: 3},
  {name: 'IRA', word: 1, shift: 6, maximum: 0x3f},
  {name: 'IWT', word: 1, shift: 5, maximum: 1},
  {name: 'IWA', word: 1, shift: 0, maximum: 0x1f},
  {name: 'TABLE', word: 2, shift: 15, maximum: 1},
  {name: 'MWT', word: 2, shift: 14, maximum: 1},
  {name: 'MRD', word: 2, shift: 13, maximum: 1},
  {name: 'EWT', word: 2, shift: 12, maximum: 1},
  {name: 'EWA', word: 2, shift: 8, maximum: 0x0f},
  {name: 'ADRL', word: 2, shift: 7, maximum: 1},
  {name: 'FRCL', word: 2, shift: 6, maximum: 1},
  {name: 'SHIFT', word: 2, shift: 4, maximum: 3},
  {name: 'YRL', word: 2, shift: 3, maximum: 1},
  {name: 'NEGB', word: 2, shift: 2, maximum: 1},
  {name: 'ZERO', word: 2, shift: 1, maximum: 1},
  {name: 'BSEL', word: 2, shift: 0, maximum: 1},
  {name: 'NOFL', word: 3, shift: 15, maximum: 1},
  {name: 'COEF', word: 3, shift: 9, maximum: 0x3f},
  {name: 'MASA', word: 3, shift: 2, maximum: 0x1f},
  {name: 'ADREB', word: 3, shift: 1, maximum: 1},
  {name: 'NXADR', word: 3, shift: 0, maximum: 1},
];

// RAW fields preserve bits that the current core does not interpret.
const OPAQUE_MASKS = [0x8000, 0x1000, 0x0000, 0x0180];
const FIELD_BY_NAME = new Map(FIELDS.map(field => [field.name, field]));

function unsignedValue(text, lineNumber, fieldName) {
  if (!/^(?:\d+|0[xX][0-9a-fA-F]+)$/.test(text)) {
    throw new SyntaxError(`Line ${lineNumber}: ${fieldName} expects an unsigned decimal or hexadecimal integer`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Line ${lineNumber}: ${fieldName} is outside the supported integer range`);
  }
  return value;
}

function applyField(program, step, name, value, lineNumber) {
  const field = FIELD_BY_NAME.get(name);
  if (field) {
    if (value > field.maximum) {
      throw new RangeError(`Line ${lineNumber}: ${name} must be 0..${field.maximum}`);
    }
    program[step * WORDS_PER_STEP + field.word] |= value << field.shift;
    return;
  }

  const raw = /^RAW([0-3])$/.exec(name);
  if (!raw) throw new SyntaxError(`Line ${lineNumber}: unknown field ${name}`);
  const word = Number(raw[1]);
  const mask = OPAQUE_MASKS[word];
  if (value > 0xffff || (value & ~mask) !== 0) {
    throw new RangeError(`Line ${lineNumber}: ${name} may contain only opaque bits in mask 0x${mask.toString(16).padStart(4, '0')}`);
  }
  program[step * WORDS_PER_STEP + word] |= value;
}

/** Record one physical microstep per line, such as `003: EWT=1 COEF=1`.
 * Missing fields and step positions contain zero. Semicolons start comments.
 * The result contains all 128 steps in logical MPRO word order.
 * @param {string} source
 * @returns {Uint16Array}
 */
export function assembleScspDsp(source) {
  if (typeof source !== 'string') throw new TypeError('SCSP DSP source must be a string');
  const program = new Uint16Array(PROGRAM_WORD_COUNT);
  const lines = source.split(/\r\n|\n|\r/);
  let previousStep = -1;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const code = lines[index].split(';', 1)[0].trim();
    if (!code) continue;
    const instruction = /^(\d+)\s*:\s*(.*)$/.exec(code);
    if (!instruction) {
      throw new SyntaxError(`Line ${lineNumber}: expected a decimal step followed by ':' and field assignments`);
    }
    const step = Number(instruction[1]);
    if (!Number.isInteger(step) || step >= STEP_COUNT) {
      throw new RangeError(`Line ${lineNumber}: step must be 0..${STEP_COUNT - 1}`);
    }
    if (step <= previousStep) {
      throw new SyntaxError(`Line ${lineNumber}: step ${step} must follow step ${previousStep} in strictly increasing order`);
    }
    previousStep = step;

    const seen = new Set();
    let remaining = instruction[2].trim();
    while (remaining) {
      const assignment = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*(\S+)(?:\s+|$)/.exec(remaining);
      if (!assignment) {
        throw new SyntaxError(`Line ${lineNumber}: invalid field assignment ${JSON.stringify(remaining)}`);
      }
      const name = assignment[1].toUpperCase();
      if (seen.has(name)) throw new SyntaxError(`Line ${lineNumber}: duplicate field ${name}`);
      seen.add(name);
      const value = unsignedValue(assignment[2], lineNumber, name);
      applyField(program, step, name, value, lineNumber);
      remaining = remaining.slice(assignment[0].length);
    }
  }
  return program;
}

function copyProgram(words) {
  if (!(words instanceof Uint16Array) && !Array.isArray(words)) {
    throw new TypeError('SCSP DSP words must be a Uint16Array or an array of numbers');
  }
  if (words.length !== PROGRAM_WORD_COUNT) {
    throw new RangeError(`SCSP DSP program must contain exactly ${PROGRAM_WORD_COUNT} words`);
  }
  const program = new Uint16Array(PROGRAM_WORD_COUNT);
  for (let index = 0; index < words.length; index++) {
    const value = words[index];
    if (typeof value !== 'number') throw new TypeError(`SCSP DSP word ${index} must be a number`);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RangeError(`SCSP DSP word ${index} must be an integer in 0..65535`);
    }
    program[index] = value;
  }
  return program;
}

function includeTrailingZeros(options) {
  if (!options || typeof options !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    throw new TypeError('SCSP DSP disassembly options must be a plain object');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== 'includeTrailingZeros') throw new TypeError(`Unknown SCSP DSP disassembly option ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean') {
      throw new TypeError('includeTrailingZeros must be a boolean value');
    }
  }
  return Object.getOwnPropertyDescriptor(options, 'includeTrailingZeros')?.value === true;
}

/** Convert a complete MPRO image into editable field assembly.
 * Intermediate zero steps retain their positions. Compact output ends at the
 * last nonzero step. An all-zero image produces an empty compact string.
 * RAW0..RAW3 retain the bits uninterpreted by the pinned core.
 * @param {Uint16Array | readonly number[]} words
 * @param {{includeTrailingZeros?: boolean}} [options]
 * @returns {string}
 */
export function disassembleScspDsp(words, options = {}) {
  const program = copyProgram(words);
  const keepTrailingZeros = includeTrailingZeros(options);
  let stepCount = STEP_COUNT;
  if (!keepTrailingZeros) {
    while (stepCount > 0 && program.subarray((stepCount - 1) * WORDS_PER_STEP, stepCount * WORDS_PER_STEP).every(value => value === 0)) {
      stepCount--;
    }
  }

  const lines = [];
  for (let step = 0; step < stepCount; step++) {
    const offset = step * WORDS_PER_STEP;
    const assignments = [];
    for (const field of FIELDS) {
      const value = (program[offset + field.word] >>> field.shift) & field.maximum;
      if (value !== 0) assignments.push(`${field.name}=${value}`);
    }
    for (let word = 0; word < WORDS_PER_STEP; word++) {
      const value = program[offset + word] & OPAQUE_MASKS[word];
      if (value !== 0) assignments.push(`RAW${word}=0x${value.toString(16).padStart(4, '0')}`);
    }
    const suffix = assignments.length ? ' ' + assignments.join(' ') : '';
    lines.push(`${String(step).padStart(3, '0')}:${suffix}`);
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}
