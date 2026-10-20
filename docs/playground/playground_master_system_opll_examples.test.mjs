import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {YM2413Synth,YM2413_INSTRUMENTS,YM2413_USER_PRESETS} from '../../web/ym2413synth.js';
import {SegaPSGSynth} from '../../web/segapsgsynth.js';
import {MODE_STARTERS,selectModeExamples} from './playground_mode_examples.js';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
test('Master System starter and OPLL examples use the native two-chip API and release every gate',async () => {
  const paths = ['/defaults/master-system/index.js',...MODE_STARTERS['master-system'].examples.filter(path => path.includes('/sms-opll-'))];
  for (const path of paths) {
    const psgWrites = [], opllWrites = [], loops = [], waits = [];
    const psg = new SegaPSGSynth({transport:{write:value => psgWrites.push(value)}});
    const opll = new YM2413Synth({transport:{writeRegister:(...args) => opllWrites.push(args),reset() {}}}); opll.initialize(); opllWrites.length = 0;
    const api = {psg,opll,PSG1:0,PSG2:1,PSG3:2,OPLL_INSTRUMENTS:YM2413_INSTRUMENTS,OPLL_USER_PRESETS:YM2413_USER_PRESETS,
      setBpm:bpm => assert.equal(bpm,120),liveLoop:(_name,run) => loops.push(run),beat:async beats => {assert(beats > 0); waits.push(beats);},
      tween:async (_duration,change) => {for (const progress of [0,0.5,1]) await change(progress);},log() {}};
    const source = await readFile(new URL('.' + path,import.meta.url),'utf8');
    await new AsyncFunction(...Object.keys(api),source)(...Object.values(api)); assert(loops.length > 0,path);
    for (const run of loops) await run(); assert(opllWrites.length > 0,path);
    const registers = opll.getRegisterSnapshot(); for (let ch = 0; ch < 9; ch++) assert.equal(registers[0x20 + ch] & 16,0,`${path} releases CH${ch}`);
    assert.equal(registers[0x0e] & 31,0,`${path} releases all percussion gates`);
    if (path.includes('/defaults/')) assert(psgWrites.length > 0,'the starter plays both primary chips');
    if (path.includes('user-patch')) {assert.equal(registers[0x30] >> 4,0); assert.equal(registers[0x31] >> 4,0); assert.equal(registers[0x32] >> 4,4,'ROM flute remains selected while the shared patch changes');}
    if (path.includes('rhythm')) assert.equal(registers[0x0e] & 32,32,'rhythm mode is explicit');
  }
});

test('Master System retains the PSG examples and keeps its new OPLL globals out of Genesis',() => {
  const paths = MODE_STARTERS['master-system'].examples;
  assert.equal(paths.length,5); assert(paths.includes('/examples/master-system/sms-mode-melody.js')); assert(paths.includes('/examples/master-system/sms-mode-noise.js'));
  const files = paths.map(path => ({path})); assert.deepEqual(selectModeExamples(files,'master-system'),files); assert.deepEqual(selectModeExamples(files,'genesis'),[]);
});
