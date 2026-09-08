import test from 'node:test';
import assert from 'node:assert/strict';
import { getFretCandidates, noteToFretPosition, renderFretboard } from './fretboard.js';

test('all supported pitches map exactly and progress from low to high strings', () => {
  for (const [strings, opens] of [[6,[40,45,50,55,59,64]], [7,[35,40,45,50,55,59,64]], [8,[30,35,40,45,50,55,59,64]]]) {
    let previous = -1;
    for (let note = opens[0]; note <= 88; note++) {
      const p = noteToFretPosition(note, strings);
      assert.equal(opens[p.stringIndex] + p.fret, note);
      assert.ok(p.fret >= 0 && p.fret <= 24);
      assert.ok(p.stringIndex >= previous);
      previous = p.stringIndex;
      assert.deepEqual(noteToFretPosition(note, strings), p);
      assert.ok(getFretCandidates(note, strings).some(c => c.stringIndex === p.stringIndex && c.fret === p.fret));
    }
    assert.equal(noteToFretPosition(opens[0]-1, strings), null);
    assert.equal(noteToFretPosition(89, strings), null);
  }
});
test('extra bass strings extend range without moving existing pitches', () => {
  assert.equal(noteToFretPosition(35,6),null);
  assert.ok(noteToFretPosition(35,7));
  assert.equal(noteToFretPosition(30,7),null);
  assert.ok(noteToFretPosition(30,8));
  for(let n=40;n<=88;n++) {
    const a=noteToFretPosition(n,6), b=noteToFretPosition(n,8);
    assert.equal(a.fret,b.fret);
    assert.equal(6-a.stringIndex,8-b.stringIndex);
  }
});
test('multiple active notes, rounding, release and out-of-range indication', () => {
  const on=renderFretboard([60.1,64,67,60.1,null]);
  assert.equal((on.match(/data-fret-note=/g)||[]).length,3);
  assert.match(on,/data-fret-note="60"/);
  assert.doesNotMatch(renderFretboard([60,64],{keyOn:false}),/data-fret-note=/);
  assert.match(renderFretboard([24,96]),/↓ C1, ↑ C7/);
  for(const n of [null,NaN,60.1,-1,128]) assert.equal(noteToFretPosition(n),null);
});
