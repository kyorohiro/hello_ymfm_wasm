import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceSender, validateWorkerLookahead, DEFAULT_WORKER_LOOKAHEAD_SECONDS} from './playground_performance_sender.js';

function fixture() {
  let now = 100000, loop = null;
  const sent = [];
  const port = {postMessage: (data, transfer) => sent.push(structuredClone(data, {transfer})), start() {}, close() {}};
  const sender = createPerformanceSender({now: () => now, getLoop: () => loop});
  sender.configure({session: 1, audioSeconds: 3, performanceEpochMs: 100000, lookaheadSeconds: .15});
  return {sender, sent, port, channel: sender.port(port, 'chip'),
    setNow: value => {now = value;}, setLoop: value => {loop = value;}};
}

test('Worker commands use the shared monotonic clock, retaining atomic register batches', () => {
  const f = fixture();
  f.setLoop({performanceOwner: 'lead:1'});
  const commands = [{type: 'write', register: 0xa4, value: 34}, {type: 'write', register: 0xa0, value: 41}, {type: 'write', register: 0x28, value: 240}];
  f.channel.postMessage(commands);
  f.setNow(100080); f.channel.postMessage([{type: 'write', register: 0x28, value: 0}]);
  assert.deepEqual(f.sent[0], {performance: {session: 1, owner: 'lead:1', time: 3.15}, commands});
  assert.ok(Math.abs(f.sent[1].performance.time - f.sent[0].performance.time - .08) < 1e-12);
});

test('explicit DAC timelines and resource loads stay immediate without double lead', () => {
  const f = fixture();
  for (const command of [
    {type: 'sample-writes', entries: [{sample: 100}]},
    {type: 'schedule-writes', entries: [{time: 10}]},
    {type: 'pcm-dac', id: 1, command: {action: 'load', data: new Uint8Array([128])}},
    {type: 'pcm-dac', id: 2, command: {action: 'play', when: 12}},
    {type: 'loadRhythmRom', id: 3, bytes: new Uint8Array(8192)},
    {type: 'loadAdpcmMemory', id: 4, bytes: new Uint8Array(32), address: 64},
    {type: 'loadAdpcmMemory', memoryType: 0, id: 5, bytes: new Uint8Array(256), address: 512},
    {type: 'loadAdpcmMemory', memoryType: 1, id: 6, bytes: new Uint8Array(256), address: 768},
  ]) f.channel.postMessage([command]);
  assert.ok(f.sent.every(data => Array.isArray(data) && !data.performance));
});

test('late finally releases from canceled/stopped loops cannot mute a replacement performance', () => {
  const f = fixture();
  const loop = {performanceOwner: 'old'}; f.setLoop(loop);
  f.sender.cancelOwner('old'); f.sent.length = 0;
  f.channel.postMessage([{type: 'write', register: 0x28, value: 0}]);
  assert.equal(f.sent.length, 0);
  f.setLoop(null); f.sender.stop(); f.sent.length = 0;
  f.channel.postMessage([{type: 'write', register: 0x28, value: 0}]);
  assert.equal(f.sent.length, 0);
  f.sender.immediateCleanup(() => f.channel.postMessage([{type: 'write', register: 0x28, value: 0}]));
  assert.equal(f.sent.length, 1);
  assert.ok(Array.isArray(f.sent[0]));
});

test('changing the same live session preserves its clock and lead; a stopped session can be replaced', () => {
  const f = fixture();
  f.sender.configure({session: 1, audioSeconds: 20, performanceEpochMs: 100000, lookaheadSeconds: 1});
  f.channel.postMessage([{type: 'write', value: 1}]);
  assert.equal(f.sent.at(-1).performance.time, 3.15);
  f.sender.stop(); f.sender.configure({session: 2, audioSeconds: 20, performanceEpochMs: 100000, lookaheadSeconds: .2});
  f.channel.postMessage([{type: 'write', value: 2}]);
  assert.equal(f.sent.at(-1).performance.time, 20.2);
  assert.equal(f.sent.at(-1).performance.session, 2);
});

test('SPC observation buffer acknowledgements return after cancellation without reviving audio controls', () => {
  const f = fixture(), raw = {postMessage:(data,transfer)=>f.sent.push(structuredClone(data,{transfer}))};
  const spc = f.sender.port(raw,'spc');
  f.setLoop({performanceOwner:'old',stopped:true});
  f.sender.cancelOwner('old'); f.sender.stop(); f.sent.length = 0;
  const buffer = new Float64Array(12).buffer;
  spc.postMessage({method:'eventAck',args:[3,7,buffer]},[buffer]);
  assert.equal(buffer.byteLength,0,'The buffer is actually transferred back');
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].method,'eventAck');
  assert.equal(f.sent[0].spcPerformance,undefined,'Housekeeping carries no active audio owner');
  assert.equal(f.sent[0].args[2].byteLength,96);
  spc.postMessage({method:'play',args:[]});
  assert.equal(f.sent.length,1,'Cancelled user controls remain suppressed');
});

test('splitting timed and resource preparation groups transfers a payload only once', () => {
  const f = fixture();
  const buffer = new Uint8Array([1, 2, 3]).buffer;
  assert.doesNotThrow(() => f.channel.postMessage([
    {type: 'write', value: 1}, {type: 'load-dac-bank', name: 'bank', data: buffer}, {type: 'write', value: 2},
  ], [buffer]));
  assert.equal(f.sent.length, 3);
  assert.deepEqual(Array.from(new Uint8Array(f.sent[1][0].data)), [1, 2, 3]);
});

test('splitting multiple preparation commands consumes their transfer list only once',()=>{
 const f=fixture(),a=Uint8Array.of(1,2).buffer,b=Uint8Array.of(3,4).buffer;
 assert.doesNotThrow(()=>f.channel.postMessage([
  {type:'load-dac-bank',name:'a',data:a},{type:'load-dac-bank',name:'b',data:b},
 ],[a,b]));
 assert.equal(f.sent.length,2);assert.deepEqual([...new Uint8Array(f.sent[0][0].data)],[1,2]);
 assert.deepEqual([...new Uint8Array(f.sent[1][0].data)],[3,4]);
});

test('Worker lead validation rejects nonfinite and negative values', () => {
  assert.equal(DEFAULT_WORKER_LOOKAHEAD_SECONDS, .5);
  assert.equal(validateWorkerLookahead(DEFAULT_WORKER_LOOKAHEAD_SECONDS), .5);
  for (const invalid of [NaN, Infinity, -.01, 2.01, '0.15']) assert.throws(() => validateWorkerLookahead(invalid));
  for (const valid of [0, .15, 2]) assert.equal(validateWorkerLookahead(valid), valid);
});

function rpcFixture(onCancelOwner=()=>{}){
 let loop=null,now=100000;const restored=[];
 const sender=createPerformanceSender({getLoop:()=>loop,restoreLoop:value=>{loop=value;restored.push(value);},now:()=>now,onCancelOwner});
 sender.configure({session:1,audioSeconds:10,performanceEpochMs:100000,lookaheadSeconds:.15});
 const makePort=()=>({messages:[],listeners:new Set(),postMessage(data,transfer){this.messages.push({data,transfer});},
  start(){this.started=true;},close(){this.closed=true;},
  addEventListener(type,fn,options){assert.equal(type,'message');this.listeners.add(fn);this.options=options;},
  removeEventListener(type,fn,options){assert.equal(type,'message');assert.equal(options,this.options);this.listeners.delete(fn);},
  emit(data){const event={data};this.onmessage?.(event);for(const fn of this.listeners)fn(event);}});
 return {sender,makePort,restored,setLoop:value=>{loop=value;},setNow:value=>{now=value;}};
}

test('FM, native FX and independent devices use one absolute anchor and owner',()=>{
 const f=rpcFixture(),ports=[f.makePort(),f.makePort(),f.makePort()];f.setNow(101025);f.setLoop({performanceOwner:'lead:2'});
 f.sender.port(ports[0],'chip').postMessage([{type:'write',register:0x28,value:240}]);
 f.sender.port(ports[1],'fx').postMessage({op:'noise',action:'start'});
 f.sender.port(ports[2],'device').postMessage({method:'noteOn',args:[60,100]});
 for(const port of ports)assert.deepEqual(port.messages[0].data.performance,{session:1,owner:'lead:2',time:11.175});
});

test('resource preparations bypass the lead while sample starts remain scheduled',()=>{
 const f=rpcFixture(),raw=f.makePort(),port=f.sender.port(raw,'fx'),other=f.makePort(),device=f.sender.port(other,'device');
 port.postMessage({op:'sample',action:'load',id:1});port.postMessage({op:'sample',action:'play',id:2});
 device.postMessage({method:'loadSysex',id:3});device.postMessage({method:'noteOn',args:[60,100]});
 assert.equal(raw.messages[0].data.performance,undefined);assert.equal(other.messages[0].data.performance,undefined);
 assert.equal(raw.messages[1].data.performance.time,10.15);assert.equal(other.messages[1].data.performance.time,10.15);
});

test('incremental POKEY preparation retains one owner and transfers each chunk once',()=>{
 const f=fixture(),port=f.sender.port(f.port,'independent');f.setLoop({performanceOwner:'preparing'});
 const methods=['beginTimelineUpload','appendTimelineChunk','commitTimelineUpload','abortTimelineUpload'];
 for(let i=0;i<methods.length;i++){
  const data=Uint8Array.of(0,1,168),command={method:methods[i],id:`upload:${i}`,args:[{uploadId:7,...(i===1?{offset:0,data}:{})}]};
  port.postMessage(command,i===1?[data.buffer]:undefined);
  if(i===1)assert.equal(data.byteLength,0,'the caller relinquishes exactly the chunk buffer');
  assert.deepEqual(f.sent.at(-1).performance,{session:1,owner:'preparing',time:3.15});
  assert.equal(f.sent.at(-1).commands.length,1);assert.equal(f.sent.at(-1).commands[0].method,methods[i]);
 }
 assert.deepEqual([...f.sent[1].commands[0].args[0].data],[0,1,168]);
 f.sender.cancelOwner('preparing');const before=f.sent.length;
 assert.throws(()=>port.postMessage({method:'commitTimelineUpload',id:'late',args:[{uploadId:7}]}),{name:'AbortError'});
 assert.equal(f.sent.length,before,'late preparation cannot commit after owner cancellation');
});

test('zero lead and rejected clock configurations do not mutate the active anchor',()=>{
 const f=rpcFixture();f.sender.configure({session:2,audioSeconds:10,performanceEpochMs:100000,lookaheadSeconds:0});
 assert.equal(f.sender.timestamp().time,10);
 for(const patch of [{session:0},{session:1.5},{audioSeconds:-1},{audioSeconds:Infinity},{performanceEpochMs:NaN},{lookaheadSeconds:Infinity}]){
  assert.throws(()=>f.sender.configure({session:3,audioSeconds:20,performanceEpochMs:100000,lookaheadSeconds:.15,...patch}));
  assert.equal(f.sender.timestamp().time,10);
 }
});

test('canceled owner RPC throws AbortError and its late finally cannot mute a replacement',()=>{
 const f=rpcFixture(),raw=f.makePort(),port=f.sender.port(raw,'chip');
 f.setLoop({performanceOwner:'old'});f.sender.cancelOwner('old');const before=raw.messages.length;
 assert.throws(()=>port.postMessage([{type:'pcm-dac',id:1,command:{action:'load'}}]),error=>error.name==='AbortError');
 port.postMessage([{type:'clear-scheduled-writes'}]);assert.equal(raw.messages.length,before);
 f.setLoop({performanceOwner:'new'});port.postMessage([{type:'write',register:0x28,value:240}]);
 f.setLoop({performanceOwner:'old'});port.postMessage([{type:'write',register:0x28,value:0}]);
 assert.equal(raw.messages.at(-1).data.commands[0].value,240);
 f.sender.stop();assert.equal(f.sender.timestamp(),null);f.setLoop(null);
 assert.throws(()=>port.postMessage([{type:'read',id:2}]),error=>error.name==='AbortError');
});

test('RPC replies restore both the originating loop and null before invoking the callback',()=>{
 const f=rpcFixture(),raw=f.makePort(),port=f.sender.port(raw,'fx'),lead={performanceOwner:'lead'},seen=[];
 port.onmessage=event=>seen.push([event.data.id,f.restored.at(-1)]);
 f.setLoop(lead);port.postMessage({op:'sample',action:'play',id:1});f.setLoop(null);port.postMessage({op:'sample',action:'play',id:2});
 f.setLoop({performanceOwner:'other'});raw.emit({op:'sample-response',id:1,value:8});raw.emit({op:'sample-response',id:2,value:9});
 assert.deepEqual(seen,[[1,lead],[2,null]]);raw.emit({op:'fx-monitor',id:3});assert.equal(f.restored.length,2);
});

test('facades preserve listener identity, discard failed RPC contexts and forget closed ports',()=>{
 const f=rpcFixture(),raw=f.makePort(),port=f.sender.port(raw,'device'),lead={performanceOwner:'lead'},seen=[];
 assert.equal(f.sender.port(raw,'device'),port);port.start();assert.equal(raw.started,true);
 const listener=event=>seen.push(event.data.id),options={once:false};port.addEventListener('message',listener,options);
 f.setLoop(lead);port.postMessage({method:'getPreset',id:1});raw.emit({id:1});assert.equal(f.restored.at(-1),lead);assert.deepEqual(seen,[1]);
 port.removeEventListener('message',listener,options);assert.equal(raw.listeners.size,0);
 const original=raw.postMessage;raw.postMessage=()=>{throw Error('closed');};assert.throws(()=>port.postMessage({method:'getPreset',id:2}),/closed/);raw.postMessage=original;
 port.onmessage=()=>{};raw.emit({id:2});assert.equal(f.restored.length,1);
 f.sender.stop();port.close();const count=raw.messages.length;f.sender.stop();assert.equal(raw.closed,true);assert.equal(raw.messages.length,count);
});

test('a disposed active client retains a bounded cancellation lease before closing its port',t=>{
 const scheduled=[],original=globalThis.setTimeout;
 globalThis.setTimeout=(fn,ms)=>{const timer={fn,ms};scheduled.push(timer);return timer;};
 t.after(()=>{globalThis.setTimeout=original;});
 const relays=[],f=rpcFixture(message=>relays.push(message)),raw=f.makePort(),port=f.sender.port(raw,'device');
 f.setLoop({performanceOwner:'lead'});port.postMessage({method:'noteOn',args:[60,100]});port.close();port.close();
 assert.equal(raw.closed,undefined);assert.equal(scheduled.length,1);assert.equal(scheduled[0].ms,200,'150 ms lead plus the bounded 50 ms control lease');
 f.sender.cancelOwner('lead');f.sender.cancelOwner('lead');
 assert.deepEqual(raw.messages.at(-1).data,{type:'performance-cancel-owner',session:1,owner:'lead'});
 assert.deepEqual(relays,[{session:1,owner:'lead'}],'Main receives a cancellation relay even if the client is disposing');
 scheduled[0].fn();assert.equal(raw.closed,true);
 const count=raw.messages.length;f.sender.stop();assert.equal(raw.messages.length,count,'an expired lease is removed from the sender');
});

test('cleanup bypass is restored after exceptions and a stopped loop cannot issue user controls',()=>{
 const f=rpcFixture(),raw=f.makePort(),port=f.sender.port(raw,'fx');f.setLoop({performanceOwner:'lead',stopped:true});
 port.postMessage({op:'reset'});assert.equal(raw.messages.length,0);
 f.sender.immediateCleanup(()=>port.postMessage({op:'reset'}));assert.deepEqual(raw.messages[0].data,{op:'reset'});
 assert.throws(()=>f.sender.immediateCleanup(()=>{throw Error('cleanup');}),/cleanup/);
 port.postMessage({op:'reset'});assert.equal(raw.messages.length,1);
});

test('the facade preserves MessagePort decode-error handling used by DX7', () => {
  const f = fixture(), facade = f.sender.port(f.port, 'chip');
  let errors = 0;
  const handler = () => errors++;
  facade.onmessageerror = handler;
  assert.equal(f.port.onmessageerror, handler);
  f.port.onmessageerror({});
  assert.equal(errors, 1);
  facade.onmessageerror = null;
  assert.equal(f.port.onmessageerror, null);
});

test('Native-only untimed leases fence preparation, cleanup and keyboard without adding audio lead',()=>{
  const sent=[];let loop={performanceOwner:'lead:1'};
  const sender=createPerformanceSender({leaseUntimed:true,getLoop:()=>loop,now:()=>1000});
  sender.configure({session:10,audioSeconds:2,performanceEpochMs:1000,lookaheadSeconds:.5});
  const port=sender.port({postMessage:data=>sent.push(structuredClone(data))},'chip');
  const schedule={type:'sample-writes',entries:[{sample:4410,register:0x2a,value:128}]};port.postMessage(schedule);
  assert.deepEqual(sent.pop(),{nativePerformance:{session:10,owner:'lead:1'},commands:[schedule]});
  loop={keyboard:true};port.postMessage({type:'write',register:0x28,value:240});
  assert.deepEqual(sent.pop(),{nativePerformance:{session:10,owner:'keyboard'},commands:[{type:'write',register:0x28,value:240}]});
  sender.stop();sent.length=0;loop=null;
  sender.immediateCleanup(()=>port.postMessage({type:'reset'}));
  assert.deepEqual(sent.pop(),{nativePerformance:{session:10,owner:'script'},commands:[{type:'reset'}]});
});
