import test from 'node:test';
import assert from 'node:assert/strict';
import {createExportTempoSettings} from './export_tempo.js';
test('all export dialogs share estimation, retain edits, and reset for a new track', () => {
 let scans=0;
 const settings=createExportTempoSettings(()=>{scans++;return {tempo:{bpm:137,estimated:true,candidates:[137,70]}};});
 const track={}, next={}, midi={}, mml={}, help={};
 settings.prepare(track,midi,help); settings.prepare(track,mml,help);
 assert.equal(midi.value,137); assert.equal(mml.value,137); assert.equal(settings.getAnalysis(track).tempo.bpm,137); assert.equal(scans,1);
 midi.value=90; settings.prepare(track,midi,help); assert.equal(midi.value,90);
 settings.prepare(next,midi,help); settings.prepare(next,mml,help);
 assert.equal(midi.value,137); assert.equal(mml.value,137); assert.equal(scans,2);
 assert.match(help.textContent,/half\/double/);
});
test('sparse tracks use LilyPond fallback', () => {
 const settings=createExportTempoSettings(()=>({tempo:{bpm:120,estimated:false,candidates:[]}}));
 const input={},help={}; settings.prepare({},input,help,'Original timing retained.');
 assert.equal(input.value,120); assert.match(help.textContent,/No reliable tempo estimate/); assert.match(help.textContent,/Original timing/);
});
test('SPC analysis revisions reset the suggested tempo and disclose the exported interval', () => {
 const before={tempo:{bpm:120,estimated:false,candidates:[]},exportSummary:'Analyzed interval: 0–2.00 seconds. 1 provisional BRR.'};
 const after={tempo:{bpm:140,estimated:true,candidates:[140,70]},exportSummary:'Analyzed interval: 0–3.00 seconds. 0 provisional BRRs.'};
 const settings=createExportTempoSettings(source=>source),input={},help={};
 settings.prepare(before,input,help);input.value=90;
 settings.prepare(before,input,help);assert.equal(input.value,90);
 assert.match(help.textContent,/0–2.00 seconds/);
 settings.prepare(after,input,help);assert.equal(input.value,140);
 assert.match(help.textContent,/0–3.00 seconds/);assert.doesNotMatch(help.textContent,/1 provisional/);
});
