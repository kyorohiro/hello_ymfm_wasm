/** Native standalone PWM vs the shipped AudioWorklet/WASM and JS reference. No device. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PWM32XPlayback} from '../web/pwm32x_playback.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),project=path.join(root,'w/tetorica-fm2612-playground-tauri/src-tauri');
const option=name=>{const i=process.argv.indexOf(name);assert(i<0||process.argv[i+1]);return i<0?null:process.argv[i+1];};
const reportPath=option('--out');let fixture=option('--fixture'),temporary,Processor;
const wasmBinary=await fs.readFile(path.join(root,'docs/generated/pwm32x_wasm.wasm'));
globalThis.sampleRate=48000;globalThis.currentFrame=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.testReady=new Promise((resolve,reject)=>{this.port={postMessage:data=>{if(data.ready)resolve();else if(data.error){this.testError=data.error;reject(Error(data.error));}},close(){}};});}};
globalThis.registerProcessor=(name,processor)=>{if(name==='tetorica-pwm32x')Processor=processor;};
await import('../docs/js/playground_pwm_worklet.js');
const rates=[44100,48000,96000],cases=[];
function scenario(name,build,{frames=6144,configurationOnly=false}={}) {
 let frame=0;const events=[],add=(op,a=0,b=0)=>events.push({frame,op,a,b});
 build({add,at:value=>{frame=value;},write:(r,v)=>add('write',r,v),start:(control=5,cycle=1000)=>{add('write',0,control);add('write',1,cycle);}});
 cases.push({name,frames,configurationOnly,events});
}
scenario('independent stereo FIFOs, overflow, underflow and held DAC output',({write,start,at})=>{
 start();for(const v of[300,600,900,1200])write(2,v);for(const v of[1700,1400,1100])write(3,v);
 for(let i=0;i<150;i++){at(i*31+11);write(2,(i*173)&4095);if(i%3)write(3,(i*311)&4095);}
 at(5301);write(4,800);
});
for(let control=0;control<16;control++)scenario(`routing ${control}: disabled, direct, crossed and shared outputs`,({start,write,at})=>{
 start(control,777);for(let i=0;i<250;i++){at(i*19+1);write(i%3===0?4:i%2===0?2:3,(i*137+67)&65535);}
 at(5001);write(0,control|0x300);write(4,1234);
});
scenario('control/cycle timer reconfiguration, cycle0, inactive cycle1 and interrupt cadence',({start,write,at})=>{
 start(5,0);write(4,1000);
 for(const [f,c]of[[501,1],[1001,2],[1501,4095],[2001,0],[2501,1000]]){at(f);write(1,c);write(2,300);write(3,1700);}
 for(const[f,c]of[[3001,0x105],[3501,0x205],[4001,0xf05],[4501,5],[5001,0]]){at(f);write(0,c);write(4,1111);}
});
scenario('clock changes preserve queue, FIFO and fractional timer phase including min/max',({start,write,at,add})=>{
 start(5,1000);write(2,300);write(3,1700);
 for(const[f,hz]of[[701,12000000],[1403,23011361],[2101,100000],[2803,100000000],[3501,23011361]]){at(f);add('clock',hz);write(4,1200+(f%700));}
});
scenario('maximum clock and minimum active cycle exercise multiple ticks per sample',({start,write,at,add})=>{
 start(5,2);write(2,1);write(3,2);add('clock',100000000);
 for(let i=0;i<40;i++){at(i*17+1);write(2,i&1?0:2);write(3,i&1?2:0);}
},{frames:768});
scenario('Stop flushes FIFO and held samples, retains routing/cycle/clock; Reset clears registers',({start,write,at,add})=>{
 start(10,800);write(2,300);write(3,1200);at(701);add('clock',12000000);at(1403);add('stop');
 at(2501);write(4,555);at(3501);add('reset');at(4001);start(5,1000);write(2,1100);write(3,700);
});
scenario('scheduled stereo writes, stable duplicates, queue clearing, reset and clock changes',({start,write,add,at})=>{
 start();add('schedule',[{frame:901,register:2,value:300},{frame:301,register:3,value:1400},{frame:901,register:2,value:500},{frame:1901,register:4,value:900}]);
 at(503);add('schedule',[{frame:398,register:2,value:800},{frame:2100,register:3,value:1600}]);
 at(1303);add('clock',10000000);at(2201);add('clear');at(2401);write(4,650);
 at(2801);add('schedule',[{frame:1001,register:4,value:1777}]);at(3401);add('reset');at(4001);start(5,901);write(4,1200);
});
scenario('frequent status snapshots do not consume FIFO or change phase',({start,write,at,add})=>{
 start(5,777);for(let i=0;i<300;i++){at(i*17+1);write(i%2?2:3,(i*719)&4095);add('read');add('read');}
});
scenario('deterministic raw16-bit register traffic with cold resets',({start,write,at,add})=>{
 start();let seed=0x32f1;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 for(let i=0;i<550;i++){at(i*9+1);write(random()%5,random()&65535);}at(5301);add('reset');start(5,1000);write(4,777);
});
scenario('DAC/duty scaling and mute progress preserve timer/FIFO state (core-only configuration)',({start,write,at,add})=>{
 start(5,777);write(2,100);write(3,700);at(701);add('mode',0);at(1403);add('mute',1);write(4,1500);
 at(2101);add('clock',12000000);at(2803);add('mute',0);at(3501);add('mode',1);at(4203);add('reset');start(10,1000);write(4,700);
},{configurationOnly:true});
function flatten(events,frames) {
 const direct=[],queue=[];let order=0,next=0;
 for(let frame=0;frame<frames;frame++){
  while(next<events.length&&events[next].frame===frame){const event=events[next++];
   if(event.op==='schedule')for(const e of event.a)queue.push({frame:frame+e.frame,op:'write',a:e.register,b:e.value,order:order++});
   else if(event.op==='clear')queue.length=0;
   else {direct.push(event);if(event.op==='reset'||event.op==='stop')queue.length=0;}
  }
  queue.sort((a,b)=>a.frame-b.frame||a.order-b.order);
  while(queue[0]?.frame<=frame)direct.push(queue.shift());
 }
 return direct;
}
const report={schemaVersion:1,deviceOpened:false,startedAt:new Date().toISOString(),reference:'Actual deployed playground_pwm_worklet.js / PWM32XPlayback and pwm32x_wasm.wasm; default public cases also checked against JS PWM32XPlayback',wasmSha256:createHash('sha256').update(wasmBinary).digest('hex'),rates,cases:[],totalStereoFrames:0,maximumDifference:0,
 limits:'Offline standalone PCM and allocation audit, no device/IPC/Rust scheduling/FX/UI/deadline guarantee. All public cases use default MAME/duty/gain1 and existing primary C ABI. The configuration-only DAC/mute case compares canonical C++ Core directly, without adding public options/setters. Tagged-owner FIFO/latch cancellation has C ABI self-tests and Rust integration tests; ordinary tag0 writes preserve primary PCM.'};
try {
 if(!fixture){temporary=await fs.mkdtemp(path.join(os.tmpdir(),'native-extra-pwm-'));fixture=path.join(temporary,'fixture');execFileSync('clang++',['-std=c++17','-O2','-fwrapv','-fno-strict-aliasing','-ffp-contract=off','-I'+path.join(project,'native-pwm/snapshot/wasm'),path.join(project,'src/native_genesis_pwm.cpp'),path.join(project,'src/native_genesis_extra_pwm_fixture.cpp'),'-o',fixture],{stdio:'pipe'});}
 report.selfTest=JSON.parse(execFileSync(fixture,['--self-test'],{encoding:'utf8'}));
 for(const rate of rates)for(const scenario of cases){
  const events=scenario.events.slice().sort((a,b)=>a.frame-b.frame),native=flatten(events,scenario.frames);
  const input=native.map(({frame,op,a=0,b=0})=>`${frame} ${op} ${a} ${b}`).join('\n')+'\n';
  const bytes=execFileSync(fixture,[String(rate),String(scenario.frames),...(scenario.configurationOnly?['--core']:[])],{input,maxBuffer:scenario.frames*8+1048576,timeout:30000});assert.equal(bytes.length,scenario.frames*8);
  const actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  for(const split of[[1],[128],[3,127,1,64,17,256]]){
   globalThis.sampleRate=rate;const reference=new Processor({processorOptions:{wasmBinary}});await reference.testReady;
   const js=new PWM32XPlayback({sampleRate:rate});let next=0,frame=0,block=0,maximumDifference=0,jsMaximumDifference=0,peak=0,first;
   try{while(frame<scenario.frames){globalThis.currentFrame=frame;
    while(next<events.length&&events[next].frame===frame){const{op,a,b}=events[next++];
     for(const playback of[reference.pwm,js]){
      if(op==='write')playback.write(a,b);else if(op==='clock')playback.setClock(a);else if(op==='reset')playback.reset();
      else if(op==='schedule')playback.scheduleWrites(a);else if(op==='clear')playback.clearSchedule();
      else if(op==='stop'){playback.clearSchedule();playback.chip.leftFifo=[];playback.chip.rightFifo=[];playback.chip.left=null;playback.chip.right=null;}
      else if(op==='read'){playback.getState();for(let reg=0;reg<5;reg++)playback.read(reg);}
      else if(op==='mode')playback.chip.outputMode=a?'duty':'dac';else if(op==='mute')playback.chip.muted=Boolean(a);else throw Error(op);
     }
    }
    const count=Math.min(scenario.frames-frame,split[block++%split.length],next<events.length?events[next].frame-frame:Infinity),left=new Float32Array(count),right=new Float32Array(count);assert(count>0);
    reference.renderSegment(left,right);const legacy=js.generateStereo(count);
    for(let i=0;i<count;i++)for(let ch=0;ch<2;ch++){const value=actual[(frame+i)*2+ch],expected=ch?right[i]:left[i],jsExpected=ch?legacy.right[i]:legacy.left[i],difference=Math.abs(value-expected);assert(Number.isFinite(value));if(difference&&!first)first={frame:frame+i,channel:ch,native:value,wasm:expected};maximumDifference=Math.max(maximumDifference,difference);jsMaximumDifference=Math.max(jsMaximumDifference,Math.abs(value-jsExpected));peak=Math.max(peak,Math.abs(value));}
    frame+=count;
   }
   assert.equal(maximumDifference,0,`${rate}Hz ${scenario.name} split${split}: ${JSON.stringify(first)}`);assert.equal(jsMaximumDifference,0,scenario.name+' JS regression');
   const routing=/^routing (\d+):/.exec(scenario.name),control=routing?Number(routing[1]):null;
   if(control===null||[1,2].includes(control&3)||[1,2].includes((control>>2)&3))assert(peak>0,scenario.name+' must sound');
   report.cases.push({name:scenario.name,configurationOnly:scenario.configurationOnly,sampleRate:rate,split,frames:scenario.frames,maximumDifference,jsMaximumDifference,peak});report.totalStereoFrames+=scenario.frames;
   }finally{reference.pwm?.dispose();js.dispose();}
  }
 }
 report.status='passed';if(reportPath)await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(`Native additional PWM: ${report.cases.length} cases, ${report.totalStereoFrames} stereo frames, maximum difference0`);console.log(JSON.stringify(report.selfTest));
}finally{if(temporary)await fs.rm(temporary,{recursive:true,force:true});}
