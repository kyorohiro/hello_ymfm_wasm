import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assembleScspDsp, disassembleScspDsp} from '../js/scsp_dsp_assembler.js';
import {EXAMPLE_FILES, MODE_EXAMPLE_FILES, MODE_DEFAULT_CODES, MODE_DEFAULT_HISTORY} from './playground_examples.js';
import {buildExampleBundle} from '../../scripts/build_playground_examples.mjs';
import {reconcileModeProject} from './playground_mode_starters.js';

const path = '/examples/scsp/scsp-dsp-roundtrip.js';
const source = await readFile(new URL('./examples/scsp/scsp-dsp-roundtrip.js', import.meta.url), 'utf8');

test('the editable SCSP DSP example is bundled verbatim and follows the SCSP mode catalog', async () => {
  assert.equal(EXAMPLE_FILES.find(file => file.path === path)?.data, source);
  assert.equal(MODE_EXAMPLE_FILES.scsp.find(file => file.path === path)?.data, source);
  assert(!MODE_EXAMPLE_FILES.genesis.some(file => file.path === path));
  assert.equal(await buildExampleBundle(), await readFile(new URL('./playground_examples.js', import.meta.url), 'utf8'));
});

test('the Files example shows physical words and a complete round trip with the actual pure codec', async () => {
  const logs = [], tables = [];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('assembleScspDsp', 'disassembleScspDsp', 'pg', 'log', 'console', source)(
    assembleScspDsp, disassembleScspDsp, {assembleScspDsp, disassembleScspDsp},
    (...args) => logs.push(args.join(' ')), {table: rows => tables.push(rows)},
  );
  assert(logs.includes('SCSP DSP: 512 words / 128 physical steps'));
  assert(logs.includes('SCSP DSP round trip: PASS'));
  assert(logs.includes('Full listing: 128 physical steps'));
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].map(row => row.step), [0, 1, 2]);
  const canonical = logs.find(line => line.startsWith('Canonical source:\n')).slice('Canonical source:\n'.length);
  const words = assembleScspDsp(canonical);
  for (const row of tables[0]) for (let index = 0; index < 4; index++) {
    assert.equal(Number(row['word' + index]), words[row.step * 4 + index]);
  }
});

test('restoring SCSP Files adds a missing example while retaining edited examples and the current starter', () => {
  const options = {targetModeId: 'scsp', codeChoice: 'keep', defaults: MODE_DEFAULT_CODES,
    allExampleFiles: EXAMPLE_FILES, targetExampleFiles: MODE_EXAMPLE_FILES.scsp};
  const snapshot = {version: 1, modeId: 'scsp', activePath: '/index.js', runPath: '/index.js',
    directories: [], files: [{path: '/index.js', data: '// my melody'}, {path: '/personal.txt', data: 'kept'}]};
  const original = structuredClone(snapshot);
  const fresh = reconcileModeProject(snapshot, options);
  assert.deepEqual(snapshot, original);
  assert.equal(fresh.files.find(file => file.path === path)?.data, source);
  assert.equal(fresh.files.find(file => file.path === '/index.js').data, '// my melody');
  const edited = {...fresh, files: fresh.files.map(file => file.path === path ? {...file, data: '// my DSP edits'} : file)};
  const restored = reconcileModeProject(edited, options);
  assert.equal(restored.files.find(file => file.path === path).data, '// my DSP edits');
  assert.equal(restored.files.find(file => file.path === '/personal.txt').data, 'kept');
});
