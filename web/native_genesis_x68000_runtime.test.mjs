import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createNativeWorkerApis} from './playground_native_primary.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';

function fixture() {
  const calls=[],commands=[],errors=[];
  const fm={clock:4000000,registers:Array(256).fill(0),keyMasks:Array(8).fill(0),amDepth:0,pmDepth:0,status:0,irq:false,sourceMuteMask:0,held:[],pendingCommands:[],sampleRate:48000};
  const oki={clock:8000000,divider:512,pan:0,playing:false,streaming:false,repeat:false,positionFrames:0,fedBytes:0,memoryRevision:0,sampleId:0,sample:null,held:[],pendingCommands:[],sampleRate:48000};
  let staging=null,memory=new Uint8Array();
  const status=()=>({session:1,mode:'x68000',sampleRate:48000,frame:0,ymClock:fm.clock,psgClock:0,running:true});
  const snapshot=()=>({ym2151:structuredClone(fm),okim6258:structuredClone(oki),sampleRate:48000,frame:0,revision:commands.length});
  function apply(m) {
    const s=m.chip==='ym2151'?fm:oki;
    if(m.method==='batch'){m.commands.forEach(op=>apply({...op,chip:m.chip}));return;}
    if(m.method==='write'){
      if(m.chip==='ym2151'){
        fm.registers[m.register]=m.value;
        if(m.register===8)fm.keyMasks[m.value&7]=(m.value>>3)&15;
        if(m.register===0x19)fm[m.value&128?'pmDepth':'amDepth']=m.value&127;
      }else{if(m.register===12)oki.divider=[1024,768,512,512][m.value&3];if(m.register===2)oki.pan=m.value&3;}
    }else if(m.method==='clock')s.clock=m.hz;
    else if(m.method==='memory-begin')staging={id:m.sampleId,metadata:m.metadata,bytes:new Uint8Array(m.byteLength)};
    else if(m.method==='memory-chunk'){assert.equal(m.sampleId,staging.id);staging.bytes.set(m.data,m.offset);}
    else if(m.method==='memory-commit'){
      assert.equal(m.sampleId,staging.id);memory=staging.bytes;oki.sampleId=m.sampleId;
      oki.sample={...staging.metadata,bytes:memory.length,durationSeconds:staging.metadata.frames/staging.metadata.sampleRate};oki.memoryRevision++;staging=null;oki.playing=false;oki.streaming=false;
    }else if(m.method==='play'){oki.playing=oki.streaming=true;oki.repeat=m.repeat;}
    else if(m.method==='set-repeat')oki.repeat=m.repeat;
    else if(m.method==='stop'||m.method==='stop-voices'){if(m.chip==='ym2151')fm.keyMasks.fill(0);else oki.playing=oki.streaming=false;}
    else if(m.method==='key-off'){if(m.chip==='ym2151')fm.keyMasks[m.channel]=0;else oki.playing=oki.streaming=false;}
    else if(m.method==='reset'){if(m.chip==='ym2151'){fm.registers.fill(0);fm.keyMasks.fill(0);}else{oki.playing=oki.streaming=false;oki.divider=512;oki.pan=0;}}
  }
  const invoke=async(command,args)=>{
    calls.push({command,args});
    if(command==='native_genesis_commands')for(const c of args.commands){commands.push(c);assert(!['write','psg-write','psg-stereo','reset','ym2608','ym2610b'].includes(c.type),'X68000 has no hidden Genesis or OPN chips');if(c.type==='x68000')apply(c.message);}
    if(command==='native_genesis_stop'){fm.keyMasks.fill(0);oki.playing=oki.streaming=false;}
    if(command==='native_genesis_x68000_status')return snapshot();
    return status();
  };
  const synth=new NativeGenesisSynth({mode:'x68000',invoke,now:()=>0,onError:error=>errors.push(error)});
  return {synth,calls,commands,errors,fm,oki,snapshot,get memory(){return memory;}};
}

test('Native X68000 Main reuses two primary chips, keeps OPM register order and loads OKI samples',async t=>{
  const previous=globalThis.window;globalThis.window={};
  const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.x68000NativeResult;});
  await runtime.playSource(`
    if(await useSoundChip('ym2151')!==opm||await useSoundChip('okim6258')!==adpcm)throw Error('X68000 primary was not reused');
    opm.setAlgo(7,7,3);opm.setPan(7,true,false);opm.setOperator(7,1,{mul:3,tl:23,ar:31});opm.noteOn(7,'A4');
    opm.setNoise(true,9);
    await adpcm.loadSample({sampleRate:16000,channels:[Float32Array.from({length:513},(_,i)=>Math.sin(i/8)*.4)]});
    adpcm.setDivider(768);adpcm.setPan(true,false);adpcm.play({repeat:true});
    await opm.setClock(3579545);await adpcm.setClock(4000000);
    await mixer.set(opm.id,{volume:.6,pan:.2});await mixer.set(adpcm.id,{volume:.4,pan:-.1});
    globalThis.x68000NativeResult={clock:opm.clock,okiClock:adpcm.clock,fmType:typeof fm};
  `);
  await f.synth.flush();
  assert.deepEqual(globalThis.x68000NativeResult,{clock:3579545,okiClock:4000000,fmType:'undefined'});
  assert.equal(f.fm.registers[0x4f]&15,3);assert.equal(f.fm.registers[0x6f],23);assert.equal(f.fm.keyMasks[7],15);assert.equal(f.oki.divider,768);assert.equal(f.oki.pan,1);assert(f.oki.playing);assert(f.oki.sample.bytes>0);
  assert.equal(f.synth.fm,null);assert.equal(f.synth.psg,null);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['ym2151','okim6258']);
  assert.deepEqual(f.synth.chipInspector.list().map(c=>c.id),['ym2151','okim6258']);
  const memory=f.memory.slice();await runtime.stopWithFade();assert.deepEqual(f.memory,memory);assert.equal(f.fm.registers[0x6f],23);assert.equal(f.fm.clock,3579545);assert.equal(f.oki.divider,768);assert(!f.oki.playing);assert.deepEqual(f.errors,[]);
});

test('Native X68000 actual Worker ports share timing and atomically prepare OKI samples',async()=>{
  const f=fixture();await f.synth.start();f.commands.length=0;
  const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>f.errors.push(error)});
  const host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try {
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);
    assert(bridge.ym2151Port);assert(bridge.okim6258Port);
    const endpoints=[{name:'ym2151',globalName:'opm',port:bridge.ym2151Port,state:f.synth.opm._getState()},{name:'okim6258',globalName:'adpcm',port:bridge.okim6258Port,state:f.synth.adpcm._getState()}];
    const worker=createNativeWorkerApis(endpoints,sender,()=>{});
    worker.apis.opm.setAlgo(6,7,2);worker.apis.opm.setOperator(6,2,{mul:5,tl:16});worker.apis.opm.noteOn(6,'E4');
    await worker.apis.adpcm.loadMemory(new Uint8Array(65537).fill(0x17));
    await worker.apis.opm.setClock(4000001);await worker.apis.adpcm.setClock(8000001);
    worker.apis.adpcm.play({repeat:true});await worker.apis.adpcm.setClock(8000000);
    assert.equal(f.fm.registers[0x56]&15,5);assert.equal(f.fm.keyMasks[6],15);assert.equal(f.memory.length,65537);assert.equal(f.memory[65536],0x17);
    const commands=f.commands.filter(c=>c.type==='x68000');
    assert(commands.filter(c=>c.message.method==='write').every(c=>c.frame===12000&&c.performance===clock.session&&c.owner>0));
    const memory=commands.filter(c=>c.message.method.startsWith('memory-'));assert.equal(memory.filter(c=>c.message.method==='memory-chunk').length,2);
    assert(memory.every(c=>c.frame===0&&c.performance===clock.session&&c.owner>0));assert(memory.some(c=>c.message.method==='memory-commit'));
    assert.deepEqual(f.errors,[]);
  } finally {host.stop();await bridge.dispose();await f.synth.close();}
});
