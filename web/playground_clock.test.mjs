import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeadlineScheduler,createSecondsTimeline} from './playground_clock.js';
function setup(){
 let time=0,timers=0;const tasks=[];
 const scheduler=createDeadlineScheduler({now:()=>time,
  setTimer(fn,ms){timers++;const task={fn,delay:Math.max(.004,ms/1000)};tasks.push(task);return task;},
  clearTimer(task){task.cancelled=true;},
  createTaskChannel(){const c={port1:{close(){}},port2:{close(){},postMessage(){tasks.push({fn:()=>c.port1.onmessage(),delay:0});}}};return c;},
 });
 return {scheduler,get time(){return time;},get timers(){return timers;},async step(){const task=tasks.shift();if(task&&!task.cancelled){time+=task.delay;task.fn();}for(let i=0;i<8;i++)await Promise.resolve();}};
}
test('short VGM waits catch up without paying a clamped timer on every write',async()=>{
 const env=setup();let done=false;
 const playback=(async()=>{for(let i=1;i<=1000;i++)await new Promise(resolve=>env.scheduler.wait(i/44100,resolve,'vgm'));done=true;})();
 for(let i=0;i<1100&&!done;i++)await env.step();await playback;
 assert.ok(env.time<.03,`1000 samples took ${env.time}s`);assert.ok(env.timers<10);
});
test('late waits preserve separate tasks and drain promise continuations before next owner',async()=>{
 const env=setup(),seen=[];
 env.scheduler.wait(-1,()=>{seen.push('a');Promise.resolve().then(()=>seen.push('a microtask'));},'a');
 env.scheduler.wait(-1,()=>seen.push('b'),'b');
 await env.step();assert.deepEqual(seen,['a','a microtask']);await env.step();assert.deepEqual(seen,['a','a microtask','b']);assert.equal(env.timers,0);
});
test('cancel wakes a future wait without waiting for the clamped timer',async()=>{
 const env=setup();let resumed=false;env.scheduler.wait(10,()=>{resumed=true;},'a');env.scheduler.cancel('a');
 await env.step();await env.step();assert.equal(resumed,true);assert.equal(env.time,0);
});

test('seconds timeline catches up microsecond events under the timer clamp',async()=>{
 const env=setup();let done=false;
 const timeline=createSecondsTimeline({now:()=>env.time,sleep:seconds=>new Promise(resolve=>env.scheduler.wait(env.time+seconds,resolve))});
 const playback=(async()=>{for(let i=1;i<=1000;i++)await timeline.waitUntil(i/44100);done=true;})();
 for(let i=0;i<1100&&!done;i++)await env.step();await playback;
 assert.ok(env.time>=1000/44100);assert.ok(env.time<.03,`1000 timeline events took ${env.time}s`);assert.ok(env.timers<10);
});

test('seconds timeline excludes timer lateness and intervening work from later waits',async()=>{
 let now=100;const waits=[];
 const timeline=createSecondsTimeline({now:()=>now,sleep:async seconds=>{waits.push(seconds);now+=seconds+.004;}});
 await timeline.waitUntil(1);now+=.2;await timeline.waitUntil(2);
 assert.equal(waits[0],1);assert.ok(Math.abs(waits[1]-.796)<1e-9);
 assert.ok(Math.abs(now-102.004)<1e-9,'All event deadlines retain the original origin');
});

test('seconds timeline validates positions without advancing on invalid input',async()=>{
 const positions=[];
 const timeline=createSecondsTimeline({now:()=>10,sleep:async seconds=>{positions.push(seconds);}});
 for(const invalid of [-1,NaN,Infinity,-Infinity,'1',undefined])await assert.rejects(timeline.waitUntil(invalid),RangeError);
 await timeline.waitUntil(.5);await assert.rejects(timeline.waitUntil(.4),RangeError);await timeline.waitUntil(.5);
 assert.deepEqual(positions,[.5,.5]);
 const overflow=createSecondsTimeline({now:()=>Number.MAX_VALUE,sleep:async()=>assert.fail('Invalid target must not sleep')});
 await assert.rejects(overflow.waitUntil(Number.MAX_VALUE),RangeError);
});

test('late seconds timeline positions still yield and check cancellation on resume',async()=>{
 let now=0,stopped=false,resume,sleeps=0;
 const check=()=>{if(stopped)throw new Error('Run stopped');};
 const timeline=createSecondsTimeline({now:()=>now,check,sleep:seconds=>{assert.equal(seconds,0);sleeps++;return new Promise(resolve=>{resume=resolve;});}});
 now=2;let finished=false;
 const wait=timeline.waitUntil(1).then(()=>{finished=true;});
 await Promise.resolve();assert.equal(finished,false);stopped=true;resume();await assert.rejects(wait,/Run stopped/);
 await assert.rejects(timeline.waitUntil(2),/Run stopped/);assert.equal(sleeps,1);
 assert.throws(()=>createSecondsTimeline({now:()=>0,sleep:async()=>{},check}),/Run stopped/);
});
