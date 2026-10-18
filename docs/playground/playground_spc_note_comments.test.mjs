import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildSpcSongSource} from './playground_spc_song_source.js';

const DIRECTORY = '/spc/note-comments';
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const preset = {adsr1:255,adsr2:224,gain:184,volumeLeft:16,volumeRight:16};
const noteOn = (channel,pitch,clock = 0) => ({
  type:'noteOn',clock,channel,sourceNumber:1,sampleId:0,pitch,preset,
});
const pitchChange = (channel,pitch,clock) => ({type:'pitch',clock,channel,pitch});

function performance(events,{noise = 0,pmon = 0} = {}) {
  const initialDsp = new Uint8Array(128);
  initialDsp[0x3d] = noise; initialDsp[0x2d] = pmon;
  return {version:1,clockRate:1024000,durationClocks:102400,initialDsp,events,
    samples:[{id:0,sourceNumber:1,brr:Uint8Array.of(3,0,0,0,0,0,0,0,0),loop:true,loopStartSamples:0}],
    warnings:[],controlStepMs:0,statistics:{rawWrites:events.length}};
}

function pitchLines(source) {
  return source.split('\n').filter(line => /^\s*snes\.setPitch\(/.test(line));
}

function comment(line) { return line.slice(line.indexOf(';') + 1); }

test('readable SPC pitch comments show assigned C4/4096 octaves and cents', () => {
  const events = [noteOn(0,4096),pitchChange(0,2048,1),pitchChange(0,8192,2),
    pitchChange(0,3810,3),pitchChange(0,2528,4),pitchChange(0,6678,5)];
  const {source} = buildSpcSongSource(performance(events),DIRECTORY);
  const comments = pitchLines(source).map(comment);
  assert.equal(comments.length,6);
  for (const text of comments) assert.match(text,/provisional/,
    'Every note label should distinguish its assigned tuning from detected pitch');
  for (const [index,name] of ['C4','C3','C5','B3','E3','G#4'].entries()) {
    assert.match(comments[index],new RegExp(`\\b${name.replace('#','\\#')}\\b`));
  }
  assert.match(comments[3],/-25\s*c/);
  assert.match(comments[4],/-35\s*c/);
  assert.match(comments[5],/\+46\s*c/);
  assert.match(source,/assigned/i);
  assert.match(source,/(?:not|cannot|no)[^\n]*(?:detect|audible|fundamental|infer)/i,
    'The reference mapping must not be presented as detected audible tuning');
});

test('zero and out-of-range pitches do not acquire fictitious musical note names', () => {
  const {source} = buildSpcSongSource(performance([
    noteOn(0,0),pitchChange(0,1,1),pitchChange(0,4096,2),
  ]),DIRECTORY);
  const comments = pitchLines(source).map(comment);
  assert.doesNotMatch(comments[0],/\b[A-G](?:#|b)?-?\d+\b/);
  assert.doesNotMatch(comments[1],/\b[A-G](?:#|b)?-?\d+\b/);
  assert.match(comments[2],/\bC4\b/);
});

test('pitch changes without a known assigned sample are left unlabelled', () => {
  const {source} = buildSpcSongSource(performance([
    pitchChange(0,3810,0),noteOn(1,4096,1),pitchChange(1,3810,2),
  ]),DIRECTORY);
  const comments = pitchLines(source).map(comment);
  assert.doesNotMatch(comments[0],/\bB3\b/);
  assert.match(comments[1],/\bC4\b/);
  assert.match(comments[2],/\bB3\b/);
});

test('noise omits note names and pitch modulation labels the unmodulated base pitch', () => {
  const {source} = buildSpcSongSource(performance([
    noteOn(0,3810),noteOn(1,3810),noteOn(2,3810),
  ],{noise:1,pmon:2}),DIRECTORY);
  const comments = pitchLines(source).map(comment);
  assert.doesNotMatch(comments[0],/\bB3\b/,'Noise replaces this voice\'s pitched sample');
  assert.match(comments[1],/\bB3 -25c \(before pitch modulation\)/,
    'The provisional base note must disclose active pitch modulation');
  assert.match(comments[2],/\bB3\b/,'Unmodulated voices retain the assigned tuning label');
});

test('noise and pitch modulation labels follow the changing DSP masks per voice', () => {
  const {source} = buildSpcSongSource(performance([
    noteOn(0,3810),noteOn(1,3810),
    {type:'dsp',clock:1,register:0x3d,value:1},
    pitchChange(0,3810,2),pitchChange(1,3810,3),
    {type:'dsp',clock:4,register:0x3d,value:0},
    {type:'dsp',clock:5,register:0x2d,value:3},
    pitchChange(0,3810,6),pitchChange(1,3810,7),
    {type:'dsp',clock:8,register:0x2d,value:0},pitchChange(1,3810,9),
  ]),DIRECTORY);
  const comments = pitchLines(source).map(comment);
  assert.match(comments[0],/\bB3\b/); assert.match(comments[1],/\bB3\b/);
  assert.doesNotMatch(comments[2],/\bB3\b/); assert.match(comments[3],/\bB3\b/);
  assert.match(comments[4],/\bB3\b/,'PMON bit 0 is ignored by the S-DSP');
  assert.match(comments[5],/\bB3 -25c \(before pitch modulation\)/);
  assert.match(comments[6],/\bB3\b/);
  assert.doesNotMatch(comments[6],/pitch modulation/);
});

test('an instrument sample assignment establishes a reference and note-off preserves it', () => {
  const {source} = buildSpcSongSource(performance([
    {type:'instrument',clock:0,channel:3,sampleId:0,...preset},
    pitchChange(3,4096,1),{type:'noteOff',clock:2,channel:3},pitchChange(3,3810,3),
    pitchChange(2,3810,4),
  ]),DIRECTORY);
  const comments = pitchLines(source).map(comment);
  assert.match(comments[0],/\bC4\b/);
  assert.match(comments[1],/\bB3\b/,'Key-off does not unload the BRR or remove its reference');
  assert.doesNotMatch(comments[2],/\bB3\b/,'A different voice must not inherit the sample assignment');
});

test('provisional note comments leave all executed PITCH calls unchanged', async () => {
  const events = [noteOn(0,3810),noteOn(1,2528),pitchChange(0,0,1),
    pitchChange(1,6678,2),{type:'noteOff',clock:3,channel:0}];
  const generated = buildSpcSongSource(performance(events),DIRECTORY);
  const files = new Map(generated.files.map(entry => [entry.path,entry]));
  const calls = [];
  const snes = new Proxy({}, {get(_,method) {
    if (method === 'then') return undefined;
    return (...args) => {
      calls.push({method,args});
      return method === 'loadBRR' ? {id:0} : undefined;
    };
  }});
  const file = async (relative,{type}) => {
    const entry = files.get(path.posix.resolve(DIRECTORY,relative));
    assert(entry);
    return type === 'json' ? JSON.parse(entry.data) : entry.data.slice().buffer;
  };
  await new AsyncFunction('createSoundChip','file','createTimeline',generated.source)(
    async () => snes,file,() => ({waitUntil:async () => {}}),
  );
  assert.deepEqual(calls.filter(call => call.method === 'setPitch').map(call => call.args),
    [[0,3810],[1,2528],[0,0],[1,6678]]);
  assert.equal(calls.filter(call => call.method === 'keyOn').length,2);
  assert.equal(calls.filter(call => call.method === 'keyOff').length,1);
  assert.equal(calls.filter(call => call.method === 'setNote').length,0,
    'Comments must not retune the song or replace raw hardware PITCH calls');
  assert.equal(calls.at(-1).method,'dispose');
});
