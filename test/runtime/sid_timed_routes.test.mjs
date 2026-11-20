import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel,Worker} from 'node:worker_threads';
import {SidSynth} from '../../tetorica_src/runtime/sidsynth.js';
import {createSidClient} from '../../tetorica_src/runtime/playground_sid.js';
import {createSidTimedProcessor,sidTimedCommandCost} from '../../tetorica_src/runtime/sid_timed_processor.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';
import {createPerformanceSender} from '../../tetorica_src/runtime/playground_performance_sender.js';
import {createPlaygroundRuntime} from '../../tetorica_src/runtime/playground_runtime.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(check,label){for(let i=0;i<1500;i++){if(check())return;await tick();}assert.fail('SID timed route did not reach '+label);}

// Actual public client, Performance Queue, SID resolver and logic runtime. Only
// the processor's outer port and audio renderer are replaced: no audible output.
function endpoint(id='sid',model='6581'){
  const pair=new MessageChannel(),commands=[];let frame=0,timed,metadata;
  const synth=new SidSynth({model,transport:{writeRegister(){},reset(){}}});synth.initialize();
  function apply(command,port,at,context){
    if(command.method==='applySidTimedOperation')return timed.apply(command,port,at,context);
    const previous=metadata;metadata=command.preserveOwner?{...context,preserveOwner:true}:context;
    try{
      const args=command.args??[];let value=true;
      if(command.method==='writeRegister'){
        const [r,v]=args,m=command.sidMask;
        synth.writeRegister(r,m===undefined?v:(synth.getRegisterSnapshot()[r]&~m)|(v&m));synth.adoptRegisterState();
      }else if(command.method==='reset'){timed.clear();synth.reset();}
      else if(command.method==='forceKeyOff'||command.method==='keyOff')synth.keyOff(args[0]);
      else if(command.method==='stopVoices'){timed.clear();timeline.clear();synth.allNotesOff();}
      else if(command.method==='readRegister')value=synth.getRegisterSnapshot()[args[0]];
      else if(command.method==='getState')value=synth._getState();
      else if(command.method==='dispose'){timed.clear();timeline.clear();}
      else if(command.type==='clear-scheduled-writes'){timed.clear();timeline.clear();}
      else if(command.method!=='clock'&&command.method!=='barrier')throw Error('Unexpected SID fixture command '+command.method);
      if(command.id!==undefined)port.postMessage({id:command.id,value});
    }finally{metadata=previous;}
  }
  const timeline=createProcessorPerformance({chip:'sid',rate:48000,nowFrame:()=>frame,apply,patternCommandCost:sidTimedCommandCost});
  timed=createSidTimedProcessor({performance:timeline,getState:()=>synth._getState(),getConfig:()=>({clock:synth.clock,model,instanceId:id}),
    dispatch:apply,nowFrame:()=>frame,sampleRate:48000});
  synth._observe=event=>{if(event.method==='writeRegister')timed.observeWrite(...event.args,metadata,pair.port1);};
  timeline.receive({type:'performance-start',session:1},{postMessage(){}});
  function receive(data,port=pair.port1){
    commands.push(data);
    if(data.primaryWorker)return;
    if(timed.receive(data,port))return;
    if(data.type==='performance-stop'||data.type==='performance-start')timed.clear();
    if(!timeline.receive(data,port))apply(data,port);
  }
  pair.port1.on('message',data=>receive(data));pair.port1.start();
  const admin={postMessage:data=>receive(data,{postMessage(){}}),start(){},addEventListener(){},removeEventListener(){}};
  return {port:pair.port2,clock:synth.clock,model,id,state:synth._getState(),commands,timed,timeline,synth,
    node:{port:admin,disconnect(){}},dispose(){timed.clear();timeline.clear();pair.port1.close();pair.port2.close();},
    render(frames){timeline.render(new Float32Array(frames),new Float32Array(frames),()=>{});frame+=frames;}};
}

let injected=0;
async function withFactory(factory){
  const url=new URL('../../tetorica_src/runtime/playground_runtime.js',import.meta.url),key='__sidTimedFactory'+(++injected);globalThis[key]=factory;
  const source=(await readFile(url,'utf8'))
    .replace(/^import \{createSidAudio\} from ['"][^'"]+['"];$/m,`const createSidAudio=globalThis[${JSON.stringify(key)}];`)
    .replace(/from\s*(['"])(\.[^'"]+)\1/g,(_m,_q,path)=>`from ${JSON.stringify(new URL(path,url).href)}`)
    .replaceAll('import.meta.url',JSON.stringify(url.href));
  try{return(await import('data:text/javascript,'+encodeURIComponent(source))).createPlaygroundRuntime;}finally{delete globalThis[key];}
}

for(const allocation of ['primary','createSoundChip','useSoundChip'])test(`actual Main SID ${allocation} stages entry programs, keeps failed Apply atomic and retires Stop`,{timeout:10000},async t=>{
  const devices=[],previousWindow=globalThis.window;
  globalThis.window={addEventListener(){},removeEventListener(){},setTimeout};
  const factory=async(_ctx,_dest,opts={})=>{const device=endpoint('sid:extra',opts.model);devices.push(device);return device;};
  const create=allocation==='primary'?createPlaygroundRuntime:await withFactory(factory);
  const media=()=>({stop(){},stopAll(){},pause(){},list:()=>[],unload(){}});
  const megaDrive={capabilities:allocation==='primary'?{chip:'sid',fmChannels:0,psg:false,dac:false}:undefined,state:'idle',
    audioContext:{currentTime:0},audio:{masterInputNode:{}},fm:{setPreset(){},noteOff(){}},psg:{},sample:media(),stream:media(),
    async start(){this.state='ready';},async resume(){},async close(){},clearFXChain:()=>[]};
  if(allocation==='primary'){
    const device=endpoint(),client=createSidClient(device.port,device);devices.push(device);client.initialize();
    megaDrive.fm=null;megaDrive.sid=client;megaDrive.primaryEndpoints=[{...device,name:'sid',globalName:'sid',client}];
    megaDrive.stopAllNative=()=>client._stopVoices();
  }
  const runtime=create({megaDrive,guardExecution:false});
  t.after(async()=>{await runtime.finalize();for(const d of devices)d.dispose();globalThis.window=previousWindow;});
  const acquire=allocation==='primary'?"await useSoundChip('sid')":`await ${allocation}('sid')`;
  await runtime.playSource(`
    const sid=${acquire};context.same=sid;
    const program=sid.build(b=>b.keyOn(0).atSample(200).keyOff(0));
    const snapshot=await sid.captureState();context.rows=await sid.compile(program,{initialState:snapshot});
    await sid.schedule(program,{name:'entry',repeatSeconds:.1});
    liveLoop('independent',async()=>{await sid.schedule(program,{name:'loop',repeatSeconds:.2});await sleep(60);});
  `);
  const d=devices[0];await until(()=>d.timeline.getStats().patternCount===2,'entry and loop admission');
  assert.deepEqual(runtime.context.rows.map(r=>r.register),[4,4]);
  const stages=d.commands.filter(c=>c.method==='sidTimed').map(c=>c.args[0]);
  assert(stages.some(c=>c.action==='stage'));assert(stages.some(c=>c.action==='commit'));
  assert(stages.some(c=>c.action==='schedule'&&c.owner?.includes('loop')));
  await assert.rejects(runtime.playSource(`const sid=context.same;await sid.schedule(sid.build(b=>b.keyOff(0)),{name:'entry',repeatSeconds:.2});throw Error('do not commit');`),/do not commit/);
  assert.equal(d.timeline.getStats().patternCount,2,'failed evaluation leaves prior entry and loop reservations');
  await runtime.stop();await until(()=>d.timeline.getStats().patternCount===0,'Stop retirement');
});

for(const primary of [true,false])test(`actual logic Worker SID ${primary?'primary':'independent'} sends timed RPC once with owner and stages atomic entry`,{timeout:10000},async t=>{
  const url=new URL('../../tetorica_src/runtime/playground_logic_worker.js',import.meta.url).href,messages=[],devices=[];
  const worker=new Worker(`const{parentPort}=require('node:worker_threads');globalThis.self=globalThis;
    globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
    import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
  worker.on('message',message=>{
    messages.push(message);
    if(message.type==='request'){
      if(message.command==='pcm.create'){
        const d=endpoint('sid:worker');devices.push(d);
        worker.postMessage({type:'response',id:message.id,value:{port:d.port,id:d.id,instance:1,clock:d.clock,model:d.model}},[d.port]);
      }else worker.postMessage({type:'response',id:message.id,value:true});
    }
  });
  t.after(async()=>{await worker.terminate();for(const d of devices)d.dispose();});
  await until(()=>messages.some(m=>m.ready),'Worker module');
  if(primary){const d=endpoint();devices.push(d);worker.postMessage({type:'native-primary-ports',endpoints:[{name:'sid',globalName:'sid',id:d.id,clock:d.clock,model:d.model,state:d.state,port:d.port}]},[d.port]);}
  const sourceCode=`const sid=await useSoundChip('sid');
    const p=sid.build(b=>b.keyOn(0).atSample(100).keyOff(0));
    const s=await sid.captureState();const rows=await sid.compile(p,{initialState:s});if(rows.length!==2)throw Error('bad compile');
    await sid.schedule(p,{name:'entry',repeatSeconds:.1});
    liveLoop('owned',async()=>{await sid.schedule(p,{name:'loop',repeatSeconds:.2});await sleep(60);});`;
  worker.postMessage({type:'run',sourceCode,capabilities:{chip:primary?'sid':'ym2612',fmChannels:primary?0:6,psg:false,dac:false},
    bpm:120,performance:{session:1,audioSeconds:0,performanceEpochMs:performance.timeOrigin+performance.now(),lookaheadSeconds:.5}});
  await until(()=>messages.some(m=>['complete','execution-error'].includes(m.type)),'Worker evaluation');
  assert.equal(messages.find(m=>m.type==='execution-error'),undefined,JSON.stringify(messages));
  const d=devices[0];await until(()=>d.timeline.getStats().patternCount===2,'Worker compact reservations');
  const requests=d.commands.filter(c=>c.method==='sidTimed');assert(requests.length>=4);
  assert(requests.every(c=>c.timedPerformance),'RPC has metadata rather than an outer performance command batch');
  assert(requests.some(c=>c.args[0].action==='stage'&&c.timedPerformance.owner==='script'));
  assert(requests.some(c=>c.args[0].action==='schedule'&&c.timedPerformance.owner.startsWith('loop:')));
  worker.postMessage({type:'stop'});await until(()=>messages.some(m=>m.type==='stopped'),'Worker Stop acknowledgement');
  await until(()=>d.timeline.getStats().patternCount===0,'Worker reservations canceled');
});

test('SID Worker timed transport keeps one lead and retains masks on ordinary packed writes',()=>{
  const sent=[],loop={performanceOwner:'sid:loop'},sender=createPerformanceSender({getLoop:()=>loop,now:()=>100000});
  sender.configure({session:1,audioSeconds:3,performanceEpochMs:100000,lookaheadSeconds:.15});
  const port=sender.port({postMessage:data=>sent.push(data),start(){}},'independent');
  const capture={id:1,method:'sidTimed',args:[{action:'capture'}]};port.postMessage(capture);
  assert.deepEqual(sent[0],{...capture,timedPerformance:{session:1,owner:'sid:loop',time:3.15}});
  const parameter={method:'writeRegister',args:[4,0x22],sidMask:2,preserveOwner:true};port.postMessage(parameter);
  assert.deepEqual(sent[1],{performance:{session:1,owner:'sid:loop',time:3.15},commands:[parameter]});
});
