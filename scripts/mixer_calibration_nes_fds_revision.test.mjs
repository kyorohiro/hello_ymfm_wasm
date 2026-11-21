import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createNesFdsRevisionReadContext,NES_FDS_RECEIPT,NES_FDS_PIN} from './mixer_calibration_nes_fds_revision.mjs';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
test('FDS review restores only complete exact predecessors, including the shared note guard and state metadata',()=>{
 const bytes=readFileSync(new URL(NES_FDS_RECEIPT,root));assert.equal(sha(bytes),NES_FDS_PIN);
 const {sources}=JSON.parse(bytes),context=createNesFdsRevisionReadContext();
 for(const [name,entry]of Object.entries(sources)){
  const current=readFileSync(new URL(name,root));assert.equal(sha(current),entry.after.sha256,name);
  assert.equal(sha(context.restore(name,current)),entry.before.sha256,name);assert.equal(sha(context.readSource(new URL(name,root))),entry.before.sha256,name);
  const future=Buffer.concat([current,Buffer.from('\n// not reviewed')]);assert.equal(context.restore(name,future),future);
 }
 const other=Buffer.from('unrelated');assert.equal(context.restore('js/ym2612-worklet.js',other),other);
});
test('edited review evidence cannot authorize a different FDS implementation',()=>{
 assert.throws(()=>createNesFdsRevisionReadContext(url=>{const b=readFileSync(url);return url.href===new URL(NES_FDS_RECEIPT,root).href?Buffer.concat([b,Buffer.from('\n')]):b;}),/identity/);
});
