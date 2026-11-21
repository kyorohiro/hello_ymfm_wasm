import {createNesTimedRevisionReadContext} from './mixer_calibration_nes_timed_revision.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createYm2608AdpcmRevisionReadContext,YM2608_ADPCM_RECEIPT,YM2608_ADPCM_PIN} from './mixer_calibration_ym2608_adpcm_revision.mjs';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
test('Adpcm review restores only complete exact predecessors, including the shared note guard and state metadata',()=>{
 const bytes=readFileSync(new URL(YM2608_ADPCM_RECEIPT,root));assert.equal(sha(bytes),YM2608_ADPCM_PIN);
 const {sources}=JSON.parse(bytes),context=createYm2608AdpcmRevisionReadContext();
 for(const [name,entry]of Object.entries(sources)){
  const current=createNesTimedRevisionReadContext().restore(name,readFileSync(new URL(name,root)));assert.equal(sha(current),entry.after.sha256,name);
  assert.equal(sha(context.restore(name,current)),entry.before.sha256,name);assert.equal(sha(context.readSource(new URL(name,root))),entry.before.sha256,name);
  const future=Buffer.concat([current,Buffer.from('\n// not reviewed')]);assert.equal(context.restore(name,future),future);
 }
 const other=Buffer.from('unrelated');assert.equal(context.restore('js/ym2612-worklet.js',other),other);
});
test('edited review evidence cannot authorize a different Adpcm implementation',()=>{
 assert.throws(()=>createYm2608AdpcmRevisionReadContext(url=>{const b=readFileSync(url);return url.href===new URL(YM2608_ADPCM_RECEIPT,root).href?Buffer.concat([b,Buffer.from('\n')]):b;}),/identity/);
});
