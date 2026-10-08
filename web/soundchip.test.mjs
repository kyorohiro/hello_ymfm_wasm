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

for (const name of ['gameboy', 'segapsg']) {
  test(`${name}: common factory loads WASM and forwards sampleRate`, async () => {
    const chip = await createSoundChip(name, {sampleRate: 48000});
    try {
      assert.equal(chip.sampleRate(), 48000);
      const pcm = chip.generateStereo(128);
      assert.equal(pcm.left.length, 128); assert.ok(pcm.left.every(Number.isFinite));
    } finally {chip.dispose();}
  });
}

test('aborted default WASM loading and injected factories', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createSoundChip('ym2612', {signal: controller.signal}), /abort/i);
  const {default: moduleFactory} = await import('../docs/generated/ym2612_wasm.js');
  const {readFile} = await import('node:fs/promises');
  const chip = await createSoundChip('ym2612', {moduleFactory, moduleOptions: {
    wasmBinary: await readFile(new URL('../docs/generated/ym2612_wasm.wasm', import.meta.url)),
  }});
  try { assert.equal(chip.generateStereo(32).left.length, 32); }
  finally { chip.dispose(); }
});

test('worklet endpoint requires browser audio and rejects canceled creation before allocating', async () => {
  await assert.rejects(createSoundChip('ym2612', {execution: 'worklet'}), /browser AudioContext/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createSoundChip('ym2612', {execution: 'worklet', signal: controller.signal}), /abort/i);
});

test('direct chips expose stable automatic IDs, including overlapping creation and manual IDs', async () => {
  const chips=await Promise.all([createSoundChip('pwm'),createSoundChip('pwm'),createSoundChip('pwm',{id:'lead'})]);
  try {
    assert.equal(new Set(chips.map(chip=>chip.id)).size,3);
    assert.match(chips[0].id,/^pwm:\d+$/);assert.equal(chips[2].id,'lead');
    assert.throws(()=>{chips[0].id='other';},TypeError);
    await assert.rejects(createSoundChip('pwm',{id:''}),/nonempty/);
  } finally {for(const chip of chips)chip.dispose();}
});
