import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessorPerformance,identifyPerformanceNote,nativeVoiceChannel,performanceNoteRelease} from '../../tetorica_src/runtime/playground_performance_processor.js';

const write=(register,value)=>({method:'writeRegister',args:[register,value]});
function setup(){
  let frame=0;const registers=new Uint8Array(32),applied=[],replies=[];
  const port={postMessage:message=>replies.push(message)};
  const performance=createProcessorPerformance({chip:'sid',rate:1000,nowFrame:()=>frame,apply(command){
    applied.push(command);
    if(command.method==='writeRegister')registers[command.args[0]]=command.args[1];
    if(command.method==='forceKeyOff')registers[command.args[0]*7+4]&=254;
    if(command.method==='stopVoices')for(let ch=0;ch<3;ch++)registers[ch*7+4]&=254;
  }});
  performance.receive({type:'performance-start',session:1},port);
  return {performance,registers,applied,replies,port,
    enqueue(commands,time,owner='loop',session=1){performance.receive({performance:{session,owner,time},commands},port);},
    render(frames){performance.render(new Float32Array(frames),new Float32Array(frames),(left,right)=>{left.fill(0);right.fill(0);});frame+=frames;},
  };
}

test('SID leases the three CTRL Gates and treats the filter and volume as shared controls',()=>{
  for(let ch=0;ch<3;ch++){
    const ctrl=ch*7+4;
    for(const waveform of [0,0x10,0x20,0x40,0x80,0xf0]){
      assert.deepEqual(identifyPerformanceNote('sid',write(ctrl,waveform|1)),{key:ch,on:true});
      assert.deepEqual(identifyPerformanceNote('sid',write(ctrl,waveform)),{key:ch,on:false});
      assert.deepEqual(identifyPerformanceNote('sid',{type:'write',register:ctrl,value:waveform|1}),{key:ch,on:true});
    }
    for(let offset=0;offset<7;offset++)assert.equal(nativeVoiceChannel('sid',write(ch*7+offset,0)),ch);
    assert.equal(nativeVoiceChannel('sid',{type:'write',register:ch*7}),ch);
    assert.equal(identifyPerformanceNote('sid',write(ch*7,200)),null,'pitch does not acquire a Gate');
    assert.deepEqual(performanceNoteRelease('sid',ch),{method:'forceKeyOff',args:[ch]});
  }
  for(let register=21;register<32;register++)assert.equal(nativeVoiceChannel('sid',write(register,0)),'all');
  for(const method of ['setFilter','clock','stopVoices','allNotesOff','reset'])assert.equal(nativeVoiceChannel('sid',{method,args:[]}),'all');
});

test('SID cancel releases only its applied Gate, retaining replacement owners and CTRL sound settings',()=>{
  const p=setup();
  p.enqueue([write(4,0x27),write(11,0x93)],.001,'old');
  p.enqueue([write(4,0x47)],.002,'new');
  p.enqueue([write(4,0x46)],.003,'old');
  p.enqueue([write(18,0x81)],.009,'old');
  p.render(4);
  assert.equal(p.registers[4],0x47,'a stale Gate clear cannot release the replacement voice');
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'old'},p.port);
  assert.equal(p.registers[4],0x47);
  assert.equal(p.registers[11],0x92,'release lowers Gate while keeping Noise/Sync');
  assert.deepEqual(p.applied.at(-1),{method:'forceKeyOff',args:[1]});
  p.render(8);assert.equal(p.registers[18],0,'cancelled future Gate never applies');
  p.performance.receive({type:'performance-cancel-owner',session:1,owner:'new'},p.port);
  assert.equal(p.registers[4],0x46,'release keeps the replacement waveform/Sync/Ring bits');
});

test('SID reservations apply at exact frames and a stopped session cannot sound later',()=>{
  const p=setup(),levels=[];
  p.enqueue([write(4,0x21)],.003);
  p.performance.render(new Float32Array(8),new Float32Array(8),(left,right)=>{
    levels.push([left.length,p.registers[4]]);left.fill(0);right.fill(0);
  });
  assert.deepEqual(levels,[[3,0],[5,0x21]]);
  p.enqueue([write(11,0x41)],.02);
  p.performance.receive({type:'performance-stop',session:1},p.port);
  // The shared queue invalidates future batches; the chip Worklet then performs
  // its acknowledged physical Stop (including SID's hardware release tail).
  p.performance.applyImmediate({method:'stopVoices',args:[]},p.port);
  p.enqueue([write(18,0x81)],.02);
  p.render(32);assert.equal(p.registers[4]&1,0);assert.equal(p.registers[11],0);assert.equal(p.registers[18],0);
  p.performance.receive({type:'performance-start',session:2},p.port);
  p.enqueue([write(4,0x11)],.032,'fresh',2);p.render(1);
  assert.equal(p.registers[4],0x11);
});

test('SID shared filter controls respect a held voice lease while other voices remain editable',()=>{
  const p=setup();p.registers[4]=0x21;p.performance.beginAudition(0,'manual');
  p.enqueue([write(0,0),write(4,0),write(21,7),write(23,0xf7),write(24,0x1f)],.001);
  p.enqueue([write(7,100),write(11,0x41)],.001);p.render(2);
  assert.deepEqual(p.applied,[write(7,100),write(11,0x41)]);
  p.performance.applyImmediate(write(21,6),p.port,{owner:'manual'});
  assert.equal(p.registers[21],6,'the holder can edit its own shared filter');
  p.performance.receive({method:'allNotesOff',args:[]},p.port);
  assert.equal(p.registers[4],0x21);assert.equal(p.registers[11],0x40);
  p.performance.endAudition(0,'manual');p.enqueue([write(23,0x87),write(24,0x1c)],.002);p.render(1);
  assert.equal(p.registers[23],0x87);assert.equal(p.registers[24],0x1c);
});
