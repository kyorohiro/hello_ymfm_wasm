/** Actual embedded QuickJS-NG versus the shared LiveFX rack. No audio device. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LiveFX} from '../web/custom_fx.js';
import {encodeNativeLiveFxContext} from '../web/native_livefx_context.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const project=path.join(root,'w/tetorica-fm2612-playground-tauri');
const fixtureFlag=process.argv.indexOf('--fixture');
const outputFlag=process.argv.indexOf('--out');
const output=outputFlag>=0?process.argv[outputFlag+1]:null;
assert.ok(outputFlag<0||output,'--out requires a JSON output path');
let fixture=fixtureFlag>=0?process.argv[fixtureFlag+1]:process.env.TETORICA_LIVEFX_FIXTURE;
const compileFlags={c:['-std=c11','-O2','-DQUICKJS_NG_BUILD'],cpp:['-std=c++14','-O2'],link:['-pthread']};
const sourceManifest=JSON.parse(await fs.readFile(path.join(project,'src-tauri/native-livefx/sources.json'),'utf8'));
const report={
  schemaVersion:1,startedAt:new Date().toISOString(),status:'running',
  engine:{name:'QuickJS-NG',tag:sourceManifest.tag,commit:sourceManifest.commit,sourceHashes:sourceManifest.sha256,sharedHashes:sourceManifest.shared_sha256},
  machine:{platform:process.platform,architecture:process.arch,machine:os.machine(),osRelease:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length},
  node:process.version,fixture:{build:fixture?'prebuilt':'compiled by this checker',flags:fixture?null:compileFlags},
  parity:{rates:[44100,48000,96000],frames:[1,37,128],channels:2},benchmarks:[],
};
let temp;
if(!fixture){
  execFileSync('python3',[path.join(project,'scripts/sync_native_genesis_livefx.py'),'--check'],{cwd:project,stdio:'pipe'});
  report.fixture.compiler=execFileSync('clang',['--version'],{encoding:'utf8'}).split('\n')[0];
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'tetorica-native-livefx-'));
  fixture=path.join(temp,'fixture');
  try{
    const object=path.join(temp,'quickjs.o');
    execFileSync('clang',[...compileFlags.c,'-c',path.join(project,'src-tauri/native-livefx/quickjs-ng/quickjs-amalgam.c'),'-o',object],{stdio:'pipe'});
    execFileSync('clang++',[...compileFlags.cpp,path.join(project,'src-tauri/src/native_genesis_livefx.cpp'),path.join(project,'src-tauri/src/native_genesis_livefx_fixture.cpp'),object,...compileFlags.link,'-o',fixture],{stdio:'pipe'});
  }catch(error){await fs.rm(temp,{recursive:true,force:true});throw error;}
}
const child=spawn(path.resolve(root,fixture),[],{stdio:['pipe','pipe','pipe']});
const pending=[];let diagnostics='',exited=false;
child.stderr.setEncoding('utf8');child.stderr.on('data',value=>{diagnostics+=value;});
createInterface({input:child.stdout}).on('line',line=>{
  const next=pending.shift();
  if(!next){child.kill();throw new Error('Unexpected fixture response: '+line);}
  try{next.resolve(JSON.parse(line));}catch(error){next.reject(error);}
});
child.on('error',error=>{for(const next of pending.splice(0))next.reject(error);});
child.on('exit',(code,signal)=>{
  exited=true;
  for(const next of pending.splice(0))next.reject(new Error(`Fixture exited ${code??signal}: ${diagnostics}`));
});
async function request(value){
  assert.equal(exited,false,'QuickJS fixture must remain alive');
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Native liveFx fixture did not reply within 20 seconds'));},20000);
    pending.push({resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    child.stdin.write(JSON.stringify(value)+'\n');
  });
}
let comparisons=0,maximumDifference=0;
const gain=function(input,output,state,context){
  state.blocks=(state.blocks??0)+1;
  for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;
};
const copy=function(input,output){output.forEach((channel,ch)=>channel.set(input[ch]));};
function samples(frames,offset=0){
  return [Float32Array.from({length:frames},(_,i)=>Math.sin((i+offset)*.171)*.4+.03125),
    Float32Array.from({length:frames},(_,i)=>Math.cos((i+offset)*.117)*.3-.0625)];
}
function interleave(channels){return Array.from({length:channels[0].length*2},(_,i)=>channels[i%2][i>>1]);}
function command(name,process,context={},resetState=false){return {op:'live-fx',action:'register',name,source:process.toString(),context,resetState};}
function portableCommand(value){
  const outgoing={...value};
  if(Object.prototype.hasOwnProperty.call(outgoing,'context')){
    outgoing.contextGraph=encodeNativeLiveFxContext(outgoing.context);
    delete outgoing.context;
  }
  return outgoing;
}
async function rack(rate=48000,options={}){
  const init=await request({op:'init',rate,maxBlock:128,...options});
  assert.equal(init.ok,true,JSON.stringify(init));
  const reference=new LiveFX(rate);
  return {
    reference,
    async command(value,{fails=false}={}){
      let error;try{reference.command(structuredClone(value));}catch(value){error=value;}
      const reply=await request({op:'command',command:portableCommand(value)});
      assert.equal(Boolean(error),fails,'Reference command failure must match test expectation');
      assert.equal(reply.ok,!fails,JSON.stringify(reply));
      return reply;
    },
    async process(frames=128,offset=0){
      const input=samples(frames,offset),expected=input.map(channel=>new Float32Array(channel)),reports=[];
      reference.process(expected,value=>reports.push(value));
      const reply=await request({op:'process',samples:interleave(input),frames});
      assert.equal(reply.ok,true,JSON.stringify(reply));
      assert.equal(reply.samples?.length,frames*2,'Native must return stereo float32 samples');
      let difference=0;
      const actual=interleave(expected);
      for(let i=0;i<actual.length;i++){
        assert.equal(Number.isFinite(reply.samples[i]),true,'Native PCM must be finite');
        difference=Math.max(difference,Math.abs(actual[i]-reply.samples[i]));
      }
      assert.ok(difference<=2e-6,`PCM mismatch at ${rate} Hz / ${frames} frames: ${difference}`);
      assert.equal(reply.reports?.length??0,reports.length,'Runtime failures must report once, then bypass');
      for(let i=0;i<reports.length;i++){
        const name=/\[liveFx:([^\]]+)\]/.exec(reports[i])?.[1];
        if(name)assert.match(reply.reports[i],new RegExp('\\[liveFx:'+name+'\\]'));
        assert.match(reply.reports[i],/bypassed/i);
      }
      comparisons++;maximumDifference=Math.max(maximumDifference,difference);
      return reply;
    },
    async clear(){reference.clear();const reply=await request({op:'clear'});assert.equal(reply.ok,true,JSON.stringify(reply));return reply;},
  };
}

async function baseline(rate){
  const fx=await rack(rate);
  for(const frames of [128,1,37,128]){
    const result=await fx.process(frames);
    assert.equal(result.initialized,false,'No liveFx must leave QuickJS uninitialized');
  }
  await fx.command(command('gain',gain,{gain:.5}));
  for(const frames of [128,37,1,128])await fx.process(frames);
  await fx.command({action:'context',name:'gain',context:{gain:.25}});await fx.process();
  await fx.command({action:'remove',name:'gain'});await fx.process();
  await fx.clear();
  await fx.command(command('fresh',gain,{gain:.75}));await fx.process(37);
}
async function stateAndContext(rate){
  const fx=await rack(rate);
  const process={process(input,output,state,context){
    state.frames=(state.frames??0)+input[0].length;
    for(let ch=0;ch<input.length;ch++)output[ch].set(input[ch].map(value=>value*context.gain+state.frames/100000));
  }}.process;
  await fx.command(command('state',process,{gain:.5,nested:{left:1},unchanged:42}));
  await fx.process();await fx.process(37);
  await fx.command(command('state',process,{gain:.75}));await fx.process();
  await fx.command(command('state',process,{gain:.25},true));await fx.process(37);
  await fx.command({action:'context',name:'state',context:{gain:.1}});await fx.process(1);
  await fx.command(command('state',function(input,output,state,context){
    const gain=context.nested.right===3&&!('left'in context.nested)&&context.unchanged===42?.3:0;
    output.forEach((channel,ch)=>channel.set(input[ch].map(value=>value*gain)));
  },{nested:{left:1},unchanged:42}));
  await fx.command({action:'context',name:'state',context:{nested:{right:3}}});await fx.process();
  const delay=await rack(rate);
  await delay.command(command('history',function(input,output,state,context){
    state.history??=[new Float32Array(257),new Float32Array(257)];
    state.position??=0;
    state.metadata??=new Map([['calls',0]]);
    state.metadata.set('calls',state.metadata.get('calls')+1);
    for(let i=0;i<input[0].length;i++){
      for(let ch=0;ch<input.length;ch++){
        const previous=state.history[ch][state.position];
        state.history[ch][state.position]=input[ch][i]+previous*context.feedback;
        output[ch][i]=input[ch][i]*context.dry+previous*context.wet;
      }
      state.position=(state.position+1)%state.history[0].length;
    }
  },{feedback:.45,dry:.75,wet:.25}));
  for(let i=0;i<20;i++)await delay.process([128,37,1][i%3],i*128);
}
async function arrays(rate){
  const fx=await rack(rate);
  await fx.command(command('replace',function(input,output,state){
    const length=input[0].length;
    const previous=(state.byLength??={})[length];
    if(previous&&(previous.input!==input||previous.output!==output||previous.left!==input[0]||previous.right!==output[0]))throw Error('Cached rack storage changed');
    state.byLength[length]={input,output,left:input[0],right:output[0]};
    for(let ch=0;ch<input.length;ch++){
      input[ch]=Float32Array.from(input[ch],value=>value*.5);
      output[ch]=input[ch];
    }
  }));
  for(let iteration=0;iteration<3;iteration++)for(const frames of [1,37,128])await fx.process(frames,iteration*128);
  await fx.command(command('replace',(input,output)=>{
    input.forEach((channel,ch)=>output[ch].set(channel.subarray(0).map(value=>Math.tanh(value*2)*.4)));
  }));
  for(const frames of [128,37,1,128])await fx.process(frames);
}
async function graphContext(rate){
  const buffer=new ArrayBuffer(32),coefficients=new Float32Array(buffer,4,4);
  coefficients.set([.5,.25,.125,.0625]);
  const key={name:'coefficient'},context={
    gain:.5,coefficients,same:coefficients,bytes:new Uint8Array(buffer),view:new DataView(buffer,4,8),key,
    map:new Map([[key,coefficients]]),set:new Set([coefficients,key,NaN]),
    date:new Date('2026-10-21T00:00:00Z'),regexp:/^(a+)$/i,big:9007199254740995n,
    minusZero:-0,positive:Infinity,negative:-Infinity,nan:NaN,missing:undefined,
    signed:new BigInt64Array([-1n,9007199254740995n]),unsigned:new BigUint64Array([18446744073709551615n]),
    sparse:new Array(4),phase:0,
  };
  context.self=context;context.sparse[1]=undefined;context.sparse[3]=context;
  const fx=await rack(rate);
  const process=function(input,output,state,context){
    if(!(context.coefficients instanceof Float32Array)||context.coefficients!==context.same||
      context.coefficients.buffer!==context.bytes.buffer||context.view.buffer!==context.bytes.buffer||
      context.view.getFloat32(0,true)!==.5||context.coefficients.byteOffset!==4||
      context.map.get(context.key)!==context.coefficients||!context.set.has(context.coefficients)||!context.set.has(NaN)||
      context.self.self!==context.self||(context.self===context)!==(context.phase===0)||
      !(context.date instanceof Date)||context.date.getTime()!==1792540800000||
      !(context.regexp instanceof RegExp)||!context.regexp.test('AAA')||
      context.big!==9007199254740995n||context.signed[0]!==-1n||context.unsigned[0]!==18446744073709551615n||
      !Object.is(context.minusZero,-0)||context.positive!==Infinity||context.negative!==-Infinity||
      !Number.isNaN(context.nan)||!('missing'in context)||context.missing!==undefined||
      0 in context.sparse||!(1 in context.sparse)||context.sparse[3]!==context.self)throw Error('Structured context changed');
    state.frames=(state.frames??0)+input[0].length;
    output.forEach((channel,ch)=>channel.set(input[ch].map(value=>value*context.gain+context.coefficients[ch]*.01)));
  };
  await fx.command(command('graph',process,context));
  // Encoding, like the existing worklet sender, copies rather than transfers.
  assert.equal(buffer.byteLength,32);assert.equal(coefficients[0],.5);
  coefficients[0]=.125;context.gain=0;
  for(const frames of [128,37,1])await fx.process(frames);
  await fx.command({action:'context',name:'graph',context:{gain:.25,phase:1}});
  for(const frames of [128,1,37])await fx.process(frames);
}
async function multipleAndFade(rate){
  const fx=await rack(rate);
  await fx.process(37);
  await fx.command(command('gain',gain,{gain:.25}));
  for(let i=0;i<8;i++)await fx.process(i%2?37:128,i*128);
  await fx.command(command('drive',function(input,output){
    output.forEach((channel,ch)=>{for(let i=0;i<channel.length;i++)channel[i]=Math.tanh(input[ch][i]*3);});
  }));
  for(let i=0;i<8;i++)await fx.process();
  await fx.command(command('gain',gain,{gain:2}));await fx.process();
  await fx.command({action:'remove',name:'gain'});await fx.process();
  await fx.command(command('clip',function(input,output){output.forEach((channel,ch)=>channel.set(input[ch].map(value=>value*100)));}));
  for(let i=0;i<8;i++)await fx.process();
}
async function errors(rate){
  const malformed=[
    function(input,output){output[0]=Float32Array.of(.5);},
    function(input,output){output[0]=null;},
    function(input,output){output.length=0;},
    function(input){input.length=0;throw Error('bad');},
    function(input){input[0]=new Float32Array(1);},
    function(input,output){output[0]=new Float64Array(input[0].length);},
    function(input,output){output.push(new Float32Array(input[0].length));},
    function(input){input.length=1;},
    function(input,output){delete output[1];},
    function(input,output){output.length=0;Object.freeze(output);},
    function(input){input.length=0;Object.freeze(input);throw Error('bad');},
    function(input,output){output[1][output[1].length-1]=NaN;},
    function(input,output){output[1][output[1].length-1]=Infinity;},
    function(){throw Error('deliberate');},
    function(){throw null;},
    function(){return Promise.resolve();},
  ];
  for(const process of malformed){
    const fx=await rack(rate);
    await fx.command(command('bad',process));await fx.command(command('good',gain,{gain:.5}));
    for(let i=0;i<3;i++)await fx.process(i===1?37:128);
  }
  const fx=await rack(rate);await fx.command(command('gain',gain,{gain:.5}));await fx.process();
  await fx.command({action:'register',name:'gain',source:'invalid {'},{fails:true});await fx.process();
  await fx.command(command('gain',async()=>{}),{fails:true});await fx.process();
  await fx.command(command('gain',copy));await fx.process();
  await fx.command({action:'context',name:'missing',context:{}},{fails:true});
  for(let i=1;i<8;i++)await fx.command(command('fx'+i,copy));
  await fx.command(command('ninth',copy),{fails:true});await fx.process();
  await fx.command({action:'remove',name:'fx1'});await fx.command(command('ninth',copy));await fx.process();
}

async function benchmark(){
  const rate=48000,frames=128,blocks=4000,warmup=100;
  const drive=function(input,output){
    for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=Math.tanh(input[ch][i]*2)*.4;
  };
  const cases=[['unused',0,copy],['gain',1,gain],['distortion',1,drive],['eight-gain',8,gain],['eight-distortion',8,drive]];
  for(const [name,count,process]of cases){
    const fx=await rack(rate,{budgetUs:1000000});
    for(let i=0;i<count;i++)await fx.command(command('bench'+i,process,{gain:.9}));
    const result=await request({op:'benchmark',blocks,frames,warmup});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.ok(Number.isFinite(result.totalUs)&&result.totalUs>=0,'Benchmark must time native processing internally');
    assert.ok(Number.isFinite(result.maxUs)&&result.maxUs>=0);
    assert.ok(Number.isFinite(result.checksum));
    for(const field of ['p50Us','p95Us','p99Us'])assert.ok(Number.isFinite(result[field])&&result[field]>=0,`Missing ${field}`);
    assert.ok(Number.isSafeInteger(result.overDeadlineBlocks)&&result.overDeadlineBlocks>=0&&result.overDeadlineBlocks<=blocks);
    const audioUs=blocks*frames/rate*1e6,budgetUs=frames/rate*1e6;
    report.benchmarks.push({name,rate,frames,blocks,warmup,effects:count,interruptBudgetUs:1000000,
      audioBlockUs:budgetUs,processingToAudioRatio:result.totalUs/audioUs,meanUs:result.totalUs/blocks,
      totalUs:result.totalUs,maxUs:result.maxUs,p50Us:result.p50Us,p95Us:result.p95Us,p99Us:result.p99Us,
      overDeadlineBlocks:result.overDeadlineBlocks,checksum:result.checksum,processCalls:result.processCalls,
      initialized:result.initialized,initializations:result.initializations});
    console.log(`QuickJS ${name}: ${(result.totalUs/audioUs*100).toFixed(2)}% processing/audio time; mean ${(result.totalUs/blocks).toFixed(2)} us, p99 ${result.p99Us.toFixed(2)} us, maximum ${result.maxUs.toFixed(2)} us / ${budgetUs.toFixed(2)} us block budget; ${result.overDeadlineBlocks} over budget`);
    if(!count)assert.equal(result.initialized,false,'Unused benchmark cannot initialize QuickJS');
  }
}

async function limits(){
  const input=interleave(samples(128));
  const init=async(options={})=>{
    const result=await request({op:'init',rate:48000,maxBlock:128,budgetUs:20000,...options});
    assert.equal(result.ok,true,JSON.stringify(result));
  };
  const send=async value=>request({op:'command',command:portableCommand(value)});
  const render=async()=>request({op:'process',frames:128,samples:input});
  const assertDry=result=>assert.deepEqual(result.samples,input,'A failed host call must preserve the complete dry block');
  const assertFault=async result=>{
    assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.faulted,true,JSON.stringify(result));
    const next=await render();assert.equal(next.ok,true);assert.equal(next.faulted,true);assertDry(next);
    assert.equal(next.processCalls,result.processCalls,'A faulted rack cannot re-enter JavaScript');
  };
  await init();
  assert.equal((await send(command('infinite',function(){while(true){}}))).ok,true);
  const timed=await render();assertDry(timed);assert.match(timed.error,/interrupt budget/);await assertFault(timed);
  assert.equal((await send(command('retry',copy))).ok,false,'Faulted runtimes require explicit clear');
  assert.equal((await request({op:'clear'})).initialized,false);
  assert.equal((await send(command('retry',copy))).ok,true);assert.equal((await render()).ok,true);

  await init();
  const formatting=await send({action:'register',name:'hostile-error',source:'get process(){throw {toString(){for(;;){}}};}',context:{}});
  assert.match(formatting.error,/interrupt budget/);await assertFault(formatting);

  await init({memoryLimit:8*1024*1024});
  assert.equal((await send(command('allocate',function(){new Float64Array(16*1024*1024);}))).ok,true);
  const memory=await render();assert.equal(memory.ok,true,JSON.stringify(memory));assertDry(memory);
  assert.equal(memory.reports.length,1,'Memory exhaustion must bypass and report once');
  assert.equal((await render()).reports.length,0);

  await init();
  assert.equal((await send(command('atomic-wait',function(){
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  }))).ok,true);
  const atomicWait=await render();assert.equal(atomicWait.ok,true,JSON.stringify(atomicWait));assertDry(atomicWait);
  assert.equal(atomicWait.reports.length,1);assert.match(atomicWait.reports[0],/block/i);
  assert.equal((await render()).reports.length,0,'A blocked atomic wait is bypassed once');

  await init();
  assert.equal((await send(command('metadata',function(input,output){
    Object.defineProperty(Map.prototype,'size',{get(){while(true){}}});
    for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i];
  }))).ok,true);
  assert.equal((await render()).ok,true);
  const metadata=await send({action:'context',name:'metadata',context:{gain:1}});
  assert.match(metadata.error,/interrupt budget/);await assertFault(metadata);

  await init();
  assert.equal((await send(command('prototype',function(input,output){
    Object.defineProperty(Object.prototype,'context',{set(){while(true){}},configurable:true});
    for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i];
  }))).ok,true);
  assert.equal((await render()).ok,true);
  const prototype=await send({action:'context',name:'prototype',context:{gain:1}});
  // Defining an own data property also safely avoids the inherited setter.
  if(!prototype.ok){assert.match(prototype.error,/interrupt budget/);await assertFault(prototype);}
  else assert.equal((await render()).ok,true);

  await init();
  assert.equal((await send(command('graph-getter',function(input,output){
    Object.defineProperty(Object.prototype,'contextGraph',{get(){while(true){}},configurable:true});
    for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i];
  }))).ok,true);
  assert.equal((await render()).ok,true);
  const graphGetter=await send({action:'remove',name:'graph-getter'});
  assert.match(graphGetter.error,/interrupt budget/);await assertFault(graphGetter);

  await init();
  assert.equal((await send(command('detach',function(input,output,state){
    if(!state.installed){
      state.installed=true;
      Float32Array.prototype.set=function(source){
        if(typeof source.buffer.transfer!=='function')throw Error('Expected QuickJS ArrayBuffer.transfer');
        source.buffer.transfer();this.fill(0);
      };
    }
    for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i];
  }))).ok,true);
  assert.equal((await render()).ok,true);
  const detached=await render();assert.match(detached.error,/Detached LiveFX PCM buffer/);assertDry(detached);await assertFault(detached);
  report.limits={passed:true,cases:['infinite callback','hostile error conversion','heap limit','Atomics.wait nonblocking','metadata getter','inherited context setter','inherited context graph getter','detached host PCM','clear and retry']};
  console.log('Native liveFx limits: interrupt, hostile error/getter, memory limit, detached PCM and clear/retry passed');
}

try{
  for(const rate of [44100,48000,96000]){
    await baseline(rate);await stateAndContext(rate);await arrays(rate);await graphContext(rate);await multipleAndFade(rate);await errors(rate);
    console.log(`LiveFX actual QuickJS/shared JS parity: ${rate} Hz passed`);
  }
  Object.assign(report.parity,{passed:true,blocks:comparisons,maximumDifference});
  console.log(`Native liveFx: ${comparisons} stereo PCM blocks passed; maximum difference ${maximumDifference}`);
  await limits();
  if(process.argv.includes('--benchmark'))await benchmark();
  report.status='passed';
}catch(error){
  report.status='failed';report.error=error?.stack??String(error);throw error;
}finally{
  child.stdin.end();
  if(!exited)child.kill();
  if(temp)await fs.rm(temp,{recursive:true,force:true});
  report.finishedAt=new Date().toISOString();
  if(output){const destination=path.resolve(root,output);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,JSON.stringify(report,null,2)+'\n');}
}
