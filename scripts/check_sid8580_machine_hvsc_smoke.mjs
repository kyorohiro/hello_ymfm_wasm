#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// At most three user-local files. No corpus scan, audio device or PCM output.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {Sid8580MachineCore} from '../docs/sid8580-lab/core.js';
import {validateResearchSid} from '../docs/sid8580-lab/parser.js';
import {finishResearchPreflight} from '../docs/sid8580-lab/preflight.js';

const options={root:resolve('ww/C64Music'),out:resolve('docs/issues/sid8580_machine_hvsc_smoke_01.json'),files:[]};
const argv=process.argv.slice(2);
for(let i=0;i<argv.length;i++){
  const name=argv[i];assert(['--root','--file','--out'].includes(name)&&argv[i+1]);
  if(name==='--file')options.files.push(argv[++i]);else options[name.slice(2)]=resolve(argv[++i]);
}
if(!options.files.length)options.files=['DEMOS/0-9/1394.sid','DEMOS/0-9/1982_Senioridevaaja.sid','DEMOS/0-9/1st_Chaff.sid'];
assert(options.files.length<=3,'This is intentionally limited to three files');
const hash=b=>({bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});
const assetRoot=resolve('docs/generated/sid8580-machine');
const [endpointBinary,machineBinary,receiptBytes]=await Promise.all([
  readFile(resolve(assetRoot,'sid8580-endpoint.wasm')),readFile(resolve(assetRoot,'sid8580-machine.wasm')),
  readFile(resolve(assetRoot,'sid8580-machine-build.json'))]);
const receipt=JSON.parse(receiptBytes);
assert.deepEqual(hash(endpointBinary),receipt.outputs['sid8580-endpoint.wasm']);
assert.deepEqual(hash(machineBinary),receipt.outputs['sid8580-machine.wasm']);
const report={format:'tetorica-sid8580-machine-local-file-smoke',version:1,
  researchOnly:true,productionAdopted:false,physicalAudioOpened:false,listeningPerformed:false,
  bundledMusic:false,bundledPcm:false,maximumFiles:3,sampleRate:48000,captureSeconds:2,captureFrames:96000,
  selectedSubtunes:'header default only',target:{clock:'pal',model:'8580',environment:'minimal'},
  profiles:{resonance:false,cutoff:false},
  selection:'First three declared PAL/MOS8580 PSIDv2 candidates in the earlier immutable local metadata checkpoint; no execution-based selection.',
  node:process.version,assets:{endpoint:hash(endpointBinary),machine:hash(machineBinary),receipt:hash(receiptBytes)},
  inputs:{},cases:[],
  interpretation:'Compatibility smoke of loading/preflight/two-second rendering only. No listening, full-song coverage, corpus-wide conclusion or hardware-fidelity claim.'};
for(const name of ['scripts/check_sid8580_machine_hvsc_smoke.mjs','docs/sid8580-lab/core.js','docs/sid8580-lab/parser.js',
  'docs/sid8580-lab/psid_structure.js','docs/sid8580-lab/preflight.js','docs/js/sid_rsid.js','docs/sid-player/roms.js']){
  report.inputs[name]=hash(await readFile(resolve(name)));
}
function measure(samples){
  let squares=0,peak=0,finite=true,nonzero=0,aboveUnity=0;
  for(const value of samples){finite&&=Number.isFinite(value);squares+=value*value;peak=Math.max(peak,Math.abs(value));if(value!==0)nonzero++;if(Math.abs(value)>1)aboveUnity++;}
  return {frames:samples.length,finite,rms:Math.sqrt(squares/samples.length),peak,nonzeroFrames:nonzero,aboveUnityFrames:aboveUnity};
}
for(const name of options.files){
  const path=resolve(options.root,name);assert(path.startsWith(options.root+sep),'File must be inside the explicitly selected local archive');
  const row={path:relative(options.root,path),stage:'read'},controller=new AbortController();let core;
  const timer=setTimeout(()=>controller.abort(new Error('Local-file smoke deadline exceeded')),15000);
  try{
    const bytes=await readFile(path);row.input=hash(bytes);row.stage='validate';
    const parsed=validateResearchSid(bytes,{clock:'pal',model:'8580',environment:'minimal'});
    assert.equal(parsed.format,'PSID');assert.equal(parsed.version,2);assert.equal(parsed.model,'8580');
    assert(['pal','unknown','any'].includes(parsed.clock));
    row.metadata={...parsed.metadata};row.header={format:parsed.format,version:parsed.version,flags:parsed.flags,
      clock:parsed.clock,model:parsed.model,songs:parsed.songs,startSong:parsed.startSong,subtune:parsed.subtune,
      timing:parsed.timing,loadAddress:parsed.loadAddress,initAddress:parsed.initAddress,playAddress:parsed.playAddress,driverPage:parsed.driverPage};
    row.stage='create';core=await Sid8580MachineCore.create({sampleRate:48000,endpointBinary,machineBinary,profiles:report.profiles,signal:controller.signal});
    row.stage='load';core.load(bytes,{clock:'pal',model:'8580',environment:'minimal'});
    row.stage='preflight';await finishResearchPreflight(core,{signal:controller.signal});row.preflight=core.getState();
    row.stage='render';const samples=core.render(96000);row.measurement=measure(samples);row.state=core.getState();
    assert(row.measurement.finite,'Nonfinite PCM');assert.equal(row.measurement.frames,96000);assert(row.state.initReturned);
    row.stage='stop';core.stop();const stopped=core.getState(),silence=core.render(128);
    row.stop={zero:silence.every(value=>value===0),stableCycles:core.getState().cycles===stopped.cycles,state:stopped.state};
    assert(row.stop.zero&&row.stop.stableCycles);row.status=row.measurement.nonzeroFrames?'executed_nonzero':'executed_silent';
    row.stage='complete';
  }catch(error){
    row.status='failed';row.error={name:error.name,code:error.code??null,message:error.message,address:error.address??null};
    if(core)try{row.state=core.getState();}catch{}
  }finally{clearTimeout(timer);core?.dispose();}
  report.cases.push(row);console.log(`${row.path}: ${row.status}${row.error?' ('+row.error.message+')':''}`);
}
report.completedFiles=report.cases.length;
report.summary={executedNonzero:report.cases.filter(c=>c.status==='executed_nonzero').length,
  executedSilent:report.cases.filter(c=>c.status==='executed_silent').length,failed:report.cases.filter(c=>c.status==='failed').length};
await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:options.out,...report.summary}));
