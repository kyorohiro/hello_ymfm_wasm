import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createFm2608MonitorRevisionReadContext,FM2608_MONITOR_RECEIPT,FM2608_MONITOR_PIN} from './mixer_calibration_fm2608_monitor_revision.mjs';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
test('standalone monitor review restores complete predecessors and leaves all unreviewed edits visible',()=>{
 const bytes=readFileSync(new URL(FM2608_MONITOR_RECEIPT,root));assert.equal(sha(bytes),FM2608_MONITOR_PIN);
 const receipt=JSON.parse(bytes),context=createFm2608MonitorRevisionReadContext();
 for(const [name,entry]of Object.entries(receipt.sources)){
  const current=readFileSync(new URL(name,root));assert.equal(sha(current),entry.after.sha256);
  assert.equal(sha(context.restore(name,current)),entry.before.sha256);assert.equal(sha(context.readSource(new URL(name,root))),entry.before.sha256);
  const changed=Buffer.concat([current,Buffer.from('\n// future')]);assert.equal(context.restore(name,changed),changed);
 }
 const other=Buffer.from('not in this review');assert.equal(context.restore('js/ym2612-worklet.js',other),other);
});
test('modified monitor or receipt cannot inherit the pinned calibration review',()=>{
 for(const target of [FM2608_MONITOR_RECEIPT,'docs/synth-fm2608/fm_ssg_monitor.js'])assert.throws(()=>{
  const context=createFm2608MonitorRevisionReadContext(url=>{const bytes=readFileSync(url);return url.href===new URL(target,root).href?Buffer.concat([bytes,Buffer.from('\n// future')]):bytes;});
  context.restore('synth-fm2608/audio_worklet.js',readFileSync(new URL('docs/synth-fm2608/audio_worklet.js',root)));
 },/identity|dependency/);
});
