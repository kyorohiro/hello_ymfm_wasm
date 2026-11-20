import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildSidOperations,compileSidOperations} from '../../tetorica_src/runtime/sid_operations.js';
import {SID_TIMED_EXAMPLES} from './code_examples.js';
import {createSidCodeProject} from './code_project.js';

const wasmBinary=await readFile(new URL('../generated/sid/sid.wasm',import.meta.url));
const wasm8580Binary=await readFile(new URL('../generated/sid8580-machine/sid8580-endpoint.wasm',import.meta.url));
let Processor;
globalThis.sampleRate=48000;
globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={postMessage:value=>this.messages.push(value)};}};
globalThis.registerProcessor=(_name,Type)=>{Processor=Type;};
await import('./processor.js');
async function setup(t,model='6581',rate=48000){
  globalThis.sampleRate=rate;
  const processor=new Processor({processorOptions:{model,wasmBinary,wasm8580Binary}});await processor.ready;
  assert.equal(processor.dead,false);let serial=0;
  t.after(()=>processor.dispose());
  const command=async(method,args=[])=>{
    const id=++serial;processor.receive({id,method,args});await processor.commands;
    const reply=processor.messages.find(message=>message.id===id);
    if(reply?.error)throw Object.assign(new Error(reply.error),{name:reply.name});
    return reply?.value;
  };
  const metadata=await command('beginCode');
  return{processor,metadata,command,
    timed:payload=>command('codeTimed',[metadata.session,payload]),
    code:(method,args=[])=>command('code',[metadata.session,method,args]),
    render(count){const left=new Float32Array(count),right=new Float32Array(count);assert.equal(processor.process([],[[left,right]]),true);assert.deepEqual(left,right);assert(left.every(Number.isFinite));return left;},
    registers:()=>processor.instrument.synth.getRegisterSnapshot(),
  };
}
for(const model of ['6581','8580'])for(const rate of [44100,48000])test(`${model}/${rate}: borrowed SID timed writes agree with compile and preserve parameter/Gate ownership`,async t=>{
  const f=await setup(t,model,rate),writes=[];
  const dispatch=f.processor.dispatchTimed.bind(f.processor);
  f.processor.dispatchTimed=(command,port,frame,metadata)=>{const value=dispatch(command,port,frame,metadata);if(command.method==='writeRegister'&&value!==false)writes.push({frame,register:command.args[0],value:command.args[1]});return value;};
  const plan=buildSidOperations(b=>{
    b.setVoice(0,{waveform:'saw',attack:0,decay:0,sustain:15,release:5});b.noteOn(0,'E3');
    b.atSample(441).setVoice(0,{pulseWidth:1111});b.atSample(3528).noteOff(0);
  });
  const snapshot=await f.timed({action:'capture'}),expected=compileSidOperations(plan,snapshot.state,{clock:985248,model});
  const receipt=await f.timed({action:'schedule',operations:plan,options:{name:'phrase'}});
  const pcm=f.render(receipt.startFrame+Math.round(rate*.08)+1);
  assert(pcm.some(value=>Math.abs(value)>1e-5));assert.equal(f.registers()[4]&1,0);
  assert.deepEqual(writes.map(({register,value})=>({register,value})),expected.map(({register,value})=>({register,value})));
  for(let i=0;i<expected.length;i++)assert.equal(writes[i].frame,receipt.startFrame+Math.round(expected[i].offsetSeconds*rate));
  const hold=buildSidOperations(b=>{b.noteOn(0,'G3');b.atSeconds(.02).noteOff(0);});
  const next=await f.timed({action:'schedule',operations:hold,options:{name:'hold'}});
  f.render(next.startFrame-f.processor.timedFrame+1);
  await f.command('editCodeVoice',[f.metadata.session,0,{modulation:{sync:true}}]);
  assert.equal(f.registers()[4]&3,3,'parameter editing retains Gate and its timed owner');
  f.render(Math.round(rate*.03));assert.equal(f.registers()[4]&1,0,'scheduled Off still owns that Gate');
  const newer=await f.timed({action:'schedule',operations:hold,options:{name:'hold'}});
  f.render(newer.startFrame-f.processor.timedFrame+1);
  await f.command('noteOn',['manual',72,0]);
  f.render(Math.round(rate*.03));assert.equal(f.registers()[4]&1,1,'old timed Off cannot release a later keyboard note');
  await f.timed({action:'clear',name:'hold'});assert.equal(f.registers()[4]&1,1);
  await f.command('noteOff',['manual']);assert.equal(f.registers()[4]&1,0);
});

test('SID borrowed staged replacement is atomic; failed model allocation retains reservations and successful replacement clears them',async t=>{
  const f=await setup(t),plan=buildSidOperations(b=>b.noteOn(0,'C4'));
  await f.timed({action:'schedule',operations:plan,options:{name:'voice',repeatSeconds:.2}});f.render(256);
  const before=f.processor.performance.getStats();
  await assert.rejects(f.timed({action:'schedule',operations:{...plan,operations:[{...plan.operations[0],args:[99,'C4']}]},options:{name:'voice',repeatSeconds:.2}}));
  assert.deepEqual(f.processor.performance.getStats(),before);
  await f.timed({action:'stage',transactionId:1,owner:'apply',method:'schedule',args:[plan,{name:'voice',repeatSeconds:.4}]});
  await f.timed({action:'abort',transactionId:1,owner:'apply'});
  assert.equal(f.processor.performance.getStats().patternCount,1);
  const create=f.processor.createInstrument.bind(f.processor);f.processor.createInstrument=async()=>{throw Error('candidate failed');};
  const preset=f.processor.instrument.read().preset;preset.model='8580';
  await assert.rejects(f.command('setPreset',[preset]),/candidate failed/);
  assert.equal(f.processor.instrument.core.model,'6581');assert.equal(f.processor.performance.getStats().patternCount,1);
  f.processor.createInstrument=create;
  await f.command('setPreset',[preset]);assert.equal(f.processor.instrument.core.model,'8580');
  assert.equal(f.processor.performance.getStats().patternCount,0);
  const snapshot=await f.timed({action:'capture'});assert.equal(snapshot.state.model,'8580');
  await f.code('noteOn',[0,'A3']);assert.equal(f.registers()[4]&1,1,'same borrowed Code lease survives successful model change');
  await f.command('stop');assert.equal(f.processor.performance.getStats().patternCount,0);
  await assert.rejects(f.timed({action:'capture'}),{name:'AbortError'});
});

test('SID Stop retires reservations despite release/restore failure and reports the original physical Stop failure once',async t=>{
  const f=await setup(t),plan=buildSidOperations(b=>b.noteOn(0,'E3'));
  await f.timed({action:'schedule',operations:plan,options:{name:'failure',repeatSeconds:.2}});f.render(256);
  f.processor.instrument.synth.keyOff=()=>{throw Error('original release failure');};
  f.processor.instrument.stop=()=>{throw Error('original Stop failure');};
  f.processor.receive({id:999,method:'stop'});
  assert.equal(f.processor.dead,true);assert.equal(f.processor.codeOwner,null);assert.equal(f.processor.instrument,null);
  assert.equal(f.processor.performance.getStats().patternCount,0);
  assert.deepEqual(f.processor.messages.filter(message=>message.fatal).map(message=>message.error),['original Stop failure']);
  f.processor.fail(Error('secondary'));assert.equal(f.processor.messages.filter(message=>message.fatal).length,1);
});

test('borrowed allNotesOff retires actual Gate ownership rather than being observed as a parameter edit',async t=>{
  const f=await setup(t),events=[],observe=f.processor.timed.observeWrite;
  f.processor.timed.observeWrite=(register,value,metadata,...rest)=>{
    if([4,11,18].includes(register))events.push({register,value,preserveOwner:metadata?.preserveOwner});
    return observe(register,value,metadata,...rest);
  };
  await f.code('noteOn',[0,'E3']);events.length=0;
  await f.code('allNotesOff');
  assert.equal(events.length,3);assert(events.every(event=>!(event.value&1)&&event.preserveOwner===false));
});

test('SID timed examples become accepted Files defaults, preserve edits and reappear only in a new project',()=>{
  const project=createSidCodeProject({starterCode:'original starter',starterFiles:SID_TIMED_EXAMPLES});
  for(const [path,source]of Object.entries(SID_TIMED_EXAMPLES))assert.equal(project.savedFs.get(path).data,source);
  project.setAutoApply(false);const path=Object.keys(SID_TIMED_EXAMPLES)[0];project.writeEditorText(path,'edited example');
  assert.deepEqual(project.ensureStarterFiles(),[]);assert.equal(project.fs.get(path).data,'edited example');
  const fresh=createSidCodeProject({snapshot:project.prepareNew()});
  assert.equal(fresh.savedFs.get('/index.js').data,'original starter');assert.equal(fresh.savedFs.get(path).data,SID_TIMED_EXAMPLES[path]);
});
