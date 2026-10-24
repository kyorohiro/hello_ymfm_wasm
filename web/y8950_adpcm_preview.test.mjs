import test from 'node:test';
import assert from 'node:assert/strict';
import {createY8950AdpcmPreview,prepareY8950AdpcmSample,readY8950Adpcm,validateY8950AdpcmPreview} from './y8950_adpcm_preview.js';
const clock=3579545;
const tone=()=>({sampleRate:16000,channels:[Float32Array.from({length:4096},(_,i)=>.5*Math.sin(2*Math.PI*440*i/16000))]});
test('compact waveform follows the encoded source, exact range and committed memory revision',async()=>{
 const {bytes,metadata}=await prepareY8950AdpcmSample(tone(),{address:64,name:'Voice'},clock);
 assert.equal(metadata.start,64);assert.equal(metadata.end%32,0);assert(metadata.preview.waveform.length<=512);assert(metadata.preview.waveform.some(value=>Math.abs(value)>.1));
 assert.deepEqual(validateY8950AdpcmPreview(metadata.preview,64,bytes.length),metadata.preview);
 const registers=new Uint8Array(256),first=64/32,last=metadata.end/32-1;registers[8]=2;registers[9]=first;registers[11]=last&255;registers[12]=last>>8;registers[16]=metadata.deltaN&255;registers[17]=metadata.deltaN>>8;registers[18]=123;
 const memory={memoryBytes:metadata.end,revision:4,preview:{...metadata.preview,revision:4}};
 assert.equal(readY8950Adpcm(registers,clock,memory).waveformKnown,true);
 assert.equal(readY8950Adpcm(registers,clock,{...memory,revision:5}).waveformKnown,false);
 registers[9]++;assert.equal(readY8950Adpcm(registers,clock,memory).waveformKnown,false);
 registers[9]--;assert.equal(readY8950Adpcm(registers,clock,memory).waveformKnown,true);
 assert.throws(()=>validateY8950AdpcmPreview({...metadata.preview,waveform:[NaN]},64,bytes.length),/preview/);
 assert.equal(createY8950AdpcmPreview(new Uint8Array()),null);
});
test('admin preparation snapshots editable source/options and cancellation prevents encoding',async()=>{
 let finish;const source=tone(),original=source.channels[0].slice(),options={address:32,name:'Original',sampleRate:12000};
 const pending=prepareY8950AdpcmSample(source,options,clock,captured=>{assert.deepEqual(captured.channels[0],original);return new Promise(resolve=>finish=()=>resolve(captured));});
 options.name='Changed';options.address=64;source.channels[0].fill(0);finish();const prepared=await pending;
 assert.equal(prepared.metadata.name,'Original');assert.equal(prepared.metadata.start,32);assert(prepared.metadata.preview.waveform.some(value=>Math.abs(value)>.1));
 const abort=new AbortController();let resolve;const cancelled=prepareY8950AdpcmSample(tone(),{signal:abort.signal},clock,()=>new Promise(done=>resolve=done));abort.abort();resolve(tone());await assert.rejects(cancelled,{name:'AbortError'});
 for(const invalid of [{address:1},{sampleRate:1e9},{name:''},{signal:{}}])await assert.rejects(prepareY8950AdpcmSample(tone(),invalid,clock));
});
