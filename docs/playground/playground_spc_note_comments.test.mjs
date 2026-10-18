import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {buildSpcSongSource} from './playground_spc_song_source.js';
import {buildSpcImportFiles} from './playground_spc_source.js';
import factory from '../generated/spc_wasm.js';
import {SnesDspCore} from '../../web/spc.js';
import {SnesSynth} from '../../web/snessynth.js';

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

test('estimated and manual fundamental references label notes at PITCH 4096 and its ratios', () => {
  const input = performance([noteOn(0,4096),pitchChange(0,2048,1),pitchChange(0,3810,2)]);
  const estimated = buildSpcSongSource(input,DIRECTORY,{annotations:[
    {sampleId:0,referenceHz:440,kind:'estimated',confidence:'high'},
  ]});
  assert.deepEqual(pitchLines(estimated.source).map(comment),[
    ' // estimated A4',' // estimated A3',' // estimated G#4 -25c',
  ]);
  const manual = buildSpcSongSource(input,DIRECTORY,{annotations:[
    {sampleId:0,referenceHz:440 * 2 ** (25 / 1200),kind:'manual'},
  ]});
  assert.match(comment(pitchLines(manual.source)[0]),/^ \/\/ reference A4 \+25c$/);
  assert.match(manual.source,/manual reference .* Hz .*at PITCH 4096/);
  assert.match(estimated.source,/estimated fundamental 440 Hz .*at PITCH 4096/);
  assert.match(estimated.source,/Estimates may be wrong/);
  assert.match(estimated.source,/baseFrequencyHz/);
});

test('different BRR versions sharing SRCN use their individual references and follow sample changes', () => {
  const input = performance([
    noteOn(0,4096),{...noteOn(1,4096,1),sampleId:1},
    {type:'instrument',clock:2,channel:0,sampleId:1,...preset},pitchChange(0,8192,3),
    pitchChange(1,4096,4),
  ]);
  input.samples.push({...input.samples[0],id:1,brr:Uint8Array.of(3,1,0,0,0,0,0,0,0)});
  const {source} = buildSpcSongSource(input,DIRECTORY,{annotations:[
    {sampleId:0,referenceHz:440,kind:'estimated',confidence:'high'},
    {sampleId:1,referenceHz:220,kind:'manual'},
  ]});
  assert.deepEqual(pitchLines(source).map(comment),[
    ' // estimated A4',' // reference A3',' // reference A4',' // reference A3',
  ]);
});

test('references preserve noise, modulation, unassigned and zero-PITCH safeguards', () => {
  const input = performance([
    pitchChange(3,4096,0),noteOn(0,4096),noteOn(1,4096),noteOn(2,0),
  ],{noise:1,pmon:2});
  const {source} = buildSpcSongSource(input,DIRECTORY,{annotations:[
    {sampleId:0,referenceHz:440,kind:'manual'},
  ]});
  const comments = pitchLines(source).map(comment);
  assert.match(comments[0],/no BRR assigned: no note label/);
  assert.match(comments[1],/noise voice/); assert.doesNotMatch(comments[1],/A4/);
  assert.equal(comments[2],' // reference A4 (before pitch modulation)');
  assert.match(comments[3],/PITCH 0: no note name/);
});

test('partial references leave unannotated assets on their provisional mapping', () => {
  const input = performance([noteOn(0,4096),{...noteOn(1,4096,1),sampleId:1}]);
  input.samples.push({...input.samples[0],id:1,brr:Uint8Array.of(3,1,0,0,0,0,0,0,0)});
  const {source} = buildSpcSongSource(input,DIRECTORY,{annotations:[
    {sampleId:0,referenceHz:440,kind:'estimated',confidence:'high'},
  ]});
  assert.deepEqual(pitchLines(source).map(comment),[' // estimated A4',' // provisional C4']);
});

test('invalid or ambiguous references fail before producing an import plan', () => {
  const input = performance([noteOn(0,4096)]);
  const valid = {sampleId:0,referenceHz:440,kind:'estimated',confidence:'high'};
  for (const referenceHz of [0,-1,NaN,Infinity,-Infinity,'440',undefined]) {
    assert.throws(() => buildSpcSongSource(input,DIRECTORY,{annotations:[{...valid,referenceHz}]}),TypeError);
  }
  for (const sampleId of [-1,1,.5,NaN,'0',undefined]) {
    assert.throws(() => buildSpcSongSource(input,DIRECTORY,{annotations:[{...valid,sampleId}]}),TypeError);
  }
  for (const kind of ['auto','reference','',undefined]) {
    assert.throws(() => buildSpcSongSource(input,DIRECTORY,{annotations:[{...valid,kind}]}),TypeError);
  }
  assert.throws(() => buildSpcSongSource(input,DIRECTORY,{annotations:[{...valid,confidence:'certain'}]}),TypeError);
  for (const annotations of [null,{},'auto',[valid,valid],[null]]) {
    assert.throws(() => buildSpcSongSource(input,DIRECTORY,{annotations}),TypeError);
  }
  // A finite but inaudibly high/low frequency is valid input, with no invented MIDI label.
  for (const referenceHz of [Number.MIN_VALUE,Number.MAX_VALUE]) {
    const {source} = buildSpcSongSource(input,DIRECTORY,{annotations:[{...valid,referenceHz}]});
    assert.match(comment(pitchLines(source)[0]),/outside MIDI note range/);
  }
});

function executableSource(source) {
  return source.split('\n').map(line => line.replace(/^\s*\/\/.*$/,'').replace(/;\s*\/\/.*$/,';'))
    .filter(line => line.trim()).join('\n');
}

function sourceWithoutCalibration(source) {
  return executableSource(source).replace(/(?:rootNote:\s*["']C4["']|baseFrequencyHz:\s*[\d.eE+-]+), basePitch: 4096/g,
    'rootNote: "C4", basePitch: 4096');
}

function callsWithoutCalibration(calls) {
  return calls.map(call => {
    if (call.method !== 'loadBRR') return call;
    const [bytes,options] = call.args, {baseFrequencyHz,...unchanged} = options;
    return {...call,args:[bytes,{...unchanged,rootNote:'C4'}]};
  });
}

const sampleMetadata = file => /\/samples\/[^/]+\.metadata\.json$/.test(file.path);

async function executeGenerated(generated) {
  const files = new Map(generated.files.map(entry => [entry.path,entry])), calls = [];
  let sampleId = 0;
  const snes = new Proxy({}, {get(_,method) {
    if (method === 'then') return undefined;
    return (...args) => {
      calls.push({method,args});
      return method === 'loadBRR' ? {id:sampleId++} : undefined;
    };
  }});
  const file = async (relative,{type}) => {
    const entry = files.get(path.posix.resolve(DIRECTORY,relative));
    assert(entry);
    return type === 'json' ? JSON.parse(entry.data) : entry.data.slice().buffer;
  };
  await new AsyncFunction('createSoundChip','file','createTimeline',generated.source)(
    async () => snes,file,() => ({waitUntil:async seconds => {calls.push({method:'waitUntil',args:[seconds]});}}),
  );
  return calls;
}

test('fundamental references configure BRR tuning while preserving raw playback calls, timing and binary assets', async () => {
  const input = performance([noteOn(0,3810),pitchChange(0,2528,1),{type:'noteOff',clock:2,channel:0}]);
  const baseline = buildSpcSongSource(input,DIRECTORY);
  const annotations = [{sampleId:0,referenceHz:440,kind:'manual'}];
  const annotated = buildSpcSongSource(input,DIRECTORY,{annotations});
  assert.deepEqual(annotated.files.filter(file => !sampleMetadata(file)),baseline.files.filter(file => !sampleMetadata(file)),
    'BRR bytes and presets must be byte-identical');
  assert.deepEqual(annotated.conversion,baseline.conversion);
  assert.equal(sourceWithoutCalibration(annotated.source),sourceWithoutCalibration(baseline.source));
  const calibratedCalls = await executeGenerated(annotated), baselineCalls = await executeGenerated(baseline);
  assert.deepEqual(callsWithoutCalibration(calibratedCalls),callsWithoutCalibration(baselineCalls),
    'Only loadBRR tuning may change; raw PITCH, presets, waits and key operations must stay identical');
  assert.deepEqual(calibratedCalls.find(call => call.method === 'loadBRR').args[1],
    {baseFrequencyHz:440,basePitch:4096,loopStartSamples:0});
  assert.deepEqual(baselineCalls.find(call => call.method === 'loadBRR').args[1],
    {rootNote:'C4',basePitch:4096,loopStartSamples:0});
  assert.doesNotMatch(annotated.source,/\.(?:setNote|noteOn|setFrequency)\(/,
    'Recorded songs keep explicit raw PITCH; calibration is reserved for subsequent musical editing');
  const metadata = JSON.parse(annotated.files.find(sampleMetadata).data);
  assert.equal(metadata.baseFrequencyHz,440); assert.equal(metadata.referenceKind,'manual');
  assert.equal(metadata.assignedBasePitch,4096);
  assert(!Object.hasOwn(metadata,'assignedReferenceNote'),'A calibrated sample must not also claim assigned C4 tuning');
  assert.deepEqual(annotations,[{sampleId:0,referenceHz:440,kind:'manual'}],'Caller annotations are not mutated');
});

test('readable SPC import forwards calibrated references and changes only source and sample metadata', () => {
  const input = performance([noteOn(0,4096)]);
  const prepared = {spc:{originalBytes:Uint8Array.of(1,2,3)},candidates:[],name:'notes.spc',
    metadata:{},warnings:[],scan:{directory:0,summary:{},rejected:[]}};
  const options = {mode:'javascript',directory:DIRECTORY,performance:input};
  const baseline = buildSpcImportFiles(prepared,options);
  const annotated = buildSpcImportFiles(prepared,{...options,annotations:[
    {sampleId:0,referenceHz:440,kind:'estimated',confidence:'high'},
  ]});
  assert.match(annotated.files.find(file => file.path === annotated.entryPath).data,/\/\/ estimated A4/);
  assert.deepEqual(annotated.files.filter(file => file.path !== annotated.entryPath && !sampleMetadata(file)),
    baseline.files.filter(file => file.path !== baseline.entryPath && !sampleMetadata(file)));
});

test('per-version estimated, fractional manual and fallback tuning agree with their sample metadata', async () => {
  const input = performance([noteOn(0,4096),{...noteOn(1,4096,1),sampleId:1},
    {...noteOn(2,4096,2),sampleId:2}]);
  for (const id of [1,2]) input.samples.push({...input.samples[0],id});
  const manualHz = 440 * 2 ** (23.5 / 1200);
  const generated = buildSpcSongSource(input,DIRECTORY,{annotations:[
    {sampleId:0,referenceHz:220,kind:'estimated',confidence:'high'},
    {sampleId:1,referenceHz:manualHz,kind:'manual'},
  ]});
  const uploads = (await executeGenerated(generated)).filter(call => call.method === 'loadBRR');
  assert.deepEqual(uploads.map(call => call.args[1]),[
    {baseFrequencyHz:220,basePitch:4096,loopStartSamples:0},
    {baseFrequencyHz:manualHz,basePitch:4096,loopStartSamples:0},
    {rootNote:'C4',basePitch:4096,loopStartSamples:0},
  ]);
  const metadata = generated.files.filter(sampleMetadata).map(file => JSON.parse(file.data));
  assert.equal(metadata[0].baseFrequencyHz,220); assert.equal(metadata[0].referenceKind,'estimated');
  assert.equal(metadata[1].baseFrequencyHz,manualHz); assert.equal(metadata[1].referenceKind,'manual');
  assert.equal(metadata[2].assignedReferenceNote,'C4'); assert(!Object.hasOwn(metadata[2],'baseFrequencyHz'));
  assert.deepEqual(metadata.map(sample => sample.assignedBasePitch),[4096,4096,4096]);
  assert(!Object.hasOwn(metadata[0],'assignedReferenceNote')); assert(!Object.hasOwn(metadata[1],'assignedReferenceNote'));
});

async function executeRealSong(generated) {
  const wasmBinary = new Uint8Array(await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url)));
  const core = await SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
  const synth = new SnesSynth({core}), files = new Map(generated.files.map(file => [file.path,file]));
  const pcm = [new Float32Array(3200),new Float32Array(3200)];
  let frames = 0, disposed = false;
  const instrument = new Proxy(synth,{get(target,method) {
    if (method === 'then') return undefined;
    if (method === 'dispose') return () => {disposed = true;};
    const value = target[method];
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  const file = async (relative,{type}) => {
    const entry = files.get(path.posix.resolve(DIRECTORY,relative)); assert(entry);
    return type === 'json' ? JSON.parse(entry.data) : entry.data.slice().buffer;
  };
  const createTimeline = () => ({waitUntil:async seconds => {
    const target = Math.round(seconds * 32000);
    assert(target >= frames && target <= 3200);
    while (frames < target) {
      const count = Math.min(127,target - frames);
      synth.renderInto(pcm[0],pcm[1],count,frames); frames += count;
    }
  }});
  try {
    await new AsyncFunction('createSoundChip','file','createTimeline',generated.source)(async () => instrument,file,createTimeline);
    assert(disposed); assert.equal(frames,3200);
    return {synth,pcm,dispose:() => core.dispose()};
  } catch (error) {core.dispose(); throw error;}
}

test('calibrated generated songs preserve every real S-DSP PCM sample and tune subsequent setNote calls', async t => {
  const input = performance([
    {...noteOn(0,3810),preset:{adsr1:0,adsr2:0,gain:127,volumeLeft:64,volumeRight:48}},
    {...noteOn(1,2528),sampleId:1,preset:{adsr1:0,adsr2:0,gain:127,volumeLeft:48,volumeRight:64}},
    pitchChange(0,4096,10240),pitchChange(1,8192,20480),
    {type:'instrument',clock:30720,channel:0,sampleId:1,adsr1:0,adsr2:0,gain:127},
    pitchChange(0,3810,40960),{type:'noteOff',clock:81920,channel:0},
    {type:'noteOff',clock:92160,channel:1},
  ]);
  // Authored 16-frame waveform, one native 32 kHz cycle = 2000 Hz. No game data.
  input.samples[0].brr = Uint8Array.of(0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf);
  input.samples.push({...input.samples[0],id:1,brr:Uint8Array.of(0xb3,0x12,0x34,0x43,0x21,0xfe,0xdc,0xcd,0xef)});
  input.initialDsp[0x0c] = input.initialDsp[0x1c] = 127;
  const manualHz = 440 * 2 ** (23.5 / 1200);
  const baselineSource = buildSpcSongSource(input,DIRECTORY);
  const calibratedSource = buildSpcSongSource(input,DIRECTORY,{annotations:[
    {sampleId:0,referenceHz:2000,kind:'estimated',confidence:'high'},
    {sampleId:1,referenceHz:manualHz,kind:'manual'},
  ]});
  const baseline = await executeRealSong(baselineSource);
  let calibrated;
  try {
    calibrated = await executeRealSong(calibratedSource);
    let peak = 0;
    for (let channel = 0; channel < 2; channel++) {
      assert.deepEqual(calibrated.pcm[channel],baseline.pcm[channel],
        `Channel ${channel}: selected tuning must not alter a single sample of raw-PITCH song playback`);
      for (const sample of calibrated.pcm[channel]) {assert(Number.isFinite(sample)); peak = Math.max(peak,Math.abs(sample));}
    }
    assert(peak > .01,'Exact PCM comparison must contain real nonzero audio');
    const state = calibrated.synth.getState();
    assert.equal(state.samples[0].rootFrequencyHz,2000);
    assert.equal(state.samples[1].rootFrequencyHz,manualHz,'Fractional cents must survive without note-label rounding');
    assert.equal(state.samples[0].basePitch,4096); assert.equal(state.samples[1].basePitch,4096);
    for (const [id,hz] of [[0,2000],[1,manualHz]]) {
      calibrated.synth.setPreset(0,{sample:id}); calibrated.synth.setNote(0,'A4');
      const expected = Math.round(4096 * 440 / hz);
      assert.equal(calibrated.synth.getPreset(0).pitch,expected);
      assert.equal(calibrated.synth.readDsp(2) | (calibrated.synth.readDsp(3) << 8),expected,
        'Musical setNote must use calibrated sample tuning in the actual DSP PITCH registers');
    }
    baseline.synth.setPreset(0,{sample:0}); baseline.synth.setNote(0,'C4');
    assert.equal(baseline.synth.getPreset(0).pitch,4096,'Unestimated BRR keeps the assigned C4 reference');
    t.diagnostic(JSON.stringify({framesPerChannel:3200,pcmMismatchCount:0,peak,estimatedHz:2000,manualHz}));
  } finally {baseline.dispose(); calibrated?.dispose();}
});
