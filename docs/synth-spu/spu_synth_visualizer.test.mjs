import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpuOutputVisualizer} from './spu_synth_visualizer.js';

function environment() {
  let next = 0, sample = .25;
  const frames = new Map(), labels = [], draws = [], buffers = [], events = new Map(), levels = [];
  const graphics = {clearRect() {}, fillRect() {}, beginPath() {}, moveTo(x, y) {draws.push([x, y]);},
    lineTo(x, y) {draws.push([x, y]);}, stroke() {}, fillText(value) {labels.push(value);}};
  const canvas = {width:900, height:240, getContext:() => graphics};
  const document = {hidden:false, addEventListener(name, cb) {events.set(name, cb);}, removeEventListener(name) {events.delete(name);}};
  const analyser = {connect() {throw new Error('The analyser must never route audio');}, disconnects:0,
    disconnect() {this.disconnects++;}, getFloatTimeDomainData(array) {buffers.push(array); array.fill(sample);},
    getFloatFrequencyData(array) {array.fill(-90); array[30] = -6; array[31] = NaN; array[32] = Infinity;}};
  const context = {state:'running', sampleRate:48000, events:new Map(), created:0,
    createAnalyser() {this.created++; return analyser;},
    addEventListener(name, callback) {this.events.set(name, callback);}, removeEventListener(name) {this.events.delete(name);}};
  const source = {connections:[], disconnections:[], connect(node) {this.connections.push(node);}, disconnect(node) {this.disconnections.push(node);}};
  const visualizer = createSpuOutputVisualizer({canvas, envelopeCanvas:canvas, document,
    onLevel(value) {levels.push({...value});},
    requestFrame(callback) {frames.set(++next, callback); return next;}, cancelFrame(id) {frames.delete(id);}});
  return {visualizer, source, context, analyser, frames, labels, draws, buffers, events, document, levels,
    sample(value) {sample = value;}, tick(time) {const pending = [...frames.values()]; frames.clear(); for (const cb of pending) cb(time);}};
}

test('only adds one passive analyser branch and disconnects only that branch', () => {
  const env = environment();
  env.visualizer.connect(env.context, env.source);
  env.visualizer.connect(env.context, env.source);
  assert.equal(env.context.created, 1);
  assert.deepEqual(env.source.connections, [env.analyser]);
  assert.equal(env.frames.size, 0, 'connecting must not start idle animation');
  env.visualizer.setRunning(true);
  assert.equal(env.frames.size, 1);
  env.visualizer.dispose(); env.visualizer.dispose();
  assert.deepEqual(env.source.disconnections, [env.analyser]);
  assert.equal(env.analyser.disconnects, 1);
  assert.equal(env.frames.size, 0);
  assert.equal(env.events.size, 0);
  assert.equal(env.context.events.size, 0);
});

test('measures finite RMS and peak from the same reused waveform buffer at no more than 30fps', () => {
  const env = environment(); env.visualizer.connect(env.context, env.source); env.visualizer.setRunning(true);
  env.tick(0); env.tick(10); env.tick(20); env.tick(34);
  assert.equal(env.buffers.length, 2);
  assert.equal(env.buffers[0], env.buffers[1]);
  assert.equal(env.visualizer.level.rms, .25);
  assert.equal(env.visualizer.level.peak, .25);
  assert.ok(Math.abs(env.visualizer.level.db + 12.041199826559248) < 1e-9);
  env.sample(NaN); env.tick(68);
  assert.deepEqual(env.visualizer.level, {rms:0, peak:0, db:-90});
  assert.ok(env.draws.every(point => point.every(Number.isFinite)));
  env.visualizer.dispose();
});

test('releasing keys continues measuring tails then sleeps at silence', () => {
  const env = environment(); env.visualizer.connect(env.context, env.source); env.visualizer.setRunning(true); env.tick(0);
  env.visualizer.setRunning(false); env.tick(100); env.tick(500);
  assert.equal(env.frames.size, 1, 'audible release must keep drawing');
  env.sample(0); env.tick(600); env.tick(1001);
  assert.equal(env.frames.size, 0, 'silence must stop animation');
  const count = env.buffers.length;
  env.visualizer.setMode('spectrum');
  assert.equal(env.frames.size, 0, 'changing view at idle draws once without polling');
  assert.equal(env.buffers.length, count);
  env.visualizer.setRunning(true); assert.equal(env.frames.size, 1);
  env.visualizer.dispose();
});

test('repeated active state notifications do not bypass the 30fps limiter', () => {
  const env = environment(); env.visualizer.connect(env.context, env.source); env.visualizer.setRunning(true);
  env.tick(0);
  for (const time of [5, 10, 15, 20, 25, 30]) {
    env.visualizer.setRunning(true); env.tick(time);
  }
  assert.equal(env.buffers.length, 1, 'edit state events must not sample at their event frequency');
  env.visualizer.setRunning(true); env.tick(34);
  assert.equal(env.buffers.length, 2);
  env.visualizer.dispose();
});

test('parameter wake observes a release without a held note and preserves the frame limiter', () => {
  const env = environment(); env.visualizer.connect(env.context, env.source); env.visualizer.setRunning(true); env.tick(0);
  env.visualizer.setRunning(false); env.sample(0); env.tick(100); env.tick(501);
  assert.equal(env.frames.size, 0);
  const count = env.buffers.length;
  env.sample(.25); env.visualizer.wake();
  assert.equal(env.visualizer.getStats().running, false, 'waking display must not invent a held note');
  assert.equal(env.frames.size, 1);
  env.tick(510);
  assert.equal(env.visualizer.level.rms, .25);
  for (const time of [515, 520, 525, 530, 535, 540]) {env.visualizer.wake(); env.tick(time);}
  assert.equal(env.buffers.length, count + 1, 'rapid parameter changes must not bypass 30fps');
  env.tick(544); assert.equal(env.buffers.length, count + 2);
  env.visualizer.stop(); assert.equal(env.frames.size, 0);
  env.visualizer.dispose();
});

test('visibility and audio suspension pause frames, resume restores requested animation', () => {
  const env = environment(); env.visualizer.connect(env.context, env.source); env.visualizer.setRunning(true);
  env.visualizer.setVisible(false); assert.equal(env.frames.size, 0);
  env.visualizer.setVisible(true); assert.equal(env.frames.size, 1);
  env.document.hidden = true; env.events.get('visibilitychange')(); assert.equal(env.frames.size, 0);
  env.document.hidden = false; env.events.get('visibilitychange')(); assert.equal(env.frames.size, 1);
  env.context.state = 'suspended'; env.context.events.get('statechange')(); assert.equal(env.frames.size, 0);
  env.context.state = 'running'; env.context.events.get('statechange')(); assert.equal(env.frames.size, 1);
  env.visualizer.dispose();
});

test('explicit Stop clears monitoring immediately without disconnecting the audio source', () => {
  const env = environment(); env.visualizer.connect(env.context, env.source); env.visualizer.setRunning(true); env.tick(0);
  assert.equal(env.visualizer.level.rms, .25);
  env.visualizer.stop();
  assert.equal(env.frames.size, 0);
  assert.deepEqual(env.visualizer.level, {rms:0, peak:0, db:-90});
  assert.deepEqual(env.levels.at(-1), {rms:0, peak:0, db:-90}, 'Stop clears an external level readout too');
  assert.equal(env.source.disconnections.length, 0);
  assert.equal(env.visualizer.getStats().running, false);
  env.visualizer.setRunning(true); assert.equal(env.frames.size, 1);
  env.visualizer.dispose();
});

test('spectrum uses sample-rate frequency labels and never produces nonfinite coordinates', () => {
  const env = environment(); env.context.sampleRate = 44100;
  env.visualizer.connect(env.context, env.source); env.visualizer.setMode('spectrum'); env.visualizer.setRunning(true); env.tick(0);
  for (const label of ['20 Hz', '100 Hz', '1k Hz', '10k Hz']) assert.ok(env.labels.includes(label));
  assert.ok(env.draws.every(point => point.every(Number.isFinite)));
  env.visualizer.setMode('waveform'); assert.ok(env.labels.includes('23.2 ms'));
  assert.throws(() => env.visualizer.setMode('invalid'), RangeError);
  env.visualizer.dispose();
});
