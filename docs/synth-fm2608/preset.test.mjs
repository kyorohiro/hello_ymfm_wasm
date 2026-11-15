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

test('legacy v1 presets retain full operator Gates and full zero-based sample ranges', () => {
  const preset = createDefaultPreset();
  delete preset.channel3;
  preset.fm.forEach(channel => { delete channel.keyMask; });
  for (const key of ['address','start','end']) delete preset.adpcm[key];
  const normalized = readPreset(preset);
  assert.equal(normalized.version,1);
  assert(normalized.fm.every(channel => channel.keyMask === 15));
  assert.equal(normalized.channel3.mode,'normal');
  assert.deepEqual([normalized.adpcm.address,normalized.adpcm.start,normalized.adpcm.end],[0,0,64]);
});

test('special CH3 and offset ADPCM ranges are validated atomically', () => {
  const preset = createDefaultPreset();
  preset.channel3.mode = 'csm'; preset.channel3.timerA = 1023;
  preset.fm[2].keyMask = 5;
  Object.assign(preset.adpcm,{address:256,start:288,end:320});
  assert.deepEqual(readPreset(preset),preset);
  for (const mutate of [
    value => { value.channel3.mode = 'unknown'; },
    value => { value.channel3.timerA = 1024; },
    value => { value.channel3.frequencies[0].fnum = 2048; },
    value => { value.fm[0].keyMask = 16; },
    value => { value.adpcm.start = 257; },
    value => { value.adpcm.end = 352; },
    value => { value.adpcm.address = 0x200000; },
  ]) {
    const invalid = structuredClone(preset); mutate(invalid);
    assert.throws(() => readPreset(invalid));
  }
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
