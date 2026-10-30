import test from 'node:test';
import assert from 'node:assert/strict';
import {Scsp} from '../js/scsp.js';
import factory from '../generated/scsp_wasm.js';
import {ScspSynth,createScspInitSample} from '../js/scspsynth.js';
import {readFile} from 'node:fs/promises';
import {readPreset,writePreset} from './preset.js';
async function create(){return new ScspSynth(await Scsp.create({moduleFactory:factory,moduleOptions:{wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))}}));}
test('PCM preset round-trip reproduces exact WASM output and rejects malformed data',async()=>{
  const a=await create(),b=await create();try{
    const {pcm,options}=createScspInitSample(),sample=a.loadPCM(pcm,options);
    a.setPreset(0,{sample,totalLevel:12,pan:0});
    const json=writePreset({pcm,sample,voice:a.getState().slots[0]}),loaded=readPreset(JSON.parse(JSON.stringify(json)));
    b.setPreset(0,{...loaded.voice,sample:b.loadPCM(loaded.pcm,loaded.options)});
    a.noteOn(0,60);b.noteOn(0,60);const left=a.generateStereo(4096),right=b.generateStereo(4096);
    assert.deepEqual(left,right);assert(left.left.some(v=>Math.abs(v)>.01));
    for(const bad of [{...json,version:2},{...json,pcm:[0,NaN]},{...json,pcm:[0,32768]},{...json,options:{rootNote:69,loopStartSamples:999999}},{...json,voice:{...json.voice,pan:32}}])assert.throws(()=>readPreset(bad));
  }finally{a.dispose();b.dispose();}
});
test('initial sine triad has headroom before output gain and stop preserves bank',async()=>{
  const synth=await create();try{const {pcm,options}=createScspInitSample(),sample=synth.loadPCM(pcm,options);
    for(const [slot,note]of [60,64,67].entries()){synth.setPreset(slot,{sample,totalLevel:12});synth.noteOn(slot,note);}
    const out=synth.generateStereo(44100);const peak=out.left.reduce((v,x)=>Math.max(v,Math.abs(x)),0);
    assert(peak>.05&&peak<.95,`peak ${peak}`);synth.stopVoices();assert.equal(synth.getState().samples.length,1);assert(synth.generateStereo(128).left.every(v=>v===0));
  }finally{synth.dispose();}
});
