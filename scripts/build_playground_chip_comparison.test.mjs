import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {buildChipComparisonExample, CHIP_COMPARISON_KINDS, CHIP_COMPARISON_TARGET} from './build_playground_chip_comparison.mjs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const source = buildChipComparisonExample();

function harness({failSetup = false, cancelAt = null, workerLookaheadSeconds = 0.5} = {}) {
  const events = [], active = new Set(), retiring = new Map(), sleeps = [], messages = [];
  const cancelled = new Error('Run stopped');
  const gapSeconds = Math.max(0.35, workerLookaheadSeconds + 0.1);
  const timing = Object.freeze({workerLookaheadSeconds});
  let pending = 0, effectClears = 0, timingReads = 0;
  async function createSoundChip(kind, options) {
    assert.equal(options, undefined, 'temporary IDs must not inherit a saved strip ID');
    assert.equal(active.size, 0, 'dispose the previous source before creating another');
    assert.equal(retiring.size, 0, 'wait for the Worker lookahead disposal before creating another');
    active.add(kind);
    events.push(['create', kind]);
    const facades = new Map();
    function facade(path = '') {
      if (facades.has(path)) return facades.get(path);
      const api = new Proxy({}, {get(_target, method) {
        if (method === 'then') return undefined;
        if (method === 'clock') return 12500000;
        if (method === 'pulse' || method === 'wave') return facade(`${method}.`);
        return async (...args) => {
          assert.ok(active.has(kind), `operation on disposed ${kind}`);
          assert.equal(pending, 0, 'reference methods and disposal must be awaited');
          pending++;
          try {
            await new Promise(resolve => setImmediate(resolve));
            events.push([`${path}${String(method)}`, kind]);
            if (failSetup && kind === CHIP_COMPARISON_KINDS[0] && method === 'reset') throw new Error('setup failed');
            if (method === 'dispose') {
              active.delete(kind);
              if (workerLookaheadSeconds > 0) retiring.set(kind, workerLookaheadSeconds);
            }
            if (method === 'getState') return {sampleRate: 48000, clock: 23011360};
            if (method === 'loadSample') return {start: 0, loopStart: 0, step: 100};
            if (method === 'loadBRR') return {sampleId: 0};
            if (method === 'scheduleWrites') assert.ok(args[0].length > 80000, 'use the full deterministic PWM reference');
          } finally {pending--;}
        };
      }});
      facades.set(path, api);
      return api;
    }
    return facade();
  }
  const forbidden = new Proxy({}, {get() {throw new Error('Example must not access Mixer or shared context');}});
  const run = () => new AsyncFunction('createSoundChip', 'fx', 'log', 'sleep', 'mixer', 'context', 'setMasterVolume', 'getTiming', source)(
    createSoundChip,
    {async setChain(chain) {assert.deepEqual(chain, []); effectClears++;}},
    message => messages.push(message),
    async seconds => {
      assert.equal(pending, 0, 'all setup and release commands must have settled before sleeping');
      const isGap = active.size === 0;
      if (isGap) assert.equal(seconds, gapSeconds);
      else assert.ok(seconds === 1.2 || seconds === 0.08);
      sleeps.push(seconds);
      events.push(['sleep', seconds]);
      if (seconds === cancelAt) throw cancelled;
      if (isGap) {
        for (const [kind, remaining] of retiring) {
          assert.ok(seconds > remaining, 'wait beyond the physical disposal horizon');
          retiring.delete(kind);
        }
      }
    },
    forbidden,
    forbidden,
    () => {throw new Error('Example must not change master volume');},
    async () => {timingReads++; return timing;},
  );
  return {run, events, active, retiring, sleeps, messages, cancelled, gapSeconds, get effectClears() {return effectClears;}, get timingReads() {return timingReads;}};
}

test('standalone comparison source stays reproducible and covers every measured public kind', async () => {
  assert.equal(await readFile(CHIP_COMPARISON_TARGET, 'utf8'), source);
  assert.equal(new Set(CHIP_COMPARISON_KINDS).size, 22);
  assert.equal((source.match(/await createSoundChip\(/g) ?? []).length, 22);
  assert.equal((source.match(/await (?:source|chip)\.dispose\(\)/g) ?? []).length, 22);
  assert.doesNotMatch(source, /\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|\bcontext\s*\.|calibration-source/);
  assert.doesNotMatch(source, /\bmixer\s*\.|(?<!\.)\bsetMasterVolume\s*\(/);
  assert.match(source, /SNES\/SPC BRR uses symmetric 7\/8 input headroom/);
});

test('all 22 references play once with the same duration and at most one live source', async () => {
  const h = harness();
  await h.run();
  assert.equal(h.effectClears, 1);
  assert.equal(h.timingReads, 1);
  assert.deepEqual(h.events.filter(([event]) => event === 'create').map(([,kind]) => kind), CHIP_COMPARISON_KINDS);
  assert.deepEqual(h.events.filter(([event]) => event === 'dispose').map(([,kind]) => kind), CHIP_COMPARISON_KINDS);
  assert.equal(h.active.size, 0);
  assert.equal(h.sleeps.filter(seconds => seconds === 1.2).length, 22);
  assert.equal(h.sleeps.filter(seconds => seconds === 0.08).length, 22);
  assert.equal(h.sleeps.filter(seconds => seconds === h.gapSeconds).length, 22);
  assert.equal(h.retiring.size, 0, 'the last chip must also be physically disposed before completion');
  const labels = h.messages.filter(message => /^Chip comparison \d/.test(message));
  assert.equal(labels.length, 22);
  for (const [index, kind] of CHIP_COMPARISON_KINDS.entries()) {
    assert.match(labels[index], new RegExp(`^Chip comparison ${String(index + 1).padStart(2, '0')}/22: ${kind} · (?:sine|square) · 440 Hz$`));
  }
  assert.equal(h.messages.at(-1), 'Chip comparison complete: 22/22');
});

test('Stop during a note disposes the source without sending a new key-off to a retired core', async () => {
  const h = harness({cancelAt: 1.2});
  await assert.rejects(h.run(), error => error === h.cancelled);
  const wait = h.events.findIndex(([event]) => event === 'sleep');
  assert.deepEqual(h.events.slice(wait + 1), [['dispose', 'ym2612']]);
  assert.equal(h.active.size, 0);
  assert.equal(h.messages.includes('Chip comparison complete: 22/22'), false);
});

test('a setup failure still disposes the incomplete source before leaving the sequence', async () => {
  const h = harness({failSetup: true});
  await assert.rejects(h.run(), /setup failed/);
  assert.deepEqual(h.events, [['create', 'ym2612'], ['reset', 'ym2612'], ['dispose', 'ym2612']]);
  assert.equal(h.active.size, 0);
  assert.equal(h.sleeps.length, 0);
});

test('Stop during release or the silent gap never starts the next source', async () => {
  for (const cancelAt of [0.08, 0.6]) {
    const h = harness({cancelAt});
    await assert.rejects(h.run(), error => error === h.cancelled);
    assert.deepEqual(h.events.filter(([event]) => event === 'create'), [['create', 'ym2612']]);
    assert.equal(h.active.size, 0);
    const wait = h.events.findIndex(([event, seconds]) => event === 'sleep' && seconds === cancelAt);
    assert.deepEqual(h.events.slice(wait + 1), cancelAt === 0.08 ? [['dispose', 'ym2612']] : []);
  }
});

test('gaps respect zero, default and maximum Worker lookahead and include the final disposal', async () => {
  for (const workerLookaheadSeconds of [0, 0.5, 2]) {
    const h = harness({workerLookaheadSeconds});
    await h.run();
    const gap = Math.max(0.35, workerLookaheadSeconds + 0.1);
    assert.equal(h.sleeps.filter(seconds => seconds === gap).length, 22);
    assert.equal(h.sleeps.at(-1), gap);
    assert.equal(h.retiring.size, 0);
    assert.equal(h.active.size, 0);
    assert.equal(h.timingReads, 1);
    assert.equal(h.messages.at(-1), 'Chip comparison complete: 22/22');
  }
});
