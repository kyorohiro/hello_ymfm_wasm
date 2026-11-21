import {createFm2608MonitorRevisionReadContext} from './mixer_calibration_fm2608_monitor_revision.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createYm2608TimedRevisionReadContext,YM2608_TIMED_RECEIPT,YM2608_TIMED_PIN} from './mixer_calibration_ym2608_timed_revision.mjs';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
test('review restores only complete pinned source pairs, never future edits or unrelated files',()=>{
 const bytes=readFileSync(new URL(YM2608_TIMED_RECEIPT,root));assert.equal(sha(bytes),YM2608_TIMED_PIN);
 const latest=createFm2608MonitorRevisionReadContext(),context=createYm2608TimedRevisionReadContext();const receipt=JSON.parse(bytes);
 for(const [name,entry]of Object.entries(receipt.sources)){
  const after=latest.restore(name,readFileSync(new URL(name,root)));assert.equal(sha(after),entry.after.sha256,name);
  const before=context.restore(name,after);assert.equal(sha(before),entry.before.sha256,name);assert.equal(before.length,entry.before.bytes);
  assert.equal(sha(context.readSource(new URL(name,root))),entry.before.sha256);
  const changed=Buffer.concat([after,Buffer.from('\n// not reviewed\n')]);assert.equal(context.restore(name,changed),changed,'A future edit must reach downstream freshness checks unchanged');
 }
 const unrelated=Buffer.from('not a reviewed input');assert.equal(context.restore('docs/js/ym2612.js',unrelated),unrelated);
});
test('new resolver dependencies cannot change underneath a reviewed connection',()=>{
 const context=createYm2608TimedRevisionReadContext(url=>{
  const bytes=readFileSync(url);return url.pathname.endsWith('/ym2608_operations.js')?Buffer.concat([bytes,Buffer.from('\n// changed')]):bytes;
 });
 assert.throws(()=>context.restore('docs/js/ym2608synth.js',readFileSync(new URL('docs/js/ym2608synth.js',root))),/Unreviewed YM2608 timed dependency/);
});
