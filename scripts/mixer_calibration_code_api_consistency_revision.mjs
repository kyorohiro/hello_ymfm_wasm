// SPDX-License-Identifier: BSD-3-Clause
// Restore exact inputs for historical PCM tests. Live playback uses today's sources.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
const receiptUrl = new URL('docs/issues/synth_code_api_consistency_source_revision_01.json', root);
const RECEIPT_SHA256 = '4f0eabd196c90ae5a3e3ef029b56a86e4a5a8e319e11242ce990104c4b9416c3';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const matches = (bytes, record) => Buffer.byteLength(bytes) === record.bytes && sha(bytes) === record.sha256;

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
