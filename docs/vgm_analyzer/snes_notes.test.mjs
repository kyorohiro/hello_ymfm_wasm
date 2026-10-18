import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/spc_wasm.js';
import {captureSpcPerformance} from '../../web/spc_performance.js';
import {createSyntheticSpc} from '../../web/spc_test_fixture.mjs';
import {buildSnesNoteAnalysis,describeSnesAt} from './snes_notes.js';

const clock = seconds => Math.round(seconds * 1024000);
const preset = {adsr1:0,adsr2:0,gain:127,volumeLeft:64,volumeRight:48};
const noteOn = (seconds = 0,channel = 0,extra = {}) => ({type:'noteOn',clock:clock(seconds),channel,
  sourceNumber:1,sampleId:0,pitch:4096,preset:{...preset},...extra});
const event = (type,seconds,extra = {}) => ({type,clock:clock(seconds),channel:0,...extra});
const dsp = (seconds,register,value) => ({type:'dsp',clock:clock(seconds),register,value});
const instrument = (seconds,extra = {}) => event('instrument',seconds,{sourceNumber:1,...preset,...extra});
const sample = (id = 0) => ({id,sourceNumber:1,loop:true,loopStartSamples:0,
  brr:Uint8Array.of(0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf)});
function performance(events = [],extra = {}) {
  const initialDsp = new Uint8Array(128); initialDsp[0x0c] = initialDsp[0x1c] = 127;
  for (let channel = 0; channel < 8; channel++) initialDsp[(channel << 4) + 7] = 127;
  return {version:1,clockRate:1024000,durationClocks:1024000,initialDsp,events,samples:[sample()],
    warnings:[],controlStepMs:0,...extra};
}

test('eight-voice timeline uses explicit 44,100-Hz display ticks and current descriptors use SPC clocks', () => {
  const input = performance([noteOn(),event('pitch',.25,{pitch:8192}),event('noteOff',.5)]);
  const analysis = buildSnesNoteAnalysis(input);
  assert.equal(analysis.channels.length,8); assert.equal(analysis.time,44100);
  assert.equal(analysis.durationSeconds,1); assert.equal(analysis.displayRate,44100);
  const notes = analysis.channels[0].notes;
  assert.deepEqual(notes.map(note => [note.start,note.end,note.midi,note.key]),[[0,11025,60,1],[11025,22050,72,1]]);
  assert.equal(analysis.channels[0].active,null);
  assert(analysis.channels.slice(1).every(channel => channel.notes.length === 0));
  const before = describeSnesAt(analysis,.2)[0], after = describeSnesAt(analysis,.3)[0];
  assert.equal(before.midi,60); assert.equal(after.midi,72);
  assert.equal(before.referenceKind,'provisional'); assert.equal(before.keyOn,true);
  assert.equal(after.freq,8192); assert.equal(after.held,true);
  assert.equal(describeSnesAt(analysis,.5)[0].midi,null);
  assert.equal(describeSnesAt(analysis,.5)[0].held,false);
  assert(analysis.channels[0].states.some(state => state.clock === clock(.25)));
  assert(analysis.warnings instanceof Map);
  assert.deepEqual(structuredClone(analysis),analysis,'Workers can transfer the entire result without functions');
});

test('captured BRR version IDs, not SRCN aliases, select musical references', () => {
  const input = performance([noteOn(),noteOn(0,1,{sampleId:1}),
    instrument(.25,{sampleId:1}),event('pitch',.5,{pitch:2048})],{samples:[sample(),sample(1)]});
  const analysis = buildSnesNoteAnalysis(input,{references:[
    {sampleId:0,referenceHz:220,kind:'estimated',confidence:'high'},
    {sampleId:1,referenceHz:440,kind:'manual'},
  ]});
  const left = analysis.channels[0].notes;
  assert.deepEqual(left.map(note => [note.start,note.end,note.midi,note.sampleId,note.key]),[
    [0,11025,57,0,1],[11025,22050,69,1,1],[22050,44100,57,1,1],
  ]);
  assert.equal(describeSnesAt(analysis,.1)[0].referenceKind,'estimated');
  assert.equal(describeSnesAt(analysis,.3)[0].referenceKind,'manual');
  assert.equal(describeSnesAt(analysis,.1)[1].midi,69);
  assert.deepEqual(analysis.samples.map(sample => sample.sourceNumber),[1,1]);
});

test('same-pitch retriggers survive and KON under held KOFF closes activity without a spurious note', () => {
  const analysis = buildSnesNoteAnalysis(performance([noteOn(),noteOn(.25),noteOn(.5),
    noteOn(.75,0,{keyOffHeld:true,sampleId:undefined}),dsp(.8,0x5c,0)]));
  assert.deepEqual(analysis.channels[0].notes.map(note => [note.start,note.end,note.key]),[
    [0,11025,1],[11025,22050,2],[22050,33075,3],
  ]);
  assert.equal(describeSnesAt(analysis,.8)[0].keyOn,false);
  assert.equal(describeSnesAt(analysis,.8)[0].trigger,3);
});

test('snapshot-inferred notes are flagged instead of claiming an original onset', () => {
  const analysis = buildSnesNoteAnalysis(performance([noteOn(0,0,{inferred:true,reason:'initial'}),noteOn(.5)]));
  assert.equal(analysis.channels[0].notes[0].inferred,true);
  assert.equal(describeSnesAt(analysis,.2)[0].inferred,true);
  assert.equal(describeSnesAt(analysis,.6)[0].inferred,false);
  assert([...analysis.warnings.keys()].some(text => /original note-on/.test(text)));
});

test('volume and direct-gain disabling close notes and restoration resumes a held request without retriggering', () => {
  const analysis = buildSnesNoteAnalysis(performance([noteOn(),
    event('volume',.1,{volumeLeft:0,volumeRight:0}),event('volume',.2,{volumeLeft:-64,volumeRight:0}),
    dsp(.3,0x0c,0),dsp(.4,0x0c,255),instrument(.5,{gain:0}),instrument(.6,{gain:127})]));
  const notes = analysis.channels[0].notes;
  assert.deepEqual(notes.map(note => [note.start / 44100,note.end / 44100,note.key]),[
    [0,.1,1],[.2,.3,1],[.4,.5,1],[.6,1,1],
  ]);
  assert.equal(describeSnesAt(analysis,.15)[0].held,true);
  assert.equal(describeSnesAt(analysis,.15)[0].reason,'zero-volume');
  assert.equal(describeSnesAt(analysis,.55)[0].reason,'zero-gain');
  assert.equal(describeSnesAt(analysis,.65)[0].trigger,1);
});

test('FLG mute suppresses current notes and reset requires another key-on after clearing', () => {
  const analysis = buildSnesNoteAnalysis(performance([noteOn(),dsp(.1,0x6c,0x60),dsp(.2,0x6c,0x20),
    dsp(.3,0x6c,0xa0),dsp(.4,0x6c,0x20),noteOn(.5)]));
  assert.equal(describeSnesAt(analysis,.15)[0].reason,'muted');
  assert.equal(describeSnesAt(analysis,.15)[0].held,true);
  assert.equal(describeSnesAt(analysis,.25)[0].keyOn,true);
  assert.equal(describeSnesAt(analysis,.35)[0].reason,'reset');
  assert.equal(describeSnesAt(analysis,.45)[0].held,false);
  assert.equal(describeSnesAt(analysis,.55)[0].trigger,2);
  assert.deepEqual(analysis.channels[0].notes.map(note => [note.start / 44100,note.end / 44100]),[[0,.1],[.2,.3],[.5,1]]);
});

test('noise has no musical pitch, PITCH zero has no invented note, and PMON labels only the base pitch', () => {
  const input = performance([noteOn(0,0,{pitch:0}),noteOn(0,1),noteOn(0,2),
    dsp(.25,0x3d,0),event('pitch',.5,{pitch:4096}),dsp(.75,0x2d,0)]);
  input.initialDsp[0x3d] = 1; input.initialDsp[0x2d] = 3;
  const analysis = buildSnesNoteAnalysis(input);
  const noise = describeSnesAt(analysis,.1)[0];
  assert.equal(noise.type,'Noise'); assert.equal(noise.midi,null); assert.equal(noise.keyOn,true);
  assert.equal(noise.pitchModulation,false,'PMON bit 0 is ignored');
  const modulated = describeSnesAt(analysis,.1)[1];
  assert.equal(modulated.midi,60); assert.equal(modulated.pitchModulation,true);
  assert.equal(modulated.reason,'pitch-modulation-base');
  assert.equal(describeSnesAt(analysis,.3)[0].reason,'zero-pitch');
  assert.equal(describeSnesAt(analysis,.6)[0].midi,60);
  assert.equal(describeSnesAt(analysis,.8)[1].pitchModulation,false);
  assert.deepEqual(analysis.channels[0].notes.map(note => [note.start,note.end]),[[22050,44100]]);
});

test('inactive source changes without an observed BRR clear old version and per-voice references remain isolated', () => {
  const analysis = buildSnesNoteAnalysis(performance([noteOn(),event('noteOff',.25),
    instrument(.5,{sourceNumber:8}),event('pitch',.75,{channel:1,pitch:4096})]));
  assert.equal(describeSnesAt(analysis,.6)[0].sampleId,null);
  assert.equal(describeSnesAt(analysis,.6)[0].sourceNumber,8);
  assert.equal(describeSnesAt(analysis,.8)[1].sampleId,null);
  assert.equal(describeSnesAt(analysis,.8)[1].midi,null);
});

test('current lookup uses ordered same-clock state, supports seek backwards and never mutates stored history', () => {
  const analysis = buildSnesNoteAnalysis(performance([noteOn(),event('pitch',.5,{pitch:8192}),event('pitch',.5,{pitch:2048})]));
  assert.equal(describeSnesAt(analysis,.5)[0].midi,48);
  assert.equal(describeSnesAt(analysis,.1)[0].midi,60);
  assert.equal(describeSnesAt(analysis,-1)[0].midi,60);
  const current = describeSnesAt(analysis,.8); current[0].midi = -99;
  assert.equal(describeSnesAt(analysis,.8)[0].midi,48);
  for (const seconds of [1,10]) {
    const ended = describeSnesAt(analysis,seconds)[0];
    assert.equal(ended.keyOn,false); assert.equal(ended.midi,null); assert.equal(ended.available,false);
    assert.equal(ended.reason,'outside-analysis');
  }
  assert.throws(() => describeSnesAt(analysis,NaN),RangeError);
});

test('references preserve fractional cents and explicitly identify fallback instead of fabricating absolute pitch', () => {
  const referenceHz = 440 * 2 ** (23.5 / 1200), input = performance([noteOn()]);
  const before = structuredClone(input);
  const analysis = buildSnesNoteAnalysis(input,{references:[{sampleId:0,referenceHz,kind:'manual'}]});
  const current = describeSnesAt(analysis,.5)[0];
  assert(Math.abs(current.midi - 69.235) < 1e-12); assert.equal(current.frequencyHz,referenceHz);
  assert.equal(current.referenceKind,'manual'); assert.equal(analysis.samples[0].referenceHz,referenceHz);
  assert.deepEqual(input,before,'Building views must not mutate captured audio data or events');
  for (const referenceHz of [Number.MIN_VALUE,Number.MAX_VALUE]) {
    const unusual = buildSnesNoteAnalysis(input,{references:[{sampleId:0,referenceHz,kind:'manual'}]});
    assert.equal(describeSnesAt(unusual,.5)[0].midi,null);
  }
});

test('malformed or excessive performance/reference data is rejected rather than truncated', () => {
  const input = performance([noteOn()]);
  for (const extra of [{version:2},{durationClocks:1},{clockRate:44100},{initialDsp:new Uint8Array(127)},
    {events:Array(20001).fill(noteOn())},{samples:[{...sample(),id:1}]},
    {events:[noteOn(.5),noteOn(.1)]},{events:[event('pitch',0,{pitch:NaN})]},
    {events:[event('volume',0,{volumeLeft:128,volumeRight:0})]}]) {
    assert.throws(() => buildSnesNoteAnalysis({...input,...extra}));
  }
  const reference = {sampleId:0,referenceHz:440,kind:'manual'};
  for (const references of [null,{},[reference,reference],[{...reference,sampleId:1}],
    [{...reference,referenceHz:0}],[{...reference,referenceHz:NaN}],[{...reference,referenceHz:Infinity}],
    [{...reference,kind:'unknown'}],[{...reference,confidence:'certain'}]]) {
    assert.throws(() => buildSnesNoteAnalysis(input,{references}));
  }
});

test('real captured authored SPC produces versioned inferred notes without modifying its captured performance', async () => {
  const wasmBinary = new Uint8Array(await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url)));
  const captured = await captureSpcPerformance(createSyntheticSpc({voices:2}),{
    durationSeconds:.1,controlStepMs:0,moduleFactory:factory,moduleOptions:{wasmBinary},
  });
  const saved = structuredClone(captured);
  const analysis = buildSnesNoteAnalysis(captured,{references:captured.samples.map(sample => ({
    sampleId:sample.id,referenceHz:2000,kind:'estimated',confidence:'high',
  }))});
  assert.equal(analysis.channels[0].notes.length,1); assert.equal(analysis.channels[1].notes.length,1);
  assert.equal(analysis.channels[0].notes[0].inferred,true);
  assert(Math.abs(describeSnesAt(analysis,.05)[0].frequencyHz - 2000) < 1e-9);
  assert.equal(analysis.time,4410);
  assert.deepEqual(captured,saved);
});
