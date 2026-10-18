import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSnesNoteAnalysis} from './snes_notes.js';
import {prepareSnesScore} from './snes_score.js';
import {exportNoteAnalysisMidi} from './vgm_midi.js';
import {createMusicXmlScore} from './vgm_musicxml.js';
import {exportLilyPondAnalysis} from './vgm_lilypond.js';

const CLOCK_RATE = 1024000;
const clock = seconds => Math.round(seconds * CLOCK_RATE);
const preset = {adsr1:0,adsr2:0,gain:127,volumeLeft:64,volumeRight:48};
const noteOn = (seconds,channel = 0,extra = {}) => ({type:'noteOn',clock:clock(seconds),channel,
  sourceNumber:channel + 1,sampleId:channel,pitch:4096,preset:{...preset},...extra});
const control = (type,seconds,channel = 0,extra = {}) => ({type,clock:clock(seconds),channel,...extra});
function performance(events,durationSeconds = 2) {
  const initialDsp = new Uint8Array(128);
  initialDsp[0x0c] = initialDsp[0x1c] = 127;
  for (let channel = 0; channel < 8; channel++) initialDsp[(channel << 4) + 7] = 127;
  return {version:1,clockRate:CLOCK_RATE,durationClocks:clock(durationSeconds),initialDsp,events,
    samples:[0,1].map(id => ({id,sourceNumber:id + 1,loop:true,loopStartSamples:0,
      brr:Uint8Array.of(0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf)})),
    warnings:['Captured sample RAM version retained.'],controlStepMs:20};
}
function decodeMidi(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii = (at,length) => new TextDecoder().decode(bytes.subarray(at,at + length));
  assert.equal(ascii(0,4),'MThd'); assert.equal(view.getUint16(8),1);
  const trackCount = view.getUint16(10), ppqn = view.getUint16(12), tracks = [];
  let position = 14;
  function vlq() {
    let value = 0;
    for (let count = 0; count < 4; count++) {
      const byte = bytes[position++]; value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    assert.fail('Invalid MIDI variable-length quantity');
  }
  for (let track = 0; track < trackCount; track++) {
    assert.equal(ascii(position,4),'MTrk');
    const end = position + 8 + view.getUint32(position + 4), events = [];
    position += 8; let tick = 0;
    while (position < end) {
      tick += vlq(); const status = bytes[position++];
      if (status === 255) {
        const type = bytes[position++], length = vlq(), data = bytes.slice(position,position + length);
        position += length; events.push({tick,status,type,data});
      } else {
        const length = (status & 0xf0) === 0xc0 ? 1 : 2, data = bytes.slice(position,position + length);
        position += length; events.push({tick,status,data});
      }
    }
    assert.equal(position,end); tracks.push(events);
  }
  assert.equal(position,bytes.length); return {ppqn,tracks};
}
const noteEvents = track => track.filter(event => [0x80,0x90].includes(event.status & 0xf0));

test('captured key events and BRR references feed MIDI and both score formats without changing performance',()=>{
  const input = performance([
    noteOn(0,0,{inferred:true}),noteOn(0,1),
    control('pitch',.25,0,{pitch:4608}),control('pitch',.5,0,{pitch:4096}),
    control('noteOff',.75),noteOn(1),noteOn(1.25),
    noteOn(1.5,0,{keyOffHeld:true,sampleId:undefined}),
  ]);
  const savedPerformance = structuredClone(input);
  const noteish = buildSnesNoteAnalysis(input,{references:[{sampleId:0,referenceHz:440,kind:'manual'}]});
  const savedNoteish = structuredClone(noteish), score = prepareSnesScore(noteish);
  assert.equal(score.chipKind,'snes'); assert.equal(score.chipName,'SNES');
  assert.equal(score.channels.length,8); assert.equal(score.time / 44100,2);
  assert.deepEqual(score.channels[0].notes.map(note => [note.start / 44100,note.end / 44100,note.key]),[
    [0,.25,1],[.25,.5,1],[.5,.75,1],[1,1.25,2],[1.25,1.5,3],
  ]);
  assert.equal(score.channels[0].notes[0].midi,69);
  assert.equal(score.channels[1].notes[0].midi,60);
  assert.match(score.exportSummary,/0–2\.00 seconds/);
  assert.match(score.exportSummary,/1 used BRR version\(s\) have provisional/);
  assert(score.warnings.some(warning => /sample RAM.*\(1\)/.test(warning)));
  assert(score.warnings.some(warning => /original note-on times/.test(warning)));
  assert.deepEqual(score.tempo,{bpm:120,estimated:false,candidates:[]});

  const midi = exportNoteAnalysisMidi(score,{bpm:120,fileName:'authored.spc'}), decoded = decodeMidi(midi.bytes);
  assert.equal(decoded.ppqn,960); assert.equal(decoded.tracks.length,9); assert.equal(midi.noteCount,4);
  assert.deepEqual(noteEvents(decoded.tracks[1]).map(event => [event.tick,event.status,...event.data]),[
    [0,0x90,69,100],[1440,0x80,69,0],
    [1920,0x90,69,100],[2400,0x80,69,0],[2400,0x90,69,100],[2880,0x80,69,0],
  ]);
  assert.deepEqual(noteEvents(decoded.tracks[2]).map(event => [event.tick,event.status,...event.data]),[
    [0,0x91,60,100],[3840,0x81,60,0],
  ]);
  assert(decoded.tracks[1].some(event => event.status === 0xe0 && event.tick === 480));
  assert(decoded.tracks[1].some(event => event.status === 0xe0 && event.tick === 960));
  assert(decoded.tracks.every(track => track.at(-1).tick === 3840));
  const midiText = decoded.tracks[0].filter(event => event.type === 1)
    .map(event => new TextDecoder().decode(event.data)).join('\n');
  assert.match(midiText,/provisional/); assert.match(midiText,/inferred|Inferred/);

  const options = {bpm:120,fileName:'authored.spc',warnings:score.warnings,chipKind:score.chipKind};
  const xml = createMusicXmlScore(score.channels,score.time,options), lily = exportLilyPondAnalysis(score,options);
  assert.equal(xml.noteCount,6); assert.equal(lily.noteCount,6);
  assert.equal((xml.text.match(/<score-part id=/g) ?? []).length,8);
  assert.equal((lily.text.match(/\\new Staff \\with/g) ?? []).length,8);
  const firstPart = xml.text.match(/<part id="P1">([\s\S]*?)<\/part>/)[1];
  assert.match(firstPart,/<step>A<\/step><octave>4<\/octave>/);
  assert.match(firstPart,/<step>B<\/step><octave>4<\/octave>/);
  assert.match(firstPart,/<rest\/><duration>2<\/duration>/);
  assert.match(lily.text,/SPC transcription \(quantized\)/);
  assert.match(lily.text,/a'8 b'8 a'8 r8 a'8 a'8 r4/);
  for (const result of [xml,lily]) {
    assert(result.warnings.some(warning => /Only the analyzed SPC interval/.test(warning)));
    assert(!result.warnings.some(warning => /PCM.*omitted|VGM loop/.test(warning)));
  }
  assert.deepEqual(input,savedPerformance,'Export never edits DSP, BRR bytes, raw PITCH, events or audio metadata');
  assert.deepEqual(noteish,savedNoteish,'Normalization and exporters never modify the Note-ish cache');
});

test('manual tuning replaces provisional note names in every export while raw event pitch and times stay unchanged',()=>{
  const input = performance([noteOn(0),control('noteOff',1)]);
  const before = structuredClone(input), provisional = buildSnesNoteAnalysis(input);
  const corrected = buildSnesNoteAnalysis(input,{references:[{sampleId:0,referenceHz:440,kind:'manual'}]});
  const initial = prepareSnesScore(provisional), changed = prepareSnesScore(corrected);
  assert.match(initial.exportSummary,/1 used BRR version/); assert.match(changed.exportSummary,/0 used BRR version/);
  for (const [score,note,letter] of [[initial,60,'C'],[changed,69,'A']]) {
    const midi = decodeMidi(exportNoteAnalysisMidi(score).bytes);
    assert.equal(noteEvents(midi.tracks[1])[0].data[0],note);
    const xml = createMusicXmlScore(score.channels,score.time,{bpm:120,chipKind:'snes',warnings:score.warnings});
    assert.match(xml.text,new RegExp(`<step>${letter}</step><octave>4</octave>`));
    const lily = exportLilyPondAnalysis(score,{bpm:120});
    assert.match(lily.text,new RegExp(`\\b${letter.toLowerCase()}'2\\b`));
  }
  assert.equal(initial.channels[0].notes[0].midi,60,'Previously prepared source remains an independent revision');
  assert.deepEqual(corrected.channels[0].notes.map(note => [note.start,note.end,note.pitch]),
    provisional.channels[0].notes.map(note => [note.start,note.end,note.pitch]));
  assert.deepEqual(input,before);
});

test('SNES tempo suggestion uses key-on intervals rather than sampled pitch controls',()=>{
  const events = [];
  for (let i = 0; i < 12; i++) {
    const start = i * .5;
    events.push(noteOn(start),control('pitch',start + .1,0,{pitch:4200}),control('noteOff',start + .3));
  }
  const score = prepareSnesScore(buildSnesNoteAnalysis(performance(events,6)));
  assert.equal(score.tempo.estimated,true);
  assert.equal(score.tempo.bpm,120); assert(score.tempo.candidates.includes(120));
  assert.equal(score.channels[0].notes.length,24);
  const midi = exportNoteAnalysisMidi(score,{bpm:score.tempo.bpm});
  assert.equal(midi.noteCount,12,'Pitch controls stay bends rather than extra note-ons');
});

test('SNES score adapter rejects incomplete analyses and nonfinite interval durations',()=>{
  const valid = buildSnesNoteAnalysis(performance([noteOn(0)]));
  for (const bad of [null,{...valid,version:0},{...valid,clockRate:44100},{...valid,displayRate:32000},
    {...valid,time:NaN},{...valid,time:0},{...valid,channels:[]},{...valid,warnings:[]},
    {...valid,durationSeconds:NaN},{...valid,durationSeconds:Infinity},{...valid,durationSeconds:0},
    {...valid,durationSeconds:1}]) {
    assert.throws(()=>prepareSnesScore(bad),/completed SNES Note-ish analysis/);
  }
});
