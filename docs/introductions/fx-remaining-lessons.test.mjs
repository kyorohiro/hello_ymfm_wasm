import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { LiveFX } from '../../web/custom_fx.js';
import { createNativeFXController } from '../../web/native_fx.js';
import { FM_PRESETS } from '../../web/megadrive-fm-presets.js';

const names = ['distortion', 'bitcrusher', 'filter', 'eq', 'wobble', 'envelope-follower', 'noise-gate', 'compressor', 'delay', 'flanger', 'chorus', 'reverb', 'chains'];
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
async function load(source) {
  const processor = new LiveFX(48000), messages = [], loops = [], keys = [], prepared = new Map();
  const fx = createNativeFXController(message => {
    messages.push(message);
    if (message.op === 'live-fx') processor.command(message);
  });
  const api = {
    setBpm() {}, fx, liveFx: fx.liveFx,
    async livePrepare(name, fn) {
      if (!prepared.has(name)) prepared.set(name, await fn({ fx }));
      return prepared.get(name);
    },
    fm: {
      setPreset(ch, preset) { assert.ok(preset, 'valid preset'); }, setFrequency() {},
      keyOn(ch) { keys.push(['on', ch]); }, keyOff(ch) { keys.push(['off', ch]); },
    },
    CH1: 0, FM_PRESETS, hzToBlockFnum: () => ({ block: 3, fnum: 500 }),
    liveLoop(name, fn) { loops.push(fn); }, async beat() {},
  };
  const execute = () => new AsyncFunction(...Object.keys(api), source)(...Object.values(api));
  await execute();
  return { processor, messages, loops, keys, execute };
}
function render(processor, blockSize) {
  const result = [[], []];
  for (let start = 0; start < 48000; start += blockSize) {
    const audio = [0, 1].map(ch => Float32Array.from({ length: Math.min(blockSize, 48000 - start) }, (_, i) => {
      const t = start + i;
      return t < 12000 ? .3 * Math.exp(-t / 10000) * Math.sin(2 * Math.PI * (220 + ch * 110) * t / 48000) : 0;
    }));
    processor.process(audio, error => assert.fail(error));
    audio.forEach((channel, ch) => result[ch].push(...channel));
  }
  assert.ok(result.flat().every(Number.isFinite));
  assert.ok(result[0].some(x => Math.abs(x) > .001), 'audible nonzero output');
  return result;
}
for (const name of names) test(`${name}: links, embedded API, Apply and DSP across block sizes`, async () => {
  const url = new URL(`./tetorica-fx-${name}.html`, import.meta.url);
  const html = await readFile(url, 'utf8');
  for (const [, path] of html.matchAll(/(?:href|src)="(\.\.?\/[^"#]+)"/g)) await access(new URL(path, url));
  const examples = [...html.matchAll(/<script type="text\/plain" id="([^"]+)">([\s\S]*?)<\/script>/g)];
  assert.equal(examples.length, name === 'envelope-follower' ? 1 : 2);
  for (const [, id, source] of examples) {
    assert.ok(html.includes(`data-playground-src="${id}"`));
    const a = await load(source);
    assert.equal(a.loops.length, 1);
    await a.loops[0]();
    assert.deepEqual(a.keys, [['on', 0], ['off', 0]]);
    const creates = a.messages.filter(m => m.op === 'create').length;
    await a.execute(); // Apply must reuse the native nodes.
    assert.equal(a.messages.filter(m => m.op === 'create').length, creates);
    if (creates) assert.ok(a.messages.some(m => m.op === 'chain'));
    const b = await load(source);
    assert.deepEqual(render(a.processor, 128), render(b.processor, 256), `${id}: state is independent of block boundaries`);
    if (name === 'delay' && id.endsWith('-live')) {
      const { processor } = await load(source);
      const audio = [new Float32Array(24001), new Float32Array(24001)];
      audio[0][0] = 1;
      processor.process(audio, assert.fail);
      assert.ok(Math.abs(audio[0][0] - .65) < 1e-6);
      assert.ok(Math.abs(audio[0][12000] - .35) < 1e-6);
      assert.ok(Math.abs(audio[0][24000] - .1225) < 1e-6);
    }
  }
});
