import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Ym2608,normalizeYm2608OutputGains,normalizeYm2608SourceGains} from '../../tetorica_src/runtime/ym2608.js';
import {Ym2608AudioEngine} from '../../tetorica_src/runtime/ym2608audioengine.js';
import {YM2608RuntimeSynth} from '../../tetorica_src/runtime/ym2608synth.js';
import {createPerformanceQueue,createPerformanceChipOwnership} from '../../tetorica_src/runtime/playground_performance_queue.js';
import {createChipPortReceiver} from '../../tetorica_src/runtime/playground_chip_port.js';
import {createOpnAuditionGuard,receiveOpnAuditionCommand} from '../../tetorica_src/runtime/playground_audition_guard.js';
import {validateChipClock} from '../../tetorica_src/runtime/playground_chip_clock.js';

const unity=()=>({fm:1,ssg:1,rhythm:1,adpcm:1});

test('independent source gains validate atomically and leave legacy bus controls separate',()=>{
  const sources=[],buses=[],registers=[];
  const chip=new Ym2608({},1,{setSourceGains(...args){sources.push(args);return 1;},
    setOutputGains(...args){buses.push(args);return 1;},write(...args){registers.push(args);}});
  assert.deepEqual(chip.getSourceGains(),unity());
  assert.deepEqual(chip.setSourceGains({rhythm:.4,adpcm:0}),{fm:1,ssg:1,rhythm:.4,adpcm:0});
  assert.deepEqual(sources,[[1,1,1,.4,0]]);
  assert.deepEqual(chip.getOutputGains(),{fm:1,ssg:1});
  chip.setOutputGains({fm:.5});
  assert.deepEqual(buses,[[1,.5,1]]);
  assert.deepEqual(chip.getSourceGains(),{fm:1,ssg:1,rhythm:.4,adpcm:0});
  const copy=chip.getSourceGains();copy.rhythm=99;
  for(const invalid of [null,[],{rhythm:NaN},{adpcm:-1},{ssg:Infinity},{fm:1024.01},{fm:.3,rhythm:undefined},{deltaT:1}]){
    assert.throws(()=>chip.setSourceGains(invalid));
    assert.deepEqual(chip.getSourceGains(),{fm:1,ssg:1,rhythm:.4,adpcm:0});
  }
  assert.equal(sources.length,1);assert.deepEqual(registers,[]);
  assert.deepEqual(chip.setSourceGains({fm:1024,ssg:0}),{fm:1024,ssg:0,rhythm:.4,adpcm:0});
});

test('legacy WASM only accepts unity independent source gains and native rejection retains prior state',()=>{
  const legacy=new Ym2608({},1,{});
  assert.deepEqual(legacy.setSourceGains({fm:1,ssg:1,rhythm:1,adpcm:1}),unity());
  assert.throws(()=>legacy.setSourceGains({rhythm:.75}),/Reload/);
  assert.deepEqual(legacy.getSourceGains(),unity());
  const rejected=new Ym2608({},1,{setSourceGains:()=>0});
  assert.throws(()=>rejected.setSourceGains({adpcm:0}),/rejected/);
  assert.deepEqual(rejected.getSourceGains(),unity());
  legacy.handle=0;assert.throws(()=>legacy.setSourceGains({}),/disposed/);
});

test('engine snapshot identity includes four independent gains and rejects unsupported fallback',()=>{
  let sources=unity(),restored=0;
  const chip={supportsState:()=>true,saveState:()=>({byteLength:16}),validateState(){},loadState(){restored++;},
    getSourceGains:()=>({...sources}),setSourceGains:patch=>sources=normalizeYm2608SourceGains(patch,sources)};
  const engine=new Ym2608AudioEngine(chip,1000000,44100),saved=engine.saveState();
  engine.setSourceGains({adpcm:.25});assert.throws(()=>engine.loadState(saved),/Incompatible/);assert.equal(restored,0);
  engine.setSourceGains({adpcm:1});engine.loadState(saved);assert.equal(restored,1);
  const legacy=new Ym2608AudioEngine({},1000000,44100);
  assert.deepEqual(legacy.getSourceGains(),unity());
  assert.deepEqual(legacy.setSourceGains({adpcm:1}),unity());
  assert.throws(()=>legacy.setSourceGains({adpcm:.5}),/Reload/);
});

test('opaque chip snapshots restore independent source gain metadata with legacy gains',()=>{
  const memory=new Float32Array(64),module={HEAPF32:memory,_malloc:()=>16,_free(){},
    _ym2608_save_state:()=>8,_ym2608_load_state:()=>1};
  const chip=new Ym2608(module,1,{setSourceGains:()=>1,setOutputGains:()=>1});
  chip.setSourceGains({rhythm:.3,adpcm:.7});chip.setOutputGains({fm:.8});const saved=chip.saveState();
  chip.setSourceGains({rhythm:0,adpcm:0});chip.setOutputGains({fm:0});chip.loadState(saved);
  assert.deepEqual(chip.getSourceGains(),{fm:1,ssg:1,rhythm:.3,adpcm:.7});
  assert.deepEqual(chip.getOutputGains(),{fm:.8,ssg:1});
});

test('worklet source-gain messages retain pre-initialization settings and reject invalid edits atomically',async()=>{
  let Processor;const replies=[],writes=[];
  const scope={currentFrame:0,sampleRate:48000,createPerformanceQueue,createPerformanceChipOwnership,createChipPortReceiver,
    createOpnAuditionGuard,receiveOpnAuditionCommand,validateChipClock,normalizeYm2608OutputGains,normalizeYm2608SourceGains,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:value=>replies.push(value)};}},
    registerProcessor(_name,Type){Processor=Type;}};
  const source=await readFile(new URL('../../tetorica_src/runtime/ym2608-worklet.js',import.meta.url),'utf8');
  vm.runInNewContext(source.replace(/^import .*;\n/gm,''),scope);
  const processor=new Processor(),send=gains=>processor.port.onmessage({data:{type:'source-gains',gains}});
  send({rhythm:.3});assert.deepEqual({...processor.sourceGains},{fm:1,ssg:1,rhythm:.3,adpcm:1});
  processor.chip={setSourceGains:gains=>writes.push({...gains})};send({adpcm:.5});
  assert.deepEqual(writes,[{fm:1,ssg:1,rhythm:.3,adpcm:.5}]);
  send({fm:.2,adpcm:NaN});assert.equal(replies.at(-1).type,'error');assert.equal(writes.length,1);
  assert.deepEqual({...processor.sourceGains},{fm:1,ssg:1,rhythm:.3,adpcm:.5});
  processor.chip.setSourceGains=()=>{throw Error('native rejected');};send({rhythm:0});
  assert.equal(replies.at(-1).message,'native rejected');assert.deepEqual({...processor.sourceGains},{fm:1,ssg:1,rhythm:.3,adpcm:.5});
});

test('runtime source-gain state survives restart while default startup sends no new source packet',async()=>{
  for(const options of [{}, {sourceGains:{rhythm:.25,adpcm:.5}}]){
    const runtime=new YM2608RuntimeSynth({...options,audioContext:{state:'running'}}),messages=[];
    runtime.node={port:{postMessage:value=>messages.push(value)}};runtime.fm={};runtime.state='ready';
    runtime.readyPromise=Promise.resolve();runtime.initializationController=new AbortController();
    await runtime.start();
    assert.equal(messages[0].type,'output-gains');
    assert.equal(messages.filter(value=>value.type==='source-gains').length,options.sourceGains?1:0);
    runtime.setSourceGains({ssg:.7});const accepted=runtime.getSourceGains();accepted.ssg=99;
    assert.equal(runtime.getSourceGains().ssg,.7);
    const count=messages.length;assert.throws(()=>runtime.setSourceGains({rhythm:-1}));assert.equal(messages.length,count);
  }
});
