import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SidSynth} from '../../tetorica_src/runtime/sidsynth.js';
import {MODE_STARTERS, selectModeExamples} from './playground_mode_examples.js';
import {MODE_DEFAULT_CODES, MODE_EXAMPLE_FILES} from './playground_examples.js';

test('C64 starter and examples operate real SID register authoring and leave all gates off', async () => {
  const paths = MODE_STARTERS.c64.examples;
  assert.deepEqual(MODE_EXAMPLE_FILES.c64.map(file => file.path), paths);
  assert.equal(MODE_DEFAULT_CODES.c64, await readFile(new URL('./defaults/c64/index.js', import.meta.url), 'utf8'));
  for (const path of ['/defaults/c64/index.js', ...paths]) {
    const writes = [], loops = [], hardware = new Uint8Array(32);
    const sid = new SidSynth({transport:{
      reset() {hardware.fill(0);},
      writeRegister(register, value) {hardware[register] = value; writes.push([register,value]);},
    }});
    sid.initialize();
    const source = await readFile(new URL('.' + path, import.meta.url), 'utf8');
    const run = new (Object.getPrototypeOf(async function() {}).constructor)('sid','setBpm','liveLoop','beat',source);
    await run(sid, bpm => assert(bpm > 0), (name, body) => {assert.match(name,/^sid-/); loops.push(body);}, async () => {});
    assert.equal(loops.length, 1, path);
    for (const loop of loops) await loop();
    assert(writes.length > 40, path);
    for (let voice = 0; voice < 3; voice++) assert.equal(hardware[voice * 7 + 4] & 1, 0, `${path}: gate ${voice}`);
    if (path.includes('triad')) assert.equal(hardware[23] & 7, 7, 'triad uses one shared filter');
    if (path.includes('filter-sweep')) {
      const cutoffs = writes.filter(([register]) => register === 22).map(([,value]) => value);
      assert(new Set(cutoffs).size > 20, 'the held voices receive a live hardware cutoff sweep');
      assert.equal(hardware[24] >> 4, 1, 'sweep uses low-pass');
    }
    sid.dispose();
  }
  const files = paths.map(path => ({path}));
  assert.deepEqual(selectModeExamples(files,'c64'), files);
  assert.deepEqual(selectModeExamples(files,'genesis'), [], 'SID native globals stay out of Genesis');
});
