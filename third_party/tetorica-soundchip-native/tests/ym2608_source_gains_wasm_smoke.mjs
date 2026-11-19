// SPDX-License-Identifier: BSD-3-Clause
// Four-source host gains: actual WASM, no audio device, no register-volume edits.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const options={};
for(let index=2;index<process.argv.length;index++){
  const name=process.argv[index];assert(['--wasm-dir','--legacy-dir','--out'].includes(name),'Unknown '+name);
  const value=process.argv[++index];assert(value&&!value.startsWith('--'));options[name]=resolve(value);
}
assert(options['--wasm-dir'],'Use --wasm-dir with a compiled YM2608');
const names=['fm','ssg','rhythm','adpcm'],TRAILER=56;
async function backend(directory){const {default:factory}=await import(pathToFileURL(resolve(directory,'ym2608_wasm.js')));return factory({wasmBinary:await readFile(resolve(directory,'ym2608_wasm.wasm'))});}
const module=await backend(options['--wasm-dir']),legacy=options['--legacy-dir']?await backend(options['--legacy-dir']):null;
function instance(m){
  const handle=m._ym2608_create();assert(handle);let left=0,right=0,capacity=0;
  const write=(register,value,port=0)=>{m._ym2608_write(handle,port*2,register);m._ym2608_write(handle,port*2+1,value);};
  const upload=(kind,bytes,address=0)=>{const pointer=m._malloc(bytes.length);try{m.HEAPU8.set(bytes,pointer);m[kind](handle,address,pointer,bytes.length);}finally{m._free(pointer);}};
  const render=frames=>{if(frames>capacity){if(left)m._free(left);if(right)m._free(right);left=m._malloc(frames*4);right=m._malloc(frames*4);capacity=frames;}m._ym2608_generate(handle,left,right,frames);return [new Float32Array(m.HEAPF32.buffer,left,frames).slice(),new Float32Array(m.HEAPF32.buffer,right,frames).slice()];};
  const save=()=>{const size=m._ym2608_save_state(handle,0),pointer=m._malloc(size);try{assert.equal(m._ym2608_save_state(handle,pointer),size);return m.HEAPU8.slice(pointer,pointer+size);}finally{m._free(pointer);}};
  const load=bytes=>{const pointer=m._malloc(bytes.length);try{m.HEAPU8.set(bytes,pointer);return m._ym2608_load_state(handle,pointer,bytes.length);}finally{m._free(pointer);}};
  const set=values=>m._ym2608_set_source_gains(handle,...values);
  const status=()=>[m._ym2608_read_status(handle),m._ym2608_read_status_hi(handle),m._ym2608_get_irq(handle)];
  return {m,handle,write,upload,render,save,load,set,status,dispose(){if(left)m._free(left);if(right)m._free(right);m._ym2608_destroy(handle);}};
}
function configure(f,{loud=false,enabled=15}={}){
  const w=f.write;w(0x29,0x9f);
  if(enabled&1)for(let ch=0;ch<6;ch++){
    const port=ch>=3?1:0,local=ch%3;
    for(const slot of [0,4,8,12]){w(0x30+local+slot,1,port);w(0x40+local+slot,slot===12?(loud?0:48):127,port);w(0x50+local+slot,31,port);w(0x60+local+slot,0,port);w(0x70+local+slot,0,port);w(0x80+local+slot,15,port);}
    w(0xb0+local,7,port);w(0xb4+local,0xc0,port);w(0xa4+local,0x20+(ch%4)*8,port);w(0xa0+local,120+ch*17,port);w(0x28,0x80+(ch>=3?4:0)+local);
  }
  if(enabled&2){w(0,119);w(1,0);w(7,0x3e);w(8,loud?15:8);}
  if(enabled&4){f.upload('_ym2608_load_adpcm_a_rom',Uint8Array.from({length:8192},(_,i)=>i%16<8?0x77:0xff));w(0x11,loud?0:24);for(let ch=0;ch<6;ch++)w(0x18+ch,0xc0|(loud?0:16));w(0x10,0x3f);}
  if(enabled&8){f.upload('_ym2608_load_adpcm_b_memory',Uint8Array.from({length:64},(_,i)=>i<32?0x77:0xff));for(const [r,v]of[[1,0xc2],[2,0],[3,0],[4,1],[5,0],[9,80],[10,154],[11,loud?255:64],[0,0xb0]])w(r,v,1);}
}
const peak=pcm=>pcm.reduce((max,channel)=>channel.reduce((at,v)=>Math.max(at,Math.abs(v)),max),0);
const core=bytes=>bytes.subarray(0,bytes.length-TRAILER);
const checks=[],differential=[];
let totalFrames=0;
const f=instance(module);
try{
  assert.equal(module._ym2608_set_source_gains(0,1,1,1,1),0);
  configure(f);f.render(2048);const initial=f.save();
  const at=(sources,buses=[1,1],frames=8192)=>{assert.equal(f.load(initial),1);assert.equal(f.set(sources),1);assert.equal(module._ym2608_set_output_gains(f.handle,...buses),1);return f.render(frames);};
  const stems=names.map((_,part)=>at(names.map((_,i)=>+(i===part))));
  for(let i=0;i<4;i++)assert(peak(stems[i])>1e-6,names[i]+' is audibly represented');
  for(const gains of [[1,1,1,1],[.5,.75,.25,.6],[0,0,0,0],[1.2,.5,.8,.7]]){
    const actual=at(gains),buses=[.7,.8],combined=at(gains,buses);
    for(let ch=0;ch<2;ch++)for(let i=0;i<actual[ch].length;i++){
      const summed=stems.reduce((value,part,index)=>value+part[ch][i]*gains[index],0);
      assert(Math.abs(actual[ch][i]-summed)<3e-7,'source gain adds only its own unmodified waveform');
      const expected=stems.reduce((value,part,index)=>value+part[ch][i]*gains[index]*buses[index===1?1:0],0);
      assert(Math.abs(combined[ch][i]-expected)<3e-7,'legacy two-bus gains retain their original meaning');
    }
  }
  checks.push('four-independent-sources-and-legacy-bus-composition');
  for(let part=0;part<4;part++){
    const isolated=instance(module);try{configure(isolated,{enabled:1<<part});isolated.render(2048);const state=isolated.save();const renderAt=g=>{assert.equal(isolated.load(state),1);assert.equal(isolated.set(g),1);return isolated.render(4096);};
      const only=renderAt([1,1,1,1]),foreign=renderAt(names.map((_,i)=>i===part?1:.1));assert.deepEqual(foreign,only,names[part]+' ignores foreign faders');
      assert.equal(peak(renderAt(names.map((_,i)=>i===part?0:1))),0,names[part]+' own zero is silent');
    }finally{isolated.dispose();}
  }
  checks.push('zero-and-foreign-faders-isolate-every-hardware-section');
  assert.equal(f.load(initial),1);f.set([0,0,0,0]);f.render(8192);const muted=f.save();f.set([1,1,1,1]);const afterMuted=f.render(4096);
  assert.equal(f.load(initial),1);f.render(8192);const running=f.save();assert.deepEqual(core(muted),core(running),'zero gain continues all chip clocks and decoders');assert.deepEqual(f.render(4096),afterMuted);
  checks.push('gain-zero-does-not-freeze-source-evolution');
  assert.equal(f.load(initial),1);f.set([.3,.4,.5,.6]);module._ym2608_set_output_gains(f.handle,.7,.8);const checkpoint=f.save(),expected=f.render(4096);f.set([1,1,1,1]);f.render(4096);assert.equal(f.load(checkpoint),1);assert.deepEqual(f.render(4096),expected);
  const stable=f.save();
  for(const gains of [[NaN,1,1,1],[1,Infinity,1,1],[1,1,-1,1],[1,1,1,1024.1]]){assert.equal(f.set(gains),0);assert.deepEqual(f.save(),stable);}
  for(const field of [0,4,8,12,16,20]){const bad=stable.slice();new DataView(bad.buffer).setFloat32(bad.length-TRAILER+field,NaN,true);assert.equal(f.load(bad),0);assert.deepEqual(f.save(),stable,'invalid gain checkpoint is atomic');}
  for(const delta of [-1,-4,-48]){assert.equal(f.load(stable.subarray(0,stable.length+delta)),0);assert.deepEqual(f.save(),stable);}
  for(const offset of [48,52]){const bad=stable.slice();new DataView(bad.buffer).setUint32(bad.length-TRAILER+offset,0,true);assert.equal(f.load(bad),0);assert.deepEqual(f.save(),stable);}
  f.set([1024,1024,1024,1024]);const extreme=f.render(4096);assert(extreme.every(c=>c.every(Number.isFinite)));assert(peak(extreme)<=1);
  checks.push('atomic-validation-versioned-checkpoints-and-extreme-gain-clipping');
  if(legacy){
    for(const loud of [false,true])for(const enabled of [1,2,4,8,15])for(const bus of [[1,1],[.5,.75],[4,0],[0,3]]){
      const a=instance(module),b=instance(legacy);try{
        configure(a,{loud,enabled});configure(b,{loud,enabled});module._ym2608_set_output_gains(a.handle,...bus);legacy._ym2608_set_output_gains(b.handle,...bus);
        for(const [index,frames]of [1,7,128,1024,29,4096].entries()){
          if(index===1){a.write(0x2e,0);b.write(0x2e,0);}if(index===3){a.write(0x2f,0);b.write(0x2f,0);}if(index===4){a.write(0x2d,0);b.write(0x2d,0);}
          assert.deepEqual(a.render(frames),b.render(frames),'unity source gains are bit-exact under prescale/timing changes');assert.deepEqual(a.status(),b.status());totalFrames+=frames;
        }
        assert.deepEqual(a.save().subarray(0,a.save().length-TRAILER),b.save().subarray(0,b.save().length-8),'base core/memory checkpoint is unchanged');
        const old=b.save();const before=a.save();assert.equal(a.load(old),0,'old raw checkpoint layout is explicitly rejected');assert.deepEqual(a.save(),before);
        differential.push({loud,enabled,bus,frames:5285,maximumDifference:0});
      }finally{a.dispose();b.dispose();}
    }
    checks.push('unity-source-PCM-status-and-core-state-bit-exact-to-pinned-two-bus-build');
  }
  const report={passed:true,deviceOpened:false,checks,stateTrailerBytes:TRAILER,additionalStateBytes:48,differential,totalOutputStereoFrames:totalFrames};
  if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({...report,differentialCases:differential.length,differential:undefined},null,2));
}finally{f.dispose();}
