import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {OPLSynth,OPL_PRESETS} from '../../web/opl_synth.js';
import {MODE_STARTERS,selectModeExamples} from './playground_mode_examples.js';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
for (const chip of ['ym3812','ym3526','y8950','ymf262']) test(`${chip} starter and native examples run through the actual high-level API`,async () => {
  const paths = [`/defaults/${chip}/index.js`,...MODE_STARTERS[chip].examples];
  for (const path of paths) {
    const writes = [], loops = [], transport = {writeRegister(...args) {writes.push(args);},reset() {}};
    const opl = new OPLSynth({chip,transport}); opl.initialize(); writes.length = 0;
    const api = {opl,OPL_PRESETS,setBpm:bpm => assert.ok(bpm > 0),liveLoop:(_name,run) => loops.push(run),beat:async () => {},tween:async (_time,change) => {for (const progress of [0,0.5,1]) await change(progress);}};
    const source = await readFile(new URL('.' + path,import.meta.url),'utf8');
    await new AsyncFunction(...Object.keys(api),source)(...Object.values(api));
    assert.equal(loops.length,1,path); for (const run of loops) await run(); assert.ok(writes.length > 0,path);
    const state = opl.getRegisterSnapshot();
    for (let channel = 0; channel < opl.channels; channel++) assert.equal(state[(Math.floor(channel / 9) << 8) | (0xb0 + channel % 9)] & 0x20,0,`${path} leaves no held melodic gate`);
  }
  const files = MODE_STARTERS[chip].examples.map(path => ({path})); assert.deepEqual(selectModeExamples(files,chip),files); assert.deepEqual(selectModeExamples(files,'genesis'),[],'native OPL globals stay out of the Genesis catalog');
});
