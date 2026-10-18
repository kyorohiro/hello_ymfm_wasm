import test from 'node:test';
import assert from 'node:assert/strict';
import {SpcCore} from './spc.js';
import {captureSpcPerformance} from './spc_performance.js';
import {createSyntheticSpc} from './spc_test_fixture.mjs';

// Deterministic observation source isolates musical interpretation/sampling
// from CPU instruction timing. The real decoder and BRR extractor remain in
// the capture path; native observer/PCM parity is checked in spc_observer.test.
async function capture({blocks = [], initial, ...options} = {}) {
  const bytes = createSyntheticSpc(), ram = bytes.slice(0x100, 0x10100), dsp = bytes.slice(0x10100, 0x10180);
  initial?.(ram, dsp);
  let block = -1, current = [], disposed = false, snapshots = 0;
  const core = {
    nativeFrames: 0,
    load() {},
    snapshot() {snapshots++; return {ram:ram.slice(), dsp:dsp.slice(), nativeFrames:this.nativeFrames};},
    startDspObservation() {},
    renderInto() {
      block++; this.nativeFrames += 128;
      const next = blocks[block] ?? {};
      next.ram?.(ram); current = next.writes ?? [];
      for (let i = 0; i < current.length; i += 3) dsp[current[i + 1]] = current[i + 2];
    },
    drainDspEventsInto(output) {output.set(current); return current.length / 3;},
    takeDspEventOverflow() {return blocks[block]?.overflow ? 1 : 0;},
    dispose() {disposed = true;},
  };
  const original = SpcCore.create;
  SpcCore.create = async () => core;
  try {
    const performance = await captureSpcPerformance(bytes, {durationSeconds:.1, ...options});
    assert.equal(disposed, true, 'capture disposes its source core after success');
    return {performance, snapshots};
  } catch (error) {
    assert.equal(disposed, true, 'capture disposes its source core after failure');
    throw error;
  } finally {SpcCore.create = original;}
}

test('control sampling keeps last values but never moves controls across key boundaries', async () => {
  const writes = [
    100, 2, 1, 200, 2, 2, 300, 0, 20, 400, 0, 30, 500, 0x4c, 1,
    600, 2, 3, 700, 2, 4, 800, 0x5c, 1,
    900, 2, 5, 1000, 2, 6, 1100, 0x5c, 0, 1200, 0x4c, 1,
    1300, 2, 7, 1400, 2, 8,
  ];
  const {performance} = await capture({blocks:[{writes}], controlStepMs:20});
  assert.deepEqual(performance.events.map(event => [event.type, event.clock]), [
    ['noteOn',0], ['pitch',200], ['volume',400], ['noteOn',500], ['pitch',700],
    ['noteOff',800], ['pitch',1000], ['noteOn',1200], ['pitch',1400],
  ]);
  assert.deepEqual(performance.events.filter(event => event.type === 'pitch').map(event => event.pitch), [4098,4100,4102,4104]);
  assert.deepEqual(performance.events.filter(event => event.type === 'noteOn').map(event => event.pitch), [4096,4098,4102]);
  assert.equal(performance.statistics.controlsOmitted, 5);
});

test('zero control step preserves all distinct controls and sampling respects interval boundaries', async () => {
  const blocks = [{writes:[100,2,1,200,2,2,1100,2,3,1200,2,4]}];
  const all = (await capture({blocks,controlStepMs:0})).performance;
  const sampled = (await capture({blocks,controlStepMs:1})).performance;
  assert.deepEqual(all.events.filter(event => event.type === 'pitch').map(event => event.clock), [100,200,1100,1200]);
  assert.deepEqual(sampled.events.filter(event => event.type === 'pitch').map(event => event.clock), [200,1200]);
});

test('envelope controls may be sampled but SRCN changes flush them before a new instrument', async () => {
  const {performance} = await capture({initial(ram) {ram.set([0,0x20,0,0x20],0x1004);}, blocks:[{writes:[
    100,7,100,200,7,90,300,4,1,400,7,80,500,7,70,600,0x4c,1,
  ]}]});
  const instruments = performance.events.filter(event => event.type === 'instrument');
  assert.deepEqual(instruments.map(event => [event.clock,event.sourceNumber,event.gain,event.sampleId]), [
    [200,0,90,undefined], [300,1,90,0], [500,1,70,undefined],
  ]);
  assert.equal(performance.samples.length,1,'Different SRCNs with identical BRR and loop reuse one asset');
  assert.equal(performance.events.find(event => event.type === 'noteOn' && event.clock === 600).preset.gain,70);
});

test('KON with persistent KOFF does not extract a sample or invent a held source', async () => {
  const {performance} = await capture({initial(ram,dsp) {dsp[0x5c] = 1;}, blocks:[{writes:[
    100,0x4c,1,200,0x5c,0,300,0x4c,1,400,0x5c,1,500,0x4c,1,
  ]}]});
  const notes = performance.events.filter(event => event.type === 'noteOn');
  assert.deepEqual(notes.map(event => [event.clock,event.keyOffHeld,event.sampleId]), [
    [100,true,undefined], [300,false,0], [500,true,undefined],
  ]);
  assert.equal(performance.samples.length,1);
});

test('unused voice SRCN changes need no BRR extraction and retain control state for later keys', async () => {
  const {performance,snapshots} = await capture({initial(ram,dsp) {dsp[0x4c] = 0;}, blocks:[{writes:[
    100,0x24,255,200,0x25,0x8f,300,0x26,0xe0,
  ]}]});
  assert.equal(performance.samples.length,0);
  assert.equal(snapshots,1,'Unused controls do not allocate repeated RAM snapshots');
  assert.deepEqual(performance.events.map(event => [event.type,event.channel,event.sourceNumber,event.sampleId]), [
    ['instrument',2,255,undefined], ['instrument',2,255,undefined],
  ]);
});

test('sample RAM versions are captured on new keys and identical older versions are reused', async () => {
  const {performance} = await capture({blocks:[
    {ram(ram) {ram[0x2001] = 0x21;},writes:[100,0x4c,1]},
    {ram(ram) {ram[0x2001] = 0x13;},writes:[4200,0x4c,1]},
  ]});
  assert.equal(performance.samples.length,2);
  assert.deepEqual(performance.events.filter(event => event.type === 'noteOn').map(event => event.sampleId), [0,1,0]);
  assert.deepEqual(performance.samples.map(sample => sample.capturedClock), [0,4096]);
  assert.notEqual(performance.samples[0].hash,performance.samples[1].hash);
});

test('unresolved loops reject a readable capture instead of silently changing loop behavior', async () => {
  await assert.rejects(capture({initial(ram) {ram[0x1002] = 1;}}), /unresolved loop/);
});

test('sample RAM capacity rejects a complete BRR that exceeds relocatable instrument memory', async () => {
  await assert.rejects(capture({initial(ram,dsp) {
    ram.fill(0); dsp[0x5d] = 1;
    ram.set([0,4,0,4],0x100);
    // 7,169 complete blocks = 64,521 bytes, END wraps to $0000.
    ram[0] = 1;
  }}), /64,512 bytes/);
});

test('more than 256 distinct BRR versions reject instead of exporting partial assets', async () => {
  const blocks = Array.from({length:256}, (_,index) => ({
    ram(ram) {const value = index + 1; ram[0x2001] = value & 255; ram[0x2002] = value >> 8;},
    writes:[index * 4096 + 100,0x4c,1],
  }));
  await assert.rejects(capture({blocks,durationSeconds:1.1}), /256 samples/);
});

test('event limit and observation overflow are explicit failures with core cleanup', async () => {
  await assert.rejects(capture({maxEvents:2,blocks:[{writes:[100,0x4c,1,200,0x4c,1]}]}), /event limit/);
  await assert.rejects(capture({blocks:[{writes:[100,0x4c,1],overflow:true}]}), /overflowed/);
});
