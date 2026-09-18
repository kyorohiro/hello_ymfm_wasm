import test from 'node:test';
import assert from 'node:assert/strict';
import { describeYm2413, mountYm2413Monitor } from './ym2413_monitor.js';

test('YM2413 pitch uses FNUM/BLOCK; key-on state and instrument/volume are decoded', () => {
  const regs = new Uint8Array(0x40);
  regs[0x10] = 256 & 0xff; // CH1 fnum low
  regs[0x20] = 0x10 | (4 << 1) | ((256 >> 8) & 1); // key on, block 4
  regs[0x30] = (1 << 4) | 3; // instrument 1, volume 3
  const { channels: [ch1] } = describeYm2413(regs, 3579545);
  assert.equal(ch1.keyOn, true);
  assert.equal(ch1.instrument, 1);
  assert.equal(ch1.volume, 3);
  // Formula verified against the compiled ymfm core: hz = fnum*clock*2^block/(2^19*72).
  assert.ok(Math.abs(ch1.frequency - 388.405) < 0.01);
  assert.ok(Number.isFinite(ch1.midi));
});

test('YM2413 key off yields no pitch', () => {
  const regs = new Uint8Array(0x40);
  regs[0x10] = 100;
  regs[0x20] = (4 << 1); // block set, key bit off
  const { channels: [ch1] } = describeYm2413(regs, 3579545);
  assert.equal(ch1.keyOn, false);
  assert.equal(ch1.midi, null);
});

test('YM2413 rhythm mode repurposes CH7/CH8 and reports BD/SD/TOM/TC/HH from register 0x0E', () => {
  const regs = new Uint8Array(0x40);
  regs[0x0e] = 0x20 | 0x10; // rhythm enable + BD key on
  const state = describeYm2413(regs, 3579545);
  assert.equal(state.rhythmEnabled, true);
  assert.deepEqual(state.rhythm, { bd: true, sd: false, tom: false, tc: false, hh: false });
  assert.equal(state.channels[6].isRhythmChannel, true);
  assert.equal(state.channels[6].keyOn, true); // CH6 (index 6) is Bass Drum, gated by the rhythm bit
  assert.equal(state.channels[7].isRhythmChannel, true);
  assert.equal(state.channels[7].keyOn, false); // CH7/CH8 have no single meaningful key-on/pitch
  assert.equal(state.channels[8].isRhythmChannel, true);
});

test('mountYm2413Monitor renders register state and rhythm summary', () => {
  const element = () => ({ children: [], append(...x) { this.children.push(...x); } });
  const before = globalThis.document;
  globalThis.document = { createElement: element };
  try {
    const root = element();
    const monitor = mountYm2413Monitor(root);
    monitor.load({ ym2413Clock: 3579545 });
    monitor.write(0x10, 200);
    monitor.write(0x20, 0x10 | (4 << 1));
    monitor.write(0x30, (1 << 4));
    monitor.render();
    assert.match(root.children[0].textContent, /YM2413/);
    assert.match(root.children[2].children[1].textContent, /Key: On/);
    assert.match(root.children[2].children[1].textContent, /Hz\)/);
    monitor.reset();
    assert.match(root.children[2].children[1].textContent, /Key: Off/);
  } finally { globalThis.document = before; }
});
