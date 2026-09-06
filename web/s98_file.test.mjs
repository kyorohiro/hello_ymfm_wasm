import test from 'node:test';
import assert from 'node:assert/strict';
import { convertS98ToVgm, looksLikeS98 } from './s98_file.js';
import { Ym2612VGM } from './ym2612vgm.js';
import { exportAnalysisMml } from '../docs/vgm_analyzer/vgm_mml.js';

function fixture(commands, { version = 3, type = 4, numerator = 10, denominator = 1000, loop = null } = {}) {
  const offset = version < 2 ? 32 : version === 2 ? 64 : 48;
  const b = new Uint8Array(offset + commands.length);
  const v = new DataView(b.buffer);
  b.set([83, 57, 56, 48 + version]);
  v.setUint32(4, numerator, true);
  v.setUint32(8, denominator, true);
  v.setUint32(0x14, offset, true);
  if (loop !== null) v.setUint32(0x18, offset + loop, true);
  if (version >= 2) {
    v.setUint32(0x1c, 1, true);
    v.setUint32(0x20, type, true);
    v.setUint32(0x24, 7987200, true);
  }
  b.set(commands, offset);
  return b;
}
function events(buffer) {
  const parser = new Ym2612VGM(buffer);
  const result = [];
  for (;;) { const e = parser.step(); result.push(e); if (e.type === 'end') break; }
  return result;
}

test('S98 versions 0–3 and chip writes survive normalization', () => {
  for (const version of [0, 1, 2, 3]) {
    const { buffer, sourceHeader } = convertS98ToVgm(fixture([0, 0x28, 0xf0, 1, 0x30, 7, 255, 253], { version }));
    assert.equal(sourceHeader.format, `S98${version}`);
    const e = events(buffer);
    assert.equal(e[0].type, 'ym2608-write');
    assert.equal(e[1].port, 1);
    assert.equal(e[1].value, 7);
    assert.equal(e[2].samples, 441);
  }
  for (const [type, event] of [[2, 'ym2203-write'], [3, 'ym2612-write']]) {
    const { buffer } = convertS98ToVgm(fixture([0, 0x28, 0xf0, 255, 253], { type }));
    assert.equal(events(buffer)[0].type, event);
    if (type === 3) assert.equal(typeof exportAnalysisMml(buffer, { bpm: 120, fileName: 'test.s98' }), 'string');
  }
});

test('fractional waits accumulate and loop offsets point to normalized commands', () => {
  const commands = [...Array(1000).fill(255), 254, 128, 1, 253];
  const { buffer } = convertS98ToVgm(fixture(commands, { numerator: 1, denominator: 1000, loop: 1000 }));
  const p = new Ym2612VGM(buffer);
  assert.equal(p.header.totalSamples, 49833);
  assert.equal(p.header.loopSamples, 5733);
  assert.equal(new Uint8Array(buffer)[p.header.loopOffset], 0x61);
  assert.equal(events(buffer).filter(e => e.type === 'wait').reduce((n, e) => n + e.samples, 0), 49833);
});

test('long waits split at VGM limits and typed array slices are accepted', () => {
  const b = fixture([254, 127, 253], { numerator: 1, denominator: 1 });
  const wrapped = new Uint8Array(b.length + 8); wrapped.set(b, 4);
  const { buffer } = convertS98ToVgm(wrapped.subarray(4, 4 + b.length));
  assert.equal(events(buffer).filter(e => e.type === 'wait').reduce((n, e) => n + e.samples, 0), 129 * 44100);
  assert.equal(looksLikeS98(new Uint8Array([86, 103, 109, 32])), false);
});

test('rejects unsupported and malformed inputs', () => {
  for (const [b, pattern] of [
    [fixture([253], { type: 5 }), /unsupported device/],
    [fixture([0, 1]), /truncated register/],
    [fixture([254, 128]), /variable-length wait/],
    [fixture([255]), /missing end/],
    [fixture([2, 0, 0, 253]), /device\/port/],
    [fixture([0, 1, 2, 255, 253], { loop: 1 }), /command boundary/],
    [fixture([253], { loop: 0 }), /no sample duration/],
    [fixture([255, 253], { numerator: 0xffffffff, denominator: 1 }), /duration/],
  ]) assert.throws(() => convertS98ToVgm(b), pattern);
  for (const [offset, value, pattern] of [[12, 1, /compressed/], [20, 1, /data offset/], [28, 2, /device table/], [40, 1, /panning/]]) {
    const b = fixture([253]); new DataView(b.buffer).setUint32(offset, value, true);
    assert.throws(() => convertS98ToVgm(b), pattern);
  }
});


test('source tags and default timer are retained', () => {
  const base = fixture([255, 253], { numerator: 0, denominator: 0 });
  const tag = new TextEncoder().encode('[S98]\ntitle=テスト\n\0');
  const b = new Uint8Array(base.length + tag.length);
  b.set(base); b.set(tag, base.length);
  new DataView(b.buffer).setUint32(0x10, base.length, true);
  const { buffer, sourceHeader } = convertS98ToVgm(b);
  assert.match(sourceHeader.tag, /title=テスト/);
  assert.equal(new Ym2612VGM(buffer).header.totalSamples, 441);
});

test('multiple devices are rejected explicitly', () => {
  const b = new Uint8Array(65);
  b.set(fixture([253]));
  const v = new DataView(b.buffer);
  v.setUint32(20, 64, true); v.setUint32(28, 2, true);
  v.setUint32(48, 2, true); v.setUint32(52, 4000000, true);
  b[64] = 253;
  assert.throws(() => convertS98ToVgm(b), /multiple devices/);
});
