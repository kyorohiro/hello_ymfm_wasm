import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundChipFactory } from './soundchip_factory.js';
import { createSoundChip } from './soundchip.js';

test('registered factory loads only the requested chip and forwards options', async () => {
  const seen = [];
  const create = createSoundChipFactory({
    one: async options => { seen.push(options); return {}; },
    unused: () => { throw new Error('must not load'); },
  });
  assert.equal(seen.length, 0);
  const options = { moduleOptions: { wasmBinary: new Uint8Array(4) } };
  const a = await create('one', options);
  const b = await create('one', options);
  assert.notEqual(a, b);
  assert.deepEqual(seen, [options, options]);
  await assert.rejects(create('toString'), /Unknown sound chip/);
  await assert.rejects(create('missing'), /Unknown sound chip/);
});

for (const name of ['ym2151', 'ymf262', 'ym2612', 'ym3438', 'ymf276', 'ymf288']) {
  test(`${name}: real WASM initializes and generates PCM in Node`, async () => {
    const chip = await createSoundChip(name);
    try {
      assert.ok(chip.sampleRate() > 0);
      const pcm = chip.generateStereo(128);
      assert.equal(pcm.left.length, 128);
      assert.equal(pcm.right.length, 128);
      assert.ok(pcm.left.every(Number.isFinite));
    } finally { chip.dispose(); }
  });
}
