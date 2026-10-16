import test from 'node:test';
import assert from 'node:assert/strict';
import {createFXMonitor, spectrum} from './playground_fx_monitor.js';

function setup(t, {savedMode = null, storage: suppliedStorage} = {}) {
  const saved = new Map(['document', 'localStorage', 'setInterval', 'clearInterval'].map(key => [key, globalThis[key]]));
  const elements = new Map(), handlers = {}, messages = [], timers = new Map(), writes = [];
  let sequence = 0, monitor;
  function element() {
    const result = {value: '', textContent: '', children: [], writes: 0, width: 700, height: 220,
      draws: 0, clears: 0, strokes: [],
      replaceChildren(...nodes) { this.children = nodes; this.writes++; },
    };
    let points = [];
    const context = {
      clearRect() { result.clears++; result.strokes = []; },
      fillRect() { result.draws++; result.strokes = []; },
      fillText() {}, beginPath() { points = []; },
      moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
      stroke() { result.strokes.push({style: this.strokeStyle, points: [...points]}); },
    };
    result.getContext = () => context;
    return result;
  }
  const storage = suppliedStorage === undefined ? {
    getItem() { return savedMode; }, setItem(key, value) { writes.push([key, value]); },
  } : suppliedStorage;
  globalThis.localStorage = storage;
  globalThis.document = {
    hidden: false, activeElement: null,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    addEventListener(name, callback) { handlers[name] = callback; }, createElement: element,
  };
  globalThis.setInterval = callback => { timers.set(++sequence, callback); return sequence; };
  globalThis.clearInterval = id => timers.delete(id);
  const rack = {node: {port: {postMessage: message => messages.push(message)}}};
  monitor = createFXMonitor(() => rack, {storage});
  t.after(() => {
    monitor?.setVisible(false);
    for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  });
  return {
    monitor, rack, messages, handlers, writes, timers,
    get: id => document.getElementById(id),
    tick() { for (const callback of [...timers.values()]) callback(); },
    capture() { return messages.findLast(message => message.enabled === true); },
    receive(data = {}) { rack.onMonitor({id: this.capture().id, names: ['gain'], ...data}); },
    selectMode(value) { const mode = document.getElementById('fxMonitorMode'); mode.value = value; mode.onchange(); },
  };
}

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
