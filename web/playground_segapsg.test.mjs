import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSegaPsgClient} from './playground_segapsg.js';
import {SegaPSG} from './segapsg.js';
import factory from '../docs/generated/segapsg_wasm.js';

for (const highLevel of [true]) test(`Sega PSG ${highLevel ? 'Synth' : 'raw'} example plays through client and worklet, then disposes`, async () => {
  let Processor, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const source = (await readFile(new URL('./playground_segapsg_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {SegaPSG, factory, sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = {postMessage: resolveReady}; } },
    registerProcessor: (_, value) => { Processor = value; },
  });
  const processor = new Processor({processorOptions: {wasmBinary: await readFile(new URL('../docs/generated/segapsg_wasm.wasm', import.meta.url))}});
  assert.equal((await ready).ready, true);
  const client = createSegaPsgClient({postMessage: data => processor.receive(data), close() {}});
  try {
    const code = await readFile(new URL('../docs/playground/examples/genesis/segapsg-tone-noise.js', import.meta.url), 'utf8');
    let played = 0;
    await new (Object.getPrototypeOf(async function() {}).constructor)('useSoundChip', 'sleep', 'write', '"use strict";\n' + code)(
      async name => { assert.equal(name, 'segapsg'); return client; },
      async seconds => {
        const output = [new Float32Array(seconds * 48000), new Float32Array(seconds * 48000)];
        processor.process([], [output]);
        const peaks = output.map(a => a.reduce((p, x) => Math.max(p, Math.abs(x)), 0));
        assert.ok(Math.max(...peaks) > 0.01);
        if (!highLevel && played === 0) assert.equal(peaks[1], 0);
        if (!highLevel && played === 1) assert.equal(peaks[0], 0);
        assert.ok(output.every(a => a.every(x => Number.isFinite(x) && Math.abs(x) < 1)));
        played++;
      }, () => { throw new Error('Example must not call the global write API'); });
    assert.equal(played, 5); assert.equal(processor.dead, true);
    assert.throws(() => client.reset(), /disposed/);
  } finally { client.dispose(); processor.dispose(); }
});

