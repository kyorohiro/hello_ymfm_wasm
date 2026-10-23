import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceHost} from './playground_performance_host.js';

class Port {
  listeners = new Set(); messages = [];
  addEventListener(type, fn) {assert.equal(type, 'message'); this.listeners.add(fn);}
  removeEventListener(_type, fn) {this.listeners.delete(fn);}
  start() {}
  postMessage(data) {this.messages.push(data);}
  acknowledge(message = this.messages.find(data => data.type === 'performance-start')) {
    for (const listener of [...this.listeners]) listener({data: {type: 'performance-result', action: 'start', id: message.id, session: message.session}});
  }
}
function fixture() {
  const listeners = new Set(); let suspended = 0;
  const context = {state: 'running', currentTime: 3,
    addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn)};
  const host = createPerformanceHost({getContext: () => context, onSuspended: () => suspended++});
  return {host, context, listeners, suspended: () => suspended};
}
const turn = async () => {await Promise.resolve(); await Promise.resolve();};

test('starting waits for every endpoint acknowledgement and captures one explicit audio/performance anchor', async () => {
  const f = fixture(), a = new Port(), b = new Port();
  const lower = performance.timeOrigin + performance.now();
  const pending = f.host.start([a, b], .15);
  const upper = performance.timeOrigin + performance.now();
  let resolved = false; pending.then(() => {resolved = true;});
  a.acknowledge(); await turn(); assert.equal(resolved, false);
  b.acknowledge(); const clock = await pending;
  assert.equal(clock.audioSeconds, 3); assert.equal(clock.lookaheadSeconds, .15);
  assert.ok(clock.performanceEpochMs >= lower && clock.performanceEpochMs <= upper);
  assert.equal(a.messages[0].session, b.messages[0].session);
  f.host.stop();
});

test('concurrent start and duplicate attach calls cannot bypass an outstanding handshake', async () => {
  const f = fixture(), port = new Port();
  const first = f.host.start([port], .15);
  const second = f.host.start([port], .15);
  const duplicateAttach = f.host.attach(port);
  let secondReady = false, attachReady = false;
  second.then(() => {secondReady = true;}); duplicateAttach.then(() => {attachReady = true;});
  await turn();
  const readiness = [secondReady, attachReady];
  port.acknowledge();
  const [a, b] = await Promise.all([first, second, duplicateAttach]);
  assert.deepEqual(readiness, [false, false]);
  assert.equal(a, b); assert.equal(port.messages.filter(m => m.type === 'performance-start').length, 1);
  f.host.stop();
});

test('Stop during initialization rejects that start and late old acknowledgements do not stop its replacement', async () => {
  const f = fixture(), port = new Port();
  const first = f.host.start([port], .15).then(() => 'resolved', error => error.name);
  const oldStart = port.messages[0];
  f.host.stop();
  const next = f.host.start([port], .15);
  const newStart = port.messages.find(m => m.type === 'performance-start' && m.session !== oldStart.session);
  port.acknowledge(oldStart); port.acknowledge(newStart);
  assert.equal(await first, 'AbortError');
  const clock = await next;
  assert.equal(f.host.clock, clock);
  assert.ok(clock.session > oldStart.session);
  f.host.stop();
});

test('audio suspension retires its session and calls the Runtime stop hook once', async () => {
  const f = fixture(), port = new Port();
  const pending = f.host.start([port], .15); port.acknowledge(); await pending;
  f.context.state = 'suspended';
  for (const listener of [...f.listeners]) listener();
  assert.equal(f.host.clock, null); assert.equal(f.suspended(), 1);
  assert.equal(port.messages.at(-1).type, 'performance-stop');
  assert.equal(f.listeners.size, 0);
});

test('a newly attached device waits for its own acknowledgement in the existing session',async()=>{
 const f=fixture(),a=new Port(),b=new Port();const pending=f.host.start([a],.15);a.acknowledge();const clock=await pending;
 let ready=false;const attached=f.host.attach(b).then(()=>{ready=true;});await turn();assert.equal(ready,false);
 assert.equal(b.messages[0].session,clock.session);b.acknowledge();await attached;
 f.host.stop();assert.equal(a.messages.at(-1).type,'performance-stop');assert.equal(b.messages.at(-1).type,'performance-stop');
});

test('Stop aborts a pending handshake immediately even without any Worklet response',async()=>{
 const f=fixture(),port=new Port();let rejection;
 const pending=f.host.start([port],.15).catch(error=>{rejection=error;});f.host.stop();
 for(let i=0;i<10;i++)await turn();
 const immediate=rejection?.name==='AbortError';port.acknowledge();await pending;
 assert.equal(immediate,true);assert.equal(port.listeners.size,0);assert.equal(f.listeners.size,0);
});

test('failed initialization retires all endpoints and removes the context subscription',async()=>{
 const f=fixture(),a=new Port(),b=new Port();const pending=f.host.start([a,b],.15);a.acknowledge();
 const command=b.messages[0];for(const listener of [...b.listeners])listener({data:{type:'performance-result',id:command.id,error:'not ready'}});
 await assert.rejects(pending,/not ready/);assert.equal(f.host.clock,null);assert.equal(f.listeners.size,0);
 assert.equal(a.messages.at(-1).type,'performance-stop');assert.equal(b.messages.at(-1).type,'performance-stop');
});

test('a changed lead applies after Stop with a monotonically newer session across hosts',async()=>{
 const f=fixture(),a=new Port();let pending=f.host.start([a],.15);a.acknowledge();const first=await pending;
 assert.equal(await f.host.start([a],0),first);assert.equal(first.lookaheadSeconds,.15);
 f.host.stop();f.context.currentTime=20;pending=f.host.start([a],0);a.acknowledge(a.messages.at(-1));const second=await pending;
 assert(second.session>first.session);assert.equal(second.lookaheadSeconds,0);assert.equal(second.audioSeconds,20);f.host.stop();
 const next=fixture(),b=new Port();pending=next.host.start([b],.15);b.acknowledge();const third=await pending;
 assert(third.session>second.session);next.host.stop();
});

test('detached endpoints do not receive a subsequent Stop control',async()=>{
 const f=fixture(),a=new Port(),b=new Port();const pending=f.host.start([a,b],.15);a.acknowledge();b.acknowledge();await pending;
 f.host.detach(b);f.host.stop();assert.equal(a.messages.length,2);assert.equal(b.messages.length,1);
});

test('detaching a pending additional endpoint cancels its handshake without stopping siblings',async()=>{
 const f=fixture(),a=new Port(),b=new Port(),c=new Port();
 const started=f.host.start([a],.15);a.acknowledge();const clock=await started;
 const attaching=f.host.attach(b),rejected=assert.rejects(attaching,{name:'AbortError'}),old=b.messages[0];
 const sibling=f.host.attach(c);f.host.detach(b);
 assert.equal(b.listeners.size,0);assert.equal(c.listeners.size,1);assert.equal(f.host.clock,clock);await rejected;
 const replacement=f.host.attach(b);let ready=false;replacement.then(()=>{ready=true;});
 b.acknowledge(old);await turn();assert.equal(ready,false,'Late old acknowledgement cannot complete replacement');
 b.acknowledge(b.messages.at(-1));c.acknowledge();await Promise.all([replacement,sibling]);
 assert.equal(f.host.clock,clock);assert.equal(a.messages.length,1);f.host.stop();
});

test('detaching during initial startup rejects it and clears the remaining handshakes',async()=>{
 const f=fixture(),a=new Port(),b=new Port(),starting=f.host.start([a,b],.15);
 const rejected=assert.rejects(starting,{name:'AbortError'});f.host.detach(b);await rejected;
 assert.equal(f.host.clock,null);assert.equal(a.listeners.size,0);assert.equal(b.listeners.size,0);assert.equal(f.listeners.size,0);
 const next=f.host.start([a],.15);a.acknowledge(a.messages.at(-1));await next;f.host.stop();
});

test('invalid leads create no session and non-Worklet hosts retain their immediate path',async()=>{
 const f=fixture(),a=new Port();await assert.rejects(f.host.start([a],NaN),/between 0 and 2/);
 assert.equal(f.host.clock,null);assert.equal(a.messages.length,0);assert.equal(f.listeners.size,0);
 assert.equal(await f.host.start([],0),null);assert.equal(await f.host.start([{}],.15),null);
 const absent=createPerformanceHost({getContext:()=>null});assert.equal(await absent.start([a],.15),null);
});

test('owner cancellation ignores stale sessions and still reaches live endpoints after one is disposed',async()=>{
 const f=fixture(),a=new Port(),b=new Port(),detached=new Port();
 const pending=f.host.start([a,b,detached],.15);a.acknowledge();b.acknowledge();detached.acknowledge();const clock=await pending;
 f.host.detach(detached);f.host.cancelOwner({session:clock.session-1,owner:'lead'});f.host.cancelOwner({session:clock.session,owner:''});
 assert.equal(a.messages.length,1);assert.equal(b.messages.length,1);
 a.postMessage=()=>{throw Error('disposed port');};
 assert.doesNotThrow(()=>f.host.cancelOwner({session:clock.session,owner:'lead'}));
 assert.deepEqual(b.messages.at(-1),{type:'performance-cancel-owner',session:clock.session,owner:'lead'});
 assert.equal(detached.messages.length,1);
 f.host.stop();const count=b.messages.length;f.host.cancelOwner({session:clock.session,owner:'late'});assert.equal(b.messages.length,count);
});
