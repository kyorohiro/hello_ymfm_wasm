// SPDX-License-Identifier: BSD-3-Clause
// Actual standalone POKEY C ABI, including two handles in one WASM instance.
// No npm, parent checkout, browser, game asset or audio device is used.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

assert(process.argv.length<=3,'Usage: node tests/pokey_wasm_smoke.mjs [wasm-directory]');
const directory=path.resolve(process.argv[2]??'wasm');
const loader=await readFile(path.join(directory,'pokey_wasm.js'));
const wasmBinary=await readFile(path.join(directory,'pokey_wasm.wasm'));
const temporary=await mkdtemp(path.join(tmpdir(),'tetorica-pokey-wasm-smoke-'));
let module;
try{
  const filename=path.join(temporary,'loader.mjs');await writeFile(filename,loader);
  const {default:create}=await import(pathToFileURL(filename));module=await create({wasmBinary});
}finally{await rm(temporary,{recursive:true,force:true});}
for(const name of ['create','destroy','reset','write','read','mute','generate'])
  assert.equal(typeof module['_pokey_'+name],'function','Export '+name);
const capacity=8192,left=module._malloc(capacity*4),right=module._malloc(capacity*4);
assert(left>0&&right>0,'Allocate bounded PCM buffers');
const handles=new Set(),checks=[];
let renderedFrames=0;
const create=(clock=1789790,rate=44100)=>{
  const chip=module._pokey_create(clock,rate);assert(chip>0,'Create valid core');handles.add(chip);return chip;
};
const destroy=chip=>{module._pokey_destroy(chip);handles.delete(chip);};
const reset=chip=>module._pokey_reset(chip);
const write=(chip,address,value)=>module._pokey_write(chip,address,value);
const read=(chip,address)=>module._pokey_read(chip,address);
const mute=(chip,channel,enabled)=>module._pokey_mute(chip,channel,Number(enabled));
const generate=(chip,frames)=>{
  assert(Number.isInteger(frames)&&frames>=0&&frames<=capacity,'Bound frame count before C ABI');
  assert.equal(module._pokey_generate(chip,left,right,frames),undefined);
  const pcm={left:Float32Array.from(module.HEAPF32.subarray(left/4,left/4+frames)),
    right:Float32Array.from(module.HEAPF32.subarray(right/4,right/4+frames))};
  assert(pcm.left.every(value=>Number.isFinite(value)&&value>=0&&value<=4),'Finite bounded positive raw PCM');
  assert.deepEqual(pcm.right,pcm.left,'One physical POKEY is mono');
  renderedFrames+=frames;return pcm;
};
const silent=pcm=>pcm.left.every(value=>value===0);
const varying=pcm=>Math.max(...pcm.left)-Math.min(...pcm.left)>.001;
const configure=(chip,seed=0)=>{
  write(chip,15,3);write(chip,8,0);
  for(let channel=0;channel<4;channel++){
    write(chip,channel*2,(23+channel*31+seed*7)&255);
    write(chip,channel*2+1,(channel&1?0x80:0xa0)|(5+channel));
  }
  write(chip,9,0);
};
const state=chip=>Uint8Array.from({length:16},(_,address)=>read(chip,address));

try{
  for(const [clock,rate] of [[0,44100],[1789790,0]])
    assert.equal(module._pokey_create(clock,rate),0,'Invalid C ABI configuration rejected');
  assert.equal(read(0,10),0);write(0,0,255);mute(0,0,true);reset(0);module._pokey_destroy(0);
  assert.equal(module._pokey_generate(0,left,right,1),undefined);
  checks.push('C-ABI-exports-null-and-configuration-guards');

  const basic=create();assert(silent(generate(basic,257)),'Cold core is silent');
  configure(basic);assert(varying(generate(basic,4093)),'Four-channel sound is audible');
  write(basic,0,0x12);assert.notEqual(read(basic,0),0x12,'Read I/O is not AUDF register shadow');
  const random=read(basic,10);
  for(let i=0;i<32;i++)assert.equal(read(basic,10),random,'Synchronous repeated read does not advance sound time');
  reset(basic);assert(silent(generate(basic,257)),'Reset clears active sound');destroy(basic);
  checks.push('real-read-register-space-and-cold-reset');

  // Every physical channel must be audible on its own. AUDC=$Ax selects the
  // pure-tone path; no invented stereo or fifth-through-eighth channel exists.
  for(let channel=0;channel<4;channel++){
    const chip=create(1789790,48000);
    write(chip,15,3);write(chip,channel*2,37+channel*41);write(chip,channel*2+1,0xaf);write(chip,9,0);
    assert(varying(generate(chip,4093)),'Physical CH'+(channel+1)+' audible');destroy(chip);
  }
  checks.push('four-independent-physical-audio-channels');

  const render=(clock,rate,mode,blocks)=>{
    const chip=create(clock,rate),frames=8191,pcm={left:new Float32Array(frames),right:new Float32Array(frames)};
    try{
      configure(chip,mode&3);write(chip,8,mode);write(chip,9,0);
      let at=0,block=0;
      while(at<frames){const count=Math.min(blocks[block++%blocks.length],frames-at),part=generate(chip,count);
        pcm.left.set(part.left,at);pcm.right.set(part.right,at);at+=count;}
      return {...pcm,reads:state(chip)};
    }finally{destroy(chip);}
  };
  for(const rate of [44100,48000,96000])for(const clock of [1789790,1789773,1773447])
    for(const mode of [0,0x80,0x40,0x20,0x10,8,4,2,1,255]){
      assert.deepEqual(render(clock,rate,mode,[capacity]),render(clock,rate,mode,[1,7,128,509,3]),
        'Exact PCM/read continuation for clock '+clock+', rate '+rate+', AUDCTL '+mode);
    }
  checks.push('exact-render-partition-invariance-at-three-clocks-and-rates');

  // Two handles share this module's heap, while register/counter/polynomial and
  // rate-conversion state belong to the selected handle only.
  let a=create(1789790,48000);
  const b=create(1773447,48000),ar=create(1789790,48000),br=create(1773447,48000);
  configure(a,1);configure(ar,1);configure(b,7);configure(br,7);
  for(let block=0;block<37;block++){
    const count=1+block*13%251,channel=block%4,divisor=(19+block*7)&255;
    write(a,channel*2,divisor);write(ar,channel*2,divisor);
    assert.deepEqual(generate(a,count),generate(ar,count),'A interleaved continuation');
    const distortion=((block&7)<<5)|(3+block%12);
    write(b,channel*2+1,distortion);write(br,channel*2+1,distortion);
    assert.deepEqual(generate(b,count+9),generate(br,count+9),'B clock/noise interleaved continuation');
  }
  for(let operation=0;operation<4;operation++){
    if(operation===0)for(let channel=0;channel<4;channel++)mute(a,channel,true);
    if(operation===1)reset(a);
    if(operation===2){destroy(a);a=0;}
    if(operation===3)a=create(1000000,96000);
    if(a){configure(a,operation);generate(a,731+operation);}
    assert.deepEqual(generate(b,1021),generate(br,1021),'A mute/reset/destroy/recreate does not affect B');
    assert.deepEqual(state(b),state(br),'B read I/O survives A lifecycle');
  }
  checks.push('dual-POKEY-interleaving-isolation-distinct-clock-and-lifetime');
  console.log(JSON.stringify({passed:true,artifact:'pokey',renderedFrames,checks,
    outputPolicy:'one raw positive mono chip per handle, duplicated left/right, /32768; dual routing belongs to host'}));
}finally{
  for(const chip of handles)module._pokey_destroy(chip);module._free(left);module._free(right);
}
