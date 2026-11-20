// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createYmSongPlayer} from './song_player.js';
import {fakeAudio, deferred} from '../synth-huc6280/song_test_helpers.mjs';

const RATE = 44100;
const flush = () => new Promise(resolve => setImmediate(resolve));
const source = (values = {}) => ({format: 'vgm', bytes: Uint8Array.of(1), clock: 2000000,
  metadata: {title: 'Test'}, title: 'Reference', durationFrames: RATE, subsongCount: 1, defaultSubsong: 1, ...values});

function setup(t, options = {}) {
  const graph = fakeAudio(), engines = [], statuses = [], states = [];
  let hosts = 0, beforePlays = 0;
  const makeEngine = (selected, {subsong, signal} = {}) => {
    let frame = 0;
    const registers = new Uint8Array(16), registerKnown = Array(16).fill(true);
    const engine = {
      clock: selected.clock, subsong, signal, disposed: false, calls: 0, processing: 0, maxProcessing: 0,
      sampleRate: () => RATE,
      get frame() { return frame; },
      get ended() { return frame >= (selected.testFrames ?? selected.durationFrames ?? RATE * 4); },
      async processFrames(count) {
        engine.calls++; engine.processing++;
        engine.maxProcessing = Math.max(engine.maxProcessing, engine.processing);
        try {
          await options.process?.(engine, count);
          const frames = Math.min(count, (selected.testFrames ?? selected.durationFrames ?? RATE * 4) - frame);
          const left = new Float32Array(frames), right = new Float32Array(frames);
          for (let i = 0; i < frames; i++) {
            left[i] = frame / RATE; right[i] = -left[i]; frame++;
          }
          registers[0] = Math.floor(frame / 512) % 256;
          return {left, right};
        } finally { engine.processing--; }
      },
      async snapshot() {
        await options.snapshot?.(engine);
        return {frame, clock: selected.clock, registers, registerKnown};
      },
      editChannel(channel,patch) { engine.edits??=[];engine.edits.push({channel,patch}); },
      mutateRegisters() { registers.fill(255); registerKnown.fill(false); },
      dispose() { engine.disposed = true; },
    };
    engines.push(engine);
    return engine;
  };
  const player = createYmSongPlayer({
    getAudio: async () => { hosts++; return graph.audio; },
    beforePlay: async () => { beforePlays++; },
    prepareSource: async input => input,
    createEngine: makeEngine,
    schedule: graph.schedule, cancel: graph.cancel,
    yieldTask: async () => {}, nowMs: () => 0,
    onState: value => states.push(value), onStatus: value => statuses.push(value),
    ...options,
  });
  t.after(() => player.dispose());
  return {player, graph, engines, statuses, states, makeEngine, hosts: () => hosts, beforePlays: () => beforePlays};
}

test('load, stopped seek, and subsong selection are passive and failed load preserves playback', async t => {
  const f = setup(t, {prepareSource: async value => {
    if (value === 'broken') throw new Error('bad header');
    return value;
  }});
  const loaded = await f.player.load(source({format: 'sndh', subsongCount: 3, defaultSubsong: 2}), {name: 'Original.sndh'});
  assert.equal(loaded.busy, false);
  assert.equal(loaded.name, 'Original.sndh');
  assert.equal(loaded.subsong, 2);
  await f.player.seek(0.1);
  assert.equal(f.player.read().positionFrames, 4410);
  assert.equal(f.hosts(), 0);
  assert.equal(f.engines.length, 0);
  f.player.setSubsong(3);
  assert.equal(f.player.read().positionFrames, 0);
  assert.equal(f.player.read().subsong, 3);
  assert.equal(f.hosts(), 0);
  await f.player.play();
  assert.equal(f.engines[0].subsong, 3);
  await assert.rejects(f.player.load('broken', {name: 'Broken'}), /bad header/);
  assert.equal(f.player.read().name, 'Original.sndh');
  assert.equal(f.player.read().playing, true);
  assert.equal(f.engines[0].disposed, false);
  f.player.stop();
  assert.equal(f.player.read().loaded, true);
  assert.equal(f.player.read().subsong, 3);
  f.player.unload();
  assert.equal(f.player.read().loaded, false);
});

test('44100 Hz heard time and immutable Live snapshots stay behind render-ahead on a 48000 Hz host', async t => {
  const f = setup(t);
  await f.player.load(source());
  await f.player.play();
  assert.equal(f.graph.context.sampleRate, 48000);
  assert(f.engines[0].frame >= 0.075 * RATE);
  assert(f.engines[0].frame <= 0.075 * RATE + 512);
  assert.equal(f.player.read().positionFrames, 0);
  const initial = f.player.read().liveState;
  assert.equal(initial.frame, 0);
  f.engines[0].mutateRegisters();
  assert.equal(initial.registers[0], 0);
  assert.equal(initial.registerKnown[0], true);
  assert(Object.isFrozen(initial));
  assert(Object.isFrozen(initial.registers));
  f.graph.tick(0.03); await flush();
  const heard = f.player.read();
  assert.equal(heard.positionFrames, 882);
  assert.equal(heard.liveState.frame, 512);
  assert(heard.liveState.frame <= heard.positionFrames);
  assert.equal(f.engines[0].maxProcessing, 1);
  assert.equal(f.graph.audio.master.gain.value, 0.7);
  assert.equal(f.graph.audio.songInputNode.gain.value, 1);
  assert(f.graph.sources().every(node => node.buffer.sampleRate === RATE));
  assert(f.graph.sources().every(node => node.connections[0].connections[0] === f.graph.audio.songInputNode));
});

test('a no-work pump before audio starts does not lock future queue refills', async t => {
  const f = setup(t);
  await f.player.load(source()); await f.player.play();
  const firstRendered = f.engines[0].frame;
  f.graph.tick(0.001); await flush();
  assert.equal(f.engines[0].frame, firstRendered);
  assert.equal(f.graph.timers.size, 1);
  f.graph.tick(0.03); await flush();
  assert(f.engines[0].frame > firstRendered);
  for (let i = 0; i < 20; i++) { f.graph.tick(0.008); await flush(); }
  assert(f.player.read().positionFrames > firstRendered);
  assert(f.engines[0].frame > firstRendered * 2);
  assert.equal(f.engines[0].maxProcessing, 1);
});

test('Pause cancels queued nodes and Resume uses the exact unconsumed PCM without rebuilding the core', async t => {
  const gate = deferred();
  let hold = false;
  const f = setup(t, {process: async () => { if (hold) await gate.promise; }});
  await f.player.load(source()); await f.player.play();
  hold = true;
  f.graph.tick(0.07); await flush();
  assert.equal(f.engines[0].processing, 1);
  assert(f.player.pause());
  const paused = f.player.read();
  assert(paused.positionFrames > 0);
  assert.equal(paused.paused, true);
  assert(f.graph.sources().filter(node => node.at + node.buffer.duration - node.offset > f.graph.context.currentTime)
    .every(node => node.stopped));
  f.graph.tick(0.2);
  gate.resolve(); hold = false; await flush();
  assert.equal(f.player.read().positionFrames, paused.positionFrames);
  assert.deepEqual(f.player.read().liveState, paused.liveState);
  const count = f.graph.sources().length;
  assert(await f.player.resume());
  const first = f.graph.sources().slice(count)[0];
  assert(first);
  assert.equal(first.buffer.data[0][Math.round(first.offset * RATE)], Math.fround(paused.positionFrames / RATE));
  assert.equal(f.engines.length, 1);
  assert.equal(f.engines[0].maxProcessing, 1);
  f.graph.tick(0.02); await flush();
  assert(f.player.read().positionFrames > paused.positionFrames);
  f.player.stop();
  assert.equal(f.engines[0].disposed, true);
  assert.equal(f.graph.timers.size, 0);
  assert.equal(f.graph.context.state, 'running');
  assert.equal(f.graph.context.closes, 0);
});

test('Live off freezes display while transport advances, and Live on selects the heard boundary', async t => {
  const f = setup(t);
  await f.player.load(source()); await f.player.play();
  f.player.setLive(false);
  const frozen = f.player.read().liveState;
  f.graph.tick(0.05); await flush();
  assert(f.player.read().positionFrames > 0);
  assert.equal(f.player.read().liveState, frozen);
  f.player.setLive(true);
  assert(f.player.read().liveState.frame > frozen.frame);
  assert(f.player.read().liveState.frame <= f.player.read().positionFrames);
});

test('selected subsong determines duration and an explicit unknown never inherits the default duration', async t => {
  const f = setup(t);
  await f.player.load(source({format: 'sndh', subsongCount: 3,
    metadata: {subsongDurationFrames: [44100, 88200, null]}}));
  assert.equal(f.player.read().durationFrames, 44100);
  f.player.setSubsong(2);
  assert.equal(f.player.read().durationFrames, 88200);
  assert.equal(f.player.read().sourceDurationFrames, 88200);
  assert.equal(f.player.read().durationLimited, false);
  f.player.setSubsong(3);
  assert.equal(f.player.read().durationFrames, RATE * 180);
  assert.equal(f.player.read().sourceDurationFrames, null);
  assert.equal(f.player.read().durationLimited, true);
  assert.equal(f.hosts(), 0);
});

test('a synchronous VGM engine starts at a passive seek position after silent pre-roll', async t => {
  const f = setup(t, {createEngine: (selected, options) => {
    let frame = 0;
    return {clock: selected.clock, sampleRate: () => RATE,
      get frame() { return frame; }, get ended() { return frame >= selected.durationFrames; },
      processFrames(count) {
        const frames = Math.min(count, selected.durationFrames - frame);
        const left = Float32Array.from({length: frames}, () => frame++ / RATE);
        return {left, right: left};
      },
      snapshot: () => ({frame, registers: Array(16).fill(0), registerKnown: Array(16).fill(true)}),
      dispose() {}, subsong: options.subsong,
    };
  }});
  await f.player.load(source()); await f.player.seek(0.2);
  assert.equal(f.hosts(), 0);
  await f.player.play();
  assert.equal(f.player.read().positionFrames, 8820);
  assert.equal(f.player.read().liveState.frame, 8820);
  assert.equal(f.graph.sources()[0].buffer.data[0][0], Math.fround(0.2));
});

test('latest load wins and Stop cancels a pending parser without discarding the previous source', async t => {
  const a = deferred(), b = deferred();
  const f = setup(t, {prepareSource: async (value, {signal}) => {
    if (value.gate) await value.gate.promise;
    assert.equal(typeof signal.aborted, 'boolean');
    return value;
  }});
  await f.player.load(source(), {name: 'Original'});
  const old = f.player.load(source({gate: a}), {name: 'A'});
  const oldRejected = assert.rejects(old, {name: 'AbortError'});
  const latest = f.player.load(source({gate: b}), {name: 'B'});
  b.resolve(); await latest; await oldRejected;
  assert.equal(f.player.read().name, 'B');
  a.resolve(); await flush();
  assert.equal(f.player.read().name, 'B');
  const gate = deferred();
  const stopped = f.player.load(source({gate}), {name: 'Late'});
  const rejected = assert.rejects(stopped, {name: 'AbortError'});
  f.player.stop(); await rejected;
  gate.resolve(); await flush();
  assert.equal(f.player.read().name, 'B');
  assert.equal(f.player.read().busy, false);
  assert.equal(f.hosts(), 0);
});

test('Stop promptly fences a pending engine startup and disposes a late native engine', async t => {
  const gate = deferred();
  const f = setup(t, {createEngine: async (selected, options) => {
    await gate.promise;
    return f.makeEngine(selected, options);
  }});
  await f.player.load(source());
  const playing = f.player.play(); await flush();
  assert.equal(f.player.read().busy, true);
  f.player.stop();
  assert.equal(await playing, false);
  gate.resolve(); await flush();
  assert.equal(f.engines.length, 1);
  assert.equal(f.engines[0].disposed, true);
  assert.equal(f.graph.sources().length, 0);
  assert.equal(f.player.read().playing, false);
});

test('seek silently rebuilds a paused native core without reacquiring audio; failure preserves the old run', async t => {
  let rejectNext = false;
  const f = setup(t, {createEngine: (selected, options) => {
    if (rejectNext) throw new Error('worker failed');
    return f.makeEngine(selected, options);
  }});
  await f.player.load(source()); await f.player.play();
  f.graph.tick(0.03); await flush(); f.player.pause();
  assert(await f.player.seek(0.1));
  const state = f.player.read();
  assert.equal(state.positionFrames, 4410);
  assert.equal(state.liveState.frame, 4410);
  assert.equal(state.paused, true);
  assert.equal(f.engines[0].disposed, true);
  assert.equal(f.hosts(), 1);
  assert.equal(f.beforePlays(), 1);
  rejectNext = true;
  assert.equal(await f.player.seek(0.2), false);
  assert.equal(f.player.read().positionFrames, 4410);
  assert.equal(f.player.read().paused, true);
  assert.equal(f.engines[1].disposed, false);
  assert.match(f.statuses.at(-1), /worker failed/);
});

test('Stop cancels in-flight seek work immediately and disposes both candidate and old engines', async t => {
  const gate = deferred();
  const f = setup(t, {process: async engine => { if (f.engines.indexOf(engine) === 1) await gate.promise; }});
  await f.player.load(source()); await f.player.play(); f.player.pause();
  const seeking = f.player.seek(0.5); await flush();
  assert.equal(f.engines[1].processing, 1);
  f.player.stop();
  assert.equal(await seeking, false);
  assert(f.engines.every(engine => engine.disposed));
  assert.equal(f.player.read().positionFrames, 0);
  assert.equal(f.player.read().busy, false);
  gate.resolve(); await flush();
  assert.equal(f.graph.timers.size, 0);
  assert.equal(f.player.read().playback, 'stopped');
});

test('a newer seek supersedes pending work and only commits its own position', async t => {
  const gate = deferred();
  const f = setup(t, {process: async engine => { if (f.engines.indexOf(engine) === 1) await gate.promise; }});
  await f.player.load(source()); await f.player.play(); f.player.pause();
  const first = f.player.seek(0.4); await flush();
  const latest = f.player.seek(0.2);
  assert.equal(await first, false);
  assert(await latest);
  assert.equal(f.player.read().positionFrames, 8820);
  assert.equal(f.engines[1].disposed, true);
  assert.equal(f.engines[2].disposed, false);
  gate.resolve(); await flush();
  assert.equal(f.player.read().positionFrames, 8820);
});

test('seek deadline also cancels a worker promise that never replies and restores the paused run', async t => {
  const gate = deferred();
  const f = setup(t, {process: async engine => { if (f.engines.indexOf(engine) === 1) await gate.promise; }});
  await f.player.load(source()); await f.player.play(); f.player.pause();
  const seek = f.player.seek(0.5); await flush();
  // The fake scheduler executes scheduled callbacks when explicitly ticked.
  f.graph.tick(31);
  assert.equal(await seek, false);
  assert.equal(f.player.read().paused, true);
  assert.equal(f.engines[0].disposed, false);
  assert.equal(f.engines[1].disposed, true);
  assert.match(f.player.read().error, /seek exceeded/);
  gate.resolve();
});

test('seek deadline includes worker initialization and disposes a late initialization result', async t => {
  const gate = deferred();
  let hold = false;
  const f = setup(t, {createEngine: async (selected, options) => {
    if (hold) await gate.promise;
    return f.makeEngine(selected, options);
  }});
  await f.player.load(source()); await f.player.play(); f.player.pause();
  hold = true;
  const seek = f.player.seek(0.5); await flush();
  f.graph.tick(31);
  assert.equal(await seek, false);
  assert.equal(f.player.read().paused, true);
  assert.equal(f.engines[0].disposed, false);
  assert.match(f.player.read().error, /seek exceeded/);
  gate.resolve(); await flush();
  assert.equal(f.engines[1].disposed, true);
});

test('unknown duration has a disclosed bound, exact final PCM length, and releases native resources at EOF', async t => {
  const f = setup(t, {unknownDurationFrames: 1000});
  await f.player.load(source({durationFrames: null}));
  assert.equal(f.player.read().durationFrames, 1000);
  assert.equal(f.player.read().sourceDurationFrames, null);
  assert.equal(f.player.read().durationLimited, true);
  assert.match(f.statuses.at(-1), /duration is unknown/);
  await f.player.play();
  assert.equal(f.engines[0].frame, 1000);
  assert.equal(f.graph.buffers.reduce((sum, buffer) => sum + buffer.length, 0), 1000);
  f.graph.tick(0.1); await flush();
  assert.equal(f.player.read().playback, 'ended');
  assert.equal(f.player.read().positionFrames, 1000);
  assert.equal(f.player.read().liveState.frame, 1000);
  assert.equal(f.engines[0].disposed, true);
  assert.equal(f.graph.timers.size, 0);
});

test('render rejection releases every song resource while preserving the borrowed host and source', async t => {
  const f = setup(t, {process: async () => { throw new Error('native render failed'); }});
  await f.player.load(source());
  assert.equal(await f.player.play(), false);
  assert.equal(f.player.read().loaded, true);
  assert.match(f.player.read().error, /native render failed/);
  assert.equal(f.engines[0].disposed, true);
  assert.equal(f.graph.timers.size, 0);
  assert.equal(f.graph.context.closes, 0);
  assert.equal(f.graph.audio.master.gain.value, 0.7);
  const songGain = f.graph.nodes.at(-1);
  assert.equal(songGain.disconnected, 1);
});

test('missing song output is rejected without opening another context', async t => {
  const f = setup(t, {getAudio: async () => ({context: f.graph.context, outputNode: f.graph.audio.master})});
  await f.player.load(source());
  assert.equal(await f.player.play(), false);
  assert.match(f.player.read().error, /songInputNode/);
  assert.equal(f.engines.length, 0);
  assert.equal(f.graph.context.closes, 0);
});

test('live edits queue in order for future render blocks, without replacing or stopping the player',async t=>{
 const f=setup(t);await f.player.load(source());await f.player.play();
 const engine=f.engines[0],before=f.player.read().positionFrames;
 assert.equal(f.player.read().canEdit,true);
 const patch={voice:{noise:true}};
 assert.equal(f.player.editChannel(0,patch),true);patch.voice.noise=false;
 f.player.editChannel(1,{voice:{tone:false}});
 assert.throws(()=>f.player.editChannel(0,{voice:{volume:99}}));
 for(let i=0;i<12;i++){f.graph.tick(0.008);await flush();}
 assert.deepEqual(engine.edits,[{channel:0,patch:{voice:{noise:true}}},{channel:1,patch:{voice:{tone:false}}}]);
 assert(f.player.read().playing);assert(f.player.read().positionFrames>=before);assert.equal(f.engines.length,1);
 f.player.pause();assert.equal(f.player.editChannel(0,{voice:{noise:false}}),false);
});
