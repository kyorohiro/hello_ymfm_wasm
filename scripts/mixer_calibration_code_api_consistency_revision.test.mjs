import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createCodeApiConsistencyRevisionReadContext} from './mixer_calibration_code_api_consistency_revision.mjs';

const root = new URL('../', import.meta.url);
const receiptUrl = new URL('docs/issues/synth_code_api_consistency_source_revision_01.json', root);
const {sources} = JSON.parse(readFileSync(receiptUrl));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('historical PCM readers restore only the reviewed before/after source pairs', () => {
  const revision = createCodeApiConsistencyRevisionReadContext();
  for (const [path, {before, after}] of Object.entries(sources)) {
    const url = new URL(path, root);
    const bytes = readFileSync(url);
    assert.equal(sha(bytes), after.sha256, path);
    const restored = revision.readSource(url);
    assert.equal(sha(restored), before.sha256, path);
    assert.equal(revision.restore(path, restored), restored, path);
    const future = Buffer.concat([bytes, Buffer.from('\n// Later edit')]);
    assert.equal(revision.restore(path, future), future, path);
  }
});

test('the review digest rejects a changed historical source receipt', () => {
  const revision = createCodeApiConsistencyRevisionReadContext(url => {
    const bytes = readFileSync(url);
    return url.href === receiptUrl.href ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes;
  });
  const first = new URL(Object.keys(sources)[0], root);
  assert.throws(() => revision.readSource(first), /source revision identity changed/);
});
