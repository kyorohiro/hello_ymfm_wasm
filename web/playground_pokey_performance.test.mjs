import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessorPerformance,identifyPerformanceNote,nativeVoiceChannel,performanceNoteRelease} from './playground_performance_processor.js';

const write=(reg,value)=>({method:'writeRegister',args:[reg,value]});
function setup(){
  let frame=0;const registers=new Uint8Array(16),applied=[],port={postMessage(){}};
  const performance=createProcessorPerformance({chip:'pokey',rate:1000,nowFrame:()=>frame,getPokeyRegisters:()=>registers,apply(command){applied.push(command);if(command.method==='writeRegister')registers[command.args[0]]=command.args[1];if(['keyOff','forceKeyOff'].includes(command.method))registers[command.args[0]*2+1]&=240;}});
  performance.receive({type:'performance-start',session:1},port);
  return {performance,registers,applied,port,enqueue(command,time,owner='loop'){performance.receive({performance:{session:1,owner,time},commands:[command]},port);},render(frames){performance.render(new Float32Array(frames),new Float32Array(frames),(l,r)=>{l.fill(0);r.fill(0);});frame+=frames;}};
}

test('POKEY identifies volume gates independently of distortion and maps physical versus shared registers',()=>{
  for(let ch=0;ch<4;ch++){
    assert.deepEqual(identifyPerformanceNote('pokey',write(ch*2+1,0xa8)),{key:ch,on:true});assert.deepEqual(identifyPerformanceNote('pokey',write(ch*2+1,0xf0)),{key:ch,on:false});assert.equal(identifyPerformanceNote('pokey',write(ch*2,72)),null);
    assert.equal(nativeVoiceChannel('pokey',write(ch*2,72)),ch);assert.equal(nativeVoiceChannel('pokey',write(ch*2+1,0xa8)),ch);assert.deepEqual(performanceNoteRelease('pokey',ch),{method:'forceKeyOff',args:[ch]});
  }
  assert.equal(nativeVoiceChannel('pokey',write(8,0x50)),'all');assert.equal(nativeVoiceChannel('pokey',write(9,0)),'all');assert.equal(nativeVoiceChannel('pokey',write(15,3)),'all');
});

test('POKEY joined upper audition protects both timer halves and shared filters',()=>{
  const p=setup();p.registers[8]=0x50;p.registers[3]=0xa8;p.performance.beginAudition(1,'joined');
  for(const command of [write(0,0),write(1,0),write(2,0),write(3,0),write(8,0)])p.enqueue(command,.001);
  p.enqueue(write(4,48),.001);p.enqueue(write(5,0xa6),.001);p.render(2);assert.deepEqual(p.applied,[write(4,48),write(5,0xa6)]);
  assert.equal(nativeVoiceChannel('pokey',write(0,0),{pokeyRegisters:p.registers}),1);assert.equal(nativeVoiceChannel('pokey',write(4,0),{pokeyRegisters:p.registers}),2);
});

test('POKEY immediate allNotesOff releases sibling voices while preserving held manual key',()=>{
  const p=setup();p.registers[1]=0xa8;p.registers[3]=0xa6;p.performance.beginAudition(0,'manual');
  assert.equal(p.performance.receive({method:'allNotesOff',args:[]},p.port),true);assert.equal(p.registers[1],0xa8);assert.equal(p.registers[3],0xa0);
});

test('POKEY cancelling a loop releases its four-channel gates without cutting a newer owner',()=>{
  const p=setup();p.enqueue(write(1,0xa8),.001,'old');p.enqueue(write(3,0xa6),.001,'old');p.enqueue(write(1,0xaf),.002,'new');p.enqueue(write(1,0xa0),.003,'old');p.render(4);assert.equal(p.registers[1],0xaf);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'old'},p.port);assert.equal(p.registers[3],0xa0);assert.equal(p.registers[1],0xaf);p.performance.receive({type:'performance-cancel-owner',session:1,owner:'new'},p.port);assert.equal(p.registers[1],0xa0);
});

test('POKEY held manual audition blocks its channel and shared clock modes while sibling notes continue',()=>{
  const p=setup();p.registers[1]=0xa8;p.performance.beginAudition(0,'manual');
  for(const command of [write(0,0),write(1,0),write(8,0x50),write(9,0),write(15,0)])p.enqueue(command,.001);
  p.enqueue(write(2,48),.001);p.enqueue(write(3,0xa6),.001);p.render(2);assert.deepEqual(p.applied,[write(2,48),write(3,0xa6)]);assert.equal(p.registers[1],0xa8);
  p.performance.applyImmediate({method:'keyOff',args:[0]},p.port,{owner:'manual'});p.performance.endAudition(0,'manual');assert.equal(p.registers[1],0xa0);assert.equal(p.registers[3],0xa6);
});
