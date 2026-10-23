/** Additional standalone NES/FDS against the shipped Browser Worklet; no device. */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NesApuSynth} from '../web/nesapusynth.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const out=option('--out'),rates=[44100,48000,96000];let fixture=option('--fixture'),temporary,Processor;
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/nesapu_wasm.wasm'));
globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error){this.testError=data.error;reject(Error(data.error));}},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-nes')Processor=processor;};
await import('../docs/js/playground_nes_worklet.js');
const cases=[];
function scenario(name,build,{frames=6144,fds=true,clock=1789773,sounding=true}={}){
  const events=[];let frame=0;
  const add=(op,...args)=>events.push({frame,op,args});
  const transport={clock,fdsEnabled:fds,reset:()=>add('reset'),writeRegister:(address,value)=>add('write',address,value),
    setChannelEnabled:(channel,enabled)=>add('enable',channel,Number(enabled)),loadMemory:(bytes,address)=>add('load',address,bytes.slice())};
  const synth=new NesApuSynth({transport});
  build({add,at:value=>{frame=value;},synth});
  cases.push({name,events,frames,fds,clock,sounding});
}
for(const duty of [.125,.25,.5,.75])scenario(`pulse duty ${duty}, retrigger and independent enables`,({synth,at})=>{
  synth.pulse.setVoice(0,{duty,volume:12});synth.pulse.noteOn(0,'C4');
  at(701);synth.pulse.setVoice(1,{duty:.25,volume:6});synth.pulse.noteOn(1,'G4');
  at(1403);synth.pulse.noteOff(0);at(2101);synth.pulse.noteOn(0,'E4');at(4007);synth.pulse.noteOff(1);
});
scenario('pulse envelopes, sweep negate differences and 4/5-step frame counter',({synth,at})=>{
  for(const ch of [0,1]){synth.pulse.setVoice(ch,{duty:.5,envelope:{period:2,loop:true},sweep:{enabled:true,period:1,negate:true,shift:2}});synth.pulse.noteOn(ch,ch?'E3':'C3');}
  at(1501);synth.writeRegister(0x4017,0x80);at(3103);synth.writeRegister(0x4017,0x40);
  at(5001);synth.pulse.setVoice(0,{sweep:{enabled:true,period:0,negate:false,shift:7}});
},{frames:12288});
scenario('triangle linear and length counters, reload and mute',({synth,add,at})=>{
  synth.triangle.noteOn('A3');at(1103);synth.writeRegister(0x4008,8);at(2301);synth.writeRegister(0x400b,0x18);
  at(3701);add('mute',4);at(4303);add('mute',0);at(5001);synth.triangle.keyOff();
});
for(const shortMode of [false,true])scenario(`noise ${shortMode?'short':'long'} LFSR, envelopes and periods`,({synth,at})=>{
  synth.noise.setVoice({volume:10,period:3,shortMode});synth.noise.noteOn();
  at(1201);synth.writeRegister(0x400c,0x22);at(2503);synth.writeRegister(0x400e,(shortMode?128:0)|12);
  at(4101);synth.noise.noteOff();at(4703);synth.noise.noteOn();
});
for(const rate of [0,5,10,15])scenario(`DMC rate ${rate}, loop, RAM upload and DAC`,({synth,add,at})=>{
  add('load',0xc000,Uint8Array.from({length:65},(_,i)=>(i*73+19)&255));
  synth.writeRegister(0x4010,64|rate);synth.writeRegister(0x4011,64);synth.writeRegister(0x4012,0);synth.writeRegister(0x4013,4);
  add('enable',4,1);at(1901);synth.pulse.noteOn(0,'E4');at(3103);synth.pulse.keyOff(0);
  at(4001);add('load',0xc000,new Uint8Array(65).fill(0x55));at(5003);add('enable',4,0);synth.writeRegister(0x4011,17);
},{frames:8192});
scenario('DMC RAM wrap, finite completion and pulse enable without DMC restart',({synth,add,at})=>{
  add('load',0xffc0,new Uint8Array(64).fill(0xf0));add('load',0x8000,new Uint8Array(64).fill(0x3c));
  synth.writeRegister(0x4010,15);synth.writeRegister(0x4011,80);synth.writeRegister(0x4012,255);synth.writeRegister(0x4013,7);add('enable',4,1);
  at(4001);synth.pulse.noteOn(0,'C4');at(5503);synth.pulse.keyOff(0);
},{frames:12288});
scenario('all APU voices, nonlinear mix and independent output mute masks',({synth,add,at})=>{
  synth.pulse.noteOn(0,'C3');synth.pulse.noteOn(1,'E3');synth.triangle.noteOn('C2');synth.noise.noteOn();
  synth.writeRegister(0x4011,90);for(const [frame,mask]of [[701,1],[1403,3],[2101,7],[2803,15],[3501,31],[4203,0]]){at(frame);add('mute',mask);}
});
scenario('FDS waveform, master volume, frequency and gated RAM writes',({synth,at})=>{
  synth.fds.setWave(Array.from({length:64},(_,i)=>i));synth.fds.setVolume(24);synth.fds.noteOn('C4');
  at(701);synth.fds.setVolume(30,1);at(1403);synth.fds.setVolume(26,2);at(2101);synth.fds.setVolume(32,3);
  at(2803);synth.writeRegister(0x4040,63);at(3501);synth.writeRegister(0x4023,0);synth.writeRegister(0x4082,1);
  at(4203);synth.writeRegister(0x4023,2);synth.fds.noteOn('G4');
});
scenario('FDS modulation, signed bias, force bit and volume/sweep envelopes',({synth,at})=>{
  synth.fds.setModulation({table:Array.from({length:32},(_,i)=>i%8),rate:2100,depth:37,bias:-45});synth.fds.noteOn('A3');
  at(901);synth.writeRegister(0x408a,1);synth.writeRegister(0x4080,0x43);synth.writeRegister(0x4084,0x42);
  at(2701);synth.writeRegister(0x4087,0x4f);synth.writeRegister(0x4085,63);at(4703);synth.fds.setVolume(18);synth.fds.noteOn('C5');
},{frames:12288});
scenario('FDS halt, wave/mod table replacement, clock phase preservation and reset',({synth,add,at})=>{
  synth.fds.noteOn('E4');at(701);add('clock',894887);at(1403);add('clock',2237216);
  at(2101);synth.fds.setWave(Array.from({length:64},(_,i)=>i<32?63:0));synth.fds.setModulation({table:new Uint8Array(32).fill(3),rate:700,depth:10,bias:0});
  at(3103);add('clock',3579546);at(4101);add('reset');at(4703);synth.reset();synth.fds.noteOn('C4');
},{frames:8192});
scenario('Stop gates preserve DMC RAM and FDS waveform for restart',({synth,add,at})=>{
  add('load',0xc000,new Uint8Array(33).fill(0x96));synth.fds.setWave(Array.from({length:64},(_,i)=>(i*3)&63));
  synth.fds.noteOn('A3');synth.pulse.noteOn(0,'E4');at(1003);add('stop');at(2601);synth.fds.noteOn('C4');
  synth.writeRegister(0x4010,79);synth.writeRegister(0x4012,0);synth.writeRegister(0x4013,2);add('enable',4,1);
},{frames:8192});
for(const clock of [1662607,1773448])scenario(`base clock ${clock}, region frame/noise/DMC periods`,({synth,add,at})=>{
  synth.pulse.setVoice(0,{envelope:{period:2,loop:false},duty:.25});synth.pulse.noteOn(0,'C4');synth.triangle.noteOn('G3');synth.noise.noteOn();
  add('load',0xc000,new Uint8Array(17).fill(0x59));synth.writeRegister(0x4010,79);synth.writeRegister(0x4013,1);add('enable',4,1);
  at(3701);synth.writeRegister(0x4017,128);at(7003);synth.fds.noteOn('A4');
},{clock,frames:12288});
scenario('APU without FDS expansion',({synth,at})=>{
  synth.pulse.noteOn(0,'C4');synth.pulse.noteOn(1,'E4');synth.triangle.noteOn('G3');synth.noise.noteOn();
  at(1501);synth.writeRegister(0x4015,0);at(3003);synth.pulse.noteOn(0,'G4');
},{fds:false});
scenario('deterministic raw-register writes, RAM replacement and channel enables',({synth,add,at})=>{
  let seed=0x6e6573;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  const addresses=[...Array.from({length:24},(_,i)=>0x4000+i),0x4023,...Array.from({length:11},(_,i)=>0x4080+i)];
  add('load',0,new Uint8Array(65536).map(()=>random()&255));
  for(let index=0;index<700;index++){
    at(index*19+1);
    if(index%41===0)add('mute',random()&63);
    else if(index%29===0)add('enable',random()%5,random()&1);
    else if(index%67===0){synth.writeRegister(0x4089,128);synth.writeRegister(0x4040+random()%64,random()&63);synth.writeRegister(0x4089,random()&3);}
    else synth.writeRegister(addresses[random()%addresses.length],random()&255);
  }
},{frames:16384});
scenario('long noise/DMC overlap, filter decay and integer state wrap',({synth,add,at})=>{
  synth.noise.setVoice({volume:15,period:0,shortMode:false});synth.noise.noteOn();
  add('load',0xc000,Uint8Array.from({length:4081},(_,i)=>(i*41+31)&255));
  synth.writeRegister(0x4010,79);synth.writeRegister(0x4011,97);synth.writeRegister(0x4013,255);add('enable',4,1);
  at(20003);synth.writeRegister(0x400e,128);at(33001);synth.writeRegister(0x4015,0);
},{frames:48000});
scenario('minimum and maximum outer clock with preserved fractional phase',({synth,add,at})=>{
  synth.pulse.noteOn(0,'C4');synth.fds.noteOn('A4');add('clock',100000);
  at(67);add('clock',100000000);at(131);add('clock',1789773);at(207);add('clock',1789774);
},{frames:512});

for(const clock of[1662607.125,1773448.875])scenario(`fractional constructor clock${clock}, PAL/NTSC base and integer outer changes`,({synth,add,at})=>{
 synth.pulse.noteOn(0,'C4');synth.triangle.noteOn('G3');synth.noise.noteOn();add('load',0xc000,new Uint8Array(33).fill(0x59));
 synth.writeRegister(0x4010,79);synth.writeRegister(0x4013,2);add('enable',4,1);synth.fds.noteOn('E4');
 at(1501);add('clock',2237216);at(3001);add('clock',894887);at(4501);add('clock',1789773);
},{clock,frames:8192});
scenario('individual APU and FDS gate release preserves sibling notes and edited waves',({synth,add,at})=>{
 synth.pulse.noteOn(0,'C4');synth.pulse.noteOn(1,'G4');synth.fds.setWave(Array.from({length:64},(_,i)=>(i*7)&63));synth.fds.setVolume(23);synth.fds.noteOn('A4');
 at(1103);add('stop-channel',0);at(2201);add('stop-channel',5);at(3301);synth.fds.keyOn();at(4403);add('stop-channel',1);
},{frames:8192});
const hex=n=>n.toString(16);
function eventText({frame,op,args}){
 if(op==='write')return `${frame} write ${hex(args[0])} ${hex(args[1])}`;
 if(op==='load')return `${frame} load ${hex(args[0])} ${Buffer.from(args[1]).toString('hex')}`;
 return `${frame} ${op}${args.length?' '+args.join(' '):''}`;
}
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),rates,cases:[],maximumDifference:0,totalStereoFrames:0,
 reference:'Actual deployed playground_nes_worklet.js renderSegment with shipped nesapu_wasm.wasm and ChipClockResampler; 1/128/irregular callback splits',
 wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),limits:'Offline standalone core PCM and C++ callback allocation audit only. Primary-compatible shared canonical NES/FDS core, independent64KiB DMC RAM and optionalFDS, no hidden siblings. Public NTSC/PAL and fractional constructor clocks are kept distinct from integer outer clock changes. Self-test covers instance/memory/clock/FDS isolation, observation preserving phase, full and individual gate Stop, finite DMC lifetime, reset and RAM/patch retention, bounds and zero callback allocation/free. Scheduling/ownership/IPC/UI are checked separately; no audio device or subjective listening, cross-platform compiler or real-time deadline guarantee.'};
try{
 if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-extra-nes-'));fixture=path.join(temporary,'fixture');execFileSync('clang++',['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off',...['src/native_genesis_nes_fixture.cpp','src/native_genesis_nes.cpp'].map(file=>path.join(project,file)),'-o',fixture],{stdio:'pipe'});}
 const result=spawnSync(fixture,['--self-test'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);report.selfTest=JSON.parse(result.stderr);report.memoryCopyBenchmark=JSON.parse(execFileSync(fixture,['--memory-copy-benchmark'],{encoding:'utf8'}));
 for(const rate of rates)for(const scenario of cases){
  const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame),bytes=execFileSync(path.resolve(fixture),[String(rate),String(scenario.clock),String(scenario.frames),String(Number(scenario.fds))],{input:events.map(eventText).join('\n')+'\n',maxBuffer:scenario.frames*8+1048576,timeout:30000});
  assert.equal(bytes.length,scenario.frames*8);const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  for(const split of[[1],[128],[3,127,1,64,17,256]]){globalThis.sampleRate=rate;const reference=new Processor({processorOptions:{clock:scenario.clock,fds:scenario.fds,wasmBinary}});await reference.testReady;
   let next=0,frame=0,block=0,maximumDifference=0,peak=0,first;
   try{while(frame<scenario.frames){globalThis.currentFrame=frame;
    while(next<events.length&&events[next].frame===frame){const {op,args}=events[next++];
     if(op==='mute'){for(let channel=0;channel<(scenario.fds?6:5);channel++)reference.chip.setChannelMuted(channel,!!(args[0]&(1<<channel)));continue;}
     let method=op==='write'?'writeRegister':op==='load'?'loadMemory':op==='enable'?'setChannelEnabled':op==='stop'?'stopVoices':op,values=args;
     if(op==='load')values=[args[1],args[0]];else if(op==='enable')values=[args[0],!!args[1]];
     else if(op==='stop-channel'){method=args[0]===5?'writeRegister':'setChannelEnabled';values=args[0]===5?[0x4083,reference.inspector.registers[0x83]|128]:[args[0],false];}
     reference.apply({method,args:values},reference.port);assert.equal(reference.testError,undefined,reference.testError);
    }
    const count=Math.min(scenario.frames-frame,split[block++%split.length],next<events.length?events[next].frame-frame:Infinity),left=new Float32Array(count),right=new Float32Array(count);assert(count>0);reference.renderSegment(left,right);
    for(let i=0;i<count;i++)for(let channel=0;channel<2;channel++){const value=actual[(frame+i)*2+channel],want=channel?right[i]:left[i],difference=Math.abs(value-want);assert(Number.isFinite(value));if(difference&&!first)first={frame:frame+i,channel,native:value,wasm:want};maximumDifference=Math.max(maximumDifference,difference);peak=Math.max(peak,Math.abs(value));}
    frame+=count;
   }
   assert.equal(maximumDifference,0,`${rate}Hz ${scenario.name} split${split}: ${JSON.stringify(first)}`);if(scenario.sounding)assert(peak>1e-4,scenario.name+' must sound');
   report.cases.push({name:scenario.name,sampleRate:rate,baseClock:scenario.clock,fds:scenario.fds,split,frames:scenario.frames,maximumDifference,peak});report.maximumDifference=Math.max(report.maximumDifference,maximumDifference);report.totalStereoFrames+=scenario.frames;
   }finally{reference.dispose();}
  }
 }
 report.status='passed';if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(`Native additional NES/FDS: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference ${report.maximumDifference}`);console.log(JSON.stringify(report.selfTest));
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
