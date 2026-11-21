// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import { Scsp } from '../js/scsp.js';
import { prepareScspSongSource, buildScspSongDemo } from './song_source.js';
import { createScspSongPlayer, createScspSongRenderer } from './song_player.js';
import { createScspSsfPlaybackFixture } from '../../test/helpers/scsp_ssf_fixture.mjs';
const binary = await readFile(new URL('../generated/scsp_wasm.wasm', import.meta.url));
const createCore = () =>
	Scsp.create({ moduleFactory: factory, moduleOptions: { wasmBinary: binary } });
test('C5 byte order and E0 PCM16 RAM match direct raw SCSP programming sample for sample', async () => {
  const commands = [], pcm = new Uint8Array(128), pcmView = new DataView(pcm.buffer);
  for (let index = 0; index < 64; index++) pcmView.setInt16(index * 2, Math.round(8192 * Math.sin(index * Math.PI / 32)), false);
  const block = new Uint8Array(11 + pcm.length), blockView = new DataView(block.buffer);
  block.set([0x67,0x66,0xe0]); blockView.setUint32(3, pcm.length + 4, true); blockView.setUint32(7, 0x1000, true); block.set(pcm, 11); commands.push(...block);
  const words = [[0x400,0x020f],[2,0x1000],[4,0],[6,64],[8,31],[10,0x3c1f],[16,0],[22,0xe000],[0,0x1820]];
  for (const [address, value] of words) commands.push(0xc5,address >> 8,address & 255,value >> 8,0xc5,address >> 8,(address + 1) & 255,value & 255);
  commands.push(0x61,0,4,0x66);
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set(buildScspSongDemo().subarray(0,256)); bytes.set(commands,256); view.setUint32(4,bytes.length - 4,true);
  const source = await prepareScspSongSource(bytes), replay = await createCore(), direct = await createCore();
  try {
    const renderer = createScspSongRenderer(replay,source), left = new Float32Array(1024), right = new Float32Array(1024);
    assert.equal(renderer.process(left,right,1024),1024);
    direct.loadRam(pcm,0x1000); for (const [address,value] of words) direct.write(address,value);
    assert.deepEqual({left,right},direct.generateStereo(1024));
    for (let index = 0; index < left.length; index++) assert.equal(left[index],pcmView.getInt16((index % 64) * 2,false) / 32768);
  } finally {replay.dispose(); direct.dispose();}
});

test('original SCSP VGM renders finite audible stereo PCM with exact block partitioning', async () => {
  const source = await prepareScspSongSource(buildScspSongDemo()), first = await createCore(), second = await createCore();
  try {
    const a = createScspSongRenderer(first, source), b = createScspSongRenderer(second, source);
    const left = new Float32Array(source.totalSamples), right = new Float32Array(source.totalSamples);
    assert.equal(a.process(left, right, left.length), source.totalSamples); assert(a.ended);
    assert(left.every(Number.isFinite)); assert(left.some(value => Math.abs(value) > .01)); assert.deepEqual(left, right);
    const dividedLeft = new Float32Array(source.totalSamples), dividedRight = dividedLeft.slice();
    for (let at = 0; at < source.totalSamples; at += 37) {
      const length = Math.min(37, source.totalSamples - at), l = new Float32Array(length), r = new Float32Array(length);
      assert.equal(b.process(l, r, length), length); dividedLeft.set(l, at); dividedRight.set(r, at);
    }
    assert.deepEqual(dividedLeft, left); assert.deepEqual(dividedRight, right);
    assert.equal(b.process(new Float32Array(128), new Float32Array(128), 128), 0);
  } finally {first.dispose(); second.dispose();}
});

function rig({ gate, createSsfEngine, yieldTask = async () => {} } = {}) {
	let clock = 0,
		serial = 0;
	const timers = new Map(),
		engines = [],
		nodes = [],
		buffers = [];
	const context = {
		state: 'running',
		currentTime: 0,
		resume: async () => {},
		createGain() {
			return {
				context,
				gain: { value: 1 },
				connect(target) {
					this.target = target;
				},
				disconnect() {
					this.disconnected = true;
				},
			};
		},
		createBuffer(channels, frames, rate) {
			const buffer = {
				channels,
				frames,
				rate,
				data: [],
				copyToChannel(bytes, channel) {
					this.data[channel] = bytes.slice();
				},
			};
			buffers.push(buffer);
			return buffer;
		},
		createBufferSource() {
			const node = {
				connect(target) {
					this.target = target;
				},
				disconnect() {},
				start(at, offset) {
					this.started = { at, offset };
				},
				stop() {
					this.stopped = true;
				},
			};
			nodes.push(node);
			return node;
		},
	};
	const audio = {
		context,
		songInputNode: context.createGain(),
		outputNode: context.createGain(),
	};
	const createEngine = async () => {
		if (gate) await gate(engines.length);
		const engine = await createCore(),
			dispose = engine.dispose.bind(engine),
			renderInto = engine.renderInto.bind(engine);
		engine.testFrames = 0;
		engine.disposed = false;
		engine.renderInto = (...args) => {
			engine.testFrames += args[2];
			return renderInto(...args);
		};
		engine.dispose = () => {
			engine.disposed = true;
			dispose();
		};
		engines.push(engine);
		return engine;
	};
	const player = createScspSongPlayer({
		getAudio: () => audio,
		createEngine,
		createSsfEngine,
		yieldTask,
		nowMs: () => clock * 1000,
		schedule: (task, delay) => {
			const id = ++serial;
			timers.set(id, { task, at: clock + delay / 1000 });
			return id;
		},
		cancel: (id) => timers.delete(id),
	});
	function advance(seconds) {
		const target = clock + seconds;
		for (let index = 0; index < 100000; index++) {
			const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
			if (!next || next[1].at > target) break;
			timers.delete(next[0]);
			clock = next[1].at;
			context.currentTime = clock;
			next[1].task();
		}
		clock = target;
		context.currentTime = clock;
	}
	return { player, context, engines, nodes, timers, buffers, audio, advance };
}

test('invalid replacement retains the loaded playing source and its independent core', async () => {
  const r = rig();
  try {
    await r.player.load(buildScspSongDemo(), 'first.vgm'); assert.equal(r.engines.length, 0);
    assert.equal(await r.player.play(), true); r.advance(.1);
    const before = r.player.getState();
    await assert.rejects(r.player.load(new Uint8Array(4), 'bad.vgm'), /header/);
    await r.player.whenIdle();
    const after = r.player.getState(); assert.equal(after.name, 'first.vgm'); assert(after.playing);
    assert.equal(after.positionSeconds, before.positionSeconds); assert.equal(r.engines.length, 1);
    assert.equal(r.buffers[0].rate, 44100); assert.equal(r.nodes[0].target.target, r.audio.songInputNode);
  } finally {r.player.dispose();}
});

test('SSF asynchronously retains in-flight PCM when paused and cancels its engine on Stop', async () => {
  const wait = () => new Promise(setImmediate), requests = [];
  let disposed = false, creations = 0;
  const r = rig({
    async createSsfEngine(source) {
      creations++;
      assert.equal(source.kind,'ssf');
      return {
        process(frames) {
          return new Promise(resolve => requests.push({frames,resolve}));
        },
        dispose() {disposed = true;},
      };
    },
  });
  const block = ({frames,resolve}) => resolve({
    frames,left:new Float32Array(frames).fill(.25),right:new Float32Array(frames).fill(.25),ended:false,
  });
  try {
    const fixture = createScspSsfPlaybackFixture();
    await r.player.loadSsf(fixture.files,fixture.files[0].path);
    assert.equal(creations,0);
    assert.equal(r.player.getState().canSeek,false);
    assert.equal(await r.player.play(),true);
    assert(r.player.pause());
    block(requests.shift());
    await wait();
    r.advance(.1);
    assert(r.player.getState().paused);
    assert.equal(r.player.getState().positionFrames,0);
    assert.equal(r.nodes.length,0);
    assert.equal(requests.length,0);
    const preserved = r.buffers[0];
    assert.equal(await r.player.resume(),true);
    assert.equal(creations,1);
    assert.equal(r.nodes[0].buffer,preserved);
    r.player.stop();
    assert(disposed);
    block(requests.shift());
    await wait();
    assert.equal(r.player.getState().positionFrames,0);
    assert.equal(r.nodes.length,1);
    assert.equal(r.timers.size,0);
  } finally {r.player.dispose();}
});

test('Stop aborts SSF worker startup before any PCM is queued', async () => {
  let entered;
  const startup = new Promise(resolve => {entered = resolve;});
  const r = rig({
    createSsfEngine(source,{signal}) {
      return new Promise((resolve,reject) => {
        signal.addEventListener('abort',() => reject(signal.reason),{once:true});
        entered(signal);
      });
    },
  });
  try {
    const fixture = createScspSsfPlaybackFixture();
    await r.player.loadSsf(fixture.standaloneFiles,fixture.standaloneFiles[0].path);
    const playing = r.player.play(), signal = await startup;
    r.player.stop();
    assert(signal.aborted);
    assert.equal(await playing,false);
    assert.equal(r.player.getState().playback,'stopped');
    assert.equal(r.nodes.length,0);
  } finally {r.player.dispose();}
});

test('Pause silences queued output and Resume retains exact unconsumed PCM and source position', async () => {
  const r = rig();
  try {
    await r.player.load(buildScspSongDemo()); await r.player.play(); r.advance(.1);
    assert.equal(r.player.pause(), true);
    const state = r.player.getState(), frames = r.engines[0].testFrames, nodeCount = r.nodes.length;
    const preserved = r.nodes.find(node => node.started.at + node.buffer.frames / 44100 - node.started.offset > r.context.currentTime)?.buffer;
    assert(state.paused);
    assert(r.nodes.filter(node => node.started.at + node.buffer.frames / 44100 - node.started.offset > r.context.currentTime).every(node => node.stopped));
    r.advance(.1);
    assert.equal(r.engines[0].testFrames, frames); assert.equal(r.player.getState().positionFrames, state.positionFrames);
    assert.equal(await r.player.resume(), true); assert.equal(r.engines.length, 1);
    assert.equal(r.nodes[nodeCount].buffer, preserved); assert(r.nodes.some(node => !node.stopped && node.started.offset > 0));
    r.advance(.05); assert(r.player.getState().positionFrames > state.positionFrames);
    r.player.stop(); assert.equal(r.timers.size, 0); assert(r.engines.every(engine => engine.disposed));
  } finally {r.player.dispose();}
});

test('seek rebuilds the deterministic SCSP state and end releases its core', async () => {
  const r = rig();
  try {
    await r.player.load(buildScspSongDemo()); await r.player.play(); r.advance(.1);
    assert.equal(await r.player.seek(.5), true); assert(r.player.getState().playing);
    assert.equal(r.player.getState().positionFrames, 22050); assert(r.engines[0].disposed);
    r.player.pause(); assert.equal(await r.player.seek(.25), true);
    assert(r.player.getState().paused); assert.equal(r.player.getState().positionFrames, 11025);
    assert.equal(await r.player.resume(), true); r.advance(3);
    assert.equal(r.player.getState().playback, 'ended'); assert.equal(r.player.getState().positionFrames, 105840);
    assert(r.engines.every(engine => engine.disposed)); assert.equal(r.timers.size, 0);
  } finally {r.player.dispose();}
});

test('Stop cancels pending core startup and stale file selection before commit', async () => {
  let entered, resolve;
  const started = new Promise(done => {entered = done;}), gate = new Promise(done => {resolve = done;});
  const r = rig({gate:() => {entered(); return gate;}});
  try {
    await r.player.load(buildScspSongDemo(), 'old'); const playing = r.player.play(); await started;
    r.player.stop(); resolve(); assert.equal(await playing, false); assert(r.engines.every(engine => engine.disposed));
    await assert.rejects(r.player.load(buildScspSongDemo(), 'stale', {isCurrent:() => false}), {name:'AbortError'});
    assert.equal(r.player.getState().name, 'old'); assert.equal(r.player.getState().playback, 'stopped');
  } finally {r.player.dispose();}
});

test('closing the shared AudioContext retires song nodes and its independently owned core', async () => {
  const r = rig();
  try {
    await r.player.load(buildScspSongDemo()); await r.player.play();
    r.context.state = 'closed'; r.advance(.02);
    assert.equal(r.player.getState().playback,'error'); assert.match(r.player.getState().errorMessage,/AudioContext was closed/);
    assert.equal(r.timers.size,0); assert(r.engines.every(engine => engine.disposed));
  } finally {r.player.dispose();}
});

test('Stop during a yielding seek disposes both original and eventually completed cores', async () => {
  let entered, resolve;
  const started = new Promise(done => {entered = done;}), gate = new Promise(done => {resolve = done;});
  const r = rig({yieldTask:() => {entered(); return gate;}});
  try {
    await r.player.load(buildScspSongDemo()); await r.player.play();
    const seeking = r.player.seek(1); await started; r.player.stop(); resolve();
    assert.equal(await seeking,false); assert.equal(r.player.getState().playback,'stopped');
    assert(r.engines.every(engine => engine.disposed)); assert.equal(r.timers.size,0);
  } finally {r.player.dispose();}
});
