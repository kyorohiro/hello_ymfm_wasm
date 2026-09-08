import test from 'node:test';
import assert from 'node:assert/strict';
import { getFretCandidates, noteToFretPosition, renderFretboard } from './fretboard.js';

test('all supported pitches map exactly to fixed positions in the correct string group', () => {
  for (const [strings, opens] of [[6,[40,45,50,55,59,64]], [7,[35,40,45,50,55,59,64]], [8,[30,35,40,45,50,55,59,64]]]) {
    for (let note = opens[0]; note <= 88; note++) {
      const p = noteToFretPosition(note, strings);
      assert.equal(opens[p.stringIndex] + p.fret, note);
      assert.ok(p.fret >= 0 && p.fret <= 24);
      const stringNumber = strings - p.stringIndex;
      if (note >= 40 && note < 60) assert.ok(stringNumber >= 4 && stringNumber <= 6);
      if (note >= 60) assert.ok(stringNumber >= 1 && stringNumber <= 3);
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

test('nearby pitches share a string and treble registers use all three strings', () => {
  for (const [low, high, string] of [[40,47,6],[48,53,5],[54,59,4],
    [60,65,3],[66,71,2],[72,88,1]]) {
    for (let note = low; note <= high; note++) {
      assert.equal(6 - noteToFretPosition(note,6).stringIndex, string);
    }
  }
});

test('first string never uses frets zero through four with the distributed mapping', () => {
  for (const strings of [6,7,8]) {
    for (let note=0; note<=127; note++) {
      const p=noteToFretPosition(note,strings);
      if(p && strings-p.stringIndex===1) assert.ok(p.fret>=5);
    }
    assert.deepEqual(noteToFretPosition(64,strings), {stringIndex:strings-3,fret:9});
    assert.deepEqual(noteToFretPosition(65,strings), {stringIndex:strings-3,fret:10});
  }
});

test('adjacent pitches never jump by more than four frets, including octave boundaries', () => {
  for (const [strings, lowest] of [[6,40],[7,35],[8,30]]) {
    for(let n=lowest;n<88;n++) {
      const a=noteToFretPosition(n,strings), b=noteToFretPosition(n+1,strings);
      assert.ok(Math.abs(a.fret-b.fret)<=4, `note ${n} -> ${n+1}`);
    }
    assert.equal(noteToFretPosition(72,strings).fret,8);
    assert.equal(noteToFretPosition(71,strings).fret,12);
  }
});
