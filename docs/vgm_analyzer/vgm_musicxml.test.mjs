import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicXmlScore} from './vgm_musicxml.js';
import {createLilyPondScore} from './vgm_lilypond.js';
const n = (a,b,midi,key=1) => ({start:a*5512.5,end:b*5512.5,midi,key});
test('bars align, sustained pitches tie across bars, retriggers stay separate', () => {
 const {text,noteCount} = createMusicXmlScore([{name:'A & B',notes:[n(4,20,60),n(20,24,60,2)]}],32*5512.5);
 assert.equal(noteCount,2); assert.match(text,/A &amp; B/);
 const bars = [...text.matchAll(/<measure[^>]*>(.*?)<\/measure>/gs)]; assert.equal(bars.length,2);
 for (const [,bar] of bars) assert.equal([...bar.matchAll(/<duration>(\d+)<\/duration>/g)].reduce((a,m)=>a+Number(m[1]),0),16);
 assert.equal((text.match(/<tie type="start"/g)||[]).length,2);
 assert.equal((text.match(/<tie type="stop"/g)||[]).length,2);
 assert.match(text,/<step>C<\/step><octave>4/);
});
test('same quantization and omission counts as LilyPond without changing its exporter', () => {
 const channels=[{name:'Bass', notes:[n(0,2,48),n(2,4,48.1),n(4,8,null,2),n(8,8.1,72,3),n(10,18,49,4)]}];
 const a=createMusicXmlScore(channels,32*5512.5), b=createLilyPondScore(channels,32*5512.5);
 assert.equal(a.noteCount,b.noteCount); assert.equal(a.skippedNotes,b.skippedNotes);
 assert.match(a.text,/<sign>F<\/sign>/); assert.match(a.text,/<alter>1<\/alter>/);
});
test('reject empty selection and invalid tempo or duration', () => {
 assert.throws(()=>createMusicXmlScore([],0),/Select/);
 for(const bpm of [NaN,0,120.1,1000]) assert.throws(()=>createMusicXmlScore([],0,{bpm}),/BPM/);
 assert.throws(()=>createMusicXmlScore([ {notes:[]} ],Infinity),/long/);
});
test('SPC base-pitch score explains reference and capture limits without claiming PCM was omitted', () => {
 const channels=[{name:'SNES Voice 1',notes:[n(0,4,60)]}];
 const result=createMusicXmlScore(channels,16*5512.5,{chipKind:'snes',fileName:'Song.spc',warnings:['Initially active note inferred.']});
 assert.equal(result.noteCount,1);
 assert.match(result.text,/<step>C<\/step><octave>4/);
 assert.match(result.text,/current Note-ish references/);
 assert.match(result.text,/Only the analyzed SPC interval is exported/);
 assert.match(result.text,/Initially active note inferred/);
 assert.doesNotMatch(result.text,/PCM, noise|VGM loop/);
 assert.match(createMusicXmlScore(channels,16*5512.5).text,/PCM, noise.*VGM loop is not expanded/);
});
