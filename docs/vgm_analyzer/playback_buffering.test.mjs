import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function processor(path,frames=4,fadeFrames=0){
 let Type;const messages=[];
 vm.runInNewContext(readFileSync(new URL(path,import.meta.url),'utf8'),{
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},
  registerProcessor:(_,t)=>Type=t,Float32Array,
 });
 const p=new Type({processorOptions:{startupFrames:frames,fadeFrames}});
 const send=data=>p.port.onmessage({data});
 const enqueue=values=>send({type:'enqueue',left:Float32Array.from(values).buffer,right:Float32Array.from(values,v=>-v).buffer});
 const output=n=>{const l=new Float32Array(n),r=new Float32Array(n);p.process([],[[l,r]]);return [Array.from(l),Array.from(r)];};
 return {p,send,enqueue,output,messages};
}
for(const path of ['../../web/vgm-output-worklet.js','../js/vgm-output-worklet.js']){
 test(`${path}: startup retains first sample and full amplitude until threshold`,()=>{
  const w=processor(path);w.enqueue([.25,.5]);assert.deepEqual(w.output(2),[[0,0],[0,0]]);
  assert.equal(w.p.consumedFrames,0);assert.equal(w.p.queuedFrames,2);
  w.enqueue([.75,1]);assert.deepEqual(w.output(2),[[.25,.5],[-.25,-.5]]);
  w.send({type:'end'});assert.deepEqual(w.output(2),[[.75,1],[-.75,-1]]);
  assert.equal(w.messages.at(-1).ended,true);
 });
 test(`${path}: short and empty tracks drain on end; pause and flush preserve startup behavior`,()=>{
  const w=processor(path);w.enqueue([.75]);w.send({type:'pause'});w.send({type:'end'});
  assert.deepEqual(w.output(2),[[0,0],[0,0]]);assert.equal(w.p.queuedFrames,1);
  w.send({type:'resume'});assert.equal(w.output(2)[0][0],.75);assert.equal(w.messages.at(-1).ended,true);
  w.send({type:'flush'});w.enqueue([.5]);assert.equal(w.output(1)[0][0],0);
  w.send({type:'end'});assert.equal(w.output(1)[0][0],.5);
  w.send({type:'flush',startupFrames:1});w.enqueue([.25]);assert.equal(w.output(1)[0][0],.25);
  w.send({type:'flush'});w.send({type:'end'});w.output(2);assert.equal(w.messages.at(-1).ended,true);
 });
}
const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
const start=source.indexOf('function pumpWorkletChunks('),end=source.indexOf('\nasync function startWorkletStream',start);
for(const length of [0,13,4096,5000])test(`Analyzer pump completes ${length}-sample track without startup deadlock or lost tail`,()=>{
 const w=processor('../js/vgm-output-worklet.js',4096);let cursor=0;
 const expected=Float32Array.from({length},(_,i)=>(i%100+1)/128);
 const pending=[];
 const context=vm.createContext({Float32Array,player:{isPaused:()=>false,
  stats:()=>({playing:cursor<length,paused:false,queuedFrames:0}),
  process(l,r,n){const count=Math.min(n,length-cursor);l.set(expected.subarray(cursor,cursor+count));r.set(expected.subarray(cursor,cursor+count));cursor+=count;}},
  activeStream:{mode:'worklet',chunkFrames:2048,workletQueuedFrames:0,endSent:false,node:{port:{postMessage:data=>w.send(data)}}},
  currentWorkletTargetFrames:()=>4096,applyAnalyzerMuteToBuffer(){},requestPlaybackUiRender(){},scheduleWorkletPump(){pending.push(true);},
 });
 vm.runInContext(source.slice(start,end),context);
 context.pumpWorkletChunks();
 if(length>2048){assert.deepEqual(w.output(128)[0],Array(128).fill(0));assert.equal(w.p.consumedFrames,0);}
 while(pending.pop())context.pumpWorkletChunks();
 const result=[];
 for(let step=0;step<100;step++){
  result.push(...w.output(128)[0]);
  const state=w.messages.at(-1);
  if(state?.ended)break;
  context.activeStream.workletQueuedFrames=w.p.queuedFrames;
  context.pumpWorkletChunks();while(pending.pop())context.pumpWorkletChunks();
 }
 assert.equal(w.messages.at(-1).ended,true);
 assert.deepEqual(result.slice(0,length),Array.from(expected));
 assert(result.slice(length).every(v=>v===0));
});

for (const path of ['../../web/vgm-output-worklet.js','../js/vgm-output-worklet.js']) {
 test(`${path}: fades retain a tail across chunks and end at zero`, () => {
  const w=processor(path,4,4);
  w.enqueue(Array(8).fill(1));
  assert.deepEqual(w.output(4)[0],[0,.25,.5,.75]);
  // Last four frames are retained until we know whether more audio follows.
  assert.deepEqual(w.output(4)[0],[0,0,0,0]);
  assert.equal(w.p.queuedFrames,4);
  w.enqueue(Array(4).fill(1));w.send({type:'end'});
  assert.deepEqual(w.output(8)[0],[1,1,1,1,.75,.5,.25,0]);
  assert.equal(w.messages.at(-1).ended,true);
 });
 test(`${path}: manual stop fades queued audio and reports completion`, () => {
  const w=processor(path,4,4);w.enqueue(Array(5000).fill(1));w.output(4);
  w.send({type:'stop'});
  assert.deepEqual(w.output(8)[0],[.75,.5,.25,0,0,0,0,0]);
  assert.equal(w.messages.at(-1).ended,true);
 });
 test(`${path}: fade bypass and short tracks`, () => {
  const w=processor(path,4,4);w.enqueue([1,1]);w.send({type:'end'});
  assert.deepEqual(w.output(4)[0],[0,0,0,0]);
  assert.equal(w.messages.at(-1).ended,true);
  w.send({type:'flush'});w.send({type:'fade',frames:0});w.enqueue([.5,.5]);w.send({type:'end'});
  assert.deepEqual(w.output(4)[0],[.5,.5,0,0]);
 });
}

test('stopping fades the old worklet without disconnecting the replacement', () => {
 const pending=[], sent=[];let disconnected=0;
 const old={mode:'worklet',node:{port:{postMessage:m=>sent.push(m)},disconnect(){disconnected++;}}};
 const context=vm.createContext({activeStream:old,playbackFade:{checked:true},audioContext:{state:'running'},
  setTimeout:fn=>{pending.push(fn);return 1;},clearTimeout(){pending.length=0;}});
 const start=source.indexOf('function stopActiveStream('),end=source.indexOf('\nfunction updatePlaybackButtons',start);
 vm.runInContext(source.slice(start,end),context);context.stopActiveStream();
 assert.equal(context.activeStream,null);assert.equal(disconnected,0);assert.equal(sent[0].type,'stop');
 const replacement={mode:'worklet'};context.activeStream=replacement;
 old.node.port.onmessage({data:{ended:true}});
 assert.equal(disconnected,1);assert.equal(context.activeStream,replacement);assert.equal(pending.length,0);
});
