import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import factory from '../generated/spc_wasm.js';
import {SpcCore,SnesDspCore} from '../../web/spc.js';
import {captureSpcTrace} from '../../web/spc_trace.js';
import {createSyntheticSpc} from '../../web/spc_test_fixture.mjs';
import {prepareSpcImport,buildSpcImportFiles} from './playground_spc_source.js';

const moduleOptions = {wasmBinary:new Uint8Array(await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url)))};
const options = {moduleFactory:factory,moduleOptions};
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

function writableSong({busyWork = false} = {}) {
  const bytes = createSyntheticSpc({voices:1}), ram = bytes.subarray(0x100,0x10100), code = [];
  // MOV DP,#imm writes the DSP ports; MOV abs,A changes live BRR RAM. The
  // nested register loops provide real CPU-time separation without timer ROMs.
  const writeDsp = (address,value) => code.push(0x8f,address,0xf2,0x8f,value,0xf3);
  const delay = () => {
    code.push(0xcd,160);
    const outer = code.length;
    if (busyWork) code.push(0xab,0x30); // INC $30: work RAM outside DSP reads.
    code.push(0x8d,255,0xfe,0xfe,0x1d,0xd0,0);
    code[code.length - 1] = (outer - code.length) & 255;
  };
  delay(); code.push(0xe8,0x72,0xc5,1,0x20); writeDsp(3,8);
  delay(); writeDsp(0,0); writeDsp(1,64);
  delay(); writeDsp(0x5c,1); code.push(0x2f,0xfe);
  ram.set(code,0x200);
  return bytes;
}
function render(core,frames,blockSize) {
  const channels = [new Float32Array(frames),new Float32Array(frames)];
  for (let offset = 0; offset < frames; offset += blockSize) {
    core.renderInto(channels[0],channels[1],Math.min(blockSize,frames-offset),offset);
  }
  return channels;
}
function playerPrefix(core,frames) {
  const channels = [new Float32Array(frames),new Float32Array(frames)];
  const scratch = [new Float32Array(128),new Float32Array(128)];
  for (let offset = 0; offset < frames; offset += 128) {
    core.renderInto(scratch[0],scratch[1],128);
    const count = Math.min(128,frames-offset);
    for (let channel = 0; channel < 2; channel++) channels[channel].set(scratch[channel].subarray(0,count),offset);
  }
  return channels;
}
async function executeSavedSong(plan,trace,frames) {
  const files = new Map(plan.files.map(file => [file.path,file]));
  const replay = await SnesDspCore.create(options);
  let actual, preparedTimeline = false, disposed = false;
  try {
    const createSoundChip = async kind => {
      assert.equal(kind,'snes');
      return {
        async prepareTimeline(saved) {
          assert.equal(saved.initialState.ram.length,65536);
          assert.equal(saved.initialState.dsp.length,128);
          assert.deepEqual(saved.events,trace.events);
          replay.loadTimeline(saved); preparedTimeline = true;
        },
        async playTimeline() {
          assert(preparedTimeline); actual = render(replay,frames,127);
        },
        dispose() {disposed = true;},
      };
    };
    const file = async (relative,{type} = {}) => {
      assert.equal(type,'arrayBuffer');
      const entry = files.get(path.posix.resolve(plan.directory,relative));
      assert(entry?.type === 'binary','Generated source must load its saved binary assets');
      return entry.data.buffer.slice(entry.data.byteOffset,entry.data.byteOffset+entry.data.byteLength);
    };
    await new AsyncFunction('createSoundChip','file',files.get(plan.entryPath).data)(createSoundChip,file);
    assert(disposed,'Generated source releases its timeline source');
    assert(actual,'Generated source starts the recorded timeline');
    return actual;
  } finally {replay.dispose();}
}

test('saved Song JavaScript replays the SPC player native PCM path exactly',async () => {
  const bytes = writableSong(), frames = 64000;
  const trace = await captureSpcTrace(bytes,{...options,durationSeconds:2});
  assert.equal(trace.durationClocks,frames * 32);
  const events = Array.from({length:trace.events.length / 4},(_,index) => Array.from(trace.events.subarray(index*4,index*4+4)));
  assert(events.some(([,kind,address,value]) => kind === 1 && address === 0x2001 && value === 0x72),'Trace must retain live sample RAM writes');
  assert(events.some(([,kind,address,value]) => kind === 0 && address === 3 && value === 8),'Trace must retain timed pitch changes');
  assert(events.some(([,kind,address,value]) => kind === 0 && address === 0x5c && value === 1),'Trace must retain key-off');

  const prepared = await prepareSpcImport(bytes,'authored.spc');
  const plan = buildSpcImportFiles(prepared,{mode:'javascript',directory:'/spc/authored',trace});
  assert.equal(plan.files.length,5);
  const files = new Map(plan.files.map(file => [file.path,file]));
  const provenance = JSON.parse(files.get('/spc/authored/sourceinfo.json').data);
  assert.equal(provenance.conversion.eventCount,events.length);
  assert.equal(provenance.conversion.durationClocks,frames * 32);
  assert.deepEqual(files.get('/spc/authored/original.spc').data,bytes);

  const reference = await SpcCore.create(options);
  try {
    reference.load(bytes);
    // The upstream CPU catches the DSP up lazily at render boundaries, so live
    // sample-RAM writes can be observable differently with other CPU partitions.
    // Use the actual SPC player's fixed 128-frame native path as the reference;
    // replay uses 127 to verify that the saved timeline itself is independent
    // of the output render partition.
    const expected = playerPrefix(reference,frames);
    const actual = await executeSavedSong(plan,trace,frames);
    for (let channel = 0; channel < 2; channel++) {
      assert(actual[channel].some(sample => Math.abs(sample) > .001),'Replay must contain real audio');
      let mismatches = 0, firstMismatch = -1, maximumError = 0;
      for (let frame = 0; frame < frames; frame++) if (actual[channel][frame] !== expected[channel][frame]) {
        mismatches++; if (firstMismatch < 0) firstMismatch = frame;
        maximumError = Math.max(maximumError,Math.abs(actual[channel][frame]-expected[channel][frame]));
      }
      assert.deepEqual({mismatches,firstMismatch,maximumError},{mismatches:0,firstMismatch:-1,maximumError:0},
        `Saved JavaScript channel ${channel} must preserve every native PCM sample`);
    }
  } finally {reference.dispose();}
});

test('a fractional conversion endpoint retains the full-block player prefix',async () => {
  const bytes = writableSong(), durationSeconds = .225, frames = 7200;
  assert.notEqual(frames % 128,0,'The endpoint must end inside a player fetch near the first RAM write');
  const trace = await captureSpcTrace(bytes,{...options,durationSeconds});
  assert.equal(trace.durationClocks,frames * 32);
  for (let index = 0; index < trace.events.length; index += 4) assert(trace.events[index] <= trace.durationClocks);
  const reference = await SpcCore.create(options), replay = await SnesDspCore.create(options);
  try {
    reference.load(bytes); replay.loadTimeline(trace);
    const expected = playerPrefix(reference,frames), actual = render(replay,frames,127);
    for (let channel = 0; channel < 2; channel++) {
      let mismatches = 0;
      for (let frame = 0; frame < frames; frame++) if (actual[channel][frame] !== expected[channel][frame]) mismatches++;
      assert.equal(mismatches,0,`The fractional interval channel ${channel} must match the actual player prefix`);
    }
  } finally {reference.dispose(); replay.dispose();}
});

test('omitting DSP-unread CPU work RAM shrinks saved JavaScript without changing its PCM',async t => {
  const bytes = writableSong({busyWork:true}), frames = 64000;
  const core = await SpcCore.create(options);
  try {
    core.load(bytes);
    const expected = playerPrefix(core,frames);
    core.restart(); core.beginTrace(); playerPrefix(core,frames);
    const baseline = core.endTrace();
    core.restart(); core.beginRamReadTracking(); playerPrefix(core,frames);
    const readMask = core.endRamReadTracking();
    assert.equal(readMask.length,65536);
    assert.equal(readMask[0x30],0,'The authored CPU counter is never read by the DSP');
    assert.equal(readMask[0x2001],1,'The live sample byte is read by the DSP');

    const filtered = await captureSpcTrace(bytes,{...options,durationSeconds:2});
    const stats = filtered.optimization;
    assert.equal(stats.kind,'dsp-ram-read-set');
    assert.equal(stats.ramReadAddresses,readMask.reduce((count,value) => count + Number(value !== 0),0));
    assert.equal(stats.dspEvents + stats.ramEvents,filtered.events.length / 4);
    const retained = [];
    for (let index = 0; index < baseline.events.length; index += 4) {
      const [,kind,address] = baseline.events.subarray(index,index + 4);
      if (kind === 0 || readMask[address]) retained.push(...baseline.events.subarray(index,index + 4));
    }
    assert.deepEqual(filtered.events,new Uint32Array(retained),
      'Filtering must retain every DSP write and every RAM write to the observed read set');
    const removed = (baseline.events.length - filtered.events.length) / 4;
    t.diagnostic(JSON.stringify({baselineEvents:baseline.events.length / 4,filteredEvents:filtered.events.length / 4,removed,...stats}));
    assert(removed >= 100,
      `The fixture must exercise substantial real CPU-bookkeeping removal after native same-clock coalescing; removed ${removed}`);
    assert(stats.ramEvents >= 1,'A sample-RAM change must remain in the editable source');

    const prepared = await prepareSpcImport(bytes,'counter.spc');
    const baselinePlan = buildSpcImportFiles(prepared,{mode:'javascript',directory:'/spc/full',trace:baseline});
    const filteredPlan = buildSpcImportFiles(prepared,{mode:'javascript',directory:'/spc/filtered',trace:filtered});
    const source = plan => plan.files.find(file => file.path === plan.entryPath).data;
    assert(source(baselinePlan).split('\n').length - source(filteredPlan).split('\n').length >= 100,
      'The saved editable JavaScript must actually shrink with the recording');
    const metadata = JSON.parse(filteredPlan.files.find(file => file.path.endsWith('/sourceinfo.json')).data);
    assert.deepEqual(metadata.conversion.optimization,stats);
    for (const [label,plan,trace] of [['baseline',baselinePlan,baseline],['filtered',filteredPlan,filtered]]) {
      const actual = await executeSavedSong(plan,trace,frames);
      for (let channel = 0; channel < 2; channel++) {
        let mismatches = 0;
        for (let frame = 0; frame < frames; frame++) if (actual[channel][frame] !== expected[channel][frame]) mismatches++;
        assert.equal(mismatches,0,`${label} generated JavaScript channel ${channel} must retain every original PCM sample`);
      }
    }
  } finally {core.dispose();}
});
