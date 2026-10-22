import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';

function fixture() {
  const calls=[],commands=[],errors=[],registers=[Array(256).fill(0),Array(256).fill(0)],memory=new Uint8Array(0x200000);
  let clock=8000000,romLoaded=false,loaded=0;
  const status=()=>({session:1,mode:'pc98',sampleRate:48000,frame:0,ymClock:clock,ym2608Clock:clock,running:true});
  const snapshot=()=>({...status(),clock,registers:structuredClone(registers),held:[],pendingCommands:[],romLoaded,adpcmMemoryBytes:loaded,status:0,statusHi:0,irq:false,revision:commands.length});
  function apply(m) {
    if(m.method==='write')registers[m.port][m.register]=m.value;
    else if(m.method==='reset')registers.forEach(r=>r.fill(0));
    else if(m.method==='rom')romLoaded=true;
    else if(m.method==='memory'){memory.set(m.data,m.offset);loaded=Math.max(loaded,m.offset+m.data.length);}
    else if(m.method==='clock')clock=m.hz;
    else if(m.method==='batch')m.commands.forEach(apply);
  }
  const invoke=async(command,args)=>{
    calls.push({command,args});
    if(command==='native_genesis_commands'){
      for(const c of args.commands){commands.push(c);assert(!['write','psg-write','psg-stereo','reset'].includes(c.type),'PC-98 has no hidden Genesis chips');if(c.type==='ym2608')apply(c.message);}
    }
    if(command==='native_genesis_ym2608_status')return snapshot();
    return status();
  };
  const synth=new NativeGenesisSynth({mode:'pc98',invoke,now:()=>0,onError:e=>errors.push(e),fetcher:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(8192).buffer})});
  return {synth,calls,commands,registers,memory,errors,snapshot};
}

test('Native PC-98 Main uses one FM/SSG/rhythm/ADPCM endpoint, shared samples and safe Stop',async t=>{
  const previous=globalThis.window;globalThis.window={};
  const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.pc98NativeResult;});
  await runtime.playSource(`
    const chip=await useSoundChip('ym2608');
    chip.setPreset(CH6,{algorithm:7,operators:[{multi:1,tl:12,ar:31}]});
    chip.noteOn(CH6,'A4');
    chip.ssg.tone(1,{frequency:261.625565,volume:9});
    rhythm.setVolume(45);rhythm.setVoice(1,{volume:24,left:true,right:true});rhythm.keyOn(1);
    await chip.adpcm.loadSample({sampleRate:16000,channels:[Float32Array.from([0,.2,.4,-.2,-.4,0])]}, {address:64});
    adpcm.keyOn();
    globalThis.pc98NativeResult={same:chip===fm,clock:fm.clock,irq:await chip.getIrq()};
  `);
  await f.synth.flush();
  assert.deepEqual(globalThis.pc98NativeResult,{same:true,clock:8000000,irq:false});
  assert.equal(f.synth.psg,null);assert.equal(f.synth.pcm,null);assert.equal(f.synth.capabilities.dac,false);
  assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['ym2608']);
  assert.equal(f.registers[0][0x29],0x9f);assert(f.commands.some(c=>c.type==='ym2608'&&c.message.method==='memory'));
  assert(f.registers[0][9]>0);assert(f.registers[0][0x10]&2);assert(f.registers[1][0]&128);
  assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  const loaded=f.snapshot().adpcmMemoryBytes;await runtime.stopWithFade();assert.equal(f.snapshot().adpcmMemoryBytes,loaded);
  assert.deepEqual(f.errors,[]);
});

test('Native PC-98 real Worker ports preserve performance time, memory acknowledgements and clock replies',async()=>{
  const f=fixture();await f.synth.start();f.commands.length=0;
  const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>f.errors.push(error)});
  const host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  let worker;
  try {
    const clock=await host.start([bridge.port],.25);
    const sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);
    worker=createWorkerChip({port:sender.port(bridge.chipPort,'chip'),capabilities:f.synth.capabilities,state:f.synth.fm._getState()});
    worker.fm.noteOn(5,'E4');worker.ssg.tone(1,{frequency:391.995436,volume:8});worker.rhythm.keyOn(2);
    await worker.raw.adpcm.loadMemory(new Uint8Array([0x12,0x34,0x56]),64);
    await worker.fm.setClock(4000000);
    assert.equal(worker.fm.clock,4000000);assert.deepEqual(Array.from(f.memory.slice(64,67)),[0x12,0x34,0x56]);
    const scheduled=f.commands.filter(c=>c.type==='ym2608'&&c.message.method==='write');
    assert(scheduled.length>0);assert(scheduled.every(c=>c.frame===12000&&c.performance===clock.session&&c.owner>0));
    const transfer=f.commands.find(c=>c.type==='ym2608'&&c.message.method==='memory');assert.equal(transfer.frame,0);assert.equal(transfer.performance,clock.session);
    assert.deepEqual(f.errors,[]);
  } finally {
    host.stop();await bridge.dispose();await f.synth.close();
  }
});

test('Native PC-98 FM preview releases on focus cleanup and ignores replaced key tokens',async()=>{
  const f=fixture();f.synth.clearAuditions();await Promise.resolve();assert.deepEqual(f.calls,[]);assert.deepEqual(f.errors,[]);
  await f.synth.start();f.commands.length=0;
  try {
    f.synth.auditionNoteOn(4,4,1000,1);f.synth.auditionNoteOn(4,4,1100,2);
    await f.synth.flush();const before=f.commands.length;
    f.synth.auditionNoteOff(4,1);await f.synth.flush();assert.equal(f.commands.length,before);
    f.synth.auditionNoteOff(4,2);await f.synth.flush();assert.equal(f.commands.at(-1).message.voice,2);assert.equal(f.commands.at(-1).message.action,'off');
    f.synth.auditionNoteOn(5,4,1200,3);await f.synth.flush();f.synth.clearAuditions();await f.synth.flush();
    assert(f.commands.some(c=>c.type==='ym2608'&&c.message.action==='off'&&c.message.channel===5&&c.message.voice===3));
    assert.equal(f.synth.auditions.size,0);assert.deepEqual(f.errors,[]);
  } finally {await f.synth.close();}
});
