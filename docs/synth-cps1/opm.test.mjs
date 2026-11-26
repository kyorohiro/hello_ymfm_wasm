import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpmState} from '../vgm_analyzer/opm_monitor.js';
import {exportOpm} from '../vgm_analyzer/opm_export.js';
import {Ym2151VoiceInspector} from '../js/playground_ym2151_inspector.js';
import {parseOpm} from './opm.js';

test('Analyzer OPM on CH8 restores exact voice registers on CH3 without changing chip globals',()=>{
  const source=createOpmState(), writes=[];
  function write(reg,value) {source.write(reg+7,value);writes.push([reg+2,value]);}
  write(0x20,0xae); write(0x38,0x53);
  for (let slot=0;slot<4;slot++) {
    for (const [base,v] of [[0x40,0x21],[0x60,8],[0x80,0x85],[0xa0,0x88],[0xc0,0x43],[0xe0,0x21]]) write(base+slot*8,v+slot);
  }
  for (const [r,v] of [[8,0x2f],[0x18,93],[0x19,34],[0x19,128|67],[0x1b,2],[0x0f,0x91]]) source.write(r,v);
  const text=exportOpm(source.snapshot(),7,'Arcade Brass');
  const [voice,second]=parseOpm(text+text.replace('@:0 Arcade Brass','@:1 Second'));
  assert.equal(second.name,'Second');assert.equal(voice.mask,5);
  const dest=new Ym2151VoiceInspector({dispatch:({args})=>dest.observeWrite(...args)});
  dest.invoke('setVoice',[2,voice.patch]);
  for (const [r,v] of writes) assert.equal(dest.registers[r],v,'register '+r.toString(16));
  assert.equal(dest.registers[0x20+7],0);
  assert.equal(dest.registers[8],0);
  assert.equal(dest.registers[0x18],0);
  assert.equal(dest.registers[0x0f],0);
  dest.invoke('setLFO',[voice.lfo]);dest.invoke('setNoise',[voice.noise]);
  assert.equal(dest.amDepth,34);assert.equal(dest.pmDepth,67);
  assert.equal(dest.registers[0x18],93);assert.equal(dest.registers[0x0f],0x91);
  assert.throws(()=>parseOpm(text.replace(/^C2:.*$/m,'')),/missing C2/);
  assert.throws(()=>parseOpm(text.replace(/^M2: /m,'M2: 999 ')),/Invalid M2/);
});
