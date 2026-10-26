import assert from 'node:assert/strict';
import {Worker as NodeWorker, MessageChannel as NodeMessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createInitVoice} from './msfa_dx7/src/sysex.js';
import {CHIP_CLOCKS} from './playground_chip_clock.js';

export const EXTRA_KINDS = Object.freeze(['segapsg', 'ym2612', 'ym2203', 'ym2608', 'ym2610', 'ym2610b', 'ym2151', 'ym2413', 'ay8910', 'ym3526', 'ym3812', 'y8950', 'ymf262', 'rf5c164', 'okim6258', 'gameboy', 'nes', 'huc6280', 'wonderswan', 'dx7', 'pwm', 'snes', 'spc']);
export const tick = () => new Promise(resolve => setTimeout(resolve, 2));
export function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
export async function until(predicate, label = 'condition', timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Creation lifecycle timed out: ${label}`);
    await tick();
  }
}

// Ports are real transferable Node MessagePorts. Their close events and actual
// native IPC requests are tracked; this is not a GC or real-heap measurement.
export function installCreationEnvironment(t, {holdResponse = () => false, holdNotification = () => false} = {}) {
  const keys = ['window', 'Worker', 'MessageChannel', 'AudioContext', 'AudioWorkletNode'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const ports = new Set(), workers = [], windowListeners = new Set(), portMessages = [];
  const trackPort = port => {
    ports.add(port); port.once('close', () => ports.delete(port));
    const postMessage = port.postMessage.bind(port);
    port.postMessage = (message, transfer) => { portMessages.push({port, message}); return postMessage(message, transfer); };
    return port;
  };
  globalThis.MessageChannel = class {
    constructor() {
      const channel = new NodeMessageChannel();
      for (const port of [channel.port1, channel.port2]) {
        trackPort(port);
      }
      return channel;
    }
  };
  globalThis.window = {setTimeout, clearTimeout,
    addEventListener(type, listener) { windowListeners.add(listener); },
    removeEventListener(type, listener) { windowListeners.delete(listener); },
  };
  globalThis.AudioContext = globalThis.AudioWorkletNode = class {
    constructor() { throw new Error('Native lifecycle test attempted Web Audio'); }
  };
  const url = new URL('./playground_logic_worker.js', import.meta.url).href;
  globalThis.Worker = class {
    constructor() {
      this.pending = []; this.messages = []; this.heldResponses = []; this.heldNotifications = []; this.ready = false;
      this.closedHeldResponses = new Set(); this.releasedResponses = new Set();
      workers.push(this);
      this.worker = new NodeWorker(`
        const {parentPort}=require('node:worker_threads');
        globalThis.self=globalThis;
        globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
        const held=new Map();
        import(${JSON.stringify(url)}).then(()=>{
          parentPort.on('message',data=>{
            if(data.holdCreationResponseForTest){
              const message=data.message;held.set(message.id,message);
              message.value.port.once('close',()=>parentPort.postMessage({closedHeldResponseForTest:message.id}));
              return;
            }
            if(data.releaseCreationResponsesForTest){
              for(const id of data.releaseCreationResponsesForTest){
                const message=held.get(id);if(!message)throw Error('Unknown held creation response');
                held.delete(id);self.onmessage({data:message});
                parentPort.postMessage({releasedHeldResponseForTest:id});
              }
              return;
            }
            self.onmessage({data});
          });
          parentPort.postMessage({readyForTest:true});
        });`, {eval: true});
      this.worker.on('message', data => {
        if (data.readyForTest) {
          this.ready = true;
          for (const [message, transfer] of this.pending.splice(0)) this.worker.postMessage(message, transfer);
          return;
        }
        if (data.closedHeldResponseForTest) { this.closedHeldResponses.add(data.closedHeldResponseForTest); return; }
        if (data.releasedHeldResponseForTest) { this.releasedResponses.add(data.releasedHeldResponseForTest); return; }
        this.messages.push(data);
        this.onmessage?.({data});
      });
      this.worker.on('error', error => this.onerror?.({message: error.message}));
    }
    postMessage(message, transfer) {
      if (holdNotification(message)) { assert(!transfer?.length); this.heldNotifications.push(message); return; }
      if (holdResponse(message)) {
        // Transfer exactly once at the original send boundary, then hold the
        // message inside the real Worker before its production onmessage.
        // Closing its peer may close this queued port; delivery must not try
        // transferring that already-closed port a second time.
        assert.equal(transfer?.length, 1); assert.equal(transfer[0], message.value.port);
        this.heldResponses.push(message.id);
        this.worker.postMessage({holdCreationResponseForTest:true,message},transfer); return;
      }
      if (this.ready) this.worker.postMessage(message, transfer);
      else this.pending.push([message, transfer]);
    }
    releaseResponses() {
      const ids=this.heldResponses.splice(0);
      if(ids.length)this.worker.postMessage({releaseCreationResponsesForTest:ids});
    }
    releaseNotifications() { for (const message of this.heldNotifications.splice(0)) this.worker.postMessage(message); }
    terminate() {
      if (this.terminated) return this.terminated;
      // Unsent startup messages still belong to the host. Held creation
      // responses are already owned by the Worker and retire with its thread.
      for (const [, transfer] of this.pending) for (const port of transfer ?? []) port.close?.();
      this.pending.length = this.heldResponses.length = this.heldNotifications.length = 0;
      return this.terminated = this.worker.terminate();
    }
  };
  t.after(async () => {
    for (const worker of workers) await worker.terminate();
    for (const port of ports) port.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {workers, ports, windowListeners, portMessages};
}

function initialState(kind) {
  if (kind === 'ymf262') return {chip: kind, channels: 18, clock: CHIP_CLOCKS.ymf262, registers: Array(512).fill(0), effectiveRegisters: Array(512).fill(0), effectiveFourOpMask: 0, newMode: false, layoutRevision: 0, layoutPending: false, status: 0, irq: false, held: [], pendingCommands: []};
  if (kind === 'dx7') return {voices: [Array.from(createInitVoice())], selectedVoice: 0, activeNotes: [], held: [], pendingCommands: []};
  if (kind === 'pwm') return {model: 'mame', outputMode: 'duty', clock: CHIP_CLOCKS.pwm, sampleRate: 48000, currentFrame: 0, queuedWrites: 0, registers: [0, 0, 16384, 16384, 16384]};
  if (kind === 'snes') return {registers: Array(128).fill(0), nativeFrames: 0, enabled: 0, held: [], pendingCommands: [], timeline: {loaded: false, playing: false, ended: false, positionFrames: 0, totalFrames: 0}};
  if (kind === 'spc') return {ready: true, loaded: false, playing: false, paused: false, muteMask: 0, sampleRate: 48000, nativeSampleRate: 32000, playbackNativeFrames: 0, positionSeconds: 0, renderedNativeFrames: 0};
  return {};
}

export function createLifecycleFixture(t, environment, {mode = 'genesis'} = {}) {
  const calls = [], errors = [], logs = [], rack = new Map(), pendingIPC = new Set(), createRequests = [];
  let gate = null, revision = 0, closed = false;
  const started = Date.now(), now = () => Date.now() - started;
  const status = () => ({session: 1, mode, engine: 'ymfm', sampleRate: 48000, frame: Math.floor(now() * 48), ymClock: 7670454, psgClock: 3579545, running: true});
  const image = item => ({[item.kind === 'segapsg' ? 'psg' : item.kind]: structuredClone(item.state), sampleRate: 48000, frame: status().frame, revision: ++revision});
  const invoke = async (command, args = {}) => {
    const request = {command, args}; calls.push(request); pendingIPC.add(request);
    try {
      const match = /^native_genesis_extra_(\w+)_(create|dispose|status)$/.exec(command);
      if (match) {
        const kind = match[1] === 'psg' ? 'segapsg' : match[1], operation = match[2];
        if (operation === 'create') {
          assert(!rack.has(args.instance), 'Native instance numbers are never reused');
          const item = {kind, instance: args.instance, state: initialState(kind), reservation: 1};
          rack.set(args.instance, item); createRequests.push(request);
          const response = image(item), waiting = gate;
          if (waiting) await waiting.promise;
          return response;
        }
        if (operation === 'dispose') { rack.delete(args.instance); return true; }
        const item = rack.get(args.instance);
        if (!item) throw new DOMException('Disposed Native instance', 'AbortError');
        return image(item);
      }
      if (command === 'native_genesis_commands') {
        for (const entry of args.commands) {
          const item = rack.get(entry.instance);
          if (item?.kind === 'snes' && entry.message?.method === 'reset-state') item.state.registers = entry.message.dsp.slice();
        }
      }
      if (command === 'native_genesis_opl_status') return {...status(), ym3526: {clock: CHIP_CLOCKS.ym3526, registers: Array(256).fill(0), held: []}};
      if (command === 'native_genesis_stop' || command === 'native_genesis_shutdown') rack.clear();
      return status();
    } finally { pendingIPC.delete(request); }
  };
  const synth = new NativeGenesisSynth({invoke, now, mode, onError: error => errors.push(error)});
  assert.deepEqual([...synth.capabilities.dynamicSoundChipKinds].sort(), [...EXTRA_KINDS].sort(), 'the matrix covers every public Native additional kind');
  // File acquisition is unrelated to creation lifetime and remains a stub;
  // endpoint initialize, uploads and all lifecycle machinery are production.
  const createOpna = synth.createExtraYm2608.bind(synth);
  synth.createExtraYm2608 = options => createOpna({...options, fetcher: async () => ({ok: true, arrayBuffer: async () => new Uint8Array(8192).buffer})});
  const runtime = createPlaygroundRuntime({synth, mode, guardExecution: false, onLog: line => logs.push(line)});
  async function finalize() {
    if (closed) return; closed = true;
    gate?.resolve(); gate = null;
    await runtime.finalize();
    for (const worker of environment.workers) await worker.terminate();
    await until(() => !pendingIPC.size && !rack.size && !synth.extraDevices.size && !synth.mixer.reservedIds.size, 'final instance/IPC/ID retirement');
    await until(() => !environment.ports.size && !environment.windowListeners.size, 'final host ports/listeners retirement');
    for (const [name, value] of Object.entries(synth)) if (name.startsWith('extra') && value instanceof Map) assert.equal(value.size, 0, `${name} retired`);
    assert.equal(synth.acceptedRequests, 0); assert.equal(synth.acceptedCommands, 0); assert.equal(synth.acceptedPcmBytes, 0);
    assert(environment.workers.every(worker => worker.worker.threadId === -1));
    assert.equal(synth.audioContext, null); assert.equal(synth.node, null);
    assert.deepEqual(errors, []);
  }
  t.after(finalize);
  return {synth, runtime, calls, errors, logs, rack, pendingIPC, createRequests,
    setGate(value) { gate = value; }, finalize,
    commands: () => calls.flatMap(call => call.command === 'native_genesis_commands' ? call.args.commands : []),
    disposeCount(instance) { return calls.filter(call => call.command.endsWith('_dispose') && call.args.instance === instance).length; },
    reservedNativeUnits: () => [...rack.values()].reduce((sum, item) => sum + item.reservation, 0),
  };
}
