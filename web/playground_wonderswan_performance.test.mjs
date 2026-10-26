import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessorPerformance,identifyPerformanceNote,nativeVoiceChannel} from './playground_performance_processor.js';

const control=(value,controlMask)=>({method:'writeRegister',args:[0x90,value],...(controlMask===undefined?{}:{controlMask})});
function setup(){
  let frame=0;const registers=new Uint8Array(32),applied=[],port={postMessage(){}};
  const performance=createProcessorPerformance({chip:'wonderswan',rate:1000,nowFrame:()=>frame,
    getWonderSwanRegisters:()=>registers,apply(command){
      applied.push(command);
      if(command.method==='writeRegister'){
        const[address,value]=command.args;
        registers[address-0x80]=address===0x90?(registers[16]&~(command.controlMask??255))|(value&(command.controlMask??255)):value;
      }
      if(command.method==='keyOff')registers[16]&=~(1<<command.args[0]);
    }});
  performance.receive({type:'performance-start',session:1},port);
  return{performance,registers,applied,port,
    enqueue(command,time,owner='loop'){performance.receive({performance:{session:1,owner,time},commands:[command]},port);},
    render(frames){performance.render(new Float32Array(frames),new Float32Array(frames),(l,r)=>{l.fill(0);r.fill(0);});frame+=frames;}};
}

test('WonderSwan mode-only changes preserve gate ownership while repeated keyOn acquires its channel',()=>{
  const state={wonderswanRegisters:new Uint8Array(32)};state.wonderswanRegisters[16]=3;
  assert.equal(identifyPerformanceNote('wonderswan',control(0x83,0x80),state),null);
  assert.deepEqual(identifyPerformanceNote('wonderswan',control(3,1),state),{events:[{key:0,on:true}]});
  assert.deepEqual(identifyPerformanceNote('wonderswan',control(1),state),{events:[{key:1,on:false}]});
});

test('WonderSwan retiring one loop releases only its gate, preserving newer owners and mode bits',()=>{
  const p=setup();p.enqueue(control(0x81,0x81),.001,'old');p.enqueue(control(3,2),.002,'new');
  p.enqueue(control(0,2),.003,'old');p.render(4);assert.equal(p.registers[16],0x83,'stale release was rejected');
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'old'},p.port);
  assert.equal(p.registers[16],0x82);
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'new'},p.port);
  assert.equal(p.registers[16],0x80);
});

test('WonderSwan manual CH4 retains gate and noise mode across shared raw control and global off',()=>{
  const p=setup();p.registers[16]=0x88;p.performance.beginAudition(3,'manual');
  p.enqueue(control(1),.001);p.render(2);assert.equal(p.registers[16],0x89);
  p.performance.receive({method:'allNotesOff',args:[]},p.port);assert.equal(p.registers[16],0x88);
  p.performance.receive(control(0),p.port);assert.equal(p.registers[16],0x88);
  p.performance.applyImmediate(control(0,0x88),p.port,{owner:'manual'});assert.equal(p.registers[16],0);
});

test('WonderSwan manual waveform lease blocks only its RAM and its pitch, permitting sibling voices',()=>{
  const p=setup();p.registers[15]=255;p.performance.beginAudition(2,'manual');
  for(const command of[{method:'writeMemory',args:[0x3fe1,255]},{method:'writeRegister',args:[0x84,160]}]){
    p.enqueue(command,.001);
  }
  p.enqueue({method:'writeMemory',args:[0x3fd1,255]},.001);p.render(2);
  assert.deepEqual(p.applied,[{method:'writeMemory',args:[0x3fd1,255]}]);
  assert.equal(nativeVoiceChannel('wonderswan',{method:'writeRegister',args:[0x8d,2]}),2);
  assert.equal(nativeVoiceChannel('wonderswan',{method:'writeRegister',args:[0x94,15]}),1);
});
