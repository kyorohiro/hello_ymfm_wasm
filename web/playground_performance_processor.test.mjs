import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessorPerformance,identifyPerformanceNote,performanceNoteRelease} from './playground_performance_processor.js';

function setup(options={}) {
  let frame=0,value=0;const applied=[],messages=[];
  const port={postMessage:message=>messages.push(message)};
  const performance=createProcessorPerformance({rate:1000,nowFrame:()=>frame,
    apply(command){applied.push(command);if(command.method==='level')value=command.args[0];},...options});
  performance.receive({type:'performance-start',session:1},port);
  return {performance,applied,messages,port,
    enqueue(commands,time,owner='loop'){performance.receive({performance:{session:1,owner,time},commands},port);},
    render(frames,callback){const left=new Float32Array(frames),right=new Float32Array(frames);
      performance.render(left,right,callback??((l,r)=>{l.fill(value);r.fill(-value);}));frame+=frames;return[left,right];},
  };
}

test('independent RPC setters acknowledge acceptance and change exact future samples',()=>{
  const p=setup();p.enqueue([{method:'level',args:[.5],id:17}],.003);
  assert.deepEqual(p.messages.at(-1),{id:17,value:true});assert.equal(p.applied.length,0);
  const[left,right]=p.render(8);
  assert.deepEqual([...left],[0,0,0,.5,.5,.5,.5,.5]);assert(right.slice(0,3).every(value=>value===0));assert(right.slice(3).every(value=>value===-.5));
  assert.equal(p.applied.length,1);assert.equal(p.applied[0].id,undefined);
  assert.equal(p.messages.filter(message=>message.id===17).length,1,'acceptance is not acknowledged again at playback');
});

test('segment buffers are reused across fresh browser output arrays',()=>{
  const p=setup(),seen=new Map();
  for(let block=0;block<4;block++){
    p.enqueue([{method:'level',args:[block]}],(block*8+3)/1000);
    p.render(8,(left,right)=>{
      const previous=seen.get(left.length);if(previous){assert.equal(left,previous[0]);assert.equal(right,previous[1]);}
      else seen.set(left.length,[left,right]);left.fill(1);right.fill(2);
    });
  }
  assert.deepEqual([...seen.keys()],[3,5]);
});

test('resource preparation remains immediate and its real RPC result is preserved',()=>{
  let prepared=false;
  const p=setup({immediate:['loadMemory'],apply(command,port){prepared=true;port.postMessage({id:command.id,value:23});}});
  p.enqueue([{method:'loadMemory',id:11,args:[new Uint8Array([1,2])]}],.5);
  assert.equal(prepared,true);assert.deepEqual(p.messages.at(-1),{id:11,value:23});assert.equal(p.performance.getStats().queuedCommands,0);
});

test('cancelled future playback completion RPC is rejected instead of hanging',()=>{
  const p=setup({prepare:command=>command});p.enqueue([{method:'schedule',id:8,args:[]}],.5);
  assert.equal(p.messages.some(message=>message.id===8),false);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'loop'},p.port);
  assert.match(p.messages.find(message=>message.id===8).error,/cancelled/);
  p.render(1000);assert.equal(p.applied.length,0);
});

test('invalid and expired request envelopes reject their original RPC identifiers',()=>{
  const p=setup({validate(command){if(command.method==='bad')throw Error('bad note');}});
  p.enqueue([{method:'bad',id:4}],.5);assert.equal(p.messages.find(message=>message.id===4).error,'bad note');
  p.performance.receive({type:'performance-stop',session:1},p.port);
  p.enqueue([{method:'level',args:[1],id:5}],.5);
  assert.match(p.messages.find(message=>message.id===5).error,/session|owner|active/i);
  assert.equal(p.applied.length,0);
});

test('a retired DX7 owner cannot release a replacement owner on the same MIDI note',()=>{
  const p=setup({chip:'dx7'});
  p.enqueue([{method:'noteOn',args:[60,100]}],.001,'old');
  p.enqueue([{method:'noteOn',args:[60,90]}],.002,'new');
  p.enqueue([{method:'noteOff',args:[60]}],.003,'old');
  p.render(4);assert.deepEqual(p.applied.map(command=>command.method),['noteOn','noteOn']);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'old'},p.port);
  assert.equal(p.applied.length,2);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'new'},p.port);
  assert.deepEqual(p.applied.at(-1),{method:'noteOff',args:[60]});
});

for(const [name,command,key]of[
  ['rf5c164',{method:'keyOn',args:[3]},3],['nes',{method:'setChannelEnabled',args:[1,true]},1],
  ['gameboy',{method:'writeRegister',args:[14,128]},2],['segapsg',{method:'write',args:[0xd2]},2],
  ['ym2151',{method:'writeRegister',args:[8,0x7a]},2],['ym2612',{method:'write',args:[0,0x28,0xf4]},3],
  ['ym2608',{method:'write',args:[0,0x28,0xf1]},1],['pwm',{method:'write',args:[2,700]},0],
])test(`${name}: cancelling the applied owner releases only its tracked channel`,()=>{
  assert.deepEqual(identifyPerformanceNote(name,command),{key,on:true});
  const p=setup({chip:name});p.enqueue([command],.001,'voice');p.render(2);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'voice'},p.port);
  assert.deepEqual(p.applied.at(-1),performanceNoteRelease(name,key));
});

for (const [channel,latch] of [[0,0x9f],[3,0xff]]) test(`PSG raw continuation acquires voice ${channel} at its applied volume latch`,()=>{
  const p=setup({chip:'segapsg'});
  const commands=[0x8a,0x10,latch,0x01].map(byte=>({method:'write',args:[byte]}));
  p.enqueue(commands,.001,'raw'); p.render(2);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'raw'},p.port);
  assert.deepEqual(p.applied.at(-1),{method:'write',args:[latch]});
  assert.equal(p.applied.length,commands.length+1);
});

test('PSG continuation follows applied shared latch order and a stale owner cannot mute another channel',()=>{
  const p=setup({chip:'segapsg'}), write=byte=>({method:'write',args:[byte]});
  // Submitted in the opposite order to playback. The last hardware latch is CH2.
  p.enqueue([write(0xbf),write(0x02)],.002,'new');
  p.enqueue([write(0x9f),write(0x01)],.001,'old');
  p.enqueue([write(0x0f)],.003,'old');
  p.render(4);
  assert.deepEqual(p.applied.map(command=>command.args[0]),[0x9f,0x01,0xbf,0x02]);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'old'},p.port);
  assert.equal(p.applied.at(-1).args[0],0x9f,'old owns CH1, not the last shared CH2 latch');
  // Releasing old changed the hardware latch to CH1. A continuation now owns CH1.
  p.enqueue([write(0x03)],.004,'third'); p.render(1);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'third'},p.port);
  assert.equal(p.applied.at(-1).args[0],0x9f);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'new'},p.port);
  assert.equal(p.applied.at(-1).args[0],0xbf);
});

test('PSG continuation honors an observed hardware latch from Main or inspector writes',()=>{
  let latched=7;
  const p=setup({chip:'segapsg',getPsgLatch:()=>latched});
  p.enqueue([{method:'write',args:[0x01]}],.001,'worker'); p.render(2);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'worker'},p.port);
  assert.deepEqual(p.applied.at(-1),{method:'write',args:[0xff]});
});

test('PSG tone-3-rate noise leases its shared divider while tone volume and other channels remain live',()=>{
  let mode=7,latched=7;const p=setup({chip:'segapsg',getPsgMode:()=>mode,getPsgLatch:()=>latched});
  const write=(byte,psgRegister)=>({method:'write',args:[byte],...(psgRegister===undefined?{}:{psgRegister})});
  p.performance.beginAudition(3,'manual-noise');
  p.enqueue([write(0xc3),write(0x12,4),write(0xd8),write(0x8a),write(0x10,0),write(0x98)],.001,'code');p.render(2);
  assert.deepEqual(p.applied.map(command=>command.args[0]),[0xd8,0x8a,0x10,0x98]);
  p.performance.applyImmediate(write(0xc2),p.port,{owner:'manual-noise'});assert.equal(p.applied.at(-1).args[0],0xc2,'the noise owner may deliberately edit its own shared divider');
  p.performance.endAudition(3,'expired');assert.equal(p.performance.receive(write(0xc4),p.port),true,'an expired release cannot unlock the held noise divider');assert.equal(p.applied.at(-1).args[0],0xc2);
  mode=6;p.enqueue([write(0xc5),write(0x11,4)],.002);p.render(1);assert.deepEqual(p.applied.slice(-2).map(command=>command.args[0]),[0xc5,0x11],'fixed-rate noise does not reserve tone 3 pitch');
  mode=7;p.performance.endAudition(3,'manual-noise');p.enqueue([write(0xc6),write(0x13,4)],.003);p.render(1);assert.deepEqual(p.applied.slice(-2).map(command=>command.args[0]),[0xc6,0x13]);
});
