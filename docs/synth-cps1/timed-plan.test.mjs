// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {planTools} from './timed-plan.js';
import {createRegisterTimedProcessor} from '../js/register_timed_processor.js';
import {attachRegisterTimedClient} from '../js/register_timed_client.js';

for(const chip of ['ym2151','msm6295']){
  test(chip+' schedules ordered bytes at sample offsets and cancels repeats',async()=>{
    let frame=0,position=0;
    const events=[],tools=planTools(chip);
    const queue=createRegisterTimedProcessor({
      nowFrame:()=>frame,sampleRate:48000,write:(r,v)=>events.push([position,r,v]),
      checkAvailable(){},defaultOwner:'test',reportError:assert.fail,
    },tools);
    const api=attachRegisterTimedClient({},request=>queue.request(request),tools);
    const fm=chip==='ym2151';
    const plan=api.build(b=>{
      if(fm){b.keyOn(2,15);b.atSample(6).keyOff(2);}
      else{b.play(2,5,3);b.atSample(6).stop(2);}
    });
    const compiled=await api.compile(plan);
    assert.deepEqual(compiled.map(w=>w.value),fm?[122,2]:[133,67,32]);
    assert.throws(()=>tools.validateOperations({...plan,chip:'other'}));
    await api.schedule(plan,{name:'a',repeatSeconds:0.01});
    function render(frames){
      queue.render(frames,(offset,count)=>{position=frame+offset+count;});
      frame+=frames;
    }
    render(640);
    const first=fm?[[128,8,122],[134,8,2]]:[[128,0,133],[128,0,67],[134,0,32]];
    assert.deepEqual(events,[...first,...first.map(([n,r,v])=>[n+480,r,v])]);
    await api.clearSchedule('a');render(960);
    assert.equal(events.length,first.length*2);
  });
}
