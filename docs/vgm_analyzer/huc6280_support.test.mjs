import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';
import {applySourceMutes} from './source_mutes.js';
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
test('HuC6280 opens Note-ish and disables unavailable analysis while switching back restores tabs',()=>{
  const context={...chipSupportContext(),currentChipKind:'huc6280',currentBuffer:{},
    setOutputTab(name){context.selected=name;}};
  const start=source.indexOf('function updateChipSupport(');
  vm.createContext(context);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
  context.updateChipSupport();assert.equal(context.selected,'noteish');
  for(const key of ['operatorInfoTab','tfiInfoTab','sampleTab','sheetMusicTab','exportMidiButton','exportMmlButton'])assert.equal(context[key].disabled,true,key);
  assert.equal(context.noteishTab.disabled,false);
  assert.match(context.document.getElementById('chipSupportNotice').textContent,/HuC6280/);
  // No synthetic PSG control may be applied to this engine.
  applySourceMutes({},'huc6280',{});
  context.currentChipKind='ym2612';context.updateChipSupport();
  assert.equal(context.operatorInfoTab.disabled,false);
});
test('Browser exposes six HuC6280 channel mutes',()=>{
  const start=source.indexOf('function channelMutesForChip('),mutes=Array(6).fill(false);
  const context=vm.createContext({huc6280ChannelMutes:mutes});
  vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
  assert.equal(context.channelMutesForChip('huc6280'),mutes);
});
