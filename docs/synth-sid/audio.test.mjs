import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {noteToHz} from '../js/soundchip_pitch.js';
import {sidFrequency} from '../js/sid.js';

const source = await readFile(new URL('./audio.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({resumeError = false, fetchFailure = false, failedModel, stalledFetch = false, ready = true, rate = 48000, fallbackRamp = false} = {}) {
  let createAudio, context, node, nextTimer = 0, mode = 'reply',codeSession=0;
  const timers = new Map(), errors = [], events = [], messages = [], fetchSignals = [],fetchUrls=[],moduleUrls=[],releases=[];
  class Context {
    constructor() {
      context = this; this.sampleRate = rate; this.state = 'suspended'; this.currentTime = 1; this.gains = [];
      this.destination = {}; this.listeners = new Map(); this.closeCount = 0; this.rejectResume = resumeError;
      this.audioWorklet = {addModule: async url => { events.push('module');moduleUrls.push(String(url)); }};
    }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    removeEventListener(name) { this.listeners.delete(name); }
    resume() { events.push('resume'); if (this.rejectResume) return Promise.reject(new Error('Resume denied')); this.state = 'running'; return Promise.resolve(); }
    async close() { this.closeCount++; this.state = 'closed'; this.listeners.get('statechange')?.(); }
    createGain() {
      const item = {connections: [], automation: [], gain: {value: 0,
        cancelScheduledValues: time => item.automation.push(['cancel', time]),
        setValueAtTime: (value, time) => item.automation.push(['set', value, time]),
        linearRampToValueAtTime(value, time) { this.value = value; item.automation.push(['ramp', value, time]); }},
        connect(value) { this.connections.push(value); }, disconnect() { this.connections = []; this.disconnected = true; }};
      if (!fallbackRamp) item.gain.cancelAndHoldAtTime = time => item.automation.push(['hold', time]);
      this.gains.push(item); return item;
    }
  }
  class Node {
    constructor(_context, name, options) {
      node = this; this.name = name; this.options = options; this.connections = []; this.disposed = 0;
      this.port = {postMessage: message => {
        messages.push(message);
        if (message.method === 'dispose') { this.disposed++; return; }
        if (mode === 'throw') throw new Error('Cannot clone');
        if (mode === 'drop') return;
        queueMicrotask(() => {
          if (mode === 'error') this.port.onmessage?.({data: {id: message.id, error: 'Invalid preset', name: 'RangeError'}});
          else this.port.onmessage?.({data: {id: message.id, value: message.method==='beginCode'
            ?{session:++codeSession,clock:985248,model:options.processorOptions.model,channels:3}
            :{method: message.method, args: message.args}}});
        });
      }, close() { this.closed = true; }};
      if (ready) queueMicrotask(() => this.port.onmessage?.({data: {ready: true}}));
    }
    connect(value) { this.connections.push(value); }
    disconnect() { this.disconnected = true; }
  }
  const transformed = source.replace(/^import .*;\n/gm,'').replaceAll('export ', '').replaceAll('import.meta.url', JSON.stringify(new URL('./audio.js', import.meta.url).href));
  const realm={
    AudioContext: Context, AudioWorkletNode: Node, URL, AbortController, DOMException,noteToHz,sidFrequency,
    fetch: async (url, options) => {
      events.push('fetch'); fetchSignals.push(options.signal);fetchUrls.push(String(url));
      if (stalledFetch) return new Promise(resolve => { releases.push(() => resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(0)})); });
      return fetchFailure||failedModel&&String(url).includes(failedModel==='8580'?'sid8580-endpoint':'/sid/sid.wasm') ? {ok: false, status: 503} : {ok: true, arrayBuffer: async () => new ArrayBuffer(0)};
    },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); }, provide: value => { createAudio = value; },
  };
  vm.runInNewContext(`${transformed}\nprovide(createAudio);`,realm);
  return {create: options => createAudio({onError: error => errors.push(error), ...options}),
    get context() { return context; }, get node() { return node; }, errors, timers, events, messages, fetchSignals,fetchUrls,moduleUrls,
    mode(value) { mode = value; },blockTimers(){realm.setTimeout=realm.clearTimeout=()=>{throw Error('user timer blocked');};},releaseFetch() { for(const release of releases.splice(0))release(); },
    expire() { const [id, timer] = timers.entries().next().value; assert.equal(timer.ms, 15000); timers.delete(id); timer.fn(); }};
}

test('SID audio stays lazy, resumes in the gesture and routes unity balance before the 0..380% user Master', async () => {
  const f = fixture(); assert.equal(f.context, undefined);
  const audio = await f.create({volume: .7}), [balance, fade, master] = f.context.gains;
  assert.equal(f.events[0], 'resume'); assert.equal(f.node.name, 'tetorica-sid-synth'); assert.equal(audio.sampleRate, 48000);
  assert.equal(balance.gain.value, 1); assert.equal(master.gain.value, .7); assert.equal(audio.outputNode, master);
  assert.equal(fade.gain.value,1);assert.equal(audio.codeInputNode,balance);assert.equal(audio.codeOutputNode,fade);assert.equal(audio.codeFadeNode,fade);
  assert.deepEqual(f.node.connections, [balance]); assert.deepEqual(balance.connections, [fade]);assert.deepEqual(fade.connections,[master]); assert.deepEqual(master.connections, [f.context.destination]);
  const monitor = {}; audio.outputNode.connect(monitor); assert.deepEqual(master.connections, [f.context.destination, monitor]);
  audio.setVolume(3.8); assert.equal(master.gain.value, 3.8); assert.equal(balance.gain.value, 1);
  audio.setVolume(0); assert.equal(master.gain.value, 0); assert.throws(() => audio.setVolume(3.81), /Master/);
  assert.equal((await audio.read()).method, 'read'); assert.equal(f.timers.size, 0);
  const closing = audio.dispose(); assert.equal(audio.dispose(), closing); await closing;
  assert.equal(f.context.closeCount, 1); assert.equal(f.node.disposed, 1); assert(f.node.port.closed); assert.equal(f.context.listeners.size, 0);
});

test('both model binaries are preloaded for same-context swaps and initial model is explicit',async()=>{
  for(const model of ['6581','8580']){
    const f=fixture(),audio=await f.create({model});
    assert.equal(f.node.options.processorOptions.model,model);
    assert(f.node.options.processorOptions.wasmBinary instanceof ArrayBuffer);
    assert(f.node.options.processorOptions.wasm8580Binary instanceof ArrayBuffer);
    assert.equal(f.fetchUrls.length,2);assert(f.fetchUrls.some(u=>u.endsWith('/generated/sid/sid.wasm')));assert(f.fetchUrls.some(u=>u.endsWith('/generated/sid8580-machine/sid8580-endpoint.wasm')));
    assert.equal(new Set(f.fetchSignals).size,1);await audio.dispose();
  }
  const invalid=fixture();await assert.rejects(invalid.create({model:'8581'}),/model/);assert.equal(invalid.context,undefined);
  const failed=fixture({failedModel:'8580'});await assert.rejects(failed.create(),/8580 WASM/);assert.equal(failed.context.state,'closed');assert.equal(failed.errors.length,1);assert(failed.fetchSignals.every(s=>s.aborted));
});

test('SID Master smoothing has a fallback for AudioParams without cancelAndHoldAtTime', async () => {
  const f = fixture({fallbackRamp: true}), audio = await f.create(); audio.setVolume(2);
  assert.deepEqual(f.context.gains[2].automation, [['cancel', 1], ['set', .7, 1], ['ramp', 2, 1.01]]); await audio.dispose();
});

test('SID command posts preserve FIFO preset contents and rejected edits keep the endpoint alive', async () => {
  const f = fixture(), audio = await f.create(), a = {voice: {waveform: 'saw'}}, b = {voice: {waveform: 'pulse'}};
  const begin = f.messages.length;
  const replies = await Promise.all([audio.command('loadPreset', [a]), audio.command('setPreset', [b]), audio.read()]);
  assert.deepEqual(f.messages.slice(begin).map(message => message.method), ['loadPreset', 'setPreset', 'read']);
  assert.equal(replies[0].args[0], a); assert.equal(replies[1].args[0], b);
  f.mode('error'); await assert.rejects(audio.command('setPreset', [{}]), {name: 'RangeError', message: 'Invalid preset'});
  f.mode('throw'); await assert.rejects(audio.read(), /Cannot clone/);
  await assert.rejects(audio.command('constructor'), /Unknown SID command/); await assert.rejects(audio.command('noteOn', {}), /arguments must be an array/);
  assert.equal(f.timers.size, 0); assert.equal(f.errors.length, 0); assert.equal(f.context.state, 'running');
  f.mode('reply'); assert.equal((await audio.read()).method, 'read'); await audio.dispose();
});

test('Code observation RPC stays passive and does not acquire or invalidate a physical Code client',async()=>{
  const f=fixture(),audio=await f.create();
  assert.equal((await audio.command('observeCode')).method,'observeCode');
  assert.equal(f.messages.some(message=>message.method==='beginCode'),false);
  const sid=await audio.getSidClient(),count=f.messages.length;f.blockTimers();
  await audio.command('observeCode');await sid.noteOn(0,'C4');
  assert.deepEqual(f.messages.slice(count).map(message=>message.method),['observeCode','code']);
  assert.equal(f.messages.filter(message=>message.method==='beginCode').length,1);
  await audio.dispose();
});

test('channel settings use the paired processor revision and preserve FIFO request data',async()=>{
  const f=fixture(),audio=await f.create(),setup={format:'tetorica-sid-channels',version:1,target:2,channels:[1,2,3]};
  assert(f.moduleUrls[0].endsWith('/processor.js?sid-channels=3&sid-waves=1&sid-keys=1&sid-code-live=1'));
  const begin=f.messages.length;
  const replies=await Promise.all([audio.command('loadChannelSettings',[setup]),audio.command('setChannelSettings',[setup]),audio.read()]);
  assert.deepEqual(f.messages.slice(begin).map(value=>value.method),['loadChannelSettings','setChannelSettings','read']);
  assert.equal(replies[0].args[0],setup);assert.equal(replies[1].args[0],setup);
  assert.equal(f.timers.size,0);await audio.dispose();
});

test('SID startup cancellation is silent before fetch, while loading and while awaiting readiness', async () => {
  const already = fixture(), aborted = new AbortController(); aborted.abort();
  await assert.rejects(already.create({signal: aborted.signal}), {name: 'AbortError'}); assert.equal(already.context, undefined);
  const loading = fixture({stalledFetch: true}), controller = new AbortController(), outcome = loading.create({signal: controller.signal});
  controller.abort(); await assert.rejects(outcome, {name: 'AbortError'}); loading.releaseFetch(); await flush();
  assert.equal(loading.node, undefined); assert.equal(loading.context.closeCount, 1); assert.equal(loading.errors.length, 0); assert.equal(loading.timers.size, 0); assert(loading.fetchSignals[0].aborted);
  const waiting = fixture({ready: false}), signal = new AbortController(), pending = waiting.create({signal: signal.signal}); await flush();
  assert(waiting.node); signal.abort(); await assert.rejects(pending, {name: 'AbortError'});
  assert(waiting.node.disconnected && waiting.node.port.closed); assert.equal(waiting.errors.length, 0); assert.equal(waiting.context.closeCount, 1); assert.equal(waiting.timers.size, 0);
  const ready = fixture(), lifetime = new AbortController(), audio = await ready.create({signal: lifetime.signal}); lifetime.abort();
  assert.equal(ready.context.state, 'running', 'the signal only owns startup, not subsequent explicit Stop commands'); await audio.dispose();
});

test('SID initialization failure and timeout close the old context so the UI can explicitly retry', async () => {
  for (const options of [{resumeError: true}, {fetchFailure: true}, {stalledFetch: true}, {ready: false}, {rate: 192000}]) {
    const f = fixture(options), outcome = Promise.allSettled([f.create()]);
    if (options.stalledFetch) f.expire(); else if (options.ready === false) { await flush(); f.expire(); }
    const [settled] = await outcome; assert.equal(settled.status, 'rejected'); assert.equal(f.context.state, 'closed');
    assert.equal(f.context.closeCount, 1); assert.equal(f.errors.length, 1); assert.equal(f.timers.size, 0);
  }
  const invalid = fixture(); await assert.rejects(invalid.create({volume: 4}), /Master/); assert.equal(invalid.context, undefined);
});

test('SID command deadlines and processor/reply/context failures reject pending calls once and disconnect sound', async () => {
  for (const trigger of ['deadline', 'processor', 'reply', 'fatal', 'context', 'resume']) {
    const f = fixture(), audio = await f.create(); f.mode('drop');
    const outcomes = Promise.allSettled([audio.read(), audio.command('stop')]);
    if (trigger === 'deadline') f.expire();
    else if (trigger === 'processor') f.node.onprocessorerror();
    else if (trigger === 'reply') f.node.port.onmessageerror();
    else if (trigger === 'fatal') f.node.port.onmessage({data: {fatal: true, error: 'Broken render'}});
    else if (trigger === 'context') await f.context.close();
    else { f.context.rejectResume = true; await assert.rejects(audio.resume(), /Resume denied/); }
    assert((await outcomes).every(result => result.status === 'rejected'));
    assert.equal(f.errors.length, 1); assert.equal(f.timers.size, 0); assert(f.node.disconnected && f.node.port.closed);
    await assert.rejects(audio.read()); await audio.dispose();
  }
});

test('Code clients address physical channels through one explicit session and validate notes before posting a gate',async()=>{
  const f=fixture(),audio=await f.create({model:'8580'}),a=audio.getSidClient(),b=audio.getSidClient();
  assert.equal(a,b);const sid=await a;assert.equal(sid,await audio.getSidClient());
  assert.equal(sid.clock,985248);assert.equal(sid.model,'8580');assert.equal(sid.channels,3);
  assert.equal(typeof sid.dispose,'function');assert.equal(sid.loadPreset,undefined);assert.equal(typeof sid.constructor,'function');
  f.blockTimers();
  await sid.noteOn(2,'A4');await sid.setFilter({mode:'notch',cutoff:900,routing:4});
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages.filter(m=>m.method==='code').map(m=>m.args))),[
    [1,'noteOn',[2,'A4']],[1,'setFilter',[{mode:'notch',cutoff:900,routing:4}]],
  ]);
  const before=f.messages.length;
  for(const args of [[3,'C4'],[0,'invalid'],[0,128],[0,127],[-1,60]])assert.throws(()=>sid.noteOn(...args),{name:'RangeError'});
  assert.equal(f.messages.length,before,'invalid notes never enter RPC or take loop ownership');
  await audio.command('stop');assert.throws(()=>sid.noteOn(0,'C4'),{name:'AbortError'});
  const fresh=await audio.getSidClient();assert.notEqual(fresh,sid);await fresh.noteOn(0,60);
  await audio.command('loadChannelSettings',[{}]);assert.throws(()=>fresh.keyOn(0),{name:'AbortError'});
  await audio.dispose();assert.equal(f.context.closeCount,1);
});

test('Stop and disposal reject late Code session or mutation ACKs without reviving old handles',async()=>{
  for(const operation of ['begin','note']){
    const f=fixture(),audio=await f.create();let sid;
    if(operation==='note')sid=await audio.getSidClient();
    f.mode('drop');
    const pending=operation==='begin'?audio.getSidClient():sid.noteOn(1,'E4');
    const rejected=assert.rejects(pending,{name:'AbortError'}),message=f.messages.at(-1);
    f.mode('reply');await audio.command('stop');
    f.node.port.onmessage({data:{id:message.id,value:operation==='begin'?{session:9,clock:985248,model:'6581'}:undefined}});
    await rejected;
    const fresh=await audio.getSidClient();await fresh.noteOff(1);
    await audio.dispose();assert.throws(()=>fresh.keyOn(1),/closed/);assert.equal(f.timers.size,0);
  }
});
