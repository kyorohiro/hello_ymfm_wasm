import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {Ps1Spu} from './ps1_spu.js';

// Hand-authored filter-0 PSX ADPCM: no BIOS, ROM, recording or game assets.
// Each block is 16 bytes / 28 samples. The first nibble is the LOW nibble.
const RAM_BYTES=512*1024,SAMPLE_ADDRESS=0x2000,MAX_FRAMES=1<<20;
const REG={masterLeft:0x180,masterRight:0x182,keyOn:0x188,keyOff:0x18c,end:0x19c,control:0x1aa,ramControl:0x1ac};
function wave({blocks=4,loop=true,invert=false,filter=0,shift=4,loopBlock=0}={}) {
  const bytes=new Uint8Array(blocks*16);
  for(let block=0;block<blocks;block++) {
    const at=block*16;bytes[at]=(filter<<4)|shift;
    bytes[at+1]=loop&&block===loopBlock?6:0;
    if(block===blocks-1)bytes[at+1]=loop?3:1;
    for(let pair=0;pair<14;pair++) {
      const nibble=index=>Math.round((invert?-7:7)*Math.sin(2*Math.PI*index/(blocks*28)))&15;
      const index=block*28+pair*2;bytes[at+2+pair]=nibble(index)|(nibble(index+1)<<4);
    }
  }
  return bytes;
}
let assets,sharedModule;
async function moduleFactory() {
  const [factory,wasmBinary]=await (assets??=Promise.all([
    import('../docs/generated/ps1_spu_wasm.js').then(module=>module.default),
    readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url)),
  ]));
  return sharedModule??=factory({wasmBinary});
}
async function create(t,module) {
  const chip=await Ps1Spu.create({moduleFactory:module?async()=>module:moduleFactory});
  t.after(()=>chip.dispose());return chip;
}
function mask(chip,base,channel) {chip.write(base+(channel>=16?2:0),1<<(channel%16));}
function load(chip,bytes=wave()) {chip.loadRam(bytes,SAMPLE_ADDRESS);return bytes;}
function setup(chip,{channel=0,pitch=0x1000,left=0x3fff,right=left,address=SAMPLE_ADDRESS,repeat=address,adsr1=0x000f,adsr2=0x0000}={}) {
  chip.write(REG.masterLeft,0x3fff);chip.write(REG.masterRight,0x3fff);chip.write(REG.control,0xc000);
  const base=channel*16;
  for(const [offset,value] of [[0,left],[2,right],[4,pitch],[6,address>>3],[8,adsr1],[10,adsr2],[14,repeat>>3]])chip.write(base+offset,value);
}
function start(chip,options={}) {setup(chip,options);mask(chip,REG.keyOn,options.channel??0);}
const peak=pcm=>pcm.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
const rms=pcm=>Math.sqrt(pcm.reduce((sum,value)=>sum+value*value,0)/pcm.length);
function finite(audio) {
  for(const channel of [audio.left,audio.right])assert.ok(channel.every(value=>Number.isFinite(value)&&value>=-1&&value<=1));
}
function render(chip,frames,partitions=[frames]) {
  const left=new Float32Array(frames),right=new Float32Array(frames);let offset=0,index=0;
  while(offset<frames) {
    const count=Math.min(partitions[index++%partitions.length],frames-offset);chip.renderInto(left,right,count,offset);offset+=count;
  }
  const result={left,right};finite(result);return result;
}

// Independently transcribed hardware data from PSX-SPX, not read from the core.
const gaussianTable=JSON.parse(await readFile(new URL('../test/helpers/ps1_gaussian_table.json',import.meta.url),'utf8'));
function gaussianOracle(source,index,phase,loopStart=0) {
  const at=n=>n<0?0:source[n<source.length?n:loopStart+(n-source.length)%(source.length-loopStart)];
  const i=(phase>>>4)&255;
  return [255-i,511-i,256+i,i].reduce((sum,coefficient,k)=>sum+Math.floor(gaussianTable[coefficient]*at(index-3+k)/32768),0);
}
function fixedVolumeOracle(sample) {
  const voice=(sample*32766)>>15;
  return Math.fround(Math.fround(voice*32766)/1073741824);
}
function decodedFilterZero(bytes) {
  return Array.from({length:bytes.length/16*28},(_,i)=>{
    const at=Math.floor(i/28)*16,n=i%28;
    const nibble=(bytes[at+2+(n>>>1)]>>>((n&1)*4))&15;
    return ((nibble<8?nibble:nibble-16)*4096)>>(bytes[at]&15);
  });
}

test('Gaussian hardware table has documented phase endpoints and sub-unity DC gain',()=>{
  assert.equal(gaussianTable.length,512);
  assert.deepEqual([0,15,16,127,255,256,511].map(i=>gaussianTable[i]),[-1,-1,0,0x19c,0x12c7,0x1307,0x59b3]);
  for(let i=0;i<256;i++) {
    const sum=gaussianTable[i]+gaussianTable[255-i]+gaussianTable[256+i]+gaussianTable[511-i];
    assert.ok(sum>=0x7f7f&&sum<=0x7f81);
  }
  assert.equal(gaussianOracle([32767,32767,32767,32767],3,0),32637);
});

test('Gaussian voice output matches specification across all phases, packet/loop boundaries and skipped frames',async t=>{
  const chip=await create(t);
  for(const blocks of [1,4])for(const pitch of [0,1,0x800,0x1000,0x1010,0x1234,0x3fff]) {
    const bytes=wave({blocks}),source=decodedFilterZero(bytes);
    chip.reset();load(chip,bytes);start(chip,{pitch});render(chip,256);
    const actual=render(chip,4096,[1,27,2,113,2048]).left;
    const expected=Float32Array.from(actual,(_,frame)=>{
      const position=(frame+256)*pitch;
      return fixedVolumeOracle(gaussianOracle(source,Math.floor(position/4096),position&4095));
    });
    assert.deepEqual(actual,expected,`specification oracle: ${blocks} packets, pitch ${pitch.toString(16)}`);
  }
});

test('Gaussian history survives a nonzero repeat address and clears on KON and reset',async t=>{
  const chip=await create(t),bytes=wave({blocks:4,loopBlock:1}),pitch=0x3fff;
  // An asymmetric waveform makes sample-order and wrap mistakes observable.
  for(let b=0;b<4;b++)for(let n=0;n<14;n++)bytes[b*16+2+n]=(b*71+n*37)&255;
  const decoded=decodedFilterZero(bytes);
  load(chip,bytes);start(chip,{pitch,repeat:SAMPLE_ADDRESS+16});
  const first=render(chip,8192,[1,17,89]).left;
  for(let frame=256;frame<first.length;frame++) {
    const at=frame*pitch;
    assert.equal(first[frame],fixedVolumeOracle(gaussianOracle(decoded,Math.floor(at/4096),at&4095,28)));
  }
  mask(chip,REG.keyOn,0);
  assert.deepEqual(render(chip,256,[1]).left,first.subarray(0,256),'KON resets history without retaining the prior loop tail');
  chip.reset();start(chip,{pitch,repeat:SAMPLE_ADDRESS+16});
  assert.deepEqual(render(chip,256).left,first.subarray(0,256),'reset retaining RAM resets history');
});

test('noise bypasses Gaussian sample history, and modulation uses post-envelope Gaussian output',async t=>{
  const a=await create(t),b=await create(t);
  for(const [chip,invert]of [[a,false],[b,true]]) {
    load(chip,wave({invert}));start(chip,{pitch:0x1234});chip.write(0x194,1);
  }
  assert.deepEqual(render(a,4096,[17]).left,render(b,4096,[1]).left,'noise output is independent of decoded ADPCM history');
  a.reset();const bytes=wave(),source=decodedFilterZero(bytes);load(a,bytes);
  start(a,{channel:0,left:0,right:0});start(a,{channel:1,pitch:0x2345});a.write(0x190,2);
  const audio=render(a,8192,[1,17,409]).left;
  // Warmup source attack uses the inherited floating-point ADSR approximation.
  // Begin comparison after settling, but derive target phase from every source
  // OUTX by reversing the known fixed gains of a separate unmodulated voice.
  const reference=await create(t);load(reference,bytes);start(reference);
  const sourcePcm=render(reference,8192).left;
  let position=0;
  for(let frame=0;frame<audio.length;frame++) {
    // Full fixed gains are reversible here: recover pre-volume OUTX exactly.
    const candidates=[Math.round(sourcePcm[frame]*32768),Math.round(sourcePcm[frame]*32768)+1,Math.round(sourcePcm[frame]*32768)-1];
    const outx=candidates.find(value=>fixedVolumeOracle(value)===sourcePcm[frame]);
    assert.notEqual(outx,undefined);
    if(frame>=256)assert.equal(audio[frame],fixedVolumeOracle(gaussianOracle(source,Math.floor(position/4096),position&4095)),`modulated frame ${frame}`);
    position+=Math.min(0x3fff,(0x2345*(outx+32768))>>>15);
  }
});

test('PS1 SPU cold reset is silent, exposes 44.1 kHz and owns a 512 KiB RAM image',async t=>{
  const chip=await create(t);assert.equal(chip.sampleRate,44100);assert.equal(chip.nativeFrames,0);
  const ram=chip.readRam();assert.equal(ram.length,RAM_BYTES);assert.ok(ram.every(value=>value===0));
  assert.deepEqual(chip.generateStereo(0),{left:new Float32Array(),right:new Float32Array()});
  chip.renderInto(new Float32Array(),new Float32Array(),0);chip.loadRam(new Uint8Array(),RAM_BYTES);
  assert.deepEqual(chip.readRam(RAM_BYTES,0),new Uint8Array());assert.equal(chip.nativeFrames,0,'zero-size calls are no-ops');
  assert.equal(chip.read(REG.ramControl)&15,4);
  const audio=render(chip,4097,[1,127,1024,53]);assert.equal(peak(audio.left),0);assert.equal(peak(audio.right),0);
  assert.equal(chip.nativeFrames,4097);
  chip.reset();assert.equal(chip.nativeFrames,0);assert.equal(peak(render(chip,128).left),0);
});

test('all 24 physical SPU voices reach both outputs, including the high key mask bank',async t=>{
  const chip=await create(t),bytes=wave();
  for(let channel=0;channel<24;channel++) {
    chip.reset({clearRam:true});load(chip,bytes);start(chip,{channel});
    assert.equal(chip.read(channel*16),0x3fff);
    assert.equal(chip.read(0x200+channel*4),0x7ffe,'live fixed-volume read bank does not alias the programmed voice bank');
    const audio=render(chip,768,[1,127,53]);assert.ok(peak(audio.left)>.01,`physical voice ${channel} sounds`);
    assert.deepEqual(audio.left,audio.right,'equal fixed channel/master volumes produce equal stereo');
    mask(chip,REG.keyOff,channel);render(chip,2048);assert.equal(peak(render(chip,128).left),0,`physical voice ${channel} releases`);
  }
});

test('SPU stereo volumes, simultaneous voices and one-shot END flags are independent',async t=>{
  const chip=await create(t);load(chip);start(chip,{channel:0,left:0x3fff,right:0});
  let audio=render(chip,512);assert.ok(peak(audio.left)>.01);assert.equal(peak(audio.right),0);
  start(chip,{channel:23,left:0,right:0x2000});audio=render(chip,512);
  assert.ok(peak(audio.left)>.01);assert.ok(peak(audio.right)>.005);assert.ok(rms(audio.left)>rms(audio.right));
  mask(chip,REG.keyOff,0);render(chip,2048);audio=render(chip,256);assert.equal(peak(audio.left),0);assert.ok(peak(audio.right)>.005);
  chip.reset();start(chip,{left:0x3fff,right:0x4001});audio=render(chip,1024);
  assert.ok(peak(audio.left)>.01&&peak(audio.right)>.01);
  assert.ok(audio.left.reduce((sum,value,index)=>sum+value*audio.right[index],0)<0,'signed fixed-volume phase applies to only its stereo side');
  chip.reset({clearRam:true});load(chip,wave({blocks:8,loop:false}));start(chip);
  audio=render(chip,4096);assert.ok(peak(audio.left)>.01);assert.equal(peak(audio.left.subarray(2048)),0,'non-looping END reaches silence');
  assert.ok(chip.read(REG.end)&1,'voice 0 END status is observable');
});

test('filter-0 ADPCM pitch, packet order and repeated loops preserve the authored signal',async t=>{
  const chip=await create(t),bytes=wave();load(chip,bytes);start(chip);
  render(chip,256);const reference=render(chip,112*20).left;
  assert.ok(peak(reference)>.01);assert.deepEqual(reference.subarray(0,112),reference.subarray(112,224),'loop restarts at its 28-sample packet boundary');
  const oracle=Float32Array.from({length:112},(_,index)=>{
    const sample=gaussianOracle(decodedFilterZero(bytes),index+256,0);
    return fixedVolumeOracle(sample);
  });
  assert.deepEqual(reference.subarray(0,112),oracle,'filter 0 signed low-first nibbles pass through Gaussian interpolation and fixed volumes');
  // Phase-order oracle: sin begins near zero, rises positive, then negative.
  // Amplitude is intentionally not an asserted hardware calibration value.
  let rises=0;for(let i=1;i<reference.length;i++)if(reference[i-1]<=0&&reference[i]>0)rises++;
  assert.equal(rises,20,'four 28-sample packets contain exactly one authored period');
  const count=pitch=>{
    chip.reset();start(chip,{pitch});render(chip,256);const audio=render(chip,112*40).left;
    let changes=0;for(let i=1;i<audio.length;i++)if(audio[i-1]<=0&&audio[i]>0)changes++;return changes;
  };
  assert.equal(count(0x0800),20);assert.equal(count(0x1000),40);assert.equal(count(0x2000),80);
  assert.deepEqual(chip.readRam(SAMPLE_ADDRESS,bytes.length),bytes,'rendering leaves the authored sample bytes intact');
});

test('loop repeat address and uploaded sample changes invalidate SPU decode caches',async t=>{
  const chip=await create(t),unchanged=await create(t),bytes=wave({blocks:8,loopBlock:4});
  for(const sound of [chip,unchanged]){load(sound,bytes);start(sound);}
  render(chip,512);const previous=render(chip,1024).left;assert.ok(peak(previous)>.01);
  render(unchanged,1536);
  const inverted=wave({blocks:8,invert:true,loopBlock:4});chip.loadRam(inverted,SAMPLE_ADDRESS);
  assert.notDeepEqual(render(chip,1024).left,render(unchanged,1024).left,'an upload also invalidates decoded audio while its voice is playing');
  chip.reset();start(chip);render(chip,512);const changed=render(chip,1024).left;
  assert.notDeepEqual(changed,previous,'RAM upload cannot leave a stale decoded sample after retrigger');
  chip.reset();start(chip);render(chip,512);assert.deepEqual(render(chip,1024).left,changed,'same overwritten sample remains deterministic after reset');
  assert.deepEqual(chip.readRam(SAMPLE_ADDRESS,inverted.length),inverted);
  chip.reset({clearRam:true});
  const explicit=wave({blocks:8,loop:false});explicit[4*16+1]=2;explicit[7*16+1]=3;
  load(chip,explicit);start(chip,{repeat:SAMPLE_ADDRESS+4*16});render(chip,512);
  const repeated=render(chip,224).left;assert.ok(peak(repeated)>.01&&repeated.every(value=>value<=0));
  assert.deepEqual(repeated.subarray(0,112),repeated.subarray(112),'explicit repeat register selects the negative second half without an automatic loop-start flag');
  // A separate sound starts at the last physical eight-byte address unit.
  chip.reset({clearRam:true});chip.loadRam(wave({blocks:1}),RAM_BYTES-16);start(chip,{address:RAM_BYTES-16});
  assert.ok(peak(render(chip,512).left)>.01,'a valid terminal RAM packet loops without wrapping outside RAM');
});

test('SPU ADSR attack and release affect output, and KOFF leaves other voices sounding',async t=>{
  const chip=await create(t);load(chip);start(chip,{adsr1:0x400f});
  const attack=render(chip,4096).left;assert.ok(rms(attack.subarray(3072))>rms(attack.subarray(0,512)),'authored slow attack rises');
  assert.ok(chip.read(12)>0,'current envelope level is readable');
  start(chip,{channel:23});mask(chip,REG.keyOff,0);render(chip,2048);
  assert.equal(chip.read(12),0);assert.ok(chip.read(23*16+12)>0);assert.ok(peak(render(chip,256).left)>.01);
  mask(chip,REG.keyOff,23);render(chip,2048);assert.equal(peak(render(chip,128).left),0);
});

test('SPU rendering is invariant across irregular calls and internal output-ring boundaries',async t=>{
  const module=await moduleFactory(),a=await create(t,module),b=await create(t,module);
  for(const chip of [a,b]) {
    load(chip);start(chip,{channel:0,pitch:0x1234});start(chip,{channel:23,pitch:0x0813,left:0x1400,right:0x2000});
  }
  const first=render(a,32771),second=render(b,32771,[1,127,128,2047,17,2048,8193]);
  assert.deepEqual(first,second);assert.equal(a.nativeFrames,b.nativeFrames);
  for(const offset of [0x00c,0x17c,REG.end,REG.end+2])assert.equal(a.read(offset),b.read(offset));
  mask(a,REG.keyOff,0);mask(b,REG.keyOff,0);assert.deepEqual(render(a,4099),render(b,4099,[53,128,1023]));
});

test('SPU reset retains or clears sample RAM explicitly, resets timing and does not affect another instance',async t=>{
  const module=await moduleFactory(),a=await create(t,module),b=await create(t,module),bytes=wave();
  for(const chip of [a,b]){load(chip,bytes);start(chip);}
  const onset=render(a,4096);assert.deepEqual(onset,render(b,4096));
  a.reset();assert.equal(a.nativeFrames,0);assert.deepEqual(a.readRam(SAMPLE_ADDRESS,bytes.length),bytes);assert.equal(peak(render(a,128).left),0);
  assert.ok(peak(render(b,128).left)>.01);a.reset();start(a);assert.deepEqual(render(a,4096),onset);
  a.reset({clearRam:true});assert.ok(a.readRam().every(value=>value===0));assert.equal(peak(render(a,128).left),0);
  assert.ok(peak(render(b,512).left)>.01);
});

test('PS1 SPU validates complete synchronous calls before mutating RAM, timing or caller buffers',async t=>{
  const chip=await create(t),bytes=wave(),copy=bytes.slice();load(chip,bytes);assert.deepEqual(bytes,copy);
  const ram=chip.readRam(),left=new Float32Array(64).fill(123),right=new Float32Array(64).fill(456),frames=chip.nativeFrames;
  const invalid=[
    ...[-1,1,3,0x400,NaN,Infinity,2.5].flatMap(offset=>[()=>chip.write(offset,0),()=>chip.read(offset)]),
    ...[-1,65536,NaN,Infinity,.5,'1'].map(value=>()=>chip.write(4,value)),
    ()=>chip.write(0,0x8000),()=>chip.write(REG.masterLeft,0x8000),()=>chip.write(REG.ramControl,0),
    ()=>chip.write(6,0x401),()=>chip.write(14,0x401),
    ()=>chip.loadRam([1]),()=>chip.loadRam(bytes,-1),()=>chip.loadRam(bytes,RAM_BYTES-bytes.length+1),
    ()=>chip.readRam(-1,1),()=>chip.readRam(RAM_BYTES,1),()=>chip.readRam(0,RAM_BYTES+1),
    ()=>chip.readRam(0,-1),()=>chip.readRam(0,1.5),()=>chip.reset({clearRam:1}),
    ()=>chip.generateStereo(-1),()=>chip.generateStereo(MAX_FRAMES+1),()=>chip.generateStereo(NaN),
    ()=>chip.renderInto(left,right,65),()=>chip.renderInto(left,right,1,-1),()=>chip.renderInto(left,right,64,1),
    ()=>chip.renderInto(new Float64Array(64),right,32),()=>chip.renderInto(left,left,32),
  ];
  for(const operation of invalid) {
    assert.throws(operation);assert.equal(chip.nativeFrames,frames);assert.deepEqual(left,new Float32Array(64).fill(123));assert.deepEqual(right,new Float32Array(64).fill(456));
  }
  assert.deepEqual(chip.readRam(),ram);assert.deepEqual(bytes,copy);
  const owned=chip.readRam(SAMPLE_ADDRESS,bytes.length);owned.fill(255);assert.deepEqual(chip.readRam(SAMPLE_ADDRESS,bytes.length),bytes);
});

test('SPU renderInto touches only its requested region and generated PCM survives later renders and disposal',async t=>{
  const module=await moduleFactory(),a=await create(t,module),b=await create(t,module);for(const chip of [a,b]){load(chip);start(chip);}
  const left=new Float32Array(512).fill(123),right=new Float32Array(512).fill(456);a.renderInto(left,right,256,128);
  const expected=b.generateStereo(256);assert.deepEqual(left.subarray(128,384),expected.left);assert.deepEqual(right.subarray(128,384),expected.right);
  assert.ok(left.subarray(0,128).every(value=>value===123)&&left.subarray(384).every(value=>value===123));
  assert.ok(right.subarray(0,128).every(value=>value===456)&&right.subarray(384).every(value=>value===456));
  const copy={left:expected.left.slice(),right:expected.right.slice()};b.generateStereo(2048);b.dispose();b.dispose();assert.deepEqual(expected,copy);
  assert.throws(()=>b.write(0,0),/disposed/);assert.throws(()=>b.read(0),/disposed/);assert.throws(()=>b.readRam(0,1),/disposed/);
  assert.throws(()=>b.loadRam(new Uint8Array(1)),/disposed/);assert.throws(()=>b.renderInto(left,right,1),/disposed/);assert.throws(()=>b.reset(),/disposed/);
  assert.ok(peak(render(a,1024).left)>.01,'disposing one handle leaves the shared module and other handle alive');
  const malloc=module._malloc,sourcePtr=malloc(64),bytes=wave();
  module.HEAPU8.set(bytes,sourcePtr);
  const borrowed=module.HEAPU8.subarray(sourcePtr,sourcePtr+bytes.length);
  let large=0;
  // Exercise a real WASM memory growth during transfer allocation, without
  // replacing the SPU or its PCM. The caller's old heap view becomes detached.
  module._malloc=count=>{large=malloc(module.HEAPU8.byteLength+65536);return malloc(count);};
  try {
    a.loadRam(borrowed,0x4000);
    module._malloc=malloc;
    assert.equal(borrowed.byteLength,0,'transfer allocation really grew and detached WASM memory');
    assert.deepEqual(a.readRam(0x4000,bytes.length),bytes,'heap-backed upload preserves its bytes across memory growth');
  } finally {
    module._malloc=malloc;module._free(sourcePtr);if(large)module._free(large);
  }
});

test('SPU adversarial packet headers are finite and bounded without reading beyond its five predictors',async t=>{
  const chip=await create(t);
  let reference;
  for(const filter of [0,5,6,7,8,9,10,11,12,13,14,15]) {
    chip.reset({clearRam:true});load(chip,wave({filter}));start(chip);const audio=render(chip,4096,[1,127,2048]);
    if(filter===0)reference=audio;else assert.deepEqual(audio,reference,'unsupported predictors safely use filter 0');
  }
  for(const filter of [1,2,3,4])for(const shift of [0,4,12,13,15]) {
    chip.reset({clearRam:true});load(chip,wave({filter,shift}));start(chip,{pitch:0x3fff});finite(render(chip,2049,[1,127,2048]));
  }
});

test('SPU pitch modulation remains bounded on a minimum 28-sample loop at maximal raw pitch',async t=>{
  const module=await moduleFactory(),a=await create(t,module),b=await create(t,module);
  for(const chip of [a,b]) {
    const bytes=new Uint8Array(16).fill(0x77);bytes[0]=0;bytes[1]=7;chip.loadRam(bytes,0x1000);
    setup(chip,{channel:0,address:0x1000,pitch:0x1000,adsr2:0x1fd0});
    setup(chip,{channel:1,address:0x1000,pitch:chip===a?0xffff:0x3fff,adsr2:0x1fd0});
    chip.write(0x190,2);chip.write(REG.keyOn,3);
  }
  assert.equal(a.read(0x14),0xffff);assert.equal(b.read(0x14),0x3fff,'raw pitch readback remains latched while effective pitch is 14-bit');
  const actual=render(a,20000),chunked=render(b,20000,[1,127,2047,53]);
  assert.deepEqual(actual,chunked);assert.equal(a.nativeFrames,20000);assert.equal(b.nativeFrames,20000);
  assert.ok(peak(actual.left)>0,'the pathological minimum loop still produces finite sound');
});

test('SPU voice 0 safely ignores its unsupported pitch-modulation bit',async t=>{
  const module=await moduleFactory(),a=await create(t,module),b=await create(t,module);
  for(const chip of [a,b]){load(chip);start(chip);}
  a.write(0x190,1);assert.equal(a.read(0x190),1,'raw PMON bit 0 remains observable');
  assert.deepEqual(render(a,8193,[1,127,2048]),render(b,8193),'voice 0 has no preceding modulation voice');
});

test('SPU zero pitch holds a fractional final-packet sample without reading past its decoder cache',async t=>{
  const chip=await create(t);load(chip,wave({blocks:2}));start(chip,{pitch:0x1001});render(chip,55);
  chip.write(4,0);const held=render(chip,4097,[1,127,2048]).left;
  // Current source frame 55 plus history 52..54; phase bits 4..11 are held.
  const interpolated=gaussianOracle(decodedFilterZero(wave({blocks:2})),55,55);
  const expected=fixedVolumeOracle(interpolated);
  assert.ok(held.every(value=>value===expected),'fractional loop-end Gaussian interpolation holds current sample and history');
});

const root=fileURLToPath(new URL('../',import.meta.url));
const u32=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
function stereoBytes(audio) {
  const bytes=Buffer.alloc(audio.left.length*8);
  for(let frame=0;frame<audio.left.length;frame++){bytes.writeFloatLE(audio.left[frame],frame*8);bytes.writeFloatLE(audio.right[frame],frame*8+4);}
  return bytes;
}
async function nativeReference(t) {
  const compiler=process.env.CXX||'c++',probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  if(probe.error?.code==='ENOENT'){t.skip('C++ compiler unavailable; independent native PS1 SPU comparison not run');return null;}
  assert.equal(probe.status,0,probe.stderr||probe.error?.message);
  const temp=await mkdtemp(join(tmpdir(),'tetorica-ps1-spu-test-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const directory=join(root,'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu'),binary=join(temp,'reference');
  const sources=['ps1_spu.cpp','spu.cpp','spu_tables.cpp','spureverb.cpp'].map(name=>join(directory,name));
  const build=spawnSync(compiler,['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+directory,
    join(root,'test/helpers/ps1_spu_reference.cpp'),...sources,'-o',binary],{encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(build.status,0,build.stderr||build.error?.message);
  const selftest=spawnSync(binary,['--selftest'],{encoding:'utf8'});assert.equal(selftest.status,0,selftest.stderr||selftest.error?.message);
  return binary;
}

test('actual native and WASM PS1 SPU produce exactly the same original ADPCM stereo, registers and RAM',async t=>{
  const binary=await nativeReference(t);if(!binary)return;
  const chip=await create(t),commands=[],expected=[];
  const recorded={
    write(offset,value){commands.push(Buffer.concat([u32(1),u32(offset),u32(value)]));chip.write(offset,value);},
    read(offset){commands.push(Buffer.concat([u32(2),u32(offset)]));const value=chip.read(offset);expected.push(u32(value));return value;},
    reset(options={}){commands.push(Buffer.concat([u32(0),u32(Number(options.clearRam??false))]));chip.reset(options);},
    loadRam(bytes,address=0){commands.push(Buffer.concat([u32(3),u32(address),u32(bytes.length),bytes]));chip.loadRam(bytes,address);},
    readRam(address=0,length=RAM_BYTES){commands.push(Buffer.concat([u32(4),u32(address),u32(length)]));const bytes=chip.readRam(address,length);expected.push(bytes);return bytes;},
    renderInto(left,right,frames,offset=0){
      commands.push(Buffer.concat([u32(5),u32(frames)]));chip.renderInto(left,right,frames,offset);
      expected.push(stereoBytes({left:left.subarray(offset,offset+frames),right:right.subarray(offset,offset+frames)}));
    },
  };
  for(const looping of [false,true])for(const filter of [0,1,2,3,4,15]) {
    recorded.reset({clearRam:true});load(recorded,wave({blocks:8,loop:looping,filter}));
    for(let channel=0;channel<24;channel++)start(recorded,{channel,pitch:channel&1?0x1234:0x0813,left:0x180,right:0x140});
    render(recorded,10037,[1,127,2048,53,4097]);
    for(const offset of [0x00c,0x00e,0x17c,0x17e,REG.end,REG.end+2,0x1ae,0x200,0x25e,0x3fe])recorded.read(offset);
    recorded.readRam(0,0x1000);recorded.readRam(SAMPLE_ADDRESS,128);
    if(looping) {
      recorded.loadRam(wave({blocks:8,loop:true,filter,invert:true}),SAMPLE_ADDRESS);render(recorded,4099,[1,128,2047]);
      for(let channel=0;channel<24;channel++)mask(recorded,REG.keyOff,channel);
      render(recorded,8193,[127,2048]);
    }
    recorded.reset();recorded.readRam(SAMPLE_ADDRESS,128);assert.equal(peak(render(recorded,257).left),0);
  }
  recorded.reset({clearRam:true});
  const shortLoop=new Uint8Array(16).fill(0x77);shortLoop[0]=0;shortLoop[1]=7;recorded.loadRam(shortLoop,0x1000);
  setup(recorded,{channel:0,address:0x1000,pitch:0x1000,adsr2:0x1fd0});setup(recorded,{channel:1,address:0x1000,pitch:0xffff,adsr2:0x1fd0});
  recorded.write(0x190,2);recorded.write(REG.keyOn,3);render(recorded,20000,[1,127,2047,53]);recorded.read(0x1ae);
  recorded.reset({clearRam:true});load(recorded);start(recorded);recorded.write(0x190,1);render(recorded,8193,[1,127,2048]);
  recorded.reset({clearRam:true});load(recorded,wave({blocks:2}));start(recorded,{pitch:0x1001});render(recorded,55);
  recorded.write(4,0);render(recorded,4097,[1,127,2048]);
  const result=spawnSync(binary,[],{input:Buffer.concat([u32(commands.length),...commands]),maxBuffer:32*1024*1024});
  assert.equal(result.status,0,result.stderr?.toString()||result.error?.message);
  assert.deepEqual(result.stdout,Buffer.concat(expected),'independently compiled native and shipped WASM match bit-for-bit after decode/interpolation, ADSR, mixing, cache uploads, END/KOFF and resets');
});
