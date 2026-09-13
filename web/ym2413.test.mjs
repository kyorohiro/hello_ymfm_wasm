import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ym2612VGM } from './ym2612vgm.js';
import { Ym2612VGM as DocsVGM } from '../docs/js/ym2612vgm.js';
import { VgmPlayer } from './vgmplayer.js';
import { seekPlayback } from '../docs/vgm_analyzer/seek_playback.js';
import { Ym2413AudioEngine } from './ym2413audioengine.js';
import factory from '../docs/generated/ym2413_wasm.js';
import vm from 'node:vm';
// Run the browser-only PSG build with its normal browser globals and supplied bytes.
const psgSource = readFileSync(new URL('../docs/generated/segapsg_wasm.js', import.meta.url), 'utf8')
  .replaceAll('import.meta.url', "'http://localhost/segapsg_wasm.js'")
  .replace('export default Module;', 'Module;');
const psgFactory = vm.runInNewContext(psgSource, {window:{}, console, WebAssembly, URL, TextDecoder, TextEncoder, setTimeout, clearTimeout});

function vgm(commands) {
  const bytes = new Uint8Array(0x40 + commands.length);
  bytes.set([86,103,109,32]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x150, true);
  view.setUint32(0x10, 3579545, true);
  view.setUint32(0x18, 4410, true);
  bytes.set(commands, 0x40);
  return bytes;
}
const melody = [0x51,0x30,0x10, 0x51,0x10,0x80, 0x51,0x20,0x17, 0x61,0x3a,0x11, 0x51,0x20,7, 0x66];
const moduleOptions = { wasmBinary: readFileSync(new URL('../docs/generated/ym2413_wasm.wasm', import.meta.url)) };

test('YM2413 header, write ordering, wait and truncated writes', () => {
  const parser = new Ym2612VGM(vgm(melody));
  assert.equal(parser.header.ym2413Clock, 3579545);
  const writes = [];
  const targets = { ym2413: { writeRegister: (...args) => writes.push(args) } };
  assert.equal(parser.playStep(targets).type, 'ym2413-write');
  parser.playStep(targets); parser.playStep(targets);
  assert.deepEqual(writes, [[0x30,0x10],[0x10,0x80],[0x20,0x17]]);
  assert.deepEqual(parser.playStep(targets), {type:'wait', samples:4410});
  assert.throws(() => new Ym2612VGM(vgm([0x51,0x20])).step());
});

test('actual WASM renders YM2413 VGM and reset repeats identical PCM', async () => {
  const engine = await Ym2413AudioEngine.create({ym2413ModuleFactory:factory, ym2413ModuleOptions:moduleOptions});
  try {
    const player = new VgmPlayer(engine);
    player.load(vgm(melody)); player.play();
    const left = new Float32Array(4410), right = new Float32Array(4410);
    player.process(left,right,4410);
    assert(left.some(x => Math.abs(x) > 0.001));
    assert(left.every(Number.isFinite));
    assert.deepEqual(left,right);
    player.reset(); player.play();
    const again = new Float32Array(4410);
    player.process(again,right,4410);
    assert.deepEqual(again,left);
    await seekPlayback(player, 1000);
    player.resume();
    const afterSeek = new Float32Array(300);
    player.process(afterSeek, new Float32Array(300), 300);
    assert.deepEqual(afterSeek, left.slice(1000,1300));
  } finally { engine.dispose(); }
});

test('PSG continues generating while muted and mixes with YM2413', async () => {
  const engine = await Ym2413AudioEngine.create({ym2413ModuleFactory:factory, ym2413ModuleOptions:moduleOptions,
    segaPsgModuleFactory: options => psgFactory({...options,wasmBinary:readFileSync(new URL('../docs/generated/segapsg_wasm.wasm',import.meta.url))}), psgClock:3579545});
  try {
    engine.writePsg(0x84); engine.writePsg(0x10); engine.writePsg(0x90);
    assert(engine.processFrames(1000).left.some(x => Math.abs(x) > 0.001));
    engine.setPsgMuted(true);
    assert(engine.processFrames(1000).left.every(x => x === 0));
    engine.writeYm2413(0x30,0x10); engine.writeYm2413(0x10,0x80); engine.writeYm2413(0x20,0x17);
    assert(engine.processFrames(1000).left.some(x => Math.abs(x) > 0.001));
  } finally { engine.dispose(); }
});

test('upsampling holds previous sample without advancing the chip too fast', () => {
  let generated=0;
  const engine = new Ym2413AudioEngine({generateStereo(n){generated+=n;return {left:new Float32Array(n).fill(0.5)};}},null,22050,44100,1);
  engine.processFrames(100);
  assert.equal(generated,50);
  assert.throws(()=>engine.processFrames(-1),RangeError);
});

for (const Parser of [Ym2612VGM, DocsVGM]) {
  test(`YM2413 Analyzer import scans command usage and metadata (${Parser === DocsVGM ? 'docs' : 'web'})`, () => {
    const parser = new Parser(vgm(melody));
    assert.deepEqual([...parser.analyzeCommandUsage()], [['0x51',4],['0x61',1],['0x66',1]]);
    assert.deepEqual(parser.dataBlockSummary(), []);
    assert.doesNotThrow(() => parser.analyzeSpecialCommands());
    assert.deepEqual(parser.pcmRamWriteSummary(), []);
    assert.doesNotThrow(() => parser.analyzeCommandContext(0x92));
    assert.match(parser.analyzeCommandContext(0x51).join('\n'), /ym2413 register=0x30 value=0x10/);
    // Import-time scans must leave playback at its original position.
    assert.deepEqual(parser.step(), {type:'ym2413-write',register:0x30,value:0x10});
  });
}
