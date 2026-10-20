import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {AY8910Synth} from '../../web/ay8910synth.js';
import {YM2413Synth,YM2413_INSTRUMENTS,YM2413_USER_PRESETS} from '../../web/ym2413synth.js';
import {OPLSynth,OPL_PRESETS} from '../../web/opl_synth.js';
import {MODE_STARTERS,selectModeExamples} from './playground_mode_examples.js';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
for (const mode of ['msx','msx-audio']) test(`${mode} starter and examples run with only its native globals and release their voices`,async () => {
  for (const path of [`/defaults/${mode}/index.js`,...MODE_STARTERS[mode].examples]) {
    const ayWrites = [], opllWrites = [], oplWrites = [], loops = [];
    const transport = writes => ({writeRegister:(...args) => writes.push(args),reset() {}});
    const ay = new AY8910Synth({transport:transport(ayWrites)}), opll = new YM2413Synth({transport:transport(opllWrites)});
    const opl = mode === 'msx-audio' ? new OPLSynth({chip:'y8950',transport:transport(oplWrites)}) : null;
    for (const synth of [ay,opll,...(opl ? [opl] : [])]) synth.initialize();
    for (const writes of [ayWrites,opllWrites,oplWrites]) writes.length = 0;
    const api = {ay,opll,...(opl ? {opl,OPL_PRESETS} : {}),OPLL_INSTRUMENTS:YM2413_INSTRUMENTS,OPLL_USER_PRESETS:YM2413_USER_PRESETS,
      setBpm:bpm => assert.equal(bpm,120),liveLoop:(_name,run) => loops.push(run),beat:async beats => assert(beats > 0)};
    const source = await readFile(new URL('.' + path,import.meta.url),'utf8');
    await new AsyncFunction(...Object.keys(api),source)(...Object.values(api));
    assert.equal(loops.length,1,path); await loops[0]();
    if (path.includes('/defaults/')) for (const writes of [ayWrites,opllWrites,...(opl ? [oplWrites] : [])]) assert(writes.length > 0,'the starter plays every primary chip');
    const a = ay.getRegisterSnapshot(), l = opll.getRegisterSnapshot(), o = opl?.getRegisterSnapshot();
    for (let ch = 0; ch < 3; ch++) assert.equal(a[8 + ch] & 31,0,`${path} silences AY CH${ch}`);
    for (let ch = 0; ch < 9; ch++) {
      assert.equal(l[0x20 + ch] & 16,0,`${path} releases OPLL CH${ch}`);
      if (o) assert.equal(o[0xb0 + ch] & 32,0,`${path} releases Y8950 CH${ch}`);
    }
    if (path.includes('tone-noise')) {assert.equal(a[7] & 63,10,'noise-only and mixed source routing survives note gates'); assert(ayWrites.some(([reg]) => reg === 6));}
    if (path.includes('envelope')) assert.deepEqual(ayWrites.filter(([reg]) => reg === 13).map(([,value]) => value),[8,10,12,14],'each chord explicitly retriggers the shared envelope once');
    if (path.includes('fm-sections')) {assert(opllWrites.length > 0 && oplWrites.length > 0); assert.equal(l[0x30] >> 4,0); assert.equal(l[0x31] >> 4,4);}
    if (path.includes('music-duet.js')) {assert(ayWrites.length > 0 && opllWrites.length > 0); assert.equal(l[0x30] >> 4,0); assert.equal(l[0x31] >> 4,0);}
  }
});

test('MSX catalogs use their available instruments without leaking globals into Genesis',() => {
  for (const mode of ['msx','msx-audio']) {
    assert.equal(MODE_STARTERS[mode].examples.length,3);
    const files = MODE_STARTERS[mode].examples.map(path => ({path}));
    assert.deepEqual(selectModeExamples(files,mode),files);
    assert.deepEqual(selectModeExamples(files,'genesis'),[]);
  }
  assert(!MODE_STARTERS.msx.examples.some(path => path.endsWith('msx-fm-sections.js')));
  assert(MODE_STARTERS['msx-audio'].examples.some(path => path.endsWith('msx-fm-sections.js')));
  assert.equal(MODE_STARTERS.y8950,undefined,'the old single-chip mode is replaced by MSX Audio');
});

test('MSX Helper describes its two globals while MSX Audio also documents Y8950 FM',async () => {
  const html = await readFile(new URL('./index.html',import.meta.url),'utf8');
  const paragraphs = mode => [...html.matchAll(new RegExp(`<p data-native-helper="${mode}"[^>]*>(.*?)</p>`,'g'))].map(match => match[1]).join('\n');
  assert.match(paragraphs('msx'),/<code>ay<\/code>/); assert.match(paragraphs('msx'),/<code>opll<\/code>/);
  assert.doesNotMatch(paragraphs('msx'),/<code>(?:opl|OPL_PRESETS)(?:<|\.)/);
  assert.match(paragraphs('msx-audio'),/<code>opl<\/code>/); assert.match(paragraphs('msx-audio'),/ADPCM sample playback is outside this mode/);
});
