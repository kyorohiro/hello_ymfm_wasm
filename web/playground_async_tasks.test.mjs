import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoopAsyncTasks} from './playground_async_tasks.js';
import {createPlaygroundClock} from './playground_clock.js';
for(const method of ['sleep','sleepSamples','beat'])test(`tracked failure interrupts ${method} and the next wait with original reason`,async()=>{
 let current={runToken:1};const failed=current,other={runToken:1};let reject;
 const clock=createPlaygroundClock({runtime:{bpm:120,clockStartTime:0,sampleClockStartTime:0},getAudioContext:()=>({currentTime:0}),getCurrentRunToken:()=>1,getCurrentLoopContext:()=>current,setCurrentLoopContext:s=>{current=s;},setTimer:setTimeout});
 const tracker=createLoopAsyncTasks({getLoop:()=>current,cancelWaits:s=>clock.cancelWaits(s)});
 tracker.track(new Promise((_,r)=>{reject=r;}));
 const waiting=clock[method](method==='sleepSamples'?441000:60);
 current=other;const error=new Error('memory upload failed');reject(error);
 await assert.rejects(waiting,e=>e===error);assert.equal(other.interruptError,undefined);
 current=failed;await assert.rejects(clock[method](60),e=>e===error);tracker.clear();
});
test('finish waits for tasks, Stop releases it, late errors cannot poison replacement loop',async()=>{
 let current={name:'a'},reject;const old=current;
 const tracker=createLoopAsyncTasks({getLoop:()=>current,cancelWaits(){}});
 tracker.track(new Promise((_,r)=>{reject=r;}));let finished=false;
 const end=tracker.finish(old).then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);
 tracker.clear();await end;current={name:'a'};reject(new Error('late'));await Promise.resolve();assert.equal(current.interruptError,undefined);assert.equal(old.interruptError,undefined);
});
