import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkScspDspDelaySource} from './dsp_program.js';
import {createScspDspExample} from './dsp_examples.js';

const source = await readFile(new URL('./examples/dsp-iir-motion.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('DSP motion example compiles the checked IIR and keeps independent beat and coefficient loops through Apply', async () => {
  const calls = [], prepared = new Map(), loops = new Map();
  let releaseBeat;
  let firstBeat = true;
  const scsp = {
    compileDsp(text) {
      const words = checkScspDspDelaySource(text).words;
      calls.push(['compile', words]);
      return words;
    },
    async applyDspProgram(words, options) {calls.push(['program', words, options]);},
    async setConfig(config) {calls.push(['config', config]);},
    async setMix(operator, mix) {calls.push(['mix', operator, mix]);},
    async setEffect(effect) {calls.push(['effect', effect]);},
    async noteOn(channel, note) {calls.push(['on', channel, note]);},
    async noteOff(channel) {calls.push(['off', channel]);},
    async setDspCoefficients(patch) {calls.push(['coefficients', patch]);},
  };
  const run = new AsyncFunction('useSoundChip', 'setBpm', 'livePrepare', 'liveLoop', 'scale', 'choose', 'beat', 'tween', 'CH1', source);
  const execute = () => run(
    async chip => {assert.equal(chip, 'scsp'); return scsp;},
    bpm => calls.push(['bpm', bpm]),
    async (name, callback) => {
      if (!prepared.has(name)) prepared.set(name, await callback());
      return prepared.get(name);
    },
    (name, callback) => loops.set(name, callback),
    (root, mode, octaves) => {assert.deepEqual([root, mode, octaves], ['E3', 'minorPentatonic', 2]); return ['E3', 'G3'];},
    notes => notes[0],
    async beats => {
      calls.push(['beat', beats]);
      if (firstBeat) {
        firstBeat = false;
        await new Promise(resolve => {releaseBeat = resolve;});
      }
    },
    async (seconds, callback) => {
      assert.equal(seconds, 4);
      for (const p of [0, 0.25, 0.5, 0.75, 1]) await callback(p);
    },
    0,
  );

  await execute();
  const previousMelody = loops.get('melody');
  await execute(); // Apply replaces named loops without reinitializing the DSP.
  assert.deepEqual([...loops.keys()], ['melody', 'dsp-motion']);
  assert.notEqual(loops.get('melody'), previousMelody);
  assert.equal(calls.filter(([kind]) => kind === 'compile').length, 1);
  const programs = calls.filter(([kind]) => kind === 'program');
  assert.equal(programs.length, 1);
  assert.deepEqual(programs[0][1], createScspDspExample('iir1-lowpass').words);
  assert.deepEqual(programs[0][2], {coefficients: {0: 4095, 1: 3840, 2: 256}});
  assert.deepEqual(calls.filter(([kind]) => ['config', 'mix', 'effect'].includes(kind)), [
    ['config', {mode: 'pcm'}],
    ['mix', 0, {directLevel: 0}],
    ['effect', {enabled: true, send: 7, returnLevel: 7}],
  ]);

  const melody = loops.get('melody')();
  // Yield to the noteOn promise so melody is waiting on its first beat.
  await Promise.resolve();
  assert.equal(typeof releaseBeat, 'function');
  await loops.get('dsp-motion')();
  assert.equal(calls.some(([kind]) => kind === 'off'), false);
  const patches = calls.filter(([kind]) => kind === 'coefficients').map(([, patch]) => patch);
  assert.equal(patches.length, 5);
  for (const patch of patches) {
    assert.deepEqual(Object.keys(patch), ['1', '2']);
    assert.equal(patch[1] + patch[2], 4096);
    assert(patch[1] >= 3072 && patch[1] <= 3968);
    assert(patch[2] >= 128 && patch[2] <= 1024);
  }
  assert.deepEqual([patches[0], patches[2], patches[4]], [
    {1: 3072, 2: 1024}, {1: 3968, 2: 128}, {1: 3072, 2: 1024},
  ]);
  releaseBeat();
  await melody;
  assert.deepEqual(calls.filter(([kind]) => ['on', 'off', 'beat'].includes(kind)), [
    ['on', 0, 'E3'], ['beat', 0.5], ['off', 0], ['beat', 0.25],
  ]);
});
