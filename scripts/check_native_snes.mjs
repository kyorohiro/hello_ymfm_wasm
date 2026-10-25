/** Compare the actual Native S-DSP with the Browser WASM core. No audio device. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import factory from '../docs/generated/spc_wasm.js';
import {SnesDspCore} from '../web/spc.js';
import {SnesSynth} from '../web/snessynth.js';
import {SpcResampler} from '../web/spc_resampler.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const sdk=path.join(project,'vendor/tetorica-soundchip-native');
const option=name=>{const equal=process.argv.find(value=>value.startsWith(name+'=')),index=process.argv.indexOf(name);if(equal===undefined&&index<0)return null;const value=equal===undefined?process.argv[index+1]:equal.slice(name.length+1);assert(value&&!value.startsWith('--'),`${name} requires a value`);return value;};
async function compileSdkFixture(fixture,report){
  const core=path.join(sdk,'vendor/snes-spc/snes_spc'),adapter=path.join(sdk,'native/reference/tauri/native_genesis_snes.cpp');
  // The fixture and SDK wrapper resolve their quoted ABI headers separately.
  // Record both, plus every project-owned transitive DSP header.
  const sources=[path.join(project,'src/native_genesis_snes_fixture.cpp'),path.join(project,'src/native_genesis_snes.h'),adapter,path.join(sdk,'native/reference/tauri/native_genesis_snes.h'),...['SPC_DSP.cpp','SPC_DSP.h','blargg_common.h','blargg_config.h','blargg_endian.h','blargg_source.h'].map(name=>path.join(core,name))];
  report.nativeSources=await Promise.all(sources.map(async file=>({file:path.relative(root,file),sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
  execFileSync('clang++',['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+core,sources[0],adapter,path.join(core,'SPC_DSP.cpp'),'-o',fixture],{stdio:'pipe'});
}
const output=option('--out'),provided=option('--fixture');
let temporary,fixture=provided?path.resolve(provided):null;
const report={schemaVersion:1,checker:path.relative(root,fileURLToPath(import.meta.url)),checkerSha256:createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex'),deviceOpened:false,rates:[44100,48000,96000],cases:[],totalStereoFrames:0,maximumDifference:0,
  reference:'Current Browser accurate SPC_DSP WASM, SnesSynth and SpcResampler with sourceFrames:1; no SPC700 CPU, ROM or game audio.',
  limits:'Core PCM, resampling and fixed state lifecycle; ownership/IPC and UI are checked separately.'};
const wave=new Uint8Array([0xb0,0x12,0x34,0x56,0x78,0x76,0x54,0x32,0x10,0xb3,0xfe,0xdc,0xba,0x98,0x9a,0xbc,0xde,0xf0]);
const scenes=[];
function scene(name,build,{frames=8192,sounding=true}={}){
  let frame=0;const events=[];
  const add=(op,...args)=>events.push({frame,op,args});
  const core={get nativeFrames(){return frame;},reset:()=>add('reset'),writeDsp:(...args)=>add('write',...args),loadRam:(data,address)=>add('load',address,data.slice())};
  const synth=new SnesSynth({core});const sample=synth.loadBRR(wave,{rootNote:'A4',loopStartSamples:0});
  for(let ch=0;ch<8;ch++)synth.setPreset(ch,{sample});
  build({synth,sample,add,at:v=>{frame=v;}});scenes.push({name,frames,sounding,events});
}
scene('BRR loop, signed volumes, musical pitch and same-frame chord',({synth,at})=>{
  synth.setPreset(1,{volumeLeft:-70,volumeRight:110});synth.noteOn(0,'A4');synth.noteOn(1,'E5');
  at(1301);synth.noteOn(2,'C4');at(2703);synth.keyOff(0);at(3901);synth.noteOn(0,'G4');at(6103);synth.allNotesOff();
});
for(const [adsr1,adsr2]of [[0x8f,0xe0],[0x84,0x61],[0xff,0xff]])scene(`ADSR ${adsr1}/${adsr2}, retrigger and release`,({synth,at})=>{
  synth.setPreset(0,{adsr1,adsr2});synth.noteOn(0,'C4');at(3901);synth.noteOff(0);at(6103);synth.noteOn(0,'G4');
},{frames:16384});
for(const gain of [31,0x80|17,0xa0|23,0xc0|29,0xe0|31])scene(`GAIN mode ${gain}`,({synth,at})=>{
  synth.setPreset(0,{gain});synth.noteOn(0,'E4');at(1903);synth.setPreset(0,{gain:0x7f});at(3101);synth.setPreset(0,{gain});at(5903);synth.noteOff(0);
});
scene('Noise clocks, eight voices and pitch modulation',({synth,at})=>{
  for(let ch=0;ch<8;ch++)synth.noteOn(ch,45+ch*3);synth.writeDsp(0x3d,0x81);synth.writeDsp(0x2d,0xfe);synth.writeDsp(0x6c,0x3f);
  at(2101);synth.writeDsp(0x6c,0x27);at(3903);synth.writeDsp(0x3d,0x42);at(6101);synth.allNotesOff();
});
scene('Echo RAM, FIR and negative feedback',({synth,at})=>{
  synth.writeDsp(0x6d,0x80);synth.writeDsp(0x7d,1);synth.writeDsp(0x0f,127);for(let i=1;i<8;i++)synth.writeDsp((i<<4)|15,0);
  synth.writeDsp(0x2c,65);synth.writeDsp(0x3c,-45&255);synth.writeDsp(0x0d,-73&255);synth.writeDsp(0x4d,1);synth.writeDsp(0x6c,0);
  synth.noteOn(0,'C4');at(3901);synth.noteOff(0);at(6103);synth.writeDsp(0x0d,90);
},{frames:16384});
scene('Applied Stop retains BRR and patch, reset clears then reuploads',({synth,add,at})=>{
  synth.noteOn(0,'C4');at(1703);add('stop');at(3101);synth.noteOn(0,'G4');at(4703);synth.reset();synth.setPreset(0,{sample:0});synth.noteOn(0,'E4');
});
scene('Explicit physical key-on merges only current DSP frame',({synth,add,at})=>{
  add('key-on',0);add('key-on',7);at(901);add('key-on',1);at(1803);add('key-off',7);at(3101);add('key-off',0);at(4903);add('key-on',0);
});
// Captured timing uses real sub-frame clocks and RAM edits, including equal-clock
// ordered writes and the original upstream four-frame output FIFO.
const ram=new Uint8Array(65536);ram.set(wave,0x400);ram.set([0,4,0,4]);
const dsp=new Uint8Array(128);dsp[0x6c]=0x20;dsp[0x0c]=dsp[0x1c]=127;dsp[0]=dsp[1]=100;dsp[3]=16;dsp[7]=127;
const trace={version:1,clockRate:1024000,durationClocks:4096*32,initialState:{ram,dsp,outputDelayFrames:4},events:new Uint32Array([0,0,0x5c,0,0,0,0x4c,1,1701,0,2,0x80,1701,0,3,0x12,3333,1,0x402,0xff,7001,0,7,0x60,12001,0,0x5c,1])};
scenes.push({name:'Captured timeline, sub-sample ordered RAM/DSP events and four-frame FIFO',frames:8192,sounding:true,events:[{frame:0,op:'timeline',args:[trace]},{frame:0,op:'play-timeline',args:[]}]});
const hex=n=>n.toString(16);
function line({frame,op,args}){
  if(op==='write')return `${frame} write ${hex(args[0])} ${hex(args[1])}`;
  if(op==='load')return `${frame} load ${hex(args[0])} ${Buffer.from(args[1]).toString('hex')}`;
  if(op==='timeline'){const t=args[0];return `${frame} timeline ${t.durationClocks} ${Buffer.from(t.initialState.ram).toString('hex')} ${Buffer.from(t.initialState.dsp).toString('hex')} ${[...t.events].map(hex).join(' ')}`;}
  return `${frame} ${op}${args.length?' '+args.join(' '):''}`;
}
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'tetorica-native-snes-'));fixture=path.join(temporary,'fixture');await compileSdkFixture(fixture,report);}
  execFileSync(fixture,['--self-test'],{stdio:'pipe'});
  const wasmBinary=await fs.readFile(path.join(root,'docs/generated/spc_wasm.wasm'));
  report.wasmSha256=createHash('sha256').update(wasmBinary).digest('hex');
  for(const rate of report.rates)for(const scenario of scenes){
    const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const native=execFileSync(fixture,[String(rate),String(scenario.frames)],{input:events.map(line).join('\n')+'\n',maxBuffer:scenario.frames*8+1048576});
    assert.equal(native.length,scenario.frames*8);const actual=new Float32Array(native.buffer,native.byteOffset,native.length/4);
    const core=await SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});let resampler=new SpcResampler(core,rate,{sourceFrames:1});
    const left=new Float32Array(1),right=new Float32Array(1);let index=0,maximumDifference=0,peak=0,konFrame=-1,pendingKon=0;
    try{for(let frame=0;frame<scenario.frames;frame++){
      while(index<events.length&&events[index].frame===frame){const {op,args}=events[index++];
        if(op==='write'){core.writeDsp(...args);if(args[0]===0x4c){pendingKon=args[1];konFrame=core.nativeFrames;}}
        else if(op==='load')core.loadRam(args[1],args[0]);
        else if(op==='key-on'){const ch=args[0];core.writeDsp(0x5c,core.readDsp(0x5c)&~(1<<ch));if(konFrame!==core.nativeFrames){pendingKon=0;konFrame=core.nativeFrames;}pendingKon|=1<<ch;core.writeDsp(0x4c,pendingKon);}
        else if(op==='key-off'){const ch=args[0];pendingKon&=~(1<<ch);if(konFrame===core.nativeFrames)core.writeDsp(0x4c,pendingKon);core.writeDsp(0x5c,core.readDsp(0x5c)|(1<<ch));}
        else if(op==='reset'){core.reset();resampler.reset();pendingKon=0;konFrame=-1;}
        else if(op==='stop'){const {ram,dsp}=core.snapshot();core.reset();core.loadRam(ram);for(let reg=0;reg<128;reg++)if(![0x4c,0x5c].includes(reg)&&(reg&15)!==8&&(reg&15)!==9)core.writeDsp(reg,dsp[reg]);core.writeDsp(0x4c,0);core.writeDsp(0x5c,255);resampler.reset();pendingKon=0;konFrame=-1;}
        else if(op==='timeline'){core.loadTimeline(args[0]);resampler.reset();}
        else if(op==='play-timeline'){core.restartTimeline();resampler.reset();}
      }
      resampler.render(left,right);
      for(let channel=0;channel<2;channel++){const expected=channel?right[0]:left[0],value=actual[frame*2+channel];assert(Number.isFinite(value));const difference=Math.abs(value-expected);maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));assert.equal(value,expected,`${scenario.name} rate${rate} frame${frame} channel${channel}`);}
    }}finally{core.dispose();}
    if(scenario.sounding)assert(peak>0.0001,`${scenario.name} must produce sound`);
    report.cases.push({name:scenario.name,rate,stereoFrames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
  }
  if(output)await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(`Native SNES: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum PCM difference ${report.maximumDifference}; callback allocation audit passed; no device opened.`);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
