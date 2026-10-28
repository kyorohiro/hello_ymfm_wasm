import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePs1Adpcm,DEFAULT_PS1_ADPCM_MAX_BYTES} from './ps1_adpcm_encoder.js';
import {preparePs1ADPCM} from './ps1synth.js';

// Authored test oracle. Native/core conformance is tested separately against
// the actual pinned spu.cpp; this reader also asserts the no-wrap policy.
function decode(adpcm,history=[0,0]) {
  const coefficients=[[0,0],[60,0],[115,-52],[98,-55],[122,-60]];
  const pcm=new Float64Array(adpcm.length/16*28);
  let [p1,p2]=history;
  for(let block=0;block<adpcm.length/16;block++) {
    const at=block*16,header=adpcm[at],filter=header>>4,shift=header&15;
    assert.ok(filter<=4);assert.ok(shift<=12);
    const [a,b]=coefficients[filter];
    for(let i=0;i<28;i++) {
      const byte=adpcm[at+2+(i>>1)],nibble=(i&1?byte>>4:byte&15);
      const signed=nibble<8?nibble:nibble-16;
      const value=((signed<<12)>>shift)+((p1*a+p2*b+32)>>6);
      assert.ok(value>=-32768&&value<=32767,'no encoded sample relies on signed-short overflow');
      pcm[block*28+i]=value/32768;p2=p1;p1=value;
    }
  }
  return {pcm,history:[p1,p2]};
}
function metrics(source,decoded) {
  let error=0,signal=0,max=0;
  for(let i=0;i<source.length;i++) {
    const d=source[i]-decoded[i];error+=d*d;signal+=source[i]*source[i];max=Math.max(max,Math.abs(d));
  }
  return {rmsError:Math.sqrt(error/source.length),maxError:max,signalRms:Math.sqrt(signal/source.length),
    snrDb:error===0||signal===0?null:10*Math.log10(signal/error),errorFrames:source.length,exact:error===0};
}
function checkMetrics(source,encoded) {
  const expected=metrics(source,decode(encoded.adpcm).pcm);
  for(const key of ['rmsError','maxError','signalRms'])assert.ok(Math.abs(encoded.metrics[key]-expected[key])<1e-12,key);
  if(expected.snrDb===null)assert.equal(encoded.metrics.snrDb,null);
  else assert.ok(Math.abs(encoded.metrics.snrDb-expected.snrDb)<1e-10);
  assert.equal(encoded.metrics.exact,expected.exact);assert.equal(encoded.metrics.errorFrames,source.length);
  assert.deepEqual(JSON.parse(JSON.stringify(encoded.metrics)),encoded.metrics,'JSON-safe metrics');
  return expected;
}
function fixtures() {
  let seed=0x5ad3f19;
  const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
  return {
    sine:Float32Array.from({length:1120},(_,i)=>.65*Math.sin(2*Math.PI*i/112)),
    voice:Float32Array.from({length:1120},(_,i)=>{
      const p=2*Math.PI*i/97,e=Math.min(1,i/48)*Math.min(1,(1120-i)/96);
      return e*(.44*Math.sin(p)+.19*Math.sin(2*p)+.1*Math.sin(3*p)+.05*Math.sin(5*p));
    }),
    drum:Float32Array.from({length:1120},(_,i)=>Math.exp(-i/190)*(.6*Math.sin(2*Math.PI*(i/45-i*i/320000))+.27*noise())),
  };
}

test('PS1 encoder emits exact packet headers, low-nibble-first signed PCM and deterministic ties',()=>{
  const silence=encodePs1Adpcm(new Float32Array(28));
  assert.deepEqual(silence.adpcm,new Uint8Array([0,1,...Array(14).fill(0)]));
  assert.equal(silence.blockCount,1);assert.equal(silence.frames,28);assert.equal(silence.sourceFrames,28);
  assert.equal(silence.paddingFrames,0);assert.equal(silence.loopStartSamples,null);assert.equal(silence.metrics.exact,true);
  const alternating=Float32Array.from({length:28},(_,i)=>i&1?-.25:.25),encoded=encodePs1Adpcm(alternating);
  assert.deepEqual(encoded.adpcm,new Uint8Array([0,1,...Array(14).fill(0xe2)]));
  assert.deepEqual(decode(encoded.adpcm).pcm,Float64Array.from(alternating));checkMetrics(alternating,encoded);
  // Full-scale-near frames select shift 0; the following exact halfway ties
  // select signed nibble 0 instead of 1, and -1 instead of 0, respectively.
  const midpoint=new Float32Array(28).fill(.875);midpoint[1]=2048/32768;midpoint[2]=-2048/32768;
  const tie=encodePs1Adpcm(midpoint);
  assert.equal(tie.adpcm[0],0);assert.equal(tie.adpcm[2],0x07);assert.equal(tie.adpcm[3],0x7f);
  assert.deepEqual(encodePs1Adpcm(midpoint),tie);
});

test('PS1 encoder zero-pads one-shots and measures only caller frames',()=>{
  for(const frames of [1,27,28,29,55,56,57]) {
    const source=Float32Array.from({length:frames},(_,i)=>.51*Math.sin(i*.23)),copy=source.slice();
    const result=encodePs1Adpcm(source),padded=new Float32Array(Math.ceil(frames/28)*28);padded.set(source);
    assert.equal(result.frames,padded.length);assert.equal(result.paddingFrames,padded.length-source.length);
    assert.deepEqual(result.adpcm,encodePs1Adpcm(padded).adpcm,'padding adds zero PCM instead of repeating its tail');
    assert.deepEqual(source,copy);checkMetrics(source,result);
    const prepared=preparePs1ADPCM(result.adpcm,{rootNote:69});assert.equal(prepared.loop,false);assert.equal(prepared.decodedFrames,padded.length);
    for(let block=0;block<result.blockCount;block++)assert.equal(result.adpcm[block*16+1],block===result.blockCount-1?1:0);
  }
});

test('PS1 encoder gives repeatable lossy raw-PCM metrics on authored sine, voice and drum signals',t=>{
  const limits={sine:{rms:.006,snr:37},voice:{rms:.003,snr:40},drum:{rms:.02,snr:18}};
  for(const [name,source] of Object.entries(fixtures())) {
    const result=encodePs1Adpcm(source),quality=checkMetrics(source,result);
    assert.ok(quality.rmsError<limits[name].rms,`${name} RMS ${quality.rmsError}`);
    assert.ok(quality.snrDb>limits[name].snr,`${name} SNR ${quality.snrDb}`);
    assert.ok(quality.maxError<.125,`${name} no large reconstruction spike`);
    assert.equal(quality.exact,false);assert.deepEqual(result,encodePs1Adpcm(source));
    assert.ok(Array.from({length:result.blockCount-1},(_,i)=>result.adpcm[(i+1)*16]>>4).some(Boolean),'prediction is exercised');
    t.diagnostic(`${name}: raw RMS=${quality.rmsError.toFixed(6)}, max=${quality.maxError.toFixed(6)}, SNR=${quality.snrDb.toFixed(2)} dB`);
  }
});

test('PS1 loops mark exact packet boundaries and ignore incoming predictor history',()=>{
  for(const loopStartSamples of [0,28,196]) {
    const source=Float32Array.from({length:280},(_,i)=>.65*Math.sin(2*Math.PI*i/56));
    const result=encodePs1Adpcm(source,{loopStartSamples}),first=decode(result.adpcm);
    assert.equal(result.loopStartSamples,loopStartSamples);assert.equal(result.paddingFrames,0);
    for(let block=0;block<result.blockCount;block++) {
      const at=block*16,expected=(block===result.blockCount-1?3:0)|(block*28===loopStartSamples?6:0);
      assert.equal(result.adpcm[at+1],expected);
      if(block===0||block*28===loopStartSamples)assert.equal(result.adpcm[at]>>4,0);
    }
    assert.deepEqual(decode(result.adpcm,[32767,-32768]).pcm,first.pcm,'sample entry ignores history');
    const body=result.adpcm.subarray(loopStartSamples/28*16),second=decode(body,first.history),third=decode(body,second.history);
    assert.deepEqual(second.pcm,first.pcm.subarray(loopStartSamples));assert.deepEqual(third.pcm,second.pcm);
    assert.deepEqual(decode(body,[-32768,32767]).pcm,second.pcm,'loop entry ignores history');
    checkMetrics(source,result);const prepared=preparePs1ADPCM(result.adpcm,{rootNote:69,loopStartSamples});assert.equal(prepared.loop,true);
  }
  const single=encodePs1Adpcm(new Float32Array(28),{loopStartSamples:0});
  assert.equal(single.adpcm[1],7,'single packet combines END, LOOP and LOOP START');
  assert.equal(preparePs1ADPCM(single.adpcm,{rootNote:69,loopStartSamples:0}).loop,true);
});

test('PS1 encoder rejects unsupported input, invalid values, loop positions and unknown options',()=>{
  for(const input of [undefined,null,{},[],[0],new Float64Array(28),new Int16Array(28),new ArrayBuffer(112),new DataView(new ArrayBuffer(112))])assert.throws(()=>encodePs1Adpcm(input),TypeError);
  assert.throws(()=>encodePs1Adpcm(new Float32Array()),RangeError);
  for(const value of [NaN,Infinity,-Infinity,1.01,-1.01]) {
    const source=new Float32Array(56);source[55]=value;const copy=new Uint8Array(source.buffer).slice();
    assert.throws(()=>encodePs1Adpcm(source),RangeError);assert.deepEqual(new Uint8Array(source.buffer),copy);
  }
  const source=new Float32Array(56);
  for(const options of [null,[],42,'x'])assert.throws(()=>encodePs1Adpcm(source,options),TypeError);
  for(const options of [{sampleRate:44100},{rootNote:69},{normalize:true},{[Symbol('option')]:true}])assert.throws(()=>encodePs1Adpcm(source,options),TypeError);
  for(const loopStartSamples of [-1,1,27,29,56,84,1.5,NaN,Infinity,'0'])assert.throws(()=>encodePs1Adpcm(source,{loopStartSamples}),RangeError);
  assert.throws(()=>encodePs1Adpcm(new Float32Array(29),{loopStartSamples:0}),RangeError,'loop length is never padded');
  assert.deepEqual(encodePs1Adpcm(source,{loopStartSamples:undefined,maxBytes:undefined}),encodePs1Adpcm(source));
});

test('PS1 encoder reads only the requested view and returns owned non-mutating bytes',()=>{
  const backing=new Float32Array(64).fill(NaN),source=backing.subarray(4,60);source.set(fixtures().sine.subarray(0,56));
  const before=new Uint8Array(backing.buffer).slice(),result=encodePs1Adpcm(source);
  assert.deepEqual(result.adpcm,encodePs1Adpcm(source.slice()).adpcm);assert.deepEqual(new Uint8Array(backing.buffer),before);
  result.adpcm.fill(255);assert.deepEqual(new Uint8Array(backing.buffer),before);
  for(const source of [new Float32Array(280).fill(1),new Float32Array(280).fill(-1),
    Float32Array.from({length:280},(_,i)=>i&1?1:-1),
    Float32Array.from({length:280},(_,i)=>Math.sin(i*.03))])checkMetrics(source,encodePs1Adpcm(source));
});

test('PS1 encoder rejects capacity overflow before conversion and defaults to empty Synth RAM',()=>{
  assert.equal(DEFAULT_PS1_ADPCM_MAX_BYTES,524288-4096);
  for(const maxBytes of [0,15,15.5,-1,524289,NaN,Infinity,'16'])assert.throws(()=>encodePs1Adpcm(new Float32Array(28),{maxBytes}),RangeError);
  assert.equal(encodePs1Adpcm(new Float32Array(28),{maxBytes:16}).adpcm.length,16);
  assert.equal(encodePs1Adpcm(new Float32Array(56),{maxBytes:32}).adpcm.length,32);
  assert.throws(()=>encodePs1Adpcm(new Float32Array(29),{maxBytes:31}),RangeError);
  assert.throws(()=>encodePs1Adpcm(new Float32Array(57),{maxBytes:32}),RangeError);
  const maxFrames=DEFAULT_PS1_ADPCM_MAX_BYTES/16*28,full=encodePs1Adpcm(new Float32Array(maxFrames));
  assert.equal(full.adpcm.length,DEFAULT_PS1_ADPCM_MAX_BYTES);assert.equal(full.frames,maxFrames);
  const oversized=new Float32Array(maxFrames+1);oversized[0]=NaN;
  assert.throws(()=>encodePs1Adpcm(oversized),/exceeds maxBytes/,'size is checked before PCM validation or candidate search');
  assert.equal(encodePs1Adpcm(new Float32Array(maxFrames+1),{maxBytes:524288}).adpcm.length,DEFAULT_PS1_ADPCM_MAX_BYTES+16);
});
