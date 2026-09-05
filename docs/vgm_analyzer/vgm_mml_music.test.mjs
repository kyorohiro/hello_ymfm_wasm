import test from 'node:test';
import assert from 'node:assert/strict';
import { quantizeNotes, writeMml } from './vgm_mml_music.js';
const note = (start, end, midi = 60, key = start, preset = 1) => ({ start, end, midi, key, preset, info: 'fixture' });
const body = events => writeMml(events).split('; Details')[0];
test('eighth notes use default length, octave moves and only changed patches', () => {
  const events = quantizeNotes([note(0,11025,59), note(11025,22050,60), note(22050,33075,62), note(33075,44100,59,4,2)],44100,120);
  const text = body(events);
  assert.match(text, /l8 @1 o3 b > c d @2 < b/);
  assert.equal((text.match(/@1/g) ?? []).length,1);
});
test('stable gaps become gate; terminal gap stays rest and resets q', () => {
  const notes = Array.from({length:4},(_,i)=>note(i*11025,i*11025+8820));
  notes.push(note(44100,55125));
  const events = quantizeNotes(notes,55125,120);
  assert.deepEqual(events.filter(e=>e.type==='note').map(e=>e.gate),[80,80,80,80,100]);
  assert.match(body(events), /q80/);
  assert.match(body(events), /q100/);
  const terminal = quantizeNotes(notes.slice(0,4),44100,120);
  assert.equal(terminal.at(-1).type,'rest');
});
test('isolated and long gaps are rests; dotted and tied values stay readable', () => {
  const events = quantizeNotes([note(0,33075), note(44100,99225)],99225,120);
  assert.match(body(events), /c4\. r8 c2\^8/);
  assert.ok(events.filter(e=>e.type==='note').every(e=>e.gate===100));
});
test('off-grid triplets stay ticks and absolute times do not drift', () => {
  const events=quantizeNotes(Array.from({length:100},(_,i)=>note(i*7350,(i+1)*7350)),735000,120);
  assert.match(body(events), /c%160/);
  assert.equal(events.at(-1).end,16000);
  assert.equal(quantizeNotes([note(200,11225)],11225,120)[0].start,0);
  assert.ok(quantizeNotes([note(1000,12025)],12025,120).some(e=>e.type==='rest'));
});
test('small fluctuations merge only within same key, preset and semitone', () => {
  const events=quantizeNotes([note(0,1000,60,1),note(1000,2000,60.1,1),note(2000,3000,60.6,1),note(3000,4000,60.6,2)],4000,120);
  const notes=events.filter(e=>e.type==='note');
  assert.equal(notes.length,3);
  assert.equal(notes[0].sources.length,2);
  assert.equal(notes[1].midi,61);
});
