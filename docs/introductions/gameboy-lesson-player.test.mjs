import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('./gameboy-lesson-player.js', import.meta.url), 'utf8')).replaceAll('export function', 'function');
function setup(render) {
  const nodes = new Map(), documentEvents = new Map(), windowEvents = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {textContent: '', handlers: new Map(), addEventListener(type, fn) {this.handlers.set(type, fn);}});
    return nodes.get(id);
  };
  const sources = [], gains = [], contexts = [], events = [];
  class AudioContext {
    constructor() {this.sampleRate = 48000; this.currentTime = 0; contexts.push(this);}
    async resume() {}
    async close() {this.closed = true;}
    createBuffer(channels, count, rate) {assert.equal(channels, 2); return {duration: count / rate, copyToChannel() {}};}
    createBufferSource() {
      const s = {connect() {}, disconnect() {this.disconnected = true;}, start() {this.started = true;}, stop() {this.stopped = true;}};
      sources.push(s); return s;
    }
    createGain() {
      const gain = {gain: {value: .7, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}}, connect() {}, disconnect() {this.disconnected = true;}};
      gains.push(gain); return gain;
    }
  }
  let draws = 0, resets = 0;
  const document = {hidden: false, querySelector: node, addEventListener: (type, fn) => documentEvents.set(type, fn), dispatchEvent: event => events.push(event)};
  const context = vm.createContext({AudioContext, CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}},
    document,
    window: {addEventListener: (type, fn) => windowEvents.set(type, fn)}, navigator: {clipboard: {writeText: async () => {}}},
  });
  vm.runInContext(source, context);
  const player = context.attachLesson({read: () => ({volume: 12}), code: () => 'matching code', render, draw: () => draws++, clear() {}, reset: () => resets++});
  return {node, player, sources, gains, contexts, events, document, documentEvents, windowEvents, draws: () => draws, resets: () => resets,
    click: id => node(id).handlers.get('click')()};
}
const pcm = () => ({left: new Float32Array(96000), right: new Float32Array(96000), sampleRate: 48000});
test('Stop/settings changes cancel a pending preview, including a later render completion', async () => {
  let resolve, entered;
  let ready = new Promise(done => {entered = done;});
  const s = setup(() => new Promise(done => {resolve = done; entered();}));
  const playing = s.click('#play');
  await ready;
  s.click('#stop'); resolve(pcm()); await playing;
  assert.equal(s.sources.length, 0); assert.equal(s.draws(), 0);
  ready = new Promise(done => {entered = done;});
  const again = s.click('#play'); await ready;
  s.player.update(); resolve(pcm()); await again;
  assert.equal(s.sources.length, 0); assert.equal(s.draws(), 0);
  assert.equal(s.node('#code').textContent, s.node('#lesson-source').textContent);
  assert.equal(s.events.at(-1).detail.id, 'lesson-source');
});
test('Replay/Stop/end/hidden/pagehide clean up audio, and Reset refreshes settings', async () => {
  const s = setup(async () => pcm());
  await s.click('#play'); assert.equal(s.sources[0].started, true);
  await s.click('#play'); assert.equal(s.sources[0].stopped, true);
  s.sources[0].onended(); assert.equal(s.sources[0].disconnected, true); assert.equal(s.gains[0].disconnected, true);
  assert.equal(s.node('#status').textContent, '2秒間再生しています。');
  s.sources[1].onended(); assert.equal(s.node('#status').textContent, '再生が終了しました。');
  await s.click('#play'); s.click('#reset'); assert.equal(s.sources[2].stopped, true); assert.equal(s.resets(), 1);
  await s.click('#play');
  s.document.hidden = true; s.documentEvents.get('visibilitychange')();
  assert.equal(s.sources[3].stopped, true);
  s.document.hidden = false;
  await s.click('#play');
  s.windowEvents.get('pagehide')();
  assert.equal(s.sources[4].stopped, true); assert.equal(s.contexts[0].closed, true);
});
