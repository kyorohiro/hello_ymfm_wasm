// SPDX-License-Identifier: BSD-3-Clause
import {validateScspDspRegisterProgram} from './scsp_dsp_program.js';
import {coefficientWord, resolveCoefficientPatch, validateScspDspProgramOptions} from './scsp_dsp_coefficients.js';

function checkKeys(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value) ||
      Reflect.ownKeys(value).some(key => !allowed.includes(key))) {
    throw new TypeError(`Invalid ${name}`);
  }
}

function resolveReturn(patch, previous) {
  checkKeys(patch, ['level', 'pan'], 'SCSP DSP return');
  const next = {...previous, ...patch};
  if (!Number.isInteger(next.level) || next.level < 0 || next.level > 7) {
    throw new RangeError('SCSP DSP return level must be 0..7');
  }
  if (!Number.isInteger(next.pan) || next.pan < 0 || next.pan > 31) {
    throw new RangeError('SCSP DSP return pan must be 0..31');
  }
  return next;
}

function rollbackFailure(error, failures) {
  if (failures.length) {
    const fatal = new Error(
      'SCSP DSP update failed and rollback could not restore the audio owner. Restart audio before continuing.',
      {cause: new AggregateError([error, ...failures])},
    );
    fatal.name = 'ScspDspRollbackError';
    fatal.fatal = true;
    throw fatal;
  }
  throw error;
}

/** Per-instance register-only SCSP DSP program and coefficient owner.
 * Construction and snapshot adoption perform no core writes. Explicit settings
 * start the DSP, preserving PCM allocation, voices and existing TEMP history.
 */
export class ScspDspProgram {
  #core;
  #program = new Uint16Array(512);
  #codes = [0, 0, 0];
  #return = {level: 0, pan: 0};
  #configured = false;
  #revision = 0;

  constructor(core) {
    if (!core || typeof core.write !== 'function') {
      throw new TypeError('SCSP DSP requires an owned core with register writes');
    }
    this.#core = core;
  }

  readCoefficients() {
    return {codes: [...this.#codes]};
  }

  readProgram() {
    return {
      profile: 'ram-free',
      configured: this.#configured,
      words: Array.from(this.#program),
      revision: this.#revision,
      coefficients: this.readCoefficients(),
      return: {...this.#return},
    };
  }

  #read(offset, fallback) {
    return typeof this.#core.read === 'function' ? this.#core.read(offset) : fallback;
  }

  #upload(program) {
    for (let index = 0; index < program.length; index++) {
      this.#core.write(0x800 + index * 2, program[index]);
    }
    // Word504 is the Start register and must be written after the complete image.
    this.#core.write(0xbf0, program[504]);
  }

  #commit(program, codes, outputReturn, force = false) {
    const changedProgram = !program.every((word, index) => word === this.#program[index]);
    const install = force || !this.#configured || changedProgram;
    const changedCodes = codes.flatMap((value, index) => force || value !== this.#codes[index] ? [index] : []);
    const changedReturn = outputReturn.level !== this.#return.level || outputReturn.pan !== this.#return.pan;
    if (!install && !changedCodes.length && !changedReturn) return;

    const previousProgram = install ? Uint16Array.from(this.#program,
      (word, index) => this.#read(0x800 + index * 2, word)) : null;
    const previousCodes = changedCodes.map(index => this.#read(0x700 + index * 2, coefficientWord(this.#codes[index])));
    const previousReturn = install || changedReturn
      ? this.#read(22, (this.#return.level << 5) | this.#return.pan) : null;
    try {
      if (install) this.#core.write(22, 0, 0xff);
      for (const index of changedCodes) this.#core.write(0x700 + index * 2, coefficientWord(codes[index]));
      if (install) this.#upload(program);
      if (install || changedReturn) this.#core.write(22, (outputReturn.level << 5) | outputReturn.pan, 0xff);
    } catch (error) {
      const failures = [];
      const restore = callback => {
        try { callback(); } catch (failure) { failures.push(failure); }
      };
      if (install) restore(() => this.#upload(previousProgram));
      for (let position = 0; position < changedCodes.length; position++) {
        restore(() => this.#core.write(0x700 + changedCodes[position] * 2, previousCodes[position]));
      }
      if (install || changedReturn) restore(() => this.#core.write(22, previousReturn, 0xff));
      rollbackFailure(error, failures);
    }
    this.#program = program;
    this.#codes = codes;
    this.#return = outputReturn;
    this.#configured = true;
    if (changedProgram) this.#revision++;
  }

  applyProgram(words, options) {
    const program = validateScspDspRegisterProgram(words);
    const setup = validateScspDspProgramOptions(options);
    const codes = setup ? resolveCoefficientPatch(setup.coefficients, this.#codes).next : [...this.#codes];
    this.#commit(program, codes, {...this.#return});
    return this.readProgram();
  }

  setCoefficients(patch) {
    const {next} = resolveCoefficientPatch(patch, this.#codes);
    this.#commit(this.#program, next, {...this.#return});
    return this.readCoefficients();
  }

  setReturn(patch) {
    const next = resolveReturn(patch, this.#return);
    this.#commit(this.#program, [...this.#codes], next);
    return {...this.#return};
  }

  ensureStarted() {
    this.#commit(this.#program, [...this.#codes], {...this.#return});
    return this.readProgram();
  }

  /** Reinstall acknowledged setup after the owning core has been reset. */
  restore() {
    try {
      if (this.#configured) this.#commit(this.#program, [...this.#codes], {...this.#return}, true);
    } catch (error) {
      if (error.fatal) throw error;
      const fatal = new Error(
        'SCSP DSP setup could not be restored after reset. Restart audio before continuing.',
        {cause: error},
      );
      fatal.name = 'ScspDspRestoreError';
      fatal.fatal = true;
      throw fatal;
    }
    return this.readProgram();
  }

  /** Trusted transport staging copies metadata into a validation-only owner. */
  adoptState(snapshot) {
    checkKeys(snapshot, ['profile', 'configured', 'words', 'revision', 'coefficients', 'return'], 'SCSP DSP snapshot');
    if (Reflect.ownKeys(snapshot).length !== 6 || snapshot.profile !== 'ram-free' ||
        typeof snapshot.configured !== 'boolean' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new TypeError('Invalid SCSP DSP snapshot');
    }
    const program = validateScspDspRegisterProgram(snapshot.words);
    checkKeys(snapshot.coefficients, ['codes'], 'SCSP DSP coefficient snapshot');
    if (Reflect.ownKeys(snapshot.coefficients).length !== 1 || !Array.isArray(snapshot.coefficients.codes) ||
        snapshot.coefficients.codes.length !== 3) throw new TypeError('Invalid SCSP DSP coefficient snapshot');
    const codes = resolveCoefficientPatch(Object.fromEntries(snapshot.coefficients.codes.map((code, index) => [index, code])), [0, 0, 0]).next;
    checkKeys(snapshot.return, ['level', 'pan'], 'SCSP DSP return snapshot');
    if (Reflect.ownKeys(snapshot.return).length !== 2) throw new TypeError('Invalid SCSP DSP return snapshot');
    const outputReturn = resolveReturn(snapshot.return, {level: 0, pan: 0});
    if (!snapshot.configured && (snapshot.revision || program.some(Boolean) || codes.some(Boolean) || outputReturn.level || outputReturn.pan)) {
      throw new TypeError('Unconfigured SCSP DSP snapshot must contain initial values');
    }
    this.#program = program;
    this.#codes = codes;
    this.#return = outputReturn;
    this.#configured = snapshot.configured;
    this.#revision = snapshot.revision;
    return this.readProgram();
  }
}
