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
test('YM2413 + PSG does not enter the OPN tone monitor',()=>{
  const context=vm.createContext({currentChipKind:'ym2413',toneChannels:[{old:true}]});
  vm.runInContext(fn('updateToneMonitor'),context);
  context.updateToneMonitor();assert.equal(context.toneChannels.length,0);
});
test('chip selection recognizes YM2413 and preserves OPN selection',()=>{
  const context=vm.createContext({});vm.runInContext(fn('detectPlaybackChipKind'),context);
  assert.equal(context.detectPlaybackChipKind({y8950Clock:3579545,ay8910Clock:1789773,ym2413Clock:3579545}),'msx');
  assert.equal(context.detectPlaybackChipKind({ym2413Clock:3579545,psgClock:3579545}),'ym2413');
  assert.equal(context.detectPlaybackChipKind({ym2612Clock:7670454}),'ym2612');
  assert.equal(context.detectPlaybackChipKind({ym2151Clock:3579545}),'ym2151');
  assert.equal(context.detectPlaybackChipKind({ym3526Clock:3579545}),'ym3526');
  assert.equal(context.detectPlaybackChipKind({ym3812Clock:3579545}),'ym3812');
  assert.equal(context.detectPlaybackChipKind({ymf262Clock:14318180}),'ymf262');
});
