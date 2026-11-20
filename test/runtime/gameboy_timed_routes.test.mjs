import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel,Worker} from 'node:worker_threads';
import {GameboySynth} from '../../tetorica_src/runtime/gameboysynth.js';
import {createGameboyClient} from '../../tetorica_src/runtime/playground_gameboy.js';
import {createGameboyTimedProcessor,gameboyTimedCommandCost} from '../../tetorica_src/runtime/gameboy_timed_processor.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {createPerformanceSender} from '../../tetorica_src/runtime/playground_performance_sender.js';
import {createPlaygroundRuntime} from '../../tetorica_src/runtime/playground_runtime.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(check,label){for(let n=0;n<1500;n++){if(check())return;await tick();}assert.fail('DMG timed route did not reach '+label);}

// Actual clients, operation resolver, ownership queue and script execution;
// only native rendering/outer device creation are replaced. No audio output.
function endpoint(id='gameboy'){
  const pair=new MessageChannel(),commands=[];let frame=0,timed,metadata;
  const synth=new GameboySynth({transport:{writeRegister(){},reset(){}}});synth.initialize();
  function apply(command,port,at,context){
    if(command.method==='applyGameboyTimedOperation')return timed.apply(command,port,at,context);
    const previous=metadata;metadata=context;
    try{
      const args=command.args??[];let value=true;
      if(command.method==='writeRegister'){
        const [register,byte]=args;synth.writeRegister(register,byte);
        if(command.gameboyState){const state=synth._getState();state.voice[register]=command.gameboyState.voiceValue;state.initialized=command.gameboyState.initialized;synth._adoptState(state);}
      }else if(command.method==='reset'){if(!command.timedResetPrepared)timed.clear();synth.reset();}
      else if(command.method==='keyOff')synth.keyOff(args[0]);
      else if(command.method==='stopVoices'){timed.clear();timeline.clear();for(let ch=0;ch<4;ch++)synth.keyOff(ch);}
      else if(command.method==='getState')value=synth._getState();
      else if(command.method==='dispose'){timed.clear();timeline.clear();}
      else if(command.type==='clear-scheduled-writes'){timed.clear();timeline.clear();}
      else if(command.method!=='clock'&&command.method!=='barrier'&&command.type!=='chip-clock')throw Error('Unexpected DMG command '+command.method);
      if(command.id!==undefined)port.postMessage({id:command.id,value});
      return true;
    }finally{metadata=previous;}
  }
  const timeline=createProcessorPerformance({chip:'gameboy',rate:48000,nowFrame:()=>frame,apply,patternCommandCost:gameboyTimedCommandCost,
    prepare:command=>{if(command.method==='reset'){timed?.clear();return{...command,timedResetPrepared:true};}return command;}});
  timed=createGameboyTimedProcessor({performance:timeline,getState:()=>synth._getState(),getConfig:()=>({clock:synth.clock,instanceId:id}),
    dispatch:apply,retainState:state=>synth._adoptState(state),nowFrame:()=>frame,sampleRate:48000});
  synth._observe=event=>{if(event.method==='writeRegister')timed.observeWrite(...event.args,metadata,pair.port1);};
  timeline.receive({type:'performance-start',session:1},{postMessage(){}});
  function receive(data,port=pair.port1){
    commands.push(data);if(Object.hasOwn(data,'primaryWorker'))return;
    if(data.type==='detach-chip-port'){timed.clear();timeline.clear();return;}
    if(Array.isArray(data)){for(const command of data)receive(command,port);return;}
    if(timed.receive(data,port))return;
    if(data.type==='performance-stop'||data.type==='performance-start')timed.clear();
    if(!timeline.receive(data,port))apply(data,port);
  }
  pair.port1.on('message',data=>receive(data));pair.port1.start();
  const admin={postMessage:data=>receive(data,{postMessage(){}}),start(){},addEventListener(){},removeEventListener(){}};
  return {port:pair.port2,clock:synth.clock,id,state:synth._getState(),commands,timed,timeline,synth,
    node:{port:admin,disconnect(){}},dispose(){timed.clear();timeline.clear();pair.port1.close();pair.port2.close();},
    render(frames){timeline.render(new Float32Array(frames),new Float32Array(frames),()=>{});frame+=frames;}};
}

let injected=0;
async function withFactory(factory){
  const url=new URL('../../tetorica_src/runtime/playground_runtime.js',import.meta.url),key='__gameboyTimedFactory'+(++injected);globalThis[key]=factory;
  const source=(await readFile(url,'utf8'))
    .replace(/^import \{createGameboyAudio\} from ['"][^'"]+['"];$/m,`const createGameboyAudio=globalThis[${JSON.stringify(key)}];`)
    .replace(/from\s*(['"])(\.[^'"]+)\1/g,(_m,_q,path)=>`from ${JSON.stringify(new URL(path,url).href)}`)
    .replaceAll('import.meta.url',JSON.stringify(url.href));
  try{return(await import('data:text/javascript,'+encodeURIComponent(source))).createPlaygroundRuntime;}finally{delete globalThis[key];}
}

for(const allocation of ['primary','createSoundChip','useSoundChip'])test(`actual Main DMG ${allocation} stages entry, retains failed Apply and clears Stop`,{timeout:10000},async t=>{
  const devices=[],previousWindow=globalThis.window;
  globalThis.window={addEventListener(){},removeEventListener(){},setTimeout};
  const factory=async()=>{const d=endpoint('gameboy:extra');devices.push(d);return d;};
  const create=allocation==='primary'?createPlaygroundRuntime:await withFactory(factory);
  const media=()=>({stop(){},stopAll(){},pause(){},list:()=>[],unload(){}});
  const megaDrive={capabilities:allocation==='primary'?{chip:'gameboy',fmChannels:0,psg:false,dac:false}:undefined,state:'idle',
    audioContext:{currentTime:0},audio:{masterInputNode:{}},fm:{setPreset(){},noteOff(){}},psg:{},sample:media(),stream:media(),
    async start(){this.state='ready';},async resume(){},async close(){},clearFXChain:()=>[]};
  if(allocation==='primary'){
    const d=endpoint(),client=createGameboyClient(d.port);devices.push(d);client.initialize();
    megaDrive.gameboy=client;megaDrive.node=d.node;
  }
  const runtime=create({megaDrive,guardExecution:false});
  t.after(async()=>{await runtime.finalize();for(const d of devices)d.dispose();globalThis.window=previousWindow;});
  const acquire=allocation==='primary'?"await useSoundChip('gameboy')":`await ${allocation}('gameboy')`;
  await runtime.playSource(`
    const gb=${acquire};gb.initialize();context.same=gb;
    const p=gb.build(b=>b.pulse.noteOn(0,'C4'));
    const s=await gb.captureState();context.rows=await gb.compile(p,{initialState:s});
    await gb.schedule(p,{name:'entry',repeatSeconds:.1});
    liveLoop('owned',async()=>{await gb.schedule(p,{name:'loop',repeatSeconds:.2});await sleep(60);});
  `);
  const d=devices[0];await until(()=>d.timeline.getStats().patternCount===2,'Main compact patterns');d.render(512);
  assert(d.synth._getState().registers[2]>0);
  const requests=d.commands.filter(c=>c.method==='gameboyTimed').map(c=>c.args[0]);
  assert(requests.some(c=>c.action==='stage'));assert(requests.some(c=>c.action==='commit'));
  assert(requests.some(c=>c.action==='schedule'&&c.owner?.includes('loop')));
  const before=d.synth._getState();
  await assert.rejects(runtime.playSource(`const gb=context.same;await gb.schedule(gb.build(b=>b.keyOff(0)),{name:'entry',repeatSeconds:.1});throw Error('do not commit');`),/do not commit/);
  assert.equal(d.timeline.getStats().patternCount,2);assert.deepEqual(d.synth._getState(),before,'failed Apply changes neither Gate nor its configured voice');
  await runtime.stop();await until(()=>d.timeline.getStats().patternCount===0,'Main Stop retirement');
});

for(const primary of [true,false])test(`actual logic Worker DMG ${primary?'primary':'independent'} stages one RPC and preserves failed Apply`,{timeout:10000},async t=>{
  const url=new URL('../../tetorica_src/runtime/playground_logic_worker.js',import.meta.url).href,messages=[],devices=[];
  const worker=new Worker(`const{parentPort}=require('node:worker_threads');globalThis.self=globalThis;
    globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
    import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
  worker.on('message',message=>{
    messages.push(message);
    if(message.type==='request'){
      if(message.command==='pcm.create'){
        const d=endpoint('gameboy:worker');devices.push(d);
        worker.postMessage({type:'response',id:message.id,value:{port:d.port,id:d.id,instance:1,clock:d.clock}},[d.port]);
      }else worker.postMessage({type:'response',id:message.id,value:true});
    }
  });
  t.after(async()=>{await worker.terminate();for(const d of devices)d.dispose();});
  await until(()=>messages.some(m=>m.ready),'Worker boot');
  if(primary){const d=endpoint();devices.push(d);worker.postMessage({type:'chip-port',state:d.state,port:d.port},[d.port]);}
  const capabilities={chip:primary?'gameboy':'ym2612',fmChannels:primary?0:6,psg:false,dac:false};
  const performanceContext={session:1,audioSeconds:0,performanceEpochMs:performance.timeOrigin+performance.now(),lookaheadSeconds:.5};
  worker.postMessage({type:'run',sourceCode:`const gb=await useSoundChip('gameboy');gb.initialize();context.same=gb;
    const p=gb.build(b=>b.pulse.noteOn(0,'C4'));const s=await gb.captureState();const rows=await gb.compile(p,{initialState:s});if(rows.length<2)throw Error('bad compile');
    await gb.schedule(p,{name:'entry',repeatSeconds:.1});
    liveLoop('owned',async()=>{await gb.schedule(p,{name:'loop',repeatSeconds:.2});await sleep(60);});`,capabilities,bpm:120,performance:performanceContext});
  await until(()=>messages.some(m=>['complete','execution-error'].includes(m.type)),'Worker evaluation');
  assert.equal(messages.find(m=>m.type==='execution-error'),undefined,JSON.stringify(messages));
  const d=devices[0];await until(()=>d.timeline.getStats().patternCount===2,'Worker compact patterns');d.render(50000);
  const requests=d.commands.filter(c=>c.method==='gameboyTimed');assert(requests.length>=4);
  assert(requests.every(c=>c.timedPerformance),'timed RPC bypasses outer batches and double lead');
  assert(requests.some(c=>c.args[0].action==='stage'&&c.timedPerformance.owner==='script'));
  assert(requests.some(c=>c.args[0].action==='schedule'&&c.timedPerformance.owner.startsWith('loop:')));
  const before=d.synth._getState();
  worker.postMessage({type:'run',sourceCode:`const gb=context.same;await gb.schedule(gb.build(b=>b.keyOff(0)),{name:'entry',repeatSeconds:.1});throw Error('do not commit');`,capabilities,performance:performanceContext});
  await until(()=>messages.some(m=>m.type==='execution-error'),'Worker failed Apply');
  assert.match(messages.find(m=>m.type==='execution-error').message,/do not commit/);
  assert.equal(d.timeline.getStats().patternCount,2);assert.deepEqual(d.synth._getState(),before);
  worker.postMessage({type:'stop'});await until(()=>messages.some(m=>m.type==='stopped'),'Worker Stop');
  await until(()=>d.timeline.getStats().patternCount===0,'Worker reservations cleared');
});

test('Game Boy Worker register-operation RPC has one owner/time anchor',()=>{
  const sent=[],loop={performanceOwner:'gameboy:loop'},sender=createPerformanceSender({getLoop:()=>loop,now:()=>100000});
  sender.configure({session:1,audioSeconds:3,performanceEpochMs:100000,lookaheadSeconds:.15});
  const port=sender.port({postMessage:data=>sent.push(data),start(){}},'chip');
  const capture={id:1,method:'gameboyTimed',args:[{action:'capture'}]};port.postMessage(capture);
  assert.deepEqual(sent,[{...capture,timedPerformance:{session:1,owner:'gameboy:loop',time:3.15}}]);
});
