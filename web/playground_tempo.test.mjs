import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundClock} from './playground_clock.js';
import {createPlaygroundMusic} from './playground_music.js';
import {createMidiApi} from './playground_midi.js';
import {NativeFXEngine} from './native_fx_engine.js';

function fixture() {
  let time=0, token=1, context=null;
  const tasks=new Set();
  const state={bpm:120,clockStartTime:null,sampleClockStartTime:null};
  const clock=createPlaygroundClock({runtime:state,getAudioContext:()=>({currentTime:time}),
    getCurrentRunToken:()=>token,getCurrentLoopContext:()=>context,setCurrentLoopContext:value=>context=value,
    setTimer(fn,ms){const task={fn,at:time+ms/1000};tasks.add(task);return task;},
    clearTimer:task=>tasks.delete(task),createTaskChannel:()=>null,
  });
  return {clock,state,get time(){return time;},
    setLoop(value){context=value;},
    stop(){token++;clock.cancelWaits();},
    async advance(seconds){
      const target=time+seconds;
      for(let count=0;count<10000;count++){
        for(let i=0;i<20;i++)await Promise.resolve();
        const next=[...tasks].sort((a,b)=>a.at-b.at)[0];
        if(!next||next.at>target){time=target;for(let i=0;i<20;i++)await Promise.resolve();return;}
        tasks.delete(next);time=next.at;next.fn();
      }
      assert.fail('Clock did not advance');
    },
  };
}
const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('setting tempo before music starts does not bind the beat clock to an earlier time origin',async()=>{
  const env=fixture();env.clock.setBpm(60);assert.equal(env.state.clockStartTime,null);
  await env.advance(10);const pending=env.clock.beat(1);await env.advance(1);await pending;close(env.clock.currentBeat(),1);
});

for(const loop of [false,true])test(`tempo preserves phase and retimes beat/nextBeat waits, loop=${loop}`,async()=>{
  const env=fixture();if(loop)env.setLoop({runToken:1,stopped:false,cursorBeat:0});
  let ended=false;const waiting=env.clock.beat(1).then(()=>ended=true);
  await env.advance(.25);close(env.clock.currentBeat(),.5);
  env.clock.setBpm(60);close(env.clock.currentBeat(),.5);
  await env.advance(.25);assert(!ended);
  await env.advance(.25);await waiting;assert(ended);close(env.clock.currentBeat(),1);
  let synced=false;const next=env.clock.nextBeat().then(()=>synced=true);
  await env.advance(.25);env.clock.setBpm(120);close(env.clock.currentBeat(),1.25);
  await env.advance(.374);assert(!synced);await env.advance(.001);await next;close(env.clock.currentBeat(),2);
});

test('seconds and explicit sample-rate waits are independent of tempo',async()=>{
  const env=fixture();let seconds=false,samples=false;
  const a=env.clock.sleep(1).then(()=>seconds=true);
  const b=env.clock.sleepSamples(48000,48000).then(()=>samples=true);
  await env.advance(.25);env.clock.setBpm(60);await env.advance(.74);
  assert(!seconds&&!samples);await env.advance(.01);await Promise.all([a,b]);assert(seconds&&samples);
});

for(const unit of ['seconds','beats'])test(`tween ${unit}: start/progress/end and tempo change`,async()=>{
  const env=fixture(),values=[];
  const duration=unit==='beats'?{beats:2}:{seconds:1};
  const waiting=env.clock.tween(duration,p=>values.push(p));
  await env.advance(.25);close(values[0],0);
  env.clock.setBpm(60);await env.advance(.25);
  close(values.at(-1),unit==='beats'?.375:.5);
  await env.advance(unit==='beats'?1.25:.5);await waiting;
  assert.equal(values.at(-1),1);assert.equal(values.filter(p=>p===1).length,1);
  assert(values.every((value,index)=>index===0||value>values[index-1]));
});

test('tween zero, invalid units, cancellation and async-callback failure',async()=>{
  const env=fixture(),zero=[];await env.clock.tween({beats:0},p=>zero.push(p));assert.deepEqual(zero,[1]);
  for(const value of [{beats:1,seconds:1},{},{beats:-1},{seconds:NaN},{seconds:Infinity},{beats:'1'}])await assert.rejects(env.clock.tween(value,()=>{}));
  const values=[];const stopped=env.clock.tween({beats:10},p=>values.push(p));
  const rejection=assert.rejects(stopped,/Run stopped/);
  await env.advance(.1);env.stop();env.clock.setBpm(60);await env.advance(0);await rejection;assert(!values.includes(1));
  const failure=env.clock.tween({seconds:1},async()=>{throw Error('callback failed');});await assert.rejects(failure,/callback failed/);
});

test('cancelled beat waits are not revived by a tempo change',async()=>{
  const env=fixture();const pending=env.clock.beat(100);const rejection=assert.rejects(pending,/Run stopped/);
  env.stop();env.clock.setBpm(60);await env.advance(0);await rejection;
});

test('FX tempo conversion updates cycles per second without recreating units',()=>{
  const writes=[];
  const engine=Object.create(NativeFXEngine.prototype);
  engine.sampleRate=48000;
  engine.api={extra_set(...args){writes.push(args);return true;}};
  engine.units=new Map([
    ['wobble',{type:'wobble',slot:0,values:{cutoff:800,depth:1100,rate:1,resonance:.707,mix:1}}],
    ['slicer',{type:'slicer',slot:0,values:{phase:1,duty:.5,floor:0,mix:1}}],
  ]);
  engine.command({op:'tempo',beatSeconds:.5});
  assert(writes.some(([type,slot,index,value])=>type===11&&index===2&&value===2));
  assert(writes.some(([type,slot,index,value])=>type===13&&index===0&&value===2));
  writes.length=0;engine.command({op:'tempo',beatSeconds:1});
  assert(writes.some(([type,slot,index,value])=>type===11&&index===2&&value===1));
  assert(writes.some(([type,slot,index,value])=>type===13&&index===0&&value===1));
});

for(const mode of ['fm','midi'])for(const unit of ['beats','seconds'])test(`${mode} note length ${unit} follows the selected clock`,async()=>{
  const env=fixture(),events=[];
  const waits={sleep:env.clock.sleep,waitBeats:beats=>env.clock.waitForBeat(env.clock.currentBeat()+beats)};
  let play;
  if(mode==='fm'){
    play=createPlaygroundMusic({...waits,getBpm:()=>env.state.bpm,activeNotes:new Set(),presets:{},
      noteToSemitone:{C:0},pitchReference:{},createPitchFromMidi:()=>({block:4,fnum:500}),
      synth:()=>({noteOn(){events.push(['on',env.time]);},noteOff(){events.push(['off',env.time]);}})}).play;
  }else{
    const api=createMidiApi(async method=>{if(method==='noteOn'){events.push(['on',env.time]);return 1;}if(method==='release')events.push(['off',env.time]);},
      {...waits,bpm:()=>env.state.bpm});
    const output=api.output('tetorica-ym2612');play=output.play.bind(output);
  }
  const pending=play('C4',unit==='beats'?{beats:1}:{seconds:.5});
  await env.advance(.25);env.clock.setBpm(60);await env.advance(.25);
  if(unit==='beats'){assert.equal(events.length,1);await env.advance(.25);}
  await pending;close(events.at(-1)[1],unit==='beats'?.75:.5);
});
