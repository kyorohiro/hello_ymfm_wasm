import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Ym2612} from './ym2612.js';
import {Ym2203} from './ym2203.js';
import {Ym2610B} from './ym2610b.js';
import ym2612Factory from '../docs/generated/ym2612_wasm.js';
import ym2203Factory from '../docs/generated/ym2203_wasm.js';
import ym2610Factory from '../docs/generated/ym2610b_wasm.js';
import {createOpnClient} from './playground_opn.js';
const source=(await readFile(new URL('./playground_opn_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
async function setup(name, overrides={}) {
 let Processor, ready;
 const promise=new Promise(resolve=>{ready=resolve;});
 vm.runInNewContext(source,{Ym2612,Ym2203,Ym2610B,ym2612Factory,ym2203Factory,ym2610Factory,sampleRate:48000,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:ready};}},registerProcessor:(_,cls)=>{Processor=cls;},...overrides});
 const wasmBinary=await readFile(new URL(`../docs/generated/${name==='ym2610'?'ym2610b':name}_wasm.wasm`,import.meta.url));
 const processor=new Processor({processorOptions:{name,wasmBinary}});
 return {processor,promise};
}
const render=p=>{const output=[new Float32Array(4096),new Float32Array(4096)];p.process([],[output]);return output[0];};
for(const name of ['ym2612','ym2203','ym2610']) test(`${name}: two real WASM processors are independent and render FM`,async()=>{
 const a=await setup(name), b=await setup(name), control=await setup(name);
 assert.equal((await a.promise).ready,true);assert.equal((await b.promise).ready,true);assert.equal((await control.promise).ready,true);
 const port={start(){},close(){},postMessage(data){a.processor.receive(data,{postMessage:reply=>port.onmessage({data:reply})});}};
 const client=createOpnClient(name,port);
 try{
  client.reset();client.setAlgo(0,7,0);
  if(name!=='ym2203')client.setPan(0,true,true);
  client.setOperator(0,3,{multi:1,tl:0,ar:31,d1r:0,d2r:0,sl:0,rr:15});client.noteOn(0,4,600);
  assert.ok(render(a.processor).some(x=>Math.abs(x)>.001));
  assert.deepEqual(render(b.processor),render(control.processor));
  if(name!=='ym2612'){client.reset();client.ssg.tone(0,{frequency:440,volume:12});assert.ok(render(a.processor).some(x=>Math.abs(x)>.001));}
  if(name==='ym2610') await client.adpcmA.loadMemory(new Uint8Array(256));
  client.dispose();client.dispose();assert.equal(a.processor.process([],[]),false);
  assert.deepEqual(render(b.processor),render(control.processor));
  assert.throws(()=>client.noteOn(0,4,600),/disposed/);
 }finally{a.processor.dispose();b.processor.dispose();control.processor.dispose();}
});
test('late OPN initialization is disposed after Stop',async()=>{
 let complete,disposed=0;
 const {processor}=await setup('ym2612',{Ym2612:{create:()=>new Promise(resolve=>{complete=resolve;})}});
 processor.dispose();complete({dispose(){disposed++;}});await Promise.resolve();
 assert.equal(disposed,1);assert.equal(processor.process([],[]),false);
});
