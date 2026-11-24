import assert from 'node:assert/strict';
import test from 'node:test';
import {createFm2610SongTimeline} from './vgm.js';
import {readFm2610SnapshotPatches} from './fm_patch.js';

function snapshotAfterWrites(variant, commands) {
  const engine = {
    sampleRate: () => 48000,
    writeYm2610B() {},
    processFrames() {},
    loadAdpcmRom() {},
    clearAdpcmRoms() {},
    reset() {},
  };
  const timeline = createFm2610SongTimeline(engine, {variant, clock: 8000000});
  try {
    for (const command of commands) engine.writeYm2610B(...command);
    engine.processFrames(1);
    return timeline.read(0);
  } finally {
    timeline.dispose();
  }
}

test('FM snapshots adopt distinct physical channels, detached patches, OP gates and one global LFO', () => {
  for (const [variant, physicalChannels] of [['ym2610', [1, 2, 4, 5]], ['ym2610b', [0, 1, 2, 3, 4, 5]]]) {
    const snapshot = snapshotAfterWrites(variant, [
      [0, 0x22, 0x0e],
      [0, 0xb1, 4],
      [1, 0xb1, 7],
      [1, 0xb5, 0xa3],
      [1, 0x41, 19],
      [0, 0x28, 0x51],
      [0, 0x28, 0x01],
      [0, 0x28, 0xa5],
    ]);
    const editable = readFm2610SnapshotPatches(snapshot);
    assert.deepEqual(editable.channels.map(channel => channel.physicalChannel), physicalChannels);
    assert.deepEqual(editable.lfo, {enabled: true, frequency: 6});
    const channel2 = editable.channels.find(channel => channel.physicalChannel === 1).patch;
    const channel5 = editable.channels.find(channel => channel.physicalChannel === 4).patch;
    assert.deepEqual([channel2.algorithm, channel2.keyMask], [4, 5]);
    assert.deepEqual([channel5.algorithm, channel5.keyMask, channel5.ams, channel5.pms], [7, 10, 2, 3]);
    assert.deepEqual(channel5.pan, {left: true, right: false});
    assert.equal(channel5.operators[0].tl, 19);
    assert(!('lfo' in channel5));
    channel5.operators[0].tl = 23;
    editable.lfo.frequency = 5;
    assert.equal(snapshot.channels.find(channel => channel.physicalChannel === 4).preset.operators[0].tl, 19);
    assert.equal(snapshot.lfo.frequency, 6);
  }
});

test('FM snapshots preserve usable CH3 tuning and otherwise supply a playable channel patch', () => {
  const csm = snapshotAfterWrites('ym2610b', [
    [0, 0x27, 0x80], [0, 0xa6, 0x22], [0, 0xa2, 0x45], [0, 0xac, 0x1a], [0, 0xa8, 0x75],
  ]);
  // Code snapshots provide the raw mode register.
  const {csmEnabled, ...codeState} = csm;
  assert(csmEnabled);
  const manual = readFm2610SnapshotPatches(codeState);
  assert.deepEqual(manual.channels[2].patch.specialFrequencies[3], {block: 4, fnum: 0x245});
  assert.match(manual.channel3Notice, /Timer A/);

  const noPitch = readFm2610SnapshotPatches(snapshotAfterWrites('ym2610', [[0, 0x27, 0x40], [0, 0xb2, 6]]));
  assert.equal(noPitch.channels[1].patch.algorithm, 6);
  assert.equal(noPitch.channels[1].patch.specialFrequencies, undefined);
  assert.match(noPitch.channel3Notice, /standard tuning/);
});
