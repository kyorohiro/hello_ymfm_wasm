import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./audio.js', import.meta.url), 'utf8');

function fixture({resumeError = false, fetchFailure = false, stalledFetch = false, presetReplies = false} = {}) {
  let createAudio, context, node, timerId = 0, mode = 'reply';
  const timers = new Map(), errors = [], events = [], messages = [];
  let remoteData = '', remotePreset = {dda:{data:''}};
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
        messages.push(message);
        if (message.method === 'dispose') { this.disposed++; return; }
        if (mode === 'throw') throw new Error('Cannot clone');
        if (mode === 'drop') return;
        queueMicrotask(() => {
          if (mode === 'error') {this.port.onmessage?.({data:{id:message.id,error:'Invalid preset',name:'RangeError'}});return;}
          if (presetReplies) {
            if (['setPreset','loadPreset'].includes(message.method)) {
              const next=message.args[0];
              remoteData=message.ddaDataUnchanged ? remoteData : next.dda.data;
              remotePreset={...next,dda:{...next.dda,data:remoteData}};
            }
            const {data:_data,...dda}=remotePreset.dda;
            this.port.onmessage?.({data:{id:message.id,value:{preset:remoteData ? {...remotePreset,dda} : remotePreset,voices:[]},
              ...(remoteData ? {ddaDataOmitted:true} : {})}});
          } else this.port.onmessage?.({data:{id:message.id,value:message.method === 'read' ? {voices:[]} : true}});
        });
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
    get context(){return context;}, get node(){return node;}, errors, timers, events, messages,
    mode(value){mode = value;}, expire(){const [id, timer] = timers.entries().next().value; assert.equal(timer.ms,15000);timers.delete(id);timer.fn();}};
}

test('HuC6280 audio is lazy and routes one fixed balance before the user Master and final monitor node', async () => {
  const f = fixture(); assert.equal(f.context,undefined);
  const audio = await f.create({volume:.7});
  assert.equal(f.events[0],'resume'); assert.equal(f.timers.size,0);
  const [balance, master] = f.context.gains;
  assert.equal(balance.gain.value,1); assert.equal(master.gain.value,.7);
  assert.equal(audio.outputNode,master);
  assert.deepEqual(f.node.connections,[balance]); assert.deepEqual(balance.connections,[master]); assert.deepEqual(master.connections,[f.context.destination]);
  audio.setVolume(3.8); assert.equal(master.gain.value,3.8); assert.equal(balance.gain.value,1);
  audio.setVolume(0); assert.equal(master.gain.value,0);
  assert.throws(() => audio.setVolume(3.81),/Master/);
  assert.deepEqual(await audio.read(),{voices:[]});
  const first = audio.dispose(); assert.equal(audio.dispose(),first); await first;
  assert.equal(f.context.closeCount,1); assert.equal(f.node.disposed,1); assert.equal(f.timers.size,0);
});

test('PCM is sent once, metadata edits refer to acknowledged data, and replies restore the local preset',async()=>{
  const f=fixture({presetReplies:true}),audio=await f.create();
  const data='EBES',first={source:'dda',dda:{data,speed:1}};
  assert.equal((await audio.command('loadPreset',[first])).preset.dda.data,data);
  assert.equal(f.messages.at(-1).args[0].dda.data,data);
  assert.equal((await audio.read()).preset.dda.data,data);
  await audio.command('setPreset',[{...first,dda:{...first.dda,speed:2}}]);
  assert.equal(f.messages.at(-1).ddaDataUnchanged,true);
  assert.equal(Object.hasOwn(f.messages.at(-1).args[0].dda,'data'),false);
  assert.equal(first.dda.data,data,'transport does not mutate the caller preset');
  f.mode('error');await assert.rejects(audio.command('loadPreset',[{...first,dda:{data:'bad',speed:1}}]),/Invalid preset/);
  f.mode('reply');assert.equal((await audio.read()).preset.dda.data,data);
  await audio.command('setPreset',[first]);assert.equal(f.messages.at(-1).ddaDataUnchanged,true,'failed replacement did not change accepted data');
  await audio.dispose();
});

test('concurrent preset mutations carry full PCM so a changed remote reference cannot retarget an edit',async()=>{
  const f=fixture({presetReplies:true}),audio=await f.create();
  const a={dda:{data:'EBES',speed:1}},b={dda:{data:'ExQV',speed:1}};
  await audio.command('loadPreset',[a]);
  const begin=f.messages.length;
  const results=await Promise.all([audio.command('loadPreset',[b]),audio.command('setPreset',[a])]);
  const sent=f.messages.slice(begin);
  assert.equal(sent.length,2);
  assert(sent.every(message=>!message.ddaDataUnchanged&&Object.hasOwn(message.args[0].dda,'data')));
  assert.equal(results[0].preset.dda.data,b.dda.data);assert.equal(results[1].preset.dda.data,a.dda.data);
  assert.equal((await audio.read()).preset.dda.data,a.dda.data);
  await audio.dispose();
});

test('the final Master bus can route to a desktop tap while retaining passive monitors and the same engine', async () => {
  const f = fixture(), audio = await f.create({volume:.7});
  const [balance, master] = f.context.gains, monitor = {}, desktopTap = {};
  master.connect(monitor);
  audio.outputNode.disconnect(audio.context.destination);
  audio.outputNode.connect(desktopTap);
  assert.deepEqual(master.connections,[monitor, desktopTap]);
  assert.deepEqual(f.node.connections,[balance]); assert.deepEqual(balance.connections,[master]);
  audio.setVolume(3.8); assert.equal(master.gain.value,3.8);
  await audio.command('stop'); await audio.command('setPitch',[0]);
  audio.outputNode.disconnect(desktopTap); audio.outputNode.connect(audio.context.destination);
  assert.deepEqual(master.connections,[monitor, audio.context.destination]);
  assert.equal(f.context.closeCount,0); assert.equal(f.node.disposed,0);
  await audio.dispose(); assert.equal(f.context.closeCount,1);
});

test('Rejected edits and uncloneable messages clear deadlines without destroying HuC6280 audio', async () => {
  const f = fixture(), audio = await f.create();
  f.mode('error'); await assert.rejects(audio.command('loadPreset',[{}]),{name:'RangeError',message:'Invalid preset'});
  f.mode('throw'); await assert.rejects(audio.read(),/Cannot clone/);
  await assert.rejects(audio.command('constructor'),/Unknown HuC6280 command/);
  await assert.rejects(audio.command('noteOn',{}),/arguments must be an array/);
  assert.equal(f.timers.size,0); assert.equal(f.errors.length,0); assert.equal(f.context.state,'running');
  await audio.dispose();
});

test('A stalled HuC6280 command rejects all pending calls and tears down the old context for explicit retry', async () => {
  const f = fixture(), audio = await f.create(); f.mode('drop');
  const result = Promise.allSettled([audio.read(), audio.command('stop')]);
  assert.equal(f.timers.size,2); f.expire();
  const settled = await result;
  assert(settled.every(item => item.status === 'rejected' && /timed out/.test(item.reason.message)));
  assert.equal(f.errors.length,1); assert.equal(f.timers.size,0); assert.equal(f.context.state,'closed'); assert(f.node.disconnected);
  await assert.rejects(audio.read(),/Enable audio to restart/);
});

test('HuC6280 processor failure, unreadable replies and external context closure reject pending operations once', async () => {
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

test('HuC6280 initialization failures and stalled loading release contexts and clear startup deadlines', async () => {
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
