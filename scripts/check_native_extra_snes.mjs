/** Additional standalone S-DSP vs the actual deployed Worklet/WASM. No device. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {SnesSynth} from '../web/snessynth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const output=option('--out'),provided=option('--fixture');
let temporary,fixture=provided,Processor;
globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testMessages=[];this.port={postMessage:data=>{this.testMessages.push(data);if(data.error)this.testError=data.error;},close(){}};}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-playground-snes')Processor=processor;};
await import('../docs/js/playground_snes_worklet.js');
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/spc_wasm.wasm'));
const report={schemaVersion:1,deviceOpened:false,rates:[44100,48000,96000],cases:[],totalStereoFrames:0,maximumDifference:0,
  wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),
  reference:'Actual deployed playground_snes_worklet.js with shipped accurateSPC_DSP WASM and SpcResampler; instrument sourceFrames1, captured timeline sourceFrames128. No SPC700 CPU, ROM or game audio.',
  limits:'Offline standalone core, fixed32kHz DSP / output interpolation, RAM/BRR/DSP/timeline lifecycle and new/delete audit. No output device, Rust queue ownership, IPC, UI, effects, other-platform compiler or callbackdeadline guarantee. Constructor has no clock option; SNES sample clock is fixed32000Hz.'};
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
scene('Eight physical voices, full pitch range and retrigger after KOFF',({synth,at})=>{
  for(let ch=0;ch<8;ch++){synth.setPitch(ch,[0,1,17,511,4096,8191,12345,16383][ch]);synth.keyOn(ch);}
  at(1701);for(let ch=0;ch<8;ch++)synth.keyOff(ch);
  at(2503);for(let ch=0;ch<8;ch++){synth.setPitch(ch,16383-ch*1700);synth.keyOn(ch);}
});
for(const filter of[0,1,2,3])scene(`BRR filter${filter}, high range wrap and loop address`,({synth,add,at})=>{
  const brr=wave.slice();brr[0]=0xc0|(filter<<2);brr[9]=0xc3|(filter<<2);add('load',0x400,brr);synth.keyOn(0);
  at(1701);const high=brr.slice();high[0]=0xf0|(filter<<2);high[9]=0xf3|(filter<<2);add('load',0x400,high);
  at(3101);synth.setPitch(0,0x3fff);at(4703);synth.setPitch(0,0x456);
});
scene('One-shot BRR ENDX and directory boundary sample255',({synth,add,at})=>{
  const oneShot=wave.slice();oneShot[9]=0xb1;add('load',0x400,oneShot);add('load',0x3fc,new Uint8Array([0,4,0,4]));
  synth.writeDsp(4,255);synth.keyOn(0);at(2301);synth.keyOn(0);at(4503);synth.writeDsp(0x7c,255);synth.keyOn(0);
});
scene('Echo writes wrap at RAM end without leaking between allocations',({synth,at})=>{
  synth.writeDsp(0x6d,255);synth.writeDsp(0x7d,1);synth.writeDsp(0x0f,127);for(let i=1;i<8;i++)synth.writeDsp((i<<4)|15,0);
  synth.writeDsp(0x2c,63);synth.writeDsp(0x3c,63);synth.writeDsp(0x0d,77);synth.writeDsp(0x4d,1);synth.writeDsp(0x6c,0);synth.keyOn(0);
  at(1901);synth.writeDsp(0x6c,0x20);at(3903);synth.writeDsp(0x6c,0);
});
scene('Soft reset and output mute flags retain physical DSP progression',({synth,at})=>{
  synth.keyOn(0);at(901);synth.writeDsp(0x6c,0x60);at(1903);synth.writeDsp(0x6c,0x20);
  at(2901);synth.writeDsp(0x6c,0xa0);at(3903);synth.writeDsp(0x6c,0x20);synth.keyOn(0);
});
scene('Explicit register/state/RAM reads preserve interpolation and envelope phase',({synth,at,add})=>{
  synth.setPreset(0,{adsr1:0x8f,adsr2:0x60});synth.keyOn(0);
  for(let i=0;i<350;i++){at(i*19+1);add('read');}at(7001);synth.keyOff(0);
});
// Captured timing uses real sub-frame clocks and RAM edits, including equal-clock
// ordered writes and the original upstream four-frame output FIFO.
const ram=new Uint8Array(65536);ram.set(wave,0x400);ram.set([0,4,0,4]);
const dsp=new Uint8Array(128);dsp[0x6c]=0x20;dsp[0x0c]=dsp[0x1c]=127;dsp[0]=dsp[1]=100;dsp[3]=16;dsp[7]=127;
const trace={version:1,clockRate:1024000,durationClocks:4096*32,initialState:{ram,dsp,outputDelayFrames:4},events:new Uint32Array([0,0,0x5c,0,0,0,0x4c,1,1701,0,2,0x80,1701,0,3,0x12,3333,1,0x402,0xff,7001,0,7,0x60,12001,0,0x5c,1])};
scenes.push({name:'Captured timeline, sub-sample ordered RAM/DSP events and four-frame FIFO',frames:8192,sounding:true,events:[{frame:0,op:'timeline',args:[trace]},{frame:0,op:'play-timeline',args:[]}]});
scenes.push({name:'Captured timeline pause/replay resets interpolation without retaining render-ahead',frames:16384,sounding:true,events:[{frame:0,op:'timeline',args:[trace]},{frame:0,op:'play-timeline',args:[]},{frame:1403,op:'stop-timeline',args:[]},{frame:2501,op:'read',args:[]},{frame:3101,op:'play-timeline',args:[]},{frame:5103,op:'stop-timeline',args:[]},{frame:6101,op:'play-timeline',args:[]}]});
const trace2={...trace,initialState:{...trace.initialState,ram:ram.slice(),dsp:dsp.slice()}};trace2.initialState.ram[0x402]^=255;trace2.initialState.dsp[0]=45;trace2.initialState.dsp[1]=120;trace2.initialState.dsp[3]=8;
scenes.push({name:'Prepared timeline replacement has independent initial RAM and DSP arrays',frames:16384,sounding:true,events:[{frame:0,op:'timeline',args:[trace]},{frame:0,op:'play-timeline',args:[]},{frame:1901,op:'timeline',args:[trace2]},{frame:3101,op:'play-timeline',args:[]},{frame:10003,op:'stop-timeline',args:[]}]});
const hex=n=>n.toString(16);
function line({frame,op,args}){
  if(op==='write')return `${frame} write ${hex(args[0])} ${hex(args[1])}`;
  if(op==='load')return `${frame} load ${hex(args[0])} ${Buffer.from(args[1]).toString('hex')}`;
  if(op==='timeline'){const t=args[0];return `${frame} timeline ${t.durationClocks} ${Buffer.from(t.initialState.ram).toString('hex')} ${Buffer.from(t.initialState.dsp).toString('hex')} ${[...t.events].map(hex).join(' ')}`;}
  return `${frame} ${op}${args.length?' '+args.join(' '):''}`;
}
try{
  if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'tetorica-native-snes-'));fixture=path.join(temporary,'fixture');execFileSync('clang++',['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+path.join(project,'native-snes/snapshot/third_party/snes-spc/snes_spc'),path.join(project,'src/native_genesis_snes_fixture.cpp'),path.join(project,'src/native_genesis_snes.cpp'),path.join(project,'native-snes/snapshot/third_party/snes-spc/snes_spc/SPC_DSP.cpp'),'-o',fixture],{stdio:'pipe'});}
  report.selfTest=JSON.parse(execFileSync(fixture,['--self-test-extra'],{encoding:'utf8'}));
  for(const rate of report.rates)for(const scenario of scenes){
    const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
    const native=execFileSync(fixture,[String(rate),String(scenario.frames)],{input:events.map(line).join('\n')+'\n',maxBuffer:scenario.frames*8+1048576});
    assert.equal(native.length,scenario.frames*8);const actual=new Float32Array(native.buffer,native.byteOffset,native.length/4);
    for(const split of[[1],[128],[3,127,1,64,17,256]]){
      globalThis.sampleRate=rate;const reference=new Processor({processorOptions:{wasmBinary}});await reference.ready;assert(reference.synth,reference.testError);
      let next=0,frame=0,block=0,maximumDifference=0,peak=0;
      try{while(frame<scenario.frames){
        globalThis.currentFrame=frame;
        while(next<events.length&&events[next].frame===frame){const{op,args}=events[next++];
          if(op==='write')reference.synth.writeDsp(...args);
          else if(op==='load')reference.synth.core.loadRam(args[1],args[0]);
          else if(op==='key-on'||op==='key-off'){
            const ch=args[0],s=reference.synth;
            if(op==='key-on'){s.koff&=~(1<<ch);s.core.writeDsp(0x5c,s.koff);if(s.konFrame!==s.core.nativeFrames){s.pendingKon=0;s.konFrame=s.core.nativeFrames;}s.pendingKon|=1<<ch;s.core.writeDsp(0x4c,s.pendingKon);}
            else{s.pendingKon&=~(1<<ch);if(s.konFrame===s.core.nativeFrames)s.core.writeDsp(0x4c,s.pendingKon);s.koff|=1<<ch;s.core.writeDsp(0x5c,s.koff);}
          }
          else if(op==='stop')reference.stopVoices();
          else if(op==='read'){reference.synth.snapshot();for(let reg=0;reg<128;reg++)reference.synth.readDsp(reg);}
          else{const method={reset:'reset',timeline:'prepareTimeline','play-timeline':'playTimeline','stop-timeline':'stopTimeline'}[op];assert(method,op);reference.apply({method,args},reference.port);assert.equal(reference.testError,undefined,reference.testError);}
        }
        const count=Math.min(scenario.frames-frame,split[block++%split.length],next<events.length?events[next].frame-frame:Infinity);assert(count>0);
        const left=new Float32Array(count),right=new Float32Array(count);reference.renderSegment(left,right);
        for(let i=0;i<count;i++)for(let channel=0;channel<2;channel++){const value=actual[(frame+i)*2+channel],expected=channel?right[i]:left[i];assert(Number.isFinite(value));maximumDifference=Math.max(maximumDifference,Math.abs(value-expected));peak=Math.max(peak,Math.abs(value));assert.equal(value,expected,`${scenario.name} rate${rate} split${split} frame${frame+i} channel${channel}`);}
        frame+=count;
      }}finally{reference.dispose();}
      if(scenario.sounding)assert(peak>0.0001,`${scenario.name} must produce sound`);
      report.cases.push({name:scenario.name,rate,split,stereoFrames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
    }
  }
  if(output)await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(`Native additional SNES: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum PCM difference ${report.maximumDifference}; callback allocation audit passed; no device opened.`);
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
