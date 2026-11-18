// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth} from '../../tetorica_src/runtime/scspsynth.js';
import {createScspValidation} from '../js/playground_scsp.js';
import {EXAMPLE_FILES, MODE_EXAMPLE_FILES, MODE_DEFAULT_CODES} from './playground_examples.js';
import {reconcileModeProject} from './playground_mode_starters.js';

const examplePath = '/examples/scsp/scsp-cycle2-prototype.js';
const source = await readFile(new URL('.'+examplePath, import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('cycle2 is an exact editable SCSP example and restoration preserves user code and run selection',()=>{
  assert.equal(EXAMPLE_FILES.filter(file=>file.path===examplePath).length,1);
  assert.equal(MODE_EXAMPLE_FILES.scsp.find(file=>file.path===examplePath)?.data,source);
  for(const [mode,files]of Object.entries(MODE_EXAMPLE_FILES))if(mode!=='scsp')assert(!files.some(file=>file.path===examplePath),mode);
  const original={version:1,modeId:'scsp',activePath:'/index.js',runPath:'/index.js',directories:[],files:[{path:'/index.js',data:'// my running code'}]};
  const options={targetModeId:'scsp',codeChoice:'keep',defaults:MODE_DEFAULT_CODES,allExampleFiles:EXAMPLE_FILES,targetExampleFiles:MODE_EXAMPLE_FILES.scsp};
  const restored=reconcileModeProject(original,options);
  assert.equal(restored.files.find(file=>file.path===examplePath).data,source);
  assert.equal(restored.files.find(file=>file.path==='/index.js').data,'// my running code');
  assert.equal(restored.activePath,'/index.js');assert.equal(restored.runPath,'/index.js');assert.equal(original.files.length,1);
  const edited={...original,activePath:examplePath,runPath:examplePath,files:[...original.files,{path:examplePath,data:'// my cycle edit'}]};
  const retained=reconcileModeProject(edited,options);
  assert.equal(retained.files.find(file=>file.path===examplePath).data,'// my cycle edit');
  assert.equal(retained.activePath,examplePath);assert.equal(retained.runPath,examplePath);
});

function harness(create) {
  const events = [], prepared = new Map(), loops = new Map(), cleanups = new Map();
  let creationCount = 0;
  const evaluate = code => new AsyncFunction('createSoundChip', 'livePrepare', 'setBpm',
    'scale', 'liveLoop', 'choose', 'beat', 'liveCleanup', 'log', 'console', code)(
    async (name, options) => {
      assert.equal(name, 'scsp');
      assert.deepEqual(options, {id: 'scsp-cycle2-prototype'});
      creationCount++;
      const chip = await create();
      Object.defineProperty(chip, 'id', {value: options.id});
      return new Proxy(chip, {get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value !== 'function' ? value : (...args) => {
          events.push([key, ...args]);
          return value.apply(target, args);
        };
      }});
    },
    async (name, prepare) => {
      assert.equal(name, 'scsp-cycle2-prototype-setup');
      if (!prepared.has(name)) prepared.set(name, await prepare());
      return prepared.get(name);
    },
    bpm => assert.equal(bpm, 120),
    (root, kind, octaves) => {
      assert.deepEqual([root, kind, octaves], ['E3', 'minorPentatonic', 2]);
      return ['E3', 'G3'];
    },
    (name, callback) => loops.set(name, callback),
    notes => notes[0],
    async beats => events.push(['beat', beats]),
    (names, callback) => cleanups.set(names.join(','), callback),
    (...args) => events.push(['log', ...args]),
    {table: rows => events.push(['table', rows])},
  );
  return {events, loops, cleanups, evaluate, creations: () => creationCount};
}

test('the actual prototype owns a dedicated client, retains setup on reevaluation and retunes without retrigger', async t => {
  const chip = createScspValidation();
  t.after(() => chip.dispose());
  const h = harness(async () => chip);
  await h.evaluate(source);
  await h.evaluate(source); // Playground re-Run / Apply-style reevaluation.
  assert.equal(h.creations(), 1);
  assert.equal(h.events.filter(([method]) => method === 'loadPCM').length, 1);
  assert.equal(h.events.filter(([method]) => method === 'setPreset').length, 2);
  assert.deepEqual(h.events.filter(([method]) => method === 'keyOn').map(([, slot]) => slot), [6, 7]);
  assert.equal(h.events.filter(([method]) => method === 'setModulation').length, 4);
  assert.equal(h.events.filter(([method]) => method === 'reset').length, 0);
  assert.equal(h.loops.size, 1);
  assert.equal(h.cleanups.size, 1);
  assert.deepEqual(h.events.find(([method]) => method === 'table')[1], [
    {slot: 6, source: 7, x: 33, y: 1, depth: 8, word: '0x8841', input: 'avg(B[n-1], B[n-2])'},
    {slot: 7, source: 6, x: 63, y: 63, depth: 8, word: '0x8FFF', input: 'A[n]'},
  ]);
  const before = h.events.length;
  await h.loops.get('scsp-cycle2-melody')();
  assert.deepEqual(h.events.slice(before).map(([method]) => method), ['setNote', 'setFrequency', 'beat']);
  assert.deepEqual(h.events.at(-1), ['beat', 0.5]);
  assert.equal(chip.getState().slots[6].gate, true);
  assert.equal(chip.getState().slots[7].gate, true);
  h.cleanups.get('scsp-cycle2-melody')();
  assert.deepEqual(h.events.slice(-2), [['keyOff', 6], ['keyOff', 7]]);
  assert.equal(chip.getState().slots[6].gate, false);
  assert.equal(chip.getState().slots[7].gate, false);
});

test('failed PCM preparation releases only the newly created prototype instance', async () => {
  let disposed = 0;
  const h = harness(async () => ({
    loadPCM() { throw new Error('test upload failure'); },
    dispose() { disposed++; },
  }));
  await assert.rejects(h.evaluate(source), /test upload failure/);
  assert.equal(h.creations(), 1);
  assert.equal(disposed, 1);
  assert.equal(h.loops.size, 0);
});

test('the unchanged example executes through the public SCSP adapter and real WASM with guarded PCM and live depth', async t => {
  const module = await factory({wasmBinary: await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url))});
  const core = await Scsp.create({moduleFactory: () => module});
  const chip = new ScspSynth(core);
  t.after(() => chip.dispose());
  const h = harness(async () => chip);
  await h.evaluate(source);
  const state = chip.getState();
  assert.equal(state.samples.length, 1);
  assert.equal(state.samples[0].length, 64);
  assert.equal(state.samples[0].loopStartSamples, 0);
  assert.equal(state.samples[0].modulationDepth, 12);
  assert.equal(core.read(6 * 32 + 14), 0x8841, 'A reads the previous one/two-frame B history average');
  assert.equal(core.read(7 * 32 + 14), 0x8fff, 'B duplicates the current-frame earlier A output');
  assert.equal(state.slots[6].directLevel, 0);
  assert.equal(state.slots[7].directLevel, 5);
  assert(state.slots.every((slot, index) => slot.gate === (index === 6 || index === 7)));
  const ram = core.readRam();
  let peak = 0;
  for (let i = 0; i < 4; i++) {
    await h.loops.get('scsp-cycle2-melody')();
    const output = chip.generateStereo(2048);
    for (const channel of [output.left, output.right]) for (const value of channel) {
      assert(Number.isFinite(value));
      peak = Math.max(peak, Math.abs(value));
    }
  }
  assert(peak > 1e-4 && peak < 1, `finite, nonzero example output: ${peak}`);
  assert.deepEqual(core.readRam(), ram, 'retuning does not rewrite PCM or its guard padding');
  const gatesBefore = h.events.filter(([method]) => method === 'keyOn').length;
  await h.evaluate(source.replace('const feedbackDepth = 8;', 'const feedbackDepth = 0;')
    .replace('const forwardDepth = 8;', 'const forwardDepth = 0;'));
  assert.equal(core.read(6 * 32 + 14), 0, 'existing adapter depth 0 disconnects both inputs');
  assert.equal(core.read(7 * 32 + 14), 0);
  assert(h.events.filter(([method]) => method === 'table').at(-1)[1].every(row => row.word === '0x0000'));
  assert.equal(h.creations(), 1);
  assert.equal(h.events.filter(([method]) => method === 'keyOn').length, gatesBefore);
  assert(chip.getState().slots[6].gate && chip.getState().slots[7].gate);
  assert.deepEqual(core.readRam(), ram);
  // Native independent recurrence/host-rate evidence belongs to the dedicated
  // probe, not to an example test using the same adapter as its implementation.
});
