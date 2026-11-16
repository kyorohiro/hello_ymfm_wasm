import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisMsx} from '../../tetorica_src/runtime/native_genesis_msx.js';
import {createNativeGenesisAy8910Endpoint} from '../../tetorica_src/runtime/native_genesis_extra_ay8910.js';

function fixture(createEndpoint) {
  const commands = [], requests = [];
  let flushes = 0;
  const synth = {
    session: 1,
    generation: 1,
    clock: {sampleRate: 48000},
    stopping: false,
    closing: false,
    isReady: () => true,
    frameAt: seconds => Math.round(seconds * 48000),
    enqueue(command) { commands.push(command); },
    async flush() { flushes++; },
    async nativeRequest(...args) {
      requests.push(args);
      throw new Error('Unexpected Native state request');
    },
  };
  const endpoint = createEndpoint(synth);
  return {endpoint, client:endpoint.client, commands, requests, getFlushes:() => flushes};
}

const endpoints = {
  'MSX primary': synth => createNativeGenesisMsx(synth).ay8910,
  'additional AY': createNativeGenesisAy8910Endpoint,
};

for (const [label, createEndpoint] of Object.entries(endpoints)) {
  test(`${label} exposes local timed-operation compilation with explicit baseline completeness`, async () => {
    const f = fixture(createEndpoint), client = f.client;
    const program = client.build(b => b.setMixer(0, {tone:true}).setEnvelope({shape:8}).setEnvelope({shape:8}));
    assert.equal(f.commands.length, 0);
    assert.equal(f.getFlushes(), 0);
    assert.equal(client._timedClientStateComplete, false);
    await assert.rejects(client.compile(program, {initialState:'client'}), /Incomplete AY client state/);
    const reset = await client.compile(program, {initialState:'reset'});
    assert.deepEqual(reset.map(row => [row.register,row.value]), [[7,0],[13,8],[13,8]]);
    assert.equal(f.commands.length, 0);
    assert.equal(f.getFlushes(), 0);

    await f.endpoint.initialize();
    assert.equal(client._timedClientStateComplete, true);
    client.setVolume(0, 5);
    client.keyOff(0);
    const state = client._getState(), count = f.commands.length, flushes = f.getFlushes();
    const compiled = await client.compile(client.build(b => b.keyOn(0)), {initialState:'client'});
    assert.deepEqual(compiled.map(row => [row.register,row.value]), [[8,5]]);
    assert.deepEqual(client._getState(), state);
    assert.equal(f.commands.length, count);
    assert.equal(f.getFlushes(), flushes);
    assert.deepEqual(f.requests, []);

    client.adoptRegisterSnapshot(Array(16).fill(0));
    assert.equal(client._timedClientStateComplete, false);
    await assert.rejects(client.compile(program, {initialState:'client'}), /Incomplete AY client state/);
    client._adoptState({registers:Array(16).fill(0),levels:[0,7,9],clock:2000000,initialized:true});
    assert.equal(client._timedClientStateComplete, true);
    const zero = await client.compile(client.build(b => b.keyOn(0)), {initialState:'client'});
    assert.equal(zero[0].value, 0);
    const pitch = await client.compile(client.build(b => b.setFrequency(1, 440)), {initialState:'client'});
    assert.deepEqual(pitch.map(row => row.value), [28,1]);
    assert.equal(f.commands.length, count);
    assert.equal(f.getFlushes(), flushes);
    assert.deepEqual(f.requests, []);
  });

  test(`${label} rejects renderer capture and scheduling before any bridge request`, async () => {
    const f = fixture(createEndpoint), client = f.client;
    await f.endpoint.initialize();
    const program = client.build(b => b.setEnvelope({shape:8}));
    const count = f.commands.length, flushes = f.getFlushes();
    for (const operation of [
      () => client.captureState(),
      () => client.compile(program),
      () => client.compile(program, {initialState:'current'}),
      () => client.schedule(program, {name:'buzzer',repeatSeconds:1/110}),
      () => client.clearSchedule('buzzer'),
    ]) await assert.rejects(operation(), /AudioWorklet.*Native/);
    assert.equal(f.commands.length, count);
    assert.equal(f.getFlushes(), flushes);
    assert.deepEqual(f.requests, []);
  });

  test(`${label} keeps completeness across forced releases and reset state adoption`, async () => {
    const f = fixture(createEndpoint), client = f.client;
    await f.endpoint.initialize();
    client.setVolume(0, 7);
    client._forceKeyOff(0);
    assert.equal(client._timedClientStateComplete, true);
    const rows = await client.compile(client.build(b => b.keyOn(0)), {initialState:'client'});
    assert.equal(rows[0].value, 7);
    f.endpoint.reset();
    assert.equal(client._timedClientStateComplete, true);
    const resetRows = await client.compile(client.build(b => b.keyOn(0)), {initialState:'client'});
    assert.equal(resetRows[0].value, 9);
  });
}
