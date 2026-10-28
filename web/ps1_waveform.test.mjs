import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePs1Waveform,PS1_WAVEFORM_FRAMES,PS1_WAVEFORM_BYTES,PS1_WAVEFORM_FREQUENCY_HZ} from './ps1_waveform.js';
import {preparePs1ADPCM} from './ps1synth.js';
test('PS1 prepare-side waveform encoder owns one bounded 112-frame looping cycle',()=>{
  const input=Float32Array.from({length:112},(_,i)=>.7*Math.sin(2*Math.PI*i/112)),saved=input.slice();
  const a=preparePs1Waveform(input),b=preparePs1Waveform(Array.from(input));
  assert.equal(PS1_WAVEFORM_FRAMES,112);assert.equal(PS1_WAVEFORM_BYTES,64);assert.equal(PS1_WAVEFORM_FREQUENCY_HZ,393.75);
  assert.deepEqual(a,b);assert.deepEqual(input,saved);assert.equal(a.adpcm.length,64);assert.equal(a.adpcm[1],6);assert.equal(a.adpcm[49],3);
  assert.equal(preparePs1ADPCM(a.adpcm,{baseFrequencyHz:393.75,loopStartSamples:0}).decodedFrames,112);
  input.fill(0);a.pcm.fill(0);a.adpcm.fill(0);assert.deepEqual(b.pcm,Array.from(saved));assert(b.adpcm.some(Boolean));
});
test('PS1 waveform preparation rejects incomplete, non-finite and out-of-range PCM before encoding',()=>{
  for(const value of [null,{},new Int16Array(112),[],Array(111).fill(0),Array(113).fill(0),Array(112).fill(NaN),Array(112).fill(Infinity),Array(112).fill(1.01),Array(112).fill(-1.01),Array(112).fill('0')])assert.throws(()=>preparePs1Waveform(value));
  assert.equal(preparePs1Waveform(Array(112).fill(-1)).adpcm.length,64);assert.equal(preparePs1Waveform(Array(112).fill(1)).adpcm.length,64);
});
