import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCodeApiConsistencyRevisionReadContext} from './mixer_calibration_code_api_consistency_revision.mjs';
import {createSnesTimedRevisionReadContext,SNES_TIMED_RECEIPT,SNES_TIMED_PIN} from './mixer_calibration_snes_timed_revision.mjs';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
test('S-DSP review restores only complete exact predecessors, including the shared note guard and state metadata',()=>{
 const bytes=readFileSync(new URL(SNES_TIMED_RECEIPT,root));assert.equal(sha(bytes),SNES_TIMED_PIN);
 const {sources}=JSON.parse(bytes),context=createSnesTimedRevisionReadContext(),latest=createCodeApiConsistencyRevisionReadContext();
 for(const [name,entry]of Object.entries(sources)){
  const url=new URL(name,root),current=latest.readSource(url);assert.equal(sha(current),entry.after.sha256,name);
  assert.equal(sha(context.restore(name,readFileSync(url))),entry.before.sha256,name);
  assert.equal(sha(context.restore(name,current)),entry.before.sha256,name);assert.equal(sha(context.readSource(new URL(name,root))),entry.before.sha256,name);
  const future=Buffer.concat([current,Buffer.from('\n// not reviewed')]);assert.equal(context.restore(name,future),future);
 }
 const other=Buffer.from('unrelated');assert.equal(context.restore('js/ym2612-worklet.js',other),other);
});
test('edited review evidence cannot authorize a different S-DSP implementation',()=>{
 assert.throws(()=>createSnesTimedRevisionReadContext(url=>{const b=readFileSync(url);return url.href===new URL(SNES_TIMED_RECEIPT,root).href?Buffer.concat([b,Buffer.from('\n')]):b;}),/identity/);
});
