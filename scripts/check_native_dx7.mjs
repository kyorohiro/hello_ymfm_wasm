/** Actual Native MSFA DX7 versus the shipped WASM. Opens no audio device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDX7,createInitVoice,createVoiceSysex,createBankSysex,parseSysex} from '../web/msfa_dx7/src/index.js';
import {presetToVoice} from '../web/msfa_dx7/src/preset.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const index=process.argv.indexOf(name);assert(index<0||process.argv[index+1],`${name} requires a value`);return index<0?null:process.argv[index+1];};
let fixture=option('--fixture'),temporary;
const output=option('--out'),rates=[44100,48000,96000];
const wasmBytes=await fs.readFile(path.join(root,'web/msfa_dx7/wasm/msfa.wasm'));
const report={schemaVersion:1,startedAt:new Date().toISOString(),deviceOpened:false,rates,
  internalSampleRate:44100,polyphony:16,wasmSha256:createHash('sha256').update(wasmBytes).digest('hex'),
  cases:[],maximumDifference:0,
  limits:'Compares the actual native C++ MSFA core and integer-phase output adapter with shipped WASM. The public Web adapter supports 44.1/48 kHz; 96 kHz uses its same integer-phase algorithm over the shipped WASM exports. Whole-bus routing, command ownership and Stop fencing are covered separately by Rust and mocked-IPC browser tests.'};
if(!fixture) {
  temporary=await fs.mkdtemp(path.join(os.tmpdir(),'tetorica-native-dx7-'));
  fixture=path.join(temporary,'fixture');
  const sourceNames=(await fs.readdir(path.join(project,'native-dx7'))).filter(name=>name.endsWith('.cc'));
  execFileSync('clang++',['-std=c++17','-O2','-DMSFA_FORCE_SCALAR','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+path.join(project,'native-dx7'),'-I'+path.join(project,'src'),
    path.join(project,'src/native_genesis_dx7_fixture.cpp'),path.join(project,'src/native_genesis_dx7.cpp'),
    ...sourceNames.map(name=>path.join(project,'native-dx7',name)),'-o',fixture],{stdio:'pipe'});
}

// Same adapter as DX7Core: at 44.1 kHz the MSFA core owns its remainder;
// other rates use two priming samples and a 64-frame source buffer. Integer
// phase is independent of the host's render partitioning.
async function wasmReference(rate) {
  const fail=()=>{throw Error('DX7 WASM aborted');};
  const {instance}=await WebAssembly.instantiate(wasmBytes,{env:{abort:fail},wasi_snapshot_preview1:{proc_exit:fail}});
  const api=instance.exports;api._initialize?.();const handle=api.dx7_create();assert(handle);
  const pcm=new Float32Array(api.memory.buffer,api.dx7_output_ptr(handle),1024);
  const bytes=new Uint8Array(api.memory.buffer,api.dx7_voice_ptr(handle),155);
  let index=64,phase=0,left=0,right=0,primed=false;
  const next=()=>{if(index===64){api.dx7_render(handle,64);index=0;}return pcm[index++];};
  return {
    voice(id,live,data){bytes.set(data);api[live?'dx7_edit_voice':'dx7_select_voice'](handle,id);},
    on(note,velocity){api.dx7_note_on(handle,note,velocity);},
    off(note){api.dx7_note_off(handle,note);},
    alloff(){api.dx7_all_notes_off(handle);},
    panic(){api.dx7_panic(handle);index=64;phase=0;left=right=0;primed=false;},
    sample(){
      if(rate===44100){api.dx7_render(handle,1);return pcm[0];}
      if(!primed){left=next();right=next();primed=true;}
      const value=Math.fround(left+(right-left)*(phase/rate));
      phase+=44100;
      while(phase>=rate){phase-=rate;left=right;right=next();}
      return value;
    },
    dispose(){api.dx7_destroy(handle);},
  };
}
const sine={name:'TEST SINE',algorithm:31,feedback:0,transpose:24,oscillatorSync:true,
  pitchEnvelope:{rates:[99,99,99,99],levels:[50,50,50,50]},
  lfo:{speed:0,delay:0,pitchModDepth:0,ampModDepth:0,waveform:0,sync:true,pitchModSensitivity:0},
  operators:Object.fromEntries(Array.from({length:6},(_,index)=>[index+1,{mode:'ratio',coarse:1,fine:0,detune:7,
    outputLevel:index===0?85:0,rateScaling:0,ampModSensitivity:0,velocitySensitivity:0,
    envelope:{rates:[99,99,99,75],levels:[99,99,99,0]},
    keyboardScaling:{breakpoint:39,leftDepth:0,rightDepth:0,leftCurve:0,rightCurve:0}}]))};
const scenarios=[];
function scenario(name,build,frames=6144,checks={}) {
  const events=[];let at=0;
  const add=(op,...args)=>events.push({frame:at,op,args});
  build({add,at:frame=>{at=frame;}});
  scenarios.push({name,events,frames,checks});
}
for(let algorithm=0;algorithm<32;algorithm++)scenario('algorithm '+(algorithm+1)+' with feedback '+algorithm%8,({add,at})=>{
  const voice=presetToVoice({...sine,algorithm,feedback:algorithm%8,
    operators:Object.fromEntries(Array.from({length:6},(_,index)=>[index+1,{...sine.operators[index+1],coarse:index+1,outputLevel:55+index*5}]))});
  add('voice',1,0,voice);add('on',60,100);at(1301);add('on',67,70);at(2703);add('off',60);at(3701);add('alloff');
});
scenario('sixteen-voice capacity, rejected seventeenth held key and release-slot reuse',({add,at})=>{
  add('voice',1,0,presetToVoice(sine));
  for(let note=48;note<64;note++)add('on',note,40+note-48);
  at(1003);add('on',76,100);at(1701);add('off',54);at(2003);add('on',79,100);at(3001);add('alloff');
},12288);
scenario('held and release-tail operator pitch, level and feedback edits',({add,at})=>{
  let voice=presetToVoice({...sine,algorithm:0,operators:{...sine.operators,2:{...sine.operators[2],outputLevel:65}}});
  add('voice',1,0,voice);add('on',69,100);
  at(701);voice=presetToVoice({operators:{1:{coarse:2,fine:13}}},voice);add('voice',1,1,voice);
  at(1403);voice=presetToVoice({feedback:6,operators:{1:{outputLevel:65},2:{coarse:3,outputLevel:72}}},voice);add('voice',1,1,voice);
  at(2101);add('off',69);at(2303);voice=presetToVoice({operators:{1:{coarse:1,outputLevel:85}}},voice);add('voice',1,1,voice);
},12288);
scenario('replacement patch identity preserves old held notes',({add,at})=>{
  const initial=presetToVoice(sine),replacement=presetToVoice({...sine,name:'NEW PATCH',operators:{...sine.operators,1:{...sine.operators[1],coarse:3}}});
  add('voice',1,0,initial);add('on',60,100);at(1103);add('voice',2,0,replacement);add('on',67,80);
  at(2101);add('voice',2,1,presetToVoice({operators:{1:{coarse:4}}},replacement));at(3103);add('alloff');
},12288);
scenario('SysEx bank selection keeps distinct voice identities',({add,at})=>{
  const bank=createBankSysex(Array.from({length:32},(_,index)=>presetToVoice({...sine,name:'BANK '+String(index).padStart(2,'0'),operators:{...sine.operators,1:{...sine.operators[1],coarse:index%4+1}}})));
  const voices=parseSysex(bank).voices;
  add('voice',32,0,voices[31].data);add('on',60,100);at(1103);add('voice',1,0,voices[0].data);add('on',67,80);
  at(2101);add('voice',32,0,voices[31].data);add('on',72,70);at(3103);add('alloff');
},12288);
scenario('panic silence, patch preservation and restart at partial source block',({add,at})=>{
  add('voice',1,0,presetToVoice(sine));add('on',69,100);at(1301);add('panic');at(2103);add('on',72,100);at(4001);add('panic');
},6144,{silentRanges:[[1301,2103],[4001,6144]],restart:[2200,3500]});
scenario('ratio half/fixed tuning, LFO and pitch envelope extremes',({add,at})=>{
  const voice=presetToVoice({...sine,algorithm:31,feedback:7,
    lfo:{speed:78,delay:7,pitchModDepth:31,ampModDepth:22,waveform:4,sync:true,pitchModSensitivity:3},
    pitchEnvelope:{rates:[79,65,57,66],levels:[80,35,50,50]},
    operators:{...sine.operators,1:{...sine.operators[1],coarse:0,fine:37},6:{...sine.operators[6],mode:'fixed',coarse:3,fine:99,outputLevel:40}}});
  add('voice',1,0,voice);add('on',12,127);at(1501);add('on',115,50);at(3001);add('alloff');
},12288);
const energy=(pcm,start,end)=>{let sum=0;for(let index=start*2;index<end*2;index++)sum+=pcm[index]*pcm[index];return sum;};
function eventText({frame,op,args}) {
  if(op==='voice')return `${frame} voice ${args[0]} ${args[1]} ${Buffer.from(args[2]).toString('hex')}`;
  return `${frame} ${op}${args.length?' '+args.join(' '):''}`;
}
try {
  for(const rate of rates)for(const scenario of scenarios) {
    const bytes=execFileSync(path.resolve(fixture),[String(rate),String(scenario.frames)],{
      input:scenario.events.map(eventText).join('\n')+'\n',maxBuffer:scenario.frames*8+1024*1024,timeout:20000,
    });
    assert.equal(bytes.length,scenario.frames*8,'Native fixture must return every stereo frame');
    const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),reference=await wasmReference(rate);
    let next=0,maximumDifference=0,peak=0;
    try {
      const sorted=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
      for(let frame=0;frame<scenario.frames;frame++) {
        while(next<sorted.length&&sorted[next].frame===frame) {
          const event=sorted[next++],args=event.args;
          if(event.op==='voice')reference.voice(args[0],args[1],args[2]);
          else reference[event.op](...args);
        }
        const expected=reference.sample();
        for(let channel=0;channel<2;channel++) {
          const value=actual[frame*2+channel];assert(Number.isFinite(value),'Native DX7 must produce finite PCM');
          maximumDifference=Math.max(maximumDifference,Math.abs(value-expected));peak=Math.max(peak,Math.abs(value));
        }
      }
      assert(maximumDifference<=1e-7,`${rate} Hz ${scenario.name}: PCM difference ${maximumDifference}`);
      assert(peak>.001,scenario.name+' must contain sounding PCM');
      for(const [start,end]of scenario.checks.silentRanges??[])assert.equal(energy(actual,start,end),0,'Panic must clear generated-ahead PCM immediately');
      if(scenario.checks.restart)assert(energy(actual,...scenario.checks.restart)>.001,'Panic must preserve the selected patch for Run');
      report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);
      report.cases.push({name:scenario.name,sampleRate:rate,frames:scenario.frames,maximumDifference,peak});
    } finally {reference.dispose();}
  }
  // Check that our reference adapter really is the shipped public implementation
  // at each supported Web rate, including partial render partitions and panic.
  for(const rate of [44100,48000]) {
    const publicCore=await createDX7({sampleRate:rate,wasmBytes}),reference=await wasmReference(rate);
    try {
      const voice=presetToVoice(sine);await publicCore.loadSysex(createVoiceSysex(voice));reference.voice(1,0,voice);
      publicCore.noteOn(69,100);reference.on(69,100);
      for(const count of [1,37,128,511,63,1024]) {
        const expected=publicCore.render(count);
        for(const value of expected)assert.equal(reference.sample(),value,'Offline comparison adapter must match the shipped public DX7 adapter');
      }
      publicCore.panic();reference.panic();publicCore.noteOn(72,100);reference.on(72,100);
      for(const value of publicCore.render(257))assert.equal(reference.sample(),value,'Public panic/restart adapter must match');
    } finally {publicCore.dispose();reference.dispose();}
  }
  report.totalStereoFrames=report.cases.reduce((total,result)=>total+result.frames,0);report.status='passed';
  if(output)await fs.writeFile(path.resolve(output),JSON.stringify(report,null,2)+'\n');
  console.log(`PASS: actual Native DX7 versus shipped WASM, ${report.cases.length} cases / ${report.totalStereoFrames} stereo frames at ${rates.join('/')} Hz; max difference ${report.maximumDifference}; no audio device.`);
} finally {if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
