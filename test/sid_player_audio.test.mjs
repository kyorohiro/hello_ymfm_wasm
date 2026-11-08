import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../docs/sid-player/audio.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({stalledFetch = false, ready = true, fetchFailure = false} = {}) {
  let createAudio, context, node, nextTimer = 0, mode = 'reply';
  const timers = new Map(), errors = [], events = [], messages = [], fetches = [], releases = [];
  class Context {
    constructor() {
      context = this; this.sampleRate = 48000; this.state = 'suspended'; this.currentTime = 1;
      this.gains = []; this.destination = {}; this.listeners = new Map(); this.closeCount = 0;
      this.audioWorklet = {addModule: async () => {events.push('module');}};
    }
    addEventListener(name, listener) {this.listeners.set(name, listener);}
    removeEventListener(name) {this.listeners.delete(name);}
    resume() {events.push('resume'); this.state = 'running'; return Promise.resolve();}
    async close() {this.closeCount++; this.state = 'closed'; this.listeners.get('statechange')?.();}
    createGain() {
      const node = {connections: [], automation: [], gain: {value: 0,
        cancelAndHoldAtTime: time => node.automation.push(['hold', time]),
        linearRampToValueAtTime(value, time) {this.value = value; node.automation.push(['ramp', value, time]);}},
        connect(value) {this.connections.push(value);}, disconnect() {this.connections = []; this.disconnected = true;}};
      this.gains.push(node); return node;
    }
  }
  class Node {
    constructor(_context, name, options) {
      node = this; this.name = name; this.options = options; this.connections = []; this.disposed = 0;
      this.port = {postMessage: message => {
        messages.push(message);
        if (message.method === 'dispose') {this.disposed++; return;}
        if (mode === 'drop') return;
        queueMicrotask(() => this.port.onmessage?.({data: {id: message.id, value: {method: message.method, args: message.args}}}));
      }, close() {this.closed = true;}};
      if (ready) queueMicrotask(() => this.port.onmessage?.({data: {ready: true}}));
    }
    connect(value) {this.connections.push(value);}
    disconnect() {this.disconnected = true;}
  }
  const transformed = source.replaceAll('export ', '').replaceAll('import.meta.url', JSON.stringify(new URL('../docs/sid-player/audio.js', import.meta.url).href));
  vm.runInNewContext(`${transformed}\nprovide(createAudio);`, {
    AudioContext: Context, AudioWorkletNode: Node, URL, AbortController, DOMException,
    fetch: async (url, {signal}) => {
      events.push('fetch'); const path = String(url); fetches.push({path, signal});
      const reply = {ok: true, arrayBuffer: async () => Uint8Array.of(path.includes('endpoint') ? 1 : path.includes('sid8580-machine.wasm') ? 2 : 3).buffer};
      if (stalledFetch) return new Promise(resolve => {releases.push(() => resolve(reply));});
      return fetchFailure === true || typeof fetchFailure === 'string' && path.endsWith(fetchFailure) ? {ok: false, status: 503} : reply;
    },
    setTimeout(fn, ms) {const id = ++nextTimer; timers.set(id, {fn, ms}); return id;},
    clearTimeout(id) {timers.delete(id);}, provide: value => {createAudio = value;},
  });
  return {create: options => createAudio({onError: error => errors.push(error), ...options}),
    get context() {return context;}, get node() {return node;}, errors, timers, events, messages, fetches,
    mode(value) {mode = value;}, releaseFetch() {for (const release of releases.splice(0)) release();},
    expire() {const [id, timer] = timers.entries().next().value; assert.equal(timer.ms, 15000); timers.delete(id); timer.fn();}};
}

test('SID player audio resumes before assets and has one unity-balanced post-Master physical path', async () => {
  const f = fixture(); assert.equal(f.context, undefined);
  const audio = await f.create({volume: .7}), [balance, master] = f.context.gains;
  assert.equal(f.events[0], 'resume'); assert.equal(f.node.name, 'tetorica-sid-player');
  assert.equal(balance.gain.value, 1); assert.equal(master.gain.value, .7); assert.equal(audio.outputNode, master);
  assert.deepEqual(f.node.connections, [balance]); assert.deepEqual(balance.connections, [master]); assert.deepEqual(master.connections, [f.context.destination]);
  audio.setVolume(3.8); assert.equal(master.gain.value, 3.8); assert.equal(balance.gain.value, 1);
  assert.throws(() => audio.setVolume(3.81), /Master/);
  const closing = audio.dispose(); assert.equal(audio.dispose(), closing); await closing;
  assert.equal(f.context.closeCount, 1); assert.equal(f.node.disposed, 1); assert(f.node.port.closed);
});

test('each SID backend fetches only its matching WASM and 8580 passes two distinct modules', async () => {
  for (const backend of ['psid', 'psid-cia', 'psid-vbi', 'rsid', '8580']) {
    const f = fixture(), audio = await f.create({backend});
    assert.equal(f.events[0], 'resume'); assert.equal(f.node.options.processorOptions.backend, backend);
    if (backend === '8580') {
      assert.deepEqual(f.fetches.map(item => new URL(item.path).pathname.split('/').slice(-2).join('/')),
        ['sid8580-machine/sid8580-endpoint.wasm', 'sid8580-machine/sid8580-machine.wasm']);
      assert.deepEqual([...new Uint8Array(f.node.options.processorOptions.endpointBinary)], [1]);
      assert.deepEqual([...new Uint8Array(f.node.options.processorOptions.machineBinary)], [2]);
      assert.equal(f.node.options.processorOptions.wasmBinary, undefined);
    } else {
      assert.equal(f.fetches.length, 1);
      assert(f.fetches[0].path.endsWith(backend === 'psid' ? '/sid-player/sid-player.wasm' : '/sid-rsid/sid-rsid.wasm'));
      assert.deepEqual([...new Uint8Array(f.node.options.processorOptions.wasmBinary)], [3]);
      assert.equal(f.node.options.processorOptions.endpointBinary, undefined);
    }
    await audio.dispose();
  }
});

test('8580 startup cancellation and a failed second WASM close audio and fence both fetches', async () => {
  const f = fixture({stalledFetch: true}), controller = new AbortController(), pending = f.create({backend: '8580', signal: controller.signal});
  assert.equal(f.fetches.length, 2); controller.abort(); await assert.rejects(pending, {name: 'AbortError'});
  assert(f.fetches.every(item => item.signal.aborted)); f.releaseFetch(); await flush();
  assert.equal(f.node, undefined); assert.equal(f.context.closeCount, 1); assert.equal(f.timers.size, 0); assert.equal(f.errors.length, 0);
  const failed = fixture({fetchFailure: 'sid8580-machine.wasm'});
  await assert.rejects(failed.create({backend: '8580'}), /503/);
  assert.equal(failed.fetches.length, 2); assert(failed.fetches.every(item => item.signal.aborted));
  assert.equal(failed.node, undefined); assert.equal(failed.context.state, 'closed'); assert.equal(failed.errors.length, 1);
});

test('SID player startup Abort rejects silently and prevents late fetch/readiness from creating playback', async () => {
  for (const options of [{stalledFetch: true}, {ready: false}]) {
    const f = fixture(options), controller = new AbortController(), pending = f.create({signal: controller.signal});
    if (options.ready === false) {await flush(); assert(f.node);}
    controller.abort(); await assert.rejects(pending, {name: 'AbortError'}); f.releaseFetch(); await flush();
    assert.equal(f.context.state, 'closed'); assert.equal(f.context.closeCount, 1); assert.equal(f.errors.length, 0); assert.equal(f.timers.size, 0);
    if (options.stalledFetch) assert.equal(f.node, undefined);
    else assert(f.node.disconnected && f.node.port.closed);
  }
});

test('SID player RPC preserves load/start FIFO and explicit disposal rejects a pending start', async () => {
  const f = fixture(), controller = new AbortController(), audio = await f.create({signal: controller.signal});
  controller.abort(); assert.equal(f.context.state, 'running', 'startup signal no longer owns the returned engine; UI Stop must dispose it');
  const bytes = Uint8Array.of(1, 2, 3), replies = await Promise.all([audio.command('load', [bytes, {subtune: 2}]), audio.command('start'), audio.read()]);
  assert.deepEqual(f.messages.map(message => message.method), ['load', 'start', 'read']); assert.equal(replies[0].args[0], bytes);
  await assert.rejects(audio.command('constructor'), /Unknown/); await assert.rejects(audio.command('start', {}), /arguments/);
  f.mode('drop'); const pending = audio.command('start'); const rejected = assert.rejects(pending, /disposed/);
  await audio.dispose(); await rejected;
  assert.equal(f.timers.size, 0); assert.equal(f.errors.length, 0); assert.equal(f.context.closeCount, 1);
});

test('Pause/Resume use the same owned Worklet and Master never changes transport commands',async()=>{
  const f=fixture(),audio=await f.create({volume:.7});
  await audio.command('load',[Uint8Array.of(1),{}]);await audio.command('start');
  const paused=await audio.command('pause');assert.equal(paused.method,'pause');
  const gains=f.context.gains.slice(),node=f.node;
  audio.setVolume(3.8);assert.equal(f.context.gains[1].gain.value,3.8);
  assert.deepEqual(f.messages.map(message=>message.method),['load','start','pause'],'Master cannot restart paused playback');
  await audio.resume();const resumed=await audio.command('resume');assert.equal(resumed.method,'resume');
  assert.equal(f.node,node);assert.deepEqual(f.context.gains,gains);assert.equal(f.context.closeCount,0);
  await assert.rejects(audio.command('pause',{}),/arguments/);assert.equal(f.messages.length,4);
  f.mode('drop');const pending=audio.command('pause'),rejected=assert.rejects(pending,/disposed/);
  await audio.dispose();await rejected;assert.equal(f.node.disposed,1);assert.equal(f.context.closeCount,1);
});

test('SID player deadlines and fatal processor failure retire sound and reject every pending RPC once', async () => {
  for (const trigger of ['deadline', 'processor', 'fatal']) {
    const f = fixture(), audio = await f.create(); f.mode('drop');
    const outcomes = Promise.allSettled([audio.command('start'), audio.read()]);
    if (trigger === 'deadline') f.expire();
    else if (trigger === 'processor') f.node.onprocessorerror();
    else f.node.port.onmessage({data: {fatal: true, error: 'CPU fault'}});
    assert((await outcomes).every(outcome => outcome.status === 'rejected'));
    assert.equal(f.errors.length, 1); assert.equal(f.timers.size, 0); assert.equal(f.context.state, 'closed');
    assert(f.node.disconnected && f.node.port.closed); await assert.rejects(audio.read()); await audio.dispose();
  }
});
