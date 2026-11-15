import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createNesCodeClient,nesCodeCancelled} from './code_endpoint.js';

const source = await readFile(new URL('./audio.js', import.meta.url), 'utf8');

function fixture({resumeError = false, fetchFailure = false, stalledFetch = false} = {}) {
  let createAudio, context, node, timerId = 0, mode = 'reply',session=0;
  const timers = new Map(), errors = [], events = [],requests=[];
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
        connect(value){if (!this.connections.includes(value)) this.connections.push(value);},
        disconnect(value){
          if (value === undefined) {this.connections = []; this.disconnected = true; return;}
          const index = this.connections.indexOf(value);
          if (index < 0) throw new Error('Missing audio edge');
          this.connections.splice(index, 1);
        }};
      this.gains.push(item); return item;
    }
  }
  class Node {
    constructor() {
      node = this; this.connections = []; this.disposed = 0;
      this.port = {postMessage:message => {
        requests.push(message);
        if (message.method === 'dispose') { this.disposed++; return; }
        if (mode === 'throw') throw new Error('Cannot clone');
        if (mode === 'drop') return;
        queueMicrotask(() => this.port.onmessage?.({data:{id:message.id,
          ...(mode === 'error' ? {error:'Invalid preset', name:'RangeError'} : {value:message.method === 'read' ? {voices:[]} : message.method==='beginCode'?{session:++session,channels:6,clock:1789772.7272727273}:true})}}));
      }, close(){this.closed = true;}};
      queueMicrotask(() => this.port.onmessage?.({data:{ready:true}}));
    }
    connect(value) { this.connections.push(value); }
    disconnect() { this.disconnected = true; }
  }
  const transformed = source.replace(/^import .*;\n/gm,'').replaceAll('export ', '').replaceAll('import.meta.url', JSON.stringify(new URL('./audio.js', import.meta.url).href));
  vm.runInNewContext(`${transformed}\nprovide(createAudio);`, {
    AudioContext:Context, AudioWorkletNode:Node, URL, AbortController,createNesCodeClient,nesCodeCancelled,
    fetch:async () => { events.push('fetch'); if (stalledFetch) return new Promise(() => {}); if (fetchFailure) return {ok:false,status:503}; return {ok:true,arrayBuffer:async () => new ArrayBuffer(0)}; },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); }, provide:value => { createAudio = value; },
  });
  return {create:options => createAudio({onError:error => errors.push(error), ...options}),
    get context(){return context;}, get node(){return node;}, errors, timers, events,requests,
    mode(value){mode = value;}, expire(){const [id, timer] = timers.entries().next().value; assert.equal(timer.ms,15000);timers.delete(id);timer.fn();}};
}

test('NES + FDS audio is lazy and routes one fixed balance before the user Master and final monitor node', async () => {
  const f = fixture(); assert.equal(f.context,undefined);
  const audio = await f.create({volume:.7});
  assert.equal(f.events[0],'resume'); assert.equal(f.timers.size,0);
  const [balance, master,codeFade,songInput] = f.context.gains;
  assert.equal(balance.gain.value,1); assert.equal(master.gain.value,.7);
  assert.equal(audio.outputNode,master);
  assert.deepEqual(f.node.connections,[balance]); assert.deepEqual(balance.connections,[codeFade]);assert.deepEqual(codeFade.connections,[master]);assert.deepEqual(songInput.connections,[master]); assert.deepEqual(master.connections,[f.context.destination]);
  audio.setVolume(3.8); assert.equal(master.gain.value,3.8); assert.equal(balance.gain.value,1);
  audio.setVolume(0); assert.equal(master.gain.value,0);
  assert.throws(() => audio.setVolume(3.81),/Master/);
  assert.deepEqual(await audio.read(),{voices:[]});
  const first = audio.dispose(); assert.equal(audio.dispose(),first); await first;
  assert.equal(f.context.closeCount,1); assert.equal(f.node.disposed,1); assert.equal(f.timers.size,0);
});

test('borrowed NES clients reuse the one Worklet and edits preserve Code while stale Stop cannot end a newer session',async()=>{
  const f=fixture(),audio=await f.create();
  const client=await audio.getNesClient();assert.equal(client,await audio.prepareCode());
  assert.equal(f.requests.filter(r=>r.method==='beginCode').length,1);
  await client.noteOn(0,'C4');await audio.command('setPreset',[{}]);await client.pulse.noteOn(1,'E4');
  await audio.stopCode(client);assert.throws(()=>client.noteOff(0),{name:'AbortError'});
  const newer=await audio.getNesClient();assert.notEqual(newer,client);
  const before=f.requests.length;assert.equal(await audio.stopCode(client),false);assert.equal(f.requests.length,before);
  await newer.triangle.noteOn('G3');assert.equal(f.context.gains.length,4);assert.equal(f.context.closeCount,0);
  assert.equal(audio.codeInputNode,f.context.gains[0]);assert.equal(audio.codeFadeNode,f.context.gains[2]);assert.equal(audio.songInputNode,f.context.gains[3]);
  await audio.dispose();assert.throws(()=>newer.noteOn(0,60),{name:'AbortError'});
});

test('Stop fences a pending client acquisition before a later Run may begin',async()=>{
  const f=fixture(),audio=await f.create();f.mode('drop');
  const old=audio.getNesClient(),cancelled=assert.rejects(old,{name:'AbortError'}),begin=f.requests.at(-1);
  const stopping=audio.stopCode(),newer=audio.getNesClient();
  assert.equal(f.requests.filter(r=>r.method==='beginCode').length,1);
  f.mode('reply');f.node.port.onmessage({data:{id:begin.id,value:{session:99,channels:6,clock:1789772.7272727273}}});
  await cancelled;await stopping;const client=await newer;
  assert.equal(f.requests.filter(r=>r.method==='beginCode').length,2);await client.noteOn(0,'C4');await audio.dispose();
});

test('the final Master bus can route to a desktop tap while retaining passive monitors and the same engine', async () => {
  const f = fixture(), audio = await f.create({volume:.7});
  const [balance, master,codeFade,songInput] = f.context.gains, monitor = {}, desktopTap = {};
  master.connect(monitor);
  audio.outputNode.disconnect(audio.context.destination);
  audio.outputNode.connect(desktopTap);
  assert.deepEqual(master.connections,[monitor, desktopTap]);
  assert.deepEqual(f.node.connections,[balance]); assert.deepEqual(balance.connections,[codeFade]);assert.deepEqual(codeFade.connections,[master]);assert.deepEqual(songInput.connections,[master]);
  audio.setVolume(3.8); assert.equal(master.gain.value,3.8);
  await audio.command('stop'); await audio.command('setPitch',[0]);
  audio.outputNode.disconnect(desktopTap); audio.outputNode.connect(audio.context.destination);
  assert.deepEqual(master.connections,[monitor, audio.context.destination]);
  assert.equal(f.context.closeCount,0); assert.equal(f.node.disposed,0);
  await audio.dispose(); assert.equal(f.context.closeCount,1);
});

test('Rejected edits and uncloneable messages clear deadlines without destroying NES + FDS audio', async () => {
  const f = fixture(), audio = await f.create();
  f.mode('error'); await assert.rejects(audio.command('loadPreset',[{}]),{name:'RangeError',message:'Invalid preset'});
  f.mode('throw'); await assert.rejects(audio.read(),/Cannot clone/);
  await assert.rejects(audio.command('constructor'),/Unknown NES \+ FDS command/);
  await assert.rejects(audio.command('noteOn',{}),/arguments must be an array/);
  assert.equal(f.timers.size,0); assert.equal(f.errors.length,0); assert.equal(f.context.state,'running');
  await audio.dispose();
});

test('A stalled NES + FDS command rejects all pending calls and tears down the old context for explicit retry', async () => {
  const f = fixture(), audio = await f.create(); f.mode('drop');
  const result = Promise.allSettled([audio.read(), audio.command('stop')]);
  assert.equal(f.timers.size,2); f.expire();
  const settled = await result;
  assert(settled.every(item => item.status === 'rejected' && /timed out/.test(item.reason.message)));
  assert.equal(f.errors.length,1); assert.equal(f.timers.size,0); assert.equal(f.context.state,'closed'); assert(f.node.disconnected);
  await assert.rejects(audio.read(),/Enable audio to restart/);
});

test('NES + FDS processor failure, unreadable replies and external context closure reject pending operations once', async () => {
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

test('NES + FDS initialization failures and stalled loading release contexts and clear startup deadlines', async () => {
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
