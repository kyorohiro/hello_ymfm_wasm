import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceQueue} from '../../tetorica_src/runtime/playground_performance_queue.js';

function fixture(options = {}) {
  const applied = [], replies = [];
  let frame = 0;
  const sampleRate = options.sampleRate ?? 48000;
  const queue = createPerformanceQueue({
    sampleRate,
    nowFrame: () => frame,
    apply: (command, _reply, at, metadata) => applied.push({command, at, owner: metadata.owner}),
    ...options,
  });
  const receive = data => queue.receive(data, message => replies.push(message));
  receive({type: 'performance-start', session: 1});
  return {queue, receive, applied, replies, sampleRate, setFrame: value => {frame = value;}};
}

function pattern(name, values, options = {}) {
  return {
    name,
    entries: values.map((value, index) => ({offsetSeconds: index / 1000, command: {method: 'writeRegister', args: [13, value]}})),
    performance: {session: 1, owner: 'old', time: 0},
    ...options,
  };
}

function render(fixture, totalFrames, partitions) {
  let start = 0, partition = 0;
  while (start < totalFrames) {
    const end = Math.min(totalFrames, start + partitions[partition++ % partitions.length]);
    let frame = start;
    while (frame < end) {
      fixture.setFrame(frame);
      fixture.queue.advance(frame);
      frame = Math.min(end, Math.max(frame + 1, fixture.queue.nextFrame()));
    }
    start = end;
  }
}

for (const sampleRate of [44100, 48000]) {
  test(`compact 110 Hz repetition has anchored frames and unchanged retrigger writes at ${sampleRate} Hz`, () => {
    const f = fixture({sampleRate});
    const receipt = f.queue.schedulePattern(pattern('buzzer', [8], {repeatSeconds: 1 / 110}));
    assert.equal(receipt.startFrame, 0);
    assert.equal(receipt.sampleRate, sampleRate);
    assert.equal(f.applied.length, 0);
    render(f, sampleRate * 60, [128, 17, 511, 1, 64]);
    assert.equal(f.applied.length, 6600);
    for (let cycle = 0; cycle < f.applied.length; cycle++) {
      assert.equal(f.applied[cycle].at, Math.round(cycle * (1 / 110) * sampleRate));
      assert.ok(Math.abs(f.applied[cycle].at - cycle * (1 / 110) * sampleRate) <= 0.5);
      assert.deepEqual(f.applied[cycle].command.args, [13, 8]);
    }
    assert.equal(f.queue.getStats().patternCount, 1);
    assert.equal(f.queue.getStats().storedPatternCommands, 1);
    assert.equal(f.queue.getStats().queuedBatches, 1);
    assert.equal(f.queue.getStats().lateCommands, 0);
  });
}

test('pattern results are independent of render partition size', () => {
  const outputs = [[1], [128], [19, 127, 3, 256]].map(partitions => {
    const f = fixture({sampleRate: 44100});
    f.queue.schedulePattern(pattern('three', [1, 2, 3], {repeatSeconds: 1 / 110}));
    render(f, 44100, partitions);
    return f.applied;
  });
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[0], outputs[2]);
});

test('same-frame pattern entries and legacy batches retain acceptance and authored order', () => {
  const f = fixture();
  f.receive({performance: {session: 1, owner: 'legacy', time: 0}, commands: [{method: 'legacy', value: 'first'}]});
  const spec = pattern('ordered', ['a', 'b', 'c']);
  spec.entries[1].offsetSeconds = 0;
  spec.entries[2].offsetSeconds = 0.1 / f.sampleRate;
  f.queue.schedulePattern(spec);
  f.receive({performance: {session: 1, owner: 'legacy', time: 0}, commands: [{method: 'legacy', value: 'last'}]});
  f.queue.advance(0);
  assert.deepEqual(f.applied.map(item => item.command.value ?? item.command.args[1]), ['first', 'a', 'b', 'c', 'last']);
  assert.equal(f.queue.getStats().patternCount, 0);
  assert.equal(f.queue.getStats().storedPatternCommands, 0);
});

test('pattern submissions copy nested arguments and reject uncloneable replacements atomically', () => {
  const f = fixture();
  const original = pattern('copy', [8], {repeatSeconds: 0.1});
  f.queue.schedulePattern(original);
  original.entries[0].command.args[1] = 12;
  const replacement = pattern('copy', [9], {repeatSeconds: 0.1});
  replacement.entries[0].command.callback = () => {};
  assert.throws(() => f.queue.schedulePattern(replacement), /serializable/);
  f.queue.advance(0);
  assert.deepEqual(f.applied[0].command.args, [13, 8]);
  assert.equal(f.queue.getStats().patternCount, 1);
});

test('invalid names, offsets, intervals and arguments keep an existing reservation', () => {
  const f = fixture({validate: command => {
    if (command.args[1] === 99) throw new Error('Invalid Shape');
  }});
  f.queue.schedulePattern(pattern('same', [8], {repeatSeconds: 0.1}));
  for (const invalid of [
    {...pattern('', [8])},
    pattern('same', [], {repeatSeconds: 1}),
    pattern('same', [1, 2], {entries: [
      {offsetSeconds: 1, command: {method: 'write'}},
      {offsetSeconds: 0, command: {method: 'write'}},
    ]}),
    pattern('same', [8], {repeatSeconds: 0}),
    pattern('same', [8], {repeatSeconds: NaN}),
    pattern('same', [8], {repeatSeconds: Infinity}),
    pattern('same', [99]),
    pattern('same', [8], {entries: new Array(1)}),
    pattern('same', [8], {entries: [{offsetSeconds: -1, command: {method: 'write'}}]}),
    pattern('same', [8], {entries: [{offsetSeconds: Infinity, command: {method: 'write'}}]}),
  ]) assert.throws(() => f.queue.schedulePattern(invalid));
  f.queue.advance(0);
  assert.equal(f.applied[0].command.args[1], 8);
  assert.equal(f.queue.getStats().patternCount, 1);
});

test('replacement ownership protects newer patterns from stale clear and cancellation', () => {
  const f = fixture();
  f.queue.schedulePattern(pattern('same', [1], {repeatSeconds: 0.1}));
  f.queue.schedulePattern(pattern('same', [2], {
    repeatSeconds: 0.1, performance: {session: 1, owner: 'new', time: 0},
  }));
  assert.equal(f.queue.clearPattern('same', {session: 1, owner: 'old'}), false);
  f.queue.cancelOwner('old');
  assert.throws(() => f.queue.schedulePattern(pattern('same', [3])), /no longer active/);
  f.queue.advance(0);
  assert.equal(f.applied[0].command.args[1], 2);
  assert.equal(f.applied[0].owner, 'new');
  assert.equal(f.queue.clearPattern('same', {session: 1, owner: 'new'}), true);
  f.queue.advance(4800);
  assert.equal(f.applied.length, 1);
});

test('pattern rate, count and stored-command limits account for replacements and legacy events', () => {
  const f = fixture({maxPatterns: 1, maxPatternEntries: 2, maxCommands: 3, maxPatternRate: 100});
  f.queue.schedulePattern(pattern('one', [1], {repeatSeconds: 0.01}));
  assert.throws(() => f.queue.schedulePattern(pattern('two', [2])), /capacity/);
  assert.throws(() => f.queue.schedulePattern(pattern('one', [1, 2, 3])), /entry limit/);
  assert.throws(() => f.queue.schedulePattern(pattern('one', [1], {repeatSeconds: 0.001})), /rate limit/);
  f.receive({performance: {session: 1, owner: 'legacy', time: 1}, commands: [{method: 'first'}, {method: 'second'}]});
  assert.throws(() => f.queue.schedulePattern(pattern('one', [2, 3], {repeatSeconds: 0.1})), /capacity/);
  f.queue.schedulePattern(pattern('one', [4], {repeatSeconds: 0.1}));
  assert.equal(f.queue.getStats().storedPatternCommands, 1);
  assert.equal(f.queue.getStats().patternRate, 10);
  f.receive({performance: {session: 1, owner: 'legacy', time: 1}, commands: [{method: 'third'}]});
  assert.match(f.replies.at(-1).error, /capacity/);
});

test('repeating pattern rate limit applies across all patterns', () => {
  const f = fixture({maxPatternRate: 100});
  f.queue.schedulePattern(pattern('one', [1], {repeatSeconds: 0.02}));
  f.queue.schedulePattern(pattern('two', [2], {repeatSeconds: 0.02}));
  assert.throws(() => f.queue.schedulePattern(pattern('three', [3], {repeatSeconds: 0.1})), /aggregate/);
  assert.equal(f.queue.getStats().patternCount, 2);
});

test('pattern start validation prevents unbounded historical catch-up', () => {
  const f = fixture();
  f.setFrame(1);
  assert.throws(() => f.queue.schedulePattern(pattern('past', [1], {repeatSeconds: 0.1})), /precedes/);
  assert.equal(f.queue.getStats().patternCount, 0);
});

test('validation and transaction dry-run do not install or discard patterns', () => {
  const discarded = [];
  const f = fixture({onDiscard: command => discarded.push(command)});
  f.queue.schedulePattern(pattern('old', [1], {repeatSeconds: 1}));
  const normalized = f.queue.validatePattern(pattern('next', [2]));
  assert.equal(normalized.startFrame, 0);
  const result = f.queue.commitPatterns([normalized], {session: 1, owner: 'old', dryRun: true});
  assert.deepEqual(result.cleared, ['old']);
  assert.equal(result.reservations[0].name, 'next');
  assert.deepEqual(discarded, []);
  assert.equal(f.queue.getStats().patternCount, 1);
  f.queue.advance(0);
  assert.equal(f.applied[0].command.args[1], 1);
});

test('manifest commits atomically replace owned names and preserve omitted names owned by other loops', () => {
  const f = fixture();
  f.queue.schedulePattern(pattern('entry-old', [1], {repeatSeconds: 1}));
  f.queue.schedulePattern(pattern('other', [2], {
    repeatSeconds: 1, performance: {session: 1, owner: 'other', time: 0},
  }));
  f.queue.commitPatterns([{name: 'other', clear: true}, pattern('entry-new', [3], {repeatSeconds: 1})],
    {session: 1, owner: 'old'});
  assert.equal(f.queue.getStats().patternCount, 2);
  f.queue.advance(0);
  assert.deepEqual(f.applied.map(item => item.command.args[1]), [2, 3]);
  f.queue.commitPatterns([], {session: 1, owner: 'old'});
  assert.equal(f.queue.getStats().patternCount, 1);
});

test('failed manifest validation or capacity retains every previous reservation', () => {
  const f = fixture({maxPatterns: 2});
  f.queue.schedulePattern(pattern('old', [1], {repeatSeconds: 1}));
  assert.throws(() => f.queue.commitPatterns([
    pattern('valid', [2]), pattern('bad', [3], {repeatSeconds: 0}),
  ], {session: 1, owner: 'old'}));
  assert.throws(() => f.queue.commitPatterns([
    pattern('one', [2]), pattern('two', [3]), pattern('three', [4]),
  ], {session: 1, owner: 'old'}), /transaction size/);
  assert.equal(f.queue.getStats().patternCount, 1);
  f.queue.advance(0);
  assert.equal(f.applied[0].command.args[1], 1);
});

test('future-only owner cancellation leaves ordinary events and physical release hooks for later cleanup', () => {
  const released = [];
  const f = fixture({onCancelOwner: owner => released.push(owner)});
  f.queue.schedulePattern(pattern('repeating', [1], {repeatSeconds: 1}));
  f.receive({performance: {session: 1, owner: 'old', time: 0}, commands: [{method: 'ordinary'}]});
  assert.equal(f.queue.cancelPatternOwner('old', {session: 1}), true);
  assert.deepEqual(released, []);
  f.queue.advance(0);
  assert.deepEqual(f.applied.map(item => item.command.method), ['ordinary']);
  assert.throws(() => f.queue.schedulePattern(pattern('late', [2])), /no longer active/);
  f.queue.cancelOwner('old');
  assert.deepEqual(released, ['old']);
});

test('Stop, new Run and clear discard compact patterns and reject old generations', () => {
  const f = fixture();
  f.queue.schedulePattern(pattern('stop', [1], {repeatSeconds: 1}));
  f.receive({type: 'performance-stop', session: 1});
  assert.equal(f.queue.nextFrame(), Infinity);
  assert.equal(f.queue.getStats().storedPatternCommands, 0);
  assert.throws(() => f.queue.schedulePattern(pattern('stale', [2])), /no longer active/);
  f.receive({type: 'performance-start', session: 2});
  f.queue.schedulePattern(pattern('fresh', [3], {performance: {session: 2, owner: 'old', time: 0}}));
  assert.equal(f.queue.clearPattern('fresh', {session: 1}), false);
  f.queue.clear();
  assert.equal(f.queue.getStats().patternCount, 0);
  assert.equal(f.queue.getStats().patternRate, 0);
});

test('a failing recurring command stops its pattern while other events remain runnable', () => {
  const applied = [];
  const f = fixture({apply: command => {
    if (command.args?.[1] === 99) throw new Error('Resolution failed');
    applied.push(command);
  }});
  f.queue.schedulePattern(pattern('failing', [99], {repeatSeconds: 1}), message => f.replies.push(message));
  f.queue.schedulePattern(pattern('good', [8]));
  f.queue.advance(0);
  assert.deepEqual(applied.map(command => command.args[1]), [8]);
  assert.equal(f.queue.getStats().patternCount, 0);
  assert.match(f.replies.at(-1).error, /Resolution failed/);
});
