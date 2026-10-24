import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisOpl} from './native_genesis_opl.js';

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,1));
async function until(predicate){const deadline=Date.now()+3000;while(!predicate()){if(Date.now()>deadline)throw Error('Primary Y8950 test timed out');await tick();}}
function fixture(){
  const commands=[],requests=[],queue=[],memory=new Uint8Array(0x200000),registers=Array(256).fill(0);let owner='a',run=1,gate=null,size=0;
  const synth={session:1,generation:1,clock:{sampleRate:48000},isReady:()=>true,frameAt:()=>1000,
    enqueue:command=>{const value={...command,testOwner:owner};commands.push(value);queue.push(value);},
    async flush(){while(queue.length){const c=queue.shift(),m=c.message;if(m.method==='write')registers[m.register]=m.value;
      if(m.method==='reset')registers.fill(0);
      if(m.method==='adpcm-memory'){memory.set(m.bytes,m.address);size=Math.max(size,m.address+m.bytes.length);registers[7]=1;}
      if(m.method==='adpcm-clear'){memory.fill(0);size=0;registers[7]=1;}
    }},
    async nativeRequest(command,args={}){requests.push({command,args});if(args.after&&gate)await gate.promise;return{y8950:{chip:'y8950',clock:3579545,registers:[...registers],status:0,irq:false,held:[],pendingCommands:[],adpcmMemorySize:size},sampleRate:48000};},
  };
  const endpoint=createNativeGenesisOpl(synth,{chip:'y8950',msxAudio:true}),client=endpoint.client;
  const hooks={captureContext:()=>({run,owner}),checkCurrent:scope=>{if(scope&&scope.run!==run)throw new DOMException('Run stopped','AbortError');},
    withContext(scope,callback){const previous=owner;owner=scope.owner;try{return callback();}finally{owner=previous;}}};
  return {synth,endpoint,client,commands,requests,memory,registers,hooks,setGate:value=>{gate=value;},setOwner:value=>{owner=value;},newRun:()=>{run++;},getOwner:()=>owner};
}

test('Primary Y8950 has passive ADPCM helpers and other OPL chips retain their FM-only surface',()=>{
  const f=fixture();assert.equal(typeof f.client.adpcm.loadMemory,'function');assert.equal(typeof f.client.adpcm.loadSample,'function');assert.equal(typeof f.client._setAdpcmLifecycle,'function');assert.deepEqual(f.commands,[]);
  for(const chip of ['ym3526','ym3812','ymf262'])assert.equal(createNativeGenesisOpl(f.synth,{chip}).client.adpcm,undefined);
});

test('Primary Y8950 uploads use copied bounded bytes and acknowledge application; reset retains RAM and clear stops only ADPCM',async()=>{
  const f=fixture();await f.endpoint.initialize();const before=f.commands.length;
  await assert.rejects(f.client.adpcm.loadMemory(new Uint8Array(2),0x1fffff),/2 MiB/);assert.equal(f.commands.length,before);
  const gate=deferred();f.setGate(gate);const bytes=new Uint8Array([7,11,13]);let completed=false;
  const loading=f.client.adpcm.loadMemory(bytes,0x1ffffd).then(()=>{completed=true;});bytes.fill(255);
  await until(()=>f.requests.some(c=>c.args.after));assert.equal(completed,false);assert.deepEqual([...f.memory.slice(-3)],[7,11,13]);
  const command=f.commands.find(c=>c.message.method==='adpcm-memory');assert.equal(command.type,'opl');assert.equal(command.message.chip,'y8950');assert.equal(command.frame,0);assert.equal(f.requests.at(-1).args.after,command.message.id);
  f.setGate(null);gate.resolve();await loading;f.client.reset();await f.synth.flush();assert.deepEqual([...f.memory.slice(-3)],[7,11,13]);
  f.client.writeRegister(8,0xc0);f.client.adpcm.setSample({start:0,end:32});assert.equal(f.client.getRegisterSnapshot()[8],0xc2);f.client.noteOn(1,'A4');f.client.adpcm.keyOn({repeat:true});await f.synth.flush();
  await f.client.adpcm.clearMemory();assert.equal(f.registers[7],1);assert.equal(f.client.getRegisterSnapshot()[7],1);assert.equal(f.registers[0xb1]&32,32);assert.equal(f.memory.at(-1),0);
});

test('Primary Y8950 loadSample resumes its original author around post-decode and post-upload configuration',async()=>{
  const f=fixture(),decode=deferred();await f.endpoint.initialize();f.client._setAdpcmLifecycle(f.hooks);
  const loading=f.client.adpcm.loadSample(new Uint8Array([1,2,3,4]),{address:64,sampleRate:8000,decodeAudio:()=>decode.promise});f.setOwner('b');
  decode.resolve({sampleRate:8000,channels:[new Float32Array(128)]});const sample=await loading;
  assert.equal(sample.start,64);assert.equal(sample.end%32,0);assert(sample.deltaN>0);assert.equal(f.getOwner(),'b');
  const memory=f.commands.find(c=>c.message.method==='adpcm-memory');assert.equal(memory.testOwner,'a');
  const edits=f.commands.filter(c=>c.message.method==='write'&&[7,8,9,10,11,12,16,17].includes(c.message.register));assert(edits.length);assert(edits.every(c=>c.testOwner==='a'));
});

test('Primary Y8950 cancelled Run decode cannot upload into a new Run on the same Native session',async()=>{
  const f=fixture(),decode=deferred();await f.endpoint.initialize();f.client._setAdpcmLifecycle(f.hooks);const before=f.commands.length;
  const loading=f.client.adpcm.loadSample(new Uint8Array([1,2,3,4]),{decodeAudio:()=>decode.promise}),rejected=assert.rejects(loading,{name:'AbortError'});
  f.newRun();f.client._setAdpcmLifecycle(f.hooks);decode.resolve({sampleRate:8000,channels:[new Float32Array(128)]});await rejected;
  assert.equal(f.commands.length,before);assert.equal(f.synth.session,1);
});

test('Primary Y8950 retired Native endpoint rejects an upload acknowledgement without configuring a replacement',async()=>{
  const f=fixture(),gate=deferred();await f.endpoint.initialize();f.setGate(gate);
  const uploading=f.client.adpcm.loadSample({sampleRate:8000,channels:[new Float32Array(128)]}),rejected=assert.rejects(uploading,{name:'AbortError'});
  await until(()=>f.requests.some(r=>r.args.after));const before=f.commands.length;f.endpoint.reset();f.setGate(null);gate.resolve();await rejected;assert.equal(f.commands.length,before);
});

test('Primary Y8950 delayed memory acknowledgement preserves a newer authored ADPCM trigger',async()=>{
  const f=fixture(),gate=deferred();await f.endpoint.initialize();f.setGate(gate);
  const loading=f.client.adpcm.loadMemory(new Uint8Array(32));await until(()=>f.requests.some(r=>r.args.after));
  f.client.adpcm.keyOn({repeat:true});assert.equal(f.client.getRegisterSnapshot()[7],0xb0);
  f.setGate(null);gate.resolve();await loading;assert.equal(f.client.getRegisterSnapshot()[7],0xb0,'late resource ACK cannot overwrite a later author command');
});
