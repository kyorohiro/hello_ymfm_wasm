import test from 'node:test';
import assert from 'node:assert/strict';
import {MONITOR_RANGES, normalizeMonitorRange, formatMonitorAmplitude, createMonitorScale} from './playground_monitor_scale.js';

test('display ranges accept only the documented string choices', () => {
  assert.deepEqual(MONITOR_RANGES, ['auto', '2', '1', '0.5', '0.2', '0.1', '0.05', '0.02', '0.01', '0.005', '0.001']);
  for (const value of MONITOR_RANGES) assert.equal(normalizeMonitorRange(value), value);
  for (const value of [undefined, null, '', '0', '4', '.1', '0.10', 'Auto', 1, .1, NaN, {}, Symbol('auto')]) {
    assert.equal(normalizeMonitorRange(value), 'auto');
  }
});

test('auto range holds at one during initial silence and snaps to the first meaningful peak', () => {
  const scale = createMonitorScale();
  assert.equal(scale.update(0, 0), 1);
  assert.equal(scale.update(1e-8, 100), 1);
  assert.equal(scale.update(0, 10000), 1);
  assert.equal(scale.update(.04, 10001), .05);
  assert.equal(scale.update(0, 11000), .05);
  assert.equal(scale.update(1e-8, 12000), .05);
});

test('auto range expands immediately, leaves headroom, and does not cap amplitudes at one', () => {
  const scale = createMonitorScale();
  assert.equal(scale.update(.1, 0), .125);
  assert.equal(scale.update(.4, 0), .5, 'growth does not wait for elapsed time');
  assert.equal(scale.update(1.6, 1), 2, 'over-full-scale peaks remain visible');
  assert.equal(scale.update(4, NaN), 5, 'an invalid timestamp cannot delay necessary growth');
  const extreme = scale.update(Number.MAX_VALUE, 2);
  assert.equal(extreme, Number.MAX_VALUE);
  assert(Number.isFinite(extreme));
});

test('small signals use a positive minimum range without gain instability at the noise floor', () => {
  const scale = createMonitorScale();
  assert.equal(scale.update(1e-6, 0), .001);
  for (let i = 1; i < 30; i++) assert.equal(scale.update(i % 2 ? 0 : 9e-7, i * 100), .001);
  assert.equal(scale.update(.0001, 3100), .001);
});

test('shrinking range is gradual, monotonic, and releases over approximately 1500 milliseconds', () => {
  const scale = createMonitorScale();
  let previous = scale.update(1, 0);
  const target = .125;
  for (let i = 1; i <= 15; i++) {
    const current = scale.update(.1, i * 100);
    assert(current < previous);
    assert(current > target);
    if (i === 1) assert(current > 1.15, 'a single frame must not snap downward');
    previous = current;
  }
  assert(previous > .53 && previous < .55, 'after one release time, about 37% of the original excess remains');
  assert.equal(scale.update(2, 1501), 2.5, 'a new transient expands immediately during release');
});

test('a long scheduling gap decays at most one capped step', () => {
  const immediate = createMonitorScale(), delayed = createMonitorScale();
  immediate.update(1, 0); delayed.update(1, 0);
  const ordinary = immediate.update(.1, 250);
  assert.equal(delayed.update(.1, 60000), ordinary);
  assert(ordinary > 1);
});

test('invalid samples and timestamps are safe and do not regress the elapsed-time baseline', () => {
  const scale = createMonitorScale();
  const initial = scale.update(.4, 1000);
  for (const peak of [NaN, Infinity, -Infinity, -1, undefined, null, '1', Symbol('peak')]) {
    assert.equal(scale.update(peak, 1000), initial);
  }
  for (const time of [NaN, Infinity, -Infinity, -1, undefined, null, '1000', Symbol('time'), 500]) {
    assert.equal(scale.update(.1, time), initial);
  }
  const reference = createMonitorScale(); reference.update(.4, 1000);
  assert.equal(scale.update(.1, 1100), reference.update(.1, 1100));
  for (let i = 0; i < 50; i++) {
    const result = scale.update(i % 2 ? 1e-6 : Number.MAX_VALUE, i * 1000 + 1200);
    assert(result > 0 && Number.isFinite(result));
  }
});

test('reset forgets the previous session and instances are independent', () => {
  const first = createMonitorScale(), second = createMonitorScale();
  first.update(4, 0);
  assert.equal(second.update(0, 0), 1);
  first.reset();
  assert.equal(first.update(0, 10000), 1);
  assert.equal(first.update(.008, 10001), .01);
  assert.equal(second.update(.4, 1), .5);
});

test('axis formatting is compact, uses three significant digits, and never prints negative zero', () => {
  for (const [input, expected] of [
    [0, '0'], [-0, '0'], [1, '1'], [-1, '-1'], [.5, '0.5'], [.001, '0.001'],
    [1.23456, '1.23'], [-.0123456, '-0.0123'], [12.345, '12.3'], [1234.56, '1230'],
    [1.2e-8, '1.2e-8'], [-1e-12, '-1e-12'], [Number.MIN_VALUE, '4.94e-324'],
  ]) assert.equal(formatMonitorAmplitude(input), expected);
  assert(!/Infinity|NaN/.test(formatMonitorAmplitude(Number.MAX_VALUE)));
  for (const invalid of [NaN, Infinity, -Infinity, undefined, null, '1', Symbol('amplitude')]) {
    assert.equal(formatMonitorAmplitude(invalid), '0');
  }
});
