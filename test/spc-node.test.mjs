import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/spc_wasm.js';
import {captureSpcPerformance} from '../docs/js/spc_performance.js';
import {estimateBrrPitch} from '../docs/js/spc_pitch.js';
import {buildSnesNoteAnalysis} from '../docs/vgm_analyzer/snes_notes.js';
import {prepareSnesScore} from '../docs/vgm_analyzer/snes_score.js';
import {exportNoteAnalysisMidi} from '../docs/vgm_analyzer/vgm_midi.js';
import {createMusicXmlScore} from '../docs/vgm_analyzer/vgm_musicxml.js';
import {createLilyPondScore} from '../docs/vgm_analyzer/vgm_lilypond.js';
import {createSyntheticSpc} from '../web/spc_test_fixture.mjs';
import {isSpcSource,analyzeSpcSource,exportSpcAnalysis,listSpcScoreChannels} from '../cli/spc.js';

function taggedFixture(seconds = 1) {
  const bytes = createSyntheticSpc({voices:2});
  bytes[0x23] = 0x1a;
  const text = new TextEncoder();
  bytes.set(text.encode('Authored SPC'),0x2e);
  bytes.set(text.encode('2026/10/18'),0x9e);
  bytes.set(text.encode(String(seconds).padStart(3,'0')),0xa9);
  bytes.set(text.encode('00000'),0xac);
  return bytes;
}

function midiEndSeconds(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(new TextDecoder().decode(bytes.subarray(0,4)),'MThd');
  const ppqn = view.getUint16(12), count = view.getUint16(10), tracks = [];
  let at = 14, tempo;
  const vlq = () => {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = bytes[at++]; value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    assert.fail('Bad MIDI VLQ');
  };
  for (let index = 0; index < count; index++) {
    const end = at + 8 + view.getUint32(at + 4); at += 8;
    let ticks = 0;
    while (at < end) {
      ticks += vlq(); const status = bytes[at++];
      if (status === 255) {
        const kind = bytes[at++], length = vlq();
        if (kind === 0x51) tempo = bytes[at] * 65536 + bytes[at + 1] * 256 + bytes[at + 2];
        at += length;
      } else at += (status & 0xf0) === 0xc0 ? 1 : 2;
    }
    assert.equal(at,end); tracks.push(ticks);
  }
  assert.equal(at,bytes.length);
  return tracks.map(ticks => ticks * tempo / (ppqn * 1000000));
}

test('SPC detection accepts short headers, typed-array offsets and ArrayBuffers without misclassifying VGM',()=>{
  const bytes = createSyntheticSpc(), padded = new Uint8Array(bytes.length + 7);
  padded.set(bytes,7);
  for (const input of [bytes,bytes.buffer,bytes.subarray(0,32),padded.subarray(7,39),new DataView(padded.buffer,7,32)]) {
    assert.equal(isSpcSource(input),true);
  }
  for (const input of [null,{},'SPC',new Uint8Array(),bytes.subarray(0,20),Uint8Array.of(0x56,0x67,0x6d,0x20)]) {
    assert.equal(isSpcSource(input),false);
  }
});

test('Node SPC analysis and all exports match the browser algorithm pipeline exactly',async()=>{
  const bytes = taggedFixture(), before = bytes.slice(), options = {durationSeconds:.5,controlStepMs:0};
  const wasmBinary = await readFile(new URL('../docs/generated/spc_wasm.wasm',import.meta.url));
  const captured = await captureSpcPerformance(bytes,{...options,moduleFactory:factory,moduleOptions:{wasmBinary}});
  const estimates = captured.samples.map(sample => ({sampleId:sample.id,...estimateBrrPitch(sample)}));
  const references = estimates.filter(estimate => estimate.confidence === 'high').map(estimate => ({
    sampleId:estimate.sampleId,referenceHz:estimate.referenceHz,kind:'estimated',confidence:'high',
  }));
  const browser = prepareSnesScore(buildSnesNoteAnalysis(captured,{references}));
  const node = await analyzeSpcSource(bytes,options);
  assert.equal(node.format,'SPC'); assert.equal(node.metadata.title,'Authored SPC');
  assert.equal(node.durationSeconds,.5); assert.equal(node.time,22050);
  assert.deepEqual(node.channels,browser.channels); assert.deepEqual(node.samples,browser.samples);
  assert.deepEqual(node.estimates,estimates); assert.deepEqual(node.references,references);
  assert.deepEqual(node.statistics,captured.statistics);
  assert.equal(node.channels[0].notes.length,1); assert.equal(node.channels[1].notes.length,1);
  assert(node.samples.every(sample => sample.referenceKind === 'estimated'));
  const common = {bpm:120,fileName:'authored.spc'};
  assert.deepEqual(exportSpcAnalysis(node,{...common,format:'midi'}),exportNoteAnalysisMidi(browser,common));
  const scoreOptions = {...common,warnings:browser.warnings,chipKind:'snes'};
  assert.deepEqual(exportSpcAnalysis(node,{...common,format:'musicxml'}),createMusicXmlScore(browser.channels,browser.time,scoreOptions));
  assert.deepEqual(exportSpcAnalysis(node,{...common,format:'lilypond'}),createLilyPondScore(browser.channels,browser.time,scoreOptions));
  assert.deepEqual(bytes,before,'Capture and exports never modify the original SPC image');
});

test('manual Hz and note/cents references override estimates and retain raw PITCH and timing',async()=>{
  const bytes = createSyntheticSpc({voices:2}), source = bytes.slice();
  const automatic = await analyzeSpcSource(bytes,{durationSeconds:.1});
  const references = [{sampleId:0,note:'A4',cents:23.5}], saved = structuredClone(references);
  const tuned = await analyzeSpcSource(bytes,{durationSeconds:.1,references});
  const hz = 440 * 2 ** (23.5 / 1200);
  const explicit = await analyzeSpcSource(bytes,{durationSeconds:.1,references:[{sampleId:0,referenceHz:hz}]});
  assert.equal(tuned.samples[0].referenceKind,'manual');
  assert.equal(tuned.samples[0].referenceHz,hz); assert.deepEqual(explicit.channels,tuned.channels);
  assert(Math.abs(tuned.channels[0].notes[0].midi - 69.235) < 1e-10);
  assert.notEqual(tuned.channels[0].notes[0].midi,automatic.channels[0].notes[0].midi);
  const raw = score => score.channels.map(channel => channel.notes.map(({start,end,key,pitch,sampleId}) => ({start,end,key,pitch,sampleId})));
  assert.deepEqual(raw(tuned),raw(automatic)); assert.deepEqual(references,saved); assert.deepEqual(bytes,source);
  await assert.rejects(analyzeSpcSource(bytes,{durationSeconds:.1,references:[{sampleId:1,referenceHz:440}]}),/Unknown BRR sampleId/);
});

test('MIDI retains analyzed seconds across BPM changes and all eight independent voices',async()=>{
  const score = await analyzeSpcSource(createSyntheticSpc({voices:8}),{durationSeconds:.5});
  const saved = structuredClone(score);
  for (const bpm of [60,120,240]) {
    const midi = exportSpcAnalysis(score,{format:'midi',bpm});
    const ends = midiEndSeconds(midi.bytes);
    assert.equal(ends.length,9); assert.equal(midi.noteCount,8);
    assert(ends.every(seconds => Math.abs(seconds - .5) < 1e-9));
  }
  assert.deepEqual(score,saved);
});

test('SPC score IDs, channel selection and grouping reuse the VGM score semantics',async()=>{
  const score = await analyzeSpcSource(createSyntheticSpc({voices:2}),{durationSeconds:.5});
  const saved = structuredClone(score), inventory = listSpcScoreChannels(score);
  assert.deepEqual(inventory.channels.map(channel => channel.id),Array.from({length:8},(_,index) => `snes-voice-${index + 1}`));
  assert.deepEqual(inventory.channels.map(channel => channel.noteCount),[1,1,0,0,0,0,0,0]);
  for (const format of ['musicxml','lilypond']) {
    const one = exportSpcAnalysis(score,{format,bpm:120,channels:['snes-voice-2']});
    assert.match(one.text,/SNES Voice 2/); assert.doesNotMatch(one.text,/SNES Voice 1/);
    const grouped = exportSpcAnalysis(score,{format,bpm:120,group:['Pair=snes-voice-1,snes-voice-2']});
    assert.match(grouped.text,/Pair/);
    const all = exportSpcAnalysis(score,{format,bpm:120,mergeAll:true}); assert.match(all.text,/All channels/);
    for (const channels of [[],['snes-voice-1','snes-voice-1'],['snes-voice-0'],[1]]) {
      assert.throws(()=>exportSpcAnalysis(score,{format,channels}));
    }
    assert.throws(()=>exportSpcAnalysis(score,{format,group:['Bad=snes-voice-9']}));
    assert.throws(()=>exportSpcAnalysis(score,{format,groups:[],group:[]}));
  }
  assert.throws(()=>exportSpcAnalysis(score,{format:'midi',channels:['snes-voice-1']}),/Channel selection/);
  assert.throws(()=>exportSpcAnalysis(score,{format:'midi',mergeAll:true}),/Grouping/);
  assert.throws(()=>exportSpcAnalysis(score,{format:'wav'}),/format/);
  for (const bpm of [NaN,Infinity,0,3,1000,120.5]) assert.throws(()=>exportSpcAnalysis(score,{format:'midi',bpm}),/BPM/);
  assert.deepEqual(score,saved);
});

test('default interval uses a finite tag duration and otherwise caps at 120 seconds',async()=>{
  const tagged = await analyzeSpcSource(taggedFixture(1));
  assert.equal(tagged.durationSeconds,1); assert.equal(tagged.statistics.controlStepMs,20);
  for (const bytes of [createSyntheticSpc(),taggedFixture(999)]) {
    const controller = new AbortController(); let requested;
    await assert.rejects(analyzeSpcSource(bytes,{signal:controller.signal,onProgress(progress) {
      requested = progress.durationSeconds; controller.abort();
    }}),{name:'AbortError'});
    assert.equal(requested,120);
  }
});

test('invalid intervals, references and malformed scores fail without silent coercion or truncation',async()=>{
  const bytes = createSyntheticSpc();
  for (const durationSeconds of [null,NaN,Infinity,-1,0,.099,600.1,'1']) {
    await assert.rejects(analyzeSpcSource(bytes,{durationSeconds}),/durationSeconds/);
  }
  for (const controlStepMs of [null,NaN,Infinity,-1,1001,'20']) {
    await assert.rejects(analyzeSpcSource(bytes,{durationSeconds:.1,controlStepMs}),/controlStepMs/);
  }
  const hz = {sampleId:0,referenceHz:440};
  for (const references of [null,{},Array(257).fill(hz),[hz,hz],
    [{sampleId:0}], [{sampleId:-1,referenceHz:440}], [{sampleId:256,referenceHz:440}],
    [{sampleId:0,referenceHz:0}],[{sampleId:0,referenceHz:NaN}],[{sampleId:0,referenceHz:Infinity}],
    [{...hz,note:'A4'}],[{...hz,cents:0}],[{...hz,kind:'manual'}],
    [{sampleId:0,note:69}],[{sampleId:0,note:'H4'}],[{sampleId:0,note:'C10'}],
    [{sampleId:0,note:'A4',cents:'0'}],[{sampleId:0,note:'A4',cents:101}]]) {
    await assert.rejects(analyzeSpcSource(bytes,{durationSeconds:.1,references}));
  }
  await assert.rejects(analyzeSpcSource(new Uint8Array(100),{durationSeconds:.1}),/Truncated SPC/);
  await assert.rejects(analyzeSpcSource(bytes,{durationSeconds:.1,onProgress:1}),/onProgress/);
  const score = await analyzeSpcSource(bytes,{durationSeconds:.1});
  for (const bad of [{...score,time:Infinity},{...score,channels:[]},{...score,warnings:[{}]},
    {...score,channels:[{...score.channels[0],notes:[{...score.channels[0].notes[0],start:-1}]},...score.channels.slice(1)]}]) {
    assert.throws(()=>listSpcScoreChannels(bad)); assert.throws(()=>exportSpcAnalysis(bad,{format:'musicxml'}));
  }
});

test('abort and readable-event caps reject a whole SPC conversion',async()=>{
  const bytes = createSyntheticSpc(), controller = new AbortController(); controller.abort();
  await assert.rejects(analyzeSpcSource(bytes,{durationSeconds:.1,signal:controller.signal}),{name:'AbortError'});
  const ongoing = new AbortController();
  await assert.rejects(analyzeSpcSource(bytes,{durationSeconds:1,signal:ongoing.signal,
    onProgress() {ongoing.abort();}}),{name:'AbortError'});
  const storm = createSyntheticSpc(), ram = storm.subarray(0x100,0x10100);
  // Authored SMP program repeatedly changes voice 1 PITCH low byte.
  ram.set([0x8f,2,0xf2,0xe8,0,0xc4,0xf3,0xbc,0x2f,0xfb],0x200);
  await assert.rejects(analyzeSpcSource(storm,{durationSeconds:.5,controlStepMs:0}),/event limit/);
  const sampled = await analyzeSpcSource(storm,{durationSeconds:.1,controlStepMs:20});
  assert(sampled.statistics.controlsOmitted > 0); assert(sampled.statistics.eventCount < 100);
});
