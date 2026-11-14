import test from 'node:test';import assert from 'node:assert/strict';
import {createSnesMixer} from './mixer.js';
test('shared mixer is passive and re-applies canonical chip gain / masks to replaced audio and SPC sources',async()=>{
 let engine=null;const changes=[],commands=[],masks=[],gains=[];const player={setMuteMask:async mask=>masks.push(mask)};
 const mixer=createSnesMixer({getAudio:()=>engine,player,onChange:state=>changes.push(state)});mixer.setVolume(.5);await mixer.setMuteMask(0x22);assert.deepEqual(commands,[]);
 engine={setChipVolume:value=>gains.push(value),command:async(...args)=>commands.push(args)};await mixer.apply();assert.deepEqual(commands,[['setMuteMask',[0x22]]]);assert.deepEqual(gains,[.5]);await mixer.reset();assert.deepEqual(mixer.read(),{volume:1,muteMask:0});assert.equal(masks.at(-1),0);assert.throws(()=>mixer.setVolume(4));await assert.rejects(mixer.setMuteMask(256));
});

test('mixer changes during unpublished audio initialization are reconciled before publishing the engine',async()=>{
 let resolve,entered;const gate=new Promise(r=>resolve=r),started=new Promise(r=>entered=r),masks=[],gains=[];let first=true;const owner={setChipVolume:v=>gains.push(v),command:async(_method,[mask])=>{masks.push(mask);if(first){first=false;entered();await gate;}}};const mixer=createSnesMixer({getAudio:()=>null,player:{setMuteMask:async()=>{}}});const applying=mixer.apply(owner);await started;mixer.setVolume(.4);await mixer.setMuteMask(5);resolve();await applying;assert.equal(gains.at(-1),.4);assert.equal(masks.at(-1),5);
});
