import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateBrrPitch} from './spc_pitch.js';
import {decodeBrr} from './snes_brr.js';

// Original synthetic nibble-domain waveforms: no game samples or encoder dependency.
function sample(wave, {frames=4096,loop=true,loopStartSamples=0,filter=0,range=10} = {}) {
  assert.equal(frames % 16,0);
  const brr = new Uint8Array(frames / 16 * 9);
  for (let i = 0; i < frames; i++) {
    const block = Math.floor(i / 16), nibble = Math.max(-8,Math.min(7,Math.round(wave(i))));
    brr[block * 9] = range << 4 | filter << 2;
    brr[block * 9 + 1 + (i % 16 >> 1)] |= (nibble & 15) << (i % 2 ? 0 : 4);
  }
  brr[brr.length - 9] |= loop ? 3 : 1;
  return {brr,loop,...(loop ? {loopStartSamples} : {})};
}
const sine = period => i => 6 * Math.sin(2 * Math.PI * i / period);
function random(seed = 0x9826143) {
  return () => {seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;return seed / 0x100000000;};
}
function close(actual, expected, cents=12) {
  assert.ok(actual > 0 && Number.isFinite(actual));
  assert.ok(Math.abs(1200 * Math.log2(actual / expected)) < cents,`${actual} Hz should match ${expected} Hz`);
}

for (const period of [16,32,64,128,512]) test(`steady ${32000 / period} Hz BRR loop has a high-confidence native reference`,()=>{
  const input = sample(sine(period),{frames:Math.max(512,period * 4)});
  const saved = input.brr.slice(), pitch = estimateBrrPitch(input);
  assert.equal(pitch.confidence,'high');close(pitch.referenceHz,32000 / period);
  assert.deepEqual(input.brr,saved,'Analysis must not mutate BRR flags/data');
  assert.equal(pitch.method,'brr-fft-periodicity-v1');
});

test('a noninteger period is interpolated in Hz, without rounding to a note',()=>{
  const pitch = estimateBrrPitch(sample(sine(73.25),{frames:16384,loop:false}));
  assert.equal(pitch.confidence,'high');close(pitch.referenceHz,32000 / 73.25,4);
});

test('a stronger second harmonic does not replace the established fundamental',()=>{
  const pitch = estimateBrrPitch(sample(i=>2 * Math.sin(2*Math.PI*i/128) + 5 * Math.sin(4*Math.PI*i/128)));
  assert.equal(pitch.confidence,'high');close(pitch.referenceHz,250);
});

test('periodicity can identify a missing fundamental from second and third harmonics',()=>{
  const pitch = estimateBrrPitch(sample(i=>3 * Math.sin(4*Math.PI*i/128) + 3 * Math.sin(6*Math.PI*i/128)));
  assert.equal(pitch.confidence,'high');close(pitch.referenceHz,250);
});

test('steady loop analysis omits the noisy attack before its explicit loop point',()=>{
  const rand=random(),input=sample(i=>i<2048 ? rand()*14-7 : sine(64)(i-2048),{frames:2560,loopStartSamples:2048});
  const pitch=estimateBrrPitch(input);assert.equal(pitch.confidence,'high');close(pitch.referenceHz,500);
});

for(const filter of [1,2,3]) test(`filter ${filter} short loops retain predictor history between warm-up passes`,()=>{
  const input=sample(sine(64),{frames:64,filter,range:5});
  const first=decodeBrr(input.brr),next=decodeBrr(input.brr,{history:first.finalHistory});
  assert.notDeepEqual(first.pcm16,next.pcm16,'Fixture must require carried predictor history');
  const pitch=estimateBrrPitch(input);assert.equal(pitch.confidence,'high');close(pitch.referenceHz,500);
});

test('silence and constant DC have no pitch even when looped',()=>{
  for(const wave of [()=>0,()=>4]) {
    const pitch=estimateBrrPitch(sample(wave));assert.equal(pitch.referenceHz,null);assert.equal(pitch.confidence,'none');assert.match(pitch.reason,/Silence|DC/);
  }
});

test('deterministic broadband noise is rejected, not assigned its loudest FFT bin',()=>{
  for(const loop of [false,true]) {
    const rand=random(),pitch=estimateBrrPitch(sample(()=>rand()*14-7,{loop,frames:16384}));
    assert.equal(pitch.referenceHz,null);assert.equal(pitch.confidence,'none');
  }
});

test('sweeping and decaying percussive one-shots fall back to manual tuning',()=>{
  const chirp=estimateBrrPitch(sample(i=>6*Math.sin(2*Math.PI*(i/100+i*i/1500000)),{frames:16384,loop:false}));
  const decay=estimateBrrPitch(sample(i=>7*Math.exp(-i/1200)*Math.sin(2*Math.PI*i/64),{frames:8192,loop:false}));
  for(const pitch of [chirp,decay]) {assert.equal(pitch.referenceHz,null);assert.equal(pitch.confidence,'none');}
});

test('a short tonal one-shot may offer a low-confidence candidate rather than an automatic default',()=>{
  const pitch=estimateBrrPitch(sample(sine(64),{frames:512,loop:false}));
  assert.equal(pitch.confidence,'low');close(pitch.referenceHz,500,25);
});

test('out-of-range high pitch does not become a false lower subharmonic',()=>{
  const pitch=estimateBrrPitch(sample(i=>i%2 ? -5 : 5,{frames:32}));
  assert.equal(pitch.referenceHz,null);assert.equal(pitch.confidence,'none');assert.match(pitch.reason,/8,000/);
});

test('invalid, incomplete, oversized and too-short inputs return explicit unavailable hints',()=>{
  const valid=sample(sine(64)),noEnd=valid.brr.slice();noEnd[noEnd.length-9]&=~3;
  const trailing=new Uint8Array(valid.brr.length+9);trailing.set(valid.brr);
  for(const input of [null,{}, {brr:new Uint8Array()}, {brr:new Uint8Array(10)},
    {brr:new Uint8Array(65537)}, {brr:noEnd}, {brr:trailing},
    {...valid,loopStartSamples:1}, {...valid,loopStartSamples:4096},
    {...valid,loopStartSamples:null}, {...valid,loop:false},
    sample(sine(16),{frames:16,loop:false})]) {
    const pitch=estimateBrrPitch(input);assert.equal(pitch.referenceHz,null);assert.equal(pitch.confidence,'none');assert.ok(pitch.reason);
  }
});

test('binary views and repeated analysis are deterministic and bounded at large loop size',()=>{
  const input=sample(sine(64),{frames:116496});
  const view=new DataView(input.brr.buffer,input.brr.byteOffset,input.brr.byteLength);
  const a=estimateBrrPitch({...input,brr:view}),b=estimateBrrPitch(input);
  assert.deepEqual(a,b);assert.equal(a.confidence,'high');close(a.referenceHz,500);
});
