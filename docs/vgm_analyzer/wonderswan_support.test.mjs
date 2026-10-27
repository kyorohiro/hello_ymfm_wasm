import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';
import {createWonderSwanMonitor,applyWonderSwanWrite,describeWonderSwanNotes} from './wonderswan_notes.js';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
const fn=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};

test('WonderSwan opens Note-ish, enables score exports and disables unsupported views',()=>{
  const context={...chipSupportContext(),currentChipKind:'wonderswan',currentBuffer:{},midiExportAvailable:true,
    setOutputTab(name){context.selected=name;}};
  vm.createContext(context);vm.runInContext(fn('updateChipSupport'),context);
  context.updateChipSupport();assert.equal(context.selected,'noteish');
  for(const key of ['operatorInfoTab','tfiInfoTab','exportMmlButton','exportSnapshotButton'])assert.equal(context[key].disabled,true,key);
  for(const key of ['sampleTab','noteishTab','sheetMusicTab','exportMidiButton','exportLilyPondButton'])assert.equal(context[key].disabled,false,key);
  assert.match(context.document.getElementById('chipSupportNotice').textContent,/CH2 Voice PCM, CH3 sweep and CH4 noise/);
  assert.match(context.document.getElementById('chipSupportNotice').textContent,/Sample Explorer exports Wave RAM and timed Voice PCM/);
  context.currentBuffer=null;context.updateChipSupport();
  for(const key of ['sheetMusicTab','exportMidiButton','exportLilyPondButton'])assert.equal(context[key].disabled,true,key);
  context.currentChipKind='ym2612';context.updateChipSupport();assert.equal(context.operatorInfoTab.disabled,false);
});

test('WonderSwan exposes four independent channel mute controls',()=>{
  const mutes=Array(4).fill(false),context=vm.createContext({wonderswanChannelMutes:mutes});
  vm.runInContext(fn('channelMutesForChip'),context);
  assert.equal(context.channelMutesForChip('wonderswan'),mutes);
  assert.match(source,/const CHANNEL_MUTE_CHIPS = \['wonderswan'/);
});

test('header display and Song file loading identify WonderSwan',()=>{
  const context=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function formatClockHz('),source.indexOf('function applyYm2203WriteToMonitor(')),context);
  assert.deepEqual([...context.detectHeaderChips({wonderswanClock:3072000})],['WonderSwan (3.07 MHz)']);
  const start=source.indexOf('  currentBuffer = buffer;'),end=source.indexOf('  playbackSeek.max',start);
  const buffer=new Uint8Array(1),loads=[];
  vm.runInNewContext(source.slice(start,end),{buffer,currentBuffer:null,currentChipKind:'wonderswan',songTimeline:{load:value=>loads.push(value)}});
  assert.deepEqual(loads,[buffer]);
});

test('deployed Analyzer entry, Worker, player and score graph invalidate older parsers together',()=>{
  const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
  const token='pokey-vgm-1';
  assert.match(read('./index.html'),new RegExp('vgm_analyzer\\.js\\?v='+token));
  assert.match(read('./note_timeline_view.js'),new RegExp('note_timeline_worker\\.js\\?v='+token));
  for(const file of ['./vgm_analyzer.js','./playback_core.js','./analyzer_core.js','./note_timeline_worker.js',
    './vgm_lilypond.js','./vgm_midi.js','./vgm_notes.js','./wonderswan_notes.js','./command_editor.js',
    './pokey_notes.js','./pokey_monitor.js','./pokey_playback.js','../js/vgmplayer.js']){
    const text=read(file);
    for(const ref of text.matchAll(/['"]([^'"\n]*(?:ym2612vgm|vgmplayer|playback_core|analyzer_core|vgm_lilypond|vgm_midi|vgm_notes|wonderswan_notes|source_mutes|command_editor|note_timeline_view|pokey_notes|pokey_monitor|pokey_playback)\.js)(?:\?([^'"\n]*))?['"]/g)){
      assert.equal(ref[2],'v='+token,`${file}: ${ref[1]}`);
    }
  }
  // The website revision must not create a second package class identity.
  assert(!read('../../web/vgmplayer.js').includes(token));
});

test('live monitor follows relative engine writes, mode labels, history and replay reset',()=>{
  const writes=[],engine={writeWonderSwan:(r,v)=>writes.push([r,v]),reset(){}},context=vm.createContext({engine,
    createWonderSwanMonitor,applyWonderSwanWrite,describeWonderSwanNotes,currentChipKind:'wonderswan',
    noteishHeader:{wonderswanClock:3072000},apuNoteChannels:[],apuNoteMonitor:null,isOpl:()=>false,
    songTimeMs:()=>0,requestNoteishRender(){},pruneChannelNoteHistory(){},
    buildMonitorChannel:()=>({noteHistory:[],noteMinMidi:null,noteMaxMidi:null})});
  vm.runInContext(fn('updateApuNoteMonitor')+'\n'+fn('resetApuNoteChannels')+'\nresetApuNoteChannels();',context);
  const start=source.indexOf("      if (chip === 'wonderswan') {");
  const end=source.indexOf("      if (chip === 'huc6280') {",start);
  vm.runInContext("const chip='wonderswan';\n"+source.slice(start,end),context);
  engine.writeWonderSwan(0x11,8);engine.writeWonderSwan(9,255);engine.writeWonderSwan(0x10,2);
  assert.equal(context.apuNoteChannels.length,4);assert.equal(context.apuNoteChannels[1].label,'WonderSwan CH2');
  assert.equal(context.apuNoteChannels[1].apuType,'Wave');assert(context.apuNoteChannels[1].toneMidi!==null);
  engine.writeWonderSwan(0x10,0x22);assert.equal(context.apuNoteChannels[1].apuType,'Voice PCM');assert.equal(context.apuNoteChannels[1].toneMidi,null);
  assert(context.apuNoteChannels[1].noteHistory.some(n=>n.midiFloat===null));
  engine.reset();assert(context.apuNoteChannels.every(ch=>ch.toneMidi===null));
  assert.equal(writes.length,4);
});
