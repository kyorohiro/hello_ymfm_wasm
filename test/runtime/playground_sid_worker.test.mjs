import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {SidSynth} from '../../tetorica_src/runtime/sidsynth.js';
import {createProcessorPerformance} from '../../tetorica_src/runtime/playground_performance_processor.js';

const workerUrl=new URL('../../tetorica_src/runtime/playground_logic_worker.js',import.meta.url).href;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate,label){
  for(let count=0;count<1500;count++){if(predicate())return;await tick();}
  assert.fail(`SID Worker did not reach ${label}`);
}

// Execute the production browser logic-worker module. The harness substitutes
// only its outer message plumbing and the audio endpoint; Worklet PCM tests
// exercise real rendering and reservation timing separately.
async function fixture(t,{primary=true,clock=985248}={}){
  const messages=[],devices=[],errors=[];
  const worker=new Worker(`
    const {parentPort}=require('node:worker_threads');
    globalThis.self=globalThis;
    globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
    import(${JSON.stringify(workerUrl)}).then(()=>{
      parentPort.on('message',data=>self.onmessage({data}));
      parentPort.postMessage({readyForTest:true});
    });
  `,{eval:true});
  function endpoint(id,physicalClock=clock,model='6581'){
    const channel=new MessageChannel(),registers=new Uint8Array(32),commands=[];
    const synth=new SidSynth({clock:physicalClock,model,transport:{reset(){registers.fill(0);},writeRegister(reg,value){registers[reg]=value;}}});
    synth.initialize();const state=synth._getState();synth.dispose();
    const port=channel.port1;
    const apply=command=>{
      const args=command.args??[];let value=true;
      if(command.method==='reset')registers.fill(0);
      else if(command.method==='writeRegister')registers[args[0]]=args[1];
      else if(command.method==='forceKeyOff')registers[args[0]*7+4]&=254;
      else if(command.method==='stopVoices')for(let ch=0;ch<3;ch++)registers[ch*7+4]&=254;
      else if(command.method==='readRegister')value=registers[args[0]];
      else if(command.method==='getState')value={...state,registers:Array.from(registers)};
      if(command.id!==undefined)port.postMessage({id:command.id,value});
    };
    const performance=createProcessorPerformance({chip:'sid',rate:48000,nowFrame:()=>0,apply});
    performance.receive({type:'performance-start',session:1},port);
    const device={id,clock:physicalClock,model,registers,commands,port,state};devices.push(device);
    port.onmessage=({data})=>{
      if(data.performance){
        for(const command of data.commands){commands.push({...command,owner:data.performance.owner,time:data.performance.time});performance.applyImmediate(command,port,data.performance);}
      }else{
        commands.push(data);
        if(!performance.receive(data,port))apply(data);
      }
    };
    port.start();return {...device,clientPort:channel.port2};
  }
  worker.on('message',message=>{
    messages.push(message);
    if(message.type==='request'){
      if(message.command==='pcm.create'){
        assert.equal(message.args[0],'sid');const options=message.args[1]??{},device=endpoint(options.id??'sid:extra',options.clock??985248,options.model??'6581');
        worker.postMessage({type:'response',id:message.id,value:{port:device.clientPort,id:device.id,instance:devices.length,clock:device.clock,model:device.model}},[device.clientPort]);
      }else worker.postMessage({type:'response',id:message.id,value:true});
    }
    if(message.type==='log'&&message.level==='error')errors.push(message.message);
  });
  worker.on('error',error=>errors.push(error.message));
  t.after(async()=>{await worker.terminate();for(const device of devices)device.port.close();});
  await until(()=>messages.some(message=>message.readyForTest),'module initialization');
  if(primary){
    const device=endpoint('sid');
    worker.postMessage({type:'native-primary-ports',endpoints:[{name:'sid',globalName:'sid',id:'sid',clock,state:device.state,port:device.clientPort}]},[device.clientPort]);
  }
  const capabilities={chip:primary?'sid':'ym2612',fmChannels:primary?0:6,psg:false,dac:false};
  async function run(sourceCode){
    const start=messages.length;
    worker.postMessage({type:'run',sourceCode,capabilities,bpm:120,performance:{session:1,audioSeconds:0,performanceEpochMs:performance.timeOrigin+performance.now(),lookaheadSeconds:.5}});
    await until(()=>messages.slice(start).some(message=>['complete','execution-error'].includes(message.type)),'evaluation');
    const failure=messages.slice(start).find(message=>message.type==='execution-error');if(failure)throw Error(failure.message);
  }
  const logged=word=>messages.some(message=>message.type==='command'&&message.command==='log'&&message.args[0]===word);
  async function stop(){const start=messages.length;worker.postMessage({type:'stop'});await until(()=>messages.slice(start).some(message=>message.type==='stopped'),'Stop acknowledgement');}
  return {run,stop,devices,messages,errors,logged};
}

function assertLoopOwnership(device){
  const gate=channel=>device.commands.find(command=>command.method==='writeRegister'&&command.args[0]===channel*7+4&&(command.args[1]&1));
  assert(gate(0)?.owner?.startsWith('loop:'));assert.equal(gate(1).owner,gate(0).owner,'an awaited register RPC restores the original loop');
  assert.notEqual(gate(2).owner,gate(0).owner,'a sibling loop keeps its independent note owner');
  assert(gate(0).time>=.5);assert.equal(device.registers[4]&1,1);assert.equal(device.registers[11]&1,1);assert.equal(device.registers[18]&1,1);
}

test('actual SID primary Worker shares globals/pg/livePrepare and restores loop ownership after register RPC', {timeout:10000},async t=>{
  const f=await fixture(t);
  await f.run(`
    if(sid!==pg.sid||await useSoundChip('sid')!==sid||typeof sid.dispose!=='undefined')throw Error('Wrong borrowedSID');
    if(typeof fm!=='undefined'||typeof play!=='undefined')throw Error('Unexpected OPN');
    if(await livePrepare('sid',({sid})=>sid)!==sid)throw Error('Missing preparedSID');
    sid.setFilter({mode:'lowpass+bandpass+highpass',cutoff:950,resonance:10,routing:7});
    liveLoop('old',async()=>{try{sid.noteOn(0,'C4');await sid.readRegister(27);sid.noteOn(1,'E4');log('old-ready');await sleep(60);}finally{sid.writeRegister(18,0);}});
    liveLoop('new',async()=>{sid.noteOn(2,'G4');log('new-ready');await sleep(60);});
  `);
  await until(()=>f.logged('old-ready')&&f.logged('new-ready'),'both voices');
  const device=f.devices[0];assertLoopOwnership(device);
  assert.equal((device.registers[24] >> 4) & 7, 7, 'the real logic Worker accepts combined filter outputs');
  assert.equal(device.commands.filter(command=>command.method==='reset').length,0,'handoff does not initialize or replay the Main instrument');
  await f.run(`liveLoop('new',async()=>{await sleep(60);});`);
  await until(()=>!(device.registers[4]&1)&&!(device.registers[11]&1),'retired loop release');
  assert.equal(device.registers[18]&1,1,'old finally cannot clear the sibling Gate');
  await f.stop();assert.equal(device.registers[18]&1,0);assert(device.commands.some(command=>command.method==='stopVoices'&&command.id!==undefined));assert.deepEqual(f.errors,[]);
});

for(const allocation of ['useSoundChip','createSoundChip'])test(`actual Worker ${allocation} SID creation restores caller context and preserves sibling notes on loop removal`,{timeout:10000},async t=>{
  const f=await fixture(t,{primary:false});
  await f.run(`
    ${allocation==='createSoundChip'?"const explicit=await createSoundChip('sid',{id:'sid:lead',clock:1022727,model:'6581'});":''}
    liveLoop('old',async()=>{const extra=${allocation==='createSoundChip'?'explicit':"await useSoundChip('sid')"};try{extra.noteOn(0,'C4');await extra.readRegister(27);extra.noteOn(1,'E4');log('old-ready');await sleep(60);}finally{extra.writeRegister(18,0);}});
    liveLoop('new',async()=>{const extra=${allocation==='createSoundChip'?'explicit':"await useSoundChip('sid')"};extra.noteOn(2,'G4');log('new-ready');await sleep(60);});
  `);
  await until(()=>f.logged('old-ready')&&f.logged('new-ready'),'both extra voices');
  assert.equal(f.devices.length,1);const device=f.devices[0];assertLoopOwnership(device);
  assert.equal(device.clock,allocation==='createSoundChip'?1022727:985248);
  await f.run(`liveLoop('new',async()=>{await sleep(60);});`);
  await until(()=>!(device.registers[4]&1)&&!(device.registers[11]&1),'extra retired loop release');
  assert.equal(device.registers[18]&1,1);await f.stop();assert.deepEqual(f.errors,[]);
});

test('actual logic Worker preserves the additional 8580 model, clock and performance ownership', {timeout:10000},async t=>{
  const f=await fixture(t,{primary:false});
  await f.run(`
    const extra=await createSoundChip('sid',{id:'sid:8580-voice',model:'8580'});
    if(extra.model!=='8580'||extra.clock!==985248)throw Error('Wrong8580 creation metadata');
    const observed=await extra.getState();if(observed.model!=='8580')throw Error('Wrong8580 state');
    liveLoop('old',async()=>{extra.noteOn(0,'C4');await extra.readRegister(27);extra.noteOn(1,'E4');log('old-ready');await sleep(60);});
    liveLoop('new',async()=>{extra.noteOn(2,'G4');log('new-ready');await sleep(60);});
  `);
  await until(()=>f.logged('old-ready')&&f.logged('new-ready'),'8580 owners');
  assert.equal(f.devices.length,1);assert.equal(f.devices[0].model,'8580');assert.equal(f.devices[0].clock,985248);assertLoopOwnership(f.devices[0]);
  await f.stop();
  await until(()=>f.messages.some(message=>message.type==='command'&&message.command==='pcm.dispose'&&message.args[0]==='sid:8580-voice'),'8580 endpoint disposal');
  assert.deepEqual(f.errors,[]);
});
