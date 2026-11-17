import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleScspDsp } from './dsp_assembler.js';
import { delayProgram } from './dsp.js';
import { checkScspDspDelaySource, validateScspDspDelayProgram } from './dsp_program.js';

test('executable Check retains the built-in Delay image and canonical physical steps', () => {
  const result = checkScspDspDelaySource(`; current packed Delay\n000: XSEL=1 YSEL=1 ZERO=1\n001: XSEL=1 YSEL=1 MRD=1 ZERO=1\n002: XSEL=1 YSEL=1 IWT=1 ZERO=1\n003: XSEL=1 YSEL=1 EWT=1 ZERO=1 COEF=1\n004: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2\n005: XSEL=1 YSEL=1 MWT=1 ZERO=1 MASA=1\n`);
  assert.deepEqual(result.words, delayProgram());
  assert.equal(result.wordCount, 512);
  assert.equal(result.stepCount, 6);
  assert.deepEqual(assembleScspDsp(result.listing), result.words);
  assert.deepEqual(validateScspDspDelayProgram(Array.from(result.words)), result.words);
  const copied = validateScspDspDelayProgram(result.words);
  copied[0] = 1;
  assert.equal(result.words[0], 0);
  assert.deepEqual(checkScspDspDelaySource('; empty'), {
    words: new Uint16Array(512), listing: '', stepCount: 0, wordCount: 512,
  });
});

test('execution profile rejects unsafe semantics with the source line and physical step', () => {
  for (const [instruction, field] of [
    ['001: RAW0=0x8000', 'RAW0'],
    ['001: RAW1=0x1000', 'RAW1'],
    ['001: RAW3=0x80', 'RAW3'],
    ['001: IRA=50', 'IRA'],
    ['002: MRD=1', 'odd'],
    ['002: MWT=1', 'odd'],
    ['001: MRD=1 TABLE=1', 'TABLE'],
    ['001: MWT=1 NOFL=1', 'NOFL'],
    ['001: MRD=1 MASA=2', 'MASA'],
    ['001: YSEL=1 COEF=3', 'COEF'],
    ['001: EWT=1 EWA=1', 'EWA'],
  ]) {
    const step = Number(instruction.slice(0, 3));
    assert.throws(() => checkScspDspDelaySource(`; comment\n\n${instruction}`), error => {
      assert.equal(error.line, 3);
      assert.equal(error.step, step);
      assert.match(error.message, /^Line 3: Step /);
      assert(error.message.includes(field), error.message);
      return true;
    });
    assert.throws(() => validateScspDspDelayProgram(assembleScspDsp(instruction)), error => {
      assert.equal(error.step, step);
      return true;
    });
  }
});

test('Check uses the existing assembler diagnostics and validates full word inputs', () => {
  assert.throws(() => checkScspDspDelaySource('; comment\n003: UNKNOWN=1'), error => {
    assert.equal(error.line, 2);
    assert.match(error.message, /^Line 2: unknown field UNKNOWN$/);
    return true;
  });
  for (const value of [null, {}, new Uint8Array(512), Array(511).fill(0), Array(513).fill(0)]) {
    assert.throws(() => validateScspDspDelayProgram(value));
  }
  for (const value of [-1, 65536, 0.5, NaN, '0', undefined]) {
    const words = Array(512).fill(0);
    words[91] = value;
    assert.throws(() => validateScspDspDelayProgram(words), /word 91/);
  }
  const accepted = checkScspDspDelaySource('001: IRA=49 YSEL=1 COEF=2 MWT=1 MASA=1 ADREB=1 NXADR=1\n003: COEF=63 MASA=31 EWA=15 TABLE=1 NOFL=1\n');
  assert.equal(accepted.stepCount, 4);
  assert.equal(accepted.words.length, 512);
});
