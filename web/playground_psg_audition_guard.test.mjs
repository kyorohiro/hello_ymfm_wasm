import test from 'node:test';
import assert from 'node:assert/strict';
import {PsgInspectorState} from './playground_chip_inspector_state.js';
import {createPsgAuditionGuard} from './playground_audition_guard.js';

function setup(){
  const bytes=[],chip={write:byte=>bytes.push(byte),reset:()=>bytes.push('reset')};let guard;
  const inspector=new PsgInspectorState(chip,{
    dispatch:(command,owner)=>guard.apply(command,owner),beginAudition:(channel,owner)=>guard.begin(channel,owner),endAudition:(channel,owner)=>guard.end(channel,owner),
  });
  guard=createPsgAuditionGuard(chip,{getState:()=>inspector});
  return {bytes,chip,inspector,guard};
}

test('shared PSG raw latch/data writes cannot retune or stop a held tone, while other channels continue',()=>{
  const f=setup();f.inspector.invoke('auditionOn',[0,69,'held']);const before=f.inspector.read();f.bytes.length=0;
  for(const byte of [0x82,0x3f,0x9f])f.chip.write(byte);
  assert.deepEqual(f.bytes,[]);assert.deepEqual(f.inspector.read(),before,'blocked logical latch bytes cannot contaminate applied readback');
  f.chip.write(0xa5);f.chip.write(0x12);f.chip.write(0xb4);
  assert.deepEqual(f.bytes,[0xa5,0x12,0xb4]);
  f.inspector.invoke('auditionOn',[0,72,'new']);f.bytes.length=0;
  f.inspector.invoke('auditionOff',[0,'held']);assert.deepEqual(f.bytes,[]);
  f.chip.reset();assert.deepEqual(f.bytes,[],'a program reset cannot take a held manual tone');
  f.inspector.invoke('auditionOff',[0,'new']);assert.deepEqual(f.bytes,[0x9f]);
  f.chip.reset();assert.equal(f.bytes.at(-1),'reset');
});

test('script data continuation restores its logical register after a manual audition changes the physical latch',()=>{
  const f=setup();f.chip.write(0xa5);
  f.inspector.invoke('auditionOn',[0,69,'held']);assert.equal(f.inspector.latched,1);f.bytes.length=0;
  f.chip.write(0x12);
  assert.deepEqual(f.bytes,[0xa5,0x12]);assert.equal(f.inspector.read().channels[1].period,0x125);
  assert.equal(f.inspector.read().channels[0].frequency,3579545/(32*f.inspector.periods[0]));
});

test('a held PSG noise voice protects its tone-3 divider and releases all stale IDs on Stop',()=>{
  const f=setup();f.chip.write(0xc6);f.chip.write(0x22);f.chip.write(0xe3);
  f.inspector.invoke('auditionOn',[3,69,'noise']);const before=f.inspector.periods[2];f.bytes.length=0;
  for(const byte of [0xc1,0x3f,0xe0,0xff])f.chip.write(byte);
  assert.deepEqual(f.bytes,[]);assert.equal(f.inspector.periods[2],before);assert.equal(f.inspector.mode,3);
  f.chip.write(0xdf);f.chip.write(0x85);f.chip.write(0x12);
  assert.deepEqual(f.bytes,[0xdf,0x85,0x12],'tone-3 volume and another tone remain available');
  f.guard.clear();f.inspector.resetAuditions();assert.equal(f.bytes.at(-1),0xff);
  assert.deepEqual(f.inspector.read().auditions,[]);f.bytes.length=0;
  f.inspector.invoke('auditionOff',[3,'noise']);assert.deepEqual(f.bytes,[]);
  f.chip.write(0xe0);assert.deepEqual(f.bytes,[0xe0]);
});
