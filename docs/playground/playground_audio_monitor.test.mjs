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
  const scaleSelect = {...events(), value: ''}, scaleControl = {};
  const modePanels = {envelope: {}, waveform: {}, spectrum: {}};
  const envelopeCanvas = canvas(), waveCanvas = canvas(), spectrumCanvas = canvas();
  let source, detached = 0, created = 0;
  const captured = [], frequencyReads = [], writes = [], sampleBuffers = [];
  const storage = {
    getItem(key) { return key === 'tetorica.playground.audioMonitorMode' ? options.savedMode ?? null : options.savedRange ?? null; },
    setItem(key, value) { writes.push([key, value]); },
  };
  globalThis.localStorage = storage;
  let signal = (i, selectedChannel) => selectedChannel ? .2 : .1;
  function audio() {
    const context = {state: 'running',sampleRate: 48000,
      createChannelSplitter: () => ({connect(analyser, channel){analyser.selectedChannel = channel;},disconnect(){}}),
      createAnalyser() {created++; return {disconnect(){},
        getFloatTimeDomainData(data) {captured.push(this.selectedChannel);for (let i = 0; i < data.length; i++) data[i] = signal(i, this.selectedChannel);sampleBuffers.push(data);},
        getFloatFrequencyData(data) {frequencyReads.push(this.selectedChannel);data.fill(-80);}};}};
    return {audioContext: context,masterOutputNode: {gain: {value: 1}},outputMonitors: new Set(),
      connectOutputMonitor(node) {this.outputMonitors.add(node); return () => {this.outputMonitors.delete(node);detached++;};}};
  }
  monitor = createAudioMonitor(() => source,{panel:{},envelopeCanvas,waveCanvas,spectrumCanvas,modeSelect:mode,modePanels,scaleSelect,scaleControl,channel,status,pauseButton,storage,...options.monitorOptions});
  return { monitor, advance, channel, status, pauseButton, mode, modePanels, scaleSelect, scaleControl, envelopeCanvas, waveCanvas, spectrumCanvas,
    captured, frequencyReads, writes, frames, audio, sampleBuffers,
    setSource(next) { source = next; },
    setSignal(next) { signal = next; },
    get source() { return source; },
    get created() { return created; },
    get detached() { return detached; },
    get frameRequests() { return sequence; },
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

function selectScale(fixture, range) {
  fixture.scaleSelect.value = range;
  fixture.scaleSelect.listeners.get('change')();
}

function plotBounds(canvas) {
  const ys = canvas.strokes.slice(0, 5).map(stroke => stroke.points[0][1]);
  return {top: Math.min(...ys), bottom: Math.max(...ys)};
}

function verticalSpan(points) {
  const ys = points.map(point => point[1]);
  return Math.max(...ys) - Math.min(...ys);
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
  selectScale(f, '0.05');
  assert.equal(f.scaleSelect.value, '0.05');
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
  const f = setup(t, {savedMode: 'spectrum', savedRange: '0.05', monitorOptions: {storage: null}});
  start(f);
  assert.equal(f.mode.value, 'envelope');
  assert.equal(f.scaleSelect.value, 'auto');
  selectMode(f, 'waveform');
  selectScale(f, '0.1');
  f.advance(100);
  assert.deepEqual(f.writes, []);
  assert.equal(f.frequencyReads.length, 0);
  assert.deepEqual(f.captured, [0, 0]);
});

test('file-preview guidance and source labels follow the existing audio without starting it', t => {
  let sourceLabel = 'File preview';
  const f = setup(t, {monitorOptions: {getSourceLabel: () => sourceLabel}});
  f.monitor.setVisible(true);
  f.advance(0);
  assert.match(f.status.textContent, /File preview.*Play a note/);
  assert.equal(f.created, 0, 'an unopened preview must not initialize audio for the monitor');
  f.setSource(f.audio());
  f.advance(100);
  assert.match(f.status.textContent, /File preview.*48000 Hz/);
  const preview = f.source;
  sourceLabel = '';
  f.setSource(f.audio());
  f.advance(200);
  assert.equal(preview.outputMonitors.size, 0, 'leaving the preview releases its observation branch');
  assert.equal(f.source.outputMonitors.size, 1);
  assert.doesNotMatch(f.status.textContent, /File preview/);
  f.setSource(null);
  f.advance(300);
  assert.match(f.status.textContent, /Press Run/);
});

for (const mode of ['envelope', 'waveform']) {
  test(`Auto makes a quiet ${mode} visible while retaining real amplitude labels`, t => {
    const f = setup(t, {savedMode: mode});
    f.setSignal(i => i % 2 ? -.002 : .002);
    start(f);
    const canvas = mode === 'envelope' ? f.envelopeCanvas : f.waveCanvas;
    assert.equal(f.scaleSelect.value, 'auto');
    assert.equal(f.scaleControl.hidden, false);
    assert.equal(Number(canvas.texts[0]), .0025, 'Auto axis numbers describe the original PCM amplitude');
    const {top, bottom} = plotBounds(canvas);
    if (mode === 'envelope') {
      const {rms, peak} = envelopeTraces(f);
      assert(bottom - rms[0][1] > (bottom - top) * .7);
      assert(Math.abs(rms[0][1] - peak[0][1]) < 1e-4);
    } else {
      assert(verticalSpan(canvas.strokes.at(-1).points) > (bottom - top) * .7);
      assert.deepEqual(canvas.texts.slice(0, 5), ['0.0025', '0.00125', '0', '-0.00125', '-0.0025']);
    }
    assert.equal(f.source.masterOutputNode.gain.value, 1);
    assert.deepEqual(f.frequencyReads, []);
    f.setSignal(i => i % 2 ? -1.6 : 1.6);
    f.advance(100);
    assert.equal(Number(canvas.texts[0]), 2, 'Auto does not cap the display at full-scale amplitude');
  });
}

test('fixed waveform range changes geometry without changing PCM, gain, reads, or scheduling', t => {
  const f = setup(t, {savedMode: 'waveform', savedRange: '1'});
  f.setSignal(i => i % 2 ? -.02 : .02);
  start(f);
  const initialSpan = verticalSpan(f.waveCanvas.strokes.at(-1).points);
  const pcm = new Float32Array(f.sampleBuffers[0]);
  const requests = f.frameRequests;
  assert.deepEqual(f.waveCanvas.texts.slice(0, 5), ['1', '0.5', '0', '-0.5', '-1']);
  selectScale(f, '0.05');
  const enlarged = verticalSpan(f.waveCanvas.strokes.at(-1).points);
  assert(Math.abs(enlarged / initialSpan - 20) < 1e-6);
  assert.deepEqual(f.waveCanvas.texts.slice(0, 5), ['0.05', '0.025', '0', '-0.025', '-0.05']);
  assert.deepEqual(f.sampleBuffers[0], pcm, 'display normalization must not modify the analyser buffer');
  assert.deepEqual(f.captured, [0]);
  assert.equal(f.frequencyReads.length, 0);
  assert.equal(f.created, 1);
  assert.equal(f.frameRequests, requests);
  assert.equal(f.frames.size, 1);
  assert.equal(f.source.masterOutputNode.gain.value, 1);
  selectScale(f, '0.01');
  const {top, bottom} = plotBounds(f.waveCanvas);
  const clipped = f.waveCanvas.strokes.at(-1).points.map(point => point[1]);
  assert.equal(Math.min(...clipped), top);
  assert.equal(Math.max(...clipped), bottom);
  assert.deepEqual(f.sampleBuffers[0], pcm, 'a deliberately clipped display still leaves audio unchanged');
  assert.deepEqual(f.writes.at(-1), ['tetorica.playground.audioMonitorRange', '0.01']);
});

test('Envelope RMS and sampled peaks use the same fixed amplitude axis', t => {
  const f = setup(t, {savedRange: '0.05'});
  f.setSignal(i => i % 4 === 0 ? .04 : 0);
  start(f);
  const {rms, peak} = envelopeTraces(f), {bottom} = plotBounds(f.envelopeCanvas);
  assert.deepEqual(f.envelopeCanvas.texts.slice(0, 5), ['0.05', '0.0375', '0.025', '0.0125', '0']);
  assert(Math.abs((bottom - peak[0][1]) / (bottom - rms[0][1]) - 2) < 1e-6);
  assert.deepEqual(f.captured, [0]);
  assert.equal(f.waveCanvas.draws + f.spectrumCanvas.draws, 0);
});

test('paused range changes redraw the cached Envelope history without sampling, scheduling, or appending', t => {
  const f = setup(t);
  f.setSignal(() => .02); start(f);
  f.setSignal(() => .04); f.advance(100);
  f.setSignal(() => .03); f.advance(200);
  const before = envelopeTraces(f);
  const xs = before.rms.map(point => point[0]);
  f.pauseButton.listeners.get('click')();
  const reads = f.captured.length, requests = f.frameRequests, created = f.created;
  selectScale(f, '0.1');
  let after = envelopeTraces(f);
  assert.equal(after.rms.length, 3);
  assert.deepEqual(after.rms.map(point => point[0]), xs);
  assert.deepEqual(after.peak.map(point => point[0]), xs);
  assert(after.rms[1][1] > before.rms[1][1], 'the larger display range shrinks the cached trace');
  assert.equal(Number(f.envelopeCanvas.texts[0]), .1);
  f.advance(10000);
  selectScale(f, 'auto');
  after = envelopeTraces(f);
  assert.equal(Number(f.envelopeCanvas.texts[0]), .05, 'Auto refits the largest cached peak');
  assert.deepEqual(after.rms.map(point => point[0]), xs, 'Pause freezes the time axis as well as the history length');
  assert.equal(f.captured.length, reads);
  assert.equal(f.frequencyReads.length, 0);
  assert.equal(f.created, created);
  assert.equal(f.frameRequests, requests);
  assert.equal(f.frames.size, 0);
  assert.equal(f.source.outputMonitors.size, 0);
  assert.equal(f.waveCanvas.draws + f.spectrumCanvas.draws, 0);
});

test('waveform Auto shrinks slowly, holds through silence, and resets for a new channel or source', t => {
  const f = setup(t, {savedMode: 'waveform'});
  f.setSignal(i => i % 2 ? -.01 : .01); start(f);
  assert.equal(Number(f.waveCanvas.texts[0]), .0125);
  f.setSignal(i => i % 2 ? -.001 : .001); f.advance(100);
  const reduced = Number(f.waveCanvas.texts[0]);
  assert(reduced < .0125 && reduced > .011, '100 ms lowers the scale gradually, without snapping to the quiet signal');
  f.advance(200);
  const held = f.waveCanvas.texts[0];
  assert(Number(held) < reduced);
  f.setSignal(() => 0); f.advance(300); f.advance(10000);
  assert.equal(f.waveCanvas.texts[0], held);
  f.setSignal(() => 5e-7); f.advance(10100);
  assert.equal(f.waveCanvas.texts[0], held, 'numerical residue is treated as silence');
  f.setSignal(() => .1); f.advance(10200);
  assert.equal(Number(f.waveCanvas.texts[0]), .125, 'larger peaks expand immediately');
  f.channel.value = '1'; f.setSignal(() => .002); f.advance(10300);
  assert.equal(Number(f.waveCanvas.texts[0]), .0025, 'a newly selected channel starts its own Auto observation');
  const old = f.source;
  f.setSource(f.audio()); f.setSignal(() => .004); f.advance(10400);
  assert.equal(Number(f.waveCanvas.texts[0]), .005);
  assert.equal(old.outputMonitors.size, 0);
  assert.deepEqual(f.frequencyReads, []);
});

for (const savedRange of ['auto', '0.05', '0.001', 'bad-range', '0', '1e-3']) {
  test(`saved range ${JSON.stringify(savedRange)} restores independently of the selected mode`, t => {
    const f = setup(t, {savedMode: 'waveform', savedRange});
    f.setSignal(() => .02); start(f);
    const expected = ['auto', '0.05', '0.001'].includes(savedRange) ? savedRange : 'auto';
    assert.equal(f.mode.value, 'waveform');
    assert.equal(f.scaleSelect.value, expected);
    assert.equal(Number(f.waveCanvas.texts[0]), expected === 'auto' ? .025 : Number(expected));
    assert.deepEqual(f.frequencyReads, []);
  });
}

test('Spectrum hides amplitude ranges and changing one leaves dBFS geometry and analysis untouched', t => {
  const f = setup(t, {savedMode: 'spectrum'});
  start(f);
  const axes = [...f.spectrumCanvas.texts], strokes = structuredClone(f.spectrumCanvas.strokes);
  const draws = f.spectrumCanvas.draws, requests = f.frameRequests;
  assert.equal(f.scaleControl.hidden, true);
  assert.deepEqual(axes.slice(0, 5), ['0', '-25', '-50', '-75', '-100']);
  assert(axes.includes('dBFS'));
  selectScale(f, '0.05');
  assert.deepEqual(f.spectrumCanvas.texts, axes);
  assert.deepEqual(f.spectrumCanvas.strokes, strokes);
  assert.equal(f.spectrumCanvas.draws, draws);
  assert.equal(f.envelopeCanvas.draws + f.waveCanvas.draws, 0);
  assert.deepEqual(f.frequencyReads, [0]);
  assert.equal(f.captured.length, 0);
  assert.equal(f.created, 1);
  assert.equal(f.frameRequests, requests);
  selectMode(f, 'waveform');
  assert.equal(f.scaleControl.hidden, false);
  assert.equal(f.scaleSelect.value, '0.05');
  f.monitor.dispose();
  assert.equal(f.scaleSelect.listeners.size, 0);
});

test('range changes in a hidden or offscreen panel never paint cached snapshots or restart observation', t => {
  const f = setup(t, {savedMode: 'waveform'});
  start(f);
  f.monitor.setVisible(false);
  const draws = f.waveCanvas.draws, reads = f.captured.length, requests = f.frameRequests;
  selectScale(f, '0.05');
  assert.equal(f.waveCanvas.draws, draws);
  assert.equal(f.frameRequests, requests);
  assert.equal(f.frames.size, 0);
  assert.equal(f.source.outputMonitors.size, 0);
  f.monitor.setVisible(true); f.advance(100);
  f.intersect(false);
  const offscreenDraws = f.waveCanvas.draws, offscreenRequests = f.frameRequests;
  selectScale(f, '0.1');
  assert.equal(f.waveCanvas.draws, offscreenDraws);
  assert.equal(f.frameRequests, offscreenRequests);
  assert.equal(f.captured.length, reads + 1);
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.frequencyReads, []);
  f.intersect(true); f.advance(200);
  document.hidden = true; document.listeners.get('visibilitychange')();
  const hiddenDraws = f.waveCanvas.draws, hiddenRequests = f.frameRequests;
  selectScale(f, '0.2');
  assert.equal(f.waveCanvas.draws, hiddenDraws);
  assert.equal(f.frameRequests, hiddenRequests);
  assert.equal(f.captured.length, reads + 2);
  assert.equal(f.frames.size, 0);
});
