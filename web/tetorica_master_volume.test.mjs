import test from 'node:test';
import assert from 'node:assert/strict';
import {TetoricaAudioRuntime} from './tetorica_audio_runtime.js';

function harness({state='running',value=1}={}){
 const context={state,currentTime:1};
 let intrinsic=value;
 const events=[],calls=[];
 const at=time=>{
  let current=intrinsic,previousTime=0,target=null,tau=1;
  for(const event of events){
   if(event.time>time)break;
   if(target!==null)current=target+(current-target)*Math.exp(-(event.time-previousTime)/tau);
   if(event.type==='set'){current=event.value;target=null;}
   else {target=event.value;tau=event.tau;}
   previousTime=event.time;
  }
  return target===null?current:target+(current-target)*Math.exp(-(time-previousTime)/tau);
 };
 const gain={
  // The runtime must leave the current automation value to the audio engine.
  get value(){return intrinsic;},
  set value(next){calls.push(['immediate',next]);intrinsic=next;events.push({time:context.currentTime,value:next,type:'set'});},
  cancelScheduledValues(time){calls.push(['cancel',time]);while(events.at(-1)?.time>=time)events.pop();},
  setValueAtTime(next,time){calls.push(['set',next,time]);intrinsic=next;events.push({time,value:next,type:'set'});},
  setTargetAtTime(next,time,tau){calls.push(['target',next,time,tau]);events.push({time,value:next,tau,type:'target'});},
  cancelAndHoldAtTime(){throw new Error('Master gain must not depend on cancelAndHoldAtTime');},
 };
 const runtime=new TetoricaAudioRuntime({audioContext:context,masterVolume:value});runtime.masterOutputNode={gain};
 return {runtime,context,gain,calls,at};
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,actual+' differs from '+expected);

test('master gain approaches mute/unmute without a DC step and reports the requested target',()=>{
 const {runtime,context,calls,at}=harness();
 assert.equal(runtime.setMasterVolume(0),0);assert.equal(runtime.masterVolume,0);
 near(at(1),1);near(at(1.001),Math.exp(-1));near(at(1.005),Math.exp(-5));
 let previous=at(1);
 for(let frame=1;frame<=240;frame++){
  const current=at(1+frame/48000);assert.ok(Math.abs(current-previous)<=1-Math.exp(-1/48)+1e-9);previous=current;
 }
 context.currentTime=2;runtime.setMasterVolume(1);
 assert.equal(runtime.masterVolume,1);near(at(2),0);near(at(2.005),1-Math.exp(-5));
 assert.equal(calls.filter(([type])=>type==='immediate').length,0);
});

test('rapid master-volume retargets preserve the current exponential gain',()=>{
 const {runtime,context,at}=harness();
 runtime.setMasterVolume(0);context.currentTime=1.002;
 const first=Math.exp(-2);near(at(context.currentTime),first);runtime.setMasterVolume(.8);
 near(at(1.002),first);const second=.8+(first-.8)*Math.exp(-1);near(at(1.003),second);
 context.currentTime=1.003;runtime.setMasterVolume(.8);
 near(at(1.004),.8+(first-.8)*Math.exp(-2));
 const third=at(1.004);context.currentTime=1.004;runtime.setMasterVolume(.2);
 near(at(1.004),third);near(at(1.005),.2+(third-.2)*Math.exp(-1));assert.equal(runtime.masterVolume,.2);
});

test('master volume initializes immediately before routing and while audio is suspended',()=>{
 const runtime=new TetoricaAudioRuntime();assert.equal(runtime.setMasterVolume(.25),.25);assert.equal(runtime.masterVolume,.25);
 const h=harness({state:'suspended'});h.runtime.setMasterVolume(.25);
 assert.equal(h.gain.value,.25);assert.equal(h.runtime.masterVolume,.25);
 assert.equal(h.calls.filter(([type])=>type==='target').length,0);
 h.context.state='running';h.runtime.setMasterVolume(1);near(h.at(1),.25);
 h.context.currentTime=1.002;h.context.state='suspended';h.runtime.setMasterVolume(.4);
 assert.equal(h.gain.value,.4);
 h.context.state='running';h.runtime.setMasterVolume(.8);near(h.at(1.002),.4);near(h.at(1.007),.8+(.4-.8)*Math.exp(-5));
});

test('a replaced output gain starts from its own value',()=>{
 const first=harness(),second=harness({value:.3});first.runtime.setMasterVolume(0);first.context.currentTime=1.002;
 first.runtime.masterOutputNode={gain:second.gain};first.runtime.setMasterVolume(.5);
 near(second.at(1.002),.3);near(second.at(1.007),.5+(.3-.5)*Math.exp(-5));
});
