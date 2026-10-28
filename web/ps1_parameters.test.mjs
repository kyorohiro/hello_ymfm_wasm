import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodePs1Envelope,encodePs1Envelope,patchPs1Envelope,PS1_REVERB_PRESETS} from './ps1_parameters.js';

test('named PS1 envelope fields roundtrip exact masks and preserve unedited raw bits',()=>{
  const values={attackRate:127,attackExponential:true,decayRate:15,sustainLevel:15,sustainRate:127,sustainDecrease:true,sustainExponential:true,releaseRate:31,releaseExponential:true};
  assert.deepEqual(encodePs1Envelope(values),{adsr1:0xffff,adsr2:0xdfff});
  assert.deepEqual(decodePs1Envelope(0xffff,0xffff),values);
  assert.deepEqual(encodePs1Envelope({}),{adsr1:15,adsr2:0});
  assert.deepEqual(patchPs1Envelope(0x9234,0xa56b,{releaseRate:9}),{adsr1:0x9234,adsr2:(0xa56b&~31)|9});
  assert.deepEqual(patchPs1Envelope(0x9234,0xa56b,{releaseRate:undefined}),{adsr1:0x9234,adsr2:0xa56b});
  for(let word=0;word<=0xffff;word++){
    const raw=patchPs1Envelope(word,word,decodePs1Envelope(word,word));
    assert.equal(raw.adsr1,word);assert.equal(raw.adsr2,word);
  }
});

test('PS1 envelope validation rejects unknown fields, coercion and out-of-range values',()=>{
  for(const raw of [-1,65536,.5,NaN,Infinity,'0',undefined]){
    assert.throws(()=>decodePs1Envelope(raw,0));assert.throws(()=>decodePs1Envelope(0,raw));
  }
  for(const input of [null,undefined,[],42,{attackRate:128},{attackRate:-1},{attackRate:1.5},{attackRate:'1'},
    {decayRate:16},{sustainLevel:16},{sustainRate:128},{releaseRate:32},{attackExponential:1},
    {sustainDecrease:'true'},{sustainExponential:null},{releaseExponential:0},{unused:1},{[Symbol('releaseRate')]:1}]){
    assert.throws(()=>patchPs1Envelope(0xffff,0xffff,input));
  }
});

test('all exposed PS1 reverb tables match the pinned BSD core and omit ineffective modes',async()=>{
  const source=await readFile(new URL('../third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/upstream/spu_tables.cpp',import.meta.url),'utf8');
  const upstream=new Map([...source.matchAll(/"([^"]+)"\s*,\s*\{([^}]+)\}/g)].map(m=>[m[1],m[2].match(/0x[0-9a-f]+/gi).map(x=>parseInt(x,16))]));
  assert.deepEqual(PS1_REVERB_PRESETS.map(p=>p.id),['off','room','studio-small','studio-medium','studio-large','hall','space-echo','half-echo']);
  assert.ok(Object.isFrozen(PS1_REVERB_PRESETS));
  for(const preset of PS1_REVERB_PRESETS){
    assert.equal(preset.registers.length,32);assert.ok(Object.isFrozen(preset));assert.ok(Object.isFrozen(preset.registers));
    assert.deepEqual(preset.registers,upstream.get(preset.id==='off'?'Reverb off':preset.name));
  }
});
