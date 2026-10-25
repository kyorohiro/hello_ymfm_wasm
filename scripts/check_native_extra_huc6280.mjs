/** Additional standalone HuC6280 against the shipped Browser Worklet; no device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Huc6280Synth} from '../web/huc6280synth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri/src');
const sdk=path.resolve(project,'../vendor/tetorica-soundchip-native');
const option=name=>{const equal=process.argv.find(value=>value.startsWith(name+'=')),index=process.argv.indexOf(name);if(equal===undefined&&index<0)return null;const value=equal===undefined?process.argv[index+1]:equal.slice(name.length+1);assert(value&&!value.startsWith('--'),`${name} needs a value`);return value;};
const reportPath=option('--out');let fixture=option('--fixture'),temporary,Processor;
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/huc6280_wasm.wasm'));
globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error){this.testError=data.error;reject(Error(data.error));}},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-huc6280')Processor=processor;};
await import('../docs/js/playground_huc6280_worklet.js');
const rates=[44100,48000,96000],cases=[];
function scenario(name,build,{frames=6144}={}){
  let frame=0;const events=[],add=(op,...args)=>events.push({frame,op,args});
  const synth=new Huc6280Synth({transport:{reset:()=>add('reset'),writeRegister:(r,v,ch)=>add('write',r,v,ch)}});
  synth.initialize();build({synth,add,at:value=>{frame=value;}});cases.push({name,frames,events});
}
scenario('six voices, independent waveform/period/volume/balance and key gates',({synth,at})=>{
  for(let ch=0;ch<6;ch++){synth.setWaveform(ch,Array.from({length:32},(_,i)=>(i*(ch+1))&31));synth.setVolume(ch,16+ch*2);synth.setPan(ch,15-ch*2,ch*3);synth.noteOn(ch,48+ch*4);}
  at(701);synth.keyOff(1);synth.setVolume(0,4);at(2303);synth.noteOn(1,'G4');synth.setMasterVolume(12,8);at(4501);synth.allNotesOff();
});
for(const ch of [4,5])scenario(`noise channel ${ch}, all frequency codes and stateful LFSR`,({synth,at})=>{
  synth.setVolume(ch,31);synth.setNoise(ch,{enabled:true,frequency:0});synth.keyOn(ch);
  for(let code=0;code<32;code++){at(code*181+1);synth.setNoise(ch,{enabled:true,frequency:code});}
});
for(const depth of [1,2,3])scenario(`LFO depth ${depth}, source voice audible, reset, frequency and period zero`,({synth,at})=>{
  synth.setWaveform(0,Array.from({length:32},(_,i)=>i));synth.setWaveform(1,Array.from({length:32},(_,i)=>i<16?24:8));
  synth.setFrequency(0,440);synth.setFrequency(1,2000);synth.setLfo({frequency:31,depth});synth.keyOn(0);synth.keyOn(1);
  at(901);synth.setLfo({frequency:7,depth,reset:true});at(1901);synth.setLfo({frequency:11,depth});
  at(3301);synth.writeRegister(0,0);synth.writeRegister(2,0);synth.writeRegister(3,0);
});
scenario('DDA sample writes, waveform pointer reset and simultaneous wavetable',({synth,add,at})=>{
  synth.setDda(2,true);synth.keyOn(2);synth.noteOn(0,'E4');
  for(let i=0;i<400;i++){at(i*11+1);synth.writeDda(2,(i*7)&31);}
  at(4601);synth.setDda(2,false);synth.noteOn(2,'G3');at(5103);add('waveform',2,Array.from({length:32},(_,i)=>31-i));
});
scenario('inspector waveform replacement retains active key/DDA sample and raw latch',({synth,add,at})=>{
  synth.noteOn(0,'C4');synth.setDda(3,true);synth.writeDda(3,27);synth.keyOn(3);synth.writeRegister(0,7);
  at(901);add('waveform',0,Array.from({length:32},(_,i)=>i<16?31:0));
  at(1901);add('waveform',3,Array.from({length:32},(_,i)=>i));
  at(3301);add('write',4,159,1);add('write',2,177,1);add('write',5,255,1);
});
scenario('raw selected slots 6/7 and explicit channel writes do not alter selection',({synth,add,at})=>{
  synth.noteOn(1,'A3');synth.writeRegister(0,7);synth.writeRegister(4,159);synth.writeRegister(6,7);
  at(901);add('write',2,77,1);add('write',3,1,1);add('write',5,0x8f,1);
  at(1901);add('write',0,6,-1);add('write',4,95,-1);add('write',6,29,-1);
  at(2501);add('write',4,31,1);at(3601);add('write',4,159,1);
});
scenario('active waveform raw writes use the real advanced oscillator pointer',({synth,add,at})=>{
  synth.noteOn(0,'A4');for(let i=0;i<48;i++){at(i*101+1);add('write',6,(i*13)&31,0);}
});
scenario('Stop retains waves, DDA, master balance, LFO, clock and selection',({synth,add,at})=>{
  synth.setMasterVolume(14,11);synth.setWaveform(0,Array.from({length:32},(_,i)=>(i*3)&31));synth.noteOn(0,'C4');
  synth.setDda(3,true);synth.writeDda(3,25);synth.keyOn(3);synth.writeRegister(0,7);
  at(701);add('clock',4474431);at(1701);add('stop');at(2801);add('write',4,152,0);add('write',4,216,3);
});
scenario('outer clock changes include fractional hold, reset, min and max rates',({synth,add,at})=>{
  synth.noteOn(0,'A4');at(701);add('clock',1789772);at(1403);add('clock',4474431);at(2101);add('clock',7159090);
  at(2803);add('reset');at(2901);synth.initialize();synth.noteOn(1,'E4');at(3301);add('clock',100000);
  at(3401);add('clock',100000000);at(3501);add('clock',3579545);
});
scenario('deterministic raw writes, all modes and cold reset',({synth,add,at})=>{
  let seed=0x6280;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let i=0;i<600;i++){at(i*9+1);const r=random()%10;add('write',r,random()&255,r>=2&&r<=7?random()%6:-1);}
  at(5601);synth.initialize();synth.noteOn(0,'G4');
});

scenario('output mutes retain six oscillator phases, shared LFO, noise and selected latch',({synth,add,at})=>{
 for(let ch=0;ch<6;ch++){synth.setWaveform(ch,Array.from({length:32},(_,i)=>(i*(ch+1))&31));synth.noteOn(ch,48+ch*3);}
 synth.setNoise(4,{enabled:true,frequency:7});synth.setNoise(5,{enabled:true,frequency:31});synth.setLfo({frequency:13,depth:2});synth.writeRegister(0,7);
 for(const[frame,mask]of[[701,1],[1403,3],[2101,15],[2803,63],[3501,48],[4203,0]]){at(frame);add('mute',mask);}
});
scenario('individual DDA gate release preserves unrelated wave and noise channels',({synth,add,at})=>{
 synth.noteOn(0,'E4');synth.setDda(3,true);synth.writeDda(3,29);synth.keyOn(3);synth.setNoise(4,{enabled:true,frequency:14});synth.keyOn(4);synth.writeRegister(0,7);
 at(701);add('off',3);at(1403);synth.keyOn(3);at(2101);add('off',0);at(2803);add('off',4);at(3501);add('off',3);
});
scenario('muted reset preserves output mask and independent clock state',({synth,add,at})=>{
 synth.noteOn(0,'C4');at(701);add('mute',1);at(1403);add('clock',4474431);at(2101);add('reset');synth.initialize();synth.noteOn(0,'G4');at(3501);add('mute',0);
});
scenario('long LFO and dual-noise progression across arbitrary callback boundaries',({synth,at})=>{
 synth.noteOn(0,'A3');synth.noteOn(1,'C3');synth.setLfo({frequency:19,depth:3});
 for(const ch of[4,5]){synth.setNoise(ch,{enabled:true,frequency:ch===4?0:31});synth.keyOn(ch);}
 at(17003);synth.setLfo({frequency:1,depth:1});at(33001);synth.setLfo({frequency:255,depth:2,reset:true});
},{frames:48000});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed playground_huc6280_worklet.js renderSegment, shipped huc6280_wasm.wasm and ChipClockResampler',wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
 limits:'Offline standalone core PCM comparison and C++ allocation audit. No device, Rust scheduling, IPC, UI, effects, other-platform compiler or real-time deadline guarantee. Six wavetable/DDA channels, CH4/5 noise, shared LFO and raw slots6/7 are per-instance. Mute changes output gain while oscillator/LFO/noise state progresses. Public constructor base3579545Hz and acknowledged integer outer-clock changes100k..100MHz.'};
try{
 if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-extra-huc6280-'));fixture=path.join(temporary,'fixture');
  const sources=[path.join(sdk,'native/reference/tauri/native_genesis_huc6280.cpp'),path.join(project,'native_genesis_huc6280_fixture.cpp')];
  const inputs=[...sources,path.join(sdk,'native/reference/tauri/native_genesis_huc6280.h'),path.join(sdk,'vendor/mame-huc6280/huc6280.cpp'),path.join(sdk,'vendor/mame-huc6280/huc6280.h'),path.join(project,'native_genesis_huc6280.h')];
  report.nativeSources=await Promise.all(inputs.map(async file=>({file:path.relative(root,file),sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')})));
  execFileSync('clang++',['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+path.join(sdk,'vendor/mame-huc6280'),...sources,'-o',fixture],{stdio:'pipe'});}
 report.selfTest=JSON.parse(execFileSync(fixture,['--self-test'],{encoding:'utf8'}));
 for(const rate of rates)for(const scenario of cases){
  const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame);
  const input=events.map(({frame,op,args})=>`${frame} ${op}${args.length?' '+(op==='waveform'?args[0]+' '+Buffer.from(args[1]).toString('hex'):args.join(' ')):''}`).join('\n')+'\n';
  const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*8+1048576,timeout:30000});
  assert.equal(bytes.length,scenario.frames*8);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  for(const split of[[1],[128],[3,127,1,64,17,256]]){
   globalThis.sampleRate=rate;const reference=new Processor({processorOptions:{clock:3579545,wasmBinary}});await reference.testReady;
   let next=0,frame=0,block=0,maximumDifference=0,peak=0,first;
   try{while(frame<scenario.frames){globalThis.currentFrame=frame;
    while(next<events.length&&events[next].frame===frame){const{op,args}=events[next++];
     if(op==='mute'){for(let ch=0;ch<6;ch++)reference.chip.setChannelMuted(ch,!!(args[0]&(1<<ch)));continue;}
     const method={write:'writeRegister',waveform:'setWaveform',off:'keyOff',clock:'clock',stop:'stopVoices',reset:'reset'}[op];assert(method,op);
     reference.apply({method,args:op==='write'?args.slice(0,2):args,...(op==='write'?{channel:args[2]}:{})},reference.port);assert.equal(reference.testError,undefined,reference.testError);
    }
    const count=Math.min(scenario.frames-frame,split[block++%split.length],next<events.length?events[next].frame-frame:Infinity),left=new Float32Array(count),right=new Float32Array(count);assert(count>0);reference.renderSegment(left,right);
    for(let i=0;i<count;i++)for(let ch=0;ch<2;ch++){const value=actual[(frame+i)*2+ch],expected=ch?right[i]:left[i],difference=Math.abs(value-expected);assert(Number.isFinite(value));if(difference&&!first)first={frame:frame+i,channel:ch,native:value,wasm:expected};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}
    frame+=count;
   }
   assert.equal(maximumDifference,0,`${rate}Hz ${scenario.name} split${split}: ${JSON.stringify(first)}`);assert(peak>1e-4,scenario.name+' must sound');
   report.cases.push({name:scenario.name,sampleRate:rate,split,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
   }finally{reference.dispose();}
  }
 }
 report.status='passed';if(reportPath)await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(`Native additional HuC6280: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);console.log(JSON.stringify(report.selfTest));
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
