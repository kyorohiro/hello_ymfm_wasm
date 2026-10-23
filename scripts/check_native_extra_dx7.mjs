/** Standalone Native DX7 versus the deployed WASM adapter; opens no device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDX7,createVoiceSysex,createBankSysex,parseSysex} from '../docs/js/msfa_dx7/src/index.js';
import {presetToVoice} from '../docs/js/msfa_dx7/src/preset.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1],`${name} requires a value`);return i<0?null:process.argv[i+1];};
const out=option('--out'),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-extra-dx7-'));
const fixture=option('--fixture')??path.join(temporary,'fixture');
const wasmBytes=await fs.readFile(path.join(root,'docs/js/msfa_dx7/wasm/msfa.wasm'));
const rates=[44100,48000,96000],partitions=[[1],[128],[3,127,1,64,17,256]];
const report={schemaVersion:1,startedAt:new Date().toISOString(),deviceOpened:false,rates,
 internalSampleRate:44100,polyphony:16,wasmSha256:createHash('sha256').update(wasmBytes).digest('hex'),
 reference:'Deployed docs/js/msfa_dx7 WASM exports with the shipped integer-phase adapter; separately checked against deployed createDX7 at its public 44.1/48 kHz rates.',
 cases:[],maximumDifference:0,totalStereoFrames:0,
 limits:'Offline standalone PCM and C++ allocation/isolation audit. The shipped public adapter supports 44.1/48 kHz; 96 kHz uses its same fixed-44.1-kHz integer-phase algorithm. MSFA internally generates 64-source-frame blocks; single-slot release/kill and live edits retain the already mixed block/filter latency. Full panic clears the instance buffer immediately. SysEx parsing/bank ownership are JS/Rust control state, with validated 155-byte selected voices passed to C++. No device, IPC, Rust scheduling, UI, other-platform compiler or real-time deadline guarantee.'};

const sine={name:'EXTRA SINE',algorithm:31,feedback:0,transpose:24,oscillatorSync:true,
 pitchEnvelope:{rates:[99,99,99,99],levels:[50,50,50,50]},
 lfo:{speed:0,delay:0,pitchModDepth:0,ampModDepth:0,waveform:0,sync:true,pitchModSensitivity:0},
 operators:Object.fromEntries(Array.from({length:6},(_,i)=>[i+1,{mode:'ratio',coarse:1,fine:0,detune:7,
  outputLevel:i===0?85:0,rateScaling:0,ampModSensitivity:0,velocitySensitivity:0,
  envelope:{rates:[99,99,99,75],levels:[99,99,99,0]},
  keyboardScaling:{breakpoint:39,leftDepth:0,rightDepth:0,leftCurve:0,rightCurve:0}}]))};
const scenarios=[];
function scenario(name,build,frames=6144){let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});build({add,at:n=>{frame=n;}});scenarios.push({name,events,frames});}
scenario('sixteen held allocations, rejected seventeenth, same-pitch layers and released-slot reuse',({add,at})=>{
 add('voice',1,0,presetToVoice(sine));for(let i=0;i<16;i++)add('on',60+i%8,60+i*3);
 at(701);add('on',90,127);at(1403);add('off',63);at(2101);add('on',77,100);at(3503);add('alloff');
},12288);
scenario('live operator level/pitch/feedback edits include held and released identity cohorts',({add,at})=>{
 let voice=presetToVoice({...sine,algorithm:0,operators:{...sine.operators,2:{...sine.operators[2],outputLevel:65}}});
 add('voice',7,0,voice);add('on',57,100);add('on',64,90);
 at(701);voice=presetToVoice({feedback:6,operators:{1:{coarse:2,fine:17,outputLevel:73}}},voice);add('voice',7,1,voice);
 at(1403);add('off',57);at(2101);voice=presetToVoice({operators:{1:{coarse:1,outputLevel:85}}},voice);add('voice',7,1,voice);
 at(3503);add('alloff');
},12288);
scenario('selecting independent bank identities preserves old held notes',({add,at})=>{
 const bank=createBankSysex(Array.from({length:32},(_,i)=>presetToVoice({...sine,name:'EXTRA '+i,
  operators:{...sine.operators,1:{...sine.operators[1],coarse:i%4+1}}})));
 const voices=parseSysex(bank).voices.map(v=>v.data);
 add('voice',32,0,voices[31]);add('on',60,100);at(701);add('voice',1,0,voices[0]);add('on',67,80);
 at(1403);add('voice',1,1,presetToVoice({operators:{1:{coarse:2,outputLevel:75}}},voices[0]));
 at(2101);add('voice',32,0,voices[31]);add('on',72,90);at(3503);add('alloff');
},12288);
for(const waveform of[0,4,5])scenario(`per-instance shared LFO waveform ${waveform}, delay and fixed/ratio pitch`,({add,at})=>{
 let voice=presetToVoice({...sine,feedback:7,
  lfo:{speed:78,delay:11,pitchModDepth:31,ampModDepth:22,waveform,sync:true,pitchModSensitivity:3},
  operators:{...sine.operators,1:{...sine.operators[1],coarse:0,fine:37},6:{...sine.operators[6],mode:'fixed',coarse:3,fine:99,outputLevel:40}}});
 add('voice',11,0,voice);add('on',12,127);at(701);add('on',115,50);
 at(1403);voice=presetToVoice({lfo:{speed:55,delay:0,sync:false}},voice);add('voice',11,1,voice);at(3503);add('alloff');
},12288);
scenario('full panic clears generated-ahead PCM and restarts selected voice at partial block',({add,at})=>{
 add('voice',1,0,presetToVoice(sine));add('on',69,100);at(701);add('panic');at(1403);add('on',72,100);at(3503);add('panic');
});

async function reference(rate){
 const fail=()=>{throw Error('Deployed DX7 WASM aborted');};
 const{instance}=await WebAssembly.instantiate(wasmBytes,{env:{abort:fail},wasi_snapshot_preview1:{proc_exit:fail}});
 const api=instance.exports;api._initialize?.();const handle=api.dx7_create();assert(handle);
 const pcm=new Float32Array(api.memory.buffer,api.dx7_output_ptr(handle),1024),bytes=new Uint8Array(api.memory.buffer,api.dx7_voice_ptr(handle),155);
 let index=64,phase=0,left=0,right=0,primed=false;
 const next=()=>{if(index===64){api.dx7_render(handle,64);index=0;}return pcm[index++];};
 return{voice:(id,live,voice)=>{bytes.set(voice);api[live?'dx7_edit_voice':'dx7_select_voice'](handle,id);},
  on:(n,v)=>api.dx7_note_on(handle,n,v),off:n=>api.dx7_note_off(handle,n),alloff:()=>api.dx7_all_notes_off(handle),
  panic:()=>{api.dx7_panic(handle);index=64;phase=0;left=right=0;primed=false;},
  render:n=>{const out=new Float32Array(n);if(rate===44100){api.dx7_render(handle,n);out.set(pcm.subarray(0,n));return out;}for(let i=0;i<n;i++){
   if(!primed){left=next();right=next();primed=true;}out[i]=left+(right-left)*(phase/rate);phase+=44100;
   while(phase>=rate){phase-=rate;left=right;right=next();}
  }return out;},dispose:()=>api.dx7_destroy(handle),
 };
}

try{
 if(!option('--fixture')){const sources=(await fs.readdir(path.join(project,'native-dx7'))).filter(n=>n.endsWith('.cc'));
  execFileSync('clang++',['-std=c++17','-O2','-DMSFA_FORCE_SCALAR','-fwrapv','-fno-strict-aliasing','-ffp-contract=off',
   '-I'+path.join(project,'native-dx7'),'-I'+path.join(project,'src'),path.join(project,'src/native_genesis_dx7_fixture.cpp'),
   path.join(project,'src/native_genesis_dx7.cpp'),...sources.map(n=>path.join(project,'native-dx7',n)),'-o',fixture],{stdio:'pipe'});
 }
 report.selfTest=JSON.parse(execFileSync(fixture,['--self-test'],{encoding:'utf8'}));
 const primaryPath=path.join(temporary,'primary.json');
 execFileSync(process.execPath,[path.join(root,'scripts/check_native_dx7.mjs'),'--fixture',fixture,'--out',primaryPath],{stdio:'pipe',timeout:60000});
 report.primaryRegression=JSON.parse(await fs.readFile(primaryPath,'utf8'));
 // Public APIs own their patch IDs; low-level identity scenarios below use
 // exports directly. Confirm the independently reproduced output adapter
 // against the deployed public implementation before relying on it.
 for(const rate of[44100,48000]){const api=await createDX7({sampleRate:rate,wasmBytes}),raw=await reference(rate);
  try{const voice=presetToVoice(sine);await api.loadSysex(createVoiceSysex(voice));raw.voice(1,0,voice);api.noteOn(69,100);raw.on(69,100);
   for(const n of[1,3,127,64,17,256])assert.deepEqual(raw.render(n),api.render(n));
   api.panic();raw.panic();api.noteOn(72,100);raw.on(72,100);assert.deepEqual(raw.render(257),api.render(257));
  }finally{api.dispose();raw.dispose();}
 }
 for(const rate of rates)for(const scenario of scenarios){
  const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
  const input=events.map(({frame,op,args})=>`${frame} ${op}${args.length?' '+(op==='voice'?`${args[0]} ${args[1]} ${Buffer.from(args[2]).toString('hex')}`:args.join(' ')):''}`).join('\n')+'\n';
  const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*8+1048576,timeout:20000});
  assert.equal(bytes.length,scenario.frames*8);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  for(const split of partitions){const api=await reference(rate);let frame=0,next=0,block=0,maximumDifference=0,peak=0;
   try{while(frame<scenario.frames){while(next<events.length&&events[next].frame===frame){const{op,args}=events[next++];api[op](...args);}
    const count=Math.min(scenario.frames-frame,split[block++%split.length],next<events.length?events[next].frame-frame:Infinity);assert(count>0);
    const expected=api.render(count);for(let i=0;i<count;i++)for(let ch=0;ch<2;ch++){
     const sample=actual[(frame+i)*2+ch];assert(Number.isFinite(sample));maximumDifference=Math.max(maximumDifference,Math.abs(sample-expected[i]));peak=Math.max(peak,Math.abs(sample));}
    frame+=count;
   }
   assert.equal(maximumDifference,0,`${rate}Hz ${scenario.name} split${split}`);assert(peak>.001,scenario.name+' must sound');
   report.cases.push({name:scenario.name,sampleRate:rate,split,frames:scenario.frames,maximumDifference,peak});report.totalStereoFrames+=scenario.frames;
   report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);
   }finally{api.dispose();}
  }
 }
 report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
 console.log(`Native additional DX7: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames; maximum difference ${report.maximumDifference}; primary ${report.primaryRegression.cases.length} cases / ${report.primaryRegression.totalStereoFrames} frames`);
 console.log(JSON.stringify(report.selfTest));
}finally{await fs.rm(temporary,{recursive:true,force:true});}
