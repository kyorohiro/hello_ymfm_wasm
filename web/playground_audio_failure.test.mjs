import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as immediate} from 'node:timers/promises';
import {setMaxListeners} from 'node:events';
import {Worker as NodeWorker} from 'node:worker_threads';
import {SoundChipMixer} from './soundchip_mixer.js';
import {attachChipClock} from './playground_chip_clock.js';
import {createPerformanceHost} from './playground_performance_host.js';

// Factories capture the application's trusted loader at import time. Keep that
// real behavior while routing every asset request into this device-free fixture.
const originalFetch = globalThis.fetch;
let loadAsset;
globalThis.fetch = (...args) => {
  if (!loadAsset) throw new Error('Unexpected asset request outside an audio fixture');
  return loadAsset(...args);
};
const {createPlaygroundRuntime} = await import('./playground_runtime.js');
globalThis.fetch = originalFetch;

const chips = [
  'segapsg', 'ym3526', 'ym3812', 'y8950', 'ymf262', 'ym2413', 'ay8910',
  'okim6258', 'huc6280', 'ym2612', 'ym2203', 'ym2610', 'ym2610b', 'ym2608',
  'rf5c164', 'gameboy', 'nes', 'ym2151', 'pwm', 'dx7', 'snes', 'spc',
];

async function until(predicate, description) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await immediate();
  }
  assert.fail(`Did not reach ${description}`);
}

function fixture(t, {startupFailure = false, primary = 'gameboy'} = {}) {
  const previous = {window:globalThis.window, AudioWorkletNode:globalThis.AudioWorkletNode, loadAsset};
  const nodes = [], ports = new Set(), assets = [], modules = [], logs = [];
  let nextStartupFailure = startupFailure;
  const graphNode = () => ({
    connections:[],
    connect(destination) { this.connections.push(destination); return destination; },
    disconnect(destination) {
      this.connections = destination === undefined ? [] : this.connections.filter(node => node !== destination);
    },
  });
  const context = new EventTarget();
  setMaxListeners(0, context);
  Object.assign(context, {
    state:'running', currentTime:0, sampleRate:48000,
    destination:graphNode(),
    audioWorklet:{async addModule(url) { modules.push(String(url)); }},
    createGain:() => ({...graphNode(), gain:{value:1,
      cancelScheduledValues() {}, cancelAndHoldAtTime() {},
      setValueAtTime(value) { this.value = value; },
      linearRampToValueAtTime(value) { this.value = value; },
    }}),
    createChannelSplitter:graphNode, createChannelMerger:graphNode,
    async resume() {},
    async close() { this.state = 'closed'; this.dispatchEvent(new Event('statechange')); },
  });
  loadAsset = async url => {
    assets.push(String(url));
    return {ok:true, arrayBuffer:async () => new ArrayBuffer(8)};
  };
  globalThis.window = new EventTarget();
  Object.assign(globalThis.window, {setTimeout, clearTimeout});
  globalThis.AudioWorkletNode = class {
    constructor(audioContext, name, options) {
      Object.assign(this, graphNode());
      this.context = audioContext; this.name = name; this.options = options;
      this.messages = []; this.commands = []; this.closed = false;
      const control = new MessageChannel();
      this.port = control.port1; this.admin = control.port2;
      ports.add(control.port1); ports.add(control.port2);
      const post = this.port.postMessage.bind(this.port), close = this.port.close.bind(this.port);
      this.port.postMessage = (...args) => { this.messages.push(args[0]); return post(...args); };
      this.port.close = () => { this.closed = true; close(); };
      this.admin.onmessage = ({data}) => {
        if (data.port) {
          const port = data.port; this.performancePort = port; ports.add(port);
          port.onmessage = ({data:command}) => {
            this.commands.push(command);
            if (command.id !== undefined) port.postMessage({id:command.id, value:true});
          };
          port.start();
        }
        if (data.type === 'chip-inspector') this.admin.postMessage({
          type:'chip-inspector-result', id:data.id,
          value:{kind:data.inspectorKind, channels:[{channel:0, active:false}]},
        });
      };
      this.admin.start(); nodes.push(this);
      const fail = nextStartupFailure; nextStartupFailure = false;
      queueMicrotask(() => this.admin.postMessage(fail
        ? {fatal:true, error:'fixture startup failure'}
        : {ready:true, type:'ready', sampleRate:48000, internalSampleRate:44100,
          nativeSampleRate:32000, voices:[{index:0, name:'INIT SINE'}], selectedVoice:0}));
    }
    fail(kind) {
      if (kind === 'processorerror') this.onprocessorerror?.(new Event('processorerror'));
      else this.admin.postMessage(kind === 'fatal' ? {fatal:true, error:'fixture fatal processor fault'} : {error:'fixture processor fault'});
    }
  };
  const media = () => ({stop() {}, stopAll() {}, pause() {}, list:() => [], unload() {}});
  const synth = {
    // Pick an inert primary of a different kind from the requested shared chip.
    capabilities:{chip:primary, fmChannels:primary === 'ym2612' ? 6 : 0, psg:false, dac:false},
    state:'idle', audioContext:context,
    gameboy:{}, fm:{setPreset() {}, noteOff() {}}, audio:{masterInputNode:graphNode()},
    mixer:new SoundChipMixer(), sample:media(), stream:media(),
    async start() { this.state = 'ready'; }, async resume() {},
    async close() { this.state = 'closed'; }, clearFXChain:() => [],
  };
  const runtime = createPlaygroundRuntime({synth, guardExecution:false, onLog:line => logs.push(line)});
  t.after(async () => {
    await runtime.finalize();
    runtime.chipInspector.dispose();
    for (const port of ports) port.close();
    globalThis.window = previous.window;
    globalThis.AudioWorkletNode = previous.AudioWorkletNode;
    loadAsset = previous.loadAsset;
  });
  return {runtime, synth, context, nodes, assets, modules, logs,
    connected:() => synth.mixer.list().filter(row => row.connected),
    disposed:node => node.messages.filter(message => message.method === 'dispose' || message.type === 'dispose').length,
    async begin() {
      await runtime.playSource('context.api = {useSoundChip, createSoundChip};', {name:'fixture.js'});
      return runtime.context.api;
    },
  };
}

async function assertDisposed(client, chip) {
  const operation = chip === 'dx7' ? () => client.noteOn(60)
    : chip === 'spc' ? () => client.play()
    : chip === 'pwm' ? () => client.writeRegister(1, 0)
    : () => client.reset();
  await assert.rejects(Promise.resolve().then(operation), /disposed|cancelled|closed/i);
}

for (const chip of chips) {
  for (const failure of ['processorerror', 'fatal']) {
    test(`${chip}: post-ready ${failure} releases runtime ownership and recreates only the failed shared chip`, {timeout:5000}, async t => {
      const f = fixture(t, {primary:chip === 'gameboy' ? 'ym2612' : 'gameboy'}), api = await f.begin();
      const open = () => api.useSoundChip(chip);
      const client = await open(), node = f.nodes.at(-1);
      const unrelated = await api.createSoundChip('segapsg', {id:'unrelated'});
      const unrelatedNode = f.nodes.at(-1);
      const mix = {volume:.37, pan:-.4, muted:false, solo:true};
      f.synth.mixer.set(unrelated.id, mix);
      assert.equal(client.id, `${chip}:shared`);
      assert.equal(await open(), client, 'a healthy shared lookup reuses the same Main client');
      assert.deepEqual(f.connected().map(row => row.id), [client.id, unrelated.id]);
      assert.deepEqual(f.runtime.chipInspector.list().map(row => row.id), [client.id, unrelated.id]);
      assert.equal((await f.runtime.chipInspector.read(client.id)).kind, chip);

      // Leave a real inspector request pending when the endpoint vanishes.
      // Its disconnected-port cancellation must beat the five-second timeout.
      node.admin.onmessage = ({data}) => { if (data.port) data.port.close(); };
      const read = f.runtime.chipInspector.read(client.id);
      const rejectedRead = assert.rejects(read, /disconnected/i);
      node.fail(failure);
      await until(() => !f.connected().some(row => row.id === client.id), 'failed mixer route release');
      await rejectedRead;
      assert.deepEqual(f.runtime.chipInspector.list().map(row => row.id), [unrelated.id]);
      assert.equal(node.connections.length, 0);
      assert.equal(node.closed, true);
      assert.equal(f.disposed(node), 1, 'the audio endpoint is released once');
      await assertDisposed(client, chip);
      assert.equal(unrelatedNode.closed, false);
      assert.deepEqual(f.synth.mixer.get(unrelated.id), mix);

      const replacement = await open();
      assert.notEqual(replacement, client);
      assert.equal(replacement.id, client.id);
      assert.equal(f.nodes.length, 3, 'retry opens only the failed sound chip');
      assert.deepEqual(f.connected().map(row => row.id), [unrelated.id, replacement.id]);
      assert.deepEqual(f.synth.mixer.get(unrelated.id), mix);
      client.dispose(); client.dispose();
      assert.equal(f.disposed(node), 1, 'late cleanup cannot release its replacement');
      assert.equal(f.connected().length, 2);
    });
  }
}

test('dynamic chip IDs distinguish created instances from the coalesced shared lookup', {timeout:5000}, async t => {
  const f = fixture(t), api = await f.begin();
  const [shared, same, created, createdAgain] = await Promise.all([
    api.useSoundChip('segapsg'), api.useSoundChip('segapsg'),
    api.createSoundChip('segapsg'), api.createSoundChip('segapsg'),
  ]);
  assert.equal(shared, same);
  assert.equal(shared.id, 'segapsg:shared');
  assert.notEqual(shared.id, created.id); assert.notEqual(created.id, createdAgain.id);
  assert.equal(new Set(f.connected().map(row => row.id)).size, 3);
  assert.equal(f.nodes.length, 3);
});

for (const chip of ['segapsg', 'ym3812']) test(`${chip}: inspector validation errors preserve a healthy runtime endpoint`, {timeout:5000}, async t => {
  const f = fixture(t), api = await f.begin(), client = await api.useSoundChip(chip), node = f.nodes[0];
  node.admin.postMessage({type:'chip-inspector-result', id:'rejected-edit', error:'fixture invalid operator edit'});
  // The successful reply follows the validation error on the same admin port.
  assert.equal((await f.runtime.chipInspector.read(client.id)).kind, chip);
  assert.equal(await api.useSoundChip(chip), client);
  assert.equal(node.closed, false); assert.equal(f.disposed(node), 0);
  assert.deepEqual(f.connected().map(row => row.id), [client.id]);
});

for (const chip of ['segapsg', 'ym3812']) {
  test(`${chip}: admin-port performance and clock RPC rejections preserve the shared endpoint`, {timeout:5000}, async t => {
    const f = fixture(t), api = await f.begin(), client = await api.useSoundChip(chip), node = f.nodes[0];
    const receive = node.admin.onmessage;
    let rejectClock = true;
    node.admin.onmessage = event => {
      const {data} = event;
      if (data.type === 'performance-start') {
        node.admin.postMessage({type:'performance-result', id:data.id, error:'fixture invalid performance session'});
      } else if (data.type === 'chip-clock') {
        node.admin.postMessage({type:'chip-clock-result', id:data.id,
          ...(rejectClock ? {error:'fixture manual audition holds the clock'} : {value:true})});
      } else receive.call(node.admin, event);
    };
    const host = createPerformanceHost({getContext:() => f.context});
    t.after(() => host.stop());
    await assert.rejects(host.start([node.port], .3), /fixture invalid performance session/);
    const clock = attachChipClock({dispose() {}}, node.port, client.clock, {primary:true});
    t.after(() => clock.dispose());
    await assert.rejects(clock.setClock(4000000), /fixture manual audition holds the clock/);
    assert.equal(clock.clock, client.clock, 'a rejected clock cannot change the acknowledged value');
    rejectClock = false;
    await clock.setClock(4000000);
    assert.equal(clock.clock, 4000000, 'the same port still acknowledges subsequent requests');
    assert.equal((await f.runtime.chipInspector.read(client.id)).kind, chip);
    assert.equal(await api.useSoundChip(chip), client);
    assert.equal(node.closed, false); assert.equal(f.disposed(node), 0);
    assert.deepEqual(f.connected().map(row => row.id), [client.id]);
  });

  for (const type of ['chip-clock-result', 'chip-inspector-result']) {
    test(`${chip}: explicit fatal ${type} retires the endpoint even with a request ID`, {timeout:5000}, async t => {
      const f = fixture(t), api = await f.begin(), client = await api.useSoundChip(chip), node = f.nodes[0];
      node.admin.postMessage({type, id:'failed-rpc', fatal:true, error:'fixture fatal RPC processor failure'});
      await until(() => !f.connected().length, 'fatal RPC route release');
      assert.equal(node.closed, true); assert.equal(f.disposed(node), 1);
      assert.deepEqual(f.runtime.chipInspector.list(), []);
      await assertDisposed(client, chip);
      assert.notEqual(await api.useSoundChip(chip), client);
    });
  }
}

test('closing the AudioContext releases every dynamic endpoint, inspector and Main client exactly once', {timeout:5000}, async t => {
  const f = fixture(t), api = await f.begin(), clients = [];
  for (const chip of chips) clients.push([chip, await api.createSoundChip(chip)]);
  assert.equal(f.connected().length, chips.length);
  assert.equal(f.runtime.chipInspector.list().length, chips.length);
  await f.context.close();
  await until(() => f.connected().length === 0, 'all closed-context routes released');
  assert.deepEqual(f.runtime.chipInspector.list(), []);
  for (const [chip, client] of clients) { await assertDisposed(client, chip); client.dispose(); }
  await f.context.close();
  for (const node of f.nodes) {
    assert.equal(node.closed, true); assert.equal(node.connections.length, 0);
    assert.equal(f.disposed(node), 1);
  }
});

for (const chip of chips) test(`${chip}: failed initialization releases its reserved shared ID and permits retry`, {timeout:5000}, async t => {
  const f = fixture(t, {startupFailure:true, primary:chip === 'gameboy' ? 'ym2612' : 'gameboy'}), api = await f.begin();
  const open = () => api.useSoundChip(chip);
  await assert.rejects(open(), /fixture startup failure/);
  assert.deepEqual(f.connected(), []);
  assert.deepEqual(f.runtime.chipInspector.list(), []);
  assert.equal(f.synth.mixer.reservedIds.size, 0);
  assert.equal(f.nodes[0].closed, true); assert.equal(f.disposed(f.nodes[0]), 1);
  const client = await open();
  assert.equal(client.id, `${chip}:shared`); assert.equal(f.connected().length, 1);
});

function installRealWorkers(t) {
  const previous = globalThis.Worker, workers = [];
  const url = new URL('./playground_logic_worker.js', import.meta.url).href;
  globalThis.Worker = class {
    constructor() {
      this.messages = []; this.sent = []; this.pending = []; this.ready = false;
      workers.push(this);
      this.worker = new NodeWorker(`
        const {parentPort} = require('node:worker_threads');
        globalThis.self = globalThis;
        globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
        import(${JSON.stringify(url)}).then(() => {
          parentPort.on('message', data => self.onmessage({data}));
          parentPort.postMessage({testWorkerReady:true});
        }).catch(error => { throw error; });
      `, {eval:true});
      this.worker.on('message', data => {
        if (data.testWorkerReady) {
          this.ready = true;
          for (const [message, transfer] of this.pending) this.worker.postMessage(message, transfer);
          this.pending = []; return;
        }
        this.messages.push(data); this.onmessage?.({data});
      });
      this.worker.on('error', error => this.onerror?.({message:error.message}));
    }
    postMessage(message, transfer) {
      this.sent.push(message);
      if (this.ready) this.worker.postMessage(message, transfer);
      else this.pending.push([message, transfer]);
    }
    terminate() { this.terminated ??= this.worker.terminate(); return this.terminated; }
  };
  t.after(async () => {
    for (const worker of workers) await worker.terminate();
    globalThis.Worker = previous;
  });
  return workers;
}

// Different clients own synchronous writes, asynchronous RPCs and different
// dispose methods. Run their common Worker registry path in the actual module.
for (const chip of ['segapsg', 'ym2413', 'ym3812', 'ay8910', 'okim6258', 'ym2612', 'ym2610b', 'rf5c164', 'gameboy', 'pwm', 'dx7', 'snes', 'spc']) {
  test(`${chip}: actual logic Worker evicts a failed instance and ignores its stale disposal notification`, {timeout:10000}, async t => {
    const workers = installRealWorkers(t);
    const f = fixture(t, {primary:chip === 'gameboy' ? 'ym2612' : 'gameboy'});
    const operation = chip === 'dx7' ? 'noteOn(60)' : chip === 'spc' ? 'play()' : chip === 'pwm' ? 'writeRegister(1, 0)' : 'reset()';
    await f.runtime.playSource(`
      const first = await useSoundChip(${JSON.stringify(chip)});
      const unrelated = await createSoundChip('segapsg', {id:'unrelated'});
      await mixer.set(unrelated.id, {volume:.37, pan:-.4, muted:false, solo:true});
      let replacement;
      keyboard.bind('failure fixture', {
        async noteOn(event) {
          if (event.midi === 60) {
            let disposed = false;
            try { await first.${operation}; } catch (error) { disposed = /disposed|cancelled|closed/i.test(error.message); }
            if (!disposed) throw Error('Failed Worker client remained usable');
            replacement = await useSoundChip(${JSON.stringify(chip)});
            if (replacement === first || replacement.id !== first.id) throw Error('Worker cache did not recreate the same ID');
            if (await useSoundChip(${JSON.stringify(chip)}) !== replacement) throw Error('Worker cache did not coalesce replacement');
            await replacement.${operation};
            log('worker recreated');
          } else if (event.midi === 61) {
            if (await useSoundChip(${JSON.stringify(chip)}) !== replacement) throw Error('Stale disposal evicted replacement');
            await replacement.${operation};
            first.dispose(); first.dispose();
            const rows = await mixer.list();
            if (rows.filter(row => row.connected).length !== 2) throw Error('Late client disposal disconnected replacement');
            log('worker survived stale notification');
          }
        },
        noteOff() {}, allNotesOff() {},
      });
      log('worker ready');
    `, {execution:'worker'});
    assert.equal(workers.length, 1);
    const worker = workers[0], firstNode = f.nodes[0], unrelatedNode = f.nodes[1];
    await until(() => f.runtime.getKeyboardTarget() && f.logs.includes('worker ready'), 'actual Worker binding ready');
    firstNode.fail('processorerror');
    await until(() => worker.sent.some(message => message.type === 'extra-chip-disposed'), 'instance-specific Worker disposal notification');
    const notification = worker.sent.find(message => message.type === 'extra-chip-disposed');
    assert.equal(notification.id, `${chip}:shared`);
    assert(Number.isSafeInteger(notification.instance));
    f.runtime.getKeyboardTarget().noteOn({id:'retry', midi:60});
    await until(() => f.logs.includes('worker recreated'), 'Worker shared-chip retry');
    assert.equal(f.nodes.length, 3);
    const replacement = f.nodes[2];
    assert.deepEqual(f.connected().map(row => row.id), ['unrelated', `${chip}:shared`]);
    assert.equal(unrelatedNode.closed, false);
    assert.deepEqual(f.synth.mixer.get('unrelated'), {volume:.37, pan:-.4, muted:false, solo:true});
    // A command queued before the failure may arrive after same-ID recreation.
    // Exercise the host's exact-instance fence in the opposite direction too.
    worker.onmessage({data:{type:'command', command:'pcm.dispose', args:[notification.id, notification.instance]}});
    worker.postMessage(notification);
    f.runtime.getKeyboardTarget().noteOn({id:'stale', midi:61});
    await until(() => f.logs.includes('worker survived stale notification'), 'stale-token fence');
    assert.equal(replacement.closed, false);
    assert.equal(f.disposed(firstNode), 1);
    assert.equal(worker.sent.filter(message => message.type === 'extra-chip-disposed' && message.instance === notification.instance).length, 2,
      'exactly one runtime notification plus the injected stale replay');
    assert(!worker.messages.some(message => message.type === 'execution-error' || message.type === 'log' && message.level === 'error'));
    assert.equal(f.nodes.length, 3);
  });
}

for(const [chip,type,length] of [['ym3812','opl-state',256],['ym2413','opll-state',64],['ay8910','ay-state',16]]) {
  test(`${chip}: actual Worker accepts current state but rejects old-instance clock/register snapshots`,{timeout:10000},async t=>{
    const workers=installRealWorkers(t),f=fixture(t);
    await f.runtime.playSource(`
      const first=await useSoundChip(${JSON.stringify(chip)});let replacement;
      keyboard.bind('snapshot fixture',{
        async noteOn(event){
          if(event.midi===60){replacement=await useSoundChip(${JSON.stringify(chip)});if(replacement===first)throw Error('Failed instance was reused');log('snapshot replacement');}
          else if(event.midi===61||event.midi===62){
            if(replacement.clock!==4321000||replacement.getRegisterSnapshot()[0]!==0x3c)throw Error('Wrong instance clock/register state');
            log(event.midi===61?'current snapshot adopted':'old snapshot rejected');
          }
        },noteOff(){},allNotesOff(){},
      });log('snapshot ready');
    `,{execution:'worker'});
    const worker=workers[0],first=f.nodes[0];
    await until(()=>f.runtime.getKeyboardTarget()&&f.logs.includes('snapshot ready'),'snapshot binding ready');
    const state=(clock,value)=>({clock,initialized:true,registers:Array.from({length},(_,index)=>index===0?value:0),...(chip==='ay8910'?{levels:[9,9,9]}:{})});
    first.admin.postMessage({type,state:state(3540000,0x12)});
    await until(()=>worker.sent.some(message=>message.type==='extra-opl-state'),'old state notification');
    const old=worker.sent.find(message=>message.type==='extra-opl-state');assert(Number.isSafeInteger(old.instance));
    first.fail('processorerror');
    await until(()=>worker.sent.some(message=>message.type==='extra-chip-disposed'&&message.instance===old.instance),'old instance disposed');
    f.runtime.getKeyboardTarget().noteOn({id:'replace',midi:60});
    await until(()=>f.logs.includes('snapshot replacement'),'same-ID replacement');
    const replacement=f.nodes[1],before=worker.sent.length;
    replacement.admin.postMessage({type,state:state(4321000,0x3c)});
    await until(()=>worker.sent.slice(before).some(message=>message.type==='extra-opl-state'),'replacement snapshot notification');
    const current=worker.sent.slice(before).find(message=>message.type==='extra-opl-state');assert.notEqual(current.instance,old.instance);
    f.runtime.getKeyboardTarget().noteOn({id:'current',midi:61});
    await until(()=>f.logs.includes('current snapshot adopted'),'current snapshot adoption');
    const writes=replacement.commands.length;
    worker.postMessage(old);worker.postMessage({...old,instance:undefined});
    f.runtime.getKeyboardTarget().noteOn({id:'stale',midi:62});
    await until(()=>f.logs.includes('old snapshot rejected'),'stale clock/register snapshot rejection');
    assert.equal(replacement.commands.length,writes,'Observing snapshots must not replay audio writes');
    assert.equal(replacement.closed,false);assert.equal(f.nodes.length,2);
    assert(!worker.messages.some(message=>message.type==='execution-error'||message.type==='log'&&message.level==='error'));
  });
}
