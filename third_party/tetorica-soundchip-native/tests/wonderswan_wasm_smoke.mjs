// Standalone WonderSwan raw C ABI smoke. Reads only the supplied WASM release;
// no npm packages, parent checkout, browser, audio device or private receipt.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

assert(process.argv.length<=3,'Usage: node tests/wonderswan_wasm_smoke.mjs [wasm-directory]');
const directory=path.resolve(process.argv[2]??'wasm');
const loader=await readFile(path.join(directory,'wonderswan_wasm.js'));
const wasmBinary=await readFile(path.join(directory,'wonderswan_wasm.wasm'));
// Preserve the loader bytes. Emscripten needs a file: import.meta.url on Node;
// .mjs avoids requiring package.json type metadata in a consumer's directory.
const temporary=await mkdtemp(path.join(tmpdir(),'tetorica-wonderswan-wasm-smoke-'));
let module;
try{
  const filename=path.join(temporary,'loader.mjs');
  await writeFile(filename,loader);
  const {default:create}=await import(pathToFileURL(filename));
  module=await create({wasmBinary});
}finally{await rm(temporary,{recursive:true,force:true});}

for(const name of ['create','destroy','reset','write','read','write_memory','read_memory','mute','generate'])
  assert.equal(typeof module['_wonderswan_'+name],'function','Export '+name);
const capacity=4096,left=module._malloc(capacity*4),right=module._malloc(capacity*4);
assert(left>0&&right>0,'Allocate bounded output buffers');
const handles=new Set(),checks=[];
let renderedFrames=0;
const create=(clock=3072000,rate=24000)=>{
  const chip=module._wonderswan_create(clock,rate);
  assert(chip>0,'Create valid core');handles.add(chip);return chip;
};
const destroy=chip=>{module._wonderswan_destroy(chip);handles.delete(chip);};
const reset=chip=>module._wonderswan_reset(chip);
const write=(chip,address,value)=>module._wonderswan_write(chip,address,value);
const read=(chip,address)=>module._wonderswan_read(chip,address);
const memory=(chip,address,value)=>module._wonderswan_write_memory(chip,address,value);
const readMemory=(chip,address)=>module._wonderswan_read_memory(chip,address);
const mute=(chip,channel,enabled)=>module._wonderswan_mute(chip,channel,Number(enabled));
const generate=(chip,frames)=>{
  assert(Number.isInteger(frames)&&frames>=0&&frames<=capacity,'Bound render length before C ABI call');
  assert.equal(module._wonderswan_generate(chip,left,right,frames),undefined);
  const pcm={left:Float32Array.from(module.HEAPF32.subarray(left/4,left/4+frames)),
    right:Float32Array.from(module.HEAPF32.subarray(right/4,right/4+frames))};
  for(const side of Object.values(pcm))assert(side.every(value=>Number.isFinite(value)&&value>=0&&value<=1),'Finite bounded unipolar raw PCM');
  renderedFrames+=frames;return pcm;
};
const silent=pcm=>Object.values(pcm).every(side=>side.every(value=>value===0));
const exact=(actual,integers,label)=>assert.deepEqual(actual,Float32Array.from(integers,value=>value/1024),label);
const frequency=(chip,channel,value)=>{
  write(chip,0x80+channel*2,value&255);write(chip,0x81+channel*2,value>>8);
};
const waveform=(chip,channel,samples,bank=0)=>{
  assert.equal(samples.length,32);write(chip,0x8f,bank);
  for(let i=0;i<16;i++)memory(chip,bank*64+channel*16+i,samples[i*2]|samples[i*2+1]<<4);
};
const voice=(chip,channel,{samples=Array(32).fill(15),pitch=1920,pan=0xff,bank=0}={})=>{
  waveform(chip,channel,samples,bank);frequency(chip,channel,pitch);
  write(chip,0x88+channel,pan);write(chip,0x91,8);
};
const state=chip=>({registers:Uint8Array.from({length:32},(_,i)=>read(chip,0x80+i)),
  memory:Uint8Array.from({length:16384},(_,i)=>readMemory(chip,i))});

try{
  for(const [clock,rate] of [[0,24000],[127,24000],[100000001,24000],[3072000,7999],[3072000,384001]])
    assert.equal(module._wonderswan_create(clock,rate),0,'Invalid C ABI configuration rejected');
  for(const [clock,rate] of [[128,8000],[100000000,384000]]){const chip=create(clock,rate);assert(silent(generate(chip,17)));destroy(chip);}
  assert.equal(read(0,0x80),0);assert.equal(readMemory(0,0),0);
  write(0,0x90,15);memory(0,0,255);mute(0,0,true);reset(0);
  module._wonderswan_destroy(0);assert.equal(module._wonderswan_generate(0,left,right,1),undefined);
  checks.push('C-ABI-exports-null-and-configuration-guards');

  const chip=create();
  assert(silent(generate(chip,128)),'Cold core is silent');assert.equal(read(chip,0x91),0x80);
  for(let address=0;address<16384;address++)memory(chip,address,(address*37+(address>>8)*11)&255);
  for(let address=0;address<16384;address++)assert.equal(readMemory(chip,address),(address*37+(address>>8)*11)&255,'Owned 16 KiB RAM roundtrip');
  const boundary=readMemory(chip,16383);memory(chip,16384,123);memory(chip,0xffffffff,123);
  assert.equal(readMemory(chip,16384),0);assert.equal(readMemory(chip,0xffffffff),0);assert.equal(readMemory(chip,16383),boundary);
  write(chip,0x81,255);assert.equal(read(chip,0x81),7,'Frequency high bits are masked');
  write(chip,0x8e,255);assert.equal(read(chip,0x8e),23,'Noise reset strobe is not latched');
  write(chip,0x93,255);assert.equal(read(chip,0x93),127,'Noise read/write high bits are masked');
  write(chip,0x91,255);assert.equal(read(chip,0x91),0x8f,'Connected-headphone status bit');
  write(chip,0x9e,255);assert.equal(read(chip,0x9e),3);
  for(const address of [0x64,0x7f,0xa0,0xffffffff]){write(chip,address,255);assert.equal(read(chip,address),0,'Unsupported I/O is ignored');}
  reset(chip);assert(state(chip).memory.every(value=>value===0),'Reset clears all owned RAM');
  assert(silent(generate(chip,128)));assert.equal(read(chip,0x90),0);assert.equal(read(chip,0x91),0x80);
  checks.push('synchronous-registers-and-16384-byte-RAM-boundaries','cold-reset-clears-RAM-gates-and-output');

  // Each physical channel must read its own packed wave and independent pan.
  for(let channel=0;channel<4;channel++){
    reset(chip);const level=3+channel*3,pan=((15-channel)<<4)|(channel+1);
    voice(chip,channel,{samples:Array(32).fill(level),pan,bank:255});write(chip,0x90,1<<channel);
    const pcm=generate(chip,32);
    exact(pcm.left.subarray(2),Array(30).fill((15-channel)*level),'CH'+(channel+1)+' left gain');
    exact(pcm.right.subarray(2),Array(30).fill((channel+1)*level),'CH'+(channel+1)+' right gain');
  }
  reset(chip);
  for(let channel=0;channel<4;channel++)voice(chip,channel,{samples:Array(32).fill(15),pan:0xff});
  write(chip,0x90,15);const sum=generate(chip,32);
  exact(sum.left.subarray(2),Array(30).fill(900),'Four full-scale waves sum with original /1024 gain');
  assert.deepEqual(sum.left,sum.right,'Centered stereo');
  reset(chip);const ramp=Array.from({length:32},(_,i)=>i&15);
  voice(chip,0,{samples:ramp,pan:0xf0});write(chip,0x90,1);
  const packed=generate(chip,66);
  exact(packed.left,Array.from({length:66},(_,i)=>i<2?0:15*ramp[(i-1)%32]),'Low nibble first and previous signal before fetch');
  assert(packed.right.every(value=>value===0));
  checks.push('four-physical-waves-and-independent-stereo','raw-DAC-sum-and-packed-waveform-order');

  const noiseSignatures=new Set();
  for(let type=0;type<8;type++){
    reset(chip);voice(chip,3,{pan:0xf0});write(chip,0x8e,0x18|type);write(chip,0x90,0x88);
    const pcm=generate(chip,1024);
    assert(pcm.left.every(value=>value===0||value===225/1024),'Noise has two DAC levels');
    assert(pcm.left.some(value=>value>0)&&pcm.left.some(value=>value===0),'Noise produces transitions');
    assert(pcm.right.every(value=>value===0));
    assert.notEqual(read(chip,0x92)|(read(chip,0x93)<<8),0,'Noise LFSR advances');
    noiseSignatures.add(pcm.left.join(','));
    write(chip,0x8e,0x18|type);assert.equal(read(chip,0x92)|(read(chip,0x93)<<8),0,'Noise reset strobe clears shift state');
  }
  assert.equal(noiseSignatures.size,8,'All eight noise tap selections produce distinct output');
  checks.push('eight-noise-types-stereo-levels-and-LFSR-reset');

  for(const [initial,step,expected] of [[2047,1,0],[0,255,2047]])for(const speed of [0,31]){
    reset(chip);voice(chip,2,{pitch:initial});write(chip,0x8c,step);write(chip,0x8d,speed);write(chip,0x90,0x44);
    const interval=64*(speed+1);generate(chip,interval-1);
    assert.equal(read(chip,0x84)|(read(chip,0x85)<<8),initial,'Sweep waits for configured interval');
    generate(chip,1);assert.equal(read(chip,0x84)|(read(chip,0x85)<<8),expected,'Signed sweep wraps 11-bit frequency');
  }
  checks.push('channel-3-positive-negative-sweep-timing-and-wrap');

  reset(chip);write(chip,0x91,8);write(chip,0x90,0x22);write(chip,0x89,255);
  for(const [routing,l,r] of [[15,255,255],[5,127,127],[8,255,0],[2,0,255],[0,0,0]]){
    write(chip,0x94,routing);const pcm=generate(chip,3);
    exact(pcm.left,Array(3).fill(l),'Direct voice left route '+routing);
    exact(pcm.right,Array(3).fill(r),'Direct voice right route '+routing);
  }
  write(chip,0x94,15);write(chip,0x89,64);
  exact(generate(chip,3).left,[64,64,64],'Live unsigned voice-byte update');
  write(chip,0x90,0x20);assert(silent(generate(chip,3)),'Retained core requires physical CH2 gate for PCM');
  checks.push('channel-2-direct-voice-PCM-byte-half-full-and-pan');
  destroy(chip);

  const muted=create(3072000,48000),audible=create(3072000,48000);
  for(const target of [muted,audible]){voice(target,0,{samples:ramp,pitch:1830});write(target,0x90,1);generate(target,53);}
  mute(muted,0,true);assert(silent(generate(muted,733)),'Mute immediately suppresses held and new PCM');
  generate(audible,733);mute(muted,0,false);
  assert.deepEqual(generate(muted,433),generate(audible,433),'Muted channel phase continues advancing');
  destroy(muted);destroy(audible);checks.push('host-mute-silence-and-phase-continuation');

  const events=[
    [257,'write',0x8e,0x17],[509,'write',0x84,160],[997,'memory',16383,0x37],
    [1501,'write',0x90,0xef],[1501,'write',0x89,225],[1703,'write',0x94,5],
    [2201,'mute',0,1],[2401,'write',0x90,0xcf],[2803,'mute',0,0],
    [3001,'write',0x8f,0],[3503,'write',0x91,0],[3701,'write',0x91,8],
  ];
  const render=(clock,rate,layout)=>{
    const target=create(clock,rate),frames=4093,pcm={left:new Float32Array(frames),right:new Float32Array(frames)};
    try{
      for(let channel=0;channel<4;channel++)voice(target,channel,{samples:channel&1?ramp:ramp.toReversed(),pitch:1701+channel*67,pan:0x96+channel*0x11,bank:255});
      write(target,0x8c,1);write(target,0x8d,0);write(target,0x8e,0x18);write(target,0x90,0xcf);write(target,0x94,15);
      let position=0,next=0,block=0;
      while(position<frames){
        while(next<events.length&&events[next][0]===position){
          const [,kind,a,b]=events[next++];
          if(kind==='write')write(target,a,b);else if(kind==='memory')memory(target,a,b);else mute(target,a,b);
        }
        const count=Math.min(layout[block++%layout.length],frames-position,(events[next]?.[0]??frames)-position);
        assert(count>0);const part=generate(target,count);
        pcm.left.set(part.left,position);pcm.right.set(part.right,position);position+=count;
      }
      assert.equal(next,events.length);return {...pcm,...state(target)};
    }finally{destroy(target);}
  };
  for(const rate of [44100,48000,96000]){
    const whole=render(3072000,rate,[capacity]);
    assert.deepEqual(render(3072000,rate,[1,7,128,257]),whole,'Exact bounded partition PCM and terminal state at '+rate+' Hz');
    assert.deepEqual(render(3072001,rate,[31,509]),whole,'Integer clock/128 cadence at '+rate+' Hz');
  }
  checks.push('bounded-partition-exact-stereo-register-and-RAM-continuation','integer-clock-cadence-at-44100-48000-96000-Hz');
  console.log(JSON.stringify({passed:true,artifact:'wonderswan',renderedFrames,checks,
    outputPolicy:'raw unipolar headphone PCM, original /1024 gain; no speaker adapter'}));
}finally{
  for(const chip of handles)module._wonderswan_destroy(chip);
  module._free(left);module._free(right);
}
