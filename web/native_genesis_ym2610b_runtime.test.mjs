import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';

function fixture(variant) {
  const calls=[],commands=[],errors=[],registers=[Array(256).fill(0),Array(256).fill(0)],roms=[new Map(),new Map()];
  let clock=8000000;
  const status=()=>({session:1,mode:variant?'neogeo-b':'neogeo',sampleRate:48000,frame:0,ymClock:clock,ym2610bClock:clock,running:true});
  const snapshot=()=>({...status(),variant:variant?'ym2610b':'ym2610',clock,registers:structuredClone(registers),held:[],pendingCommands:[],adpcmARomBytes:roms[0].size,adpcmBRomBytes:roms[1].size,status:0,statusHi:0,irq:false,revision:commands.length});
  function apply(m) {
    if(m.method==='write')registers[m.port][m.register]=m.value;
    else if(m.method==='reset')registers.forEach(r=>r.fill(0));
    else if(m.method==='memory')m.data.forEach((v,i)=>roms[m.kind].set(m.offset+i,v));
    else if(m.method==='clock')clock=m.hz;
    else if(m.method==='batch')m.commands.forEach(apply);
  }
  const invoke=async(command,args)=>{
    calls.push({command,args});
    if(command==='native_genesis_commands')for(const c of args.commands){
      commands.push(c);assert(!['write','psg-write','psg-stereo','reset'].includes(c.type),'Neo Geo has no hidden Genesis chips');
      if(c.type==='ym2610b')apply(c.message);
    }
    if(command==='native_genesis_ym2610b_status')return snapshot();
    return status();
  };
  const synth=new NativeGenesisSynth({mode:variant?'neogeo-b':'neogeo',invoke,now:()=>0,onError:e=>errors.push(e)});
  return {synth,calls,commands,registers,roms,errors,snapshot};
}

for(const variant of [false,true]) {
  const title=variant?'YM2610B':'YM2610';
  test(`Native ${title} Main shares the selected FM, SSG and independent A/B ROMs`,async t=>{
    const previous=globalThis.window;globalThis.window={};
    const f=fixture(variant),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
    t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.neogeoNativeResult;});
    await runtime.playSource(`
      const chip=await useSoundChip('${variant?'ym2610b':'ym2610'}');
      if(chip!==fm)throw Error('Native primary was not reused');
      chip.setPreset(${variant?'CH6':'CH4'},FM_PRESETS['one-op-basic']);
      chip.setAlgo(${variant?'CH6':'CH4'},7,3);chip.noteOn(${variant?'CH6':'CH4'},'A4');
      ssg.tone(1,{frequency:261.625565,volume:9});
      await chip.adpcmA.loadMemory(new Uint8Array(256).fill(0x17),256);
      await chip.adpcmB.loadMemory(new Uint8Array(256).fill(0x83),256);
      adpcmA.setSample(5,{start:256,end:512});adpcmA.setVolume(50);adpcmA.setVoice(5,{volume:25,left:true,right:false});adpcmA.keyOn(5);
      adpcmB.setSample({start:256,end:512});adpcmB.setVolume(190);adpcmB.setPan(false,true);adpcmB.setPlaybackRate(16000);adpcmB.keyOn();
      await chip.setClock(7000000);
      globalThis.neogeoNativeResult={same:chip===fm,clock:fm.clock,irq:await chip.getIrq()};
    `);
    await f.synth.flush();
    assert.deepEqual(globalThis.neogeoNativeResult,{same:true,clock:7000000,irq:false});
    assert.equal(f.synth.capabilities.fmChannels,variant?6:4);assert.equal(f.synth.psg,null);assert.equal(f.synth.capabilities.dac,false);
    assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),[variant?'ym2610b':'ym2610']);
    assert.equal(f.roms[0].get(256),0x17);assert.equal(f.roms[1].get(256),0x83);
    assert.equal(f.registers[1][0xb2]&7,7);assert.equal(f.registers[0][9],9);assert.equal(f.registers[1][0],32);assert(f.registers[0][0x10]&128);
    assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
    const memory=f.snapshot();await runtime.stopWithFade();assert.equal(f.snapshot().adpcmARomBytes,memory.adpcmARomBytes);assert.equal(f.snapshot().adpcmBRomBytes,memory.adpcmBRomBytes);
    assert.deepEqual(f.errors,[]);
  });

  test(`Native ${title} real Worker ports preserve physical FM mapping, A/B memory ownership and clock`,async()=>{
    const f=fixture(variant);await f.synth.start();f.commands.length=0;
    const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>f.errors.push(error)});
    const host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
    try {
      const clock=await host.start([bridge.port],.25);
      const sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);
      const worker=createWorkerChip({port:sender.port(bridge.chipPort,'chip'),capabilities:f.synth.capabilities,state:(f.synth.fm.fm??f.synth.fm)._getState()});
      worker.fm.noteOn(variant?5:3,'E4');worker.ssg.tone(1,{frequency:391.995436,volume:8});
      await worker.adpcmA.loadMemory(new Uint8Array([0x12,0x34]),256);
      await worker.adpcmB.loadMemory(new Uint8Array([0x56,0x78]),256);
      await worker.fm.setClock(4000000);
      assert.equal(worker.fm.clock,4000000);assert.equal(f.roms[0].get(256),0x12);assert.equal(f.roms[1].get(256),0x56);
      const writes=f.commands.filter(c=>c.type==='ym2610b'&&c.message.method==='write');
      assert(writes.some(c=>c.message.register===0x28&&c.message.value===0xf6),'both variants end on physical FM channel5');
      assert(writes.every(c=>c.frame===12000&&c.performance===clock.session&&c.owner>0));
      const transfers=f.commands.filter(c=>c.type==='ym2610b'&&c.message.method==='memory');assert.equal(transfers.length,2);
      assert(transfers.every(c=>c.frame===0&&c.performance===clock.session&&c.owner>0));
      assert.deepEqual(f.errors,[]);
    } finally {host.stop();await bridge.dispose();await f.synth.close();}
  });
}
