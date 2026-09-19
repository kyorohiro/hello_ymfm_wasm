import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMgsdrvMml } from './mgsdrv_mml.js';

function vgm(commands, offsets = {}) {
  const bytes = new Uint8Array(0x100 + commands.length);
  const v = new DataView(bytes.buffer);
  bytes.set([86, 103, 109, 32]);
  v.setUint32(4, bytes.length - 4, true);
  v.setUint32(8, 0x171, true);
  v.setUint32(0x34, 0xcc, true);
  if (offsets.ay) v.setUint32(0x74, offsets.ay, true);
  if (offsets.opll) v.setUint32(0x10, offsets.opll, true);
  v.setUint32(0x18, 4410, true);
  bytes.set(commands, 0x100);
  return bytes;
}

test('rejects sources with neither AY nor YM2413', () => {
  assert.throws(() => exportMgsdrvMml(vgm([0x66])), /requires/);
});

test('PSG-only export uses tracks 1-3 with no @ instrument switches, and sets volume', () => {
  const source = vgm([0xa0,0,100,0xa0,1,0,0xa0,7,0x3e,0xa0,8,15,0x61,0x3a,0x11,0x66], { ay: 1789773 });
  const text = exportMgsdrvMml(source, { bpm: 120 });
  assert.match(text, /#opll_mode 0/);
  assert.match(text, /#tempo 120/);
  assert.match(text, /^1 [^@]*$/m);
  assert.doesNotMatch(text, /@\d+/);
});

test('every track opens with v5 (v defaults to 0/silent otherwise)', () => {
  const source = vgm([0xa0,0,100,0xa0,1,0,0xa0,7,0x3e,0xa0,8,15,0x61,0x3a,0x11,0x66], { ay: 1789773 });
  const text = exportMgsdrvMml(source, { bpm: 120 });
  assert.match(text, /^1 v5 /m);
});

test('YM2413 ROM preset maps to @<preset-1> on FM track 9', () => {
  const source = vgm([0x51,0x30,(3<<4),0x51,0x10,200,0x51,0x20,0x10|(4<<1),0x61,0x3a,0x11,0x66], { opll: 3579545 });
  const text = exportMgsdrvMml(source, { bpm: 120 });
  assert.match(text, /^9 v5 @2 /m); // instrument 3 -> ROM tone number 2
});

test('custom YM2413 instrument emits an @v definition and references its slot', () => {
  const commands = [
    0x51,0x00,0x21, 0x51,0x01,0x01, 0x51,0x02,0x18, 0x51,0x03,0x05,
    0x51,0x04,0xf2, 0x51,0x05,0xf3, 0x51,0x06,0x01, 0x51,0x07,0x02,
    0x51,0x30,0, 0x51,0x10,200, 0x51,0x20,0x10|(4<<1),
    0x61,0x3a,0x11,0x66,
  ];
  const text = exportMgsdrvMml(vgm(commands, { opll: 3579545 }), { bpm: 120 });
  assert.match(text, /@v15 = \{/);
  assert.match(text, /24, 5,/); // TL, FB
  assert.match(text, /15, 2, 0, 1, 0, 1, 0, 0, 1, 0, 0,/); // modulator operator fields
  assert.match(text, /^9 v5 @15 /m);
});

test('AY + YM2413 combo emits both PSG and FM tracks', () => {
  const commands = [
    0xa0,0,100,0xa0,1,0,0xa0,7,0x3e,0xa0,8,15,
    0x51,0x30,(1<<4),0x51,0x10,200,0x51,0x20,0x10|(4<<1),
    0x61,0x3a,0x11,0x66,
  ];
  const text = exportMgsdrvMml(vgm(commands, { ay: 1789773, opll: 3579545 }), { bpm: 120 });
  assert.match(text, /^1 v5 [^@]/m);
  assert.match(text, /^9 v5 @0 /m);
});

test('rhythm mode omits SD/HH/TOM/TC and warns; throws when no channel keeps a pitch', () => {
  const source = vgm([0x51,0x0e,0x20|0x10,0x61,0x3a,0x11,0x66], { opll: 3579545 });
  assert.throws(() => exportMgsdrvMml(source, { bpm: 120 }), /No convertible/);
});

test('wrapped continuation lines repeat the track id (MGSC requires it on every line)', () => {
  const commands = [0xa0, 7, 0x3e, 0xa0, 8, 15];
  const wait = [0x61, 0x89, 0x15]; // ~5513 samples = one sixteenth note at 120 BPM
  for (let i = 0; i < 40; i++) {
    const period = 100 + (i % 2) * 20;
    commands.push(0xa0, 0, period & 0xff, 0xa0, 1, (period >> 8) & 15, ...wait);
  }
  commands.push(0x66);
  const text = exportMgsdrvMml(vgm(commands, { ay: 1789773 }), { bpm: 120 });
  const psgBlockStart = text.indexOf('; PSG CH A');
  const psgBlockEnd = text.indexOf('; PSG CH B');
  const block = text.slice(psgBlockStart, psgBlockEnd).split('\n').filter(l => l.trim() && !l.startsWith(';'));
  assert.ok(block.length > 1, 'expected the long note sequence to wrap onto multiple lines');
  for (const line of block) assert.match(line, /^1 /, `every wrapped line must repeat the track id: "${line}"`);
});

test('tied durations repeat the pitch/rest letter with "&"; no "^" or bare dotted-whole tokens', () => {
  // fnum/block chosen so the note lasts a dotted-whole (24 sixteenths); must
  // decompose into a tied "1" + "2" chunk, matching the proven OPNAvoid table.
  const commands = [
    0x51,0x30,(1<<4),0x51,0x10,200,0x51,0x20,0x10|(4<<1),
    // 3 * 44100 = 132300 samples = 24 sixteenths at 120 BPM (5512.5 samples each).
    0x61,0x44,0xac, 0x61,0x44,0xac, 0x61,0x44,0xac,
    0x66,
  ];
  const text = exportMgsdrvMml(vgm(commands, { opll: 3579545 }), { bpm: 120 });
  assert.doesNotMatch(text, /\^/);
  assert.doesNotMatch(text, /\b1\.\b/);
  assert.match(text, /[a-g][+]?1& [a-g][+]?2\b/);
});

test('invalid BPM is rejected', () => {
  const source = vgm([0x66], { ay: 1789773 });
  assert.throws(() => exportMgsdrvMml(source, { bpm: 0 }), /BPM/);
  assert.throws(() => exportMgsdrvMml(source, { bpm: NaN }), /BPM/);
});

test('custom OPLL voice preserves separate modulator and carrier key scaling', () => {
  const text = exportMgsdrvMml(vgm([
    0x51,2,0x40,0x51,3,0x80,0x51,0x10,200,0x51,0x20,0x18,0x61,0x3a,0x11,0x66,
  ], {opll:3579545}));
  assert.match(text, /0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,\n\s*0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0/);
});

test('rhythm entry ends melodic CH8/9 notes in both extraction and MML', async () => {
  const {extractOpllNotes} = await import('./ym2413_notes.js');
  const source = vgm([
    0x51,0x37,0x10,0x51,0x38,0x10,
    0x51,0x17,200,0x51,0x27,0x18,0x51,0x18,200,0x51,0x28,0x18,
    0x61,0x89,0x15,0x51,0x0e,0x20,0x61,0x89,0x15,0x66,
  ], {opll:3579545});
  for (const ch of extractOpllNotes(source).channels.slice(7)) {
    assert.equal(ch.notes.length,1);
    assert.equal(ch.notes[0].end,5513);
  }
  const text=exportMgsdrvMml(source);
  for (const track of ['g','h']) assert.match(text,new RegExp(`^${track} v5 @0 .*16 r16$`,'m'));
});
