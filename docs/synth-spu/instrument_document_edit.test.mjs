import test from 'node:test';
import assert from 'node:assert/strict';
import {editSpuInstrumentDocument,spuInstrumentDocumentChanges,displaySpuInstrumentDocument} from './instrument_document_edit.js';
import {writeSpuInstrument,readSpuInstrument} from './spu_synth_instrument.js';
import {createPs1InitSample} from '../js/ps1synth.js';
import {patchPs1Envelope} from '../js/ps1_parameters.js';
function sound(){return writeSpuInstrument('Author',{sample:createPs1InitSample(),preset:{volumeLeft:.75,volumeRight:.75,adsr1:15,adsr2:0x2000,pitch:4096,reverb:false},reverb:{preset:'off',volumeLeft:.25,volumeRight:.25}});}
test('draft controls and PCM are pure portable edits; original ADPCM is retained for scalar edits',()=>{
  const before=sound(),original=structuredClone(before);
  const edited=editSpuInstrumentDocument(before,'setInstrumentEnvelope',[{releaseRate:17}]).instrument;
  assert.deepEqual(before,original);assert.deepEqual(edited.sample,before.sample);
  assert.equal(edited.preset.adsr2,0x2011);assert.doesNotThrow(()=>readSpuInstrument(edited));
  const cycle=editSpuInstrumentDocument(before,'setInstrumentWaveform',[Array(112).fill(0)]).instrument;
  assert.equal(cycle.waveform.length,112);assert.doesNotThrow(()=>readSpuInstrument(cycle));
  assert.throws(()=>editSpuInstrumentDocument(before,'setInstrumentPreset',[{sample:3}]),/runtime sample/);
});
test('acceptance emits only touched fields and preserves packed envelope companions and note state',()=>{
  const before=sound(),next=structuredClone(before);
  Object.assign(next.preset,patchPs1Envelope(next.preset.adsr1,next.preset.adsr2,{releaseRate:12}));
  next.reverb.volumeLeft=.4;
  assert.deepEqual(spuInstrumentDocumentChanges(before,next),[
    ['setInstrumentEnvelope',[{releaseRate:12}]],['setReverb',[{volumeLeft:.4}]],
  ]);
  next.name='Renamed';assert.equal(spuInstrumentDocumentChanges(before,next).length,2);
  const different=editSpuInstrumentDocument(before,'setInstrumentWaveform',[Array(112).fill(0)]).instrument;
  assert.equal(spuInstrumentDocumentChanges(before,different),null);
});
test('full-sample draft edits retain tuning and loop and reject length changes',()=>{
  const before=sound(),adpcm=before.sample.adpcm.slice();adpcm[2]^=1;
  const changed=editSpuInstrumentDocument(before,'setInstrumentSample',[{adpcm:Uint8Array.from(adpcm)}]).instrument;
  assert.deepEqual(changed.sample,{...before.sample,adpcm});
  assert.throws(()=>editSpuInstrumentDocument(before,'setInstrumentSample',[{adpcm:Uint8Array.from([...adpcm,...adpcm])}]),/length/);
});
test('draft display does not mutate live registers and exposes a bounded source preview',()=>{
  const state={channels:[{sample:3,pitch:1234,gate:true}],noise:{},reverb:{},pmon:{}};
  const before=structuredClone(state),doc=sound();doc.preset.pitch=4096;
  const displayed=displaySpuInstrumentDocument(state,doc,'draft-2');
  assert.deepEqual(state,before);assert.equal(displayed.channels[0].pitch,4096);
  assert.equal(displayed.channels[0].gate,true);assert.equal(displayed.samplePcmSource.token,'draft-2');
  assert.equal(displayed.channels[0].adpcmPreview.pcm.length,112);
});
