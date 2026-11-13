// SPDX-License-Identifier: BSD-3-Clause
// Keep old waveform-off captures immutable. These reviewed additive host/API
// changes bind the current artifact without rewriting any old PCM/state proof.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const proof=await readFile(new URL('../fixtures/sid-player/manual_api_transition_01.json',import.meta.url));
assert.equal(sha(proof),'9a4ad09af7c2cc98d3c43790c4ea922df4d3edec069143532f454a82ac524f09','Manual API transition needs an explicit pin review');
const transition=JSON.parse(proof);
assert.equal(transition.format,'tetorica-sid-player-manual-api-transition');assert.equal(transition.historicalProofsRetained,true);

/** Authenticate either the original captured bytes or the reviewed additive
 * host boundary. The caller still compares every original PCM/trace/state. */
export function assertSidManualTransition(path,previous,bytes){
  const current={bytes:bytes.length,sha256:sha(bytes)};
  const subset=(a,b)=>Object.entries(a).every(([key,value])=>b[key]===value);
  if(subset(previous,current))return;
  const accepted=transition.changes[path];assert(accepted,'Unreviewed SID proof input change: '+path);
  assert(subset(previous,accepted.previous),'Previous SID capture binding differs: '+path);
  assert.deepEqual(current,accepted.current,'Current SID API transition binding differs: '+path);
}
