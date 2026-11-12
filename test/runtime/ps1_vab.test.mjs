// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import * as canonical from '../../tetorica_src/runtime/ps1_vab.js';
import * as entry from '../../tetorica_src/runtime/soundchip.js';
import {Ps1Spu} from '../../tetorica_src/runtime/ps1_spu.js';
import {Ps1Synth} from '../../tetorica_src/runtime/ps1synth.js';
import {createVabFixture} from '../helpers/spu_vab_fixture.mjs';

test('website common entry and both compatibility adapters share source-bank ownership',async()=>{
  const [runtime,common,playground,synth]=await Promise.all([
    import('../../docs/js/ps1_vab.js'),import('../../docs/js/soundchip.js'),
    import('../../docs/playground/playground_ps1_vab.js?v=ps1-vab-api-1'),
    import('../../docs/synth-spu/spu_synth_vab.js?v=ps1-vab-api-1'),
  ]);
  for(const entry of [common,playground,synth])for(const name of ['readVab','prepareVabTone','exportVab'])assert.equal(entry[name],runtime[name]);
  const {vab}=createVabFixture(),bank=playground.readVab(vab);
  assert.deepEqual(common.exportVab(bank),vab);
  assert.deepEqual(synth.exportVab(bank),vab);
});

test('canonical VAB functions are the same public entry exports, sharing source-bank provenance',()=>{
  for(const name of ['readVab','prepareVabTone','exportVab','MAX_VAB_FILE_BYTES'])assert.equal(entry[name],canonical[name]);
  assert.equal(entry.MAX_VAB_FILE_BYTES,1024*1024);
  const fixture=createVabFixture(),bank=canonical.readVab(fixture.vab);
  assert.deepEqual(entry.exportVab(bank),fixture.vab);
  const prepared=entry.prepareVabTone(bank,1);
  assert.equal(prepared.tone.program,3);assert.equal(prepared.tone.index,1);
  assert.equal(prepared.options.baseFrequencyHz,440*2**((59.5-69)/12));
});

test('pure VAB parsing, preparation and exporting need neither DOM, AudioContext, fetch nor a WASM instance',()=>{
  const url=relative=>JSON.stringify(new URL(relative,import.meta.url).href);
  const script=`
    import assert from 'node:assert/strict';
    const forbidden=()=>{throw Error('Pure VAB helpers must not create audio or load assets');};
    globalThis.AudioContext=forbidden;globalThis.webkitAudioContext=forbidden;
    globalThis.AudioWorkletNode=forbidden;globalThis.fetch=forbidden;
    globalThis.WebAssembly=undefined;
    assert.equal(typeof document,'undefined');assert.equal(typeof window,'undefined');
    const api=await import(${url('../../tetorica_src/runtime/soundchip.js')});
    const {createVabFixture}=await import(${url('../helpers/spu_vab_fixture.mjs')});
    const {vab}=createVabFixture(),bank=api.readVab(vab);
    const tone=api.prepareVabTone(bank,1);
    assert.equal(tone.adpcm.length,64);assert.equal(tone.options.loopStartSamples,0);
    assert.deepEqual(api.exportVab(bank),vab);
    assert.equal(api.readVab(api.exportVab(bank,{toneNumber:1})).tones[0].index,0);
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr||result.stdout);
});

test('canonical split/view input and exports own source bytes while full banks preserve unavailable Tone data',()=>{
  const fixture=createVabFixture(),expected=fixture.vab.slice();
  const vh=new Uint8Array(fixture.vh.length+8),vb=new Uint8Array(fixture.vb.length+8);vh.set(fixture.vh,4);vb.set(fixture.vb,4);
  const bank=canonical.readVab(new DataView(vh.buffer,4,fixture.vh.length),vb.subarray(4,-4));
  vh.fill(0);vb.fill(0);assert.deepEqual(canonical.exportVab(bank),expected);
  const prepared=canonical.prepareVabTone(bank,0);prepared.adpcm.fill(0);
  assert.deepEqual(canonical.exportVab(bank),expected,'prepared bytes never share the parsed source sample');
  const output=canonical.exportVab(bank);output.fill(0);assert.deepEqual(canonical.exportVab(bank),expected);
  const unavailable=expected.slice();new DataView(unavailable.buffer).setUint16(0x840+22,255,true);
  const unsupported=canonical.readVab(unavailable);assert.deepEqual(canonical.exportVab(unsupported),unavailable);
  assert.throws(()=>canonical.exportVab(unsupported,{toneNumber:1}),/Noise/);
  bank.samples[0].bytes[2]^=1;assert.throws(()=>canonical.exportVab(bank),/source bank changed/);
});

test('public selected Tone export preserves original ADPCM and metadata without inventing a bank from cloned objects',()=>{
  const fixture=createVabFixture(),bank=entry.readVab(fixture.vab),before=structuredClone(bank);
  for(let toneNumber=0;toneNumber<bank.tones.length;toneNumber++) {
    const selected=entry.readVab(entry.exportVab(bank,{toneNumber})),source=entry.prepareVabTone(bank,toneNumber),roundtrip=entry.prepareVabTone(selected,0);
    assert.equal(selected.programs.length,1);assert.equal(selected.programs[0].index,source.tone.program);
    assert.deepEqual(roundtrip.adpcm,source.adpcm);assert.deepEqual(roundtrip.options,source.options);assert.deepEqual(roundtrip.preset,source.preset);
    assert.equal(roundtrip.trimmedBytes,source.trimmedBytes);assert.equal(roundtrip.tone.sample,1);assert.equal(roundtrip.tone.index,0);
  }
  assert.deepEqual(bank,before);assert.throws(()=>entry.exportVab(structuredClone(bank)),/original bank returned by readVab/);
});

let sharedModule;
async function createSynth(t) {
  sharedModule??=Promise.all([import('../../docs/generated/ps1_spu_wasm.js'),readFile(new URL('../../docs/generated/ps1_spu_wasm.wasm',import.meta.url))])
    .then(([{default:factory},wasmBinary])=>factory({wasmBinary}));
  const core=await Ps1Spu.create({moduleFactory:()=>sharedModule}),synth=new Ps1Synth({core});
  t.after(()=>synth.dispose());return {core,synth};
}
function render(synth,frames) {
  const left=new Float32Array(frames),right=new Float32Array(frames);synth.renderInto(left,right,frames);
  assert(left.every(Number.isFinite));assert(right.every(Number.isFinite));return {left,right};
}

test('prepared original and selected-export Tones load into the real SPU with identical tuning, loop, envelope and rendered PCM',async t=>{
  const bank=entry.readVab(createVabFixture().vab);
  for(const toneNumber of [1,2]) {
    const original=entry.prepareVabTone(bank,toneNumber),selected=entry.prepareVabTone(entry.readVab(entry.exportVab(bank,{toneNumber})),0);
    const first=await createSynth(t),second=await createSynth(t);
    for(const [owner,prepared]of [[first,original],[second,selected]]) {
      const sample=owner.synth.loadADPCM(prepared.adpcm,prepared.options);
      owner.synth.setPreset(0,{...prepared.preset,sample});owner.synth.noteOn(0,'C4');
      assert.equal(owner.core.read(4),Math.round(4096*(440*2**((60-69)/12))/prepared.options.baseFrequencyHz));
      assert.deepEqual(owner.core.readRam(sample.startAddress,sample.byteLength),prepared.adpcm);
    }
    assert.deepEqual(first.synth.getPreset(0),second.synth.getPreset(0));
    const actual=render(first.synth,2048),expected=render(second.synth,2048);
    assert.deepEqual(actual,expected);assert(actual.left.some(value=>Math.abs(value)>1e-5));
    first.synth.noteOff(0);second.synth.noteOff(0);
    assert.deepEqual(render(first.synth,2048),render(second.synth,2048),'release follows the same original ADSR');
  }
});
