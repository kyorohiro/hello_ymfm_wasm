import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset,readPreset,readFmPreset,FM_PRESETS,decodeBase64,decodeAdpcm,waveShape,encodeGeneratedSine} from './preset.js';
import {encodeAdpcmB} from '../js/adpcm_b_sample.js';

test('generated Triangle starts at zero with unchanged cycle length and amplitude', () => {
  const triangle = waveShape('triangle');
  assert.equal(triangle.length,128);
  assert.deepEqual([triangle[0],triangle[32],triangle[64],triangle[96]],[0,.6,0,-.6]);
  const decoded = decodeAdpcm(encodeAdpcmB({channels:[Float32Array.from(triangle)],sampleRate:33488},33488).bytes);
  assert(Math.max(...decoded.map((value,index) => Math.abs(value-triangle[index]))) < .014,
    'the decoded cycle no longer has the initial full-scale chase');
  assert(decoded.slice(0,8).every(value => value >= 0),'initial rise has no left-edge negative plunge');
});

test('software Triangle phase fix leaves other shape definitions and imported sample bytes intact', () => {
  for (const shape of ['sine','saw','square']) {
    const expected=Array.from({length:128},(_,index) => {
      const phase=index/128;
      return .6*(shape==='sine'?Math.sin(phase*Math.PI*2):shape==='saw'?phase*2-1:phase<.5?1:-1);
    });
    assert.deepEqual(waveShape(shape),expected);
  }
  const preset=createDefaultPreset(),raw=Uint8Array.from({length:64},(_,i) => i*17&255);
  preset.adpcm.data=Buffer.from(raw).toString('base64');
  assert.deepEqual(decodeBase64(readPreset(preset).adpcm.data),raw);
});

test('generated Sine encoding reduces the decoded startup chase without changing its source cycle', () => {
  const samples = Float32Array.from(waveShape('sine')), sampleRate = 33488;
  const pcm = {channels:[samples],sampleRate}, before = Float32Array.from(samples);
  const legacy = decodeAdpcm(encodeAdpcmB(pcm,sampleRate).bytes);
  const encoded = encodeGeneratedSine(pcm,sampleRate), decoded = decodeAdpcm(encoded.bytes);
  const maxError = values => Math.max(...values.map((value,index) => Math.abs(value-samples[index])));
  const onsetError = values => Math.sqrt(values.slice(0,8).reduce((sum,value,index) => sum+(value-samples[index])**2,0)/8);
  assert.equal(encoded.frames,128);
  assert.equal(encoded.paddedFrames,128);
  assert.equal(encoded.bytes.length,64);
  assert(maxError(decoded)<.009&&maxError(decoded)<maxError(legacy)*.3);
  assert(onsetError(decoded)<.005&&onsetError(decoded)<onsetError(legacy)*.3);
  assert.deepEqual(samples,before,'encoding never edits the ideal source PCM');
});

test('generated Sine helper follows chip-rate quantization and declines other PCM', () => {
  for (const root of [36,60,68]) {
    const sampleRate = 440*2**((root-69)/12)*128;
    const actualRate = Math.round(sampleRate*144*65536/8000000)*8000000/(144*65536);
    const encoded = encodeGeneratedSine({channels:[waveShape('sine')],sampleRate},actualRate);
    assert.equal(encoded.sampleRate,actualRate);
    assert.equal(encoded.bytes.length,64);
  }
  const sine = waveShape('sine'), changed = [...sine]; changed[7]+=.001;
  for (const channels of [[changed],[sine.map(value => value*.5)],[waveShape('sine',256)],[sine,sine],[waveShape('triangle')]])
    assert.equal(encodeGeneratedSine({channels,sampleRate:33488},33488),null);
  assert.equal(encodeGeneratedSine({channels:[sine],sampleRate:33488},22050),null);
  assert.equal(encodeGeneratedSine({channels:[sine],sampleRate:33488},NaN),null);
});

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
