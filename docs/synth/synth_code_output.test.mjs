// Only fake AudioParams, audio clocks, and timers. No device or speaker opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CODE_STOP_FADE_SECONDS,createSynthCodeOutput} from './synth_code_output.js';

function fixture({state='running',value=1}={}) {
  let wall=0,nextTimer=0;
  const events=[],timers=new Map(),context={state,currentTime:2,sampleRate:48000};
  const gain={context,gain:{value,cancelScheduledValues:at=>events.push(['cancel',at]),
    setValueAtTime:(v,at)=>events.push(['set',v,at]),linearRampToValueAtTime:(v,at)=>events.push(['ramp',v,at])}};
  let activeContext=context,activeGain=gain;
  const output=createSynthCodeOutput({getContext:()=>activeContext,getGain:()=>activeGain,nowMs:()=>wall,
    setTimer:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:wall+delay});return id;},clearTimer:id=>timers.delete(id)});
  function advance(milliseconds,audioSeconds=milliseconds/1000) {
    wall+=milliseconds;context.currentTime+=audioSeconds;
    const due=[...timers].filter(([,timer])=>timer.at<=wall);
    for(const [id,timer] of due){timers.delete(id);timer.fn();}
  }
  return {output,events,timers,context,gain,advance,replace:()=>{
    activeContext={state:'running',currentTime:0,sampleRate:48000};
    activeGain={context:activeContext,gain:{...gain.gain,value:1}};
  }};
}

test('Stop waits for the complete post-FX gate ramp before physical cleanup',async()=>{
  const f=fixture(),order=[],stopping=f.output.fadeOut();
  stopping.then(()=>order.push('notes off; FX disposed'));
  assert.deepEqual(f.events,[['cancel',2],['set',1,2],['ramp',0,2+CODE_STOP_FADE_SECONDS]]);
  assert.equal(f.output.fadeOut(),stopping,'repeated Stop shares the same completion fence');
  f.advance(8,.004);await Promise.resolve();
  assert.deepEqual(order,[],'wall time alone cannot release notes before the rendered ramp');
  assert.equal(f.timers.size,1);
  f.advance(4,.006);assert.equal(await stopping,true);
  assert.deepEqual(order,['notes off; FX disposed']);assert.equal(f.timers.size,0);
  const count=f.events.length;assert.equal(await f.output.fadeOut(),true);assert.equal(f.events.length,count,'already-muted Stop has no new ramp');
});

test('opening after cleanup holds one quantum, fades in, and Apply preserves that automation',async()=>{
  const f=fixture(),stopping=f.output.fadeOut();f.advance(10);await stopping;
  const start=f.context.currentTime+128/48000;
  f.output.open();
  assert.deepEqual(f.events.slice(-4),[['cancel',f.context.currentTime],['set',0,f.context.currentTime],['set',0,start],['ramp',1,start+.004]]);
  const count=f.events.length;f.output.open();assert.equal(f.events.length,count,'Apply cannot restart a live gate fade-in');
  f.advance(3);f.output.fadeOut();
  const expected=(f.context.currentTime-start)/.004;
  assert(Math.abs(f.events.at(-2)[1]-expected)<1e-10,'a fast second Stop starts at the current fade-in level');
  f.output.dispose();
});

test('an old fade callback cannot mute a reopened program or settle a newer Stop',async()=>{
  const f=fixture(),first=f.output.fadeOut(),stale=[...f.timers.values()][0].fn;
  f.advance(3,.003);f.output.open();assert.equal(await first,false);assert.equal(f.timers.size,0);
  const second=f.output.fadeOut(),before=f.events.length;
  stale();assert.equal(f.events.length,before);assert.equal(f.timers.size,1);
  f.advance(10);assert.equal(await second,true);assert.equal(f.timers.size,0);
});

test('a scheduled input stays muted until its audio start, including a suspended clock',async()=>{
  for(const state of ['running','suspended']) {
    const f=fixture({state}),stopping=f.output.fadeOut();f.advance(10);await stopping;
    const now=f.context.currentTime,inputStart=now+.02;
    f.output.open({notBefore:inputStart});
    assert.deepEqual(f.events.slice(-4),[['cancel',now],['set',0,now],['set',0,inputStart],['ramp',1,inputStart+.004]]);
    const count=f.events.length;f.output.open({notBefore:inputStart+.1});
    assert.equal(f.events.length,count,'a repeated open cannot move the existing fade-in');
    f.output.dispose();
  }
});

test('a replacement scheduled input reanchors the ramp after an interrupted opening',async()=>{
  const f=fixture(),stopping=f.output.fadeOut();f.advance(10);await stopping;
  f.output.open({notBefore:f.context.currentTime+.01,freshInput:true});
  f.advance(1);const now=f.context.currentTime,nextInput=now+.02;
  f.output.open({notBefore:nextInput,freshInput:true});
  assert.deepEqual(f.events.slice(-4),[['cancel',now],['set',0,now],['set',0,nextInput],['ramp',1,nextInput+.004]]);
  const count=f.events.length;f.output.open();assert.equal(f.events.length,count,'ordinary Apply still preserves the replacement ramp');
  f.output.dispose();
});

test('initial Keyboard output and missing routes need no extra gain automation',async()=>{
  const f=fixture();f.output.open();assert.deepEqual(f.events,[]);
  const missing=createSynthCodeOutput({getContext:()=>null,getGain:()=>null});
  assert.equal(await missing.fadeOut(),true);missing.open();missing.dispose();
});

test('suspended and closed contexts close immediately without waiting for the frozen audio clock',async()=>{
  for(const state of ['suspended','closed']) {
    const f=fixture({state});assert.equal(await f.output.fadeOut(),true);
    assert.deepEqual(f.events,[['cancel',2],['set',0,2]]);assert.equal(f.timers.size,0);
  }
  const f=fixture(),stop=f.output.fadeOut();f.context.state='suspended';f.advance(8,0);
  assert.equal(await stop,true);assert.deepEqual(f.events.at(-1),['set',0,2]);
});

test('a stalled context has a bounded cleanup fence and remains muted on later resume',async()=>{
  const f=fixture(),stop=f.output.fadeOut();let settled=false;stop.then(()=>{settled=true;});
  f.advance(99,0);await Promise.resolve();assert.equal(settled,false);
  f.advance(2,0);assert.equal(await stop,true);
  assert.deepEqual(f.events.slice(-2),[['cancel',2],['set',0,2]]);assert.equal(f.timers.size,0);
});

test('context replacement and disposal retire pending timers without touching the newer route',async()=>{
  const f=fixture(),stop=f.output.fadeOut(),stale=[...f.timers.values()][0].fn,before=f.events.length;
  f.replace();f.advance(8);assert.equal(await stop,false);assert.equal(f.events.length,before);f.output.open();assert.equal(f.events.length,before);
  const g=fixture(),old=g.output.fadeOut();g.output.dispose();assert.equal(await old,false);assert.equal(g.timers.size,0);
  const count=g.events.length;g.output.open();stale();assert.equal(g.events.length,count);assert.equal(await g.output.fadeOut(),true);
});
