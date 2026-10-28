import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';

const workerUrl = new URL('../docs/playground/playground_sample_editor_worker.js', import.meta.url).href;

async function createWorker(t) {
  const worker = new Worker(`
    const {parentPort} = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (message, transfer = []) => parentPort.postMessage({message, transferCount: transfer.length}, transfer);
    import(${JSON.stringify(workerUrl)}).then(() => {
      parentPort.on('message', data => self.onmessage({data}));
      parentPort.postMessage({ready:true});
    });`, {eval:true});
  t.after(() => worker.terminate());
  const [ready] = await once(worker, 'message');
  assert.equal(ready.ready, true);
  let id = 0;
  const pending = new Map();
  worker.on('message', reply => {
    const request = pending.get(reply.message.id);
    if (!request) return;
    pending.delete(reply.message.id);
    request.resolve(reply);
  });
  worker.on('error', error => {for (const request of pending.values()) request.reject(error); pending.clear();});
  return (command, data = {}) => new Promise((resolve,reject) => {
    const requestId = ++id;
    pending.set(requestId, {resolve,reject});
    worker.postMessage({id:requestId, command, ...data});
  });
}

const source = (frames = 112) => ({sampleRate:44100,
  channels:[Float32Array.from({length:frames}, (_,i) => .6*Math.sin(2*Math.PI*i/112))]});
const settings = {rootMidi:69, tuneCents:17, loopEnabled:true,
  loopStartFrame:13, loopEndFrame:111, fadeInSeconds:0, fadeOutSeconds:0};
const value = reply => {assert.equal(reply.message.error, undefined, reply.message.error); return reply.message.value;};

test('deployed Sample Editor Worker transfers bounded PS1 comparison and canonical conversion without detaching its source', async t => {
  const job = await createWorker(t);
  value(await job('source', {audio:source(1120)}));
  const comparisonReply = await job('ps1-comparison', {settings:{...settings,endFrame:1120,loopEndFrame:1107}});
  const comparison = value(comparisonReply);
  assert.ok(comparison.sourceDisplay instanceof Float32Array);
  assert.ok(comparison.decodedDisplay instanceof Float32Array);
  assert.ok(comparison.sourceDisplay.length <= 256 && comparison.decodedDisplay.length <= 256);
  assert.equal(comparison.channels, undefined);
  assert.equal(comparison.decodedChannels, undefined);
  assert.equal(comparison.adpcm, undefined);
  assert.equal(comparisonReply.transferCount, 2);
  assert.deepEqual(comparison.alignment.applied, {startFrame:28,endFrame:1092});

  const options = {target:'ps1',sampleRate:8000};
  const firstReply = await job('render', {settings,options}), first = value(firstReply);
  assert.equal(first.sampleRate, 44100, 'PS1 ignores the variable-rate selector');
  assert.equal(first.target, 'ps1');
  assert.equal(first.decodedChannels, undefined, 'runtime does not receive unused raw decode');
  assert.equal(firstReply.transferCount, 2, 'PCM and ADPCM transfer once each');
  assert.ok(first.adpcm instanceof Uint8Array && first.adpcm.byteLength > 0);
  assert.ok(first.channels[0] instanceof Float32Array && first.channels[0].length > 0);
  const second = value(await job('render', {settings,options}));
  assert.deepEqual(second.adpcm, first.adpcm);
  assert.deepEqual(second.channels, first.channels, 'repeated conversion can still read the original Worker recording');
  const original = value(await job('render', {settings, options:{target:'original',sampleRate:44100}}));
  assert.equal(original.channels[0].length,1120, 'conversion never crops the retained original recording');
});

test('deployed Sample Editor Worker returns errors for invalid PS1 loops and real SPU preview snapshots source before asynchronous load', async t => {
  const job = await createWorker(t);
  value(await job('source', {audio:source()}));
  const invalid = await job('render', {settings:{...settings,loopStartFrame:13,loopEndFrame:40},options:{target:'ps1'}});
  assert.match(invalid.message.error, /28|align|loop/i);

  const expected = value(await job('ps1-preview', {settings}));
  const inFlight = job('ps1-preview', {settings});
  const replacement = source(); replacement.channels[0].fill(0);
  value(await job('source', {audio:replacement}));
  const snapshotted = value(await inFlight);
  assert.equal(expected.sampleRate,44100);
  assert.equal(expected.loopEnabled,false);
  assert.equal(expected.channels.length,2);
  assert.equal(expected.channels[0].length,37485);
  assert.ok(expected.channels.every(channel => channel.every(Number.isFinite)));
  assert.ok(expected.channels[0].some(sample => Math.abs(sample)>.001));
  assert.deepEqual(snapshotted.channels, expected.channels,
    'an async preview cannot switch to a replacement recording midway through preparation');
  assert.deepEqual(snapshotted.adpcm,expected.adpcm);
  const silent = value(await job('render', {settings,options:{target:'ps1'}}));
  assert.ok(silent.channels[0].every(sample => sample === 0));
});
