import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../docs/sid-player/processor.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({backend='8580',stall=false,reject=false}={}){
  let Type,resolveReady,rejectReady,id=0;const messages=[],creates=[],calls=[];
  let loaded=false,disposed=0;
  const core={
    load(bytes,options){if(bytes?.[0]===255)throw new Error('Candidate rejected');loaded=true;calls.push(['load',options]);},
    getState(){return {model:backend==='8580'?'8580':'6581',playing:loaded,registers:[],voices:[{envelope:null,phase:null}]};},
    renderInto(output){if(core.renderError)throw new Error('Render failure');output.fill(.25);},
    stop(){loaded=false;calls.push(['stop']);},dispose(){disposed++;},
  };
  const loading=new Promise((resolve,reject)=>{resolveReady=()=>resolve(core);rejectReady=reject;});
  const endpointBinary=Uint8Array.of(1).buffer,machineBinary=Uint8Array.of(2).buffer,wasmBinary=Uint8Array.of(3).buffer;
  const create=name=>({create(options){creates.push({name,options});return loading;}});
  vm.runInNewContext(source,{
    SidPlayerCore:create('direct6581'),RsidPlayerCore:create('c646581'),Sid8580PlayerCore:create('c648580'),sampleRate:48000,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)};}},
    registerProcessor(name,value){assert.equal(name,'tetorica-sid-player');Type=value;},
  });
  const processor=new Type({processorOptions:{backend,endpointBinary,machineBinary,wasmBinary}});
  if(!stall){if(reject)rejectReady(new Error('Initialization failure'));else resolveReady();}
  return {processor,core,messages,creates,calls,endpointBinary,machineBinary,wasmBinary,resolveReady,rejectReady,
    get disposed(){return disposed;},
    async command(method,args=[]){const request=++id;processor.receive({id:request,method,args});await processor.commands;return messages.find(message=>message.id===request);},
    render(){const left=new Float32Array(128).fill(9),right=new Float32Array(128).fill(9),alive=processor.process([],[[left,right]]);return{left,right,alive};},
  };
}

test('SID processor selects its model-specific core and preserves the legacy single-WASM creation options',async()=>{
  for(const backend of ['psid','psid-cia','psid-vbi','rsid','8580']){
    const f=fixture({backend});await f.processor.ready;const created=f.creates[0];
    assert.equal(created.name,backend==='8580'?'c648580':backend==='psid'?'direct6581':'c646581');
    assert.equal(created.options.sampleRate,48000);
    if(backend==='8580'){
      assert.equal(created.options.endpointBinary,f.endpointBinary);assert.equal(created.options.machineBinary,f.machineBinary);
      assert.equal(created.options.wasmBinary,undefined);
    }else{
      assert.equal(created.options.wasmBinary,f.wasmBinary);assert.equal(created.options.endpointBinary,undefined);
    }
    assert(f.render().left.every(value=>value===0));
    await f.command('load',[Uint8Array.of(1),{subtune:2}]);const started=await f.command('start');
    assert.equal(started.value.model,backend==='8580'?'8580':'6581');assert.equal(started.value.playing,true);
    const sounding=f.render();assert(sounding.alive);assert(sounding.left.every(value=>value===.25));assert.deepEqual(sounding.right,sounding.left);
    await f.command('stop');assert(f.render().left.every(value=>value===0));
    f.processor.receive({method:'dispose'});f.processor.receive({method:'dispose'});assert.equal(f.disposed,1);
  }
});

test('Stop during WASM startup fences an earlier Start while a fresh load can recover',async()=>{
  const f=fixture({stall:true});
  f.processor.receive({id:1,method:'load',args:[Uint8Array.of(1),{}]});
  f.processor.receive({id:2,method:'start'});f.processor.receive({id:3,method:'stop'});
  assert(f.render().left.every(value=>value===0));f.resolveReady();await f.processor.commands;
  assert.match(f.messages.find(message=>message.id===2).error,/cancelled/);
  assert.equal(f.messages.find(message=>message.id===3).value.playing,false);assert(f.render().right.every(value=>value===0));
  const loaded=await f.command('load',[Uint8Array.of(1),{}]);assert.equal(loaded.value.playing,false);
  await f.command('start');assert(f.render().left.some(value=>value!==0));f.processor.dispose();
});

test('rejected candidates and invalid Stop arguments preserve active playback and unknown RPCs fail',async()=>{
  const f=fixture();await f.processor.ready;await f.command('load',[Uint8Array.of(1),{}]);await f.command('start');
  assert.match((await f.command('load',[Uint8Array.of(255),{}])).error,/Candidate rejected/);
  assert.equal((await f.command('read')).value.playing,true);assert(f.render().left.every(value=>value===.25));
  assert.match((await f.command('stop',{})).error,/arguments/);assert.equal((await f.command('read')).value.playing,true);
  assert.match((await f.command('constructor')).error,/Unknown/);assert.equal((await f.command('read')).value.playing,true);
  f.processor.dispose();
});

test('late initialization and render failures dispose exactly once and never publish active audio',async()=>{
  const early=fixture({stall:true});early.processor.receive({method:'dispose'});early.resolveReady();await early.processor.ready;
  assert.equal(early.disposed,1);assert.equal(early.messages.length,0);assert.equal(early.render().alive,false);
  for(const trigger of ['initialization','render']){
    const f=fixture({reject:trigger==='initialization'});await f.processor.ready;await flush();
    if(trigger==='render'){await f.command('load',[Uint8Array.of(1),{}]);await f.command('start');f.core.renderError=true;assert.equal(f.render().alive,false);}
    const silence=f.render();assert(silence.left.every(value=>value===0));assert(silence.right.every(value=>value===0));
    assert.equal(f.messages.filter(message=>message.fatal).length,1);assert.equal(f.disposed,trigger==='render'?1:0);
    f.processor.receive({method:'dispose'});assert.equal(f.messages.filter(message=>message.fatal).length,1);
  }
});

test('ordinary Player processor runs VBI, CIA and RSID through the actual two-WASM 8580 adapter',async()=>{
  const {Sid8580PlayerCore}=await import('../docs/sid-player/core8580.js');
  const {createSid8580MachineFixture}=await import('./helpers/sid8580_machine_fixtures.mjs');
  const [endpointBinary,machineBinary]=await Promise.all(['sid8580-endpoint','sid8580-machine'].map(name=>
    readFile(new URL(`../docs/generated/sid8580-machine/${name}.wasm`,import.meta.url))));
  for(const rate of [44100,48000,96000])for(const profile of ['psid-vbi','psid-cia','rsid-cia-irq']){
    let Type,id=0;const messages=[];
    vm.runInNewContext(source,{
      Sid8580PlayerCore,sampleRate:rate,
      SidPlayerCore:{create(){throw new Error('Unexpected 6581 core');}},RsidPlayerCore:{create(){throw new Error('Unexpected 6581 machine');}},
      AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)};}},registerProcessor(_name,value){Type=value;},
    });
    const processor=new Type({processorOptions:{backend:'8580',endpointBinary,machineBinary}});
    const command=async(method,args=[])=>{const request=++id;processor.receive({id:request,method,args});await processor.commands;return messages.find(message=>message.id===request);};
    try{
      await processor.ready;assert(messages.some(message=>message.ready));
      const fixture=createSid8580MachineFixture(profile),loaded=await command('load',[fixture.bytes,{subtune:fixture.subtune,vbiBackend:'c64'}]);
      assert.equal(loaded.error,undefined,loaded.error);assert.equal((await command('start')).value.model,'8580');
      let nonzero=false;
      for(let block=0;block<64;block++){
        const left=new Float32Array(128),right=new Float32Array(128);assert.equal(processor.process([],[[left,right]]),true);
        assert(left.every(Number.isFinite));assert.deepEqual(right,left);nonzero||=left.some(value=>Math.abs(value)>.00001);
      }
      assert(nonzero,`${profile}/${rate}: actual sounding PCM`);
      const state=(await command('read')).value;
      assert.equal(state.backend,'c64');assert.equal(state.model,'8580');assert.equal(state.subtune,fixture.subtune);
      assert.equal(state.cycles,state.sidCycles);assert.equal(state.profileBits,0);assert.equal(state.declaredModel,'8580');
      assert.equal(state.voices[0].envelope,null);assert.equal(state.voices[0].phase,null);
      assert.equal((await command('load',[Uint8Array.of(1,2,3),{}])).value,undefined);
      assert.equal((await command('read')).value.playing,true,'invalid candidate keeps actual machine playing');
      await command('stop');const silence=new Float32Array(128).fill(1);processor.process([],[[silence,new Float32Array(128)]]);assert(silence.every(value=>value===0));
    }finally{processor.receive({method:'dispose'});}
  }
});
