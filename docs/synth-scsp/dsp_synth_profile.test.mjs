// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assembleScspDsp} from './dsp_assembler.js';
import {validateScspDspDelayProgram, validateScspSynthDspProgram, checkScspSynthDspSource} from './dsp_program.js';
import {createScspDspExample, identifyScspDspExample, identifyScspDspProgram} from './dsp_examples.js';
import {createScspCodeClient} from './code_endpoint.js';

test('Synth adds two RAM-free outputs while the mono RAM profile stays bounded', async () => {
  const example = createScspDspExample('routing-gain-iir');
  assert.equal(example.source, await readFile(new URL('./examples/routing-gain-iir.scspasm',import.meta.url),'utf8'));
  assert.deepEqual(checkScspSynthDspSource(example.source).words, example.words);
  assert.deepEqual(validateScspSynthDspProgram(example.words), example.words);
  assert.throws(() => validateScspDspDelayProgram(example.words), /EWA must be 0/);
  assert.equal(identifyScspDspProgram(example.words), 'routing');
  assert.equal(identifyScspDspExample(example.words, example.codes), example.id);
  assert.equal(identifyScspDspExample(example.words, [2048,3840,256]), null);
  assert.deepEqual(example.codes, [4095,3840,256]);
  assert.deepEqual(example.roles, ['Left gain','Right feedback','Right input']);
  for (const source of [
    '000: EWT=1 EWA=2',
    '001: MRD=1 EWT=1 EWA=1',
    '000: XSEL=1 YSEL=1 COEF=3',
    '000: RAW0=0x8000',
  ]) assert.throws(() => checkScspSynthDspSource(source));
  for (const id of ['delay','fir2-lowpass','fir2-highpass','iir1-lowpass']) {
    const legacy=createScspDspExample(id);
    assert.deepEqual(validateScspSynthDspProgram(legacy.words), validateScspDspDelayProgram(legacy.words));
  }
  const source='; Source line retained\n\n001: MRD=1 EWT=1 EWA=1';
  assert.throws(() => checkScspSynthDspSource(source), error => error.line===3 && error.step===1);
});

test('borrowed routing calls validate physical/source/output targets and clone before dispatch', async () => {
  const requests=[];
  const client=createScspCodeClient({metadata:{session:1,channels:32,operators:6,sampleRate:44100},
    isCurrent:()=>true,invoke:async(method,args)=>{requests.push({method,args});return args[1];},dispose:async()=>true});
  const patch={input:1,level:7}, result=client.setDspSend(31,patch);patch.level=0;
  assert.deepEqual(await result,{input:1,level:7});
  await client.setDspSourceSend(5,null);
  await client.setDspReturn(1,{level:7,pan:15});
  assert.deepEqual(requests,[
    {method:'setDspSend',args:[31,{input:1,level:7}]},
    {method:'setDspSourceSend',args:[5,null]},
    {method:'setDspReturn',args:[1,{level:7,pan:15}]},
  ]);
  for (const call of [()=>client.setDspSend(32,{}),()=>client.setDspSourceSend(6,{}),
    ()=>client.setDspReturn(2,{}),()=>client.setDspSend(0,{input:2}),
    ()=>client.setDspSend(0,{level:8}),()=>client.setDspSend(0,{level:undefined}),
    ()=>client.setDspReturn(1,null),()=>client.setDspReturn(0,{pan:32}),
    ()=>client.setDspSourceSend(0,{unknown:1})]) assert.throws(call);
  assert.equal(requests.length,3);
  const words=client.compileDsp('000: EWT=1 EWA=1');
  assert.deepEqual(words,assembleScspDsp('000: EWT=1 EWA=1'));
  assert.equal(requests.length,3,'compilation is local');
});

test('profile selection reads caller words once and retains strict numeric / sparse validation', () => {
  const example=createScspDspExample('routing-gain-iir');
  const input=Array.from(example.words);
  let reads=0;
  Object.defineProperty(input,0,{get(){reads++;return example.words[0];}});
  assert.deepEqual(validateScspSynthDspProgram(input),example.words);
  assert.equal(reads,1);
  const sparse=Array.from(example.words);delete sparse[7];
  assert.throws(()=>validateScspSynthDspProgram(sparse),/word 7 must be a number/);
  for (const value of ['0',null,undefined,NaN,Infinity,.5,-1,65536]) {
    const words=Array.from(example.words);words[0]=value;
    assert.throws(()=>validateScspSynthDspProgram(words));
  }
});
