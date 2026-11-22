// SPDX-License-Identifier: BSD-3-Clause
// Restore exact inputs for historical PCM tests. Live playback uses today's sources.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
const receiptUrl = new URL('docs/issues/synth_code_api_consistency_source_revision_01.json', root);
const RECEIPT_SHA256 = '032f616ec2f2a2393bf2fe7906739f45919b6bf35580a625cbddc208736bd25d';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const matches = (bytes, record) => Buffer.byteLength(bytes) === record.bytes && sha(bytes) === record.sha256;

// The generated catalog is pinned by earlier calibration receipts. The only
// changes here are four WonderSwan example declarations and one starter migration.
// Authenticate the complete catalog on both sides before giving it to old proofs.
const catalogPath = 'docs/playground/playground_examples.js';
const catalogBefore = '6a9e26cdc141bf0719ee56d1764d22ead466551994b8f309cddc84bc2c0e3f89';
const catalogAfter = '59ada3261e653173f7ee6d3565445d4b69a182d799e47944d228e5ad35fcc81e';
const acquisition = JSON.stringify('const ws = await useSoundChip("wonderswan");\n').slice(1, -1);
const starterTestPath = 'docs/playground/playground_mode_starters.test.mjs';
const starterTestBefore = 'e3856ff3de83ab23a5702b259ef4d1275a5f0722912e93f25c9a4faaf5b760be';
const starterTestAfter = '66a07f9605129baecdaee968b1c62f3b0af04b6b1b7948f386ff57d7ac4da723';

export function createCodeApiConsistencyRevisionReadContext(read = readFileSync) {
  let sources;
  function restore(path, bytes) {
    if (!sources) {
      const receiptBytes = read(receiptUrl);
      if (sha(receiptBytes) !== RECEIPT_SHA256) throw Error('Synth Code API source revision identity changed');
      const receipt = JSON.parse(receiptBytes);
      if (receipt.schemaVersion !== 1 || receipt.scope !== 'synth-code-api-consistency-historical-inputs') {
        throw Error('Invalid Synth Code API source revision');
      }
      sources = receipt.sources;
    }
    const name = Object.hasOwn(sources, path) ? path : 'docs/' + path;
    if ((path === catalogPath || name === catalogPath) && sha(bytes) === catalogAfter) {
      const original = Buffer.from(bytes.toString()
        .replaceAll(acquisition, '')
        .replace(/,\n  "wonderswan": \[\n    "[^\n]+"\n  \]/, ''));
      if (sha(original) !== catalogBefore) throw Error('WonderSwan example catalog predecessor identity changed');
      return original;
    }
    if ((path === starterTestPath || name === starterTestPath) && sha(bytes) === starterTestAfter) {
      const original = Buffer.from(bytes.toString().replace("'snes','wonderswan']);", "'snes']);"));
      if (sha(original) !== starterTestBefore) throw Error('WonderSwan starter test predecessor identity changed');
      return original;
    }
    const entry = Object.hasOwn(sources, name) ? sources[name] : null;
    if (!entry || !matches(bytes, entry.after)) return bytes;
    const source = Buffer.from(bytes);
    const parts = [];
    let cursor = 0;
    for (const {afterOffset, afterBytes, beforeText} of entry.hunks) {
      if (!Number.isSafeInteger(afterOffset) || afterOffset < cursor ||
          !Number.isSafeInteger(afterBytes) || afterBytes < 0 ||
          afterOffset + afterBytes > source.length || typeof beforeText !== 'string') {
        throw Error('Invalid Synth Code API source revision hunk: ' + name);
      }
      parts.push(source.subarray(cursor, afterOffset), Buffer.from(beforeText));
      cursor = afterOffset + afterBytes;
    }
    parts.push(source.subarray(cursor));
    const result = Buffer.concat(parts);
    if (!matches(result, entry.before)) throw Error('Synth Code API predecessor identity changed: ' + name);
    return result;
  }
  return {
    restore,
    readSource(url) {
      const bytes = read(url);
      if (!(url instanceof URL) || url.protocol !== 'file:') return bytes;
      return restore(relative(fileURLToPath(root), fileURLToPath(url)).replaceAll('\\', '/'), bytes);
    },
  };
}
