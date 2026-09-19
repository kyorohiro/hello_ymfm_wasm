import {detectPlaybackChipKind} from './playback_core.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
function fn(name) {
  const start=source.indexOf(`function ${name}(`);
  const end=source.indexOf('\n}',start)+2;
  return source.slice(start,end);
}
const tabNames=['operatorInfoTab','noteishTab','tfiInfoTab','sampleTab'];
const buttonNames=['exportMidiButton','exportMmlButton','exportSnapshotTfiButton','exportSnapshotVgiButton','exportSnapshotButton','exportAllTfiButton','exportAllVgiButton'];
for (const chip of ['msx','ym3526','ym2413','ym2151','ym3812','ymf262']) test(`${chip} playback-only mode disables analysis and restores OPN tabs`,()=>{
  const notice={hidden:true};
  const context={opnMonitorRoot:{},ayMonitorRoot:{},currentChipKind:chip,document:{getElementById:()=>notice},selected:null,
    setOutputTab(name){context.selected=name;}};
  for(const name of [...tabNames,...buttonNames])context[name]={disabled:false,title:''};
  vm.createContext(context);vm.runInContext(fn('updateChipSupport'),context);
  context.updateChipSupport();
  for(const name of [...tabNames,...buttonNames]) {
    assert.equal(context[name].disabled,true,name);
    assert.equal(context[name].title,'Support coming soon.');
  }
  assert.equal(context.selected,'parsed-output');assert.equal(notice.hidden,false);
  context.currentChipKind='ym2612';context.updateChipSupport();
  for(const name of tabNames)assert.equal(context[name].disabled,false);
  assert.equal(notice.hidden,true);
});
test('gameboy playback-only mode leaves only Note-ish enabled',()=>{
  // Regression: Game Boy DMG note-ish (CH1/2 square, CH3 wave) was added
  // after 'gameboy' had already been placed in the blanket "force
  // parsed-output, disable every analysis tab" lists shared with
  // segapcm/y8950/etc. This locks in that only the Note-ish tab (and
  // setOutputTab allowing 'noteish') stay reachable for Game Boy.
  const notice={hidden:true};
  const stub=()=>({disabled:false,hidden:true,title:'',getAttribute(){return 'false';},setAttribute(){}});
  const context={opnMonitorRoot:{},opmMonitorRoot:{},ayMonitorRoot:{},ym2413MonitorRoot:{},noteishHeader:{},
    currentChipKind:'gameboy',currentBuffer:null,midiExportAvailable:false,musicSheet:null,
    exportLilyPondButton:stub(),exportAllOpmButton:stub(),exportOpmButton:stub(),sheetMusicTab:stub(),parsedOutputTab:stub(),
    document:{getElementById:()=>notice},selected:null,
    setOutputTab(name){context.selected=name;}};
  for(const name of [...tabNames,...buttonNames])context[name]={disabled:false,title:'',getAttribute(){return 'false';}};
  context.parsedOutputTab.getAttribute=()=>'true'; // already on the one tab gameboy is allowed to stay on
  vm.createContext(context);vm.runInContext(fn('updateChipSupport'),context);
  context.updateChipSupport();
  assert.equal(context.noteishTab.disabled,false,'noteishTab');
  assert.equal(context.noteishTab.title,'');
  for(const name of ['operatorInfoTab','tfiInfoTab','sampleTab',...buttonNames.filter(n=>n!=='exportMidiButton')]) {
    assert.equal(context[name].disabled,true,name);
    assert.equal(context[name].title,'Support coming soon.');
  }
  // Regression: Game Boy MIDI export was added after this test was written;
  // it must not fall into the blanket playback-only "coming soon" disable.
  assert.equal(context.exportMidiButton.disabled,true,'no buffer loaded yet');
  assert.notEqual(context.exportMidiButton.title,'Support coming soon.');
  context.currentBuffer={};context.midiExportAvailable=true;context.updateChipSupport();
  assert.equal(context.exportMidiButton.disabled,false,'buffer + midiExportAvailable enables Game Boy MIDI export');
  context.currentBuffer=null;context.midiExportAvailable=false;context.updateChipSupport();
  assert.equal(notice.hidden,false);
  assert.match(notice.textContent,/Note-ish available/);
  assert.equal(context.selected,null,'already on parsed-output: no forced switch needed');
  // Regression: loading a Game Boy file while a stale "operator-info" tab
  // (left over from a previous, unrelated file) is still selected must not
  // leave that tab showing irrelevant Sega PSG/channel-grid content; it must
  // be switched to the one tab Game Boy actually supports.
  context.operatorInfoTab.getAttribute=()=>'true';
  context.parsedOutputTab.getAttribute=()=>'false';
  context.updateChipSupport();
  assert.equal(context.selected,'noteish');
});
test('segapcm also switches away from a stale operator-info tab to parsed-output',()=>{
  // Same class of bug as Game Boy above, for a chip with no Note-ish at
  // all: Sega PCM must not leave a leftover operator-info tab showing
  // irrelevant content either.
  const notice={hidden:true};
  const stub=()=>({disabled:false,hidden:true,title:'',getAttribute(){return 'false';},setAttribute(){}});
  const context={opnMonitorRoot:{},opmMonitorRoot:{},ayMonitorRoot:{},ym2413MonitorRoot:{},noteishHeader:{},
    currentChipKind:'segapcm',currentBuffer:null,midiExportAvailable:false,musicSheet:null,
    exportLilyPondButton:stub(),exportAllOpmButton:stub(),exportOpmButton:stub(),sheetMusicTab:stub(),parsedOutputTab:stub(),
    document:{getElementById:()=>notice},selected:null,
    setOutputTab(name){context.selected=name;}};
  for(const name of [...tabNames,...buttonNames])context[name]={disabled:false,title:'',getAttribute(){return 'false';}};
  context.operatorInfoTab.getAttribute=()=>'true';
  vm.createContext(context);vm.runInContext(fn('updateChipSupport'),context);
  context.updateChipSupport();
  assert.equal(context.selected,'parsed-output');
  for(const name of tabNames) assert.equal(context[name].disabled,true,name);
});
test('setOutputTab allows noteish and parsed-output for gameboy but forces parsed-output for anything else',()=>{
  const stub=()=>({setAttribute(){},hidden:false,tabIndex:0});
  const context=vm.createContext({currentChipKind:'gameboy',currentBuffer:null,midiExportAvailable:false,status:{textContent:'',hidden:true},
    noteishViewMode:'live',sampleExplorer:{stop(){}},songTimeline:{active(){}},requestNoteishRender(){},renderNoteishGrid(){},
    sheetMusicPanel:stub(),sheetMusicTab:stub(),musicSheet:null,tfiInfo:{setVisible(){}},opmInfo:{setVisible(){}},
    tfiInfoTab:stub(),samplePanel:stub(),sampleTab:stub(),operatorInfoPanel:stub(),operatorInfoTab:stub(),
    parsedOutputPanel:stub(),parsedOutputTab:stub(),noteishPanel:stub(),noteishTab:stub(),
    setStatus(message){context.status.textContent=message;}});
  vm.runInContext(fn('setOutputTab'),context);
  context.setOutputTab('noteish');assert.equal(context.noteishPanel.hidden,false,'noteish stays reachable');
  context.setOutputTab('operator-info');assert.equal(context.parsedOutputPanel.hidden,false,'unsupported tab falls back to parsed-output');
  assert.equal(context.operatorInfoPanel.hidden,true);
});
test('YM2413 + PSG does not enter the OPN tone monitor',()=>{
  const context=vm.createContext({currentChipKind:'ym2413',toneChannels:[{old:true}]});
  vm.runInContext(fn('updateToneMonitor'),context);
  context.updateToneMonitor();assert.equal(context.toneChannels.length,0);
});
test('chip selection recognizes YM2413 and preserves OPN selection',()=>{
  const context={detectPlaybackChipKind};
  assert.equal(context.detectPlaybackChipKind({y8950Clock:3579545,ay8910Clock:1789773,ym2413Clock:3579545}),'msx');
  assert.equal(context.detectPlaybackChipKind({ym2413Clock:3579545,psgClock:3579545}),'ym2413');
  assert.equal(context.detectPlaybackChipKind({ym2612Clock:7670454}),'ym2612');
  assert.equal(context.detectPlaybackChipKind({ym2151Clock:3579545}),'ym2151');
  assert.equal(context.detectPlaybackChipKind({ym3526Clock:3579545}),'ym3526');
  assert.equal(context.detectPlaybackChipKind({ym3812Clock:3579545}),'ym3812');
  assert.equal(context.detectPlaybackChipKind({ymf262Clock:14318180}),'ymf262');
  assert.equal(context.detectPlaybackChipKind({segaPcmClock:4000000}),'segapcm');
  // YM2151 + Sega PCM (e.g. OutRun) must resolve to the mixing-capable
  // 'ym2151' path, not the OPL family's single-chip 'segapcm' path, which
  // would reject the combination as unsupported.
  assert.equal(context.detectPlaybackChipKind({ym2151Clock:3579545,segaPcmClock:4000000}),'ym2151');
  assert.equal(context.detectPlaybackChipKind({gameBoyDmgClock:4194304}),'gameboy');
  // Real-world bug: an MSX PSG/OPLL track whose header reserves space up to
  // a 1.61-era offset can have stray non-zero bytes at 0x80 (Game Boy DMG
  // clock) or 0x38 (Sega PCM clock) even though it isn't that chip at all.
  // A long-established chip field actually being set must win.
  assert.equal(context.detectPlaybackChipKind({ay8910Clock:1789773,gameBoyDmgClock:4194304}),'ay8910');
  assert.equal(context.detectPlaybackChipKind({y8950Clock:3579545,ay8910Clock:1789773,gameBoyDmgClock:4194304}),'msx');
  assert.equal(context.detectPlaybackChipKind({ym2612Clock:7670454,segaPcmClock:4000000}),'ym2612');
});
