import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaygroundRuntime } from './playground_runtime.js';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Async boundary was not reached');
}
function setup(t) {
  const listeners = new Set(), statuses = [];
  const previous = globalThis.window;
  globalThis.window = {
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn), setTimeout,
  };
  const media = () => ({ stop() {}, stopAll() {}, pause() {}, list: () => [], unload() {} });
  const megaDrive = {
    state: 'idle', audioContext: { currentTime: 0 },
    fm: { setPreset() {}, noteOff() {} }, psg: {},
    sample: media(), stream: media(),
    async start() { this.state = 'ready'; }, async resume() {}, async close() {},
    clearFXChain: () => [],
  };
  const runtime = createPlaygroundRuntime({ megaDrive, guardExecution: false, onStatus: s => statuses.push(s) });
  t.after(() => {
    runtime.stop();
    globalThis.window = previous;
    delete globalThis.playgroundReview;
  });
  return { runtime, megaDrive, listeners, statuses };
}

test('stop prevents a late evaluation from registering loops and keyboard handlers', async t => {
  const { runtime, listeners } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, loops: 0 };
  const running = runtime.playSource(`
    globalThis.playgroundReview.entered = true;
    await globalThis.playgroundReview.gate;
    onKeyboardPressKey('late', () => {});
    liveLoop('late', async () => { globalThis.playgroundReview.loops++; await sleep(60); });
  `);
  await until(() => globalThis.playgroundReview.entered);
  runtime.stop(); gate.resolve(); await running;
  assert.equal(listeners.size, 0);
  assert.equal(globalThis.playgroundReview.loops, 0);
  assert.equal(runtime.getState().playback, 'stopped');
});

test('an older evaluation cannot replace a newer run or change its state', async t => {
  const { runtime, listeners } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, hits: 0 };
  const old = runtime.playSource('globalThis.playgroundReview.entered = true; await globalThis.playgroundReview.gate;');
  await until(() => globalThis.playgroundReview.entered);
  await runtime.playSource("onKeyboardPressKey('new', () => { globalThis.playgroundReview.hits++; });");
  gate.resolve(); await old;
  assert.equal(listeners.size, 1);
  for (const fn of listeners) fn({});
  assert.equal(globalThis.playgroundReview.hits, 1);
  assert.equal(runtime.getState().playback, 'running');
});

for (const execution of ['main', 'worker']) {
  test(`stop during audio initialization prevents ${execution} code from running`, async t => {
    const { runtime, megaDrive } = setup(t);
    const gate = deferred(); let entered = false;
    megaDrive.start = () => { entered = true; return gate.promise; };
    const previous = globalThis.Worker;
    globalThis.Worker = class { constructor() { assert.fail('Stopped run created a Worker'); } };
    t.after(() => { globalThis.Worker = previous; });
    globalThis.playgroundReview = { ran: false };
    const pending = runtime.playSource('globalThis.playgroundReview.ran = true;', { execution });
    await until(() => entered);
    runtime.stop(); gate.resolve(); await pending;
    assert.equal(globalThis.playgroundReview.ran, false);
    assert.equal(runtime.getState().playback, 'stopped');
  });
}

test('syntax errors leave stopped state and allow the next run', async t => {
  const { runtime, statuses } = setup(t);
  await assert.rejects(runtime.playSource('const = ;'), SyntaxError);
  assert.equal(runtime.getState().playback, 'stopped');
  assert.ok(statuses.some(s => s.startsWith('Error:')));
  await runtime.playSource("onKeyboardPressKey('valid', () => {});");
  assert.equal(runtime.getState().playback, 'running');
});

test('finalize settles pending Worker runs and main-mode stop waits; late Worker messages are ignored', { timeout: 1000 }, async t => {
  const { runtime, listeners } = setup(t);
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  t.after(() => { globalThis.Worker = previous; });
  const cancelled = assert.rejects(runtime.playSource('await sleep(60);', { execution: 'worker' }), { name: 'AbortError' });
  await until(() => workers.length > 0);
  const main = runtime.playSource("onKeyboardPressKey('late', () => {});");
  const lateMessage = workers[0].onmessage;
  await runtime.finalize();
  await cancelled; await main;
  lateMessage({ data: { type: 'complete', loopCount: 1 } });
  assert.equal(workers[0].terminated, true);
  assert.equal(listeners.size, 0);
  assert.equal(runtime.getState().playback, 'stopped');
});

test('removing a sounding loop releases its note', async t => {
  const { runtime, megaDrive } = setup(t);
  const notes = [];
  megaDrive.fm.noteOn = c => notes.push(['on', c]);
  megaDrive.fm.noteOff = c => notes.push(['off', c]);
  await runtime.playSource('liveLoop("lead", async () => { await play("C4", { duration: 60 }); });');
  await runtime.playSource('');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(notes, [['on', 0], ['off', 0]]);
});

test('cancelled loop does not release the replacement note on the same channel', async t => {
  const { runtime, megaDrive } = setup(t);
  const notes = [];
  megaDrive.fm.noteOn = c => notes.push(['on', c]);
  megaDrive.fm.noteOff = c => notes.push(['off', c]);
  await runtime.playSource('liveLoop("old", async () => { await play("C4", { duration: 60 }); });');
  await runtime.playSource('liveLoop("new", async () => { await play("D4", { duration: 60 }); });');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(notes, [['on', 0], ['on', 0]]);
});

test('late prepare completion cannot repopulate the cache after stop', async t => {
  const { runtime } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, value: null };
  const pending = runtime.playSource('await livePrepare("asset", async () => { globalThis.playgroundReview.entered = true; await globalThis.playgroundReview.gate; return "old"; });');
  await until(() => globalThis.playgroundReview.entered);
  runtime.stop();
  gate.resolve(); await pending;
  await runtime.playSource('globalThis.playgroundReview.value = await livePrepare("asset", () => "new");');
  assert.equal(globalThis.playgroundReview.value, 'new');
});

function workerBridge(t) {
  const workers=[],previous=globalThis.Worker;
  globalThis.Worker=class {
    constructor(){this.responses=[];workers.push(this);}
    postMessage(message){
      if(message.type==='run')queueMicrotask(()=>this.onmessage?.({data:{type:'complete',loopCount:2}}));
      if(message.type==='stop')queueMicrotask(()=>{
        this.onmessage?.({data:{type:'command',command:'audio.stopAll',args:[]}});
        this.onmessage?.({data:{type:'stopped'}});
      });
      if(message.type==='response')this.responses.push(message);
    }
    terminate(){this.terminated=true;}
    send(data){this.onmessage({data});}
  };
  t.after(()=>{globalThis.Worker=previous;});return workers;
}
test('Worker play durations do not serialize independent live-loop notes or Stop',async t=>{
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t),notes=[],offs=[];
 megaDrive.fm.noteOn=ch=>notes.push(ch);megaDrive.fm.noteOff=ch=>offs.push(ch);
 await runtime.playSource('',{execution:'worker'});const w=workers[0];
 w.send({type:'request',id:1,command:'play',args:['E2',{channel:0,duration:60}]});
 w.send({type:'request',id:2,command:'play',args:['E4',{channel:1,duration:60}]});
 try{
  await until(()=>notes.length===2);
  assert.deepEqual(notes,[0,1]);assert.equal(w.responses.length,0,'each caller still waits for its own note');
  w.send({type:'command',command:'audio.stopAll',args:[]});
  await until(()=>offs.length>=6);
 }finally{await runtime.finalize();}
});
test('Worker -> Stop -> main live loop -> Stop cancels the main loop and releases notes',async t=>{
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t);let offs=0;
 megaDrive.fm.noteOff=()=>offs++;
 await runtime.playSource('',{execution:'worker'});runtime.stop();
 globalThis.playgroundReview={finished:false};
 await runtime.playSource(`liveLoop('main',async()=>{await sleep(60);globalThis.playgroundReview.finished=true;});`);
 assert.equal(workers[0].terminated,true);
 const before=offs;runtime.stop();assert(offs>before,'Stop must release main-mode voices');
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(globalThis.playgroundReview.finished,false);
 assert.equal(runtime.getState().playback,'stopped');
 await runtime.finalize();
});
