// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readVab,prepareVabTone} from './spu_synth_vab.js';
import {readSpuInstrument} from './spu_synth_instrument.js';
import {prepareVabTonePreset,prepareVabBankPresets,vabTonePresetName} from './spu_bank_presets.js';
import {createVabFixture} from '../../test/helpers/spu_vab_fixture.mjs';

test('bank JSON conversion preserves all original Tone metadata without an audio core or a source mutation',()=>{
  const bank=readVab(createVabFixture().vab),before=structuredClone(bank);
  bank.samples[0].bytes[1]&=~4;bank.samples[0].bytes[17]|=4;
  before.samples[0].bytes.set(bank.samples[0].bytes);
  const reverb={preset:'room',volumeLeft:.17,volumeRight:.29};
  const result=prepareVabBankPresets(bank,{name:'Bank.vab',reverb,maxBytes:16*1024*1024});
  assert.equal(result.instruments.length,3);assert.deepEqual(result.unavailable,[]);
  assert.equal(result.bytes,new TextEncoder().encode(result.instruments.map(sound=>JSON.stringify(sound,null,2)+'\n').join('')).byteLength);
  for(const[index,value]of result.instruments.entries()){
    const expected=prepareVabTone(bank,index),sound=readSpuInstrument(JSON.parse(JSON.stringify(value)));
    assert.equal(value.name,`Bank.vab P${expected.tone.program} T${expected.tone.index}`);
    assert.deepEqual(sound.sample,{adpcm:expected.adpcm,...expected.options});
    assert.deepEqual(sound.preset,expected.preset);assert.deepEqual(sound.reverb,reverb);
    assert.equal(sound.waveform,null);for(const key of ['pmon','noise','morph'])assert.equal(sound[key].enabled,false);
  }
  assert.equal(result.instruments[0].sample.loopStartSamples,28);
  assert.equal(Object.hasOwn(result.instruments[2].sample,'loopStartSamples'),false);
  result.instruments[0].sample.adpcm.fill(0);result.instruments[0].reverb.volumeLeft=1;
  assert.deepEqual(bank,before);assert.equal(reverb.volumeLeft,.17);
});

test('selected Tone preset matches its bank preset and defaults to shared reverb Off before audio is enabled',()=>{
  const bank=readVab(createVabFixture().vab),single=prepareVabTonePreset(bank,1,{name:'Flute'});
  assert.deepEqual(single,prepareVabBankPresets(bank,{name:'Flute',maxBytes:100000}).instruments[1]);
  assert.deepEqual(single.reverb,{preset:'off',volumeLeft:.25,volumeRight:.25});
  assert.equal(single.sample.baseFrequencyHz,440*2**((59.5-69)/12));
  assert.throws(()=>prepareVabTonePreset(bank,3),/tone/i);
});

test('unavailable Tones are counted with their own program, index and reason rather than substituted',()=>{
  const bank=readVab(createVabFixture().vab);bank.tones[1].sample=255;bank.tones[2].sample=0;
  const before=structuredClone(bank),result=prepareVabBankPresets(bank,{maxBytes:100000});
  assert.equal(result.instruments.length,1);
  assert.deepEqual(result.unavailable.map(({tone,program,index,sample})=>[tone,program,index,sample]),[[1,3,1,255],[2,11,0,0]]);
  assert.match(result.unavailable[0].reason,/Noise/);assert.match(result.unavailable[1].reason,/no assigned sample/);
  assert.deepEqual(bank,before);
  assert.throws(()=>prepareVabTonePreset(bank,1),/Noise/);
  bank.tones[0].sample=0;
  assert.deepEqual(prepareVabBankPresets(bank,{maxBytes:0}).instruments,[]);
});

test('byte budget bounds a bank that shares a sample across many Tones and never alters original bytes',()=>{
  const bank=readVab(createVabFixture().vab),before=structuredClone(bank),name='日本語バンク';
  const full=prepareVabBankPresets(bank,{name,maxBytes:100000});
  assert.equal(prepareVabBankPresets(bank,{name,maxBytes:full.bytes}).bytes,full.bytes);
  assert.throws(()=>prepareVabBankPresets(bank,{name,maxBytes:full.bytes-1}),/16 MiB.*No presets were saved/);
  for(const maxBytes of [undefined,-1,Infinity,1.5])assert.throws(()=>prepareVabBankPresets(bank,{maxBytes}),/budget/);
  assert.deepEqual(bank,before);
  assert.throws(()=>prepareVabBankPresets(bank,{maxBytes:100000,reverb:{preset:'bad',volumeLeft:0,volumeRight:0}}),/reverb preset/,'bad options must not be misreported as unavailable Tones');
});

test('long source names retain unique Program / Tone suffixes within the portable name limit',()=>{
  const name='日本語'.repeat(50),tone={program:127,index:15};
  assert.equal(vabTonePresetName(name,tone).length,80);
  assert(vabTonePresetName(name,tone).endsWith(' P127 T15'));
  assert.notEqual(vabTonePresetName(name,tone),vabTonePresetName(name,{program:127,index:14}));
  assert.equal(vabTonePresetName(' ',{program:0,index:0}),'VAB P0 T0');
});
