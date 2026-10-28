import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {encodePs1Adpcm} from './ps1_adpcm_encoder.js';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth} from './ps1synth.js';

// Both native binaries use the real pinned decoder/core. The first exposes
// raw decoded int16 samples; the existing second helper exposes the C ABI.
// Neither helper contains a substitute audio implementation.
const root=fileURLToPath(new URL('../',import.meta.url));
const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
const peak=pcm=>pcm.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
const sine=(frames=112)=>Float32Array.from({length:frames},(_,n)=>.7*Math.sin(2*Math.PI*n/112));
function stereoBytes({left,right}) {
  const bytes=Buffer.alloc(left.length*8);
  for(let n=0;n<left.length;n++){bytes.writeFloatLE(left[n],n*8);bytes.writeFloatLE(right[n],n*8+4);}
  return bytes;
}
async function references(t) {
  const compiler=process.env.CXX||'c++',probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  if(probe.error?.code==='ENOENT'){t.skip('C++ compiler unavailable; actual native decoder and SPU comparison not run');return null;}
  assert.equal(probe.status,0,probe.stderr||probe.error?.message);
  const temp=await mkdtemp(join(tmpdir(),'tetorica-ps1-encoder-core-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const directory=join(root,'native/ps1'),common=['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+directory];
  const raw=join(temp,'decode'),core=join(temp,'spu');
  for(const [binary,helper,sources] of [
    [raw,'ps1_adpcm_decode_reference.cpp',['spu_tables.cpp','spureverb.cpp']],
    [core,'ps1_spu_reference.cpp',['ps1_spu.cpp','spu.cpp','spu_tables.cpp','spureverb.cpp']],
  ]) {
    const result=spawnSync(compiler,[...common,join(root,'test/helpers',helper),...sources.map(name=>join(directory,name)),'-o',binary],{encoding:'utf8',maxBuffer:4*1024*1024});
    assert.equal(result.status,0,result.stderr||result.error?.message);
  }
  return {raw,core};
}
function decodeNative(binary,streams) {
  const result=spawnSync(binary,[],{input:Buffer.concat([u32(streams.length),...streams.flatMap(bytes=>[u32(bytes.length),bytes])]),maxBuffer:8*1024*1024});
  assert.equal(result.status,0,result.stderr?.toString()||result.error?.message);
  let offset=0;
  const decoded=streams.map(bytes=>{
    const pcm=new Int16Array(bytes.length/16*28);
    for(let n=0;n<pcm.length;n++,offset+=2)pcm[n]=result.stdout.readInt16LE(offset);
    return pcm;
  });
  assert.equal(offset,result.stdout.length);return decoded;
}
function checkMetrics(source,decoded,actual) {
  let error=0,signal=0,max=0;
  for(let n=0;n<source.length;n++) {
    const expected=source[n]*32768,difference=expected-decoded[n];
    error+=difference*difference;signal+=expected*expected;max=Math.max(max,Math.abs(difference));
  }
  const expected={rmsError:Math.sqrt(error/source.length)/32768,maxError:max/32768,
    signalRms:Math.sqrt(signal/source.length)/32768,snrDb:error===0||signal===0?null:10*Math.log10(signal/error),
    errorFrames:source.length,exact:error===0};
  assert.deepEqual(actual,expected,'reported quantization metrics equal the independent native decoder, excluding padding');
}
// Check the no-overflow policy against actual decoded history, rather than
// trusting the encoder's candidate scratch samples or reported metrics.
function assertNoWrap(bytes,decoded) {
  const filters=[[0,0],[60,0],[115,-52],[98,-55],[122,-60]];let p1=0,p2=0;
  for(let n=0;n<decoded.length;n++) {
    const block=Math.floor(n/28),index=n%28,header=bytes[block*16],packed=bytes[block*16+2+(index>>1)];
    const nibble=(packed>>(index%2*4)&15),signed=nibble<8?nibble:nibble-16,[f0,f1]=filters[header>>4];
    const sum=(signed*4096>>(header&15))+((p1*f0+p2*f1+32)>>6);
    assert.ok(sum>=-32768&&sum<=32767,`packet ${block}, frame ${index}: no signed-short wrap is exploited`);
    assert.equal(sum,decoded[n]);p2=p1;p1=decoded[n];
  }
}
function render(synth,frames,parts=[frames]) {
  const left=new Float32Array(frames),right=new Float32Array(frames);let offset=0,index=0;
  while(offset<frames){const count=Math.min(parts[index++%parts.length],frames-offset);synth.renderInto(left,right,count,offset);offset+=count;}
  for(const pcm of [left,right])assert.ok(pcm.every(value=>Number.isFinite(value)&&Math.abs(value)<=1));
  return {left,right};
}
function frequency(pcm) {
  let first=-1,last=-1,count=0;
  for(let n=1;n<pcm.length;n++)if(pcm[n-1]<=0&&pcm[n]>0){if(first<0)first=n;last=n;count++;}
  return (count-1)*44100/(last-first);
}

test('PCM encoder packets conform to the actual native decoder and native/WASM SPU',async t=>{
  const binary=await references(t);if(!binary)return;

  await t.test('raw native reconstruction verifies metrics, owned packets, boundaries and full-range no-wrap policy',()=>{
    let state=0x12345678;
    const fixtures=[
      new Float32Array(1),sine(),sine(112*9+13),
      Float32Array.from({length:28*16},(_,n)=>n%2?1:-1),
      Float32Array.from({length:28*25+3},(_,n)=>n%83===0?1:n%71===0?-1:Math.exp(-(n%83)/8)*Math.sin(n*1.9)),
      Float32Array.from({length:28*40},()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x80000000-1;}),
    ];
    const copies=fixtures.map(source=>source.slice()),encoded=fixtures.map(source=>encodePs1Adpcm(source));
    const decoded=decodeNative(binary.raw,encoded.map(result=>result.adpcm));
    for(let i=0;i<fixtures.length;i++) {
      const result=encoded[i];assert.deepEqual(fixtures[i],copies[i],'encoding never mutates source PCM');
      assert.equal(result.sourceFrames,fixtures[i].length);assert.equal(result.frames,decoded[i].length);
      assert.equal(result.paddingFrames,(28-fixtures[i].length%28)%28);assert.equal(result.blockCount,result.adpcm.length/16);
      assert.equal(result.adpcm[0]>>4,0,'initial decode cannot depend on old history');
      assert.equal(result.adpcm[result.adpcm.length-15],1,'only the last one-shot packet has END');
      for(let packet=0;packet<result.blockCount-1;packet++)assert.equal(result.adpcm[packet*16+1],0);
      checkMetrics(fixtures[i],decoded[i],result.metrics);assertNoWrap(result.adpcm,decoded[i]);
      const owned=result.adpcm.slice();fixtures[i].fill(.123);assert.deepEqual(result.adpcm,owned,'returned packets do not alias input');
    }
    assert.equal(encoded[0].metrics.exact,true);assert.equal(encoded[0].metrics.snrDb,null);
    assert.ok(encoded[1].metrics.snrDb>25,'a sustained original sine has useful raw quantization quality');
    const again=encodePs1Adpcm(copies[1]);assert.deepEqual(again.adpcm,encoded[1].adpcm);
    again.adpcm.fill(255);assert.notDeepEqual(again.adpcm,encoded[1].adpcm,'each encoding owns its packet storage');
  });

  await t.test('nonzero loop starts reset predictor history and remain stable over repeated native decode passes',()=>{
    const intro=56,period=112,source=Float32Array.from({length:intro+period},(_,n)=>n<intro?.2*Math.sin(n*.7):.65*Math.sin(2*Math.PI*(n-intro)/period));
    const encoded=encodePs1Adpcm(source,{loopStartSamples:intro}),loop=encoded.adpcm.subarray(intro/28*16);
    assert.equal(encoded.loopStartSamples,intro);assert.equal(encoded.paddingFrames,0);
    assert.equal(encoded.adpcm[intro/28*16]>>4,0);assert.equal(encoded.adpcm[intro/28*16+1],6);
    assert.equal(encoded.adpcm[encoded.adpcm.length-15],3);
    const packets=Buffer.concat([encoded.adpcm,loop,loop,loop]);
    const [decoded]=decodeNative(binary.raw,[packets]);assertNoWrap(packets,decoded);
    const first=decoded.subarray(intro,intro+period);
    for(let repeat=1;repeat<4;repeat++)assert.deepEqual(decoded.subarray(intro+repeat*period,intro+(repeat+1)*period),first,'loop re-entry never drifts with a previous iteration history');
    const unrelated=encodePs1Adpcm(Float32Array.from({length:56},(_,n)=>n&1?-.95:.9));
    const [entered]=decodeNative(binary.raw,[Buffer.concat([unrelated.adpcm,loop])]);
    assert.deepEqual(entered.subarray(56),first,'loop-start filter 0 also removes unrelated prior history');
  });

  await t.test('encoded instruments retain actual native/WASM equality through CH24 tuning, signed stereo, Stop, retrigger and END',async()=>{
    const [{default:factory},wasmBinary]=await Promise.all([import('../docs/generated/ps1_spu_wasm.js'),readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url))]);
    const module=await factory({wasmBinary}),chip=await Ps1Spu.create({moduleFactory:async()=>module});
    t.after(()=>chip.dispose());const commands=[],expected=[];
    const recorded={
      get nativeFrames(){return chip.nativeFrames;},
      write(offset,value){commands.push(Buffer.concat([u32(1),u32(offset),u32(value)]));chip.write(offset,value);},
      read(offset){commands.push(Buffer.concat([u32(2),u32(offset)]));const value=chip.read(offset);expected.push(u32(value));return value;},
      reset(options={}){commands.push(Buffer.concat([u32(0),u32(Number(options.clearRam??false))]));chip.reset(options);},
      loadRam(bytes,address=0){commands.push(Buffer.concat([u32(3),u32(address),u32(bytes.length),bytes]));chip.loadRam(bytes,address);},
      readRam(address=0,length=512*1024){commands.push(Buffer.concat([u32(4),u32(address),u32(length)]));const bytes=chip.readRam(address,length);expected.push(bytes);return bytes;},
      renderInto(left,right,frames,offset=0){commands.push(Buffer.concat([u32(5),u32(frames)]));chip.renderInto(left,right,frames,offset);expected.push(stereoBytes({left:left.subarray(offset,offset+frames),right:right.subarray(offset,offset+frames)}));},
      dispose(){chip.dispose();},
    };
    const synth=new Ps1Synth({core:recorded}),source=sine(),encoded=encodePs1Adpcm(source,{loopStartSamples:0});
    const sample=synth.loadADPCM(encoded.adpcm,{baseFrequencyHz:44100/source.length,loopStartSamples:encoded.loopStartSamples});
    assert.deepEqual(recorded.readRam(sample.startAddress,sample.byteLength),encoded.adpcm);
    const upload=encoded.adpcm.slice();encoded.adpcm.fill(0);assert.deepEqual(recorded.readRam(sample.startAddress,sample.byteLength),upload,'Synth owns the upload after caller changes encoded packets');
    synth.setPreset(23,{sample,volumeLeft:.7,volumeRight:-.7});synth.keyOn(23);
    const onset=render(synth,256,[1,127,53]);assert.ok(peak(onset.left)>.1);
    const cycles=render(synth,112*32,[1,127,2048,53]);
    for(let start=112;start<cycles.left.length;start+=112)assert.deepEqual(cycles.left.subarray(start,start+112),cycles.left.subarray(0,112),'generated loop is stable through the actual SPU decoder cache');
    for(let n=0;n<cycles.left.length;n++)assert.ok(Math.abs(cycles.left[n]+cycles.right[n])<1/16384,'signed volume affects one stereo side independently');
    synth.stopVoices();assert.equal(recorded.nativeFrames,0);assert.equal(peak(render(synth,257).left),0);
    synth.stopVoices();synth.keyOn(23);assert.deepEqual(render(synth,256,[127,1,53]),onset,'Stop/retrigger reconstructs the same generated onset');
    synth.stopVoices();synth.noteOn(23,'A4');assert.equal(recorded.read(23*16+4),Math.round(4096*440/(44100/112)));
    const tuned=render(synth,20000,[1,127,2047,53]);assert.ok(Math.abs(frequency(tuned.left.subarray(1024))-440)<.2,'explicit source tuning reaches A4 after SPU pitch interpolation');
    synth.stopVoices();const retained=recorded.readRam(sample.startAddress,sample.byteLength);assert.deepEqual(retained,upload);
    const before={commands:commands.length,preset:synth.getPreset(23),address:synth.nextAddress,frames:recorded.nativeFrames};
    for(const operation of [
      ()=>encodePs1Adpcm(Float32Array.of(NaN)),()=>encodePs1Adpcm(Float32Array.of(1.01)),
      ()=>encodePs1Adpcm(source,{loopStartSamples:1}),()=>encodePs1Adpcm(source,{maxBytes:16}),
    ])assert.throws(operation);
    assert.equal(commands.length,before.commands,'rejected PCM never sends a core write or upload');assert.deepEqual(synth.getPreset(23),before.preset);
    assert.equal(synth.nextAddress,before.address);assert.equal(recorded.nativeFrames,before.frames);
    for(const {label,pcm,loopStartSamples} of [
      {label:'single packet',pcm:Float32Array.from({length:28},(_,n)=>.65*Math.sin(2*Math.PI*n/28)),loopStartSamples:0},
      {label:'only the final packet',pcm:Float32Array.from({length:84},(_,n)=>n<56?.4*Math.cos(n*.8):.65*Math.sin(2*Math.PI*(n-56)/28)),loopStartSamples:56},
    ]) {
      synth.stopVoices();const boundary=encodePs1Adpcm(pcm,{loopStartSamples});
      assert.equal(boundary.adpcm[boundary.adpcm.length-15],7,`${label}: END, REPEAT and START share the final packet`);
      const instrument=synth.loadADPCM(boundary.adpcm,{baseFrequencyHz:44100/28,loopStartSamples});
      assert.equal(instrument.repeatAddress,instrument.startAddress+loopStartSamples/28*16);
      synth.setPreset(23,{sample:instrument,pitch:4096,volumeLeft:.5,volumeRight:.25});synth.keyOn(23);
      assert.ok(peak(render(synth,512,[1,127,53]).left)>.05,`${label}: the actual SPU produces finite sound`);
      const repeated=render(synth,28*64,[1,127,53]);
      for(let start=28;start<repeated.left.length;start+=28) {
        assert.deepEqual(repeated.left.subarray(start,start+28),repeated.left.subarray(0,28),`${label}: minimum loop stays exactly periodic`);
        assert.deepEqual(repeated.right.subarray(start,start+28),repeated.right.subarray(0,28));
      }
      assert.ok(peak(repeated.right)>.02);assert.equal(recorded.read(23*16+14),instrument.repeatAddress>>3);
    }
    synth.stopVoices();
    const oneShot=encodePs1Adpcm(sine(153)),shot=synth.loadADPCM(oneShot.adpcm,{rootNote:'A4'});
    assert.equal(shot.decodedFrames,168);synth.setPreset(0,{sample:shot,volumeLeft:.5,volumeRight:.25});synth.keyOn(0);
    const once=render(synth,2048,[1,127,2047]);assert.ok(peak(once.left)>.05);assert.equal(peak(once.left.subarray(1024)),0);
    assert.equal(peak(once.right.subarray(1024)),0);assert.ok(recorded.read(0x19c)&1,'generated one-shot END is visible in hardware status');
    recorded.read(12); // END silences playback; the core may retain the last ENVX value.
    assert.deepEqual(recorded.readRam(shot.startAddress,shot.byteLength),oneShot.adpcm);
    synth.stopVoices();const silent=render(synth,4097,[127,2048,53]);assert.equal(peak(silent.left),0);assert.equal(peak(silent.right),0);
    for(const offset of [0,2,4,6,8,10,12,14,23*16,23*16+4,23*16+12,0x19c,0x19e])recorded.read(offset);
    const native=spawnSync(binary.core,[],{input:Buffer.concat([u32(commands.length),...commands]),maxBuffer:16*1024*1024});
    assert.equal(native.status,0,native.stderr?.toString()||native.error?.message);
    assert.deepEqual(native.stdout,Buffer.concat(expected),'actual native and shipped WASM match bit-for-bit for every generated-sample PCM, register and RAM response');
  });
});
