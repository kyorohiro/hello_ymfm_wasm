import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateAyPlaybackHeader } from '../js/ay8910audioengine.js';

const html = await readFile(new URL('./vgm.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('      async function ensurePlaybackReady'), html.indexOf('      function stopActiveStream'))
  .replace(/await import\("[^"\n]+"\)/g, '({ default: factory })');

test('demo selects OPN and PCM engines from file headers instead of silently dropping writes', async () => {
  const calls = [];
  let disposed = 0;
  const create = kind => async options => {
    calls.push({ kind, options });
    return { sampleRate: () => 44100, dispose() { disposed++; } };
  };
  const context = vm.createContext({
    engine: null, player: null, factory: () => {},
    ym2612ModuleFactory: 1, segaPsgModuleFactory: 2, rf5c164ModuleFactory: 3,
    validateAyPlaybackHeader,
    createMsxAudioEngine: create('msx'),
    createAy8910AudioEngine: create('ay'),
    createYm2413AudioEngine: create('opll'),
    createGenesisAudioEngine: create('genesis'),
    createYm2203AudioEngine: create('ym2203'),
    createYm2608AudioEngine: create('ym2608'),
    createYm2610BAudioEngine: create('ym2610'),
    VgmPlayer: class { setLoopEnabled() {} load() {} },
    audioContext: { sampleRate: 44100, state: 'running' },
    loopCheckbox: { checked: false }, currentBuffer: new ArrayBuffer(0),
  });
  vm.runInContext(source, context);
  for (const header of [
    { rf5c164Clock: 12500000 }, { ym2203Clock: 4000000 },
    { ym2608Clock: 8000000 }, { ym2610Clock: 0x80000000 + 8000000 }, {},
  ]) await context.ensurePlaybackReady({ header });
  assert.deepEqual(calls.map(call => call.kind), ['genesis', 'ym2203', 'ym2608', 'ym2610', 'genesis']);
  assert.equal(calls[0].options.rf5c164Clock, 12500000);
  assert.equal(calls[0].options.rf5c164ModuleFactory, 3);
  assert.equal(calls[3].options.clock, 8000000);
  assert.equal(calls[3].options.variant, true);
  assert.equal(disposed, 4);
  await context.ensurePlaybackReady({ header: { ay8910Clock: 1789773, ym2413Clock: 3579545, ay8910Type: 0x10, ay8910Flags: 1 } });
  assert.equal(calls.at(-1).kind, 'msx');
  assert.equal(calls.at(-1).options.ayClock, 1789773);
  assert.equal(calls.at(-1).options.ayType, 0x10);
  assert.equal(calls.at(-1).options.ym2413Clock, 3579545);
  await context.ensurePlaybackReady({ header: { ay8910Clock: 1789773 } });
  assert.equal(calls.at(-1).kind, 'ay');
  await context.ensurePlaybackReady({ header: { ym2413Clock: 3579545, psgClock: 3579545 } });
  assert.equal(calls.at(-1).kind, 'opll');
  assert.equal(calls.at(-1).options.psgClock, 3579545);
  await assert.rejects(context.ensurePlaybackReady({ header: { ym2151Clock: 3579545 } }), /does not support playback/);
});
