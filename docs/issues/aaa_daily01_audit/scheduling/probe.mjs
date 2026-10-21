import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(2,i),v.slice(i+1)];}));
const root=path.resolve(args.root??process.cwd());
const out=path.resolve(args.out??path.dirname(fileURLToPath(import.meta.url)));
fs.mkdirSync(out,{recursive:true});
const load=path=>import(pathToFileURL(`${root}/${path}`));
const {createPerformanceQueue,createPerformanceChipOwnership}=await load('web/playground_performance_queue.js');
const {createPerformanceSender}=await load('web/playground_performance_sender.js');
const {createWorkerChip}=await load('web/playground_worker_chip.js');
const {createChipPortReceiver}=await load('web/playground_chip_port.js');
const {createOpnAuditionGuard,receiveOpnAuditionCommand,createPsgAuditionGuard}=await load('web/playground_audition_guard.js');
const {YM2612DacPlayer,receiveDacCommand}=await load('web/ym2612_dac.js');
const {OpnKeyboardInspector}=await load('web/playground_opn_inspector.js');
const {PsgInspectorState,receiveChipInspector}=await load('web/playground_chip_inspector_state.js');
const {validateChipClock}=await load('web/playground_chip_clock.js');
const {exportYm2612VgmToPlaygroundJavaScript}=await load('web/ym2612vgm.js');

// Instrument only Array operations owned by the source-under-audit. Semantic
// operation counts, not execution-time or engine allocation measurements.
function countedArrayClass(stats){return class CountedArray extends Array {
 concat(...values){stats.concatCalls++;stats.concatCopiedRefs+=this.length+values.reduce((n,v)=>n+v.length,0);return super.concat(...values);}
 sort(compare){stats.sortCalls++;return super.sort((a,b)=>{stats.sortComparisons++;return compare(a,b);});}
 splice(start,count,...items){stats.spliceCalls++;stats.spliceRemovedRefs+=Math.min(count,this.length-start);stats.spliceShiftedRefs+=Math.max(0,this.length-start-count);return super.splice(start,count,...items);}
 slice(start=0,end=this.length){stats.sliceCalls++;stats.sliceCopiedRefs+=Math.max(0,end-start);return super.slice(start,end);}
};}
const arrayStats=()=>({concatCalls:0,concatCopiedRefs:0,sortCalls:0,sortComparisons:0,spliceCalls:0,spliceRemovedRefs:0,spliceShiftedRefs:0,sliceCalls:0,sliceCopiedRefs:0});
function makeProcessor(){
 const stats=arrayStats(),ArrayType=countedArrayClass(stats);let Type;
 const scope={OpnKeyboardInspector,PsgInspectorState,receiveChipInspector,currentFrame:0,sampleRate:48000,
  Float32Array,Uint8Array,createPerformanceQueue,createPerformanceChipOwnership,createChipPortReceiver,
  createOpnAuditionGuard,receiveOpnAuditionCommand,createPsgAuditionGuard,YM2612DacPlayer,receiveDacCommand,validateChipClock,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor(_name,T){Type=T;}};
 vm.runInNewContext(fs.readFileSync(`${root}/web/ym2612-worklet.js`,'utf8').replace(/^import .*;\n/gm,''),scope);
 const p=new Type();p.scheduledCommands=new ArrayType();let writes=0,segments=0;
 p.ym2612={writeRegister(){writes++;},getIrq(){return false;}};
 p.renderFrames=()=>{segments++;};p.flushMixerMeters=()=>{};p.capturePcm=()=>{};p.captureOutputEnvelope=()=>{};
 const output=[[new Float32Array(128),new Float32Array(128)]];
 return {p,scope,stats,renderTo(time){const target=Math.ceil(time*48000/128)*128;while(scope.currentFrame<target){p.process([],output);scope.currentFrame+=128;}},counters:()=>({writes,segments})};
}
function makeScheduler(now,send){
 const stats=arrayStats(),ArrayType=countedArrayClass(stats);let createAudioScheduler;
 let source=fs.readFileSync(`${root}/web/playground_audio_scheduler.js`,'utf8');
 source=source.replace('export function createAudioScheduler','function createAudioScheduler').replaceAll('pending = []','pending = new ArrayType()');
 source+='\nresult=createAudioScheduler;';const scope={ArrayType,result:null,setTimeout,clearTimeout};vm.runInNewContext(source,scope);createAudioScheduler=scope.result;
 let next=0;const timers=new Map();let timersSet=0,timersCleared=0,timersFired=0,maxTimers=0;
 const s=createAudioScheduler({now,send,setTimer(fn,ms){const id=++next;timers.set(id,{fn,at:now()+ms/1000});timersSet++;maxTimers=Math.max(maxTimers,timers.size);return id;},clearTimer(id){if(timers.delete(id))timersCleared++;}});
 return {s,stats,step(time){let due;while((due=[...timers.entries()].filter(([,x])=>x.at<=time+1e-9).sort((a,b)=>a[1].at-b[1].at)[0])){timers.delete(due[0]);timersFired++;due[1].fn();}},timerStats:()=>({timersSet,timersCleared,timersFired,maxTimers,remaining:timers.size})};
}
async function exportedEntries(bytes,name,dacBase64){
 const vgm=bytes[0]===0x1f?zlib.gunzipSync(bytes):bytes;
 const source=exportYm2612VgmToPlaygroundJavaScript(vgm,{scheduled:true,dacBase64,splitChannels:true});
 const callbacks=[],batches=[];let waits=0,bankSamples=0;
 const scope={CH1:0,CH2:1,CH3:2,CH4:3,CH5:4,CH6:5,livePrepare(){},liveLoop(name,fn){callbacks.push([name,fn]);},
  beginSampleSchedule(){return 0;},scheduleWritesSamples(start,entries){batches.push({name:scope.current,entries:Array.from(entries,([offset,port,register,value])=>port==='psg'?{time:.25+offset/44100,type:'psg-write',value:register}:{time:.25+offset/44100,port,register,value})});},
  sleepSamples:async samples=>{waits=Math.max(waits,samples/44100);},dac:{playStream(){bankSamples++;}}};
 vm.runInNewContext(source,scope);for(const [name,fn]of callbacks){scope.current=name;await fn();}
 return {batches,duration:waits+.25,metadata:{name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),vgmBytes:vgm.length,scheduledTracks:callbacks.length,dacBase64,bankStreams:bankSamples,totalScheduledEntries:batches.reduce((n,b)=>n+b.entries.length,0),trackLengths:batches.map(b=>({name:b.name,entries:b.entries.length}))}};
}
function schedulingCase(name,batches,duration){
 let time=0,messages=0,entriesSent=0,maxBatch=0,maxWorkletPending=0;
 const processor=makeProcessor();const scheduler=makeScheduler(()=>time,entries=>{messages++;entriesSent+=entries.length;maxBatch=Math.max(maxBatch,entries.length);processor.p.applyCommand({type:'schedule-writes',entries});maxWorkletPending=Math.max(maxWorkletPending,processor.p.scheduledCommands.length-processor.p.scheduledHead);});
 for(const batch of batches)scheduler.s.enqueue(batch.entries);
 for(let tick=1;tick<=Math.ceil((duration+.02)/.01);tick++){time=tick*.01;processor.renderTo(time);scheduler.step(time);}
 scheduler.s.clear();processor.renderTo(duration+.1);
 return {name,duration,messages,entriesSent,maxBatch,maxWorkletPending,mainQueue:scheduler.stats,workletQueue:processor.stats,timers:scheduler.timerStats(),...processor.counters(),remainingWorklet:processor.p.scheduledCommands.length-processor.p.scheduledHead};
}
function ordinaryWorker(){
 let nowMs=0,frame=0,activeLoop={performanceOwner:'loop:1'},applied=0,messages=0,commands=0,jsonBytes=0,observations=0,observerBytes=0,maxCommands=0,maxBatches=0;
 const queue=createPerformanceQueue({sampleRate:48000,nowFrame:()=>frame,apply(){applied++;}});queue.receive({type:'performance-start',session:1});
 const rawPort={postMessage(data){messages++;commands+=data.commands?.length??data.length??1;jsonBytes+=JSON.stringify(data).length;queue.receive(structuredClone(data));const s=queue.getStats();maxCommands=Math.max(maxCommands,s.queuedCommands);maxBatches=Math.max(maxBatches,s.queuedBatches);},start(){}};
 const sender=createPerformanceSender({getLoop:()=>activeLoop,now:()=>nowMs});sender.configure({session:1,audioSeconds:0,performanceEpochMs:0,lookaheadSeconds:.5});
 const chip=createWorkerChip({port:sender.port(rawPort,'chip'),capabilities:{chip:'ym2612',fmChannels:6,psg:true,dac:true},observe(event){observations++;observerBytes+=JSON.stringify(event).length;}});
 const advance=seconds=>{const target=Math.round(seconds*48000);while(queue.nextFrame()<=target){frame=queue.nextFrame();queue.advance(frame);}nowMs=seconds*1000;frame=target;};
 // 36 cycles: duration .8s followed by 20/20/40ms, matching report workload.
 let at=0;for(let i=0;i<36;i++){advance(at);chip.fm.noteOn(0,3,650);advance(at+.8);chip.fm.noteOff(0);at+=.8+[.02,.02,.04][i%3];}
 advance(at+.6);
 return {cycles:36,duration:at,lookaheadSeconds:.5,messages,commands,jsonBytes,observations,observerBytes,applied,maxCommands,maxBatches,stats:queue.getStats()};
}
function queueBounds(){
 let applied=0;const q=createPerformanceQueue({sampleRate:48000,nowFrame:()=>0,apply(){applied++;}});q.receive({type:'performance-start',session:1});let errors=0;
 const make=(n,owner,time)=>({performance:{session:1,owner,time},commands:Array.from({length:n},()=>({type:'write',port:0,register:0x2a,value:128}))});
 q.receive(make(65536,'dense',1));const full=q.getStats();q.receive(make(1,'dense',1),()=>errors++);const rejected=q.getStats();q.cancelOwner('dense');return {full,rejected,errors,afterCancel:q.getStats(),applied};
}

// An owned synthetic VGM: 8-kHz DAC writes for 10 seconds. Compare the actual
// exporter's default bank encoding with the explicitly requested raw path.
const syntheticBytes=Buffer.alloc(0x40+80000*6+1);syntheticBytes.write('Vgm ');syntheticBytes.writeUInt32LE(syntheticBytes.length-4,4);syntheticBytes.writeUInt32LE(0x150,8);syntheticBytes.writeUInt32LE(7670453,0x2c);syntheticBytes.writeUInt32LE(441000,0x18);
let cursor=0x40,last=0;for(let i=0;i<80000;i++){const next=Math.round((i+1)*44100/8000),wait=next-last;last=next;syntheticBytes.set([0x52,0x2a,i&255,0x61,wait&255,wait>>8],cursor);cursor+=6;}syntheticBytes[cursor]=0x66;
const syntheticBank=await exportedEntries(syntheticBytes,'synthetic-8kHz-DAC-10s.vgm',true);
const syntheticRaw=await exportedEntries(syntheticBytes,'synthetic-8kHz-DAC-10s.vgm',false);
const exported=args.vgm?await exportedEntries(fs.readFileSync(args.vgm),path.basename(args.vgm),true):null;
const result={recordedAt:new Date().toISOString(),kind:'semantic-operation-count; no timed benchmark',node:process.version,
 sourceHashes:Object.fromEntries(['web/playground_audio_scheduler.js','web/playground_performance_queue.js','web/playground_performance_sender.js','web/playground_worker_chip.js','web/ym2612-worklet.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(`${root}/${p}`)).digest('hex')])),
 ordinaryWorker:ordinaryWorker(),vgm:exported?.metadata??null,syntheticBank:syntheticBank.metadata,syntheticRaw:syntheticRaw.metadata,
 scheduling:[...(exported?[schedulingCase('actual-VGM-default-scheduled-export',exported.batches,exported.duration)]:[]),schedulingCase('synthetic-DAC-default-bank',syntheticBank.batches,syntheticBank.duration),schedulingCase('synthetic-DAC-explicit-raw',syntheticRaw.batches,syntheticRaw.duration)],queueBounds:queueBounds()};
fs.writeFileSync(`${out}/operation-counts.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
