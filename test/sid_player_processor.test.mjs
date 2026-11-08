import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../docs/sid-player/processor.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({backend='8580',stall=false,reject=false}={}){
  let Type,resolveReady,rejectReady,id=0;const messages=[],creates=[],calls=[];
  let loaded=false,disposed=0,frames=0;
  const core={
    load(bytes,options){if(bytes?.[0]===255)throw new Error('Candidate rejected');loaded=true;calls.push(['load',options]);},
    getState(){return {model:backend==='8580'?'8580':'6581',playing:loaded,positionFrames:frames,registers:[],voices:[{envelope:null,phase:null}]};},
    renderInto(output){if(core.renderError)throw new Error('Render failure');frames+=output.length;output.fill(.25);},
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
    const ready=f.messages.find(message=>message.ready);
    assert.equal(ready.transportProtocol,2);
    assert.deepEqual(Array.from(ready.supportedCommands),['load','start','pause','resume','stop','read']);
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

test('Pause freezes the chip at its ACK, fades only the held output, and Resume continues the same core',async()=>{
  const f=fixture();await f.processor.ready;await f.command('load',[Uint8Array.of(1),{}]);await f.command('start');
  const before=f.render();assert(before.left.every(value=>value===.25),'first Play has no fade or gain change');
  const paused=await f.command('pause');assert.equal(paused.value.playing,false);assert.equal(paused.value.paused,true);
  const position=paused.value.positionFrames,calls=f.calls.slice(),tail=[];
  for(let block=0;block<8;block++){const audio=f.render();tail.push(...audio.left);assert.deepEqual(audio.right,audio.left);}
  assert.equal(tail[0],before.left.at(-1),'the host bridge begins at the previous output');
  const fadeFrames=Math.round(48000*.005);
  for(let i=1;i<fadeFrames;i++)assert(tail[i]>=0&&tail[i]<=tail[i-1],'pause tail decreases monotonically');
  assert(tail.slice(fadeFrames-1).every(value=>value===0),'output is exactly zero after the bounded host tail');
  assert.equal((await f.command('read')).value.positionFrames,position);assert.deepEqual(f.calls,calls,'no load or stop while paused');
  await f.command('pause');assert.equal((await f.command('read')).value.positionFrames,position,'repeated Pause is idempotent');
  const resumed=await f.command('resume');assert.equal(resumed.value.playing,true);assert.equal(resumed.value.paused,false);assert.equal(resumed.value.positionFrames,position);
  const rising=[];for(let i=0;i<3;i++)rising.push(...f.render().left);
  assert.equal(rising[0],0);for(let i=1;i<fadeFrames;i++)assert(rising[i]>=rising[i-1]&&rising[i]<=.25);
  assert(rising.slice(fadeFrames-1).every(value=>value===.25));
  assert.equal(f.creates.length,1);assert.equal(f.disposed,0);f.processor.dispose();
});

test('transport rejection preserves active sound, and Stop/reload/dispose clear paused bridges',async()=>{
  const empty=fixture();await empty.processor.ready;
  assert.match((await empty.command('pause')).error,/Start/);assert.match((await empty.command('resume')).error,/Load/);empty.processor.dispose();
  for(const ending of ['stop','load','dispose']){
    const f=fixture();await f.processor.ready;await f.command('load',[Uint8Array.of(1),{}]);await f.command('start');f.render();
    for(const method of ['pause','resume'])assert.match((await f.command(method,{})).error,/arguments/);
    assert.equal((await f.command('read')).value.playing,true);assert(f.render().left.every(value=>value===.25));
    await f.command('pause');assert.equal((await f.command('read')).value.paused,true);
    const frozen=(await f.command('read')).value.positionFrames;
    assert.match((await f.command('load',[Uint8Array.of(255),{}])).error,/Candidate/);
    assert.equal((await f.command('read')).value.paused,true);assert.equal((await f.command('read')).value.positionFrames,frozen);
    if(ending==='dispose')f.processor.dispose();else await f.command(ending,ending==='load'?[Uint8Array.of(1),{}]:[]);
    assert(f.render().left.every(value=>value===0),`${ending} removes the host tail immediately`);
    if(ending!=='dispose')assert.equal((await f.command('read')).value.paused,false);
    if(ending==='stop')assert.match((await f.command('resume')).error,/Load/);
    if(ending==='load'){assert.match((await f.command('resume')).error,/Pause/);await f.command('start');assert(f.render().left.every(value=>value===.25),'fresh Play has no leftover fade');}
    f.processor.dispose();
  }
});

test('queued Pause/Resume preserve transport FIFO, while a later Stop fences all earlier transport requests',async()=>{
  const ordered=fixture({stall:true});
  for(const [id,method,args]of [[1,'load',[Uint8Array.of(1),{}]],[2,'start'],[3,'pause'],[4,'resume'],[5,'pause']])ordered.processor.receive({id,method,args});
  ordered.resolveReady();await ordered.processor.commands;
  assert.equal(ordered.messages.find(message=>message.id===3).value.paused,true);
  assert.equal(ordered.messages.find(message=>message.id===4).value.playing,true);
  assert.equal(ordered.messages.find(message=>message.id===5).value.paused,true);
  assert.equal(ordered.calls.filter(call=>call[0]==='load').length,1);assert.equal(ordered.calls.filter(call=>call[0]==='stop').length,0);ordered.processor.dispose();
  const stopped=fixture({stall:true});
  for(const [id,method,args]of [[1,'load',[Uint8Array.of(1),{}]],[2,'start'],[3,'pause'],[4,'resume'],[5,'stop']])stopped.processor.receive({id,method,args});
  stopped.resolveReady();await stopped.processor.commands;
  for(const id of [2,3,4])assert.match(stopped.messages.find(message=>message.id===id).error,/cancelled/);
  assert.equal(stopped.messages.find(message=>message.id===5).value.paused,false);assert(stopped.render().left.every(value=>value===0));stopped.processor.dispose();
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

test('real 6581/8580 VBI/CIA/RSID machines stay frozen while paused and resume their exact continuing PCM/state',async()=>{
  const [{RsidPlayerCore},{Sid8580PlayerCore},{createSidPairFixture},{createPsidCiaFixture},{createRsidFixture},{createSid8580MachineFixture}]=await Promise.all([
    import('../docs/sid-player/rsid_core.js'),import('../docs/sid-player/core8580.js'),import('./helpers/sid_voice_pair_fixtures.mjs'),
    import('./helpers/psid_cia_fixtures.mjs'),import('./helpers/rsid_fixtures.mjs'),import('./helpers/sid8580_machine_fixtures.mjs'),
  ]);
  const [wasmBinary,endpointBinary,machineBinary]=await Promise.all([
    readFile(new URL('../docs/generated/sid-rsid/sid-rsid.wasm',import.meta.url)),
    readFile(new URL('../docs/generated/sid8580-machine/sid8580-endpoint.wasm',import.meta.url)),
    readFile(new URL('../docs/generated/sid8580-machine/sid8580-machine.wasm',import.meta.url)),
  ]);
  const cia=createPsidCiaFixture(),cases=[
    {backend:'psid-vbi',fixture:createSidPairFixture({model:'6581',sync:false}),subtune:1},
    {backend:'psid-cia',fixture:cia,subtune:cia.ciaSubtune},
    {backend:'rsid',fixture:createRsidFixture('cia-irq'),subtune:1},
    ...['psid-vbi','psid-cia','rsid-cia-irq'].map(profile=>{const fixture=createSid8580MachineFixture(profile);return{backend:'8580',fixture,subtune:fixture.subtune};}),
  ];
  for(const {backend,fixture,subtune}of cases){
    let Type,id=0;const messages=[],options={sampleRate:48000,...(backend==='8580'?{endpointBinary,machineBinary}:{wasmBinary})};
    vm.runInNewContext(source,{
      RsidPlayerCore,Sid8580PlayerCore, sampleRate:48000,
      SidPlayerCore:{create(){throw new Error('Unexpected direct-only backend');}},
      AudioWorkletProcessor:class{constructor(){this.port={postMessage:data=>messages.push(data)};}},registerProcessor(_name,value){Type=value;},
    });
    const processor=new Type({processorOptions:{backend,...options}}),Core=backend==='8580'?Sid8580PlayerCore:RsidPlayerCore,reference=await Core.create(options);
    const command=async(method,args=[])=>{const request=++id;processor.receive({id:request,method,args});await processor.commands;const reply=messages.find(message=>message.id===request);assert.equal(reply.error,undefined,`${backend}/${fixture.profile??'pair'} ${method}: ${reply.error}`);return reply.value;};
    const render=()=>{const left=new Float32Array(128),right=new Float32Array(128);assert.equal(processor.process([],[[left,right]]),true);assert.deepEqual(right,left);assert(left.every(Number.isFinite));return left;};
    try{
      await processor.ready;const loadOptions={subtune,vbiBackend:'c64'};
      await command('load',[fixture.bytes,loadOptions]);reference.load(fixture.bytes,loadOptions);await command('start');
      for(let block=0;block<32;block++)assert.deepEqual(render(),reference.render(128),'ordinary Play PCM remains unchanged');
      const before=processor.core.getState(),ack=await command('pause');
      assert.equal(ack.positionFrames,before.positionFrames);assert.equal(ack.paused,true);assert.equal(ack.playing,false);
      for(let block=0;block<32;block++){
        const output=render();if(block>1)assert(output.every(value=>value===0));
        assert.deepEqual(processor.core.getState(),before,'no CPU/SID/Envelope/filter/position advancement while paused');
      }
      const resumed=await command('resume');assert.equal(resumed.positionFrames,before.positionFrames);assert.equal(resumed.paused,false);
      let resumedFrames=0;
      for(let block=0;block<32;block++){
        const actual=render(),expected=reference.render(128);
        for(let i=0;i<actual.length;i++)if(resumedFrames+i>=Math.round(48000*.005)-1)assert.equal(actual[i],expected[i],'exact original PCM after the bounded host bridge');
        resumedFrames+=actual.length;
        assert.deepEqual(processor.core.getState(),reference.getState(),'continuing hardware state matches unpaused control at the same position');
      }
    }finally{processor.dispose();reference.dispose();}
  }
});
