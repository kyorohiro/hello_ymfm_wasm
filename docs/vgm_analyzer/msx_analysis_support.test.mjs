import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {midiChipKind} from './vgm_notes.js';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
test('AY with SCC or SCC+ enables score and Note-ish alongside AY alone',()=>{
 const assignment=source.match(/^  midiExportAvailable = .*midiChipKind.*;$/m)?.[0];
 assert(assignment);
 const start=source.indexOf('function updateChipSupport()'),end=source.indexOf('\nfunction buildParseInfo',start);
 assert(start>=0&&end>start);
 for(const scc of [0,1789773,(1789773|0x80000000)>>>0]){
  const header={ay8910Clock:1789773,k051649Clock:scc};
  const c=vm.createContext({...chipSupportContext(),midiChipKind,currentBuffer:new Uint8Array(1),
   currentChipKind:scc?'msx':'ay8910',noteishHeader:header,vgm:{header},setOutputTab(){}});
  vm.runInContext(assignment+'\n'+source.slice(start,end)+'\nupdateChipSupport();',c);
  assert.equal(c.midiExportAvailable,true);
  if(scc)assert.equal(c.exportMmlButton.disabled,true);
  for(const key of ['sheetMusicTab','noteishTab','exportMidiButton','exportLilyPondButton'])assert.equal(c[key].disabled,false,key);
  for(const id of ['showSheetMusicButton','exportMusicSheetButton'])assert.equal(c.document.getElementById(id).disabled,false,id);
 }
});

test('Live UI labels every MSX chip, records pitches and clears state on reset',async()=>{
 const {createMsxNoteMonitor,describeMsxNotes,applyMsxNoteWrite}=await import('./msx_notes.js');
 const header={ay8910Clock:1789773,ym2413Clock:3579545,y8950Clock:3579545,k051649Clock:(1789773|0x80000000)>>>0};
 const c=vm.createContext({...chipSupportContext(),currentChipKind:'msx',noteishHeader:header,
  apuNoteMonitor:createMsxNoteMonitor(header),apuNoteChannels:[],createMsxNoteMonitor,describeMsxNotes,
  buildMonitorChannel:i=>({channel:i,noteHistory:[],noteMinMidi:null,noteMaxMidi:null}),
  songTimeMs:()=>100,pruneChannelNoteHistory(){},requestNoteishRender(){}});
 const fn=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};
 vm.runInContext(fn('updateApuNoteMonitor')+'\n'+fn('resetApuNoteChannels'),c);
 for(const args of [[4,0x81,127],[1,8,127],[3,0,16]])applyMsxNoteWrite(c.apuNoteMonitor,'k051649',...args);
 c.updateApuNoteMonitor();
 assert.equal(c.apuNoteChannels.length,26);
 assert.equal(c.apuNoteChannels[25].label,'SCC+ CH5');
 assert.equal(c.apuNoteChannels[25].keyOn,true);
 assert(Number.isFinite(c.apuNoteChannels[25].toneMidi));
 c.resetApuNoteChannels();assert(c.apuNoteChannels.every(ch=>!ch.keyOn));
});
