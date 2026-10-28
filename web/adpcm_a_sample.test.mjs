import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {encodeAdpcmA} from './adpcm_a_sample.js';
import {Ym2610B,YM2610B_CLOCK} from './ym2610b.js';
import {YM2610BSynth,YM2610BDirectTransport} from './ym2610bsynth.js';

// Original synthetic signals; no game recordings or ROM assets are used.
function fixtures() {
  let state=0x7318a2df;
  const noise=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2147483648-1;};
  return {
    sine:Float32Array.from({length:2048},(_,i)=>.6*Math.sin(2*Math.PI*i/64)),
    voice:Float32Array.from({length:2048},(_,i)=>{
      const p=2*Math.PI*i/97,e=Math.min(1,i/96)*Math.min(1,(2048-i)/192);
      return e*(.4*Math.sin(p)+.15*Math.sin(2*p)+.075*Math.sin(3*p));
    }),
    drum:Float32Array.from({length:1703},(_,i)=>Math.exp(-i/320)*(.56*Math.sin(2*Math.PI*(i/64-i*i/1400000))+.2*noise())),
  };
}

// A test-only decoder, not an encoder. Its output is checked sample-for-sample
// against the real C++ adpcm_a_channel below, including deliberate wraparound.
function decode(bytes) {
  const steps=[16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552];
  const increments=[-1,-1,-1,-1,2,5,7,9],pcm=new Int16Array(bytes.length*2);
  let accumulator=0,index=0;
  for(let frame=0;frame<pcm.length;frame++) {
    const code=frame&1?bytes[frame>>1]&15:bytes[frame>>1]>>4;
    const delta=Math.trunc((2*(code&7)+1)*steps[index]/8)*(code&8?-1:1);
    accumulator=(accumulator+delta)&4095;
    index=Math.max(0,Math.min(48,index+increments[code&7]));
    pcm[frame]=accumulator>=2048?accumulator-4096:accumulator;
  }
  return pcm;
}
function metrics(source,pcm) {
  let squared=0,signal=0,maxError=0;
  for(let i=0;i<source.length;i++) {
    const difference=source[i]-pcm[i]/2048;
    squared+=difference*difference;signal+=source[i]*source[i];maxError=Math.max(maxError,Math.abs(difference));
  }
  return {rmsError:Math.sqrt(squared/source.length),maxError,signalRms:Math.sqrt(signal/source.length),
    snrDb:squared===0||signal===0?null:10*Math.log10(signal/squared),errorFrames:source.length,exact:squared===0};
}
function assertMetrics(result,source) {
  const expected=metrics(source,decode(result.bytes));
  for(const key of ['rmsError','maxError','signalRms'])assert.ok(Math.abs(result.metrics[key]-expected[key])<1e-12,`${key} is measured before chip gain and excludes padding`);
  if(expected.snrDb===null)assert.equal(result.metrics.snrDb,null);
  else assert.ok(Number.isFinite(result.metrics.snrDb)&&Math.abs(result.metrics.snrDb-expected.snrDb)<1e-10);
  assert.equal(result.metrics.errorFrames,expected.errorFrames);assert.equal(result.metrics.exact,expected.exact);
  assert.deepEqual(JSON.parse(JSON.stringify(result.metrics)),result.metrics,'metrics are JSON safe');
  return expected;
}

test('ADPCM-A encoder emits high-nibble-first codes with hardware predictor state and byte alignment',()=>{
  const source=Float32Array.from([2/2048,0,6/2048,-8/2048]),result=encodeAdpcmA(source);
  assert.equal(result.bytes[0],0x08,'nibble 0 adds 2; nibble 8 subtracts 2');
  assert.deepEqual(Array.from(decode(result.bytes).subarray(0,4)),[2,0,6,-8]);
  assert.equal(result.sourceFrames,4);assert.equal(result.frames,512);assert.equal(result.paddingFrames,508);assert.equal(result.bytes.length,256);
  assertMetrics(result,source);
  for(const length of [1,2,255,256,511,512,513,1024]) {
    const input=new Float32Array(length),encoded=encodeAdpcmA(input);
    assert.ok(encoded.bytes instanceof Uint8Array);assert.equal(encoded.bytes.length,Math.ceil(length/512)*256);
    assert.equal(encoded.sourceFrames,length);assert.equal(encoded.frames,encoded.bytes.length*2);assert.equal(encoded.paddingFrames,encoded.frames-length);
    const extended=new Float32Array(encoded.frames);extended.set(input);
    assert.deepEqual(encoded.bytes,encodeAdpcmA(extended).bytes,'padding is encoded zero PCM using the continued predictor');
    assertMetrics(encoded,input);
  }
});

test('ADPCM-A encoder reports raw lossy quality and preserves deterministic owned input/output',t=>{
  const limits={sine:{rms:.025,snr:22},voice:{rms:.025,snr:20},drum:{rms:.04,snr:14}};
  for(const [name,source] of Object.entries(fixtures())) {
    const copy=source.slice(),result=encodeAdpcmA(source),quality=assertMetrics(result,source);
    assert.deepEqual(source,copy);assert.deepEqual(result,encodeAdpcmA(source));
    assert.ok(quality.rmsError>0&&quality.rmsError<limits[name].rms,`${name} RMS error ${quality.rmsError}`);
    assert.ok(quality.snrDb>limits[name].snr,`${name} SNR ${quality.snrDb} dB`);
    assert.ok(quality.maxError<.3,`${name} has no wraparound spike`);
    t.diagnostic(`${name}: raw RMS=${quality.rmsError.toFixed(6)}, max=${quality.maxError.toFixed(6)}, SNR=${quality.snrDb.toFixed(2)} dB`);
    const padded=new Float32Array(result.frames);padded.set(source);
    assert.deepEqual(result.bytes,encodeAdpcmA(padded).bytes);
    result.bytes.fill(255);assert.deepEqual(source,copy,'output never aliases PCM');
  }
  const full=new Float32Array(520).fill(NaN),view=full.subarray(4,516);view.set(fixtures().sine.subarray(0,512));
  const before=new Uint8Array(full.buffer).slice();assert.deepEqual(encodeAdpcmA(view),encodeAdpcmA(view.slice()));assert.deepEqual(new Uint8Array(full.buffer),before);
});

test('ADPCM-A encoder rejects invalid PCM, unsupported loop/rate options and unsafe byte budgets',()=>{
  for(const input of [undefined,null,{},[],[0],new Float64Array(512),new Int16Array(512),new ArrayBuffer(2048),new DataView(new ArrayBuffer(2048))])assert.throws(()=>encodeAdpcmA(input),TypeError);
  assert.throws(()=>encodeAdpcmA(new Float32Array()),RangeError);
  for(const value of [NaN,Infinity,-Infinity,1.001,-1.001]) {
    const source=new Float32Array(512);source[511]=value;const before=new Uint8Array(source.buffer).slice();
    assert.throws(()=>encodeAdpcmA(source),RangeError);assert.deepEqual(new Uint8Array(source.buffer),before);
  }
  for(const options of [null,[],1,'x'])assert.throws(()=>encodeAdpcmA(new Float32Array(1),options),TypeError);
  for(const options of [{loop:true},{sampleRate:18518},{outputRate:18518},{[Symbol('option')]:1}])assert.throws(()=>encodeAdpcmA(new Float32Array(1),options),TypeError);
  for(const maxBytes of [0,255,-1,256.5,0x100000,Infinity,NaN,'256'])assert.throws(()=>encodeAdpcmA(new Float32Array(1),{maxBytes}),RangeError);
  assert.equal(encodeAdpcmA(new Float32Array(512),{maxBytes:256}).bytes.length,256);
  assert.throws(()=>encodeAdpcmA(new Float32Array(513),{maxBytes:256}),RangeError);
  assert.equal(encodeAdpcmA(new Float32Array(512),{maxBytes:257}).bytes.length,256,'budget need not itself be block aligned');
  const frames=0xfff00*2,largest=encodeAdpcmA(new Float32Array(frames));assert.equal(largest.bytes.length,0xfff00);
  const tooLarge=new Float32Array(frames+1);tooLarge[0]=NaN;
  assert.throws(()=>encodeAdpcmA(tooLarge),/memory|budget|exceed|large/i,'capacity is checked before walking invalid PCM');
  assertMetrics(encodeAdpcmA(Float32Array.from([-1,1,0])),Float32Array.from([-1,1,0]));
});

const root=fileURLToPath(new URL('../',import.meta.url));
async function buildNative(t) {
  const compiler=process.env.CXX||'c++',probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  if(probe.error?.code==='ENOENT'){t.skip('C++ compiler unavailable; native ADPCM-A reference not run');return null;}
  assert.equal(probe.status,0,probe.stderr||String(probe.error));
  const temp=await mkdtemp(join(tmpdir(),'tetorica-adpcm-a-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const sdk=join(root,'third_party/tetorica-soundchip-native'),vendor=join(sdk,'vendor/ymfm'),binary=join(temp,'reference');
  const sources=['ymfm_adpcm','ymfm_misc','ymfm_opl','ymfm_opm','ymfm_opn','ymfm_opq','ymfm_opz','ymfm_pcm','ymfm_ssg'].map(name=>join(vendor,name+'.cpp'));
  const build=spawnSync(compiler,['-std=c++14','-O2','-fwrapv','-fno-strict-aliasing','-I'+vendor,join(root,'test/helpers/ym2610_adpcm_a_reference.cpp'),join(sdk,'wasm/ym2610b_wasm.cpp'),...sources,'-o',binary],{encoding:'utf8'});
  assert.equal(build.status,0,build.stderr||String(build.error));return binary;
}
const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
function pcm16(pcm) {const bytes=Buffer.alloc(pcm.length*2);for(let i=0;i<pcm.length;i++)bytes.writeInt16LE(pcm[i],i*2);return bytes;}
const peak=pcm=>pcm.reduce((m,n)=>Math.max(m,Math.abs(n)),0);
let assets;
async function createChip(variant=true) {
  const [factory,wasmBinary]=await (assets??=Promise.all([import('../docs/generated/ym2610b_wasm.js').then(m=>m.default),readFile(new URL('../docs/generated/ym2610b_wasm.wasm',import.meta.url))]));
  return Ym2610B.create({moduleFactory:factory,moduleOptions:{wasmBinary},variant});
}
function recorder(chip) {
  const commands=[],output=[];let address=[0,0];
  const wrapped={
    reset(){commands.push(Buffer.from([0]));chip.reset();},
    write(offset,value){if(!(offset&1))address[offset>>1]=value;else commands.push(Buffer.from([2,offset>>1,address[offset>>1],value]));chip.write(offset,value);},
    loadAdpcmRom(type,bytes,offset=0,size=offset+bytes.length){commands.push(Buffer.concat([Buffer.from([1,type]),u32(offset),u32(bytes.length),u32(size),bytes]));chip.loadAdpcmRom(type,bytes,offset,size);},
  };
  return {commands,output,synth:new YM2610BSynth({transport:new YM2610BDirectTransport(wrapped)}),
    render(frames){
      commands.push(Buffer.concat([Buffer.from([3]),u32(frames)]));const pcm=chip.generateStereo(frames),interleaved=new Int16Array(frames*2);
      for(let i=0;i<frames;i++){assert.ok(Number.isFinite(pcm.left[i])&&Number.isFinite(pcm.right[i]));interleaved[2*i]=pcm.left[i]*32768;interleaved[2*i+1]=pcm.right[i]*32768;}
      output.push(pcm16(interleaved));return pcm;
    },
    status(){commands.push(Buffer.from([4]));const status=chip.readStatusHi();output.push(Buffer.from([status]));return status;},
    clear(){commands.push(Buffer.from([5]));chip.clearAdpcmRoms();},
  };
}

test('encoded ADPCM-A and arbitrary wrapping nibbles match actual native ymfm channel decoding',async t=>{
  const binary=await buildNative(t);if(!binary)return;
  const bytes=Object.values(fixtures()).map(source=>encodeAdpcmA(source).bytes);
  bytes.push(encodeAdpcmA(Float32Array.from([-1,1,0,0,.9,-.9])).bytes);
  bytes.push(Uint8Array.from({length:256},(_,i)=>i));
  for(const code of [0,7,8,15])bytes.push(new Uint8Array(256).fill(code*17));
  const input=Buffer.concat([u32(bytes.length),...bytes.flatMap(data=>[u32(data.length),data])]);
  const actual=spawnSync(binary,['raw'],{input,maxBuffer:4*1024*1024});assert.equal(actual.status,0,actual.stderr?.toString());
  assert.deepEqual(actual.stdout,Buffer.concat(bytes.map(data=>pcm16(decode(data)))),'all samples match actual 12-bit wrapping native accumulators');
  for(const [source,data] of Object.values(fixtures()).map((source,i)=>[source,bytes[i]]))assertMetrics({...encodeAdpcmA(source),bytes:data},source);
});

async function exerciseChip(variant,t) {
  const chip=await createChip(variant);t.after(()=>chip.dispose());const r=recorder(chip),{synth}=r,a=synth.adpcmA,b=synth.adpcmB;
  // The shipped core uses maximum fidelity (clock/16). ADPCM-A still
  // advances at clock/432, so one decoded sample spans 27 output frames.
  assert.equal(chip.sampleRate(),YM2610B_CLOCK/16);
  const outputPerSample=chip.sampleRate()*432/YM2610B_CLOCK,settle=outputPerSample*32,prefix=64*outputPerSample*4;
  const source=Float32Array.from({length:2048},(_,i)=>.16*Math.sin(2*Math.PI*i/64)),encoded=encodeAdpcmA(source);
  const offsets=[0,0x1000,0x2000,0x10000,0xfff00,0x110000];
  // High addresses first, then low. A later upload must retain all earlier data.
  for(let voice=5;voice>=0;voice--)a.loadMemory(encoded.bytes,offsets[voice]);
  b.loadMemory(new Uint8Array(encoded.bytes.length).fill(0x77),0);
  const rendered=[];
  for(let voice=0;voice<6;voice++) {
    synth.reset();r.render(settle);a.setVolume(63);a.setVoice(voice,{volume:31,left:voice<3,right:voice>=3});
    a.setSample(voice,{start:offsets[voice],end:offsets[voice]+encoded.bytes.length});a.keyOn(voice);
    const first=r.render(prefix),audible=voice<3?first.left:first.right,quiet=voice<3?first.right:first.left;
    assert.ok(peak(audible)>.03,`variant ${variant}, A voice ${voice} plays encoded PCM`);assert.equal(peak(quiet),0,'hardware pan gate is exact');
    // A fixed 64-frame waveform lasts 64 decoded samples at clock/432.
    const period=64*outputPerSample,crossings=[];for(let i=period+1;i<audible.length;i++)if(audible[i-1]<=0&&audible[i]>0)crossings.push(i);
    assert.ok(crossings.length>=2);for(let i=1;i<crossings.length;i++)assert.equal(crossings[i]-crossings[i-1],period);
    assert.ok(Math.abs(YM2610B_CLOCK/432/64-289.35185185185185)<1e-10);
    a.keyOn(voice);assert.deepEqual(r.render(prefix),first,'retrigger resets predictor and address');
    r.render(encoded.frames*outputPerSample-prefix-outputPerSample*4);assert.equal(r.status()&(1<<voice),0,'EOS is not early');
    r.render(outputPerSample*16);assert.ok(r.status()&(1<<voice),'EOS occurs at paddedFrames / (clock/432)');
    const tail=r.render(settle);assert.equal(peak(tail.left)+peak(tail.right),0,'no read beyond inclusive end, no looping or ADPCM-B leakage');
    rendered.push(first);
  }
  synth.reset();r.render(settle);a.setVolume(63);
  for(let voice=0;voice<6;voice++){a.setSample(voice,{start:offsets[voice],end:offsets[voice]+encoded.bytes.length});a.setVoice(voice,{volume:31,left:voice<3,right:voice>=3});}
  a.keyOn([0,1,2,3,4,5]);const sum=r.render(prefix);
  for(let i=0;i<sum.left.length;i++) {
    assert.equal(sum.left[i],rendered[0].left[i]*3,'three low-level A voices sum without clipping');
    assert.equal(sum.right[i],rendered[3].right[i]*3);
  }
  a.keyOff([0,1,2,3,4,5]);r.render(outputPerSample*4);const off=r.render(settle);assert.equal(peak(off.left)+peak(off.right),0,'keyOff clears output');
  a.keyOn(0);assert.ok(peak(r.render(prefix).left)>.03);synth.reset();r.render(settle);assert.equal(peak(r.render(settle).left),0,'reset stops playback');
  a.setVolume(63);a.setVoice(0,{volume:31,left:true,right:true});a.setSample(0,{start:0,end:encoded.bytes.length});a.keyOn(0);assert.ok(peak(r.render(prefix).left)>.03,'reset retains uploaded A ROM');
  r.clear();synth.reset();r.render(settle);a.setVolume(0);a.keyOff([0,1,2,3,4,5]);assert.equal(peak(r.render(settle).left),0);
  return r;
}

test('encoded PCM plays through shipped WASM YM2610 and YM2610B with six voices, pan, fixed rate, EOS, retrigger and reset',async t=>{
  for(const variant of [false,true])await exerciseChip(variant,t);
  const a=await createChip(),b=await createChip();t.after(()=>a.dispose());t.after(()=>b.dispose());
  const ra=recorder(a),rb=recorder(b),encoded=encodeAdpcmA(fixtures().sine);
  ra.synth.adpcmA.loadMemory(encoded.bytes);encoded.bytes.fill(0xff);
  for(const r of [ra,rb]){r.synth.adpcmA.setVolume(63);r.synth.adpcmA.setVoice(0,{volume:31,left:true,right:true});r.synth.adpcmA.setSample(0,{start:0,end:1024});r.synth.adpcmA.keyOn(0);}
  assert.ok(peak(ra.render(6912).left)>.01);assert.notDeepEqual(ra.render(6912),rb.render(6912),'ROM and decoder history are instance-owned');
  const retained=a.generateStereo(96);a.dispose();a.dispose();assert.equal(a.handle,0);assert.throws(()=>a.generateStereo(1),/disposed/);assert.ok(retained.left.every(Number.isFinite),'returned PCM survives disposal');
});

test('encoded ADPCM-A whole-chip Native and WASM output match bit exactly for both YM2610 variants',async t=>{
  const binary=await buildNative(t);if(!binary)return;
  for(const variant of [false,true]) {
    const r=await exerciseChip(variant,t),input=Buffer.concat([Buffer.from([Number(variant)]),u32(r.commands.length),...r.commands]);
    const native=spawnSync(binary,['audio'],{input,maxBuffer:8*1024*1024});assert.equal(native.status,0,native.stderr?.toString());
    assert.deepEqual(native.stdout,Buffer.concat(r.output),`variant ${variant}: registers, A/B ROM, pan, PCM, EOS, retrigger, keyOff/reset`);
  }
});
