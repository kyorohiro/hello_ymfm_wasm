import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudioDiagnostics, encodeDiagnosticWav} from './playground_audio_diagnostics.js';

function eventTarget() {
  const listeners = new Map();
  return {listeners,
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, value = {}) { for (const callback of [...listeners.get(type) ?? []]) callback(value); },
  };
}

function element(tag) {
  return {...eventTarget(), tag, children: [], attributes: {},
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); },
  };
}

function node(context) {
  return {...eventTarget(), context, connections: [], disconnects: [],
    connect(target, output = 0, input = 0) { this.connections.push({target, output, input}); },
    disconnect(...args) {
      this.disconnects.push(args);
      this.connections = args.length ? this.connections.filter(c => c.target !== args[0] ||
        (args.length > 1 && c.output !== args[1]) || (args.length > 2 && c.input !== args[2])) : [];
    },
  };
}

function setup(t, options = {}) {
  const host = element('div'), document = {createElement: element};
  const timers = new Map(), taps = [], downloads = [], gains = [];
  let timerSequence = 0, wall = 1000, modules = 0, releases = 0;
  const context = {...eventTarget(), state: 'running', sampleRate: options.sampleRate ?? 48000, currentTime: 2,
    destination: {}, audioWorklet: {async addModule() { modules++; if (options.module) await options.module(); }},
    createGain() { const gain = node(context); gains.push(gain); return gain; },
  };
  const audibleDestination = {}, raw = node(context); raw.connect(audibleDestination);
  const monitors = new Set();
  const synth = {audioContext: context, node: raw, audio: {
    connectOutputMonitor(bridge) {
      if (options.monitorThrows) throw Error('monitor failed');
      monitors.add(bridge); return () => { releases++; monitors.delete(bridge); };
    },
  }};
  let source = options.idle ? null : synth;
  class Worklet {
    constructor(ctx, name, configuration) {
      if (options.nodeThrows) throw Error('node failed');
      Object.assign(this, node(ctx)); this.name = name; this.configuration = configuration;
      this.port = {sent: [], closed: false, onmessage: null,
        postMessage(data, transfers = []) {
          this.sent.push({data: structuredClone(data, {transfer: transfers}), transferCount: transfers.length});
        },
        close() { this.closed = true; },
      };
      taps.push(this);
    }
    reply(data) { this.port.onmessage?.({data}); }
  }
  const controller = createAudioDiagnostics({getSynth: () => source, getMetadata: () => ({mode: 'genesis', worker: false}),
    host, document, AudioWorkletNodeClass: Worklet, seconds: options.seconds ?? 0.002,
    download: (blob, name) => downloads.push({blob, name}), now: () => wall++,
    setTimer: (callback, milliseconds) => { const id = ++timerSequence; timers.set(id, {callback, milliseconds}); return id; },
    clearTimer: id => timers.delete(id),
  });
  t.after(() => controller.dispose());
  const buttons = Object.fromEntries(controller.element.children[2].children.map(button => [button.textContent, button]));
  const status = controller.element.children[3];
  const arm = () => taps.at(-1).port.sent.find(message => message.data.type === 'arm').data;
  const acknowledge = () => taps.at(-1).reply({type: 'armed', id: arm().id});
  const finish = (extra = {}) => {
    const payload = arm();
    taps.at(-1).reply({type: 'result', id: payload.id, channels: payload.channels, frames: 64,
      sampleRate: context.sampleRate, firstFrame: 96000, lastFrame: 96064, blocks: 1,
      frameGaps: 0, missingInputFrames: [0, 0], startedAtWallMs: 1005,
      maxWallGapMs: 0, maxProcessMs: 0, clockBacksteps: 0, reason: 'stopped', ...extra});
  };
  return {controller, context, raw, synth, audibleDestination, taps, gains, monitors, downloads, timers,
    buttons, status, host, arm, acknowledge, finish, setSource: value => { source = value; },
    get modules() { return modules; }, get releases() { return releases; }};
}

test('diagnostics do not initialize idle audio or load a processor before an explicit record request', async t => {
  const f = setup(t, {idle: true});
  assert.equal(f.modules, 0); assert.equal(f.taps.length, 0);
  await f.controller.start();
  assert.equal(f.modules, 0); assert.equal(f.taps.length, 0);
  assert.match(f.status.textContent, /Press Run/);
  assert.equal(f.controller.getState().phase, 'idle');
  f.setSource(f.synth); f.context.state = 'suspended';
  await f.controller.start();
  assert.equal(f.modules, 0);
});

test('recording adds only silent observation branches, transfers bounded Main buffers once and returns exact data', async t => {
  const f = setup(t);
  await f.controller.start();
  assert.equal(f.modules, 1); assert.equal(f.controller.getState().phase, 'preparing');
  const tap = f.taps[0], arm = f.arm();
  assert.equal(tap.name, 'tetorica-audio-diagnostic');
  assert.deepEqual(tap.configuration.outputChannelCount, [2]);
  assert.equal(tap.configuration.numberOfInputs, 2);
  assert.equal(arm.channels.length, 4); assert.equal(arm.channels[0].length, 96);
  assert.equal(tap.port.sent[0].transferCount, 4);
  assert.deepEqual(f.raw.connections.map(c => c.target), [f.audibleDestination, tap]);
  assert.deepEqual(f.gains[0].connections, [{target: tap, output: 0, input: 1}]);
  assert.equal(f.monitors.size, 1); assert.equal(tap.connections[0].target, f.context.destination);
  f.acknowledge(); assert.equal(f.controller.getState().phase, 'recording');
  assert.equal(f.timers.size, 0);
  arm.channels[0][0] = 1.5; arm.channels[1][0] = -0.125;
  arm.channels[2][0] = 0.75; arm.channels[3][0] = -0.0625;
  f.controller.markNoise();
  f.controller.stop(); f.controller.stop();
  assert.equal(tap.port.sent.filter(message => message.data.type === 'stop').length, 1);
  assert.equal(f.controller.getState().phase, 'stopping');
  f.finish();
  assert.equal(f.controller.getState().phase, 'ready');
  assert.equal(f.controller.getResult().channels[0][0], 1.5);
  assert.equal(f.controller.getResult().report.marks[0].frameOffset, 0);
  assert.equal(f.controller.getResult().report.metadata.mode, 'genesis');
  assert.equal(f.timers.size, 0); assert.equal(f.monitors.size, 0); assert.equal(f.releases, 1);
  assert.deepEqual(f.raw.connections, [{target: f.audibleDestination, output: 0, input: 0}]);
  assert.deepEqual(f.raw.disconnects, [[tap, 0, 0]]);
  assert.equal(tap.port.closed, true); assert.equal(tap.port.onmessage, null);
  assert.equal(f.context.listeners.get('statechange').size, 0);
  assert.equal(f.buttons['Save chip WAV'].disabled, false);
  f.controller.save('chip'); f.controller.save('output'); f.controller.save('json');
  assert.equal(f.downloads.length, 3);
  const wav = new DataView(await f.downloads[0].blob.arrayBuffer());
  assert.equal(wav.getFloat32(44, true), 1.5); assert.equal(wav.getFloat32(48, true), -0.125);
  const output = new DataView(await f.downloads[1].blob.arrayBuffer());
  assert.equal(output.getFloat32(44, true), 0.75); assert.equal(output.getFloat32(48, true), -0.0625);
  const report = JSON.parse(await f.downloads[2].blob.text());
  assert.equal(report.capture.frames, 64); assert.equal(report.channels, undefined);
  assert.match(report.limitations, /do not prove/);
});

test('automatic completion, marker limits and repeated captures retain no old connections or timers', async t => {
  const f = setup(t);
  await f.controller.start(); f.acknowledge();
  for (let i = 0; i < 40; i++) f.controller.markNoise();
  f.finish({reason: 'complete'});
  assert.equal(f.controller.getResult().report.marks.length, 32);
  assert.equal(f.controller.getResult().report.droppedMarkers, 8);
  const old = f.taps[0], oldId = f.arm().id;
  await f.controller.start();
  assert.equal(f.modules, 1); assert.equal(f.controller.getResult(), null);
  assert.equal(f.taps.length, 2); assert.notEqual(f.arm().id, oldId);
  f.taps[1].reply({type: 'armed', id: oldId});
  assert.equal(f.controller.getState().phase, 'preparing');
  old.reply({type: 'armed', id: oldId});
  assert.equal(f.controller.getState().phase, 'preparing');
  f.acknowledge(); f.finish();
  assert.equal(f.monitors.size, 0); assert.equal(f.releases, 2);
  assert.equal(f.raw.connections.length, 1); assert.equal(f.timers.size, 0);
});

test('Stop and disposal while module loading prevent late graph creation', async t => {
  let release;
  const loading = new Promise(resolve => { release = resolve; });
  const f = setup(t, {module: () => loading});
  const first = f.controller.start();
  assert.equal(f.controller.getState().phase, 'preparing');
  f.controller.stop(); assert.equal(f.controller.getState().phase, 'idle');
  const second = f.controller.start();
  f.controller.dispose(); f.controller.dispose(); release();
  await Promise.all([first, second]);
  assert.equal(f.taps.length, 0); assert.equal(f.monitors.size, 0);
  assert.equal(f.controller.getState().phase, 'disposed'); assert.equal(f.host.children.length, 0);
  assert.equal(f.context.listeners.get('statechange').size, 0);
  assert.equal(f.buttons['Record 30 s'].listeners.get('click').size, 0);
});

test('audio replacement during asynchronous loading never taps a stale session', async t => {
  let release;
  const f = setup(t, {module: () => new Promise(resolve => { release = resolve; })});
  const started = f.controller.start();
  f.setSource({...f.synth}); release(); await started;
  assert.equal(f.taps.length, 0); assert.equal(f.controller.getState().phase, 'idle');
  assert.match(f.status.textContent, /session changed/);
});

test('partial setup failures close owned resources and leave the audible connection intact', async t => {
  const f = setup(t, {monitorThrows: true});
  await f.controller.start();
  assert.equal(f.controller.getState().phase, 'idle'); assert.match(f.status.textContent, /monitor failed/);
  assert.equal(f.gains[0].connections.length, 0); assert.equal(f.taps[0].port.closed, true);
  assert.equal(f.raw.connections.length, 1); assert.equal(f.raw.connections[0].target, f.audibleDestination);
  assert.equal(f.context.listeners.get('statechange').size, 0);
});

test('closing audio, processor errors and missing acknowledgements cancel instead of hanging', async t => {
  const f = setup(t);
  await f.controller.start();
  const armTimeout = [...f.timers.values()][0]; assert.equal(armTimeout.milliseconds, 5000);
  armTimeout.callback();
  assert.equal(f.controller.getState().phase, 'idle'); assert.equal(f.monitors.size, 0);
  await f.controller.start(); f.acknowledge(); f.controller.stop();
  const stopTimeout = [...f.timers.values()][0]; assert.equal(stopTimeout.milliseconds, 3000);
  stopTimeout.callback(); assert.equal(f.controller.getState().phase, 'idle');
  await f.controller.start(); f.acknowledge(); f.taps.at(-1).emit('processorerror');
  assert.equal(f.controller.getState().phase, 'idle'); assert.match(f.status.textContent, /processor failed/);
  await f.controller.start();
  f.taps.at(-1).reply({type: 'error', id: f.arm().id, error: 'Invalid buffers'});
  assert.equal(f.controller.getState().phase, 'idle'); assert.match(f.status.textContent, /Invalid buffers/);
  await f.controller.start(); f.acknowledge();
  f.context.state = 'closed'; f.context.emit('statechange');
  assert.equal(f.controller.getState().phase, 'idle'); assert.match(f.status.textContent, /audio was closed/);
  assert.equal(f.monitors.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.raw.connections.length, 1);
});

test('malformed or oversized results cannot become downloadable recordings', async t => {
  const f = setup(t);
  await f.controller.start(); f.acknowledge(); f.finish({frames: 97});
  assert.equal(f.controller.getResult(), null); assert.equal(f.buttons['Save JSON'].disabled, true);
  assert.match(f.status.textContent, /invalid diagnostic data/);
  await f.controller.start(); f.acknowledge(); f.finish({sampleRate: 44100});
  assert.equal(f.controller.getResult(), null); assert.equal(f.monitors.size, 0);
});

test('high sample rates respect the total 32 MiB bound rather than allocating 30 seconds unconditionally', async t => {
  const f = setup(t, {sampleRate: 192000, seconds: 100});
  await f.controller.start();
  const channels = f.arm().channels;
  assert.equal(channels.reduce((sum, channel) => sum + channel.byteLength, 0), 32 * 1024 * 1024);
  f.acknowledge(); assert.match(f.status.textContent, /10\.9 s/);
  f.controller.cancel(); assert.equal(f.monitors.size, 0); assert.equal(f.taps[0].port.closed, true);
});

test('Float32 WAV preserves stereo values outside unity and non-finite diagnostic samples', () => {
  const left = new Float32Array([1.25, NaN, Infinity, -Infinity]);
  const right = new Float32Array([-1.5, -0, 0.125, 0.25]);
  const bytes = encodeDiagnosticWav(left, right, 4, 48000), view = new DataView(bytes);
  assert.equal(view.getUint16(20, true), 3); assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint16(34, true), 32); assert.equal(view.getUint32(40, true), 32);
  assert.equal(view.getFloat32(44, true), 1.25); assert.equal(view.getFloat32(48, true), -1.5);
  assert.ok(Number.isNaN(view.getFloat32(52, true))); assert.ok(Object.is(view.getFloat32(56, true), -0));
  assert.equal(view.getFloat32(60, true), Infinity); assert.equal(view.getFloat32(68, true), -Infinity);
  assert.throws(() => encodeDiagnosticWav(left, right, 5, 48000), /frame count/);
});

function setupNative(t, options={}) {
  const f=setup(t,{sampleRate:options.sampleRate??48000,seconds:options.seconds??.002});
  let starts=0,stops=0,requested;
  const synth={capabilities:{backend:'native-genesis'},clock:f.context,isReady:()=>f.context.state==='running',
    async startOutputRecording(value){starts++;requested=value;if(options.start)await options.start();},
    async stopOutputRecording(){stops++;if(options.stop)return options.stop();return {
      sampleRate:f.context.sampleRate,frames:64,firstFrame:96000,complete:false,
      channels:[Float32Array.from({length:64},(_,index)=>index===0?1.25:0),Float32Array.from({length:64},(_,index)=>index===0?-.5:0)],
    };},
  };
  f.setSource(synth);
  return {...f,synth,get starts(){return starts;},get stops(){return stops;},get requested(){return requested;}};
}

test('native diagnostics records only final output without initializing Web Audio, then saves float WAV and clock markers',async t=>{
  const f=setupNative(t);
  await f.controller.start();assert.equal(f.starts,1);assert.equal(f.requested.seconds,.002);
  assert.equal(f.controller.getState().phase,'recording');assert.equal(f.modules,0);assert.equal(f.taps.length,0);assert.equal(f.gains.length,0);
  f.controller.markNoise();await f.controller.stop();
  assert.equal(f.stops,1);assert.equal(f.timers.size,0);assert.equal(f.controller.getState().phase,'ready');
  assert.equal(f.controller.getResult().report.backend,'native-genesis');
  assert.deepEqual(f.controller.getResult().report.channelOrder,['output-left','output-right']);
  assert.equal(f.controller.getResult().report.marks[0].frameOffset,0);
  assert.equal(f.buttons['Save chip WAV'].disabled,true);assert.equal(f.buttons['Save output WAV'].disabled,false);
  f.controller.save('chip');assert.equal(f.downloads.length,0);
  f.controller.save('output');f.controller.save('json');assert.equal(f.downloads.length,2);
  const wav=new DataView(await f.downloads[0].blob.arrayBuffer());assert.equal(wav.getFloat32(44,true),1.25);assert.equal(wav.getFloat32(48,true),-.5);
  const report=JSON.parse(await f.downloads[1].blob.text());assert.equal(report.audioContext,null);assert.equal(report.nativeClock.sampleRate,48000);assert.match(report.limitations,/do not prove/);
  assert.equal(f.context.listeners.get('statechange').size,0);
});

test('native diagnostics automatically stops at its frame and memory bound',async t=>{
  const f=setupNative(t,{sampleRate:384000,seconds:100});
  await f.controller.start();
  assert.equal(f.requested.seconds,(32*1024*1024/8)/384000);
  const timer=[...f.timers.values()][0];assert.equal(timer.milliseconds,f.requested.seconds*1000);
  timer.callback();for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(f.stops,1);assert.equal(f.controller.getState().phase,'ready');assert.equal(f.timers.size,0);
});

test('native cancellation and disposal wait for pending start and finalize exactly once before replacement',async t=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const f=setupNative(t,{start:()=>pending});
  const first=f.controller.start();await Promise.resolve();await Promise.resolve();
  assert.equal(f.starts,1);f.controller.cancel();
  const second=f.controller.start();await Promise.resolve();assert.equal(f.starts,1);
  release();await first;await second;
  assert.equal(f.stops,1);assert.equal(f.starts,2);assert.equal(f.controller.getState().phase,'recording');
  f.controller.dispose();await Promise.resolve();await Promise.resolve();
  assert.equal(f.stops,2);assert.equal(f.controller.getResult(),null);assert.equal(f.controller.getState().phase,'disposed');assert.equal(f.timers.size,0);
});

test('native pending stop, session replacement and cancellation cannot publish stale results',async t=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const f=setupNative(t,{stop:()=>pending});
  await f.controller.start();const stopping=f.controller.stop();await Promise.resolve();assert.equal(f.stops,1);
  f.controller.dispose();release({sampleRate:48000,frames:0,firstFrame:1,complete:false,channels:[new Float32Array(0),new Float32Array(0)]});await stopping;
  assert.equal(f.stops,1);assert.equal(f.controller.getResult(),null);assert.equal(f.controller.getState().phase,'disposed');
  const g=setupNative(t);await g.controller.start();g.setSource({...g.synth});await g.controller.stop();
  assert.equal(g.controller.getResult(),null);assert.match(g.status.textContent,/session changed/);
});

test('native idle, start failures and malformed results leave no capture or fake audio node',async t=>{
  const idle=setupNative(t);idle.context.state='suspended';await idle.controller.start();assert.equal(idle.starts,0);assert.match(idle.status.textContent,/Press Run/);
  const failed=setupNative(t,{start:()=>{throw Error('already active');}});await failed.controller.start();await Promise.resolve();
  assert.equal(failed.stops,0);assert.equal(failed.controller.getState().phase,'idle');assert.match(failed.status.textContent,/already active/);
  const malformed=setupNative(t,{stop:()=>({sampleRate:48000,frames:1000,firstFrame:0,channels:[new Float32Array(1000),new Float32Array(1000)]})});
  await malformed.controller.start();await malformed.controller.stop();assert.equal(malformed.controller.getResult(),null);assert.match(malformed.status.textContent,/invalid native/);
  assert.equal(malformed.modules,0);assert.equal(malformed.taps.length,0);
});

test('native clock shutdown cancels capture and discards its late completion',async t=>{
  const f=setupNative(t);await f.controller.start();
  f.context.state='closed';f.context.emit('statechange');
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(f.stops,1);assert.equal(f.controller.getState().phase,'idle');assert.equal(f.controller.getResult(),null);assert.equal(f.timers.size,0);
  assert.equal(f.context.listeners.get('statechange').size,0);
});
