import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createGameboyCodeClient,gameboyCodeCancelled} from './code_endpoint.js';
import {createDefaultPreset,readPreset} from './preset.js';
import {readGameboyCodeEdit} from './code_parameter_edit.js';

const source = await readFile(new URL('./audio.js', import.meta.url), 'utf8');

function fixture({resumeError = false, fetchFailure = false, stalledFetch = false} = {}) {
  let createAudio, context, node, timerId = 0, mode = 'reply', codeSession = 0;
  const timers = new Map(), errors = [], events = [], messages = [], releases = [];
  class Context {
    constructor() {
      context = this; this.sampleRate = 48000; this.state = 'suspended'; this.currentTime = 1; this.gains = [];
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
        messages.push(message);
        if (message.method === 'dispose') { this.disposed++; return; }
        if (mode === 'throw') throw new Error('Cannot clone');
        if (mode === 'drop') return;
        const replyingMode = mode;
        const reply = () => queueMicrotask(() => this.port.onmessage?.({data:{id:message.id,
          ...(replyingMode === 'error' ? {error:'Invalid preset', name:'RangeError'} : {value:message.method === 'read' ? {voices:[]}
            : message.method === 'beginCode' ? {session:++codeSession,clock:4194304,channels:4,editorSource:'pulse'}
              : message.method === 'code' ? {method:message.args[1],args:message.args[2]} : true})}}));
        if (mode === 'hold') releases.push(reply); else reply();
      }, close(){this.closed = true;}};
      queueMicrotask(() => this.port.onmessage?.({data:{ready:true}}));
    }
    connect(value) { this.connections.push(value); }
    disconnect() { this.disconnected = true; }
  }
  const transformed = source.replace(/^import .*;\n/gm,'').replaceAll('export ', '').replaceAll('import.meta.url', JSON.stringify(new URL('./audio.js', import.meta.url).href));
  const realm = {
    AudioContext:Context, AudioWorkletNode:Node, URL, AbortController, DOMException, createGameboyCodeClient, gameboyCodeCancelled, readPreset, readGameboyCodeEdit,
    fetch:async () => { events.push('fetch'); if (stalledFetch) return new Promise(() => {}); if (fetchFailure) return {ok:false,status:503}; return {ok:true,arrayBuffer:async () => new ArrayBuffer(0)}; },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, ms}); return id; },
    clearTimeout(id) { timers.delete(id); }, provide:value => { createAudio = value; },
  };
  vm.runInNewContext(`${transformed}\nprovide(createAudio);`,realm);
  return {create:options => createAudio({onError:error => errors.push(error), ...options}),
    get context(){return context;}, get node(){return node;}, errors, timers, events, messages,
    release(){for (const reply of releases.splice(0)) reply();},
    blockTimers(){realm.setTimeout=realm.clearTimeout=()=>{throw new Error('Edited timer');};},
    mode(value){mode = value;}, expire(){const [id, timer] = timers.entries().next().value; assert.equal(timer.ms,15000);timers.delete(id);timer.fn();}};
}

test('Game Boy audio is lazy and routes one fixed balance before the user Master and final monitor node', async () => {
  const f = fixture(); assert.equal(f.context,undefined);
  const audio = await f.create({volume:.7});
  assert.equal(f.events[0],'resume'); assert.equal(f.timers.size,0);
  const [balance, fade, master] = f.context.gains;
  assert.equal(balance.gain.value,.28); assert.equal(master.gain.value,.7);
  assert.equal(audio.outputNode,master);
  assert.equal(fade.gain.value,1); assert.equal(audio.codeInputNode,balance); assert.equal(audio.codeOutputNode,fade); assert.equal(audio.codeFadeNode,fade);
  assert.deepEqual(f.node.connections,[balance]); assert.deepEqual(balance.connections,[fade]); assert.deepEqual(fade.connections,[master]); assert.deepEqual(master.connections,[f.context.destination]);
  assert.equal(audio.songInputNode.gain.value,.28);
  assert.deepEqual(audio.songInputNode.connections,[master],'VGM has the same single Master without Code FX/fade');
  audio.setVolume(3.8); assert.equal(master.gain.value,3.8); assert.equal(balance.gain.value,.28);
  audio.setVolume(0); assert.equal(master.gain.value,0);
  assert.throws(() => audio.setVolume(3.81),/Master/);
  assert.deepEqual(await audio.read(),{voices:[]});
  const first = audio.dispose(); assert.equal(audio.dispose(),first); await first;
  assert.equal(f.context.closeCount,1); assert.equal(f.node.disposed,1); assert.equal(f.timers.size,0);
  assert.equal(audio.songInputNode.disconnected,true);
});

test('the final Master bus can route to a desktop tap while retaining passive monitors and the same engine', async () => {
  const f = fixture(), audio = await f.create({volume:.7});
  const [balance, fade, master] = f.context.gains, monitor = {}, desktopTap = {};
  master.connect(monitor);
  audio.outputNode.disconnect(audio.context.destination);
  audio.outputNode.connect(desktopTap);
  assert.deepEqual(master.connections,[monitor, desktopTap]);
  assert.deepEqual(f.node.connections,[balance]); assert.deepEqual(balance.connections,[fade]); assert.deepEqual(fade.connections,[master]);
  audio.setVolume(3.8); assert.equal(master.gain.value,3.8);
  await audio.command('stop'); await audio.command('setPitch',[0]);
  audio.outputNode.disconnect(desktopTap); audio.outputNode.connect(audio.context.destination);
  assert.deepEqual(master.connections,[monitor, audio.context.destination]);
  assert.equal(f.context.closeCount,0); assert.equal(f.node.disposed,0);
  await audio.dispose(); assert.equal(f.context.closeCount,1);
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

test('Code acquisition is cached, nested APIs use the same engine RPC and invalid channels cannot claim a Gate', async () => {
  const f = fixture(), audio = await f.create();
  const first = audio.getGameboyClient(); assert.equal(audio.getGameboyClient(),first);
  const client = await first;
  assert.equal(client.chip,'gameboy'); assert.equal(client.clock,4194304); assert.equal(client.channels,4); assert(client.isCurrent());
  await client.pulse.setVoice(0,{duty:.25,volume:7});
  await client.pulse.noteOn(1,'C4'); await client.wave.noteOn('G3'); await client.noise.keyOn();
  await client.getState(); await client.setClock(4194304);
  const methodPaths = f.messages.filter(message => message.method === 'code').map(message => message.args[1]);
  assert.deepEqual(methodPaths,['pulse.setVoice','pulse.noteOn','wave.noteOn','noise.keyOn','getState','setClock']);
  assert.equal(f.messages.filter(message => message.method === 'beginCode').length,1);
  const count = f.messages.length;
  for (const invoke of [() => client.pulse.noteOn(2,'C4'),() => client.noteOn(3,'C4'),() => client.noteOn(0,'C0'),
    () => client.setClock(1),() => client.wave.keyOn(2)]) assert.throws(invoke);
  assert.equal(f.messages.length,count); assert.equal(f.context.gains.length,4); assert.equal(f.context.closeCount,0);
  await audio.dispose(); assert(!client.isCurrent()); assert.throws(() => client.keyOn(0),{name:'AbortError'});
});

test('Stop invalidates pending nested calls immediately, rejects late replies, and a fresh lease cannot be closed by the old client', async () => {
  const f = fixture(), audio = await f.create(), old = await audio.getGameboyClient();
  f.mode('hold'); const pending = old.pulse.noteOn(0,'C4');
  f.mode('reply'); const stopping = audio.command('stop');
  assert(!old.isCurrent()); assert.throws(() => old.wave.keyOn(),{name:'AbortError'});
  await stopping;
  const current = await audio.getGameboyClient(); assert(current.isCurrent());
  f.release(); await assert.rejects(pending,{name:'AbortError'});
  assert.throws(() => old.dispose(),{name:'AbortError'}); assert(current.isCurrent());
  await current.noise.keyOn(); assert.equal(f.context.closeCount,0); await audio.dispose();
});

test('disposing a borrowed client leaves the context alive, permits another lease and keeps rejected preset edits non-destructive', async () => {
  const f = fixture(), audio = await f.create(), client = await audio.getGameboyClient();
  f.mode('error'); await assert.rejects(audio.command('setPreset',[{}]),/Invalid preset/); assert(client.isCurrent());
  f.mode('reply'); await client.wave.keyOn();
  const disposed = client.dispose(); assert.equal(client.dispose(),disposed); assert(!client.isCurrent());
  await disposed; assert.equal(f.node.disposed,0); assert.equal(f.context.closeCount,0);
  const next = await audio.getGameboyClient(); assert(next.isCurrent()); await next.noise.keyOn();
  await audio.command('loadPreset',[{}]); assert(!next.isCurrent());
  await audio.dispose();
});

test('a released audition lease may reopen only its own neutral output, never a newer lease or Stop', async () => {
  const f=fixture(),audio=await f.create(),old=await audio.getGameboyClient();
  assert.equal(old.ownsOutput(),true);
  await old.dispose();assert.equal(old.isCurrent(),false);assert.equal(old.ownsOutput(),true);
  const fresh=await audio.getGameboyClient();assert.equal(old.ownsOutput(),false);assert.equal(fresh.ownsOutput(),true);
  await fresh.dispose();assert.equal(fresh.ownsOutput(),true);assert.equal(old.ownsOutput(),false);
  await audio.command('stop');assert.equal(fresh.ownsOutput(),false);
  await audio.dispose();assert.equal(old.ownsOutput(),false);assert.equal(fresh.ownsOutput(),false);
});

test('startup AbortSignal closes pending audio silently and trusted command deadlines survive edited global timers', async () => {
  const loading = fixture({stalledFetch:true}), controller = new AbortController();
  const pending = loading.create({signal:controller.signal}); controller.abort();
  await assert.rejects(pending,{name:'AbortError'}); assert.equal(loading.context.state,'closed');
  assert.equal(loading.errors.length,0); assert.equal(loading.timers.size,0);
  const f = fixture(), audio = await f.create(); f.blockTimers();
  const client = await audio.getGameboyClient(); await client.pulse.noteOn(0,'C4');
  await audio.command('stop'); assert.equal(f.timers.size,0); await audio.dispose();
});

test('live preset RPC keeps the exact cached Code owner and validates before dispatch',async()=>{
  const f=fixture(),audio=await f.create(),client=await audio.getGameboyClient(),preset=createDefaultPreset();preset.source='wave';
  await audio.applyCodePreset(preset);assert(client.isCurrent());assert.equal(await audio.getGameboyClient(),client);
  const request=f.messages.find(message=>message.method==='applyCodePreset');assert.equal(request.args[0],1);assert.deepEqual(request.args[1],preset);
  const count=f.messages.length;await assert.rejects(audio.applyCodePreset({...preset,source:'invalid'}));await assert.rejects(audio.applyCodePreset(preset,{isCurrent:()=>false}),{name:'AbortError'});assert.equal(f.messages.length,count);
  await client.wave.keyOn();assert.equal(f.messages.filter(message=>message.method==='beginCode').length,1);await audio.dispose();
});

test('Stop or a newer lease invalidates pending preset dispatch/ACK without touching that newer owner',async()=>{
  const f=fixture(),audio=await f.create(),client=await audio.getGameboyClient(),preset=createDefaultPreset();
  f.mode('hold');const old=audio.applyCodePreset(preset);await Promise.resolve();await Promise.resolve();assert(f.messages.some(message=>message.method==='applyCodePreset'));
  f.mode('reply');await audio.command('stop');const next=await audio.getGameboyClient();f.release();await assert.rejects(old,{name:'AbortError'});assert(!client.isCurrent());assert(next.isCurrent());await next.pulse.noteOn(0,'C4');await audio.dispose();
});

test('channel-edit and keyboard-only RPCs keep the same cached Code client; stale edit ACK cannot affect a newer lease',async()=>{
  const f=fixture(),audio=await f.create(),client=await audio.getGameboyClient();
  const edit={channel:1,changes:{'pulse.duty':.25}};
  await audio.applyCodeEdit(edit);let request=f.messages.find(message=>message.method==='applyCodeEdit');assert.deepEqual(Array.from(request.args),[1,edit]);
  await audio.command('noteOn',['keyboard',60,{channel:1}]);await audio.command('setPitch',[1]);await audio.command('releaseKeyboard');
  assert(client.isCurrent());assert.equal(await audio.getGameboyClient(),client);await client.pulse.setDuty(0,.75);
  const count=f.messages.length;await assert.rejects(audio.applyCodeEdit({channel:1,changes:{'pulse.sweep.period':3}}));
  await assert.rejects(audio.applyCodeEdit(edit,{isCurrent:()=>false}),{name:'AbortError'});assert.equal(f.messages.length,count);
  f.mode('hold');const pending=audio.applyCodeEdit(edit);await Promise.resolve();await Promise.resolve();
  f.mode('reply');await audio.command('stop');const fresh=await audio.getGameboyClient();f.release();await assert.rejects(pending,{name:'AbortError'});
  assert(fresh.isCurrent());await fresh.wave.keyOn();await audio.dispose();
});
