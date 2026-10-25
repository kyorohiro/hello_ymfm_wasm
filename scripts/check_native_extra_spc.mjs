/** Full Native SPC700/S-DSP vs the actual deployed file-player Worklet. No device. */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSyntheticSpc} from '../web/spc_test_fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const sdk=path.join(project,'vendor/tetorica-soundchip-native'),core=path.join(sdk,'vendor/snes-spc/snes_spc');
const option=name=>{const equal=process.argv.find(value=>value.startsWith(name+'=')),index=process.argv.indexOf(name);if(equal===undefined&&index<0)return null;const value=equal===undefined?process.argv[index+1]:equal.slice(name.length+1);assert(value&&!value.startsWith('--'),`${name} requires a value`);return value;};
const output=option('--out');let fixture=option('--fixture'),Processor;
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-extra-spc-'));
globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testMessages=[];this.port={postMessage:data=>{this.testMessages.push(data);if(data.error)this.testError=data.error;},close(){}};}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-spc')Processor=processor;};
await import('../docs/js/spc-worklet.js');
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/spc_wasm.wasm'));
const files=new Map();
const addFile=(name,bytes)=>{files.set(name,bytes);return name;};
const simple=addFile('simple',createSyntheticSpc()),rich=addFile('rich',createSyntheticSpc({voices:8,echo:true,pmon:true,noise:true}));
for(const filter of[0,1,2,3]){const bytes=createSyntheticSpc({voices:3,echo:filter%2===0,pmon:true});bytes[0x2100]=0xc3|(filter<<2);addFile('filter'+filter,bytes);}
const firmware=createSyntheticSpc({voices:3,echo:true});firmware.set([0x8f,0,0xf2,0xe8,0x20,0xc4,0xf3,0xbc,0x2f,0xfb],0x300);addFile('firmware',firmware);
const musical=createSyntheticSpc({voices:4,echo:true,pmon:true});
const program=[];for(const[reg,value]of[[2,0x12],[3,0x18],[0,0x60],[1,0x40],[4,0],[5,0x8f],[6,0xe0],[7,127],[0x5c,1],[0x4c,1],[0x5c,0],[0x4c,3],[0x3d,8],[0x6c,0x1f],[0x7c,255],[0x4c,5]])program.push(0x8f,reg,0xf2,0x8f,value,0xf3);
program.push(0xab,0x30,0x2f,(-program.length-4)&255);musical.set(program,0x300);addFile('musical',musical);
const cases=[];
function scenario(name,build,{frames=8192}={}){let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});build({add,at:n=>{frame=n;}});cases.push({name,frames,events});}
const install=(add,file,{target=0,mute=0,playing=false,method='load'}={})=>add('install',file,target,mute,playing,method);
for(const file of files.keys())scenario(`full SPC700 firmware, ${file}, snapshot and 128-frame render-ahead`,({add,at})=>{
 install(add,file);add('play');at(701);add('read');at(1903);add('pause');at(2501);add('read');at(3101);add('play');at(5003);add('read');
});
for(const file of[simple,rich])scenario(`eight-bit source mute ${file}, cached samples and echo history advance`,({add,at})=>{
 install(add,file);add('play');for(const[f,mask]of[[701,1],[1403,3],[2101,255],[2803,0],[3501,0xaa],[4203,0]]){at(f);add('mute',mask);}at(4901);add('read');
});
scenario('stop prepares original RAM/CPU/DSP and preserves mute without automatic replay',({add,at})=>{
 install(add,rich);add('play');at(701);add('mute',5);at(1903);install(add,rich,{mute:5,method:'stop'});add('read');at(2901);add('play');at(4503);add('read');
});
scenario('independent file replacement keeps mute and remains paused until play',({add,at})=>{
 install(add,simple);add('play');at(701);add('mute',2);at(1903);install(add,rich,{mute:2});add('read');at(2901);add('play');at(5003);add('read');
});
for(const target of[0,1,17,1023,1024,15999,16000,16001,32000,48001])scenario(`seek ${target} native frames prepares control-owned CPU state and resumes`,({add,at})=>{
 install(add,rich);add('play');at(701);add('mute',2);at(1703);install(add,rich,{target,mute:2,playing:true,method:'seek'});add('read');at(3901);add('read');
});
scenario('seek from paused state preserves pause and starts at the requested native sample',({add,at})=>{
 install(add,simple);at(701);install(add,simple,{target:33333,method:'seek'});add('read');at(1903);add('play');at(5101);add('read');
});
scenario('frequent state/RAM snapshots do not consume output or SPC700 timer state',({add,at})=>{
 install(add,rich);add('play');for(let i=0;i<30;i++){at(i*211+1);add('read');}
});
for(const capacity of[16,2048,8192])scenario(`SPC700 DSP observation capacity${capacity}, overflow never changes synthesis`,({add,at})=>{
 install(add,'firmware');add('observe',true,capacity);add('play');at(1703);add('read');at(3101);add('observe',false,capacity);at(4203);add('observe',true,capacity);at(6101);add('read');
});
scenario('ordered musical DSP writes retain clocks and snapshot registers across late subscription',({add,at})=>{
 install(add,'musical');add('play');at(701);add('observe',true,2048);at(3101);add('read');at(4103);add('pause');at(4701);add('play');at(6101);add('read');
});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed spc-worklet.js / shipped accurateSNES_SPC WASM / SpcResampler sourceFrames128; original synthetic SPC700 drivers, no IPL ROM or game audio.',wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),rates:[44100,48000,96000],cases:[],totalStereoFrames:0,maximumDifference:0,
 limits:'Offline prepared-core standalone PCM/state/rawDSP-write parity plus C++ allocation audit. Full SPC700 and S-DSP run at fixed32000Hz, output interpolation exactly follows Browser render-ahead128. Load/stop/seek CPU preparation is control-only; callback swaps already prepared cores, retained old cores are destroyed afterward. No device/Rust ownership/IPC/UI/FX/otherplatform/deadline guarantee; ID666 has no automatic end/fade.'};
function fnv(bytes){let h=2166136261;for(const value of bytes)h=Math.imul(h^value,16777619)>>>0;return h;}
try{
 for(const[name,bytes]of files)await fs.writeFile(path.join(temporary,name+'.spc'),bytes);
 if(!fixture){fixture=path.join(temporary,'fixture');
  const sources=[path.join(project,'src/native_genesis_spc_fixture.cpp'),path.join(sdk,'native/reference/tauri/native_genesis_spc.cpp'),...['SNES_SPC.cpp','SNES_SPC_misc.cpp','SNES_SPC_state.cpp','SPC_DSP.cpp'].map(name=>path.join(core,name))];
  const inputs=[...sources,path.join(project,'src/native_genesis_spc.h'),path.join(sdk,'native/reference/tauri/native_genesis_spc.h'),...['SNES_SPC.h','SPC_DSP.h','blargg_common.h','blargg_config.h','blargg_endian.h','blargg_source.h','SPC_CPU.h'].map(name=>path.join(core,name))];
  report.nativeSources=await Promise.all(inputs.map(async file=>({file:path.relative(root,file),sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
  execFileSync('clang++',['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+core,...sources,'-o',fixture],{stdio:'pipe'});}
 report.selfTest=JSON.parse(execFileSync(fixture,['--self-test',path.join(temporary,'firmware.spc')],{encoding:'utf8'}));
 for(const rate of report.rates)for(const scenario of cases){
  const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame),lines=events.map(({frame,op,args})=>op==='install'?`${frame} install ${path.join(temporary,args[0]+'.spc')} ${args[1]} ${args[2]} ${Number(args[3])}`:`${frame} ${op} ${args.map(v=>typeof v==='boolean'?Number(v):v).join(' ')}`).join('\n')+'\n';
  const native=spawnSync(fixture,[String(rate),String(scenario.frames)],{input:lines,maxBuffer:64*1024*1024,timeout:30000});assert.equal(native.status,0,native.stderr?.toString());assert.equal(native.stdout.length,scenario.frames*8);
  const diagnostics=JSON.parse(native.stderr),actual=new Float32Array(native.stdout.buffer,native.stdout.byteOffset,native.stdout.length/4);
  for(const split of[[1],[128],[3,127,1,64,17,256]]){
   globalThis.sampleRate=rate;const reference=new Processor({processorOptions:{wasmBinary}});await reference.ready;assert(reference.core,reference.testError);
   let next=0,frame=0,block=0,maximumDifference=0,peak=0,readIndex=0,lost=0;const observed=[],scratch=new Float64Array(8192*3);
   reference.collectObservedEvents=()=>{const count=reference.core.drainDspEventsInto(scratch);lost+=reference.core.takeDspEventOverflow();for(let i=0;i<count*3;i++)observed.push(scratch[i]);};
   try{while(frame<scenario.frames){globalThis.currentFrame=frame;
    while(next<events.length&&events[next].frame===frame){const{op,args}=events[next++];
     if(op==='install'){
      const[file,target,mute,playing,method]=args;
      if(method==='load'){reference.command({type:'load',bytes:files.get(file)});}
      else if(method==='stop')reference.command({type:'stop'});
      else{
       reference.command({type:'seek-begin',seekId:'fixture'});
       for(let n=0;n<target;){const count=Math.min(16000,target-n);reference.command({type:'seek-step',seekId:'fixture',frames:count});n+=count;}
       reference.command({type:'seek-end',seekId:'fixture',resume:playing});
      }
      assert.equal(reference.muteMask,mute);assert.equal(reference.playing,playing);
     }else if(op==='observe'){
      reference.eventEnabled=Boolean(args[0]);if(args[0])reference.core.startDspObservation({capacity:args[1]});else reference.core.stopDspObservation();
     }else if(op==='read'){
      const value=reference.core.snapshot(),state=reference.state(),expected=diagnostics.reads[readIndex++];assert.equal(expected.frame,frame);assert.equal(expected.nativeFrames,value.nativeFrames);assert.equal(expected.ramHash,fnv(value.ram),scenario.name+' RAM');assert.deepEqual(expected.dsp,[...value.dsp],scenario.name+' DSP');assert.equal(expected.playing,Number(state.playing));assert.equal(expected.muteMask,state.muteMask);assert.equal(expected.baseNativeFrames,reference.resampler.baseNativeFrames);assert.equal(expected.outputFrames,reference.resampler.outputFrames);assert.equal(state.renderedNativeFrames,value.nativeFrames);
     }else reference.command({type:op==='mute'?'mute':op,...(op==='mute'?{mask:args[0]}:{})});
     assert.equal(reference.testError,undefined,reference.testError);
    }
    const count=Math.min(scenario.frames-frame,split[block++%split.length],next<events.length?events[next].frame-frame:Infinity),left=new Float32Array(count),right=new Float32Array(count);assert(count>0);reference.process([],[[left,right]]);
    for(let i=0;i<count;i++)for(let channel=0;channel<2;channel++){const value=actual[(frame+i)*2+channel],expected=channel?right[i]:left[i];assert(Number.isFinite(value));maximumDifference=Math.max(maximumDifference,Math.abs(value-expected));peak=Math.max(peak,Math.abs(value));assert.equal(value,expected,`${scenario.name} ${rate}Hz split${split} frame${frame+i} channel${channel}`);}
    frame+=count;
   }
   assert(peak>0.0001,scenario.name+' must sound');assert.equal(lost,diagnostics.overflow,scenario.name+' event overflow');assert.deepEqual(observed,diagnostics.events,scenario.name+' ordered raw DSP writes');assert.equal(readIndex,diagnostics.reads.length);
   report.cases.push({name:scenario.name,rate,split,stereoFrames:scenario.frames,maximumDifference,peak,snapshots:readIndex,observedWrites:observed.length/3,observerOverflow:lost});report.totalStereoFrames+=scenario.frames;
   }finally{reference.dispose();}
  }
 }
 report.status='passed';if(output)await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(`Native additional SPC: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference0; state/snapshot/rawDSP observer parity passed.`);console.log(JSON.stringify(report.selfTest));
}finally{await fs.rm(temporary,{recursive:true,force:true});}
