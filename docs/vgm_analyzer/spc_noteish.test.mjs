import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSnesNoteAnalysis} from './snes_notes.js';
import {channelsForSnesNoteAnalysis} from './spc_noteish.js';

const clock = seconds => Math.round(seconds * 1024000);
function captured(events = [],duration = 12) {
  const initialDsp = new Uint8Array(128);initialDsp[0x0c] = initialDsp[0x1c] = 127;
  return {version:1,clockRate:1024000,durationClocks:clock(duration),initialDsp,events,samples:[{
    id:0,sourceNumber:1,loop:true,loopStartSamples:0,brr:Uint8Array.of(0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf),
  }],warnings:[],controlStepMs:0};
}
const note = (seconds=0) => ({type:'noteOn',clock:clock(seconds),channel:0,sourceNumber:1,sampleId:0,pitch:4096,
  preset:{adsr1:0,adsr2:0,gain:127,volumeLeft:64,volumeRight:64}});

test('generic SNES displays retain channel identity and use only current/past observations',()=>{
  const analysis = buildSnesNoteAnalysis(captured([note(),{type:'pitch',clock:clock(.8),channel:0,pitch:8192}]));
  const first = channelsForSnesNoteAnalysis(analysis,.1), identity = first[0];
  assert.equal(first.length,8);assert.equal(first[0].toneMidi,60);assert.equal(first[0].noteMinMidi,60);assert.equal(first[0].noteMaxMidi,60);
  assert(first[0].noteHistory.every(point=>point.time<=100));
  assert.strictEqual(channelsForSnesNoteAnalysis(analysis,.1),first,'A frozen playback position reuses its cached display');
  const second = channelsForSnesNoteAnalysis(analysis,.9,{muteMask:1});
  assert.strictEqual(second[0],identity,'Fretboard WeakMap keys survive clock polls');
  assert.equal(second[0].toneMidi,72);assert.equal(second[0].noteMaxMidi,72);assert.equal(second[0].muted,true);
});

test('seek rewinds notes, cumulative range and history; Stop clears active markers',()=>{
  const analysis = buildSnesNoteAnalysis(captured([note(),{type:'pitch',clock:clock(.8),channel:0,pitch:8192}]));
  channelsForSnesNoteAnalysis(analysis,1);
  const earlier = channelsForSnesNoteAnalysis(analysis,.2);
  assert.equal(earlier[0].toneMidi,60);assert.equal(earlier[0].noteMaxMidi,60);
  assert(earlier[0].noteHistory.every(point=>point.time<=200));
  const stopped = channelsForSnesNoteAnalysis(analysis,0,{stopped:true});
  assert.equal(stopped[0].keyOn,false);assert.equal(stopped[0].toneMidi,null);assert.deepEqual(stopped[0].noteHistory,[]);
  const beyond = channelsForSnesNoteAnalysis(analysis,12);
  assert(beyond.every(channel=>!channel.keyOn&&channel.toneMidi===null&&channel.noteHistory.length===0));
  assert.equal(beyond[0].sourceNumber,undefined,'Outside coverage cannot retain stale descriptor fields');
});

test('an unchanged held voice remains visible throughout the last eight seconds',()=>{
  const analysis = buildSnesNoteAnalysis(captured([note()]));
  const voice = channelsForSnesNoteAnalysis(analysis,10)[0];
  assert.equal(voice.keyOn,true);assert.equal(voice.toneMidi,60);
  assert.deepEqual(voice.noteHistory,[{time:2000,midiFloat:60},{time:10000,midiFloat:60}]);
});

test('same-pitch key retriggers create history breaks without future points',()=>{
  const analysis = buildSnesNoteAnalysis(captured([note(),note(.5)]));
  const history = channelsForSnesNoteAnalysis(analysis,.6)[0].noteHistory;
  assert(history.some(point=>point.time===500&&point.midiFloat===null));
  assert(history.some(point=>point.time===500&&point.midiFloat===60));
  assert(history.every(point=>point.time<=600));
});

test('dense regions bound display history without inventing a line across discarded observations',()=>{
  const events = [note()];
  for(let i=1;i<=5000;i++)events.push({type:'pitch',clock:clock(i/6000),channel:0,pitch:4096+i%2});
  const analysis = buildSnesNoteAnalysis(captured(events));
  const voice = channelsForSnesNoteAnalysis(analysis,1)[0];
  assert.equal(voice.historyTruncated,true);assert(voice.noteHistory.length<=4098);
  assert(voice.noteHistory[0].time>0,'Discarded old history stays blank');
  assert(voice.noteHistory.every(point=>point.time<=1000));
});

test('reference corrections affect display notes and leave captured raw pitch unchanged',()=>{
  const performance = captured([note()]), before = structuredClone(performance);
  const first = buildSnesNoteAnalysis(performance), corrected = buildSnesNoteAnalysis(performance,{references:[{sampleId:0,kind:'manual',referenceHz:440}]});
  assert.equal(channelsForSnesNoteAnalysis(first,.2)[0].toneMidi,60);
  const voice = channelsForSnesNoteAnalysis(corrected,.2)[0];
  assert.equal(voice.toneMidi,69);assert.equal(voice.referenceKind,'manual');assert.equal(voice.pitch,4096);
  assert.deepEqual(performance,before);
});
