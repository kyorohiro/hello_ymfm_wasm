import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/wonderswan_wasm.js';
import {WonderSwan} from './wonderswan.js';
import {createWonderSwanClient, createPrimaryWonderSwanApi} from './playground_wonderswan.js';
import {createProcessorPerformance} from './playground_performance_processor.js';

const wasmBinary = await readFile(new URL('../docs/generated/wonderswan_wasm.wasm', import.meta.url));
const peak = audio => Math.max(...audio.map(Math.abs));
async function setup() {
  const chip = await WonderSwan.create({moduleFactory:factory, moduleOptions:{wasmBinary}, sampleRate:48000});
  const commands = [], closes = [];
  function createPort(name) {
    const port = {postMessage(command) {
      commands.push({name,...command});
      const [address,value] = command.args;
      if(command.method === 'reset')chip.reset();
      else if(command.method === 'writeRegister')chip.writeRegister(address, command.controlMask === undefined ? value : (chip.readRegister(address) & ~command.controlMask) | (value & command.controlMask));
      else if(command.method === 'writeMemory')chip.writeMemory(address,value);
      else if(command.method === 'stopVoices')chip.writeRegister(0x90,chip.readRegister(0x90)&0xf0);
      else if(command.method === 'clock'){} // This harness acknowledges controls; worklet tests cover rendering clocks.
      else if(command.method !== 'dispose')throw new Error(`Unexpected command ${command.method}`);
      if(command.id)queueMicrotask(()=>port.onmessage?.({data:{id:command.id,value:true}}));
    },close(){closes.push(name);}};
    return port;
  }
  return {chip,commands,closes,createPort};
}

test('WonderSwan client preserves Main/Worker channel and mode edits in a shared control register', async () => {
  const device = await setup(); const main=createWonderSwanClient(device.createPort('main'));
  const worker=createWonderSwanClient(device.createPort('worker'));
  try {
    main.initialize(); worker._adoptState(main._getState());
    main.setNoise({enabled:true,type:2,reset:true}); main.noteOn(3,'C4');
    worker.noteOn(0,'E4');
    assert.equal(device.chip.readRegister(0x90),0x89,'stale Worker does not clear Main CH3 or noise mode');
    worker.setSweep({enabled:true,step:-1,time:1}); assert.equal(device.chip.readRegister(0x90),0xc9);
    main.keyOff(3); assert.equal(device.chip.readRegister(0x90),0xc1,'stale Main release preserves Worker CH0 and sweep');
    assert(peak(device.chip.generateStereo(4800).left)>.05);
    assert.deepEqual(device.commands.at(-1),{name:'main',method:'writeRegister',args:[0x90,0x80],channel:3,controlMask:8});
    await main._stopVoices(); device.chip.generateStereo(8);
    assert.equal(peak(device.chip.generateStereo(128).left),0);
    assert.equal(device.chip.readRegister(0x90),0xc0,'physical Stop preserves modes');
    assert.equal(main._getState().registers[16]&15,0,'Stop also releases authored keys');
    worker.keyOn(0); assert(peak(device.chip.generateStereo(1024).left)>.01,'waveform survives Stop');
  } finally {main.dispose();worker.dispose();device.chip.dispose();}
});

test('WonderSwan borrowed primary API uses dynamic clock and has no device disposal', async () => {
  const device = await setup(); const client=createWonderSwanClient(device.createPort('primary'));
  const primary=createPrimaryWonderSwanApi(client);
  try {
    assert.equal(primary.id,'wonderswan');assert.equal(primary.dispose,undefined);assert.equal(primary._getState,undefined);
    primary.initialize();await primary.setClock(4000000);assert.equal(primary.clock,4000000);
    const actual=primary.setNote(0,69);assert.equal(actual,4000000/(32*Math.round(4000000/(32*440))));
    primary.keyOn(0);assert(peak(device.chip.generateStereo(1024).left)>.01);
    primary.loadMemory(Uint8Array.of(0x12,0x34),0x200);assert.equal(device.chip.readMemory(0x201),0x34);
    await assert.rejects(primary.setClock(0),/clock/);assert.equal(primary.clock,4000000);
    client.dispose();client.dispose();assert.deepEqual(device.closes,['primary']);assert.throws(()=>primary.reset(),/disposed/);
  } finally {client.dispose();device.chip.dispose();}
});

test('WonderSwan pending controls retire on disposal; detached handoff emits no hardware commands', async () => {
  const commands=[];let closed=0;
  const client=createWonderSwanClient({postMessage:command=>commands.push(command),close(){closed++;}});
  client.initialize();client.noteOn(2,'C4');const state=client._getState();
  const other=createWonderSwanClient({postMessage:command=>commands.push(command),close(){}});
  const before=commands.length;other._adoptState(state);assert.equal(commands.length,before);
  other.keyOff(2);assert.deepEqual(commands.at(-1),{method:'writeRegister',args:[0x90,0],channel:2,controlMask:4});
  const clock=client.setClock(4000000),stop=client._stopVoices();
  const rejectedClock=assert.rejects(clock,/disposed/),rejectedStop=assert.rejects(stop,/disposed/);
  client.dispose();await rejectedClock;await rejectedStop;assert.equal(closed,1);
  assert.throws(()=>client._stopVoices(),/disposed/);other.dispose();
});

for (const route of ['Main','Worker']) test(`WonderSwan ${route} allNotesOff releases each eligible gate without cutting another owner's audition`,async()=>{
  const device=await setup(),registers=new Uint8Array(32);let frame=0,collect=null;
  const reply={postMessage(){}};
  const apply=command=>{
    if(command.method==='reset'){registers.fill(0);device.chip.reset();}
    else if(command.method==='writeRegister'){
      const[address,byte]=command.args,mask=command.controlMask??255;
      const value=address===0x90?(registers[16]&~mask)|(byte&mask):byte;
      registers[address-128]=value;device.chip.writeRegister(address,value);
    }else if(command.method==='writeMemory')device.chip.writeMemory(...command.args);
    else if(command.method==='keyOff'){registers[16]&=~(1<<command.args[0]);device.chip.writeRegister(0x90,registers[16]);}
    else if(command.method!=='dispose')throw new Error(`Unexpected command ${command.method}`);
  };
  const performance=createProcessorPerformance({chip:'wonderswan',rate:1000,nowFrame:()=>frame,getWonderSwanRegisters:()=>registers,apply});
  const port=()=>({postMessage(command){if(collect)collect.push(command);else if(!performance.receive(command,reply))apply(command);},close(){}});
  const a=createWonderSwanClient(port()),b=createWonderSwanClient(port());
  const invoke=(owner,callback)=>{
    if(route==='Main'){callback();return;}
    collect=[];callback();const commands=collect;collect=null;
    performance.receive({performance:{session:1,owner,time:(frame+1)/1000},commands},reply);
    performance.render(new Float32Array(2),new Float32Array(2),(left,right)=>{left.fill(0);right.fill(0);});frame+=2;
  };
  try{
    a.initialize();b._adoptState(a._getState());performance.receive({type:'performance-start',session:1},reply);
    invoke('a',()=>a.noteOn(0,'C4'));invoke('b',()=>b.noteOn(1,'E4'));
    performance.beginAudition(3,'manual');
    performance.applyImmediate({method:'writeRegister',args:[0x90,0x88],controlMask:0x88},reply,{owner:'manual'});
    invoke('a',()=>a.allNotesOff());
    assert.equal(registers[16],route==='Worker'?0x8a:0x88,'own gate releases while the held manual gate and mode survive');
    assert.equal(device.chip.readRegister(0x90),registers[16]);
    if(route==='Worker'){
      assert(registers[16]&2,'a stale allNotesOff cannot cut the other Worker loop');
      invoke('b',()=>b.allNotesOff());assert.equal(registers[16],0x88,'the other loop can release its own gate');
    }
    performance.applyImmediate({method:'keyOff',args:[3]},reply,{owner:'manual'});performance.endAudition(3,'manual');
    assert.equal(registers[16],0x80,'manual release preserves noise mode');
  }finally{a.dispose();b.dispose();device.chip.dispose();}
});
