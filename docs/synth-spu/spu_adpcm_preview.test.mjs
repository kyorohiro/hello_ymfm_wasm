// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpuAdpcmPreviewCache,appliedSpuAdpcmPreview} from './spu_adpcm_preview.js';
import {decodePsfAdpcmPreview} from './psf_live_snapshot.js';

function packets(count=4) {
  const bytes=new Uint8Array(count*16);
  for(let at=0;at<bytes.length;at+=16){bytes[at]=0x24;bytes.fill(0x32,at+2,at+16);}
  bytes[1]=4;bytes[bytes.length-15]=3;return bytes;
}

test('a large immutable sample decodes only its first 64 bytes once and caches by byte identity',()=>{
  const bytes=packets(32000),original=bytes.slice(),inputs=[];
  const cache=createSpuAdpcmPreviewCache({decode:input=>{inputs.push(input);return decodePsfAdpcmPreview(input);}});
  const first=cache.read(bytes);
  assert.equal(inputs.length,1);assert.equal(inputs[0].length,64);
  assert.equal(first.preview.packetCount,4);assert.equal(first.preview.decodedFrames,112);
  assert.equal(first.preview.sampleByteLength,512000);assert.equal(first.preview.byteLength,64);
  assert.equal(first.preview.source,'sample-start');assert.equal(first.preview.history,'zero-at-sample-start');
  assert.equal(first.preview.truncated,true);assert.equal(first.preview.fullSampleKnown,false);
  assert.strictEqual(cache.read(bytes),first);assert.equal(inputs.length,1);
  const replacement=bytes.slice();assert.notStrictEqual(cache.read(replacement),first);assert.equal(inputs.length,2);
  assert.deepEqual(bytes,original);assert(Object.isFrozen(first.preview));assert(Object.isFrozen(first.preview.pcm));
  assert.throws(()=>{first.preview.pcm[0]=1;},TypeError);
});

test('END terminates before later invalid packets, preserving actual frame count instead of a fabricated tail',()=>{
  const bytes=packets();bytes[1]=1;bytes[16]=0xff;
  const {preview,unavailableReason}=createSpuAdpcmPreviewCache().read(bytes);
  assert.equal(unavailableReason,null);assert.equal(preview.packetCount,1);assert.equal(preview.decodedFrames,28);
  assert.equal(preview.paddingFrames,84);assert.equal(preview.endReached,true);assert.equal(preview.loop,false);
  assert.equal(preview.byteLength,16);assert.equal(preview.sampleByteLength,64);
});

test('the source preview carries predictor history across packets with zero history only at sample start',()=>{
  const bytes=packets(2),preview=createSpuAdpcmPreviewCache().read(bytes).preview;
  const reset=decodePsfAdpcmPreview(bytes.subarray(16));
  assert.notDeepEqual(preview.pcm.slice(28,56),reset.pcm.slice(0,28));
  assert.deepEqual(preview.pcm,decodePsfAdpcmPreview(bytes).pcm);
  assert.equal(preview.loopStartSamples,0);assert.equal(preview.loop,true);
});

test('invalid source previews stay local, are cached, and cannot poison a later valid sample',()=>{
  let decodes=0;
  const cache=createSpuAdpcmPreviewCache({decode:bytes=>{decodes++;return decodePsfAdpcmPreview(bytes);}});
  const bad=packets();bad[0]=0xff;
  const first=cache.read(bad);assert.equal(first.preview,null);assert.match(first.unavailableReason,/predictor|shift/);
  assert.strictEqual(cache.read(bad),first);assert.equal(decodes,1);
  assert.equal(cache.read(new Uint8Array(15)).preview,null);
  assert.equal(cache.read(null).preview,null);
  assert.equal(cache.read(packets()).preview.decodedFrames,112);
});

test('preview display accepts only matching sample metadata and never treats it as editable waveform',()=>{
  const preview={sample:7,...createSpuAdpcmPreviewCache().read(packets()).preview};
  const voice={sample:7,waveform:null,adpcmPreview:preview};
  assert.strictEqual(appliedSpuAdpcmPreview(voice),preview);assert.equal(voice.waveform,null);
  assert.equal(appliedSpuAdpcmPreview(null),null);assert.equal(appliedSpuAdpcmPreview({sample:7}),null);
  assert.equal(appliedSpuAdpcmPreview({...voice,sample:8}),null);
  assert.equal(appliedSpuAdpcmPreview({...voice,adpcmPreview:{...preview,decodedFrames:113}}),null);
  assert.equal(appliedSpuAdpcmPreview({...voice,adpcmPreview:{...preview,pcm:[NaN]}}),null);
});
