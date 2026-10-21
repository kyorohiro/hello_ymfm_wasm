import test from 'node:test';
import assert from 'node:assert/strict';
import {createFXMonitor, spectrum} from './playground_fx_monitor.js';

function setup(t, {savedMode = null, savedRange = null, storage: suppliedStorage} = {}) {
  const saved = new Map(['document', 'localStorage', 'setInterval', 'clearInterval'].map(key => [key, globalThis[key]]));
  const elements = new Map(), handlers = {}, messages = [], timers = new Map(), writes = [];
  let sequence = 0, monitor, time = 0, unavailable = null;
  function element() {
    const result = {value: '', textContent: '', children: [], writes: 0, width: 700, height: 220,
      draws: 0, clears: 0, strokes: [], texts: [],
      replaceChildren(...nodes) { this.children = nodes; this.writes++; },
    };
    let points = [];
    const context = {
      clearRect() { result.clears++; result.strokes = []; },
      fillRect() { result.draws++; result.strokes = []; result.texts = []; },
      fillText(text) { result.texts.push(text); }, beginPath() { points = []; },
      moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
      stroke() { result.strokes.push({style: this.strokeStyle, points: [...points]}); },
    };
    result.getContext = () => context;
    return result;
  }
  const storage = suppliedStorage === undefined ? {
    getItem(key) { return key === 'tetorica.playground.fxMonitorMode' ? savedMode
      : key === 'tetorica.playground.fxMonitorRange' ? savedRange : null; },
    setItem(key, value) { writes.push([key, value]); },
  } : suppliedStorage;
  globalThis.localStorage = storage;
  globalThis.document = {
    hidden: false, activeElement: null,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    addEventListener(name, callback) { handlers[name] = callback; }, createElement: element,
  };
  globalThis.setInterval = callback => { timers.set(++sequence, callback); return sequence; };
  globalThis.clearInterval = id => timers.delete(id);
  const createRack = () => ({node: {port: {postMessage: message => messages.push(message)}}});
  let rack = createRack();
  monitor = createFXMonitor(() => rack, {storage, now: () => time,getUnavailableReason:()=>unavailable});
  t.after(() => {
    monitor?.setVisible(false);
    for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  });
  return {
    monitor, get rack() { return rack; }, messages, handlers, writes, timers,
    setNow(value) { time = value; },
    setUnavailable(value) { unavailable=value; },
    replaceRack() { const previous = rack; rack = createRack(); return previous; },
    get: id => document.getElementById(id),
    tick() { for (const callback of [...timers.values()]) callback(); },
    capture() { return messages.findLast(message => message.enabled === true); },
    receive(data = {}) { rack.onMonitor({id: this.capture().id, names: ['gain'], ...data}); },
    selectMode(value) { const mode = document.getElementById('fxMonitorMode'); mode.value = value; mode.onchange(); },
    selectRange(value) { const range = document.getElementById('fxMonitorScale'); range.value = value; range.onchange(); },
  };
}

test('an unavailable Native per-effect monitor explains the supported output view without opening observation',t=>{
 const f=setup(t),reason='Native liveFx: use Audio for the final output';
 f.setUnavailable(reason);f.monitor.setVisible(true);f.tick();
 assert.equal(f.messages.length,0);assert.equal(f.get('fxMonitorStatus').textContent,reason);
 f.setUnavailable(null);f.tick();assert.equal(f.messages.at(-1).enabled,true);
 f.setUnavailable(reason);f.tick();assert.equal(f.messages.at(-1).enabled,false);
 const count=f.messages.length;f.tick();assert.equal(f.messages.length,count);assert.equal(f.rack.onMonitor,null);
});

function snapshot() {
  const input = Float32Array.from({length: 2048}, (_, i) => .5 * Math.sin(2 * Math.PI * 64 * i / 2048));
  return {name: 'gain', names: ['gain'], rate: 48000, input, output: Float32Array.from(input, value => value * .5)};
}

function countTransforms(t) {
  let count = 0;
  const cosine = Math.cos;
  t.mock.method(Math, 'cos', (...args) => { count++; return cosine(...args); });
  return () => count;
}

test('monitor tab and page visibility cancel capture; slow display cannot enqueue requests', t => {
  const f = setup(t);
  f.monitor.setVisible(true);
  const first = f.capture();
  assert.equal(first.enabled, true);
  f.tick(); f.tick();
  assert.equal(f.capture(), first);
  f.receive({names: []});
  f.tick();
  assert.notEqual(f.capture().id, first.id);
  document.hidden = true;
  f.handlers.visibilitychange();
  assert.equal(f.messages.at(-1).enabled, false);
  const count = f.messages.length;
  f.tick();
  assert.equal(f.messages.length, count);
  document.hidden = false;
  f.handlers.visibilitychange();
  assert.equal(f.messages.at(-1).enabled, true);
  f.monitor.setVisible(false);
  assert.equal(f.messages.at(-1).enabled, false);
  const end = f.messages.length;
  f.tick();
  assert.equal(f.messages.length, end);
  assert.equal(f.timers.size, 0);
});

test('Auto makes quiet waveform overlays visible with one shared scale and real axis values', t => {
  const transforms = countTransforms(t);
  const f = setup(t);
  const input = Float32Array.from({length: 2048}, (_, i) => .005 * Math.sin(2 * Math.PI * 64 * i / 2048));
  const output = Float32Array.from(input, value => value * 2);
  const originalInput = input.slice(), originalOutput = output.slice();
  f.monitor.setVisible(true);
  f.receive({name: 'gain', rate: 48000, input, output});
  assert.equal(f.get('fxMonitorScale').value, 'auto');
  assert.equal(f.get('fxMonitorScaleControl').hidden, false);
  const wave = f.get('fxMonitorWave');
  const height = stroke => Math.max(...stroke.points.map(point => point[1])) - Math.min(...stroke.points.map(point => point[1]));
  const [before, after] = wave.strokes.slice(-2);
  assert(height(after) > 140, 'a quiet .01 peak should use most of the 178px plot height');
  assert(Math.abs(height(after) / height(before) - 2) < 1e-6, 'a common scale preserves the 2x FX gain');
  assert(Math.abs(Number(wave.texts[0]) - .0125) < 1e-8, 'axis reports the real amplitude plus 25% headroom');
  assert.equal(Number(wave.texts[2]), 0);
  assert.equal(Number(wave.texts[4]), -Number(wave.texts[0]));
  assert.match(f.get('fxMonitorDescription').textContent, /Auto ±0\.0125 amplitude/);
  assert.equal(transforms(), 0);
  assert.deepEqual(input, originalInput);
  assert.deepEqual(output, originalOutput);
});

test('range changes repaint captured waveform without FFT, requests, or releasing pending backpressure', t => {
  const transforms = countTransforms(t);
  const f = setup(t);
  const input = Float32Array.from({length: 2048}, (_, i) => .01 * Math.sin(2 * Math.PI * 64 * i / 2048));
  const data = {name: 'gain', rate: 48000, input, output: Float32Array.from(input, value => value / 2)};
  f.monitor.setVisible(true);
  f.receive(data);
  f.tick();
  const pending = f.capture(), messages = f.messages.length, draws = f.get('fxMonitorWave').draws;
  f.selectRange('0.02');
  assert.equal(f.messages.length, messages);
  assert.equal(f.capture(), pending);
  assert.equal(f.get('fxMonitorWave').draws, draws + 1);
  assert.equal(Number(f.get('fxMonitorWave').texts[0]), .02);
  assert.match(f.get('fxMonitorDescription').textContent, /Fixed ±0\.02 amplitude/);
  const overlays = f.get('fxMonitorWave').strokes.slice(-2);
  const height = stroke => Math.max(...stroke.points.map(point => point[1])) - Math.min(...stroke.points.map(point => point[1]));
  assert(Math.abs(height(overlays[0]) - 89) < .001);
  assert(Math.abs(height(overlays[0]) / height(overlays[1]) - 2) < 1e-6);
  f.tick(); f.tick();
  assert.equal(f.messages.length, messages, 'repainting must not release the pending capture');
  f.receive(data);
  f.tick();
  assert.notEqual(f.capture().id, pending.id);
  assert.equal(transforms(), 0);
  assert.deepEqual(f.writes, [['tetorica.playground.fxMonitorRange', '0.02']]);
});

test('Auto contracts over real elapsed time, holds silence, and refits when explicitly selected', t => {
  const f = setup(t);
  const data = peak => ({name: 'gain', rate: 48000, input: Float32Array.of(peak, -peak), output: Float32Array.of(peak / 2, -peak / 2)});
  const axis = () => Number(f.get('fxMonitorWave').texts[0]);
  f.monitor.setVisible(true);
  f.receive(data(.8));
  const loud = axis();
  f.setNow(100); f.tick(); f.receive(data(.01));
  const quiet = axis();
  assert(quiet < loud && quiet > .5, 'a release must not be immediately normalized to full height');
  f.setNow(200); f.tick(); f.receive(data(0));
  assert.equal(axis(), quiet, 'silence holds the last useful range');
  f.selectRange('1');
  assert.equal(axis(), 1);
  f.tick(); f.receive(data(.01));
  f.selectRange('auto');
  assert(Math.abs(axis() - .0125) < 1e-8);
});

for (const changed of ['target', 'channel', 'rack', 'mode']) test(`Auto resets for a different ${changed} without changing the saved range choice`, t => {
  const f = setup(t);
  const data = (peak, name = 'gain') => ({name, names: ['gain', 'other'], rate: 48000,
    input: Float32Array.of(peak, -peak), output: Float32Array.of(peak / 2, -peak / 2)});
  f.monitor.setVisible(true); f.receive(data(.8));
  f.setNow(100);
  if(changed === 'target') { f.get('fxMonitorTarget').value = 'other'; f.get('fxMonitorTarget').onchange(); }
  else if(changed === 'channel') { f.get('fxMonitorChannel').value = '1'; f.get('fxMonitorChannel').onchange(); }
  else if(changed === 'rack') { const previous = f.replaceRack(); f.tick(); assert.equal(previous.onMonitor, null); }
  else { f.selectMode('spectrum'); f.receive(data(.8)); f.selectMode('waveform'); }
  f.receive(data(.005, changed === 'target' ? 'other' : 'gain'));
  assert(Math.abs(Number(f.get('fxMonitorWave').texts[0]) - .00625) < 1e-8);
  assert.equal(f.get('fxMonitorScale').value, 'auto');
  assert(!f.writes.some(([key]) => key === 'tetorica.playground.fxMonitorRange'));
});

for (const savedRange of ['auto', '2', '1', '0.5', '0.2', '0.1', '0.05', '0.02', '0.01', '0.005', '0.001', '0', 'NaN', 'unexpected']) {
  test(`waveform range preference ${JSON.stringify(savedRange)} restores or falls back to Auto`, t => {
    const f = setup(t, {savedRange});
    const expected = ['auto', '2', '1', '0.5', '0.2', '0.1', '0.05', '0.02', '0.01', '0.005', '0.001'].includes(savedRange) ? savedRange : 'auto';
    assert.equal(f.get('fxMonitorScale').value, expected);
  });
}

test('Spectrum hides amplitude range and keeps dBFS axes when the saved range changes', t => {
  const transforms = countTransforms(t);
  const f = setup(t, {savedMode: 'spectrum', savedRange: '0.005'});
  f.monitor.setVisible(true); f.receive(snapshot());
  assert.equal(f.get('fxMonitorScaleControl').hidden, true);
  assert.deepEqual(f.get('fxMonitorFFT').texts.slice(0, 5), ['0', '-25', '-50', '-75', '-100']);
  const before = transforms(), messages = f.messages.length, draws = f.get('fxMonitorFFT').draws;
  f.selectRange('0.001');
  assert.equal(transforms(), before);
  assert.equal(f.messages.length, messages);
  assert.equal(f.get('fxMonitorFFT').draws, draws);
  assert.match(f.get('fxMonitorDescription').textContent, /−100 to 0 dBFS/);
  f.selectMode('waveform'); f.receive(snapshot());
  assert.equal(f.get('fxMonitorScaleControl').hidden, false);
  assert.equal(Number(f.get('fxMonitorWave').texts[0]), .001);
});

test('hidden range changes persist without captures or canvas work', t => {
  const f = setup(t);
  f.selectRange('0.05');
  assert.equal(f.messages.length, 0);
  assert.equal(f.get('fxMonitorWave').draws + f.get('fxMonitorFFT').draws, 0);
  assert.equal(f.get('fxMonitorWave').clears + f.get('fxMonitorFFT').clears, 0);
  assert.deepEqual(f.writes, [['tetorica.playground.fxMonitorRange', '0.05']]);
  f.monitor.setVisible(true); f.receive(snapshot());
  document.hidden = true; f.handlers.visibilitychange();
  const messages = f.messages.length, draws = f.get('fxMonitorWave').draws;
  f.selectRange('0.1');
  assert.equal(f.messages.length, messages);
  assert.equal(f.get('fxMonitorWave').draws, draws);
});

test('hidden mode changes leave an already connected rack idle', t => {
  const f = setup(t);
  f.monitor.setVisible(true); f.receive(snapshot());
  f.monitor.setVisible(false);
  const messages = f.messages.length;
  const draws = f.get('fxMonitorWave').draws + f.get('fxMonitorFFT').draws;
  const clears = f.get('fxMonitorWave').clears + f.get('fxMonitorFFT').clears;
  f.selectMode('spectrum'); f.selectRange('0.01');
  assert.equal(f.messages.length, messages);
  assert.equal(f.get('fxMonitorWave').draws + f.get('fxMonitorFFT').draws, draws);
  assert.equal(f.get('fxMonitorWave').clears + f.get('fxMonitorFFT').clears, clears);
});

test('snapshots keep option nodes stable; list changes defer while choosing and preserve selection', t => {
  const f = setup(t);
  f.monitor.setVisible(true);
  const select = f.get('fxMonitorTarget');
  const receive = names => f.receive({names});
  receive(['gain', 'filter']);
  assert.equal(select.writes, 1);
  const nodes = select.children;
  select.value = 'filter'; document.activeElement = select;
  for (let i = 0; i < 20; i++) { f.tick(); receive(['gain', 'filter']); }
  assert.equal(select.children, nodes);
  assert.equal(select.writes, 1);
  assert.equal(select.value, 'filter');
  f.tick(); receive(['gain', 'filter', 'delay']);
  assert.equal(select.writes, 1);
  select.onchange();
  assert.equal(f.capture().name, 'filter');
  document.activeElement = null; select.onblur();
  assert.equal(select.writes, 2);
  assert.equal(select.value, 'filter');
  f.tick(); receive(['gain']);
  assert.equal(select.value, 'gain');
  f.tick(); receive([]);
  assert.equal(select.children.length, 0);
});

test('default waveform draws both overlays without FFT work or hidden-canvas painting', t => {
  const data = snapshot();
  const transforms = countTransforms(t);
  const f = setup(t);
  f.monitor.setVisible(true);
  f.receive(data);
  assert.equal(f.get('fxMonitorMode').value, 'waveform');
  assert.equal(f.get('fxMonitorWaveView').hidden, false);
  assert.equal(f.get('fxMonitorSpectrumView').hidden, true);
  const wave = f.get('fxMonitorWave'), fft = f.get('fxMonitorFFT');
  assert.equal(wave.draws, 1);
  assert.equal(fft.draws, 0);
  assert.equal(fft.clears, 0);
  assert.equal(transforms(), 0, 'waveform monitoring must not execute the FFT');
  const overlays = wave.strokes.slice(-2);
  assert.equal(overlays[0].points.length, 2048);
  assert.equal(overlays[1].points.length, 2048);
  const range = values => Math.max(...values.map(point => point[1])) - Math.min(...values.map(point => point[1]));
  assert(range(overlays[0].points) > range(overlays[1].points) * 1.9, 'input and attenuated output remain distinguishable');
});

test('Spectrum executes real transforms and only paints the selected canvas', t => {
  const data = snapshot();
  const transforms = countTransforms(t);
  const f = setup(t, {savedMode: 'spectrum'});
  f.monitor.setVisible(true);
  f.receive(data);
  assert(transforms() > 0);
  assert.equal(f.get('fxMonitorWaveView').hidden, true);
  assert.equal(f.get('fxMonitorSpectrumView').hidden, false);
  assert.equal(f.get('fxMonitorWave').draws, 0);
  assert.equal(f.get('fxMonitorWave').clears, 0);
  const overlays = f.get('fxMonitorFFT').strokes.slice(-2);
  assert.equal(overlays[0].points.length, 1024);
  assert.equal(overlays[1].points.length, 1024);
  const inputPeak = Math.min(...overlays[0].points.map(point => point[1]));
  const outputPeak = Math.min(...overlays[1].points.map(point => point[1]));
  assert(inputPeak < outputPeak, 'the output spectrum reflects the attenuation');
});

test('the production spectrum finds a known sine and its 6 dB attenuation', () => {
  const data = snapshot();
  const input = spectrum(data.input), output = spectrum(data.output);
  const peak = values => values.indexOf(Math.max(...values));
  assert.equal(peak(input), 64, '1500 Hz occupies bin 64 at 48 kHz / 2048');
  assert.equal(peak(output), 64);
  assert(Math.abs(input[64] + 6.0206) < .1);
  assert(Math.abs(input[64] - output[64] - 6.0206) < .01);
  assert(input.every(Number.isFinite));
  assert(spectrum(new Float32Array(2048)).every(value => value === -100));
});

test('empty snapshots and mode changes clear only the selected canvas', t => {
  const f = setup(t);
  f.monitor.setVisible(true);
  f.receive({names: []});
  assert.equal(f.get('fxMonitorWave').clears, 1);
  assert.equal(f.get('fxMonitorFFT').clears, 0);
  f.selectMode('spectrum');
  assert.equal(f.get('fxMonitorWave').clears, 1);
  const spectrumClears = f.get('fxMonitorFFT').clears;
  assert.equal(spectrumClears, 1);
  f.receive({names: []});
  assert.equal(f.get('fxMonitorWave').clears, 1);
  assert.equal(f.get('fxMonitorFFT').clears, spectrumClears + 1);
});

test('mode changes invalidate old captures without releasing backpressure on the new request', t => {
  const data = snapshot();
  const transforms = countTransforms(t);
  const f = setup(t);
  f.monitor.setVisible(true);
  const old = f.capture();
  f.selectMode('spectrum');
  const fresh = f.capture();
  assert.notEqual(fresh.id, old.id);
  assert.equal(f.messages.at(-2).enabled, false);
  f.rack.onMonitor({...data, id: old.id, names: ['stale-target']});
  assert.equal(transforms(), 0);
  assert.equal(f.get('fxMonitorWave').draws, 0);
  assert.equal(f.get('fxMonitorFFT').draws, 0);
  assert.equal(f.get('fxMonitorTarget').children.length, 0);
  const count = f.messages.length;
  f.tick(); f.tick();
  assert.equal(f.messages.length, count, 'a stale reply cannot permit another outstanding capture');
  f.receive(data);
  assert(transforms() > 0);
  assert.equal(f.get('fxMonitorFFT').draws, 1);
  assert.equal(f.get('fxMonitorWave').draws, 0);
  f.tick();
  const pending = f.capture();
  const fftDraws = f.get('fxMonitorFFT').draws;
  f.selectMode('waveform');
  const beforeWave = transforms();
  f.rack.onMonitor({...data, id: pending.id});
  f.receive(data);
  assert.equal(transforms(), beforeWave, 'returning to waveform stops transforms immediately');
  assert.equal(f.get('fxMonitorFFT').draws, fftDraws);
  assert.equal(f.get('fxMonitorWave').draws, 1);
  assert.deepEqual(f.writes, [
    ['tetorica.playground.fxMonitorMode', 'spectrum'],
    ['tetorica.playground.fxMonitorMode', 'waveform'],
  ]);
});

for (const savedMode of ['waveform', 'spectrum', 'unknown', 'Spectrum', '']) {
  test(`stored mode ${JSON.stringify(savedMode)} restores or falls back to waveform`, t => {
    const f = setup(t, {savedMode});
    assert.equal(f.get('fxMonitorMode').value, savedMode === 'spectrum' ? 'spectrum' : 'waveform');
  });
}

test('blocked preference storage does not interrupt capture or mode switching', t => {
  const f = setup(t, {storage: {getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); }}});
  f.monitor.setVisible(true);
  assert.equal(f.get('fxMonitorMode').value, 'waveform');
  f.selectMode('spectrum');
  f.receive(snapshot());
  assert.equal(f.get('fxMonitorFFT').draws, 1);
});

test('disabled preference storage does not write settings', t => {
  const f = setup(t, {storage: null});
  f.monitor.setVisible(true);
  f.selectMode('spectrum');
  f.receive(snapshot());
  assert.deepEqual(f.writes, []);
  assert.equal(f.get('fxMonitorFFT').draws, 1);
});

test('hidden mode changes persist selection without capturing or painting', t => {
  const f = setup(t);
  f.selectMode('spectrum');
  assert(!f.messages.some(message => message.enabled));
  assert.equal(f.get('fxMonitorWave').draws + f.get('fxMonitorFFT').draws, 0);
  assert.equal(f.get('fxMonitorWave').clears + f.get('fxMonitorFFT').clears, 0);
  assert.deepEqual(f.writes.at(-1), ['tetorica.playground.fxMonitorMode', 'spectrum']);
  f.monitor.setVisible(true);
  f.receive(snapshot());
  assert.equal(f.get('fxMonitorFFT').draws, 1);
  assert.equal(f.get('fxMonitorWave').draws, 0);
});
