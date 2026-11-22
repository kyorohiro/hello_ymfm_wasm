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

test('the WonderSwan example declaration and starter migration recover the original catalog for older receipts', () => {
  const revision = createCodeApiConsistencyRevisionReadContext();
  const url = new URL('docs/playground/playground_examples.js', root);
  const live = readFileSync(url);
  const prior = revision.readSource(url);
  assert.equal(sha(prior), '6a9e26cdc141bf0719ee56d1764d22ead466551994b8f309cddc84bc2c0e3f89');
  assert.notDeepEqual(prior, live);
  const unrelatedEdit = Buffer.concat([live, Buffer.from('\n// Other change')]);
  assert.equal(revision.restore('docs/playground/playground_examples.js', unrelatedEdit), unrelatedEdit);
  const starterTest = new URL('docs/playground/playground_mode_starters.test.mjs', root);
  assert.equal(sha(revision.readSource(starterTest)), 'e3856ff3de83ab23a5702b259ef4d1275a5f0722912e93f25c9a4faaf5b760be');
});
