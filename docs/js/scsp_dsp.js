// SPDX-License-Identifier: BSD-3-Clause
import {validateScspDspRegisterProgram} from './scsp_dsp_program.js';
import {coefficientWord, resolveCoefficientPatch, validateScspDspProgramOptions} from './scsp_dsp_coefficients.js';
import {SCSP_DSP_DELAY_RAM_BYTES, createScspDspDelayProgram, createScspDspDelaySilence,
  resolveScspDspDelay, validateScspDspDelayRam} from './scsp_dsp_delay.js';

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

/** Per-instance SCSP DSP program, coefficient and managed Delay owner.
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
  #delay = null;
  #ram = null;

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
      profile: this.#delay ? 'delay-ring' : 'ram-free',
      configured: this.#configured,
      words: Array.from(this.#program),
      revision: this.#revision,
      coefficients: this.readCoefficients(),
      return: {...this.#return},
      ...(this.#delay ? {delay: {...this.#delay}, ram: {...this.#ram}} : {}),
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

  #returnWord(outputReturn, delay) {
    return delay && !delay.enabled ? 0 : (outputReturn.level << 5) | outputReturn.pan;
  }

  #readRing(ram) {
    if (typeof this.#core.readRam !== 'function' || typeof this.#core.loadRam !== 'function') {
      throw new TypeError('SCSP DSP Delay requires readable and writable owned RAM');
    }
    const bytes = this.#core.readRam(ram.address, ram.byteLength);
    if (!(bytes instanceof Uint8Array) || bytes.length !== SCSP_DSP_DELAY_RAM_BYTES) {
      throw new TypeError('SCSP DSP Delay requires a complete RAM reservation snapshot');
    }
    return bytes.slice();
  }

  #commit(program, codes, outputReturn, force = false, delay = this.#delay, ram = this.#ram) {
    const changedProgram = !program.every((word, index) => word === this.#program[index]);
    const changedProfile = Boolean(delay) !== Boolean(this.#delay) || ram?.address !== this.#ram?.address;
    const install = force || !this.#configured || changedProgram || changedProfile;
    const changedCodes = codes.flatMap((value, index) => force || value !== this.#codes[index] ? [index] : []);
    const returnWord = this.#returnWord(outputReturn, delay);
    const changedReturn = returnWord !== this.#returnWord(this.#return, this.#delay);
    const changedTime = delay && delay.timeMs !== this.#delay?.timeMs;
    const changedEnabled = delay && delay.enabled !== this.#delay?.enabled;
    const configureRing = delay && (install || changedTime);
    const clearRing = delay && (install || changedTime || changedEnabled);
    if (!install && !changedCodes.length && !changedReturn && !clearRing) {
      this.#return = outputReturn;
      return;
    }

    const previousProgram = install ? Uint16Array.from(this.#program,
      (word, index) => this.#read(0x800 + index * 2, word)) : null;
    const previousCodes = changedCodes.map(index => this.#read(0x700 + index * 2, coefficientWord(this.#codes[index])));
    const restoreReturn = install || clearRing || changedReturn;
    const previousReturn = restoreReturn ? this.#read(22, this.#returnWord(this.#return, this.#delay)) : null;
    const previousAddress = configureRing
      ? [0x402, 0x780, 0x782].map(offset => this.#read(offset, 0)) : null;
    const previousRing = clearRing ? this.#readRing(ram) : null;
    try {
      if (install || clearRing) this.#core.write(22, 0, 0xff);
      if (configureRing) {
        this.#core.write(0x402, (2 << 7) | (ram.address / 8192), 0x1bf);
        this.#core.write(0x780, Math.round(delay.timeMs * 44.1));
        this.#core.write(0x782, 0);
      }
      for (const index of changedCodes) this.#core.write(0x700 + index * 2, coefficientWord(codes[index]));
      if (install) this.#upload(program);
      if (clearRing) this.#core.loadRam(createScspDspDelaySilence(), ram.address);
      if (restoreReturn) this.#core.write(22, returnWord, 0xff);
    } catch (error) {
      const failures = [];
      const restore = callback => {
        try { callback(); } catch (failure) { failures.push(failure); }
      };
      if (install) restore(() => this.#upload(previousProgram));
      for (let position = 0; position < changedCodes.length; position++) {
        restore(() => this.#core.write(0x700 + changedCodes[position] * 2, previousCodes[position]));
      }
      if (configureRing) {
        for (const [index, offset] of [0x402, 0x780, 0x782].entries()) {
          restore(() => this.#core.write(offset, previousAddress[index]));
        }
      }
      if (clearRing) restore(() => this.#core.loadRam(previousRing, ram.address));
      if (restoreReturn) restore(() => this.#core.write(22, previousReturn, 0xff));
      rollbackFailure(error, failures);
    }
    this.#program = program;
    this.#codes = codes;
    this.#return = outputReturn;
    this.#delay = delay ? {...delay} : null;
    this.#ram = ram ? {...ram} : null;
    this.#configured = true;
    if (changedProgram) this.#revision++;
  }

  applyProgram(words, options) {
    const program = validateScspDspRegisterProgram(words);
    const setup = validateScspDspProgramOptions(options);
    const codes = setup ? resolveCoefficientPatch(setup.coefficients, this.#codes).next : [...this.#codes];
    this.#commit(program, codes, {...this.#return}, false, null, null);
    return this.readProgram();
  }

  /** Install the fixed Delay inside an allocator-owned, bounded packed ring. */
  setDelay(patch, reservation) {
    const delay = resolveScspDspDelay(patch, this.#delay ?? undefined);
    const ram = validateScspDspDelayRam(reservation);
    const codes = this.#delay ? [...this.#codes] : [4095, 0, 4095];
    codes[1] = Math.floor(delay.feedback * 4096);
    this.#commit(createScspDspDelayProgram(), codes, {...this.#return}, false, delay, ram);
    return this.readProgram();
  }

  setCoefficients(patch) {
    const {next} = resolveCoefficientPatch(patch, this.#codes);
    const delay = this.#delay ? {...this.#delay, feedback: next[1] / 4096} : null;
    this.#commit(this.#program, next, {...this.#return}, false, delay);
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
    checkKeys(snapshot, ['profile', 'configured', 'words', 'revision', 'coefficients', 'return', 'delay', 'ram'], 'SCSP DSP snapshot');
    const hasDelay = snapshot.profile === 'delay-ring';
    if (Reflect.ownKeys(snapshot).length !== (hasDelay ? 8 : 6) || !['ram-free', 'delay-ring'].includes(snapshot.profile) ||
        typeof snapshot.configured !== 'boolean' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new TypeError('Invalid SCSP DSP snapshot');
    }
    let delay = null, ram = null;
    let program;
    if (hasDelay) {
      delay = resolveScspDspDelay(snapshot.delay);
      ram = validateScspDspDelayRam(snapshot.ram);
      program = createScspDspDelayProgram();
      if (!snapshot.configured || Reflect.ownKeys(snapshot.delay).length !== 3 ||
          snapshot.delay.feedback !== delay.feedback ||
          !(snapshot.words instanceof Uint16Array || Array.isArray(snapshot.words)) ||
          snapshot.words.length !== program.length || !program.every((word, index) => word === snapshot.words[index])) {
        throw new TypeError('Invalid managed SCSP DSP Delay snapshot');
      }
    } else {
      program = validateScspDspRegisterProgram(snapshot.words);
    }
    checkKeys(snapshot.coefficients, ['codes'], 'SCSP DSP coefficient snapshot');
    if (Reflect.ownKeys(snapshot.coefficients).length !== 1 || !Array.isArray(snapshot.coefficients.codes) ||
        snapshot.coefficients.codes.length !== 3) throw new TypeError('Invalid SCSP DSP coefficient snapshot');
    const codes = resolveCoefficientPatch(Object.fromEntries(snapshot.coefficients.codes.map((code, index) => [index, code])), [0, 0, 0]).next;
    if (hasDelay && codes[1] / 4096 !== delay.feedback) throw new TypeError('SCSP DSP Delay feedback must match COEF1');
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
    this.#delay = delay;
    this.#ram = ram;
    return this.readProgram();
  }
}
