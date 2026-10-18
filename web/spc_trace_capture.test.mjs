import test from 'node:test';
import assert from 'node:assert/strict';
import factory from '../docs/generated/spc_wasm.js';
import {captureSpcTrace} from './spc_trace.js';
import {createSyntheticSpc} from './spc_test_fixture.mjs';

test('offline conversion rejects invalid time/event bounds before initializing WASM', async () => {
  let created = 0;
  const options = {moduleFactory:() => {created++; throw Error('Unexpected initialization');}};
  for (const durationSeconds of [undefined, NaN, Infinity, -1, 0, 0.099, 601]) {
    await assert.rejects(captureSpcTrace(createSyntheticSpc(), {...options, durationSeconds}), /Conversion seconds/);
  }
  for (const maxEvents of [0, -1, NaN, Infinity, 1.5, 1000001]) {
    await assert.rejects(captureSpcTrace(createSyntheticSpc(), {...options, durationSeconds:1, maxEvents}), /maxEvents/);
  }
  assert.equal(created, 0);
});

test('offline conversion cancellation before initialization creates no emulator', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(captureSpcTrace(createSyntheticSpc(), {durationSeconds:1, signal:controller.signal,
    moduleFactory:() => {throw Error('Unexpected initialization');}}), {name:'AbortError'});
});

test('offline conversion yields progress and releases its emulator after cancellation or overflow', async () => {
  let disposed = 0;
  const moduleFactory = async options => {
    const module = await factory(options), destroy = module._spc_destroy;
    module._spc_destroy = handle => {disposed++; destroy(handle);}; return module;
  };
  const controller = new AbortController(), progress = [];
  await assert.rejects(captureSpcTrace(createSyntheticSpc(), {durationSeconds:2, moduleFactory,
    signal:controller.signal, onProgress:value => {progress.push(value); controller.abort();}}), {name:'AbortError'});
  assert(progress.length === 1 && progress[0].ratio > 0 && progress[0].ratio < 1);
  assert.equal(disposed, 1);
  const manyDspWrites = createSyntheticSpc();
  manyDspWrites.set([0x8f,0x0c,0xf2,0x8f,64,0xf3,0x2f,0xfb], 0x100 + 0x200);
  await assert.rejects(captureSpcTrace(manyDspWrites, {durationSeconds:1, moduleFactory, maxEvents:1}), /trace limit exceeded/);
  assert.equal(disposed, 2);
  const completed = [];
  const trace = await captureSpcTrace(createSyntheticSpc(), {durationSeconds:0.1, moduleFactory, onProgress:value => completed.push(value)});
  assert.equal(trace.durationClocks, 102400); assert.equal(completed.at(-1).ratio, 1);
  assert.equal(disposed, 3);
});

test('filtered recording bypasses the event cap for busy work RAM and stays cancellable in its second pass', async () => {
  const progress = [];
  const trace = await captureSpcTrace(createSyntheticSpc(), {durationSeconds:1, moduleFactory:factory,
    maxEvents:1, onProgress:value => progress.push(value)});
  assert.equal(trace.events.length, 0, 'A CPU counter outside DSP reads must not consume event capacity');
  assert.equal(trace.optimization.kind, 'dsp-ram-read-set');
  assert(progress.some(value => value.stage === 'analyze') && progress.some(value => value.stage === 'record'));
  assert.equal(progress.at(-1).ratio, 1);
  const controller = new AbortController();
  await assert.rejects(captureSpcTrace(createSyntheticSpc(), {durationSeconds:1, moduleFactory:factory,
    signal:controller.signal, onProgress:value => {if (value.stage === 'record') controller.abort();}}), {name:'AbortError'});
});
