// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateResearchSid} from '../docs/sid8580-lab/parser.js';
import {sid8580MachineFixtures} from './helpers/sid8580_machine_fixtures.mjs';
import {createPsidCiaFixture} from './helpers/psid_cia_fixtures.mjs';
import {validateBrowserPsid} from '../tetorica_src/runtime/sid_psid.js';
import {validateBrowserRsid} from '../tetorica_src/runtime/sid_rsid.js';
import {researchPsidView} from '../scripts/prepare_sid8580_parser.mjs';

function hints(source,clock,model){const bytes=source.slice(),v=new DataView(bytes.buffer);v.setUint16(118,(v.getUint16(118)&~0x3c)|(clock<<2)|(model<<4));return bytes;}
const fixtures=sid8580MachineFixtures();
test('research parser retains authored PAL/8580 bytes and selects actual machine timing',()=>{
  assert.equal(fixtures.length,13);
  for(const fixture of fixtures){
    const before=fixture.bytes.slice(),parsed=validateResearchSid(fixture.bytes);
    assert.equal(parsed.clock,'pal');assert.equal(parsed.model,'8580');assert.equal(parsed.selectedModel,'8580');
    assert.equal(parsed.selectedClock,'pal');assert.equal(parsed.playbackBackend,'research-c64');
    assert.deepEqual(parsed.originalBytes,before);assert.deepEqual(fixture.bytes,before);
    assert.deepEqual(parsed.selection,{clock:'header',model:'header'});
    assert(['cia','vbi','c64-irq'].includes(parsed.timing));
  }
});
test('unspecified/either hints require explicit choices and keep the original declarations',()=>{
  for(const c of [0,3])for(const m of [0,3]){
    const bytes=hints(fixtures[0].bytes,c,m),before=bytes.slice();
    assert.throws(()=>validateResearchSid(bytes),/PAL explicitly/);
    assert.throws(()=>validateResearchSid(bytes,{clock:'pal'}),/8580 explicitly/);
    const parsed=validateResearchSid(bytes,{clock:'pal',model:'8580'});
    assert.equal(parsed.clock,c?'any':'unknown');assert.equal(parsed.model,m?'any':'unknown');
    assert.deepEqual(parsed.selection,{clock:'explicit',model:'explicit'});assert.deepEqual(bytes,before);
  }
});
test('known NTSC/6581 declarations cannot be silently retargeted',()=>{
  assert.throws(()=>validateResearchSid(hints(fixtures[0].bytes,2,2),{clock:'pal',model:'8580'}),/NTSC/);
  assert.throws(()=>validateResearchSid(hints(fixtures[0].bytes,1,1),{model:'8580'}),/6581 tune/);
  for(const options of [{clock:'ntsc'},{model:'6581'},{environment:'other'},{subtune:0},{subtune:257}])
    assert.throws(()=>validateResearchSid(fixtures[0].bytes,options),RangeError);
});
test('production PSID/RSID guards still reject the same 8580 files',()=>{
  for(const f of fixtures){const validator=f.bytes[0]===80?validateBrowserPsid:validateBrowserRsid;
    assert.throws(()=>validator(f.bytes,{clock:'pal',model:'6581'}),/8580/);}
  const old=createPsidCiaFixture();assert.equal(validateBrowserPsid(old.bytes).selectedModel,'6581');
});
test('authored demo defaults select the advertised VBI, CIA and RSID timing',async()=>{
  for(const [file,timing,subtune]of [['vbi','vbi',1],['cia','cia',2],['irq','c64-irq',1]]){
    const parsed=validateResearchSid(await readFile(new URL(`../docs/sid8580-lab/demos/${file}.sid`,import.meta.url)));
    assert.equal(parsed.timing,timing);assert.equal(parsed.subtune,subtune);
  }
});
test('research layout view preserves the entire original parser and catches a stale recipe',async()=>{
  const source=await readFile(new URL('../tetorica_src/runtime/sid_psid.js',import.meta.url),'utf8');
  assert.equal(await readFile(new URL('../docs/sid8580-lab/psid_structure.js',import.meta.url),'utf8'),researchPsidView(source));
  assert.throws(()=>researchPsidView(''),/one original/);
  assert.throws(()=>researchPsidView(source+'\nexport {parsePsidStructure};'),/already exports/);
});
