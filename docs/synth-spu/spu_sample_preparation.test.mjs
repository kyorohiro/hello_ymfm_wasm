import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual page coordinator without creating an AudioContext.
const page=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const coordinator=page.slice(page.indexOf('function encodeInWorker('),page.indexOf("$('loadAudio').addEventListener"));
function fixture({postError}={}){
  const workers=[];let encode;
  class Worker{
    constructor(){this.terminated=0;workers.push(this);}
    terminate(){this.terminated++;}
    postMessage(data,transfer){if(postError)throw postError;this.data=data;this.transfer=transfer;}
  }
  vm.runInNewContext('let preparation=null;\n'+coordinator.replaceAll('import.meta.url',JSON.stringify(new URL('./synth.js',import.meta.url).href))+'\nprovide(encodeInWorker);',{Worker,URL,DOMException,provide:value=>{encode=value;}});
  return {workers,encode};
}

test('full-sample preparation aborts once, rejects stale replies and cannot cancel a newer encoding',async()=>{
  const f=fixture(),a=new AbortController(),pcm=new Float32Array(280);
  const first=f.encode(pcm,{loopStartSamples:56,maxBytes:160},{signal:a.signal});
  assert.equal(f.workers[0].data.pcm,pcm);assert.deepEqual(f.workers[0].data.options,{loopStartSamples:56,maxBytes:160});assert.equal(f.workers[0].transfer[0],pcm.buffer);
  const rejected=assert.rejects(first,error=>error.name==='AbortError');a.abort();await rejected;assert.equal(f.workers[0].terminated,1);
  const second=f.encode(new Float32Array(56),{loopStartSamples:null,maxBytes:32});
  f.workers[0].onmessage({data:{result:{adpcm:new Uint8Array(160)}}});assert.equal(f.workers[1].terminated,0);
  const result={adpcm:new Uint8Array(32)};f.workers[1].onmessage({data:{result}});assert.equal(await second,result);assert.equal(f.workers[1].terminated,1);
});

test('pre-aborted and failed worker requests keep ownership and release worker resources',async()=>{
  const f=fixture(),active=f.encode(new Float32Array(28),{maxBytes:16}),a=new AbortController();a.abort();
  await assert.rejects(f.encode(new Float32Array(28),{maxBytes:16},{signal:a.signal}),error=>error.name==='AbortError');assert.equal(f.workers.length,1);assert.equal(f.workers[0].terminated,0);
  f.workers[0].onmessage({data:{result:'kept'}});assert.equal(await active,'kept');
  const failed=fixture({postError:new Error('Cannot transfer PCM')});await assert.rejects(failed.encode(new Float32Array(28),{maxBytes:16}),/Cannot transfer/);assert.equal(failed.workers[0].terminated,1);
});
