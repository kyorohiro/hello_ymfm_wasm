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
    // Below 24 (C1) and above 93 (A6) are beyond even the deepest fallback tiers.
    assert.equal(noteToFretPosition(23, strings), null);
    assert.equal(noteToFretPosition(94, strings), null);
  }
});
test('extra bass strings extend range without moving existing pitches', () => {
  // 35 is below the 6-string preset's lowest real string, so it only reaches the "9" fallback.
  assert.equal(noteToFretPosition(35,6).stringIndex,-1);
  assert.notEqual(noteToFretPosition(35,7).stringIndex,-1);
  assert.equal(noteToFretPosition(30,7).stringIndex,-1);
  assert.notEqual(noteToFretPosition(30,8).stringIndex,-1);
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
  assert.match(renderFretboard([23,94]),/↓ B0, ↑ A#6/);
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

test('recent notes fade, expire, deduplicate and never dim the current note', () => {
  const history = [{note:60,ageMs:1250},{note:60,ageMs:0},{note:64,ageMs:1250},
    {note:67,ageMs:2500},{note:null,ageMs:0},{note:23,ageMs:0}];
  const released = renderFretboard([], {keyOn:false,history});
  assert.equal((released.match(/data-fret-ghost="60"/g)||[]).length,1);
  assert.match(released,/data-fret-ghost="60" opacity="0.550"/);
  assert.match(released,/data-fret-ghost="64" opacity="0.275"/);
  assert.doesNotMatch(released,/data-fret-ghost="(?:67|23)"/);
  assert.doesNotMatch(released,/data-fret-note=/);
  const active = renderFretboard([60], {history});
  assert.match(active,/data-fret-note="60"/);
  assert.doesNotMatch(active,/data-fret-ghost="60"/);
});

test('preferred range wins, then hand stays put across all pitch pairs', async () => {
  const { selectFretPosition } = await import('./fretboard.js');
  for (const strings of [6,7,8]) {
    for (let a=30;a<=88;a++) {
      const previous=selectFretPosition(a,null,strings);
      if(!previous) continue;
      for(let b=30;b<=88;b++) {
        const available=getFretCandidates(b,strings).filter(p=>p.fret<12 || strings-p.stringIndex<=4);
        const standard=available.filter(p=>strings-p.stringIndex<=6 && p.fret<=21);
        const candidates=standard.length ? standard : available;
        const next=selectFretPosition(b,previous,strings);
        if(!candidates.length) {
          // Normal strings can't reach b: only the last-resort "9"/"0" fallback may apply.
          const lowFret=b-25, highFret=b-69;
          const extra = (lowFret>=0 && lowFret<=24) ? {stringIndex:-1,fret:lowFret}
            : (highFret>=0 && highFret<=24) ? {stringIndex:strings,fret:highFret} : null;
          if (!extra) { assert.equal(next,null); continue; }
          assert.deepEqual({stringIndex:next.stringIndex,fret:next.fret}, extra);
          assert.equal(next.handStart, Math.max(0, Math.min(20, extra.fret-2)));
          continue;
        }
        assert.ok(candidates.some(p=>p.stringIndex===next.stringIndex && p.fret===next.fret));
        assert.ok(next.fret>=next.handStart && next.fret<=next.handStart+4);
        if(candidates.some(p=>p.fret>=previous.handStart && p.fret<=previous.handStart+4)) {
          assert.equal(next.handStart,previous.handStart,`hand moved for ${a} -> ${b}`);
        }
      }
    }
  }
});

test('channel tracker retains historical coordinates, releases highlight and isolates hands', async () => {
  const { createFretboardTracker } = await import('./fretboard.js');
  const a=createFretboardTracker(6), b=createFretboardTracker(6);
  const first={midiFloat:72,time:0};
  const initial=a.update([first],72,true,0);
  const old={...initial.activePositions.get(72)};
  const second={midiFloat:64,time:100};
  const moved=a.update([first,second],64,true,100);
  assert.equal(moved.activePositions.get(64).handStart,old.handStart);
  assert.deepEqual(moved.history[0].position,old);
  const off={midiFloat:null,time:200};
  const released=a.update([first,second,off],64,false,200);
  assert.equal(released.activePositions.size,0);
  const svg=renderFretboard([64],released);
  assert.doesNotMatch(svg,/data-fret-note=/);
  assert.match(svg,/data-fret-ghost="64"/);
  assert.deepEqual(b.update([],72,true,200).activePositions.get(72),old);
});

test('once a channel needs a fallback tier, its tracker keeps offering it (no blinking), and higher tiers never move lower rows', async () => {
  const { createFretboardTracker } = await import('./fretboard.js');
  const t = createFretboardTracker(8);
  // 27 forces the "9" row; then a normal note follows with no fallback need.
  const forced = t.update([], 27, true, 0);
  assert.equal(forced.extraRows.lowTiers, 1);
  assert.equal(forced.extraRows.highTiers, 0);
  const after = t.update([], 60, true, 100);
  assert.equal(after.extraRows.lowTiers, 1, 'the "9" row must stay offered even once unused');
  const svg = renderFretboard([60], after);
  assert.match(svg, /9 C#1\*/, 'the fallback row itself must still be drawn once it was ever needed');
  const svgBefore9RowY = svg.match(/8 F#1\*<\/text>\s*<line[^>]*y1="(\d+)"/)?.[1];
  // 24 forces the deeper "10" row; the existing "9" row (and everything above it) must not shift.
  const deeper = t.update([], 24, true, 200);
  assert.equal(deeper.extraRows.lowTiers, 2);
  const svg2 = renderFretboard([60], deeper);
  const svg2Row8Y = svg2.match(/8 F#1\*<\/text>\s*<line[^>]*y1="(\d+)"/)?.[1];
  const svg2Row9Y = svg2.match(/9 C#1\*<\/text>\s*<line[^>]*y1="(\d+)"/)?.[1];
  assert.match(svg2, /10 C1\*/);
  assert.equal(svg2Row8Y, svgBefore9RowY, 'adding "10" must not move string 8');
  assert.ok(Number(svg2Row9Y) === Number(svg2Row8Y) + 27, '"9" stays directly below string 8');
});
test('a note reachable only via the "9"/"0" fallback renders, grows the board, and is marked not-real', () => {
  // 27 has no normal 8-string candidate (lowest open is 30); 91 has none either (highest reach is 88).
  const low = renderFretboard([27], { strings: 8 });
  assert.match(low, /data-fret-note="27"/);
  assert.match(low, /9 C#1\*/);
  assert.match(low, /not a real fretted instrument/);
  const high = renderFretboard([91], { strings: 8 });
  assert.match(high, /data-fret-note="91"/);
  assert.match(high, /0 A4\*/);
  assert.match(high, /not a real fretted instrument/);
  // A normal, in-range note never touches the fallback rows.
  const normal = renderFretboard([60], { strings: 8 });
  assert.doesNotMatch(normal, /9 C#1|0 A4/);
});
test('prefer six strings and 21 frets even when an extended position is closer', async () => {
  const { selectFretPosition } = await import('./fretboard.js');
  const bass=selectFretPosition(40,{stringIndex:0,fret:10,handStart:8},8);
  assert.equal(8-bass.stringIndex,6);
  assert.equal(bass.fret,0);
  const high=selectFretPosition(83,{stringIndex:6,fret:24,handStart:20},8);
  assert.equal(8-high.stringIndex,1);
  assert.equal(high.fret,19);
  assert.equal(8-selectFretPosition(30,null,8).stringIndex,8);
  assert.equal(selectFretPosition(88,null,8).fret,24);
});
