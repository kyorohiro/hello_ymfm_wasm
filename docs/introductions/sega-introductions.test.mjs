import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SegaPSG} from '../js/segapsg.js';
import {SegaPSGSynth, SegaPSGDirectTransport} from '../js/segapsgsynth.js';
import {Rf5c164} from '../js/rf5c164.js';
import {RF5C164Synth, RF5C164DirectTransport} from '../js/rf5c164synth.js';
import psgFactory from '../generated/segapsg_wasm.js';
import rfFactory from '../generated/rf5c164_wasm.js';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const options = async name => ({wasmBinary: await readFile(new URL(`../generated/${name}_wasm.wasm`, import.meta.url))});
const sources = async name => [...(await readFile(new URL(`./tetorica-${name}.html`, import.meta.url), 'utf8')).matchAll(/<script type="text\/plain" id="([^"]+)">([\s\S]*?)<\/script>/g)];
const audible = input => input.some(value => Math.abs(value) > .001);
function frequency(input, rate) {
  const part = input.slice(rate / 10, rate / 2);
  const mean = part.reduce((sum, value) => sum + value, 0) / part.length;
  let count = 0;
  for (let i = 1; i < part.length; i++) if (part[i - 1] < mean && part[i] >= mean) count++;
  return count / (part.length / rate);
}
for (const name of ['segapsg', 'rf5c164']) {
  for (const [, id, source] of await sources(name)) test(`${id}: published example plays on real WASM and releases its client`, async () => {
    const rate = 48000;
    const chip = name === 'segapsg'
      ? await SegaPSG.create({moduleFactory: psgFactory, moduleOptions: await options(name), sampleRate: rate})
      : await Rf5c164.create({moduleFactory: rfFactory, moduleOptions: await options(name), sampleRate: rate});
    const synth = name === 'segapsg'
      ? new SegaPSGSynth({transport: new SegaPSGDirectTransport(chip)})
      : new RF5C164Synth({transport: new RF5C164DirectTransport(chip)});
    let disposed = false;
    const client = new Proxy(synth, {get(target, key) {
      if (key === 'dispose') return () => {disposed = true;};
      if (typeof target[key] === 'function') return (...args) => {assert.equal(disposed, false); return target[key](...args);};
      return target[key];
    }});
    const chunks = [];
    try {
      await new AsyncFunction('useSoundChip', 'sleep', source)(
        async requested => {assert.equal(requested, name); return client;},
        async seconds => {chunks.push(chip.generateStereo(Math.round(seconds * rate)));});
      assert.equal(disposed, true);
      assert.ok(chunks.some(chunk => audible(chunk.left)));
      assert.ok(chunks.every(chunk => chunk.left.every(Number.isFinite) && chunk.right.every(Number.isFinite)));
      if (id === 'psg-scale' || id === 'psg-noise') {
        assert.equal(chunks.length, id === 'psg-scale' ? 16 : 12);
        for (let i = 1; i < chunks.length; i += 2) assert.ok(chunks[i].left.every(value => value === 0));
      }
      if (id === 'rf5c164-tone') {
        assert.deepEqual(chunks[0].left, chunks[0].right);
        assert.ok(Math.abs(frequency(chunks[0].left, rate) - 440) < 8);
      }
      if (id === 'rf5c164-pan') {
        assert.equal(chunks.length, 2);
        assert.ok(Math.abs(frequency(chunks[0].left, rate) - 440) < 8);
        // Loop reset rounds the 660 Hz target to about 651 Hz in this example.
        assert.ok(Math.abs(frequency(chunks[0].right, rate) - 651) < 4);
        assert.ok(Math.abs(frequency(chunks[1].left, rate) - 220) < 8);
        assert.ok(Math.abs(frequency(chunks[1].right, rate) - 651) < 4);
      }
      chip.generateStereo(128);
      const tail = chip.generateStereo(1024);
      assert.ok(tail.left.every(value => value === 0) && tail.right.every(value => value === 0));
    } finally {chip.dispose();}
  });
}
test('Introduction lists FM, PSG, RF5C164 in order with distinct existing destinations', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const section = html.split('<h2>Introduction</h2>')[1].split('<h2>Demos</h2>')[0];
  const links = [...section.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links.slice(0, 3), ['./introductions/index.html', './introductions/tetorica-segapsg.html', './introductions/tetorica-rf5c164.html']);
  for (const link of links.slice(0, 3)) await readFile(new URL(`../${link}`, import.meta.url));
});
test('deployed PSG loader and worklet resolve existing WASM assets', async () => {
  const loaderUrl = new URL('../js/playground_segapsg_audio.js', import.meta.url);
  const workletUrl = new URL('../js/playground_segapsg_worklet.js', import.meta.url);
  const loader = await readFile(loaderUrl, 'utf8'), worklet = await readFile(workletUrl, 'utf8');
  const wasmPath = /bytes\('([^']+segapsg_wasm\.wasm)'\)/.exec(loader)?.[1];
  const factoryPath = /import factory from '([^']+)'/.exec(worklet)?.[1];
  assert.ok(wasmPath); assert.ok(factoryPath);
  await readFile(new URL(wasmPath, loaderUrl));
  await readFile(new URL(factoryPath, workletUrl));
  const sync = await readFile(new URL('../../scripts/sync_web_js_to_docs.sh', import.meta.url), 'utf8');
  assert.ok(sync.includes('"${DOCS_JS_DIR}/playground_segapsg_audio.js" "${DOCS_JS_DIR}/playground_segapsg_worklet.js"'));
});
