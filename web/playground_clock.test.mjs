import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeadlineScheduler} from './playground_clock.js';
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
