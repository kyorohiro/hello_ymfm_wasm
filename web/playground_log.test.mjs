import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {formatLogArgs, serializeLogError} from './playground_log.js';

test('display formats errors from other realms and errors without stacks', () => {
  const error = vm.runInNewContext('new RangeError("invalid channel")');
  assert.match(formatLogArgs([error]), /^RangeError: invalid channel\n/);
  const abort = new DOMException('Run stopped', 'AbortError');
  Object.defineProperty(abort, 'stack', {value: undefined});
  assert.equal(formatLogArgs([abort]), 'AbortError: Run stopped');
});

test('ordinary log values keep their formatting and original objects', () => {
  const value = {channel: 1};
  assert.equal(serializeLogError(value), value);
  assert.equal(formatLogArgs(['note', value, null, undefined]), 'note {"channel":1} null undefined');
  const error = new Error('original');
  formatLogArgs([error]);
  assert.equal(error.message, 'original');
  assert.equal(JSON.stringify(error), '{}');
});
