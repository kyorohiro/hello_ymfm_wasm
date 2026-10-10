import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioMonitor} from './playground_audio_monitor.js';

test('monitor observes selected stereo channel, reattaches after restart, and stops when hidden', t => {
  const saved = new Map(['document','window','requestAnimationFrame','cancelAnimationFrame','IntersectionObserver'].map(k => [k,globalThis[k]]));
  t.after(() => {for (const [k,v] of saved) {if (v === undefined) delete globalThis[k]; else globalThis[k] = v;}});
  const events = () => ({listeners: new Map(), addEventListener(k, fn) {this.listeners.set(k, fn);}, removeEventListener(k) {this.listeners.delete(k);}});
  globalThis.document = {...events(), hidden: false}; globalThis.window = events();
  let sequence = 0;
  const frames = new Map();
  globalThis.requestAnimationFrame = fn => {frames.set(++sequence,fn); return sequence;};
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  globalThis.IntersectionObserver = undefined;
  const advance = time => {const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(time);};
  const canvas = () => ({width: 700,height: 220,getContext: () => ({fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}})});
  const channel = {value: '0'}, status = {};
  let source, detached = 0, captured = [];
  function audio() {
    let index = 0;
    const context = {state: 'running',sampleRate: 48000,
      createChannelSplitter: () => ({connect(){},disconnect(){}}),
      createAnalyser() {const ch = index++; return {disconnect(){},
        getFloatTimeDomainData(data) {captured.push(ch);data.fill(ch ? .2 : .1);},
        getFloatFrequencyData(data) {data.fill(-80);}};}};
    return {audioContext: context,masterOutputNode: {},outputMonitors: new Set(),
      connectOutputMonitor(node) {this.outputMonitors.add(node); return () => {this.outputMonitors.delete(node);detached++;};}};
  }
  const monitor = createAudioMonitor(() => source,{panel:{},waveCanvas:canvas(),spectrumCanvas:canvas(),channel,status});
  monitor.setVisible(true); advance(40);
  assert.match(status.textContent,/Press Run/);
  source = audio(); advance(80);
  assert.equal(source.outputMonitors.size,1); assert.deepEqual(captured,[0]);
  channel.value = '1'; advance(120); assert.deepEqual(captured,[0,1]);
  assert.match(status.textContent,/Right/);
  const old = source; source = audio(); advance(160);
  assert.equal(old.outputMonitors.size,0); assert.equal(source.outputMonitors.size,1);
  document.hidden = true; document.listeners.get('visibilitychange')();
  assert.equal(frames.size,0); assert.equal(source.outputMonitors.size,0);
  document.hidden = false; document.listeners.get('visibilitychange')(); advance(200);
  assert.equal(source.outputMonitors.size,1);
  monitor.setVisible(false); assert.equal(frames.size,0); assert.equal(source.outputMonitors.size,0);
  monitor.dispose(); assert.ok(detached >= 3);
  assert.equal(document.listeners.size,0); assert.equal(window.listeners.size,0);
});
