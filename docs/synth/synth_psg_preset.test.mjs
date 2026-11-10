import test from 'node:test';
import assert from 'node:assert/strict';
import {SYNTH_PSG_DEFAULTS} from './synth_psg.js';
import {PSG_PRESET_KIND,PSG_PRESET_VERSION,createPsgPreset,isPsgPreset,isPsgPresetPath,
  normalizePsgPreset,parsePsgPreset,serializePsgPreset} from './synth_psg_preset.js';

test('PSG documents contain complete chip settings and round-trip UTF-8 JSON independently',()=>{
  const preset=createPsgPreset();
  assert.deepEqual(preset,{version:PSG_PRESET_VERSION,kind:PSG_PRESET_KIND,settings:SYNTH_PSG_DEFAULTS});
  for(const source of ['tone','noise'])for(const noiseType of ['white','periodic'])for(const noiseRate of ['low','medium','high','tone3'])for(const attenuation of [0,6,15]) {
    const original=createPsgPreset({source,noiseType,noiseRate,attenuation}),text=serializePsgPreset(original);
    assert.equal(typeof text,'string');assert(text.endsWith('\n'));
    assert.deepEqual(parsePsgPreset(text),original);
    assert.deepEqual(parsePsgPreset(new TextEncoder().encode(text)),original);
    assert.deepEqual(parsePsgPreset(new TextEncoder().encode(text).buffer),original);
  }
  const copy=normalizePsgPreset(preset);copy.settings.attenuation=0;
  assert.equal(preset.settings.attenuation,6);
  assert(isPsgPreset(preset));assert(isPsgPreset({...preset,version:99}),'tag recognition never replaces validation');
  assert(!isPsgPreset({algorithm:7}));assert(!isPsgPreset(null));
  assert(isPsgPresetPath('/presets/Noise.PSG.JSON'));assert(!isPsgPresetPath('/presets/Noise.json'));
});

test('file parsing requires the exact version, kind and complete settings without runtime state',()=>{
  const preset=createPsgPreset({source:'noise',noiseRate:'tone3'});
  const bad=[null,[],{}, {...preset,version:0},{...preset,kind:'tetorica-fm2612'},
    {...preset,extra:true},{...preset,settings:{}},{...preset,settings:[]},
    {...preset,settings:{...preset.settings,phase:0}},{...preset,settings:{...preset.settings,attenuation:'6'}},
    {...preset,settings:{...preset.settings,attenuation:16}},{...preset,settings:{...preset.settings,source:'fm'}},
    {...preset,settings:{...preset.settings,noiseRate:'div512'}},{...preset,settings:{...preset.settings,noiseType:'pink'}},
  ];
  for(const field of Object.keys(preset.settings)) {
    const value=structuredClone(preset);delete value.settings[field];bad.push(value);
  }
  for(const value of bad) {
    assert.throws(()=>normalizePsgPreset(value));assert.throws(()=>parsePsgPreset(JSON.stringify(value)));
    assert.throws(()=>serializePsgPreset(value));
  }
  for(const value of ['{','true','null','\ufeff'+serializePsgPreset(preset),new Uint8Array([0xff,0xfe]),42])assert.throws(()=>parsePsgPreset(value));
  assert.deepEqual(createPsgPreset({attenuation:4}).settings,{...SYNTH_PSG_DEFAULTS,attenuation:4},'only new editor documents apply defaults');
  assert.throws(()=>createPsgPreset({unknown:true}));
});
