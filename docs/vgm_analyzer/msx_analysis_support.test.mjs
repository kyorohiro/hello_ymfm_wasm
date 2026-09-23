import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {midiChipKind} from './vgm_notes.js';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
test('AY with SCC or SCC+ keeps score and Note-ish unavailable while AY alone has scores',()=>{
 const assignment=source.match(/^  midiExportAvailable = .*midiChipKind.*;$/m)?.[0];
 assert(assignment);
 const start=source.indexOf('function updateChipSupport()'),end=source.indexOf('\nfunction buildParseInfo',start);
 assert(start>=0&&end>start);
 for(const scc of [0,1789773,(1789773|0x80000000)>>>0]){
  const header={ay8910Clock:1789773,k051649Clock:scc};
  const c=vm.createContext({...chipSupportContext(),midiChipKind,currentBuffer:new Uint8Array(1),
   currentChipKind:scc?'msx':'ay8910',noteishHeader:header,vgm:{header},setOutputTab(){}});
  vm.runInContext(assignment+'\n'+source.slice(start,end)+'\nupdateChipSupport();',c);
  assert.equal(c.midiExportAvailable,!scc);
  for(const key of ['sheetMusicTab','noteishTab','exportMidiButton','exportLilyPondButton'])assert.equal(c[key].disabled,!!scc,key);
  for(const id of ['showSheetMusicButton','exportMusicSheetButton'])assert.equal(c.document.getElementById(id).disabled,!!scc,id);
 }
});
