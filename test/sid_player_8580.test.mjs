// SPDX-License-Identifier: BSD-3-Clause
// Actual pinned WASMs and authored programs only; no game music or firmware.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Sid8580PlayerCore} from '../docs/sid-player/core8580.js';
import {Sid8580MachineCore} from '../docs/sid8580-lab/core.js';
import {validatePlayerSid,createPlayerCore} from '../docs/sid-player/models.js';
import {SidPlayerCore} from '../docs/sid-player/core.js';
import {RsidPlayerCore} from '../docs/sid-player/rsid_core.js';
import {finishResearchPreflight} from '../docs/sid8580-lab/preflight.js';
import {createSid8580MachineFixture} from './helpers/sid8580_machine_fixtures.mjs';
import {createSidPlayerTestFixture} from './helpers/sid_player_fixtures.mjs';
import {createRsidFixture,createRsidBasicFixture} from './helpers/rsid_fixtures.mjs';
import {createRsidTestRoms} from './helpers/rsid_test_roms.mjs';

const [endpointBinary,machineBinary,directBinary,c64Binary]=await Promise.all([
  'sid8580-machine/sid8580-endpoint.wasm','sid8580-machine/sid8580-machine.wasm','sid-player/sid-player.wasm','sid-rsid/sid-rsid.wasm',
].map(path=>readFile(new URL('../docs/generated/'+path,import.meta.url))));
const create=(sampleRate=48000)=>Sid8580PlayerCore.create({sampleRate,endpointBinary,machineBinary});
const pcm=output=>Buffer.from(output.buffer,output.byteOffset,output.byteLength);

test('8580 adapter preserves the existing real VBI/CIA/RSID PCM at three sample rates',async()=>{
  for(const sampleRate of [44100,48000,96000])for(const profile of ['psid-vbi','psid-cia','rsid-cia-irq']){
    const fixture=createSid8580MachineFixture(profile),core=await create(sampleRate);
    const reference=await Sid8580MachineCore.create({sampleRate,endpointBinary,machineBinary,profiles:{resonance:false,cutoff:false}});
    try{
      const parsed=validatePlayerSid(fixture.bytes,{subtune:fixture.subtune});
      const load={...parsed.playerOptions,subtune:fixture.subtune};
      const state=core.load(parsed.originalBytes,load);
      reference.load(fixture.bytes,{model:'8580',clock:'pal',subtune:fixture.subtune});
      assert.equal(state.model,'8580');assert.equal(state.backend,'c64');assert.equal(state.modelStatus,'preview');
      assert.equal(state.profileBits,0);assert.deepEqual(state.profiles,{resonance:false,cutoff:false});
      assert.deepEqual(state.voices,[{envelope:null,phase:null},{envelope:null,phase:null},{envelope:null,phase:null}]);
      assert.deepEqual(state.targetSelection,{clock:'header',model:'header'});assert.equal(core.parsed.playbackBackend,'c64');
      const output=core.render(8192);assert(output.every(Number.isFinite));assert(output.some(x=>x!==0));
      assert.deepEqual(pcm(output),pcm(reference.render(8192)),`${profile}/${sampleRate}: adapter changed PCM`);
      const after=core.getState();assert.equal(after.cycles,after.sidCycles);assert.equal(after.subtune,fixture.subtune);
      assert(after.positionFrames>state.positionFrames);assert(after.cycles>=state.cycles);assert.equal(after.playbackBackend,undefined);
      // A fast output rate can initially drain retained initialization PCM
      // without advancing the CPU. Render beyond that queue before requiring
      // new machine cycles, while retaining exact adapter/reference parity.
      assert.deepEqual(pcm(core.render(Math.ceil(sampleRate*.2))),pcm(reference.render(Math.ceil(sampleRate*.2))));
      assert(core.getState().cycles>state.cycles);
    }finally{core.dispose();reference.dispose();}
  }
});

test('8580 load keeps unknown declarations and rejects a failed candidate without changing next PCM',async()=>{
  const current=await create(),control=await create(),good=createSid8580MachineFixture('bus-immediate'),bad=createSid8580MachineFixture('pot-x');
  const unknown=good.bytes.slice();new DataView(unknown.buffer).setUint16(118,0);
  try{
    for(const core of [current,control])core.load(unknown,{modelSelection:'8580',assumeUnknown:true});
    assert.equal(current.getState().declaredClock,'unknown');assert.equal(current.getState().declaredModel,'unknown');
    assert.deepEqual(current.getState().targetSelection,{clock:'explicit',model:'explicit'});
    assert.deepEqual(pcm(current.render(1024)),pcm(control.render(1024)));
    const before=current.getState(),accepted=current.parsed;
    assert.throws(()=>current.load(bad.bytes),error=>error.code===5&&error.address===0xd419);
    assert.deepEqual(current.getState(),before);assert.equal(current.parsed,accepted);
    assert.deepEqual(pcm(current.render(4096)),pcm(control.render(4096)));
    assert.throws(()=>current.load(good.bytes,{vbiBackend:'direct'}),error=>error.code==='SID_8580_DIRECT_UNSUPPORTED');
    assert.deepEqual(current.getState(),control.getState());
    assert.throws(()=>current.load(createSidPlayerTestFixture()),error=>error.code==='SID_MODEL_MISMATCH');
    assert.deepEqual(current.getState(),control.getState());
  }finally{current.dispose();control.dispose();}
});

test('8580 long initialization, Stop/reload and disposal retain the ordinary player lifecycle',async()=>{
  const core=await create(),fixture=createSid8580MachineFixture('psid-long-init');
  try{
    const initial=core.load(fixture.bytes);assert(initial.initPending);
    const prepared=await finishResearchPreflight(core);assert(prepared.initReturned&&!prepared.initPending);
    assert.equal(prepared.model,'8580');assert.equal(core.readRam(fixture.initMarkerAddress),0xa5);
    const stopped=core.stop();assert.equal(stopped.state,2);assert(core.render(1024).every(x=>x===0));assert.deepEqual(core.getState(),stopped);
    const reloaded=core.load(fixture.bytes);assert.equal(reloaded.positionFrames,0);assert(reloaded.initPending);
  }finally{core.dispose();core.dispose();}
  assert.throws(()=>core.getState(),/disposed/);
});

test('factory keeps each original6581 backend unchanged and gives8580 its separate two-WASM engine',async()=>{
  for(const [backend,wasmBinary,source,Original]of [
    ['psid',directBinary,createSidPlayerTestFixture(),SidPlayerCore],
    ['psid-vbi',c64Binary,createSidPlayerTestFixture(),RsidPlayerCore],
    ['rsid',c64Binary,createRsidFixture().bytes,RsidPlayerCore],
  ]){
    const options={sampleRate:48000,wasmBinary},core=await createPlayerCore({model:'6581',backend,...options}),reference=await Original.create(options);
    try{
      const vbiBackend=backend==='psid'?'direct':'c64',parsed=validatePlayerSid(source,{vbiBackend});
      core.load(source,parsed.playerOptions);reference.load(source,parsed.playerOptions);
      assert.equal(core.getState().model,'6581');assert.deepEqual(pcm(core.render(4096)),pcm(reference.render(4096)));
    }finally{core.dispose();reference.dispose();}
  }
  const core=await createPlayerCore({model:'8580',backend:'psid-vbi',endpointBinary,machineBinary});
  try{assert(core instanceof Sid8580PlayerCore);assert.equal(core.load(createSid8580MachineFixture('psid-vbi').bytes).model,'8580');}
  finally{core.dispose();}
});

test('8580 firmware mode uses detached caller ROMs and honors the BASIC selected song',async()=>{
  const source=createRsidBasicFixture(),bytes=source.bytes.slice();new DataView(bytes.buffer).setUint16(118,0x26);
  const core=await create(),roms=createRsidTestRoms();
  try{
    assert.throws(()=>core.load(bytes),/BASIC.*ROM/);
    assert.throws(()=>core.load(bytes,{environment:'rom'}),/ROM/);
    core.load(bytes,{environment:'rom',roms,subtune:2});
    const output=core.render(4096),state=core.getState();assert(output.every(Number.isFinite));assert(output.some(x=>x!==0));
    assert.equal(state.environment,'rom');assert.equal(state.subtune,2);assert.equal(core.readRam(source.markerAddress),0xa5);
    assert.equal(state.registers[0]|state.registers[1]<<8,source.frequencies[1]);
    for(const key of ['chars','basic','kernal'])roms[key].fill(0);
    assert(core.render(1024).every(Number.isFinite),'caller mutation changes an already loaded machine');
  }finally{core.dispose();}
});
