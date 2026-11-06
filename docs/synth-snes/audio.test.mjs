import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('./audio.js', import.meta.url), 'utf8');

function fixture({resumeError = false, fetchFailure = false, stalledFetch = false, presetReplies = false} = {}) {
  let createAudio, context, node, timerId = 0, mode = 'reply';
  const timers = new Map(), errors = [], events = [], messages = [];
  let remoteData = '', remoteModData = '', remotePreset = {brr:{data:''}};
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
              remoteData=message.brrDataUnchanged ? remoteData : next.brr.data;
              remotePreset={...next,brr:{...next.brr,data:remoteData}};
              if(next.pmon?.brr){
                remoteModData=message.modBrrDataUnchanged?remoteModData:next.pmon.brr.data;
                remotePreset.pmon={...next.pmon,brr:{...next.pmon.brr,data:remoteModData}};
              }
            }
            const {data:_data,...brr}=remotePreset.brr;
            let shown=remoteData?{...remotePreset,brr}:remotePreset;
            if(remoteModData&&remotePreset.pmon?.brr){const {data:_modData,...modBrr}=remotePreset.pmon.brr;shown={...shown,pmon:{...shown.pmon,brr:modBrr}};}
            this.port.onmessage?.({data:{id:message.id,value:{preset:shown,voices:[]},
              ...(remoteData ? {brrDataOmitted:true} : {}),...(remoteModData&&remotePreset.pmon?.brr?{modBrrDataOmitted:true}:{})}});
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

test('S-DSP audio is lazy and routes one fixed balance before the user Master and final monitor node', async () => {
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
  const data='EBES',first={source:'brr',brr:{data,speed:1}};
  assert.equal((await audio.command('loadPreset',[first])).preset.brr.data,data);
  assert.equal(f.messages.at(-1).args[0].brr.data,data);
  assert.equal((await audio.read()).preset.brr.data,data);
  await audio.command('setPreset',[{...first,brr:{...first.brr,speed:2}}]);
  assert.equal(f.messages.at(-1).brrDataUnchanged,true);
  assert.equal(Object.hasOwn(f.messages.at(-1).args[0].brr,'data'),false);
  assert.equal(first.brr.data,data,'transport does not mutate the caller preset');
  f.mode('error');await assert.rejects(audio.command('loadPreset',[{...first,brr:{data:'bad',speed:1}}]),/Invalid preset/);
  f.mode('reply');assert.equal((await audio.read()).preset.brr.data,data);
  await audio.command('setPreset',[first]);assert.equal(f.messages.at(-1).brrDataUnchanged,true,'failed replacement did not change accepted data');
  await audio.dispose();
});

test('concurrent preset mutations carry full PCM so a changed remote reference cannot retarget an edit',async()=>{
  const f=fixture({presetReplies:true}),audio=await f.create();
  const a={brr:{data:'EBES',speed:1}},b={brr:{data:'ExQV',speed:1}};
  await audio.command('loadPreset',[a]);
  const begin=f.messages.length;
  const results=await Promise.all([audio.command('loadPreset',[b]),audio.command('setPreset',[a])]);
  const sent=f.messages.slice(begin);
  assert.equal(sent.length,2);
  assert(sent.every(message=>!message.brrDataUnchanged&&Object.hasOwn(message.args[0].brr,'data')));
  assert.equal(results[0].preset.brr.data,b.brr.data);assert.equal(results[1].preset.brr.data,a.brr.data);
  assert.equal((await audio.read()).preset.brr.data,a.brr.data);
  await audio.dispose();
});

test('carrier and modulator BRR caches are independent, restore replies and survive failed or concurrent replacement',async()=>{
  const f=fixture({presetReplies:true}),audio=await f.create();
  const first={brr:{data:'EBES',root:60},pmon:{source:'brr',brr:{data:'ExQV',root:60}}};
  const loaded=await audio.command('loadPreset',[first]);
  assert.equal(loaded.preset.brr.data,first.brr.data);assert.equal(loaded.preset.pmon.brr.data,first.pmon.brr.data);
  await audio.command('setPreset',[{...first,pmon:{...first.pmon,brr:{...first.pmon.brr,root:61}}}]);
  let sent=f.messages.at(-1);assert(sent.brrDataUnchanged&&sent.modBrrDataUnchanged);
  assert.equal(Object.hasOwn(sent.args[0].brr,'data'),false);assert.equal(Object.hasOwn(sent.args[0].pmon.brr,'data'),false);
  assert.equal(first.pmon.brr.data,'ExQV','the caller owns its full preset');
  const replacement={...first,pmon:{...first.pmon,brr:{data:'FhcY',root:60}}};
  f.mode('error');await assert.rejects(audio.command('loadPreset',[replacement]),/Invalid preset/);f.mode('reply');
  let read=await audio.read();assert.equal(read.preset.pmon.brr.data,first.pmon.brr.data);
  await audio.command('setPreset',[first]);assert.equal(f.messages.at(-1).modBrrDataUnchanged,true);
  await audio.command('setPreset',[replacement]);sent=f.messages.at(-1);
  assert.equal(sent.brrDataUnchanged,true);assert.equal(sent.modBrrDataUnchanged,undefined);
  const begin=f.messages.length;
  const results=await Promise.all([audio.command('loadPreset',[first]),audio.command('setPreset',[replacement])]);
  const concurrent=f.messages.slice(begin);assert.equal(concurrent.length,2);
  assert.equal(concurrent[1].brrDataUnchanged,undefined);assert.equal(concurrent[1].modBrrDataUnchanged,undefined);
  assert.equal(concurrent[1].args[0].pmon.brr.data,replacement.pmon.brr.data);
  assert.equal(results[0].preset.pmon.brr.data,first.pmon.brr.data);assert.equal(results[1].preset.pmon.brr.data,replacement.pmon.brr.data);
  read=await audio.read();assert.equal(read.preset.pmon.brr.data,replacement.pmon.brr.data);
  await audio.command('loadPreset',[{brr:{data:''},pmon:{source:'wave',brr:{data:''}}}]);
  read=await audio.read();assert.equal(read.preset.brr.data,'');assert.equal(read.preset.pmon.brr.data,'');
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

test('Rejected edits and uncloneable messages clear deadlines without destroying S-DSP audio', async () => {
  const f = fixture(), audio = await f.create();
  f.mode('error'); await assert.rejects(audio.command('loadPreset',[{}]),{name:'RangeError',message:'Invalid preset'});
  f.mode('throw'); await assert.rejects(audio.read(),/Cannot clone/);
  await assert.rejects(audio.command('constructor'),/Unknown S-DSP command/);
  await assert.rejects(audio.command('noteOn',{}),/arguments must be an array/);
  assert.equal(f.timers.size,0); assert.equal(f.errors.length,0); assert.equal(f.context.state,'running');
  await audio.dispose();
});

test('A stalled S-DSP command rejects all pending calls and tears down the old context for explicit retry', async () => {
  const f = fixture(), audio = await f.create(); f.mode('drop');
  const result = Promise.allSettled([audio.read(), audio.command('stop')]);
  assert.equal(f.timers.size,2); f.expire();
  const settled = await result;
  assert(settled.every(item => item.status === 'rejected' && /timed out/.test(item.reason.message)));
  assert.equal(f.errors.length,1); assert.equal(f.timers.size,0); assert.equal(f.context.state,'closed'); assert(f.node.disconnected);
  await assert.rejects(audio.read(),/Enable audio to restart/);
});

test('S-DSP processor failure, unreadable replies and external context closure reject pending operations once', async () => {
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

test('S-DSP initialization failures and stalled loading release contexts and clear startup deadlines', async () => {
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
