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
  copy.settings.envelope.attackMs=4999;
  assert.equal(preset.settings.attenuation,6);
  assert.equal(preset.settings.envelope.attackMs,10);
  assert(isPsgPreset(preset));assert(isPsgPreset({...preset,version:99}),'tag recognition never replaces validation');
  assert(!isPsgPreset({algorithm:7}));assert(!isPsgPreset(null));
  assert(isPsgPresetPath('/presets/Noise.PSG.JSON'));assert(!isPsgPresetPath('/presets/Noise.json'));
});

test('file parsing requires the exact version, kind and complete settings without runtime state',()=>{
  const preset=createPsgPreset({source:'noise',noiseRate:'tone3'});
  const bad=[null,[],{}, {...preset,version:0},{...preset,version:3},{...preset,kind:'tetorica-fm2612'},
    {...preset,extra:true},{...preset,settings:{}},{...preset,settings:[]},
    {...preset,settings:{...preset.settings,phase:0}},{...preset,settings:{...preset.settings,attenuation:'6'}},
    {...preset,settings:{...preset.settings,attenuation:16}},{...preset,settings:{...preset.settings,source:'fm'}},
    {...preset,settings:{...preset.settings,noiseRate:'div512'}},{...preset,settings:{...preset.settings,noiseType:'pink'}},
  ];
  for(const field of Object.keys(preset.settings)) {
    const value=structuredClone(preset);delete value.settings[field];bad.push(value);
  }
  for(const field of Object.keys(preset.settings.envelope)) {
    const value=structuredClone(preset);delete value.settings.envelope[field];bad.push(value);
  }
  for(const envelope of [null,[],{}, {...preset.settings.envelope,phase:0},
    {...preset.settings.envelope,enabled:1},{...preset.settings.envelope,attackMs:-1},
    {...preset.settings.envelope,decayMs:5001},{...preset.settings.envelope,sustain:101},
    {...preset.settings.envelope,releaseMs:0.5}])bad.push({...preset,settings:{...preset.settings,envelope}});
  for(const value of bad) {
    assert.throws(()=>normalizePsgPreset(value));assert.throws(()=>parsePsgPreset(JSON.stringify(value)));
    assert.throws(()=>serializePsgPreset(value));
  }
  for(const value of ['{','true','null','\ufeff'+serializePsgPreset(preset),new Uint8Array([0xff,0xfe]),42])assert.throws(()=>parsePsgPreset(value));
  assert.deepEqual(createPsgPreset({attenuation:4}).settings,{...SYNTH_PSG_DEFAULTS,attenuation:4},'only new editor documents apply defaults');
  assert.throws(()=>createPsgPreset({unknown:true}));
});

test('version 2 retains complete software envelopes and detached settings across JSON round trips',()=>{
  for(const attackMs of [0,10,5000])for(const decayMs of [0,5000])for(const releaseMs of [0,5000])for(const sustain of [0,70,100]) {
    const envelope={enabled:true,attackMs,decayMs,sustain,releaseMs};
    const value=createPsgPreset({source:'noise',envelope});
    assert.equal(value.version,2);assert.deepEqual(value.settings.envelope,envelope);
    assert.deepEqual(parsePsgPreset(serializePsgPreset(value)),value);
    value.settings.envelope.sustain=50;assert.equal(envelope.sustain,sustain);
  }
});

test('exact legacy version 1 presets migrate to software Envelope Off without accepting incomplete or injected settings',()=>{
  const settings={source:'noise',attenuation:3,noiseType:'periodic',noiseRate:'tone3'};
  const legacy={version:1,kind:PSG_PRESET_KIND,settings},original=structuredClone(legacy);
  const value=parsePsgPreset(JSON.stringify(legacy));
  assert.equal(value.version,2);assert.deepEqual(value.settings,{...settings,envelope:SYNTH_PSG_DEFAULTS.envelope});
  assert.equal(value.settings.envelope.enabled,false);assert.deepEqual(legacy,original);
  assert.deepEqual(parsePsgPreset(serializePsgPreset(legacy)),value,'explicitly serializing an old document writes canonical v2');
  for(const badSettings of [{...settings,envelope:SYNTH_PSG_DEFAULTS.envelope},{...settings,phase:0},{...settings,attenuation:16}]) {
    assert.throws(()=>parsePsgPreset(JSON.stringify({...legacy,settings:badSettings})));
  }
  for(const field of Object.keys(settings)) {
    const bad=structuredClone(legacy);delete bad.settings[field];assert.throws(()=>normalizePsgPreset(bad));
  }
});
