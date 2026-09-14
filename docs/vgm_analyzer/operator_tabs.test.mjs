import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
function setup(chip) {
 const node=()=>({attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];}});
 const ctx={currentBuffer:new Uint8Array(1),midiExportAvailable:true,currentChipKind:chip,noteishViewMode:'live',document:{getElementById:()=>node()},tfiInfo:{setVisible(){}},sampleExplorer:{stop(){}},songTimeline:{active(){}},setStatus(){},requestNoteishRender(){},renderNoteishGrid(){}};
 for(const name of ['exportOpmRow','exportOpmChannel','exportOpmButton','operatorInfoTab','noteishTab','tfiInfoTab','sampleTab','parsedOutputTab','exportMidiButton','exportMmlButton','exportSnapshotTfiButton','exportSnapshotVgiButton','exportSnapshotButton','exportAllTfiButton','exportAllVgiButton','opnMonitorRoot','opmMonitorRoot','ayMonitorRoot','samplePanel','operatorInfoPanel','parsedOutputPanel','noteishPanel'])ctx[name]=node();
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function updateChipSupport()'),source.indexOf('function buildParseInfo(')),ctx);
 vm.runInContext(source.slice(source.indexOf('function setOutputTab('),source.indexOf('operatorInfoTab.addEventListener("click"')),ctx);
 return ctx;
}
for(const chip of ['ym2151','ay8910'])test(`${chip} Operator Info survives repeated playback UI updates`,()=>{
 const c=setup(chip);c.updateChipSupport();assert.equal(c.operatorInfoTab.disabled,false);
 c.setOutputTab('operator-info');
 for(let i=0;i<5;i++)c.updateChipSupport();
 assert.equal(c.operatorInfoTab.getAttribute('aria-selected'),'true');assert.equal(c.operatorInfoPanel.hidden,false);
 assert.equal(chip==='ym2151'?c.opmMonitorRoot.hidden:c.ayMonitorRoot.hidden,false);
 c.setOutputTab('parsed-output');c.updateChipSupport();assert.equal(c.parsedOutputPanel.hidden,false);
 c.setOutputTab('tfi-info');assert.equal(c.parsedOutputPanel.hidden,false);
});
test('unsupported chip still rejects Operator Info; switching from unsupported tab selects a supported tab',()=>{
 const c=setup('y8950');c.updateChipSupport();c.setOutputTab('operator-info');assert.equal(c.operatorInfoTab.disabled,true);assert.equal(c.operatorInfoPanel.hidden,true);
 c.currentChipKind='ym2612';c.setOutputTab('noteish');c.currentChipKind='ym2151';c.updateChipSupport();assert.equal(c.operatorInfoPanel.hidden,true);assert.equal(c.noteishPanel.hidden,false);
});

test('YM2151 Note-ish remains selected; MIDI is enabled and MML stays disabled',()=>{const c=setup('ym2151');c.updateChipSupport();assert.equal(c.noteishTab.disabled,false);c.setOutputTab('noteish');for(let i=0;i<5;i++)c.updateChipSupport();assert.equal(c.noteishPanel.hidden,false);assert.equal(c.exportMidiButton.disabled,false);assert.equal(c.exportMmlButton.disabled,true);c.midiExportAvailable=false;c.updateChipSupport();assert.equal(c.exportMidiButton.disabled,true);});

test('OPM controls only enable for loaded YM2151 files',()=>{const c=setup('ym2151');c.updateChipSupport();assert.equal(c.exportOpmRow.hidden,false);assert.equal(c.exportOpmButton.disabled,false);c.currentBuffer=null;c.updateChipSupport();assert.equal(c.exportOpmChannel.disabled,true);c.currentChipKind='ym2612';c.updateChipSupport();assert.equal(c.exportOpmRow.hidden,true);assert.equal(c.exportOpmButton.disabled,true);});
