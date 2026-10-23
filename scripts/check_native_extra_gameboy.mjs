/** Standalone additional DMG APU against the deployed Browser Worklet; no device. */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const out=option('--out'),rates=[44100,48000,96000],cases=[];
let fixture=option('--fixture'),temporary,Processor;
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/gameboy_apu_wasm.wasm'));
globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error)reject(Error(data.error));},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-gameboy')Processor=processor;};
await import('../docs/js/playground_gameboy_worklet.js');
const W=(frame,address,value)=>({frame,op:'write',address,value}),C=(frame,value)=>({frame,op:'clock',address:0,value}),M=(frame,value)=>({frame,op:'mute',address:0,value});
const base=[W(0,22,128),W(0,20,0x77),W(0,21,0xff)];
const pulse=(frame,ch,period,duty=2,envelope=0xa0)=>[W(frame,ch*5+1,duty<<6),W(frame,ch*5+2,envelope),W(frame,ch*5+3,period&255),W(frame,ch*5+4,128|(period>>8))];
const wave=(frame,period)=>[W(frame,10,0),...Array.from({length:16},(_,i)=>W(frame,32+i,(i<<4)|(15-i))),W(frame,12,0x20),W(frame,10,128),W(frame,13,period&255),W(frame,14,128|(period>>8))];
const noise=(frame,value)=>[W(frame,17,0xa1),W(frame,18,value),W(frame,19,128)];
cases.push({name:'cold DMG state and silence',frames:2048,events:[],allowSilent:true});
for(let duty=0;duty<4;duty++)cases.push({name:`pulse duty${duty}, independent envelope and DAC stop`,frames:8192,events:[...base,...pulse(0,0,1750,duty),...pulse(127,1,1930,3-duty),W(4097,2,0)]});
cases.push({name:'pulse sweep, envelope and length quirks',frames:20000,events:[...base,W(0,0,0x11),...pulse(0,0,1200,2,0xf2),W(2048,0,0x19),W(3000,4,0xc4),W(7000,6,63),...pulse(7000,1,1860,1,0x39),W(7001,9,0xc7)]});
cases.push({name:'wave RAM busy access and level changes',frames:8192,events:[...base,...wave(0,1900),...Array.from({length:64},(_,i)=>W(100+i*13,32+(i%16),(i*37)&255)),W(1900,10,0),...wave(1901,1980),W(3000,12,0x40),W(4000,12,0x60),W(6000,10,0)]});
for(const nr43 of[0,0x17,0x39,0x67])cases.push({name:`noise divisor, width and shift${nr43}`,frames:8192,events:[...base,...noise(0,nr43),W(2049,18,nr43^8),W(4099,17,0)]});
cases.push({name:'all4channels, stereo, master volume and power',frames:8192,events:[...base,...pulse(0,0,1700),...pulse(0,1,1900),...wave(0,1950),...noise(0,0x29),W(1000,21,0x51),W(2000,20,0x21),W(3000,22,0),W(3001,32,0xf1),W(4000,22,128),W(4000,20,0x77),W(4000,21,0xff),...pulse(4000,0,1800),W(5000,21,0x10)]});
cases.push({name:'fractional outer clocks, minimum and maximum boundaries',frames:14000,events:[...base,...pulse(0,0,1830),...wave(0,1970),...noise(0,0x31),C(999,2097152),C(1999,8388608),C(3001,3579545),C(5001,4194304),C(6001,100000),C(6501,100000000),C(6701,4194304),W(9000,2,0)]});
cases.push({name:'reset while active preserves clock, DMG RAM then replay',frames:8192,events:[...base,...wave(0,1980),...pulse(0,0,1750),C(501,3579545),{frame:3000,op:'reset',address:0,value:0},...base.map(e=>({...e,frame:3010})),...pulse(3010,1,1900),...wave(3011,1900)]});
cases.push({name:'individual and combined source mute preserve phase through reset',frames:12000,events:[...base,...pulse(0,0,1750),...pulse(0,1,1930),...wave(0,1970),...noise(0,0x39),...[1,2,4,8,3,12,15,0].map((mask,i)=>M(301+i*701,mask)),C(601,2097152),C(2001,8388608),M(7001,5),{frame:8001,op:'reset',address:0,value:0},...base.map(e=>({...e,frame:8010})),...pulse(8010,0,1750),...pulse(8010,1,1930),...wave(8010,1970),...noise(8010,0x39),M(10001,0)]});
let seed=0x1842;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
const raw=[...base];for(let i=0;i<300;i++){const address=random()%48,value=random()&255;raw.push(W(1+i*23,address,address===22?128:value));}
cases.push({name:'deterministic raw writes including gaps and ignored addresses',frames:8192,events:[...raw,W(8001,48,255),W(8002,255,255)]});
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed playground_gameboy_worklet.js renderSegment with shipped gameboy_apu_wasm.wasm and ChipClockResampler; 1/128/irregular callback splits',wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),rates,cases:[],maximumDifference:0,totalStereoFrames:0,limits:'Offline PCM comparison and C++ self-test only. Existing standalone Native GameBoy core reused without hidden sibling chips. Self-test covers instance/clock/wave-RAM isolation, read-only state observation, Stop/channel Stop register retention, source-mute phase/register/reset semantics, rate and clock guards, zero callback allocation/free. Source mute calls the same public low-level WASM mask used by this pinned core. Rust/control/IPC/UI tested separately; no audio device, subjective listening or cross-platform compiler used.'};
try{
 if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-extra-gameboy-'));fixture=path.join(temporary,'fixture');execFileSync('clang++',['-std=c++17','-O2','-ffp-contract=off','-fwrapv','-fno-strict-aliasing','-I'+path.join(project,'native-gameboy/snapshot/third_party/mame-gameboy'),...['src/native_genesis_gameboy_fixture.cpp','src/native_genesis_gameboy.cpp','native-gameboy/snapshot/third_party/mame-gameboy/gameboy_apu.cpp'].map(file=>path.join(project,file)),'-o',fixture],{stdio:'pipe'});}
 // The fixture emits its compact self-test JSON to stderr, preserving primary harness output.
 const selfResult=spawnSync(fixture,['--self-test'],{encoding:'utf8'});assert.equal(selfResult.status,0,selfResult.stderr);report.selfTest=JSON.parse(selfResult.stderr);
 for(const rate of rates)for(const scenario of cases){globalThis.sampleRate=rate;const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame),input=events.map(({frame,op,address,value})=>`${frame} ${op} ${address} ${value}`).join('\n')+'\n';const bytes=execFileSync(fixture,[String(rate),String(scenario.frames)],{input,maxBuffer:scenario.frames*8+1048576,timeout:30000});assert.equal(bytes.length,scenario.frames*8);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  for(const split of[[1],[128],[3,127,1,64,17,256]]){const reference=new Processor({processorOptions:{wasmBinary}});await reference.testReady;let next=0,frame=0,block=0,maximumDifference=0,peak=0,first;
   try{while(frame<scenario.frames){globalThis.currentFrame=frame;while(next<events.length&&events[next].frame===frame){const e=events[next++];if(e.op==='mute')reference.chip.setMuteMask(e.value);else reference.apply({method:e.op==='write'?'writeRegister':e.op,args:e.op==='write'?[e.address,e.value]:[e.value]},reference.port);}
    const count=Math.min(scenario.frames-frame,split[block++%split.length],next<events.length?events[next].frame-frame:Infinity),left=new Float32Array(count),right=new Float32Array(count);assert(count>0);reference.renderSegment(left,right);
    for(let i=0;i<count;i++)for(let ch=0;ch<2;ch++){const value=actual[(frame+i)*2+ch],want=ch?right[i]:left[i],difference=Math.abs(value-want);assert(Number.isFinite(value));if(difference&&!first)first={frame:frame+i,ch,native:value,wasm:want};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}frame+=count;
   }assert.equal(maximumDifference,0,`${scenario.name} at${rate} split${split}: ${JSON.stringify(first)}`);if(!scenario.allowSilent)assert(peak>1e-4,scenario.name+' must sound');report.cases.push({name:scenario.name,sampleRate:rate,split,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
   }finally{reference.dispose();}
  }
 }
 report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(`Native additional GameBoy: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);console.log(JSON.stringify(report.selfTest));
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
