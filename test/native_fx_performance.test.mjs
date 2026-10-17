import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {NativeFXEngine} from '../web/native_fx_engine.js';
import {createPerformanceQueue} from '../web/playground_performance_queue.js';
import {setChain} from '../web/native_fx_graph.js';

const module=await WebAssembly.compile(readFileSync(new URL('../web/native_audio_effect.wasm',import.meta.url)));
const sampleOptions={playbackRate:1,gain:1,pan:-1,offset:0,duration:-1,loop:false,loopStart:0,loopEnd:0,fadeIn:0,fadeOut:0};
const constantFX={op:'live-fx',action:'register',name:'level',context:{level:0},source:'function(input,output,state,context){for(const channel of output)channel.fill(context.level);}'};
const multiplierFX={op:'live-fx',action:'register',name:'level',context:{level:1},source:'function(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.level;}'};
const level=value=>({op:'live-fx',action:'context',name:'level',context:{level:value}});
function harness(initialCommands=[]){
 let Processor,frame=0;const messages=[],workerMessages=[];
 const scope={NativeFXEngine,createPerformanceQueue,setChain,sampleRate:48000,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)};}},registerProcessor:(_name,processor)=>{Processor=processor;}};
 Object.defineProperty(scope,'currentFrame',{get:()=>frame});
 vm.runInNewContext(readFileSync(new URL('../web/native-fx-worklet.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export class','class'),scope);
 const processor=new Processor({processorOptions:{module,initialCommands}});
 let worker;
 const h={processor,messages,workerMessages,
  get frame(){return frame;},
  send(data){processor.port.onmessage({data:structuredClone(data)});},
  start(session=1){this.send({type:'performance-start',session,id:'start'});},
  stop(session=1){this.send({type:'performance-stop',session,id:'stop'});},
  at(atFrame,commands,{session=1,owner='lead',direct=false}={}){
   const data={performance:{session,owner,time:atFrame/48000},commands};
   if(direct)worker.onmessage({data:structuredClone(data)});else this.send(data);
  },
  attach(){
   worker={start(){},close(){this.closed=true;},postMessage:data=>workerMessages.push(data)};
   processor.port.onmessage({data:{op:'attach',port:worker}});return worker;
  },
  load(name='tone',value=.5,frames=20000){this.send({op:'sample',action:'load',id:'load',name,pcm:{sampleRate:48000,channels:[new Float32Array(frames).fill(value)]}});},
  play(id=1,name='tone'){return {op:'sample',action:'play',name,id,options:{...sampleOptions}};},
  render(frames=128,input=[]){
   const out=[new Float32Array(frames),new Float32Array(frames)];
   processor.process([input],[out]);frame+=frames;return out;
  },
  renderUntil(end){const result=[];while(frame<end)result.push(...this.render(Math.min(128,end-frame))[0]);return Float32Array.from(result);},
 };
 return h;
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);

test('FX parameter changes apply on exact frames within and at the end of a quantum',()=>{
 const h=harness([constantFX]);h.start();h.at(37,[level(.25)]);h.at(92,[level(.75)]);h.at(128,[level(.5)]);
 const first=h.render()[0];assert(first.slice(0,37).every(value=>value===0));
 assert(first.slice(37,92).every(value=>value===.25));assert(first.slice(92).every(value=>value===.75));
 assert.equal(h.processor.performanceQueue.getStats().queuedCommands,1,'end-boundary command stays for the next render');
 assert(h.render()[0].every(value=>value===.5));assert.equal(h.processor.performanceQueue.getStats().lateCommands,0);
});

test('a future sample acknowledges its logical voice before onset and stops at its scheduled frame',()=>{
 const h=harness();h.load();h.start();h.at(37,[h.play(10)]);
 const ack=h.messages.find(message=>message.op==='sample-response'&&message.id===10);
 assert.equal(ack.value,1);assert.equal(ack.error,undefined);assert.equal(h.frame,0);
 h.at(73,[{op:'sample',action:'stopVoice',voice:ack.value}]);
 const pcm=h.render()[0];assert(pcm.slice(0,37).every(value=>value===0));
 assert(pcm.slice(37,73).every(value=>value===.5));assert(pcm.slice(73).every(value=>value===0));
 assert.equal(h.messages.filter(message=>message.id===10).length,1,'future activation does not send a second acknowledgement');
});

test('150 ms sample onset and FX change align without any FM source or UI reply',()=>{
 const h=harness([multiplierFX]);h.load();h.start();h.at(7200,[level(.5),h.play(11)]);
 assert.equal(h.messages.find(message=>message.id===11).value,1);
 const pcm=h.renderUntil(7400);assert(pcm.slice(0,7200).every(value=>value===0));
 assert(pcm.slice(7200).every(value=>value===.25));
 assert.equal(h.processor.performanceQueue.getStats().lateCommands,0);
});

test('same-frame commands preserve batch and submission order',()=>{
 const h=harness([constantFX]);h.start();h.at(37,[level(.1),level(.2)]);h.at(37,[level(.3)]);
 const pcm=h.render()[0];assert(pcm.slice(0,37).every(value=>value===0));
 pcm.slice(37).forEach(value=>close(value,.3));
});

test('sample load preparation and play acknowledgement do not wait for the queued audio frame',()=>{
 const h=harness();h.start();h.at(7200,[
  {op:'sample',action:'load',id:20,name:'prepared',pcm:{sampleRate:48000,channels:[new Float32Array(100).fill(.4)]}},h.play(21,'prepared')]);
 assert(h.messages.some(message=>message.op==='sample-response'&&message.id===20&&!message.error));
 assert.equal(h.messages.find(message=>message.id===21).value,1);
 assert.equal(h.processor.performanceQueue.getStats().queuedCommands,1);
 const pcm=h.renderUntil(7250);assert(pcm.slice(0,7200).every(value=>value===0));pcm.slice(7200).forEach(value=>close(value,.4));
});

test('canceling a loop discards its reserved plays while another owner remains audible',()=>{
 const h=harness();h.load();h.start();h.at(37,[h.play(30)],{owner:'old'});h.at(80,[h.play(31)],{owner:'other'});
 h.send({type:'performance-cancel-owner',session:1,owner:'old',id:'cancel'});
 h.at(38,[h.play(32)],{owner:'old'});
 const pcm=h.render()[0];assert(pcm.slice(0,80).every(value=>value===0));assert(pcm.slice(80).every(value=>value===.5));
 assert.match(h.messages.find(message=>message.id===32)?.error,/no longer active/,'stale owner rejects its RPC without reserving a new voice');
 assert.equal(h.processor.performanceQueue.getStats().discardedCommands,1);
});

test('canceling an owner releases its active samples without muting a different owner',()=>{
 const h=harness();h.load('old',.2);h.load('other',.3);h.start();
 h.at(0,[h.play(33,'old')],{owner:'old'});h.at(0,[h.play(34,'other')],{owner:'other'});
 h.render()[0].forEach(value=>close(value,.5));
 h.send({type:'performance-cancel-owner',session:1,owner:'old'});
 h.render()[0].forEach(value=>close(value,.3));
});

test('owner cancellation stops active noise but cannot mute its replacement owner',()=>{
 const h=harness();h.start();
 const create=token=>[{op:'noise',action:'create',slot:0,token,type:0,seed:123},
  {op:'noise',action:'parameter',slot:0,token,param:5,value:0,seconds:0},
  {op:'noise',action:'start',slot:0,token}];
 h.at(37,create(1),{owner:'old'});
 const pcm=h.render()[0];assert(pcm.slice(0,37).every(value=>value===0));assert(pcm.slice(37).some(value=>value!==0));
 h.send({type:'performance-cancel-owner',session:1,owner:'old'});assert(h.render()[0].every(value=>value===0));
 h.at(h.frame,create(2),{owner:'replacement'});assert(h.render()[0].some(value=>value!==0));
 h.send({type:'performance-cancel-owner',session:1,owner:'old'});assert(h.render()[0].some(value=>value!==0));
 h.send({type:'performance-cancel-owner',session:1,owner:'replacement'});assert(h.render()[0].every(value=>value===0));
});

test('Stop and a new session cannot resurrect acknowledged future plays from the old run',()=>{
 const h=harness();h.load();h.start();h.at(37,[h.play(40)]);h.stop();h.start(2);
 h.at(38,[h.play(41)]);h.at(80,[h.play(42)],{session:2});
 const pcm=h.render()[0];assert(pcm.slice(0,80).every(value=>value===0));assert(pcm.slice(80).every(value=>value===.5));
 assert.match(h.messages.find(message=>message.id===41)?.error,/no longer active/);
 assert.equal(h.messages.find(message=>message.id===42).value,2,'voice IDs are never recycled across sessions');
});

test('unloading a bank before a reserved start prevents later activation',()=>{
 const h=harness();h.load();h.start();h.at(80,[h.play(50)]);h.at(37,[{op:'sample',action:'unload',name:'tone'}]);
 assert(h.render()[0].every(value=>value===0));
 assert(h.render()[0].every(value=>value===0));
});

test('a timed unload leaves an earlier queued play intact until the unload frame',()=>{
 const h=harness();h.load();h.start();h.at(37,[h.play(51)]);h.at(80,[{op:'sample',action:'unload',name:'tone'}]);
 const pcm=h.render()[0];assert(pcm.slice(0,37).every(value=>value===0));assert(pcm.slice(37,80).every(value=>value===.5));assert(pcm.slice(80).every(value=>value===0));
});

test('stopping a reserved handle before onset does not steal another voice slot',()=>{
 const h=harness();h.load();h.start();h.at(80,[h.play(52)]);
 const voice=h.messages.find(message=>message.id===52).value;
 h.at(37,[{op:'sample',action:'stopVoice',voice}]);h.at(90,[h.play(53)]);
 const pcm=h.render()[0];assert(pcm.slice(0,90).every(value=>value===0));assert(pcm.slice(90).every(value=>value===.5));
});

for(const action of ['clear','stop'])test(`sample ${action} prevents all pending voices from starting later`,()=>{
 const h=harness();h.load();h.start();h.at(80,[h.play(60)]);h.send({op:'sample',action,...(action==='stop'?{name:'tone'}:{})});
 assert(h.render()[0].every(value=>value===0));
});

for(const op of ['reset','emergency','attach','main'])test(`${op} invalidates pending performance before native cleanup`,()=>{
 const h=harness();h.load();h.start();h.at(80,[h.play(70)]);
 if(op==='attach')h.attach();else h.send({op});
 assert.equal(h.processor.performanceQueue.getStats().activeSession,0);
 assert.equal(h.processor.performanceQueue.getStats().queuedCommands,0);
 assert(h.render()[0].every(value=>value===0));h.at(90,[h.play(71)]);
 assert(h.messages.filter(message=>message.id===71).every(message=>message.error),'retired sessions cannot acknowledge a new voice successfully');
});

test('main-port session controls acknowledge on the main port while Worker owns FX',()=>{
 const h=harness();const worker=h.attach();h.start();
 assert(h.messages.some(message=>message.type==='performance-result'&&message.action==='start'));
 worker.onmessage({data:{op:'sample',action:'load',id:80,name:'tone',pcm:{sampleRate:48000,channels:[new Float32Array(100).fill(.5)]}}});
 h.at(37,[h.play(81)],{direct:true});assert.equal(h.workerMessages.find(message=>message.id===81).value,1);
 h.stop();assert(h.messages.some(message=>message.type==='performance-result'&&message.action==='stop'));
 assert(h.render()[0].every(value=>value===0));
});

test('invalid scheduled sample playback rejects preparation immediately without queuing a voice',()=>{
 const h=harness();h.start();h.at(80,[h.play(90,'missing')]);
 assert.match(h.messages.find(message=>message.id===90).error,/Unknown sample/);
 h.load();h.at(80,[{...h.play(91),options:{...sampleOptions,playbackRate:NaN}}]);
 assert.match(h.messages.find(message=>message.id===91).error,/Invalid sample playback/);
 assert.equal(h.processor.performanceQueue.getStats().queuedCommands,0);
 assert(h.render()[0].every(value=>value===0));
});

test('immediate controls remain immediate while future performance is queued',()=>{
 const h=harness([constantFX]);h.start();h.at(80,[level(.5)]);h.send(level(.25));
 const pcm=h.render()[0];assert(pcm.slice(0,80).every(value=>value===.25));assert(pcm.slice(80).every(value=>value===.5));
});

test('repeated split quanta reuse segment, WASM output and liveFX scratch views',()=>{
 const h=harness([constantFX]);h.start();
 const render=()=>{h.at(h.frame+37,[level(.25)]);h.at(h.frame+91,[level(.5)]);h.render();};
 render();
 const segments=[...h.processor.segmentViews.values()],native=[...h.processor.engine.outputViews.values()];
 const fx=[...h.processor.liveFX.buffers.get(2).values()];
 for(let i=0;i<100;i++)render();
 assert.deepEqual([...h.processor.segmentViews.values()],segments);
 assert.deepEqual([...h.processor.engine.outputViews.values()],native);
 assert.deepEqual([...h.processor.liveFX.buffers.get(2).values()],fx);
 assert.equal(h.processor.performanceQueue.getStats().queuedCommands,0);
});

test('performance stats are opt-in and do not start the FX monitor',()=>{
 const h=harness();h.start();h.send({type:'performance-stats',id:100});
 const stats=h.messages.find(message=>message.type==='performance-stats');assert.equal(stats.id,100);assert.equal(stats.activeSession,1);
 h.render();assert.equal(h.processor.monitor,undefined);assert.equal(h.messages.some(message=>message.op==='fx-monitor'),false);
});
