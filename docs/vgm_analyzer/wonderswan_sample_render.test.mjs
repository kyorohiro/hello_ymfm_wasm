import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import {renderSamplePreview,samplePreviewWav,wonderswanPreviewPitch} from './sample_render.js';

const binary=await readFile(new URL('../generated/wonderswan_wasm.wasm',import.meta.url));
const module=await factory({wasmBinary:binary});
const getFactory=async name=>{assert.equal(name,'wonderswan');return async()=>module;};
const sample={chip:'wonderswan',kind:'wave',data:Uint8Array.from({length:16},(_,i)=>i<8?0:255)};
const event={clock:3072000,frequency:1830,frequencyKnown:true,enabled:true,channel:4,mode:'sweep',pan:{left:0,right:15}};

test('WonderSwan preview uses actual centered WASM audio at observed base pitch, bounded to one second',async()=>{
  const pcm=await renderSamplePreview(sample,event,{getFactory});
  assert.equal(pcm.sampleRate,44100);assert.equal(pcm.left.length,44100);assert.deepEqual(pcm.left,pcm.right);
  assert.ok(pcm.left.every(Number.isFinite));assert.ok(pcm.left.some(value=>value<-.06));assert.ok(pcm.left.some(value=>value>.06));
  assert.ok(pcm.left[0]===0);assert.ok(pcm.left.at(-1)===0);
  const steady=pcm.left.slice(2205,-2205);
  assert.ok(Math.abs(steady.reduce((sum,value)=>sum+value,0)/steady.length)<.001,'speaker boundary removes wave midpoint');
  let crossings=0;for(let i=1;i<steady.length;i++)if(steady[i-1]<0&&steady[i]>=0)crossings++;
  const measured=crossings*44100/steady.length;
  assert.ok(Math.abs(measured-wonderswanPreviewPitch(event).frequencyHz)<2,`pitch ${measured}`);
  const retained=pcm.left.slice();
  const centered=await renderSamplePreview(sample,{...event,channel:1,mode:'wave',pan:{left:15,right:0}},{getFactory});
  assert.deepEqual(centered,pcm,'preview isolates the wave from original channel, pan and sweep');
  assert.deepEqual(pcm.left,retained,'later rendering/disposal does not mutate returned PCM');
});

test('WonderSwan preview has no DC tone for a constant wave and uses A4 for unkeyed or unknown pitch',async()=>{
  const silent=await renderSamplePreview({...sample,data:new Uint8Array(16).fill(0xaa)},event,{getFactory});
  assert.ok(silent.left.every(value=>Math.abs(value)<1e-7));
  const defaultPitch=wonderswanPreviewPitch();
  assert.equal(defaultPitch.observed,false);assert.ok(Math.abs(defaultPitch.frequencyHz-440)<1);
  assert.deepEqual(wonderswanPreviewPitch({...event,enabled:false}),defaultPitch);
  assert.deepEqual(wonderswanPreviewPitch({...event,frequencyKnown:false}),defaultPitch);
  assert.equal(wonderswanPreviewPitch({...event,frequency:0}).observed,true,'an explicitly written low pitch remains valid');
  const oddClock=wonderswanPreviewPitch({...event,clock:3579545});
  assert.equal(oddClock.frequencyHz,Math.floor(3579545/128)*128/(32*(2048-event.frequency)));
});

test('WonderSwan WAV is one-second stereo PCM and invalid or partial samples fail clearly',async()=>{
  const result=await samplePreviewWav(sample,event,{getFactory});
  assert.equal(result.seconds,1);assert.equal(result.sampleRate,44100);
  const header=new DataView(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength);
  assert.equal(header.getUint16(22,true),2);assert.equal(header.getUint32(24,true),44100);assert.equal(header.getUint32(40,true),44100*4);
  await assert.rejects(renderSamplePreview({...sample,data:null},event,{getFactory}),/missing\/partial/);
  await assert.rejects(renderSamplePreview({...sample,data:new Uint8Array(15)},event,{getFactory}),/16 packed bytes/);
  await assert.rejects(renderSamplePreview(sample,event),/Missing sample factory: wonderswan/);
});
