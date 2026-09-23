import {isOpl} from './opl_notes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createNesMonitor,applyNesWrite,describeNesNotes} from './nes_notes.js';
import {createGameboyMonitor,describeGameboyNotes} from './gameboy_notes.js';

test('NES live notes report pulse A4, preserve repeated keys and honor channel disable',()=>{
 const s=createNesMonitor();applyNesWrite(s,0x15,1);applyNesWrite(s,0,0xbf);applyNesWrite(s,2,253);applyNesWrite(s,3,8);
 const n=describeNesNotes(s)[0];assert(Math.abs(n.midi-69)<.05);assert.equal(n.trigger,1);
 applyNesWrite(s,3,8);assert.equal(describeNesNotes(s)[0].trigger,2);
 applyNesWrite(s,0x15,0);assert.equal(describeNesNotes(s)[0].midi,null);
});
test('Browser APU Note-ish reset and update support both NES and GB labels',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const start=source.indexOf('function updateApuNoteMonitor()');
 const end=source.indexOf('\n}',source.indexOf('function resetApuNoteChannels()'))+2;
 assert(start>0&&end>start);
 for(const chip of ['nes','gameboy']){
  const c=vm.createContext({isOpl,nesChannelMutes:Array(5).fill(false),currentChipKind:chip,apuNoteChannels:[],apuNoteMonitor:null,
   createNesMonitor,describeNesNotes,createGameboyMonitor,describeGameboyNotes,
   noteishHeader:{nesApuClock:1790000},songTimeMs:()=>0,pruneChannelNoteHistory(){},requestNoteishRender(){},
   buildMonitorChannel:()=>({noteHistory:[],noteMinMidi:null,noteMaxMidi:null})});
  vm.runInContext(source.slice(start,end),c);c.resetApuNoteChannels();
  assert.equal(c.apuNoteChannels[0].label,chip==='nes'?'NES CH1':'GB CH1');
  assert.equal(c.apuNoteChannels[2].apuType,chip==='nes'?'Triangle':'Wave');
  if(chip==='nes'){
   for(const [r,v] of [[0x15,1],[0,0xbf],[2,253],[3,8]])applyNesWrite(c.apuNoteMonitor,r,v);
   c.updateApuNoteMonitor();
   const expected=69+12*Math.log2(1790000/(16*254)/440);
   assert.equal(c.apuNoteChannels[0].toneMidi,expected);
  }
 }
});
test('FDS live UI adds its note row and sixth mute, then returns to standard APU',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const start=source.indexOf('function updateApuNoteMonitor()'),end=source.indexOf('\n}',source.indexOf('function resetApuNoteChannels()'))+2;
 const c=vm.createContext({isOpl,currentChipKind:'nes',nesChannelMutes:Array(5).fill(false),apuNoteChannels:[],apuNoteMonitor:null,
  createNesMonitor,describeNesNotes,noteishHeader:{nesApuClock:(1789773|0x80000000)>>>0},
  songTimeMs:()=>0,pruneChannelNoteHistory(){},requestNoteishRender(){},buildMonitorChannel:()=>({noteHistory:[],noteMinMidi:null,noteMaxMidi:null})});
 vm.runInContext(source.slice(start,end),c);c.resetApuNoteChannels();
 assert.equal(c.apuNoteChannels.length,4);assert.equal(c.apuNoteChannels[3].label,'FDS');assert.equal(c.nesChannelMutes.length,6);
 for(const [r,v] of [[0x20,0xa0],[0x22,7],[0x23,4]])applyNesWrite(c.apuNoteMonitor,r,v);
 c.updateApuNoteMonitor();assert(Math.abs(c.apuNoteChannels[3].toneMidi-69)<.02);
 c.resetApuNoteChannels();assert.equal(c.apuNoteChannels[3].toneMidi,null);
 c.noteishHeader.nesApuClock=1789773;c.resetApuNoteChannels();assert.equal(c.apuNoteChannels.length,3);assert.equal(c.nesChannelMutes.length,5);
});
