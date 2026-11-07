// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSidModel,validatePlayerSid,createPlayerCore} from '../docs/sid-player/models.js';
import {parsePsid,validateBrowserPsid} from '../docs/js/sid_psid.js';
import {validateBrowserRsid} from '../docs/js/sid_rsid.js';
import {createSidPlayerTestFixture} from './helpers/sid_player_fixtures.mjs';
import {createRsidFixture,createRsidBasicFixture} from './helpers/rsid_fixtures.mjs';
import {createSid8580MachineFixture} from './helpers/sid8580_machine_fixtures.mjs';

function hints(source,clock,model){const bytes=source.slice(),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);v.setUint16(118,(v.getUint16(118)&~0x3c)|(clock<<2)|(model<<4));return bytes;}
const sources=()=>[createSidPlayerTestFixture(),createRsidFixture().bytes];

test('Auto selects each original known model while keeping the header and manual declaration guard',()=>{
  for(const source of sources())for(const [bits,model]of [[1,'6581'],[2,'8580']]){
    const bytes=hints(source,1,bits),before=bytes.slice();
    assert.equal(resolveSidModel(bytes),model);
    for(const modelSelection of ['auto',model]){
      const parsed=validatePlayerSid(bytes,{modelSelection,assumeUnknown:false});
      assert.equal(parsed.model,model);assert.equal(parsed.selectedModel,model);assert.equal(parsed.clock,'pal');
      assert.deepEqual(parsed.selection,{clock:'header',model:'header'});assert.deepEqual(parsed.originalBytes,before);
      assert.equal(parsed.playbackBackend,'c64');assert.equal(parsed.playerOptions.model,model);
      assert.deepEqual(bytes,before);
    }
    const mismatch=model==='6581'?'8580':'6581';
    assert.throws(()=>resolveSidModel(bytes,{modelSelection:mismatch}),error=>error.code==='SID_MODEL_MISMATCH'&&error.message.includes(model));
    assert.throws(()=>validatePlayerSid(bytes,{modelSelection:mismatch}),error=>error.code==='SID_MODEL_MISMATCH');
  }
});

test('unknown/either defaults to PAL6581 but manual choices resolve either model without rewriting bytes',()=>{
  for(const source of sources())for(const bits of [0,3]){
    const bytes=hints(source,bits,bits),before=bytes.slice(),raw=bits?'any':'unknown';
    const automatic=validatePlayerSid(bytes);
    assert.equal(automatic.selectedModel,'6581');assert.equal(automatic.model,raw);assert.equal(automatic.clock,raw);
    assert.deepEqual(automatic.selection,{clock:'explicit',model:'explicit'});
    assert.throws(()=>validatePlayerSid(bytes,{assumeUnknown:false}),error=>error.code==='SID_MODEL_CHOICE_REQUIRED');
    for(const modelSelection of ['6581','8580']){
      const parsed=validatePlayerSid(bytes,{modelSelection});
      assert.equal(parsed.selectedModel,modelSelection);assert.equal(parsed.model,raw);assert.equal(parsed.clock,raw);
      assert.deepEqual(parsed.originalBytes,before);assert.deepEqual(bytes,before);
      assert.equal(parsed.playerOptions.modelSelection,modelSelection);assert.equal(parsed.playerOptions.assumeUnknown,true);
      assert.throws(()=>validatePlayerSid(bytes,{modelSelection,assumeUnknown:false}),error=>error.code==='SID_CLOCK_CHOICE_REQUIRED');
    }
    const explicit=validatePlayerSid(hints(bytes,1,bits),{modelSelection:'8580',assumeUnknown:false});
    assert.equal(explicit.selectedModel,'8580');assert.deepEqual(explicit.selection,{clock:'header',model:'explicit'});
  }
});

test('clock, model and layout constraints remain explicit and strict',async()=>{
  for(const source of sources())for(const bits of [1,2]){
    const ntsc=hints(source,2,bits);
    assert.throws(()=>validatePlayerSid(ntsc),error=>error.code==='SID_CLOCK_UNSUPPORTED'&&/NTSC/.test(error.message));
  }
  for(const options of [{modelSelection:'other'},{modelSelection:8580},{assumeUnknown:1},{clock:'ntsc'},{model:'other'}])
    assert.throws(()=>validatePlayerSid(createSidPlayerTestFixture(),options));
  assert.throws(()=>validatePlayerSid(hints(createSidPlayerTestFixture(),0,0),{modelSelection:'8580',model:'6581'}),error=>error.code==='SID_MODEL_MISMATCH');
  assert.throws(()=>validatePlayerSid({}),TypeError);assert.throws(()=>validatePlayerSid(new Uint8Array([1,2,3])),/signature/);
  assert.throws(()=>validatePlayerSid(createSidPlayerTestFixture(),{maxBytes:125}),/limit/);
  const extra=hints(createSidPlayerTestFixture(),1,2);extra[122]=0x42;
  assert.throws(()=>validatePlayerSid(extra),/reserved|SID/i);
  await assert.rejects(createPlayerCore({model:'other'}),RangeError);
  await assert.rejects(createPlayerCore({backend:'other'}),RangeError);
  await assert.rejects(createPlayerCore({model:'6581',backend:'8580'}),/requires model 8580/);
});

test('Direct VBI remains a 6581 option while CIA and RSID always select their C64 machine',()=>{
  const old=createSidPlayerTestFixture();assert.equal(validatePlayerSid(old,{vbiBackend:'direct'}).playbackBackend,'direct');
  const vbi=createSid8580MachineFixture('psid-vbi');
  assert.throws(()=>validatePlayerSid(vbi.bytes,{vbiBackend:'direct'}),error=>error.code==='SID_8580_DIRECT_UNSUPPORTED'&&/8580.*Direct VBI/.test(error.message));
  const cia=createSid8580MachineFixture('psid-cia');
  assert.equal(validatePlayerSid(cia.bytes,{subtune:cia.subtune,vbiBackend:'direct'}).playbackBackend,'c64');
  const rsid=createSid8580MachineFixture('rsid-cia-irq');
  assert.equal(validatePlayerSid(rsid.bytes,{vbiBackend:'direct'}).playbackBackend,'c64');
  for(const mode of ['other',null])assert.throws(()=>validatePlayerSid(vbi.bytes,{vbiBackend:mode}),RangeError);
});

test('BASIC still requires the caller firmware environment and canonical6581/CLI guards are unchanged',()=>{
  const basic=hints(createRsidBasicFixture().bytes,1,2);
  assert.throws(()=>validatePlayerSid(basic),/BASIC.*ROM/);
  assert.equal(validatePlayerSid(basic,{environment:'rom'}).environment,'rom');
  const psid=createSid8580MachineFixture('psid-vbi').bytes,rsid=createSid8580MachineFixture('rsid-cia-irq').bytes;
  assert.throws(()=>validateBrowserPsid(psid,{clock:'pal',model:'6581'}),/8580/);
  assert.throws(()=>validateBrowserRsid(rsid,{clock:'pal',model:'6581'}),/8580/);
  assert.throws(()=>parsePsid(psid),/6581/);
  assert.equal(validateBrowserPsid(createSidPlayerTestFixture()).playbackBackend,'direct');
});
