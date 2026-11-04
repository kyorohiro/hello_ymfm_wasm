import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./audio.js', import.meta.url), 'utf8');

function fixture({resumeError = false, fetchFailure = false, stalledFetch = false} = {}) {
  let createAudio, context, node, timerId = 0, mode = 'reply';
  const timers = new Map(), errors = [], events = [];
  class Context {
    constructor() {
      context = this; this.state = 'suspended'; this.currentTime = 1; this.gains = [];
      this.destination = {}; this.listeners = new Map(); this.closeCount = 0;
      this.audioWorklet = {addModule:async () => { events.push('module'); }};
    }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    removeEventListener(name) { this.listeners.delete(name); }
    resume() { events.push('resume'); if (resumeError) return Promise.reject(new Error('Resume denied')); this.state = 'running'; return Promise.resolve(); }
    async close() { this.closeCount++; this.state = 'closed'; this.listeners.get('statechange')?.(); }
    createGain() {
      const item = {connections:[], gain:{value:0, cancelAndHoldAtTime(){}, linearRampToValueAtTime(value){this.value = value;}},
        connect(value){this.connections.push(value);}, disconnect(){this.disconnected = true;}};
      this.gains.push(item); return item;
    }
  }
  class Node {
    constructor() {
      node = this; this.connections = []; this.disposed = 0;
      this.port = {postMessage:message => {
        if (message.method === 'dispose') { this.disposed++; return; }
        if (mode === 'throw') throw new Error('Cannot clone');
        if (mode === 'drop') return;
        queueMicrotask(() => this.port.onmessage?.({data:{id:message.id,
          ...(mode === 'error' ? {error:'Invalid preset', name:'RangeError'} : {value:message.method === 'read' ? {voices:[]} : true})}}));
      }, close(){this.closed = true;}};
      queueMicrotask(() => this.port.onmessage?.({data:{ready:true}}));
    }
    connect(value) { this.connections.push(value); }
    disconnect() { this.disconnected = true; }
  }
  const transformed = source.replaceAll('export ', '').replaceAll('import.meta.url', JSON.stringify(new URL('./audio.js', import.meta.url).href));
  vm.runInNewContext(`${transformed}\nprovide(createAudio);`, {
    AudioContext:Context, AudioWorkletNode:Node, URL, AbortController,
    fetch:async () => { events.push('fetch'); if (stalledFetch) return new Promise(() => {}); if (fetchFailure) return {ok:false,status:503}; return {ok:true,arrayBuffer:async () => new ArrayBuffer(0)}; },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); }, provide:value => { createAudio = value; },
  });
  return {create:options => createAudio({onError:error => errors.push(error), ...options}),
    get context(){return context;}, get node(){return node;}, errors, timers, events,
    mode(value){mode = value;}, expire(){const [id, timer] = timers.entries().next().value; assert.equal(timer.ms,15000);timers.delete(id);timer.fn();}};
}

test('Game Boy audio is lazy and routes one fixed balance before the user Master and final monitor node', async () => {
  const f = fixture(); assert.equal(f.context,undefined);
  const audio = await f.create({volume:.7});
  assert.equal(f.events[0],'resume'); assert.equal(f.timers.size,0);
  const [balance, master] = f.context.gains;
  assert.equal(balance.gain.value,.28); assert.equal(master.gain.value,.7);
  assert.equal(audio.outputNode,master);
  assert.deepEqual(f.node.connections,[balance]); assert.deepEqual(balance.connections,[master]); assert.deepEqual(master.connections,[f.context.destination]);
  audio.setVolume(3.8); assert.equal(master.gain.value,3.8); assert.equal(balance.gain.value,.28);
  audio.setVolume(0); assert.equal(master.gain.value,0);
  assert.throws(() => audio.setVolume(3.81),/Master/);
  assert.deepEqual(await audio.read(),{voices:[]});
  const first = audio.dispose(); assert.equal(audio.dispose(),first); await first;
  assert.equal(f.context.closeCount,1); assert.equal(f.node.disposed,1); assert.equal(f.timers.size,0);
});

test('Rejected edits and uncloneable messages clear deadlines without destroying Game Boy audio', async () => {
  const f = fixture(), audio = await f.create();
  f.mode('error'); await assert.rejects(audio.command('loadPreset',[{}]),{name:'RangeError',message:'Invalid preset'});
  f.mode('throw'); await assert.rejects(audio.read(),/Cannot clone/);
  await assert.rejects(audio.command('constructor'),/Unknown Game Boy command/);
  await assert.rejects(audio.command('noteOn',{}),/arguments must be an array/);
  assert.equal(f.timers.size,0); assert.equal(f.errors.length,0); assert.equal(f.context.state,'running');
  await audio.dispose();
});

test('A stalled Game Boy command rejects all pending calls and tears down the old context for explicit retry', async () => {
  const f = fixture(), audio = await f.create(); f.mode('drop');
  const result = Promise.allSettled([audio.read(), audio.command('stop')]);
  assert.equal(f.timers.size,2); f.expire();
  const settled = await result;
  assert(settled.every(item => item.status === 'rejected' && /timed out/.test(item.reason.message)));
  assert.equal(f.errors.length,1); assert.equal(f.timers.size,0); assert.equal(f.context.state,'closed'); assert(f.node.disconnected);
  await assert.rejects(audio.read(),/Enable audio to restart/);
});

test('Game Boy processor failure, unreadable replies and external context closure reject pending operations once', async () => {
  for (const trigger of ['processor','reply','context']) {
    const f = fixture(), audio = await f.create(); f.mode('drop');
    const result = Promise.allSettled([audio.read()]);
    if (trigger === 'processor') f.node.onprocessorerror();
    else if (trigger === 'reply') f.node.port.onmessageerror();
    else await f.context.close();
    const [settled] = await result;
    assert.equal(settled.status,'rejected'); assert.equal(f.errors.length,1); assert.equal(f.timers.size,0); assert(f.node.disconnected);
    await audio.dispose();
  }
});

test('Game Boy initialization failures and stalled loading release contexts and clear startup deadlines', async () => {
  for (const options of [{resumeError:true},{fetchFailure:true},{stalledFetch:true}]) {
    const f = fixture(options), outcome = Promise.allSettled([f.create()]);
    if (options.stalledFetch) f.expire();
    const [settled] = await outcome;
    assert.equal(settled.status,'rejected'); assert.equal(f.context.state,'closed'); assert.equal(f.context.closeCount,1);
    assert.equal(f.errors.length,1); assert.equal(f.timers.size,0);
    assert.match(settled.reason.message,options.resumeError ? /Resume denied/ : options.fetchFailure ? /HTTP 503/ : /initialization timed out/);
  }
  const invalid = fixture(); await assert.rejects(invalid.create({volume:4}),/Master/); assert.equal(invalid.context,undefined);
});
