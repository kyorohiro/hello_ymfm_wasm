import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioMonitor} from './playground_audio_monitor.js';

function setup(t, options = {}) {
  const saved = new Map(['document','window','requestAnimationFrame','cancelAnimationFrame','IntersectionObserver','localStorage'].map(k => [k,globalThis[k]]));
  let monitor;
  t.after(() => {
    monitor?.dispose();
    for (const [k,v] of saved) {if (v === undefined) delete globalThis[k]; else globalThis[k] = v;}
  });
  const events = () => ({listeners: new Map(), addEventListener(k, fn) {this.listeners.set(k, fn);}, removeEventListener(k) {this.listeners.delete(k);}});
  globalThis.document = {...events(), hidden: false}; globalThis.window = events();
  let sequence = 0;
  const frames = new Map();
  globalThis.requestAnimationFrame = fn => {frames.set(++sequence,fn); return sequence;};
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  let observer;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const advance = time => {const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(time);};
  function canvas() {
    const result = {width: 700, height: 220, draws: 0, texts: [], strokes: []};
    let points = [];
    const context = {
      fillRect() { result.draws++; result.texts = []; result.strokes = []; },
      fillText(text) { result.texts.push(text); },
      beginPath() { points = []; },
      moveTo(x, y) { points.push([x, y]); },
      lineTo(x, y) { points.push([x, y]); },
      stroke() { result.strokes.push({style: this.strokeStyle, points: [...points]}); },
    };
    result.getContext = () => context;
    return result;
  }
  const channel = {value: '0'}, status = {};
  const pauseButton = {...events(),setAttribute(){}};
  const mode = {...events(), value: ''};
  const modePanels = {envelope: {}, waveform: {}, spectrum: {}};
  const envelopeCanvas = canvas(), waveCanvas = canvas(), spectrumCanvas = canvas();
  let source, detached = 0, created = 0;
  const captured = [], frequencyReads = [], writes = [];
  const storage = {getItem: () => options.savedMode ?? null, setItem(key, value) { writes.push([key, value]); }};
  globalThis.localStorage = storage;
  let signal = (i, selectedChannel) => selectedChannel ? .2 : .1;
  function audio() {
    const context = {state: 'running',sampleRate: 48000,
      createChannelSplitter: () => ({connect(analyser, channel){analyser.selectedChannel = channel;},disconnect(){}}),
      createAnalyser() {created++; return {disconnect(){},
        getFloatTimeDomainData(data) {captured.push(this.selectedChannel);for (let i = 0; i < data.length; i++) data[i] = signal(i, this.selectedChannel);},
        getFloatFrequencyData(data) {frequencyReads.push(this.selectedChannel);data.fill(-80);}};}};
    return {audioContext: context,masterOutputNode: {},outputMonitors: new Set(),
      connectOutputMonitor(node) {this.outputMonitors.add(node); return () => {this.outputMonitors.delete(node);detached++;};}};
  }
  monitor = createAudioMonitor(() => source,{panel:{},envelopeCanvas,waveCanvas,spectrumCanvas,modeSelect:mode,modePanels,channel,status,pauseButton,storage,...options.monitorOptions});
  return { monitor, advance, channel, status, pauseButton, mode, modePanels, envelopeCanvas, waveCanvas, spectrumCanvas,
    captured, frequencyReads, writes, frames, audio,
    setSource(next) { source = next; },
    setSignal(next) { signal = next; },
    get source() { return source; },
    get created() { return created; },
    get detached() { return detached; },
    intersect(value) { observer.callback([{isIntersecting: value}]); },
    get observer() { return observer; },
  };
}

test('monitor observes selected stereo channel, reattaches after restart, and stops when hidden', t => {
  const fixture = setup(t);
  const {monitor,advance,channel,status,pauseButton,captured,frames,audio} = fixture;
  monitor.setVisible(true); advance(40);
  assert.match(status.textContent,/Press Run/);
  fixture.setSource(audio()); advance(140);
  assert.equal(fixture.source.outputMonitors.size,1); assert.deepEqual(captured,[0]);
  assert.equal(fixture.created,1); // Only the selected channel has an analyser.
  advance(160); assert.deepEqual(captured,[0]); // No extra read inside the 15 Hz budget.
  channel.value = '1'; advance(240); assert.deepEqual(captured,[0,1]);
  assert.match(status.textContent,/Right/);
  const old = fixture.source; fixture.setSource(audio()); advance(340);
  assert.equal(old.outputMonitors.size,0); assert.equal(fixture.source.outputMonitors.size,1);
  pauseButton.listeners.get('click')();
  assert.equal(pauseButton.textContent,'Resume');
  assert.equal(fixture.source.outputMonitors.size,0); assert.equal(frames.size,0);
  assert.match(status.textContent,/Analysis paused/);
  const readCount = captured.length;
  advance(440); assert.equal(captured.length,readCount);
  pauseButton.listeners.get('click')(); advance(540);
  assert.equal(pauseButton.textContent,'Pause'); assert.equal(fixture.source.outputMonitors.size,1);
  document.hidden = true; document.listeners.get('visibilitychange')();
  assert.equal(frames.size,0); assert.equal(fixture.source.outputMonitors.size,0);
  document.hidden = false; document.listeners.get('visibilitychange')(); advance(640);
  assert.equal(fixture.source.outputMonitors.size,1);
  monitor.setVisible(false); assert.equal(frames.size,0); assert.equal(fixture.source.outputMonitors.size,0);
  monitor.dispose(); assert.ok(fixture.detached >= 3);
  assert.equal(document.listeners.size,0); assert.equal(window.listeners.size,0);
  assert.equal(pauseButton.listeners.size,0);
});

function start(fixture, time = 0) {
  for (const canvas of [fixture.envelopeCanvas, fixture.waveCanvas, fixture.spectrumCanvas]) canvas.draws = 0;
  fixture.setSource(fixture.audio());
  fixture.monitor.setVisible(true);
  fixture.advance(time);
}

function selectMode(fixture, mode) {
  fixture.mode.value = mode;
  fixture.mode.listeners.get('change')();
}

test('Envelope is the default and only its time-domain analysis and canvas run', t => {
  const f = setup(t);
  start(f);
  assert.equal(f.mode.value, 'envelope');
  assert.deepEqual(f.captured, [0]);
  assert.deepEqual(f.frequencyReads, []);
  assert.equal(f.envelopeCanvas.draws, 1);
  assert.equal(f.waveCanvas.draws, 0);
  assert.equal(f.spectrumCanvas.draws, 0);
  assert.equal(f.modePanels.envelope.hidden, false);
  assert.equal(f.modePanels.waveform.hidden, true);
  assert.equal(f.modePanels.spectrum.hidden, true);
});

test('switching modes reads and draws only the selected analysis', t => {
  const f = setup(t);
  start(f);
  selectMode(f, 'waveform');
  f.advance(100);
  assert.deepEqual(f.captured, [0, 0]);
  assert.deepEqual(f.frequencyReads, []);
  assert.equal(f.envelopeCanvas.draws, 1);
  assert(f.waveCanvas.draws >= 1);
  assert.equal(f.spectrumCanvas.draws, 0);
  assert.equal(f.modePanels.waveform.hidden, false);
  assert.equal(f.modePanels.envelope.hidden, true);
  const waveDraws = f.waveCanvas.draws;
  selectMode(f, 'spectrum');
  f.advance(200);
  assert.deepEqual(f.captured, [0, 0]);
  assert.deepEqual(f.frequencyReads, [0]);
  assert.equal(f.envelopeCanvas.draws, 1);
  assert.equal(f.waveCanvas.draws, waveDraws);
  assert(f.spectrumCanvas.draws >= 1);
  assert.equal(f.modePanels.waveform.hidden, true);
  assert.equal(f.modePanels.spectrum.hidden, false);
  assert.equal(f.source.outputMonitors.size, 1, 'mode changes must not add monitoring branches');
  assert.equal(f.created, 1, 'the selected modes share one analyser');
  assert.deepEqual(f.writes.at(-1), ['tetorica.playground.audioMonitorMode', 'spectrum']);
});

for (const savedMode of ['envelope', 'waveform', 'spectrum']) {
  test(`a saved ${savedMode} mode restores without running the other analyses`, t => {
    const f = setup(t, {savedMode});
    start(f);
    assert.equal(f.mode.value, savedMode);
    assert.equal(f.captured.length, savedMode === 'spectrum' ? 0 : 1);
    assert.equal(f.frequencyReads.length, savedMode === 'spectrum' ? 1 : 0);
    assert.deepEqual([f.envelopeCanvas.draws, f.waveCanvas.draws, f.spectrumCanvas.draws],
      ['envelope', 'waveform', 'spectrum'].map(mode => Number(mode === savedMode)));
  });
}

for (const savedMode of ['invalid-mode', 'Spectrum', '']) {
  test(`an invalid stored mode ${JSON.stringify(savedMode)} falls back to Envelope`, t => {
    const f = setup(t, {savedMode});
    start(f);
    assert.equal(f.mode.value, 'envelope');
    assert.equal(f.envelopeCanvas.draws, 1);
    assert.deepEqual(f.frequencyReads, []);
  });
}

test('unavailable preference storage does not prevent analysis or mode changes', t => {
  const storage = {getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); }};
  const f = setup(t, {monitorOptions: {storage}});
  start(f);
  assert.equal(f.mode.value, 'envelope');
  selectMode(f, 'spectrum');
  f.advance(100);
  assert(f.spectrumCanvas.draws >= 1);
  assert.deepEqual(f.frequencyReads, [0]);
});

test('changing the selected mode while paused keeps all analysis detached until Resume', t => {
  const f = setup(t);
  start(f);
  f.pauseButton.listeners.get('click')();
  selectMode(f, 'spectrum');
  const pausedDraws = f.spectrumCanvas.draws;
  f.advance(100);
  assert.equal(f.mode.value, 'spectrum');
  assert.equal(f.source.outputMonitors.size, 0);
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.captured, [0]);
  assert.deepEqual(f.frequencyReads, []);
  assert.equal(f.spectrumCanvas.draws, pausedDraws);
  assert(pausedDraws >= 1, 'the new selected view can show idle axes while paused');
  assert.equal(f.writes.at(-1)[1], 'spectrum');
  f.pauseButton.listeners.get('click')();
  f.advance(200);
  assert.equal(f.source.outputMonitors.size, 1);
  assert.deepEqual(f.captured, [0]);
  assert.deepEqual(f.frequencyReads, [0]);
  assert.equal(f.spectrumCanvas.draws, pausedDraws + 1);
});

test('offscreen analysis detaches and resumes using the currently selected mode and channel', t => {
  const f = setup(t);
  start(f);
  f.intersect(false);
  assert.equal(f.source.outputMonitors.size, 0);
  assert.equal(f.frames.size, 0);
  selectMode(f, 'spectrum');
  f.channel.value = '1';
  f.advance(100);
  assert.deepEqual(f.captured, [0]);
  assert.deepEqual(f.frequencyReads, []);
  f.intersect(true);
  f.advance(200);
  assert.equal(f.source.outputMonitors.size, 1);
  assert.deepEqual(f.frequencyReads, [1]);
  assert.match(f.status.textContent, /Right/);
  f.monitor.dispose();
  assert.equal(f.source.outputMonitors.size, 0);
  assert.equal(f.mode.listeners.size, 0);
  assert.equal(f.observer.disconnected, true);
});

function envelopeTraces(fixture) {
  const traces = fixture.envelopeCanvas.strokes.slice(-2);
  assert.equal(traces.length, 2, 'Envelope has separate RMS and sampled-peak traces');
  return {rms: traces[0].points, peak: traces[1].points};
}

test('Envelope shows bipolar RMS separately from sampled peaks and retains five seconds of history', t => {
  const f = setup(t);
  f.setSignal(() => 0);
  start(f);
  // Half full-scale bipolar samples and half silence have the same RMS as a
  // constant sqrt(1/2), while their peaks differ. This distinguishes RMS from
  // signed averaging, mean absolute amplitude, and peak-only metering.
  f.setSignal(i => i % 4 === 0 ? 1 : i % 4 === 2 ? -1 : 0);
  f.advance(100);
  f.setSignal(() => Math.SQRT1_2);
  f.advance(200);
  const {rms, peak} = envelopeTraces(f);
  assert.equal(rms.length, 3);
  assert.equal(peak.length, 3);
  assert(rms[1][1] < rms[0][1], 'a bipolar signal must be visible above the silence baseline');
  assert(rms[1][1] > peak[1][1], 'RMS must be below the sparse full-scale peaks');
  assert(Math.abs(rms[1][1] - rms[2][1]) < 1e-4, 'the two signals have equal RMS');
  assert(peak[1][1] < peak[2][1], 'their sampled peaks differ');
  assert(Math.abs(peak[2][1] - rms[2][1]) < 1e-4, 'constant amplitude has equal RMS and peak');
  assert(rms[0][0] < rms[1][0] && rms[1][0] < rms[2][0], 'history advances toward now');
  f.setSignal(() => 0);
  f.advance(4900);
  const retained = envelopeTraces(f).rms;
  assert.equal(retained.length, 4);
  assert(retained.some(point => point[1] < rms[0][1]), 'older loudness remains within the five-second window');
  assert(retained[1][0] < rms[1][0], 'earlier observations move left as real time passes');
  f.advance(5201);
  const expired = envelopeTraces(f);
  assert.equal(expired.rms.length, 2);
  assert(expired.rms.every(point => point[1] === rms[0][1]), 'expired loudness must not remain on the plot');
  assert(expired.peak.every(point => point[1] === rms[0][1]));
  assert.deepEqual(f.frequencyReads, []);
  assert.equal(f.waveCanvas.draws, 0);
  assert.equal(f.spectrumCanvas.draws, 0);
});

test('Envelope history stays bounded and resets when its channel or observation session changes', t => {
  const f = setup(t);
  start(f);
  for (let i = 1; i <= 120; i++) f.advance(i * 70);
  assert.equal(f.captured.length, 121);
  const before = envelopeTraces(f).rms;
  assert(before.length > 60 && before.length <= 80, 'the rolling plot remains bounded during continuous playback');
  assert(before.every(point => point.every(Number.isFinite)));
  f.channel.value = '1';
  f.advance(8500);
  assert.equal(envelopeTraces(f).rms.length, 1, 'a new channel does not inherit the previous channel history');
  f.advance(8600);
  assert.equal(envelopeTraces(f).rms.length, 2);
  f.pauseButton.listeners.get('click')();
  f.pauseButton.listeners.get('click')();
  f.advance(8700);
  assert.equal(envelopeTraces(f).rms.length, 1, 'Resume starts a new observation history');
  f.advance(8800);
  selectMode(f, 'spectrum');
  f.advance(8900);
  selectMode(f, 'envelope');
  f.advance(9000);
  assert.equal(envelopeTraces(f).rms.length, 1, 'returning to Envelope starts fresh after inactive analysis');
  f.advance(9100);
  f.intersect(false);
  f.intersect(true);
  f.advance(9200);
  assert.equal(envelopeTraces(f).rms.length, 1, 'offscreen gaps are not connected as continuous observations');
});

test('explicitly disabling preference storage ignores saved mode and does not write settings', t => {
  const f = setup(t, {savedMode: 'spectrum', monitorOptions: {storage: null}});
  start(f);
  assert.equal(f.mode.value, 'envelope');
  selectMode(f, 'waveform');
  f.advance(100);
  assert.deepEqual(f.writes, []);
  assert.equal(f.frequencyReads.length, 0);
  assert.deepEqual(f.captured, [0, 0]);
});
