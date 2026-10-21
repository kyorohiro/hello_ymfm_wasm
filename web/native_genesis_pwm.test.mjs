import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisPwm} from './native_genesis_pwm.js';
import {PWM32XPlayback} from './pwm32x_playback.js';

function fixture(){
  const playback=new PWM32XPlayback({sampleRate:48000}),commands=[],calls=[],future=[];let lastSchedule=null,override;
  const snapshot=()=>override??({...playback.getState(),registers:Array.from({length:5},(_,i)=>playback.read(i)),lastSchedule});
  const apply=message=>{
    if(message.method==='write')playback.write(message.register,message.value);
    else if(message.method==='reset')playback.reset();
    else if(message.method==='clock')playback.setClock(message.hz);
    else if(message.method==='clear-schedule')playback.clearSchedule();
    else if(message.method==='stop-voices'){playback.clearSchedule();playback.chip.left=playback.chip.right=null;playback.chip.leftFifo.length=playback.chip.rightFifo.length=0;}
    else if(message.method==='schedule-writes'){
      const baseFrame=Math.max(playback.frame,message.baseFrame??playback.frame);
      playback.scheduleWrites(message.entries.map(write=>({...write,frame:write.frame+baseFrame-playback.frame})));
      playback.generateStereo(0);lastSchedule={id:message.id,baseFrame};
    }
  };
  const synth={session:1,generation:1,clock:{sampleRate:48000},isReady:()=>true,stopping:null,closing:false,frameAt:time=>Math.round(time*48000),
    enqueue(command){commands.push(command);if(command.frame>playback.frame)future.push(command);else apply(command.message);},
    async flush(){},async nativeRequest(command,args){calls.push({command,args});return snapshot();}};
  const adapter=createNativeGenesisPwm(synth);
  return {adapter,synth,commands,calls,playback,malformed(value){override=value;},advance(frames){playback.generateStereo(frames);for(let i=0;i<future.length;)if(future[i].frame<=playback.frame)apply(future.splice(i,1)[0].message);else i++;}};
}
test('Native PWM client preserves exact register masking and applied inspector state without an audio node',async()=>{
  const f=fixture(),pwm=f.adapter.client;assert.equal(pwm.id,'pwm');assert.equal(pwm.clock,23011361);
  await pwm.write(0,5);await pwm.writeRegister(1,1000);await pwm.write(2,-1);
  assert.equal(await pwm.read(0),5);assert.equal(await pwm.read(1),1000);assert.equal(await pwm.read(99),65535);
  assert.equal(f.commands.find(command=>command.message.register===2).message.value,65535);
  const view=await f.adapter.read();assert.equal(view.kind,'pwm');assert.equal(view.outputMode,'duty');assert.deepEqual(view.routing,{left:1,right:1});
  assert.deepEqual(view.fifo.left,{empty:false,full:false});assert(f.calls.every(call=>call.command==='native_genesis_pwm_status'));
  await f.adapter.mix(.5,-1);assert.deepEqual(f.commands.at(-1).message,{method:'mix',volume:.5,pan:-1});
  pwm.dispose();assert.equal(await pwm.read(0),5);
});
test('Native PWM Worker scheduling reserves immediately with the exact future base and returns a real RPC result',async()=>{
  const f=fixture();const result=await f.adapter.dispatch({method:'scheduleWrites',args:[[{frame:2,register:2,value:100}]],id:55},{time:.3,performance:1,owner:7});
  assert.deepEqual(result,{id:55,value:14400});const command=f.commands[0];assert.equal(command.frame,0);assert.equal(command.message.baseFrame,14400);assert.equal(command.owner,7);
  assert.equal(command.performance,1);assert.equal(f.playback.queue[0].frame,14402);assert.equal(f.playback.frame,0);
  await f.adapter.dispatch({method:'write',args:[1,77],id:56},{time:.3,performance:1,owner:7});assert.equal(f.commands.at(-1).frame,14400);
  assert.equal(await f.adapter.client.read(1),0);assert.equal(f.calls.at(-1).args.after>0,true);
});
test('Native PWM schedule entries are owned and equal-frame writes retain caller order',async()=>{
  const f=fixture(),entries=[{frame:2,register:1,value:1},{frame:2,register:2,value:100},{frame:2,register:2,value:200}];
  const pending=f.adapter.client.scheduleWrites(entries);entries[1].value=999;assert.equal(await pending,0);
  f.advance(2);assert.deepEqual(f.playback.chip.leftFifo,[100,200]);assert.equal((await f.adapter.client.getState()).queuedWrites,0);
  await Promise.all([f.adapter.client.scheduleWrites([{frame:100,register:4,value:200}]),f.adapter.client.scheduleWrites([{frame:200,register:4,value:300}])]);
  assert.equal((await f.adapter.client.getState()).queuedWrites,2);await f.adapter.client.clearSchedule();assert.equal((await f.adapter.client.getState()).queuedWrites,0);
});
test('Native PWM Stop preserves clock routing and cycle; Reset keeps output frame',async()=>{
  const f=fixture(),pwm=f.adapter.client;await pwm.setClock(12000000);await pwm.write(0,5);await pwm.write(1,1000);await pwm.write(4,500);f.advance(20);
  await pwm._stopVoices();const state=await pwm.getState();assert.equal(state.clock,12000000);assert.equal(await pwm.read(0),5);assert.equal(await pwm.read(1),1000);assert.equal(state.currentFrame,20);
  f.adapter.adoptStopped({...state,registers:[5,1000,16384,16384,16384]});assert.equal(pwm.clock,12000000);
  await f.adapter.invoke('reset');assert.equal((await pwm.getState()).currentFrame,20);assert.equal(await pwm.read(0),0);
});
test('Native PWM rejects invalid reservations atomically and lifecycle cancellation asynchronously',async()=>{
  const f=fixture();await assert.rejects(f.adapter.client.scheduleWrites([{frame:-1,register:2,value:4}]),/scheduled frame/);assert.equal(f.commands.length,0);
  await assert.rejects(f.adapter.client.write(5,1),/register/);assert.equal(f.commands.length,0);
  f.synth.stopping=Promise.resolve();let operation;assert.doesNotThrow(()=>{operation=f.adapter.client.read(0);});await assert.rejects(operation,/cancelled/);
  f.synth.stopping=null;f.malformed({clock:1});await assert.rejects(f.adapter.read(),/clock/);
});
