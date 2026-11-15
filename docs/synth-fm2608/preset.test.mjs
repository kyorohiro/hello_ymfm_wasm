import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset,readPreset,readFmPreset,FM_PRESETS,decodeBase64,decodeAdpcm,waveShape} from './preset.js';

test('OPNA defaults validate and embed an audible aligned ADPCM cycle', () => {
  const source = createDefaultPreset(), copy = readPreset(JSON.stringify(source));
  assert.deepEqual(copy,source);
  assert.equal(copy.fm.length,6);
  assert.equal(copy.ssg.channels.length,3);
  assert.equal(copy.rhythm.voices.length,6);
  assert.equal(decodeBase64(copy.adpcm.data).length,64);
  const samples = decodeAdpcm(copy.adpcm.data);
  assert.equal(samples.length,128);
  assert(Math.max(...samples) > .5);
  assert(Math.min(...samples) < -.5);
  copy.fm[0].operators[0].tl = 125;
  assert.notEqual(copy.fm[0].operators[0].tl,source.fm[0].operators[0].tl);
});

test('shared FM presets expand into full OPNA controls', () => {
  const voice = readFmPreset(FM_PRESETS['two-op-bell']);
  assert.deepEqual(voice.pan,{left:true,right:true});
  assert.equal(voice.operators[0].rs,0);
  assert.equal(voice.operators[0].am,false);
  assert.equal(voice.operators[0].ssg,0);
});

test('malformed sample, missing channels and hardware fields are rejected', () => {
  for (const change of [
    preset => { preset.adpcm.data = null; },
    preset => { preset.adpcm.data = ''; },
    preset => { preset.adpcm.sampleRate = 96000; },
    preset => { preset.adpcm.rootNote = 128; },
    preset => { preset.fm[0].operators[0].ar = 32; },
    preset => { delete preset.fm[2]; },
    preset => { delete preset.ssg.channels[1]; },
    preset => { preset.ssg.envelopeShape = 16; },
    preset => { preset.rhythm.voices[0].left = 1; },
  ]) {
    const preset = createDefaultPreset(); change(preset);
    assert.throws(() => readPreset(preset));
  }
  for (const shape of ['sine','triangle','saw','square']) assert.equal(waveShape(shape).length,128);
});
