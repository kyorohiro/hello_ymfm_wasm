// SPDX-License-Identifier: BSD-3-Clause
// Formal checkpoint/legacy PCM parity in compiled WASM; no browser/audio.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const [directory='build/huc-state-wasm',nativeFixture,baseline='dist/wasm']=process.argv.slice(2);
const temporary=await mkdtemp(path.join(tmpdir(),'tetorica-huc-state-'));
async function load(dir,name){const loader=path.join(temporary,name+'.mjs');await writeFile(loader,await readFile(path.join(dir,'huc6280_wasm.js')));
  const{default:create}=await import(pathToFileURL(loader));return create({wasmBinary:await readFile(path.join(dir,'huc6280_wasm.wasm'))});}
function host(module){const handles=new Set(),ptr=module._malloc(4096*8),state=module._malloc(512);
  const api={module,ptr,state,create(clock=3579545,rate=44100){const h=module._huc6280_create(clock,rate);assert(h>0);handles.add(h);return h;},
    write:(h,r,v)=>module._huc6280_write(h,r,v),mute:(h,ch,on)=>module._huc6280_mute(h,ch,on?1:0),
    render(h,frames){assert(frames<=4096);module._huc6280_generate(h,ptr,ptr+4096*4,frames);const left=module.HEAPF32.slice(ptr/4,ptr/4+frames),right=module.HEAPF32.slice(ptr/4+4096,ptr/4+4096+frames);assert(left.every(Number.isFinite));assert(right.every(Number.isFinite));return{left,right};},
    save(h){assert.equal(module._huc6280_state_size(h),512);assert.equal(module._huc6280_save_state(h,state,512),1);return module.HEAPU8.slice(state,state+512);},
    validate(h,bytes){module.HEAPU8.set(bytes,state);return module._huc6280_validate_state(h,state,bytes.length);},
    restore(h,bytes){module.HEAPU8.set(bytes,state);return module._huc6280_load_state(h,state,bytes.length);},
    close(){for(const h of handles)module._huc6280_destroy(h);module._free(ptr);module._free(state);}};return api;}
function program(api,h,mode=0){const w=(r,v)=>api.write(h,r,v);w(1,0xed);w(9,0);
  for(let ch=0;ch<8;ch++){w(0,ch);w(4,64);w(4,0);for(let i=0;i<32;i++)w(6,(i*(ch+1)+ch*3)&31);w(2,113+ch*29);w(3,ch&3);w(5,0xf9);w(4,159-ch);}
  if(mode===1||mode===3)for(let ch=4;ch<6;ch++){w(0,ch);w(7,0x87+ch);}
  if(mode===2||mode===3){w(8,7);w(9,3);}
  if(mode===3){w(0,3);w(4,223);w(6,29);api.mute(h,1,true);api.mute(h,5,true);}w(0,7);
}
function pcmBytes(pcm){const bytes=new Uint8Array(pcm.left.length*8),view=new DataView(bytes.buffer);for(let i=0;i<pcm.left.length;i++){view.setFloat32(i*8,pcm.left[i],true);view.setFloat32(i*8+4,pcm.right[i],true);}return bytes;}
let current,legacy;
try{
  const module=await load(directory,'current');current=host(module);
  for(const name of['state_size','save_state','validate_state','load_state'])assert.equal(typeof module['_huc6280_'+name],'function');
  assert.equal(module._huc6280_state_size(0),0);
  for(const clock of[100000,3579545,7159090])for(const rate of[8000,44100,48000,96000,384000])for(let mode=0;mode<4;mode++){
    const a=current.create(clock,rate),b=current.create(clock,rate),ref=current.create(clock,rate);program(current,a,mode);program(current,ref,mode);
    assert.deepEqual(current.render(a,137),current.render(ref,137));const bytes=current.save(a);assert.equal(bytes[48],7);
    for(let i=0;i<4;i++)assert.equal(current.validate(a,bytes),1);assert.equal(current.restore(b,bytes),1);assert.deepEqual(current.save(b),bytes);
    module.HEAPU8.fill(0,current.state,current.state+512);assert.deepEqual(current.render(b,2057),current.render(ref,2057),'load owns all saved values');
    const expected=current.render(a,4096);current.write(a,4,0);current.render(a,17);assert.equal(current.restore(a,bytes),1);assert.deepEqual(current.render(a,4096),expected,'exact own-instance restoration');
  }
  const h=current.create();program(current,h,3);current.render(h,137);const good=current.save(h);
  assert.equal(new TextDecoder().decode(good.subarray(0,8)),'HUCSAVE1');assert.equal(good[53],34);
  const corrupt=[];
  for(const offset of[0,8,12,16,24,28,49,54]){const bytes=good.slice();bytes[offset]^=1;corrupt.push(bytes);}
  for(const[offset,value]of[[32,44100],[40,0x7fc00000],[44,0x7f800000],[64,4096],[104,0xffffffff],[104,1985],[108,1],[112,0x40000],[116,0xfffffeff],[116,4337],[172,1044481],[228,0xffffffff],[64+4*56+48,0]]){
    const bytes=good.slice();new DataView(bytes.buffer).setUint32(offset,value,true);corrupt.push(bytes);
  }
  for(const[offset,value]of[[48,8],[53,64],[68,32],[100,32],[102,32],[103,255]]){const bytes=good.slice();bytes[offset]=value;corrupt.push(bytes);}
  for(const bytes of corrupt){assert.equal(current.validate(h,bytes),0);assert.equal(current.restore(h,bytes),0);assert.deepEqual(current.save(h),good,'invalid state never mutates any saved byte');}
  for(const size of[0,511,513]){assert.equal(module._huc6280_save_state(h,current.state,size),0);assert.equal(module._huc6280_validate_state(h,current.state,size),0);assert.equal(module._huc6280_load_state(h,current.state,size),0);}
  for(const pointer of[0,-1,module.HEAPU8.length-256,h,h+1]){assert.equal(module._huc6280_save_state(h,pointer,512),0);assert.equal(module._huc6280_validate_state(h,pointer,512),0);assert.equal(module._huc6280_load_state(h,pointer,512),0);}
  assert.deepEqual(current.save(h),good);assert.equal(module._huc6280_load_state(0,current.state,512),0);
  for(const[clock,rate]of[[3579546,44100],[3579545,48000]]){const other=current.create(clock,rate),before=current.save(other);assert.equal(current.restore(other,good),0);assert.deepEqual(current.save(other),before);}
  legacy=host(await load(baseline,'legacy'));
  for(const clock of[100000,3579545])for(const rate of[44100,48000])for(let mode=0;mode<4;mode++){
    const a=current.create(clock,rate),b=legacy.create(clock,rate);program(current,a,mode);program(legacy,b,mode);
    for(const frames of[1,137,4096])assert.deepEqual(current.render(a,frames),legacy.render(b,frames),'existing generate ABI/golden PCM remains unchanged');
  }
  if(nativeFixture){
    const statePath=path.join(temporary,'native.state'),pcmPath=path.join(temporary,'native.pcm');
    const run=spawnSync(nativeFixture,['--export',statePath,pcmPath],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
    const nativeState=new Uint8Array(await readFile(statePath)),a=current.create();program(current,a,3);current.render(a,137);assert.deepEqual(current.save(a),nativeState,'Native and WASM encode identical state bytes');
    const b=current.create();assert.equal(current.restore(b,nativeState),1);assert.deepEqual(pcmBytes(current.render(b,4096)),new Uint8Array(await readFile(pcmPath)),'Native state restores exact WASM continuation');
    const wasmPath=path.join(temporary,'wasm.state'),importedPath=path.join(temporary,'imported.pcm');await writeFile(wasmPath,current.save(a));
    const imported=spawnSync(nativeFixture,['--import',wasmPath,importedPath],{encoding:'utf8'});assert.equal(imported.status,0,imported.stderr);
    assert.deepEqual(new Uint8Array(await readFile(importedPath)),pcmBytes(current.render(a,4096)),'WASM state restores exact Native continuation');
  }
  process.stdout.write(JSON.stringify({ok:true,stateBytes:512,version:1,checks:['explicit-LE-format','matching-instance-transfer','Wave-Noise-DDA-LFO-mutes-resampler-continuation','strict-nonmutating-validation','null-size-overlap-WASM-range-guards','legacy-golden-PCM',...(nativeFixture?['Native-WASM-state-and-PCM-portability']:[])]})+'\n');
}finally{current?.close();legacy?.close();await rm(temporary,{recursive:true,force:true});}
