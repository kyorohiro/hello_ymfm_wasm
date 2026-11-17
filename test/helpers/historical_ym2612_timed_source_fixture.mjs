// Exact pre-feature Worklets reconstructed for offline audio regression tests.
// Every byte of both source pairs is pinned; unexpected edits must refresh the
// independently reviewed compatibility evidence, never silently skip checking.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const YM2612_TIMED_BASE_COMMIT = 'd620c38f701d0c8906ae0c05387019a891237d3b';
export const YM2612_TIMED_WORKLET_PREDECESSORS = Object.freeze({
  "ymfm": {
    "path": "tetorica_src/runtime/ym2612-worklet.js",
    "before": {
      "bytes": 25234,
      "sha256": "e92739edfc535029aed3a2461db485d54ca6e21f6b7f8b81bd6e267ddd85c02b"
    },
    "after": {
      "bytes": 27032,
      "sha256": "afbb848585b4fdb514eeedd8c230a33e859a141a727f3a4e006f93d0f8df6df1"
    },
    "reverseHunks": [
      {
        "afterOffset": 0,
        "afterBytes": 96,
        "beforeText": ""
      },
      {
        "afterOffset": 1529,
        "afterBytes": 95,
        "beforeText": ""
      },
      {
        "afterOffset": 1699,
        "afterBytes": 12,
        "beforeText": ""
      },
      {
        "afterOffset": 1726,
        "afterBytes": 126,
        "beforeText": ""
      },
      {
        "afterOffset": 3399,
        "afterBytes": 94,
        "beforeText": ""
      },
      {
        "afterOffset": 3955,
        "afterBytes": 583,
        "beforeText": ""
      },
      {
        "afterOffset": 5762,
        "afterBytes": 60,
        "beforeText": ""
      },
      {
        "afterOffset": 10134,
        "afterBytes": 732,
        "beforeText": ""
      }
    ]
  },
  "nuked": {
    "path": "tetorica_src/runtime/ym2612-worklet-nuked.js",
    "before": {
      "bytes": 24435,
      "sha256": "b85313908ad739c16e3068e0316250253d2e222a3248d80ca060327704f7a147"
    },
    "after": {
      "bytes": 26235,
      "sha256": "324c787c955bf597ba45498dfe854e6092cefe90891deb0bfaec5bbe030d5257"
    },
    "reverseHunks": [
      {
        "afterOffset": 0,
        "afterBytes": 96,
        "beforeText": ""
      },
      {
        "afterOffset": 1539,
        "afterBytes": 95,
        "beforeText": ""
      },
      {
        "afterOffset": 1709,
        "afterBytes": 12,
        "beforeText": ""
      },
      {
        "afterOffset": 1736,
        "afterBytes": 127,
        "beforeText": ""
      },
      {
        "afterOffset": 3332,
        "afterBytes": 94,
        "beforeText": ""
      },
      {
        "afterOffset": 3888,
        "afterBytes": 584,
        "beforeText": ""
      },
      {
        "afterOffset": 5666,
        "afterBytes": 60,
        "beforeText": ""
      },
      {
        "afterOffset": 9463,
        "afterBytes": 732,
        "beforeText": ""
      }
    ]
  }
} );
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function readHistoricalYm2612TimedWorklet(engine) {
  const entry = YM2612_TIMED_WORKLET_PREDECESSORS[engine];
  if (!entry) throw new Error('Unsupported historical YM2612 Worklet');
  const bytes = await readFile(new URL('../../' + entry.path, import.meta.url));
  if (bytes.length !== entry.after.bytes || sha(bytes) !== entry.after.sha256) {
    throw new Error('Current YM2612 Worklet differs from the authenticated timed-operation revision: ' + engine);
  }
  const chunks = []; let cursor = 0;
  for (const hunk of entry.reverseHunks) {
    chunks.push(bytes.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));
    cursor = hunk.afterOffset + hunk.afterBytes;
  }
  chunks.push(bytes.subarray(cursor));
  const before = Buffer.concat(chunks);
  if (before.length !== entry.before.bytes || sha(before) !== entry.before.sha256) throw new Error('Historical YM2612 source proof failed');
  return before.toString('utf8');
}
