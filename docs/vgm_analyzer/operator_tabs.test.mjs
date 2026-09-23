import {isOpl} from './opl_notes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
function setup(chip) {
 const node=()=>({attrs:{},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];}});
 const ctx={isOpl,musicSheet:undefined,OPM_TFI_NOTICE:'Approximate conversion',currentBuffer:new Uint8Array(1),midiExportAvailable:true,currentChipKind:chip,noteishViewMode:'live',noteishHeader:{},document:{getElementById:()=>node()},tfiInfo:{setVisible(){}},opmInfo:{setVisible(){}},sampleExplorer:{stop(){}},songTimeline:{active(){}},requestChannelMonitorRender(){},setStatus(){},requestNoteishRender(){},renderNoteishGrid(){}};
 for(const name of ['sheetMusicTab','sheetMusicPanel','exportAllOpmButton','exportOpmButton','operatorInfoTab','noteishTab','tfiInfoTab','sampleTab','parsedOutputTab','exportMidiButton','exportLilyPondButton','exportMmlButton','exportSnapshotTfiButton','exportSnapshotVgiButton','exportSnapshotButton','exportAllTfiButton','exportAllVgiButton','opnMonitorRoot','opmMonitorRoot','ayMonitorRoot','ym2413MonitorRoot','oplMonitorRoot','samplePanel','operatorInfoPanel','parsedOutputPanel','noteishPanel'])ctx[name]=node();
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function updateChipSupport()'),source.indexOf('function buildParseInfo(')),ctx);
 vm.runInContext(source.slice(source.indexOf('function setOutputTab('),source.indexOf("sheetMusicTab.addEventListener('click'")),ctx);
 return ctx;
}
for(const chip of ['ym2151','ay8910'])test(`${chip} Operator Info survives repeated playback UI updates`,()=>{
 const c=setup(chip);c.updateChipSupport();assert.equal(c.operatorInfoTab.disabled,false);
 c.setOutputTab('operator-info');
 for(let i=0;i<5;i++)c.updateChipSupport();
 assert.equal(c.operatorInfoTab.getAttribute('aria-selected'),'true');assert.equal(c.operatorInfoPanel.hidden,false);
 assert.equal(chip==='ym2151'?c.opmMonitorRoot.hidden:c.ayMonitorRoot.hidden,false);
 c.setOutputTab('parsed-output');c.updateChipSupport();assert.equal(c.parsedOutputPanel.hidden,false);
 c.setOutputTab('tfi-info');c.updateChipSupport();assert.equal(c.parsedOutputPanel.hidden,chip==='ym2151');if(chip==='ym2151'){assert.equal(c.tfiInfoTab.disabled,false);assert.equal(c.tfiInfoTab.getAttribute('aria-selected'),'true');}
});
test('unsupported chip still rejects Operator Info; switching from unsupported tab selects a supported tab',()=>{
 const c=setup('segapcm');c.updateChipSupport();c.setOutputTab('operator-info');assert.equal(c.operatorInfoTab.disabled,true);assert.equal(c.operatorInfoPanel.hidden,true);
 c.currentChipKind='ym2612';c.setOutputTab('noteish');c.currentChipKind='ym2151';c.updateChipSupport();assert.equal(c.operatorInfoPanel.hidden,true);assert.equal(c.noteishPanel.hidden,false);
});

test('YM2151 Note-ish remains selected; MIDI and MML are enabled',()=>{const c=setup('ym2151');c.updateChipSupport();assert.equal(c.noteishTab.disabled,false);c.setOutputTab('noteish');for(let i=0;i<5;i++)c.updateChipSupport();assert.equal(c.noteishPanel.hidden,false);assert.equal(c.exportMidiButton.disabled,false);assert.equal(c.exportMmlButton.disabled,false);c.midiExportAvailable=false;c.updateChipSupport();assert.equal(c.exportMidiButton.disabled,true);});

test('OPM controls only enable for loaded YM2151 files',()=>{const c=setup('ym2151');c.updateChipSupport();assert.equal(c.exportOpmButton.hidden,false);assert.equal(c.exportOpmButton.disabled,false);c.currentBuffer=null;c.updateChipSupport();assert.equal(c.exportOpmButton.disabled,true);c.currentChipKind='ym2612';c.updateChipSupport();assert.equal(c.exportOpmButton.hidden,true);assert.equal(c.exportOpmButton.disabled,true);});

test('YM2151 TFI exports enable with a file, without enabling VGI',()=>{
 const c=setup('ym2151');c.updateChipSupport();assert.equal(c.exportAllTfiButton.disabled,false);assert.equal(c.exportSnapshotTfiButton.disabled,false);assert.equal(c.exportAllVgiButton.disabled,true);assert.equal(c.exportSnapshotVgiButton.disabled,true);
 c.currentBuffer=null;c.updateChipSupport();assert.equal(c.exportAllTfiButton.disabled,true);assert.equal(c.exportSnapshotTfiButton.disabled,true);
});

test('LilyPond enables for extracted notes and disables after clearing the source',()=>{
 for (const chip of ['ym2151','ym2612']) {
  const c=setup(chip);c.updateChipSupport();assert.equal(c.exportLilyPondButton.disabled,false);
  c.currentBuffer=null;c.updateChipSupport();assert.equal(c.exportLilyPondButton.disabled,true);
  c.currentBuffer=new Uint8Array(1);c.midiExportAvailable=false;c.updateChipSupport();assert.equal(c.exportLilyPondButton.disabled,true);
 }
});

test('Sheet Music stays selected for OPN and OPM during playback updates', () => {
 for (const chip of ['ym2610', 'ym2151']) {
  const c = setup(chip); c.updateChipSupport(); c.setOutputTab('sheet-music');
  for (let i=0;i<5;i++) c.updateChipSupport();
  assert.equal(c.sheetMusicTab.getAttribute('aria-selected'), 'true');
  assert.equal(c.sheetMusicPanel.hidden, false);
  assert.equal(c.noteishPanel.hidden, true);
  c.setOutputTab('operator-info'); assert.equal(c.sheetMusicPanel.hidden, true);
  c.currentBuffer=null;c.updateChipSupport();assert.equal(c.sheetMusicTab.disabled,true);
 }
});

for (const chip of ['ym3526','ym3812','y8950']) test(`${chip} keeps operator info, notes and scores reachable`,()=>{
 const c=setup(chip);c.updateChipSupport();
 for(const [tab,panel] of [['operator-info','operatorInfoPanel'],['noteish','noteishPanel'],['sheet-music','sheetMusicPanel']]) {
  c.setOutputTab(tab);for(let i=0;i<3;i++)c.updateChipSupport();
  assert.equal(c[panel].hidden,false,tab);
 }
 assert.equal(c.oplMonitorRoot.hidden,false);assert.equal(c.opnMonitorRoot.hidden,true);
 c.setOutputTab('tfi-info');assert.equal(c.parsedOutputPanel.hidden,false);
});

test('loading OPL after an OPM instrument tab selects operator info',()=>{
 const c=setup('ym2151');c.updateChipSupport();c.setOutputTab('tfi-info');
 c.currentChipKind='ym3526';c.updateChipSupport();
 assert.equal(c.operatorInfoPanel.hidden,false);assert.equal(c.tfiInfoTab.getAttribute('aria-selected'),'false');
});
