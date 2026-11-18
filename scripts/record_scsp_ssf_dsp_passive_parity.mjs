// SPDX-License-Identifier: BSD-3-Clause
// Review-time measurement against actual predecessor loader/WASM Git blobs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import factory from '../docs/generated/ssf-player/ssf_player.js';
import {createScspSsfRenderer} from '../docs/synth-scsp/ssf_renderer.js';
import {prepareScspSsfSource} from '../docs/synth-scsp/ssf_source.js';
import {decodeScspSsfDspSnapshot} from '../docs/synth-scsp/ssf_snapshot.js';
import {createScspSsfPlaybackFixture,createScspSsfLiveFixture,createScspSsfCaptureFixture} from '../test/helpers/scsp_ssf_fixture.mjs';
import {createScspSsfDspFixture} from '../test/helpers/scsp_ssf_dsp_fixture.mjs';

export const SSF_DSP_PARITY_BASE='3ec3405625ad6007e87e1163c97b6b995dfb07b5';
export const SSF_DSP_PARITY_REPORT='docs/issues/scsp_ssf_dsp_passive_parity_01.json';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=value=>createHash('sha256').update(value).digest('hex'),record=value=>({bytes:value.length,sha256:sha(value)});
const blob=path=>execFileSync('git',['show',SSF_DSP_PARITY_BASE+':'+path],{cwd:root,maxBuffer:4*1024*1024});
const raw=value=>Buffer.from(value.buffer,value.byteOffset,value.byteLength);
function instrumentFactory(create){
  const capture={};
  capture.factory=async options=>{
    const module=await create(options);capture.module=module;
    const make=module._ssf_create;module._ssf_create=(...args)=>(capture.handle=make(...args));
    const read=module._ssf_read_snapshot;module._ssf_read_snapshot=(handle,pointer,...args)=>{
      const result=read(handle,pointer,...args);if(result)capture.words=new Uint32Array(module.HEAPU8.buffer,pointer,1040).slice();return result;
    };return module;
  };return capture;
}
const legacyView=snapshot=>({frame:snapshot.frame,nativeFrame:snapshot.nativeFrame,slots:snapshot.slots,globals:snapshot.globals});
function block(renderer,count){const left=new Float32Array(count),right=new Float32Array(count),produced=renderer.process(left,right,count);return {left,right,produced};}

export async function measureScspSsfDspPassiveParity(){
  const paths=['docs/generated/ssf-player/ssf_player.js','docs/generated/ssf-player/ssf_player.wasm'];
  const before=paths.map(blob),after=await Promise.all(paths.map(path=>readFile(resolve(root,path))));
  const directory=await mkdtemp(join(tmpdir(),'tetorica-ssf-dsp-parity-'));
  try{
    const legacyPath=join(directory,'legacy.mjs');await writeFile(legacyPath,before[0]);
    const legacyFactory=(await import(pathToFileURL(legacyPath).href)).default;
    const playback=createScspSsfPlaybackFixture(),live=createScspSsfLiveFixture(),capture=createScspSsfCaptureFixture(),dsp=createScspSsfDspFixture();
    const fixtures=[['pcm-sine',playback.standaloneFiles],['live-cpu-writes',live.files],['capture-voices',capture.files],['nonzero-dsp',dsp.files]],cases=[];
    for(const [name,files]of fixtures)for(const [blockFrames,blocks]of [[257,160],[1024,48]]){
      const source=await prepareScspSsfSource(files,files[0].path),old=instrumentFactory(legacyFactory),fresh=instrumentFactory(factory);
      const previous=await createScspSsfRenderer(source,{wasmBinary:before[1],moduleFactory:old.factory});
      const observed=await createScspSsfRenderer(source,{wasmBinary:after[1],moduleFactory:fresh.factory});
      const unobserved=await createScspSsfRenderer(source,{wasmBinary:after[1]});
      const pcmLeft=createHash('sha256'),pcmRight=createHash('sha256'),slots=createHash('sha256'),words=createHash('sha256');
      let pointer=0,frames=0;
      try{
        pointer=fresh.module._malloc(632*4);assert(pointer);
        const first=observed.readSnapshot(),oldFirst=previous.readSnapshot();assert.deepEqual(legacyView(first),legacyView(oldFirst));assert.deepEqual(first.ram,oldFirst.ram);assert(!Object.hasOwn(oldFirst,'dsp'));
        for(let index=0;index<blocks&&!observed.ended;index++){
          const current=block(observed,blockFrames),prior=block(previous,blockFrames),quiet=block(unobserved,blockFrames);
          assert.deepEqual(current,prior);assert.deepEqual(current,quiet);frames+=current.produced;
          pcmLeft.update(raw(current.left));pcmRight.update(raw(current.right));
          const beforeFrame=fresh.module._ssf_native_frame(fresh.handle),snapshot=observed.readSnapshot(),oldSnapshot=previous.readSnapshot();
          assert.equal(snapshot.frame,beforeFrame);assert.equal(snapshot.dsp.frame,snapshot.frame);assert.equal(fresh.module._ssf_native_frame(fresh.handle),beforeFrame);
          assert.deepEqual(legacyView(snapshot),legacyView(oldSnapshot));assert.deepEqual(snapshot.ram,oldSnapshot.ram);assert.deepEqual(fresh.words,old.words);
          const frozen=structuredClone(snapshot.dsp);
          for(let repeat=0;repeat<3;repeat++){
            assert.equal(fresh.module._ssf_read_dsp_snapshot(fresh.handle,pointer,632),1);
            const data=new Uint32Array(fresh.module.HEAPU8.buffer,pointer,632);
            assert.deepEqual(decodeScspSsfDspSnapshot(data,snapshot.frame),snapshot.dsp);
          }
          assert.equal(fresh.module._ssf_native_frame(fresh.handle),beforeFrame);assert.deepEqual(snapshot.dsp,frozen);
          slots.update(JSON.stringify(legacyView(snapshot)));words.update(raw(fresh.words));
        }
        const last=observed.readSnapshot(),prior=previous.readSnapshot(),quiet=unobserved.readSnapshot();
        assert.deepEqual(legacyView(last),legacyView(prior));assert.deepEqual(last.ram,prior.ram);assert.deepEqual(last,quiet);
        if(name==='nonzero-dsp'){
          assert.deepEqual(last.dsp.program,dsp.program);assert.deepEqual(last.dsp.coefficients,dsp.coefficients);assert.deepEqual(last.dsp.addresses,dsp.addresses);assert.deepEqual(last.dsp.outputs,dsp.outputs);
        }
        cases.push({fixture:name,blockFrames,blocks,frames,nativeFrame:last.frame,
          exactPcmEqual:true,exactRamEqual:true,exactSlotStateEqual:true,exactSlotWordsEqual:true,exactNativeFrameEqual:true,
          exactUnobservedPcmEqual:true,exactUnobservedFinalSnapshotEqual:true,repeatedDspReadUnchanged:true,sameFrameDsp:true,detachedDspBuffers:true,
          ...(name==='nonzero-dsp'?{exactFixtureProgramEqual:true,exactFixtureCoefficientsEqual:true,exactFixtureAddressesEqual:true,exactFixtureOutputsEqual:true}:{}),
          pcmLeftSha256:pcmLeft.digest('hex'),pcmRightSha256:pcmRight.digest('hex'),ramSha256:sha(last.ram),slotWordsTraceSha256:words.digest('hex'),slotStateTraceSha256:slots.digest('hex')});
      }finally{if(pointer)fresh.module._free(pointer);previous.dispose();observed.dispose();unobserved.dispose();}
    }
    return {schemaVersion:1,scope:'scsp-ssf-dsp-passive-observation-parity',baseCommit:SSF_DSP_PARITY_BASE,deviceOpened:false,
      before:{abi:3,factory:record(before[0]),wasm:record(before[1])},after:{abi:4,factory:record(after[0]),wasm:record(after[1])},
      schema:{slotWords:1040,dspWords:632,magic:'0x53445031',version:1,program:{type:'Uint16Array',length:512,order:'128 instructions, four high-to-low words each'},coefficients:{type:'Int16Array',length:64,min:-4096,max:4095},addresses:{type:'Uint16Array',length:32},outputs:{type:'Int16Array',length:16},tempAndMemsExported:false},
      cpuStateDirectlyObserved:false,cpuNoninterferenceEvidence:'No CPU register export is claimed. The observer uses const direct member copies without bus access or clock calls; exact PCM, native time, all old1040words, RAM and final observed/unobserved snapshots are measured.',cases};
  }finally{await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2];assert(['--write','--check'].includes(mode),'Usage: node scripts/record_scsp_ssf_dsp_passive_parity.mjs --write | --check');
  const report=await measureScspSsfDspPassiveParity(),text=JSON.stringify(report,null,2)+'\n';
  if(mode==='--write')await writeFile(resolve(root,SSF_DSP_PARITY_REPORT),text);else assert.equal(await readFile(resolve(root,SSF_DSP_PARITY_REPORT),'utf8'),text);
  console.log(`SSF DSP passive parity: ${report.cases.length} exact predecessor/observed/unobserved cases PASS. Report SHA256 ${sha(text)}`);
}
