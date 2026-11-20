// SPDX-License-Identifier: BSD-3-Clause
// Exact old/new default path comparison: real APU WASM, no AudioContext/device.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
const option=(name,fallback)=>args.find(value=>value.startsWith(name+'='))?.slice(name.length+1)??fallback;
const base=option('--base','b5defa15048fd82b3bb96b032e8fee17e249c34c');
const out=resolve(root,option('--out','docs/issues/gameboy_timed_default_pcm_01.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const saved=new Map(['AudioWorkletProcessor','registerProcessor','sampleRate','currentFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const sourceNames=['playground_gameboy_worklet.js','playground_gameboy.js','playground_performance_processor.js'];
const sourceBytes={},sources={},types={},clients={};
function moduleUrl(bytes,path,overrides={}){
 const text=bytes.toString().replace(/(from\s*["'])(\.[^"']+)(["'])/g,(_all,a,p,b)=>a+(overrides[p]??new URL(p,new URL('../'+path,import.meta.url)).href)+b);
 return 'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
}
class Port{messages=[];postMessage(value){this.messages.push(value);}start(){}close(){}addEventListener(){}removeEventListener(){}}
globalThis.AudioWorkletProcessor=class{constructor(){this.port=new Port();}};
try{
 for(const name of sourceNames){
  const path='tetorica_src/runtime/'+name,after=await readFile(resolve(root,path));
  const before=execFileSync('git',['show',`${base}:${path}`],{cwd:root,maxBuffer:8*1024*1024});
  sourceBytes[name]={before,after};sources[path]={before:record(before),after:record(after)};
 }
 for(const side of ['before','after']){
  const performanceUrl=moduleUrl(sourceBytes['playground_performance_processor.js'][side],'tetorica_src/runtime/playground_performance_processor.js');
  let Type;globalThis.registerProcessor=(_name,value)=>{Type=value;};
  await import(moduleUrl(sourceBytes['playground_gameboy_worklet.js'][side],'tetorica_src/runtime/playground_gameboy_worklet.js',{'./playground_performance_processor.js':performanceUrl}));
  assert(Type,'Game Boy Worklet registers');types[side]=Type;
  clients[side]=(await import(moduleUrl(sourceBytes['playground_gameboy.js'][side],'tetorica_src/runtime/playground_gameboy.js'))).createGameboyClient;
 }
 const wasm=new Uint8Array(await readFile(resolve(root,'tetorica_src/runtime/generated/gameboy_apu_wasm.wasm')));
 const scenes=[];
 for(const channel of [0,1])for(const duty of [.125,.25,.5,.75])for(const pan of ['left','right','center'])scenes.push({name:`pulse-${channel}-${duty}-${pan}`,
  start:a=>{a.setPan(channel,pan!=='right',pan!=='left');a.pulse.setVoice(channel,{duty,volume:11,envelope:{direction:'down',period:2}});if(channel===0)a.pulse.setSweep({period:3,direction:'down',shift:1});a.pulse.noteOn(channel,'C4');},
  edit:a=>{a.pulse.setEnvelope(channel,{volume:7,period:0});a.pulse.setFrequency(channel,330);a.pulse.keyOn(channel);},release:a=>a.pulse.keyOff(channel)});
 for(const level of [1,.5,.25])for(const pan of ['left','right','center'])scenes.push({name:`wave-${level}-${pan}`,
  start:a=>{a.setPan(2,pan!=='right',pan!=='left');a.wave.setWaveform(Array.from({length:32},(_,i)=>i<16?i:31-i));a.wave.setLevel(level);a.wave.noteOn('C4');},
  edit:a=>{a.wave.setWaveform(Array.from({length:32},(_,i)=>i%16));a.wave.setLevel(.5);a.wave.noteOn('E4');},release:a=>a.wave.keyOff()});
 for(const width of [7,15])for(const divisor of [0,3,7])scenes.push({name:`noise-${width}-${divisor}`,
  start:a=>{a.noise.setVoice({width,divisor,shift:2,volume:10,envelope:{direction:'up',period:1}});a.noise.keyOn();},
  edit:a=>{a.noise.setParameters({shift:4});a.noise.setEnvelope({volume:6,period:0});a.noise.keyOn();},release:a=>a.noise.keyOff()});
 scenes.push({name:'four-channel-mix',start:a=>{a.pulse.noteOn(0,'C4');a.pulse.noteOn(1,'E4');a.wave.noteOn('G4');a.noise.keyOn();},edit:a=>{a.setMasterVolume(3,6);a.setPan(0,false,true);a.setPan(1,true,false);},release:a=>{for(let ch=0;ch<4;ch++)a.keyOff(ch);}});
 scenes.push({name:'reset-reinitialize',start:a=>a.pulse.noteOn(0,'C4'),edit:a=>{a.reset();a.initialize();a.wave.noteOn('E4');},release:a=>a.keyOff(2)});
 for(let channel=0;channel<4;channel++)scenes.push({name:`manual-audition-${channel}`,start:(_a,p)=>p.inspector.invoke('auditionOn',[channel,60,'keyboard']),
  edit:(_a,p)=>p.inspector.invoke('setVoice',[channel,channel<2?{duty:.25}:channel===2?{level:.5}:{width:7}]),
  release:(_a,p)=>p.inspector.invoke('auditionOff',[channel,'keyboard'])});
 const cases=[];let totalStereoFrames=0;
 for(const rate of [44100,48000])for(const clock of [4194304,4000000])for(const scene of scenes){
  globalThis.sampleRate=rate;globalThis.currentFrame=0;const processors=[],apis=[];
  try{
   for(const side of ['before','after']){
    const p=new types[side]({processorOptions:{wasmBinary:wasm}});processors.push(p);
    for(let tries=0;!p.port.messages.some(message=>message.ready);tries++){
     const failure=p.port.messages.find(message=>message.error);if(failure)throw Error(failure.error);assert(tries<1000,'APU initialization');await new Promise(resolve=>setTimeout(resolve,0));
    }
    p.receive({method:'clock',args:[clock]});
    const port=new Port();port.postMessage=value=>p.receive(value,p.port);
    const api=clients[side](port,{clock});api.initialize();apis.push(api);
   }
   const invoke=method=>processors.forEach((processor,index)=>scene[method](apis[index],processor));invoke('start');
   const hash=createHash('sha256');let frame=0,maximumDifference=0,nonzero=0;
   for(const [until,action]of [[257,'edit'],[1024,'release'],[4096,null]]){
    let block=0;while(frame<until){
     const size=Math.min([1,7,31,64,127,128][block++%6],until-frame);globalThis.currentFrame=frame;
     const rendered=processors.map(processor=>{const left=new Float32Array(size),right=new Float32Array(size);assert.equal(processor.process([],[[left,right]]),true);return{left,right};});
     for(const side of ['left','right']){
      for(let i=0;i<size;i++){assert(Number.isFinite(rendered[1][side][i]));maximumDifference=Math.max(maximumDifference,Math.abs(rendered[0][side][i]-rendered[1][side][i]));if(rendered[1][side][i]!==0)nonzero++;}
      assert.deepEqual(rendered[1][side],rendered[0][side],`${scene.name}/${rate}/${clock} at ${frame}`);hash.update(Buffer.from(rendered[1][side].buffer));
     }frame+=size;
    }if(action)invoke(action);
   }
   assert(nonzero>0,`audible test data ${scene.name}`);totalStereoFrames+=frame;
   cases.push({rate,clock,scene:scene.name,frames:frame,nonzero,maximumDifference,pcmSha256:hash.digest('hex')});
  }finally{for(const processor of processors)processor.dispose();}
 }
 const report={schemaVersion:1,scope:'gameboy-timed-api-default-worklet-pcm',baseCommit:base,passed:true,physicalAudio:false,audioContextCreated:false,
  timedOperationsUsed:false,sources,cases,totalStereoFrames,maximumDifference:Math.max(...cases.map(row=>row.maximumDifference)),
  method:'Actual pre-change and current Game Boy clients, Worklet classes and shared Performance Processor; same native WASM, immediate authoring/keyboard operations and irregular render partitions. No new timed API is invoked.'};
 await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
 console.log(`Game Boy default PCM: ${cases.length} cases / ${totalStereoFrames} stereo frames, exact; ${out}`);
}finally{for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
